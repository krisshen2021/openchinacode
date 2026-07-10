export * as ManagedProcess from "./managed-process"

import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import fsp from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "./effect/app-node"
import { Identifier } from "./id/id"

export const Status = Schema.Literals(["running", "exited", "stopped", "error"])
export type Status = typeof Status.Type

export const Info = Schema.Struct({
  id: Schema.String,
  name: Schema.String.pipe(Schema.optional),
  status: Status,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  mode: Schema.Literals(["exec", "shell"]),
  pid: Schema.Number.pipe(Schema.optional),
  log: Schema.String,
  started_at: Schema.Number,
  completed_at: Schema.Number.pipe(Schema.optional),
  exit_code: Schema.Number.pipe(Schema.optional),
  signal: Schema.String.pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
})
export type Info = typeof Info.Type

export type StartInput = {
  readonly name?: string
  readonly command: string
  readonly args?: ReadonlyArray<string>
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
  readonly log?: string
}

export type LogInput = {
  readonly id: string
  readonly lines?: number
  readonly maxBytes?: number
}

export type LogOutput = {
  readonly id: string
  readonly log: string
  readonly output: string
  readonly truncated: boolean
}

export interface Interface {
  readonly start: (input: StartInput) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly stop: (id: string, signal?: NodeJS.Signals, forceAfterMs?: number) => Effect.Effect<Info | undefined>
  readonly logs: (input: LogInput) => Effect.Effect<LogOutput | undefined>
  readonly waitForOutput: (id: string, text: string, timeoutMs: number) => Effect.Effect<boolean>
  readonly waitForPort: (port: number, host: string, timeoutMs: number) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ManagedProcess") {}

type Active = {
  info: Info
  process: ChildProcess
  stopRequested: boolean
}

const DEFAULT_LOG_BYTES = 64 * 1024
const LOG_ROOT = path.join(os.tmpdir(), "openchinacode-processes")

const isShellCommand = (command: string, args: ReadonlyArray<string> | undefined) =>
  args === undefined && /[\s;&|<>$`'"*?()[\]{}]/.test(command)

const shellLaunch = (command: string) => {
  if (process.platform === "win32") return { command: process.env.COMSPEC ?? "cmd.exe", args: ["/d", "/s", "/c", command] }
  return { command: "/bin/sh", args: ["-lc", command] }
}

const shellQuote = (value: string) => {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

const displayCommand = (command: string, args: ReadonlyArray<string> | undefined) =>
  args === undefined ? command : [command, ...args.map(shellQuote)].join(" ")

const safeName = (value: string) => value.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "")

const defaultLogPath = (id: string, name?: string) => {
  const suffix = name ? `-${safeName(name).slice(0, 48)}` : ""
  return path.join(LOG_ROOT, `${id}${suffix}.log`)
}

const snapshot = (active: Active): Info => ({ ...active.info, args: [...active.info.args] })

const updateInfo = (active: Active, next: Partial<Info>) => {
  active.info = { ...active.info, ...next }
}

const readTail = async (file: string, maxBytes: number, lines?: number): Promise<{ text: string; truncated: boolean }> => {
  const stat = await fsp.stat(file).catch(() => undefined)
  if (!stat) return { text: "", truncated: false }
  const size = stat.size
  const start = Math.max(0, size - maxBytes)
  const handle = await fsp.open(file, "r")
  try {
    const buffer = Buffer.alloc(size - start)
    await handle.read(buffer, 0, buffer.length, start)
    let text = buffer.toString("utf8")
    let truncated = start > 0
    if (lines !== undefined) {
      const parts = text.split(/\r?\n/)
      const hadTrailingNewline = text.endsWith("\n")
      const relevant = parts.slice(-lines - (hadTrailingNewline ? 1 : 0))
      truncated = truncated || relevant.length < parts.length
      text = relevant.join("\n")
    }
    return { text, truncated }
  } finally {
    await handle.close()
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const canConnect = (host: string, port: number, timeoutMs: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port })
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once("connect", () => finish(true))
    socket.once("error", () => finish(false))
  })

const killProcessGroup = (active: Active, signal: NodeJS.Signals) => {
  const pid = active.info.pid
  if (!pid) return false
  try {
    if (process.platform !== "win32") process.kill(-pid, signal)
    else active.process.kill(signal)
    return true
  } catch {
    try {
      return active.process.kill(signal)
    } catch {
      return false
    }
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const processes = new Map<string, Active>()

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const active of processes.values()) {
          if (active.info.status !== "running") continue
          active.stopRequested = true
          killProcessGroup(active, "SIGTERM")
        }
        processes.clear()
      }),
    )

    const list: Interface["list"] = Effect.fn("ManagedProcess.list")(function* () {
      return Array.from(processes.values())
        .map(snapshot)
        .toSorted((a, b) => a.started_at - b.started_at)
    })

    const get: Interface["get"] = Effect.fn("ManagedProcess.get")(function* (id) {
      const active = processes.get(id)
      if (!active) return
      return snapshot(active)
    })

    const start: Interface["start"] = Effect.fn("ManagedProcess.start")(function* (input) {
      return yield* Effect.sync(() => {
        const id = Identifier.create("proc", "ascending")
        const shellMode = isShellCommand(input.command, input.args)
        const launch = shellMode ? shellLaunch(input.command) : { command: input.command, args: [...(input.args ?? [])] }
        const log = path.resolve(input.cwd, input.log ?? defaultLogPath(id, input.name))
        fs.mkdirSync(path.dirname(log), { recursive: true, mode: 0o700 })
        const stdout = fs.openSync(log, "a", 0o600)
        const stderr = fs.openSync(log, "a", 0o600)
        let child: ChildProcess
        try {
          child = spawn(launch.command, launch.args, {
            cwd: input.cwd,
            env: { ...process.env, ...input.env },
            detached: process.platform !== "win32",
            stdio: ["ignore", stdout, stderr],
            windowsHide: true,
          })
        } finally {
          fs.closeSync(stdout)
          fs.closeSync(stderr)
        }
        const now = Date.now()
        const active: Active = {
          info: {
            id,
            ...(input.name ? { name: input.name } : {}),
            status: "running",
            command: input.command,
            args: [...(input.args ?? [])],
            cwd: input.cwd,
            mode: shellMode ? "shell" : "exec",
            ...(child.pid === undefined ? {} : { pid: child.pid }),
            log,
            started_at: now,
          },
          process: child,
          stopRequested: false,
        }
        processes.set(id, active)
        child.once("exit", (code, signal) => {
          updateInfo(active, {
            status: active.stopRequested ? "stopped" : "exited",
            completed_at: Date.now(),
            ...(code === null ? {} : { exit_code: code }),
            ...(signal === null ? {} : { signal }),
          })
        })
        child.once("error", (error) => {
          updateInfo(active, {
            status: "error",
            completed_at: Date.now(),
            error: error.message,
          })
        })
        child.unref()
        return snapshot(active)
      })
    })

    const stop: Interface["stop"] = Effect.fn("ManagedProcess.stop")(function* (id, signal = "SIGTERM", forceAfterMs = 3_000) {
      const active = processes.get(id)
      if (!active) return
      if (active.info.status !== "running") return snapshot(active)
      active.stopRequested = true
      killProcessGroup(active, signal)
      if (signal !== "SIGKILL" && forceAfterMs > 0) {
        setTimeout(() => {
          if (active.info.status === "running") killProcessGroup(active, "SIGKILL")
        }, forceAfterMs).unref()
      }
      return snapshot(active)
    })

    const logs: Interface["logs"] = Effect.fn("ManagedProcess.logs")(function* (input) {
      const active = processes.get(input.id)
      if (!active) return
      const tail = yield* Effect.promise(() =>
        readTail(active.info.log, input.maxBytes ?? DEFAULT_LOG_BYTES, input.lines),
      )
      return {
        id: input.id,
        log: active.info.log,
        output: tail.text || "(no output)",
        truncated: tail.truncated,
      }
    })

    const waitForOutput: Interface["waitForOutput"] = Effect.fn("ManagedProcess.waitForOutput")(function* (
      id,
      text,
      timeoutMs,
    ) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() <= deadline) {
        const active = processes.get(id)
        if (!active) return false
        const tail = yield* Effect.promise(() => readTail(active.info.log, 512 * 1024))
        if (tail.text.includes(text)) return true
        if (active.info.status !== "running") return false
        yield* Effect.promise(() => delay(150))
      }
      return false
    })

    const waitForPort: Interface["waitForPort"] = Effect.fn("ManagedProcess.waitForPort")(function* (
      port,
      host,
      timeoutMs,
    ) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() <= deadline) {
        if (yield* Effect.promise(() => canConnect(host, port, 500))) return true
        yield* Effect.promise(() => delay(150))
      }
      return false
    })

    return Service.of({ start, list, get, stop, logs, waitForOutput, waitForPort })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
