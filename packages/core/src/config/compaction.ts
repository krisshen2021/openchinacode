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
  // Master gate for the three retention windows below. Default on (absent);
  // false makes every *_retention_turns setting inert without deleting it.
  retention_enabled: Schema.Boolean.pipe(Schema.optional),
  reasoning_retention_turns: NonNegativeInt.pipe(Schema.optional),
  tool_output_retention_turns: NonNegativeInt.pipe(Schema.optional),
  attachment_retention_turns: NonNegativeInt.pipe(Schema.optional),
}) {}

export type RetentionKey = "reasoning_retention_turns" | "tool_output_retention_turns" | "attachment_retention_turns"

// Per-session overrides live in session.metadata.compaction. An absent key
// inherits the global config value; null explicitly disables the window for
// that session even when a global value is configured.
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

export interface RetentionConfig {
  retention_enabled?: boolean
  reasoning_retention_turns?: number
  tool_output_retention_turns?: number
  attachment_retention_turns?: number
}

export const retentionMaster = (global: RetentionConfig | undefined, override: SessionOverride): boolean =>
  (override.retention_enabled ?? global?.retention_enabled) !== false

export const retentionTurns = (
  key: RetentionKey,
  master: boolean,
  global: RetentionConfig | undefined,
  override: SessionOverride,
): number | undefined => {
  if (!master) return undefined
  const value = override[key]
  if (value === null) return undefined
  return value ?? global?.[key]
}
