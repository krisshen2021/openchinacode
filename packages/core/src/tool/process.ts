export * as ProcessTool from "./process"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { ManagedProcess } from "../managed-process"
import { PermissionV2 } from "../permission"
import { PositiveInt } from "../schema"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const startName = "process_start"
export const statusName = "process_status"
export const stopName = "process_stop"
export const logsName = "process_logs"

const MAX_WAIT_MS = 60_000
const MAX_LOG_BYTES = 1024 * 1024

const Signal = Schema.Literals(["SIGTERM", "SIGKILL", "SIGINT"])

export const StartInput = Schema.Struct({
  command: Schema.String.annotate({
    description:
      "Executable name or shell command string to start. Use args for direct executable mode; omit args for shell command strings like 'npm run dev'.",
  }),
  args: Schema.Array(Schema.String).pipe(Schema.optional).annotate({
    description: "Arguments for direct executable mode, for example ['run', 'dev'] with command 'npm'.",
  }),
  workdir: Schema.String.pipe(Schema.optional).annotate({
    description: "Working directory. Defaults to the active Location; relative paths resolve from that Location.",
  }),
  name: Schema.String.pipe(Schema.optional).annotate({ description: "Short human-readable process name." }),
  env: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional).annotate({
    description: "Extra environment variables for the process.",
  }),
  log: Schema.String.pipe(Schema.optional).annotate({
    description:
      "Optional log file path. Relative paths resolve from workdir; omitted logs are stored in the OpenChinaCode temp process log directory.",
  }),
  wait_for_port: PositiveInt.pipe(Schema.optional).annotate({
    description: "Optional TCP port to poll until it accepts connections.",
  }),
  wait_for_host: Schema.String.pipe(Schema.optional).annotate({
    description: "Host used with wait_for_port. Defaults to 127.0.0.1.",
  }),
  wait_for_output: Schema.String.pipe(Schema.optional).annotate({
    description: "Optional log substring to wait for after startup.",
  }),
  wait_timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_WAIT_MS))
    .pipe(Schema.optional)
    .annotate({ description: `Startup readiness wait timeout in milliseconds, max ${MAX_WAIT_MS}.` }),
})

const StartOutput = Schema.Struct({
  process: ManagedProcess.Info,
  ready: Schema.Boolean,
  wait_timed_out: Schema.Boolean,
  waited_for: Schema.Array(Schema.String),
})

export const StatusInput = Schema.Struct({
  id: Schema.String.pipe(Schema.optional).annotate({
    description: "Optional process id. Omit to list all managed processes.",
  }),
})

const StatusOutput = Schema.Struct({
  processes: Schema.Array(ManagedProcess.Info),
})

export const StopInput = Schema.Struct({
  id: Schema.String,
  signal: Signal.pipe(Schema.optional).annotate({
    description: "Signal to send. Defaults to SIGTERM.",
  }),
  force_after_ms: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_WAIT_MS))
    .pipe(Schema.optional)
    .annotate({ description: "After SIGTERM/SIGINT, send SIGKILL if the process is still running after this delay." }),
})

const StopOutput = Schema.Struct({
  stopped: Schema.Boolean,
  process: ManagedProcess.Info.pipe(Schema.optional),
})

export const LogsInput = Schema.Struct({
  id: Schema.String,
  lines: PositiveInt.check(Schema.isLessThanOrEqualTo(1_000)).pipe(Schema.optional).annotate({
    description: "Optional number of trailing log lines.",
  }),
  max_bytes: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_LOG_BYTES))
    .pipe(Schema.optional)
    .annotate({ description: `Maximum bytes to read from the end of the log, max ${MAX_LOG_BYTES}.` }),
})

const LogsOutput = Schema.Struct({
  id: Schema.String,
  log: Schema.String,
  output: Schema.String,
  truncated: Schema.Boolean,
})

const shellQuote = (value: string) => {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

const commandResource = (command: string, args: ReadonlyArray<string> | undefined) =>
  args === undefined ? command : [command, ...args.map(shellQuote)].join(" ")

const source = (context: Tool.Context) => ({
  type: "tool" as const,
  messageID: context.assistantMessageID,
  callID: context.toolCallID,
})

const approveExternal = Effect.fn("ProcessTool.approveExternal")(function* (
  permission: PermissionV2.Interface,
  context: Tool.Context,
  external: LocationMutation.ExternalDirectoryAuthorization | undefined,
) {
  if (!external) return
  yield* permission.assert({
    ...LocationMutation.externalDirectoryPermission(external),
    sessionID: context.sessionID,
    agent: context.agent,
    source: source(context),
  })
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const fs = yield* FSUtil.Service
    const permission = yield* PermissionV2.Service
    const processes = yield* ManagedProcess.Service

    yield* tools
      .register({
        [startName]: Tool.withPermission(
          Tool.make({
            description:
              "Start a long-running managed process such as a dev server, backend server, watcher, preview, or local service. Use this instead of bash for commands that keep running. Returns a process id for process_status, process_logs, and process_stop.",
            input: StartInput,
            output: StartOutput,
            toModelOutput: ({ output }) => {
              const proc = output.process
              const waited = output.waited_for.length ? ` Waited for ${output.waited_for.join(", ")}.` : ""
              const readiness =
                output.waited_for.length === 0
                  ? "Started."
                  : output.ready
                    ? "Started and readiness check passed."
                    : "Started, but readiness check timed out."
              return [
                {
                  type: "text",
                  text: `${readiness}${waited}\nProcess ${proc.id}${proc.pid ? ` pid=${proc.pid}` : ""} status=${proc.status}\nLog: ${proc.log}`,
                },
              ]
            },
            execute: (input, context) =>
              Effect.gen(function* () {
                const target = yield* mutation.resolve({ path: input.workdir ?? ".", kind: "directory" })
                yield* approveExternal(permission, context, target.externalDirectory)
                if ((yield* fs.stat(target.canonical)).type !== "Directory")
                  return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.canonical}`))

                let log: string | undefined
                if (input.log) {
                  const logTarget = yield* mutation.resolve({ path: input.log, kind: "file" })
                  yield* approveExternal(permission, context, logTarget.externalDirectory)
                  log = logTarget.canonical
                }

                yield* permission.assert({
                  action: "bash",
                  resources: [commandResource(input.command, input.args)],
                  save: [commandResource(input.command, input.args)],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: source(context),
                })

                const proc = yield* processes.start({
                  command: input.command,
                  args: input.args,
                  cwd: target.canonical,
                  ...(input.name ? { name: input.name } : {}),
                  ...(input.env ? { env: input.env } : {}),
                  ...(log ? { log } : {}),
                })
                const waited: string[] = []
                const waitTimeout = input.wait_timeout ?? 10_000
                const checks: boolean[] = []
                if (input.wait_for_output) {
                  waited.push(`output '${input.wait_for_output}'`)
                  checks.push(yield* processes.waitForOutput(proc.id, input.wait_for_output, waitTimeout))
                }
                if (input.wait_for_port) {
                  const host = input.wait_for_host ?? "127.0.0.1"
                  waited.push(`port ${host}:${input.wait_for_port}`)
                  checks.push(yield* processes.waitForPort(input.wait_for_port, host, waitTimeout))
                }
                const ready = checks.every(Boolean)
                return {
                  process: (yield* processes.get(proc.id)) ?? proc,
                  ready,
                  wait_timed_out: waited.length > 0 && !ready,
                  waited_for: waited,
                }
              }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to start process: ${input.command}` }))),
          }),
          "bash",
        ),
        [statusName]: Tool.withPermission(
          Tool.make({
            description: "List managed processes or inspect one managed process by id.",
            input: StatusInput,
            output: StatusOutput,
            toModelOutput: ({ output }) => {
              if (output.processes.length === 0) return [{ type: "text", text: "No managed processes." }]
              return [
                {
                  type: "text",
                  text: output.processes
                    .map((proc) => `${proc.id} status=${proc.status}${proc.pid ? ` pid=${proc.pid}` : ""} ${proc.command}`)
                    .join("\n"),
                },
              ]
            },
            execute: (input) =>
              Effect.gen(function* () {
                if (!input.id) return { processes: yield* processes.list() }
                const proc = yield* processes.get(input.id)
                return { processes: proc ? [proc] : [] }
              }),
          }),
          "bash",
        ),
        [logsName]: Tool.withPermission(
          Tool.make({
            description: "Read the retained log output for a managed process.",
            input: LogsInput,
            output: LogsOutput,
            toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
            execute: (input) =>
              Effect.gen(function* () {
                const result = yield* processes.logs({
                  id: input.id,
                  lines: input.lines,
                  maxBytes: input.max_bytes,
                })
                if (!result) return yield* Effect.fail(new Error(`Unknown managed process: ${input.id}`))
                return {
                  id: result.id,
                  log: result.log,
                  output: result.output,
                  truncated: result.truncated,
                }
              }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to read process logs: ${input.id}` }))),
          }),
          "bash",
        ),
        [stopName]: Tool.withPermission(
          Tool.make({
            description: "Stop a managed process by id. Use this instead of pkill, killall, xargs kill, or port-kill pipelines.",
            input: StopInput,
            output: StopOutput,
            toModelOutput: ({ output }) => {
              if (!output.process) return [{ type: "text", text: "Unknown managed process." }]
              return [
                {
                  type: "text",
                  text: `${output.stopped ? "Stop signal sent" : "Process was not running"}: ${output.process.id} status=${output.process.status}`,
                },
              ]
            },
            execute: (input) =>
              Effect.gen(function* () {
                const proc = yield* processes.stop(input.id, input.signal, input.force_after_ms)
                return {
                  stopped: proc?.status === "running",
                  ...(proc ? { process: proc } : {}),
                }
              }),
          }),
          "bash",
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/process",
  layer,
  deps: [ToolRegistry.node, LocationMutation.node, FSUtil.node, PermissionV2.node, ManagedProcess.node],
})
