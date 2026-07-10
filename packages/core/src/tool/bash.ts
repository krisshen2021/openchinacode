export * as BashTool from "./bash"

import path from "path"
import { ToolFailure } from "@opencode-ai/llm"
import { Duration, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { AppProcess } from "../process"
import { PermissionV2 } from "../permission"
import { PositiveInt } from "../schema"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "bash"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
export const MAX_TIMEOUT_MS = 10 * 60 * 1_000
export const MAX_CAPTURE_BYTES = 1024 * 1024

export const Input = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.String.pipe(Schema.optional).annotate({
    description: "Working directory. Defaults to the active Location; relative paths resolve from that Location.",
  }),
  timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_TIMEOUT_MS))
    .pipe(Schema.optional)
    .annotate({
      description: `Timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS} and may not exceed ${MAX_TIMEOUT_MS}.`,
    }),
})

const StructuredOutput = Schema.Struct({
  exit: Schema.Number.pipe(Schema.optional),
  truncated: Schema.Boolean,
  blocked: Schema.Boolean.pipe(Schema.optional),
  timeout: Schema.Boolean.pipe(Schema.optional),
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  warnings: Schema.Array(Schema.String).pipe(Schema.optional),
})

type Output = typeof Output.Type

const defaultShell = () => (process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh")

const modelOutput = (output: Output) => {
  const warnings = output.warnings?.length
    ? `\n\nWarnings:\n${output.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : ""
  if (output.blocked) return output.output
  if (output.timeout) return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command timed out before completion.`
  return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command exited with code ${output.exit}.`
}

const isTimeout = (error: AppProcess.AppProcessError) =>
  error.cause instanceof Error && error.cause.message === "Timed out"

/**
 * Minimal V2 core shell boundary. Keep parity debt visible without pulling the
 * legacy shell runtime into core.
 */
// TODO: Port tree-sitter bash / PowerShell parser-based approval reduction.
// TODO: Port BashArity reusable command-prefix approvals.
// TODO: Replace token-based command-argument external-directory advisories with parser-based detection.
// TODO: Restore PowerShell and cmd-specific invocation/path handling on Windows.
// TODO: Add plugin shell.env environment augmentation once V2 plugin hooks exist.
// TODO: Add durable/live progress metadata streaming for long-running commands once V2 tool invocation progress context is wired.
// TODO: Persist managed process status and define restart recovery before exposing remote observation.
// TODO: Add HTTP managed-process observation only after durable status, restart recovery, and authorization are defined.
// TODO: Revisit process-group cleanup and platform coverage with shell-specific tests if current AppProcess semantics do not fully cover it.
// TODO: Revisit binary output handling if stdout/stderr decoding is text-only.
// TODO: Stream full shell output into managed storage while retaining only a bounded in-memory preview.

const shellTokens = (command: string) => command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
const unquote = (value: string) => value.replace(/^(['"])(.*)\1$/, "$2")

const normalizeCommand = (command: string) => command.replace(/\s+/g, " ").trim()
const hasBroadKill = (command: string) => {
  const normalized = normalizeCommand(command)
  if (/\bpkill\b(?=[^;&|]*\s-f\b)(?=[^;&|]*(?:node|npm|bun|tsx|vite|next|nuxt|python|uvicorn|server|dev))/i.test(normalized))
    return true
  if (/\bkillall\s+(?:node|npm|bun|tsx|vite|next|nuxt|python|uvicorn)\b/i.test(normalized)) return true
  if (/\|\s*xargs\s+kill(?:\s+-9)?\b/i.test(normalized)) return true
  return false
}
const startsLongRunningService = (command: string) => {
  const normalized = normalizeCommand(command)
  return /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)\b/i.test(normalized) ||
    /\bnpx\s+tsx\b/i.test(normalized) ||
    /\btsx\s+\S+/i.test(normalized) ||
    /\b(?:vite|next\s+dev|nuxt\s+dev|uvicorn|flask|fastapi|python\s+-m\s+http\.server)\b/i.test(normalized)
}
const hasSingleAmpersand = (command: string) => {
  for (let i = 0; i < command.length; i++) {
    if (command[i] !== "&") continue
    if (command[i - 1] === "&" || command[i + 1] === "&") continue
    return true
  }
  return false
}
const hasRawBackgroundLaunch = (command: string) => /\b(?:nohup|setsid)\b/i.test(command) || hasSingleAmpersand(command)
const safetyBlock = (command: string) => {
  if (hasBroadKill(command)) {
    return [
      "Command blocked by OpenChinaCode shell safety policy.",
      "",
      "Reason: broad process-kill patterns such as pkill -f, killall, or xargs kill can terminate unrelated user processes and have caused unstable tool runs.",
      "",
      "Use process_stop for OpenChinaCode-managed processes. For an unmanaged external process, inspect exact PIDs first and stop only the specific PID.",
    ].join("\n")
  }
  if (startsLongRunningService(command) || (hasRawBackgroundLaunch(command) && startsLongRunningService(command))) {
    return [
      "Command blocked by OpenChinaCode shell safety policy.",
      "",
      "Reason: this looks like a long-running server, watcher, preview, or background launch. Running it through bash makes the tool wait until timeout or lose ownership of the child process.",
      "",
      "Use process_start with workdir/name/log/readiness options, then process_status, process_logs, and process_stop for lifecycle control.",
    ].join("\n")
  }
  if (hasRawBackgroundLaunch(command)) {
    return [
      "Command blocked by OpenChinaCode shell safety policy.",
      "",
      "Reason: raw background launches with &, nohup, or setsid are not observable or stoppable by the bash tool.",
      "",
      "Use process_start for managed background work, or run a short foreground command that exits.",
    ].join("\n")
  }
  return
}

const externalCommandDirectories = Effect.fn("BashTool.externalCommandDirectories")(function* (
  fs: FSUtil.Interface,
  command: string,
  cwd: string,
) {
  const directories = new Set<string>()
  for (const token of shellTokens(command)) {
    const value = unquote(token).replace(/[;,|&]+$/, "")
    if (!path.isAbsolute(value)) continue
    const resolved = yield* fs.resolve(value)
    if (FSUtil.contains(cwd, resolved)) continue
    directories.add(yield* fs.resolve(path.dirname(resolved)))
  }
  return [...directories]
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const fs = yield* FSUtil.Service
    const appProcess = yield* AppProcess.Service
    const config = yield* Config.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description: `Execute one short shell command string with the host user's filesystem, process, and network authority. Use bash for commands that naturally terminate, such as listing files, running tests, builds, git commands, or small scripts. Do not use bash for dev servers, watchers, previews, backend servers, raw background launches (&, nohup, setsid), or broad process killing; use process_start, process_status, process_logs, and process_stop instead. The active Location is the default working directory. Relative workdir values resolve from that Location. External workdir values require external_directory approval; best-effort command-argument path warnings are advisory only. Timeout values are milliseconds (default: ${DEFAULT_TIMEOUT_MS}; maximum: ${MAX_TIMEOUT_MS}). Uses the configured shell when set; otherwise uses /bin/sh on POSIX and COMSPEC or cmd.exe on Windows.`,
          input: Input,
          output: Output,
          structured: StructuredOutput,
          toStructuredOutput: ({ output }) => ({
            truncated: output.truncated,
            ...(output.exit === undefined ? {} : { exit: output.exit }),
            ...(output.blocked === undefined ? {} : { blocked: output.blocked }),
            ...(output.timeout === undefined ? {} : { timeout: output.timeout }),
          }),
          toModelOutput: ({ output }) =>
            output.blocked
              ? [{ type: "text", text: output.output }]
              : [
                  { type: "text", text: output.output },
                  { type: "text", text: modelOutput(output) },
                ],
          execute: (input, context) =>
            Effect.gen(function* () {
              const blocked = safetyBlock(input.command)
              if (blocked)
                return {
                  output: blocked,
                  truncated: false,
                  blocked: true,
                }

              const source = {
                type: "tool" as const,
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
              }
              const target = yield* mutation.resolve({ path: input.workdir ?? ".", kind: "directory" })
              const external = target.externalDirectory
              if (external)
                yield* permission.assert({
                  ...LocationMutation.externalDirectoryPermission(external),
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
              const warnings = (yield* externalCommandDirectories(fs, input.command, target.canonical)).map(
                (directory) =>
                  `Command argument references external directory ${path.join(directory, "*").replaceAll("\\", "/")}. Bash runs with host-user filesystem, process, and network authority; this scan is advisory only.`,
              )
              yield* permission.assert({
                action: name,
                resources: [input.command],
                save: [input.command],
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })

              if ((yield* fs.stat(target.canonical)).type !== "Directory")
                return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.canonical}`))

              const entries = yield* config.entries()
              const shell =
                Object.assign({}, ...entries.flatMap((entry) => (entry.type === "document" ? [entry.info] : [])))
                  .shell ?? defaultShell()
              const command = ChildProcess.make(input.command, [], {
                cwd: target.canonical,
                shell,
                stdin: "ignore",
                detached: process.platform !== "win32",
                forceKillAfter: Duration.seconds(3),
              })
              const timeout = input.timeout ?? DEFAULT_TIMEOUT_MS
              const result = yield* appProcess
                .run(command, {
                  combineOutput: true,
                  timeout: Duration.millis(timeout),
                  maxOutputBytes: MAX_CAPTURE_BYTES,
                })
                .pipe(
                  Effect.catchTag("AppProcessError", (error) =>
                    isTimeout(error) ? Effect.succeed(undefined) : Effect.fail(error),
                  ),
                )
              if (!result) {
                return {
                  output: `Command exceeded timeout of ${timeout} ms. Retry with a larger timeout if the command is expected to take longer.`,
                  truncated: false,
                  timeout: true,
                  ...(warnings.length ? { warnings } : {}),
                }
              }

              const output = result.output?.toString("utf8") || "(no output)"
              const notice = result.outputTruncated
                ? "[output capture truncated at the in-memory safety limit]"
                : undefined
              return {
                exit: result.exitCode,
                output: notice ? `${output}\n\n${notice}` : output,
                truncated: result.outputTruncated === true,
                ...(warnings.length ? { warnings } : {}),
              }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to execute command: ${input.command}` }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/bash",
  layer,
  deps: [ToolRegistry.node, LocationMutation.node, FSUtil.node, AppProcess.node, Config.node, PermissionV2.node],
})
