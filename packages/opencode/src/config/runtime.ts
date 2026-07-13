import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Context, Effect, Layer, Schema } from "effect"
import * as InstanceState from "@/effect/instance-state"

export const TaskPolicyRuntimePatch = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  extra_router_enabled: Schema.optional(Schema.Boolean),
})

export const TaskPolicyRuntimeResult = Schema.Struct({
  task_policy: Schema.Struct({
    enabled: Schema.optional(Schema.Boolean),
    extra_router: Schema.optional(
      Schema.Struct({
        enabled: Schema.optional(Schema.Boolean),
      }),
    ),
  }),
})

export type TaskPolicyRuntimePatch = typeof TaskPolicyRuntimePatch.Type

type Override = {
  taskPolicyEnabled?: boolean
  taskPolicyExtraRouterEnabled?: boolean
}

export interface Interface {
  readonly get: () => Effect.Effect<Override>
  readonly patchTaskPolicy: (patch: TaskPolicyRuntimePatch) => Effect.Effect<Override>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ConfigRuntime") {}

function clean(input: Override) {
  const next: Override = {}
  if (input.taskPolicyEnabled !== undefined) next.taskPolicyEnabled = input.taskPolicyEnabled
  if (input.taskPolicyExtraRouterEnabled !== undefined) next.taskPolicyExtraRouterEnabled = input.taskPolicyExtraRouterEnabled
  return next
}

function empty(input: Override) {
  return input.taskPolicyEnabled === undefined && input.taskPolicyExtraRouterEnabled === undefined
}

export function applyTaskPolicyOverride(config: ConfigV1.Info, override: Override): ConfigV1.Info {
  if (empty(override)) return config

  const taskPolicy = { ...(config.task_policy ?? {}) }
  if (override.taskPolicyEnabled !== undefined) taskPolicy.enabled = override.taskPolicyEnabled
  if (override.taskPolicyExtraRouterEnabled !== undefined) {
    taskPolicy.extra_router = {
      ...(taskPolicy.extra_router ?? {}),
      enabled: override.taskPolicyExtraRouterEnabled,
    }
  }
  return {
    ...config,
    task_policy: taskPolicy,
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const overrides = new Map<string, Override>()

    const get = Effect.fn("ConfigRuntime.get")(function* () {
      return overrides.get(yield* InstanceState.directory) ?? {}
    })

    const patchTaskPolicy = Effect.fn("ConfigRuntime.patchTaskPolicy")(function* (patch: TaskPolicyRuntimePatch) {
      const directory = yield* InstanceState.directory
      const next = clean({
        ...(overrides.get(directory) ?? {}),
        ...(patch.enabled !== undefined ? { taskPolicyEnabled: patch.enabled } : {}),
        ...(patch.extra_router_enabled !== undefined
          ? { taskPolicyExtraRouterEnabled: patch.extra_router_enabled }
          : {}),
      })
      if (empty(next)) overrides.delete(directory)
      else overrides.set(directory, next)
      return next
    })

    return Service.of({
      get,
      patchTaskPolicy,
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as ConfigRuntime from "./runtime"
