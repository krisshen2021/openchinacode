export * as ConfigCompaction from "./compaction"

import { Schema } from "effect"
import { NonNegativeInt } from "../schema"

export class Keep extends Schema.Class<Keep>("ConfigV2.Compaction.Keep")({
  tokens: NonNegativeInt.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Compaction")({
  auto: Schema.Boolean.pipe(Schema.optional),
  keep: Keep.pipe(Schema.optional),
  buffer: NonNegativeInt.pipe(Schema.optional),
}) {}

export type RetentionKey = "reasoning_retention_turns" | "tool_output_retention_turns" | "attachment_retention_turns"

// Retention windows are session-scoped only and live in
// session.metadata.compaction. A null value explicitly disables that window
// for the session; absent keys use the built-in default (master unlocked,
// every window off = full history kept).
export interface SessionOverride {
  retention_enabled?: boolean
  reasoning_retention_turns?: number | null
  tool_output_retention_turns?: number | null
  attachment_retention_turns?: number | null
}

export const sessionOverride = (metadata: Record<string, unknown> | undefined): SessionOverride => {
  const compaction = metadata?.["compaction"]
  if (typeof compaction !== "object" || compaction === null || Array.isArray(compaction)) return {}
  return compaction as SessionOverride
}

export const retentionMaster = (override: SessionOverride): boolean => override.retention_enabled !== false

export const retentionTurns = (key: RetentionKey, master: boolean, override: SessionOverride): number | undefined => {
  if (!master) return undefined
  const value = override[key]
  if (value === null) return undefined
  return value
}
