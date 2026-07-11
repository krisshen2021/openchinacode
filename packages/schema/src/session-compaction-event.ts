export * as SessionCompactionEvent from "./session-compaction-event"

import { Event } from "./event"
import { optional } from "./schema"
import { SessionID } from "./session-id"
import { Schema } from "effect"

export const Compacted = Event.define({
  type: "session.compacted",
  schema: {
    sessionID: SessionID,
  },
})

export const Progress = Event.define({
  type: "session.compaction.progress",
  schema: {
    sessionID: SessionID,
    stage: Schema.Literals([
      "started",
      "route",
      "strategy",
      "retention",
      "judge_started",
      "judge_result",
      "profile_ready",
      "active_task",
      "active_task_extract_started",
      "active_task_extract_result",
      "selection",
      "summary_started",
      "summary_finished",
      "summary_failed",
    ]),
    message: Schema.String,
    model: optional(
      Schema.Struct({
        providerID: Schema.String,
        modelID: Schema.String,
        variant: optional(Schema.String),
      }),
    ),
    judge: optional(
      Schema.Struct({
        status: Schema.Literals(["valid", "invalid", "failed", "unavailable", "skipped"]),
        providerID: optional(Schema.String),
        modelID: optional(Schema.String),
        elapsedMs: optional(Schema.Finite),
        error: optional(Schema.String),
      }),
    ),
    profile: optional(
      Schema.Struct({
        source: Schema.Literals(["llm", "heuristic", "fallback"]),
        risk: Schema.Literals(["low", "medium", "high"]),
        profiles: Schema.Array(
          Schema.Struct({
            type: Schema.String,
            weight: Schema.Finite,
          }),
        ),
        mustPreserve: Schema.Array(Schema.String),
      }),
    ),
  },
})

export const Definitions = Event.inventory(Compacted, Progress)
