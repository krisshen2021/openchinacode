import { realpathSync } from "node:fs"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { ManagedProcess } from "@opencode-ai/core/managed-process"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { ProcessTool } from "@opencode-ai/core/tool/process"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_process_tool_test")
const assertions: PermissionV2.AssertInput[] = []

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const reset = () => {
  assertions.length = 0
}

const withTool = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, LocationMutation.node, ProcessTool.node]),
        [
          [Location.node, activeLocation],
          [PermissionV2.node, permission],
          [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
        ],
      ),
    ),
  )
}

const call = (name: string, input: unknown, id = `call-${name}`) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name, input },
})

const it = testEffect(Layer.empty)

describe("ProcessTool", () => {
  it.live("registers managed process tools", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            const definitions = yield* toolDefinitions(registry)
            expect(definitions.map((tool) => tool.name)).toEqual([
              "process_start",
              "process_status",
              "process_logs",
              "process_stop",
            ])
            expect(yield* toolDefinitions(registry, [{ action: "bash", resource: "*", effect: "deny" }])).toEqual([])
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  if (process.platform !== "win32") {
    it.live("starts, observes logs, and stops a managed process", () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => {
          reset()
          return withTool(tmp.path, (registry) =>
            Effect.gen(function* () {
              const started = yield* settleTool(
                registry,
                call("process_start", {
                  command: "/bin/sh",
                  args: ["-c", "echo ready; sleep 30"],
                  name: "process-tool-test",
                  wait_for_output: "ready",
                  wait_timeout: 5_000,
                }),
              )
              const startOutput = started.output?.structured as {
                process: typeof ManagedProcess.Info.Type
                ready: boolean
              }
              expect(started.result).toMatchObject({
                type: "text",
                value: expect.stringContaining("readiness check passed"),
              })
              expect(startOutput.ready).toBe(true)
              expect(startOutput.process.cwd).toBe(realpathSync(tmp.path))
              expect(assertions).toMatchObject([
                {
                  sessionID,
                  action: "bash",
                  resources: ["/bin/sh -c 'echo ready; sleep 30'"],
                },
              ])

              const logged = yield* settleTool(
                registry,
                call("process_logs", { id: startOutput.process.id, lines: 10 }),
              )
              expect(logged.output?.structured).toMatchObject({
                id: startOutput.process.id,
                truncated: false,
              })
              expect(logged.output?.content[0]).toMatchObject({
                type: "text",
                text: expect.stringContaining("ready"),
              })

              const running = yield* settleTool(registry, call("process_status", { id: startOutput.process.id }))
              expect(running.output?.structured).toMatchObject({
                processes: [{ id: startOutput.process.id, status: "running" }],
              })

              const stopped = yield* settleTool(registry, call("process_stop", { id: startOutput.process.id }))
              expect(stopped.output?.structured).toMatchObject({
                stopped: true,
                process: { id: startOutput.process.id },
              })

              yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 250)))
              const status = yield* settleTool(registry, call("process_status", { id: startOutput.process.id }))
              expect(status.output?.structured).toMatchObject({
                processes: [{ id: startOutput.process.id, status: "stopped" }],
              })
            }),
          )
        },
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ),
    )
  }
})
