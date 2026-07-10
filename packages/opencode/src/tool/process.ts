import { Effect, Schema } from "effect"
import path from "path"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { ManagedProcess } from "@opencode-ai/core/managed-process"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { PositiveInt } from "@opencode-ai/core/schema"
import { ShellID } from "./shell/id"
import { assertExternalDirectoryEffect } from "./external-directory"

const MAX_WAIT_MS = 60_000
const MAX_LOG_BYTES = 1024 * 1024

const commandResource = (command: string, args: ReadonlyArray<string> | undefined) => {
  if (!args) return command
  return [command, ...args.map(shellQuote)].join(" ")
}

const shellQuote = (value: string) => {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

const resolveFrom = (root: string, target: string) => (path.isAbsolute(target) ? target : path.resolve(root, target))

const isProcessInfo = (value: ManagedProcess.Info | undefined): value is ManagedProcess.Info => value !== undefined

export const StartParameters = Schema.Struct({
  command: Schema.String.annotate({
    description:
      "Executable name or shell command string to start. Use args for direct executable mode; omit args for shell command strings like 'npm run dev'.",
  }),
  args: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Arguments for direct executable mode, for example ['run', 'dev'] with command 'npm'.",
  }),
  workdir: Schema.optional(Schema.String).annotate({
    description: "Working directory. Defaults to the current project directory.",
  }),
  name: Schema.optional(Schema.String).annotate({ description: "Short human-readable process name." }),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Extra environment variables for the process.",
  }),
  log: Schema.optional(Schema.String).annotate({
    description:
      "Optional log file path. Relative paths resolve from workdir; omitted logs are stored in the OpenChinaCode temp process log directory.",
  }),
  wait_for_port: Schema.optional(PositiveInt).annotate({
    description: "Optional TCP port to poll until it accepts connections.",
  }),
  wait_for_host: Schema.optional(Schema.String).annotate({
    description: "Host used with wait_for_port. Defaults to 127.0.0.1.",
  }),
  wait_for_output: Schema.optional(Schema.String).annotate({
    description: "Optional log substring to wait for after startup.",
  }),
  wait_timeout: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_WAIT_MS))).annotate({
    description: `Startup readiness wait timeout in milliseconds, max ${MAX_WAIT_MS}.`,
  }),
})

type StartMetadata = {
  process: ManagedProcess.Info
  ready: boolean
  wait_timed_out: boolean
  waited_for: string[]
  truncated: false
}

export const ProcessStartTool = Tool.define<typeof StartParameters, StartMetadata, ManagedProcess.Service | FSUtil.Service>(
  "process_start",
  Effect.gen(function* () {
    const processes = yield* ManagedProcess.Service
    const fs = yield* FSUtil.Service

    return {
      description:
        "Start a long-running managed process such as a dev server, backend server, watcher, preview, or local service. Use this instead of bash for commands that keep running. Returns a process id for process_status, process_logs, and process_stop.",
      parameters: StartParameters,
      execute: (params: Schema.Schema.Type<typeof StartParameters>, ctx: Tool.Context<StartMetadata>) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const cwd = yield* fs.resolve(resolveFrom(instance.directory, params.workdir ?? "."))
          yield* assertExternalDirectoryEffect(ctx, cwd, { kind: "directory" })
          if (!(yield* fs.isDir(cwd))) throw new Error(`Working directory is not a directory: ${cwd}`)

          let log: string | undefined
          if (params.log) {
            log = resolveFrom(cwd, params.log)
            yield* assertExternalDirectoryEffect(ctx, log)
          }

          const resource = commandResource(params.command, params.args)
          yield* ctx.ask({
            permission: ShellID.ToolID,
            patterns: [resource],
            always: [resource],
            metadata: {
              command: resource,
              managed_process: true,
            },
          })

          const proc = yield* processes.start({
            command: params.command,
            args: params.args,
            cwd,
            ...(params.name ? { name: params.name } : {}),
            ...(params.env ? { env: params.env } : {}),
            ...(log ? { log } : {}),
          })

          const waited_for: string[] = []
          const checks: boolean[] = []
          const waitTimeout = params.wait_timeout ?? 10_000
          if (params.wait_for_output) {
            waited_for.push(`output '${params.wait_for_output}'`)
            checks.push(yield* processes.waitForOutput(proc.id, params.wait_for_output, waitTimeout))
          }
          if (params.wait_for_port) {
            const host = params.wait_for_host ?? "127.0.0.1"
            waited_for.push(`port ${host}:${params.wait_for_port}`)
            checks.push(yield* processes.waitForPort(params.wait_for_port, host, waitTimeout))
          }

          const process = (yield* processes.get(proc.id)) ?? proc
          const ready = checks.every(Boolean)
          const readiness =
            waited_for.length === 0
              ? "Started."
              : ready
                ? "Started and readiness check passed."
                : "Started, but readiness check timed out."
          return {
            title: params.name ?? params.command,
            output: [
              `${readiness}${waited_for.length ? ` Waited for ${waited_for.join(", ")}.` : ""}`,
              `Process ${process.id}${process.pid ? ` pid=${process.pid}` : ""} status=${process.status}`,
              `Log: ${process.log}`,
            ].join("\n"),
            metadata: {
              process,
              ready,
              wait_timed_out: waited_for.length > 0 && !ready,
              waited_for,
              truncated: false,
            },
          }
        }),
    }
  }),
)

export const StatusParameters = Schema.Struct({
  id: Schema.optional(Schema.String).annotate({
    description: "Optional process id. Omit to list all managed processes.",
  }),
})

type StatusMetadata = {
  processes: ManagedProcess.Info[]
  truncated: false
}

export const ProcessStatusTool = Tool.define<typeof StatusParameters, StatusMetadata, ManagedProcess.Service>(
  "process_status",
  Effect.gen(function* () {
    const processes = yield* ManagedProcess.Service
    return {
      description: "List managed processes or inspect one managed process by id.",
      parameters: StatusParameters,
      execute: (params: Schema.Schema.Type<typeof StatusParameters>) =>
        Effect.gen(function* () {
          const list = params.id ? [yield* processes.get(params.id)].filter(isProcessInfo) : yield* processes.list()
          return {
            title: params.id ? `Process ${params.id}` : "Managed processes",
            output: list.length
              ? list
                  .map(
                    (proc) =>
                      `${proc.id} status=${proc.status}${proc.pid ? ` pid=${proc.pid}` : ""} ${commandResource(proc.command, proc.args)}`,
                  )
                  .join("\n")
              : "No managed processes.",
            metadata: {
              processes: list,
              truncated: false,
            },
          }
        }),
    }
  }),
)

export const LogsParameters = Schema.Struct({
  id: Schema.String,
  lines: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(1_000))).annotate({
    description: "Optional number of trailing log lines.",
  }),
  max_bytes: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_LOG_BYTES))).annotate({
    description: `Maximum bytes to read from the end of the log, max ${MAX_LOG_BYTES}.`,
  }),
})

type LogsMetadata = {
  id: string
  log: string
  truncated: boolean
}

export const ProcessLogsTool = Tool.define<typeof LogsParameters, LogsMetadata, ManagedProcess.Service>(
  "process_logs",
  Effect.gen(function* () {
    const processes = yield* ManagedProcess.Service
    return {
      description: "Read the retained log output for a managed process.",
      parameters: LogsParameters,
      execute: (params: Schema.Schema.Type<typeof LogsParameters>) =>
        Effect.gen(function* () {
          const result = yield* processes.logs({
            id: params.id,
            lines: params.lines,
            maxBytes: params.max_bytes,
          })
          if (!result) throw new Error(`Unknown managed process: ${params.id}`)
          return {
            title: `Process logs ${params.id}`,
            output: result.output,
            metadata: {
              id: result.id,
              log: result.log,
              truncated: result.truncated,
            },
          }
        }),
    }
  }),
)

export const StopParameters = Schema.Struct({
  id: Schema.String,
  signal: Schema.optional(Schema.Literals(["SIGTERM", "SIGKILL", "SIGINT"])).annotate({
    description: "Signal to send. Defaults to SIGTERM.",
  }),
  force_after_ms: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_WAIT_MS))).annotate({
    description: "After SIGTERM/SIGINT, send SIGKILL if the process is still running after this delay.",
  }),
})

type StopMetadata = {
  stopped: boolean
  process?: ManagedProcess.Info
  truncated: false
}

export const ProcessStopTool = Tool.define<typeof StopParameters, StopMetadata, ManagedProcess.Service>(
  "process_stop",
  Effect.gen(function* () {
    const processes = yield* ManagedProcess.Service
    return {
      description: "Stop a managed process by id. Use this instead of pkill, killall, xargs kill, or port-kill pipelines.",
      parameters: StopParameters,
      execute: (params: Schema.Schema.Type<typeof StopParameters>) =>
        Effect.gen(function* () {
          const proc = yield* processes.stop(params.id, params.signal, params.force_after_ms)
          return {
            title: `Stop process ${params.id}`,
            output: proc
              ? `${proc.status === "running" ? "Stop signal sent" : "Process was not running"}: ${proc.id} status=${proc.status}`
              : "Unknown managed process.",
            metadata: {
              stopped: proc?.status === "running" ? true : false,
              ...(proc ? { process: proc } : {}),
              truncated: false,
            },
          }
        }),
    }
  }),
)
