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
