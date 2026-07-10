import type { ModelMessage, Tool } from "ai"
import type { Provider } from "@/provider/provider"
import type { ProviderTransform } from "@/provider/transform"
import { Token } from "@/util/token"

const DEFAULT_SAFETY_BUFFER = 20_000
const MIN_DEFAULT_OUTPUT = 8_192
const MIN_MAX_OUTPUT = 32_768
const MEDIA_ESTIMATE_CHARS = 8_192
const BASE64_SCAN_CHARS = 4_096

type OutputLevel = "default" | "max"

export type BudgetResult =
  | {
      action: "use"
      maxOutputTokens: number | undefined
      promptTokens: number
      availableOutputTokens: number | undefined
      minUsefulOutputTokens: number | undefined
      clamped: boolean
    }
  | {
      action: "compact"
      promptTokens: number
      availableOutputTokens: number
      minUsefulOutputTokens: number
      targetOutputTokens: number
      reason: "input-limit" | "output-budget"
    }

function isDataUrl(value: string) {
  return /^data:[^;,]+;base64,/i.test(value)
}

function isProbablyBase64(value: string) {
  if (value.length < BASE64_SCAN_CHARS) return false
  const sample = value.slice(0, BASE64_SCAN_CHARS)
  return /^[A-Za-z0-9+/=_-]+$/.test(sample)
}

function mediaEstimatePlaceholder(value: string) {
  const mime = value.match(/^data:([^;,]+);base64,/i)?.[1] ?? "application/octet-stream"
  return `[media payload omitted for token estimate: ${mime}, ${value.length} base64 chars]\n${"x".repeat(MEDIA_ESTIMATE_CHARS)}`
}

function normalizeForEstimate(value: unknown, key = "", depth = 0): unknown {
  if (depth > 12) return "[nested value omitted for token estimate]"

  if (typeof value === "string") {
    if (isDataUrl(value)) return mediaEstimatePlaceholder(value)
    if (["data", "blob", "image"].includes(key) && isProbablyBase64(value)) return mediaEstimatePlaceholder(value)
    return value
  }

  if (Array.isArray(value)) return value.map((item) => normalizeForEstimate(item, "", depth + 1))
  if (typeof value !== "object" || value === null) return value

  const output: Record<string, unknown> = {}
  for (const [nextKey, nextValue] of Object.entries(value)) {
    output[nextKey] = normalizeForEstimate(nextValue, nextKey, depth + 1)
  }
  return output
}

function estimatePrompt(input: { messages: readonly ModelMessage[]; tools: Record<string, Tool> }) {
  const normalized = normalizeForEstimate({ messages: input.messages, tools: input.tools })
  try {
    return Token.estimate(JSON.stringify(normalized))
  } catch {
    return Token.estimate(JSON.stringify(normalizeForEstimate(input.messages)))
  }
}

function minUsefulOutputTokens(input: {
  targetOutputTokens: number
  level?: OutputLevel
  outputDecision?: ProviderTransform.MaxOutputDecision
}) {
  const target = Math.max(0, Math.floor(input.targetOutputTokens))
  if (target <= 0) return 0

  if (input.level === "max") {
    const policyDefault = input.outputDecision?.policy?.default
    const policyFloor = policyDefault ? Math.floor(policyDefault * 0.5) : 0
    return Math.min(target, Math.max(MIN_MAX_OUTPUT, policyFloor))
  }

  if (input.level === "default") {
    return Math.min(target, Math.max(MIN_DEFAULT_OUTPUT, Math.floor(target * 0.25)))
  }

  return Math.min(target, Math.max(4_096, Math.floor(target * 0.25)))
}

export function apply(input: {
  model: Provider.Model
  messages: readonly ModelMessage[]
  tools: Record<string, Tool>
  maxOutputTokens: number | undefined
  outputDecision?: ProviderTransform.MaxOutputDecision
  outputLevel?: OutputLevel
  promptTokens?: number
  safetyBuffer?: number
}): BudgetResult {
  const promptTokens = input.promptTokens ?? estimatePrompt({ messages: input.messages, tools: input.tools })
  const context = input.model.limit.context
  if (!Number.isFinite(context) || context <= 0) {
    return {
      action: "use",
      maxOutputTokens: input.maxOutputTokens,
      promptTokens,
      availableOutputTokens: undefined,
      minUsefulOutputTokens: undefined,
      clamped: false,
    }
  }

  const safetyBuffer = Math.max(0, Math.floor(input.safetyBuffer ?? DEFAULT_SAFETY_BUFFER))
  const inputLimit = input.model.limit.input
  if (inputLimit !== undefined && inputLimit > 0 && promptTokens + safetyBuffer >= inputLimit) {
    return {
      action: "compact",
      promptTokens,
      availableOutputTokens: Math.max(0, inputLimit - promptTokens - safetyBuffer),
      minUsefulOutputTokens: MIN_DEFAULT_OUTPUT,
      targetOutputTokens: input.maxOutputTokens ?? 0,
      reason: "input-limit",
    }
  }

  const targetOutputTokens =
    input.maxOutputTokens === undefined ? undefined : Math.max(0, Math.floor(input.maxOutputTokens))
  if (targetOutputTokens === undefined || targetOutputTokens <= 0) {
    return {
      action: "use",
      maxOutputTokens: input.maxOutputTokens,
      promptTokens,
      availableOutputTokens: Math.max(0, context - promptTokens - safetyBuffer),
      minUsefulOutputTokens: undefined,
      clamped: false,
    }
  }

  const availableOutputTokens = Math.max(0, Math.floor(context - promptTokens - safetyBuffer))
  const minUseful = minUsefulOutputTokens({
    targetOutputTokens,
    level: input.outputLevel ?? input.outputDecision?.level,
    outputDecision: input.outputDecision,
  })

  if (availableOutputTokens < minUseful) {
    return {
      action: "compact",
      promptTokens,
      availableOutputTokens,
      minUsefulOutputTokens: minUseful,
      targetOutputTokens,
      reason: "output-budget",
    }
  }

  const finalMaxOutputTokens = Math.min(targetOutputTokens, availableOutputTokens)
  return {
    action: "use",
    maxOutputTokens: finalMaxOutputTokens,
    promptTokens,
    availableOutputTokens,
    minUsefulOutputTokens: minUseful,
    clamped: finalMaxOutputTokens < targetOutputTokens,
  }
}
