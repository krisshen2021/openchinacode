export * as ConfigTaskPolicy from "./task-policy"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

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

export const Judge = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable this judge. When omitted, each judge uses its built-in default.",
  }),
  models: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Ordered judge model candidates in provider/model format.",
  }),
  timeout_ms: Schema.optional(PositiveInt).annotate({
    description: "Judge timeout in milliseconds.",
  }),
  max_output_tokens: Schema.optional(PositiveInt).annotate({
    description: "Maximum tokens for the judge response.",
  }),
}).annotate({ identifier: "TaskPolicyJudge" })
export type Judge = Schema.Schema.Type<typeof Judge>

export const ExtraRouter = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Run a fast task router judge before ordinary user prompts. Defaults to false.",
  }),
  confidence_threshold: Schema.optional(Schema.Number).annotate({
    description: "Minimum confidence required to auto-delegate a subtask. Defaults to 0.7.",
  }),
  allow: Schema.optional(Schema.mutable(Schema.Array(TaskKind))).annotate({
    description: "Task kinds that the extra router may auto-delegate.",
  }),
  deny: Schema.optional(Schema.mutable(Schema.Array(TaskKind))).annotate({
    description: "Task kinds that the extra router must not auto-delegate.",
  }),
}).annotate({ identifier: "TaskPolicyExtraRouter" })
export type ExtraRouter = Schema.Schema.Type<typeof ExtraRouter>

export const Judges = Schema.Struct({
  auto_maxtokens: Schema.optional(Judge),
  compaction_profile: Schema.optional(Judge),
  task_router: Schema.optional(Judge),
}).annotate({ identifier: "TaskPolicyJudges" })
export type Judges = Schema.Schema.Type<typeof Judges>

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
  extra_router: Schema.optional(ExtraRouter).annotate({
    description: "Optional fast judge that can auto-delegate ordinary prompts before the primary model runs.",
  }),
  judges: Schema.optional(Judges).annotate({
    description: "Shared OpenChinaCode LLM judge configuration by judge task.",
  }),
}).annotate({ identifier: "TaskPolicyConfig" })
export type Info = Schema.Schema.Type<typeof Info>
