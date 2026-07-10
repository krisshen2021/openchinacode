export * as ConfigTaskPolicy from "./task-policy"

import { Schema } from "effect"

export const TaskKinds = [
  "general",
  "plan",
  "architecture",
  "refactor",
  "review",
  "implement",
  "explore",
  "visual_check",
  "debug",
  "test_fix",
  "summarize",
  "compaction",
] as const

export const TaskKind = Schema.Literals(TaskKinds)
export type TaskKind = Schema.Schema.Type<typeof TaskKind>

export const TaskComplexities = ["quick", "medium", "complex"] as const

export const TaskComplexity = Schema.Literals(TaskComplexities)
export type TaskComplexity = Schema.Schema.Type<typeof TaskComplexity>

export const Route = Schema.Struct({
  model: Schema.optional(Schema.String).annotate({
    description: "Target model in provider/model format.",
  }),
  variant: Schema.optional(Schema.String).annotate({
    description: "Optional model variant to apply for this route.",
  }),
  inherit: Schema.optional(Schema.Boolean).annotate({
    description: "Inherit the parent model for this route. When true, model is ignored.",
  }),
}).annotate({ identifier: "TaskPolicyRoute" })
export type Route = Schema.Schema.Type<typeof Route>

const RouteMap = Schema.Record(Schema.String, Route)

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable OpenChinaCode task-to-model routing. Defaults to true.",
  }),
  routes: Schema.optional(RouteMap).annotate({
    description:
      "Global route table. Keys use kind or kind.complexity, for example { 'architecture.complex': { model: 'zhipuai-pay2go/glm-5.2', variant: 'max' } }.",
  }),
  agents: Schema.optional(Schema.Record(Schema.String, RouteMap)).annotate({
    description: "Per-subagent route table using the same kind or kind.complexity keys as routes.",
  }),
}).annotate({ identifier: "TaskPolicyConfig" })
export type Info = Schema.Schema.Type<typeof Info>
