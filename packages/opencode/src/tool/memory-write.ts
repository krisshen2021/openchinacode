import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./memory-write.txt"
import { SessionMemory } from "@opencode-ai/core/session/memory"

const DecisionInput = Schema.Struct({
  decision: Schema.String,
  rationale: Schema.String,
  rejected: Schema.optional(Schema.Array(Schema.String)),
})
const PitfallInput = Schema.Struct({
  trap: Schema.String,
  why: Schema.String,
  workaround: Schema.String,
})

export const Parameters = Schema.Struct({
  objective: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Literals([...SessionMemory.STATUS])),
  kind: Schema.optional(Schema.Literals([...SessionMemory.KIND])),
  files: Schema.optional(Schema.Array(SessionMemory.FileEntry)),
  verified: Schema.optional(Schema.Array(Schema.String)),
  failures: Schema.optional(Schema.Array(SessionMemory.FailureEntry)),
  next_actions: Schema.optional(Schema.Array(Schema.String)),
  open_questions: Schema.optional(Schema.Array(SessionMemory.QuestionEntry)),
  decisions: Schema.optional(Schema.Array(DecisionInput)),
  constraints: Schema.optional(Schema.Array(Schema.String)),
  pitfalls: Schema.optional(Schema.Array(PitfallInput)),
  milestones: Schema.optional(Schema.Array(Schema.String)),
})

type Metadata = Record<string, never>

export const MemoryWriteTool = Tool.define<typeof Parameters, Metadata, SessionMemory.Service>(
  "memory_write",
  Effect.gen(function* () {
    const memory = yield* SessionMemory.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const now = Date.now()
          const content = yield* memory.append({
            sessionID: ctx.sessionID,
            state: {
              ...(params.objective !== undefined ? { objective: params.objective } : {}),
              ...(params.status !== undefined ? { status: params.status } : {}),
              ...(params.kind !== undefined ? { kind: params.kind } : {}),
              ...(params.files !== undefined ? { files: [...params.files] } : {}),
              ...(params.verified !== undefined ? { verified: [...params.verified] } : {}),
              ...(params.failures !== undefined ? { failures: [...params.failures] } : {}),
              ...(params.next_actions !== undefined ? { next_actions: [...params.next_actions] } : {}),
              ...(params.open_questions !== undefined ? { open_questions: [...params.open_questions] } : {}),
            },
            log: {
              decisions: (params.decisions ?? []).map((d) => ({
                decision: d.decision,
                rationale: d.rationale,
                rejected: d.rejected ?? [],
                at: now,
              })),
              constraints: params.constraints ?? [],
              pitfalls: (params.pitfalls ?? []).map((p) => ({ ...p, at: now })),
              milestones: params.milestones ?? [],
            },
          })
          return {
            title: "memory updated",
            output: SessionMemory.render(content),
            metadata: {},
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
