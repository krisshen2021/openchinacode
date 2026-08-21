import type { Config } from "@/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000

export function usable(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  // Provider output policies (e.g. deepseek-v4's 131k default) can exceed a
  // small-context model's window; reserving the full policy output makes
  // `usable` 0 so every turn looks like an overflow and the session
  // auto-compacts forever. Bound the reservation to half the window so the
  // trigger always leaves real room while preserving output headroom.
  const reserved =
    input.cfg.compaction?.reserved ??
    Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
  if (input.model.limit.input) return Math.max(0, input.model.limit.input - reserved)
  const outputMax = ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax)
  return Math.max(0, context - Math.min(outputMax, Math.floor(context / 2)))
}

export function isOverflow(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
  return count >= usable(input)
}
