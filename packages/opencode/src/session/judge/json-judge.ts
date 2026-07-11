import { ConfigTaskPolicy } from "@opencode-ai/core/config/task-policy"
import { Cause, Effect, Exit } from "effect"
import { generateText, type ModelMessage } from "ai"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Provider } from "@/provider/provider"
import { errorMessage } from "@/util/error"

export type JsonJudgeStatus = "disabled" | "unavailable" | "failed" | "valid" | "invalid"

export type JsonJudgeModel = {
  model: Provider.Model
  language: LanguageModelV3
}

export type JsonJudgeResult<T> = {
  status: JsonJudgeStatus
  decision?: T
  model?: Provider.Model
  elapsedMs?: number
  error?: string
  rawPreview?: string
}

export type RunJsonJudgeInput<T> = {
  name: string
  sessionID: string
  provider: Provider.Interface
  config?: ConfigTaskPolicy.Judge
  messages: ModelMessage[]
  parse: (text: string) => T | undefined
  modelCandidates: string[]
  currentModel?: Provider.Model
  includeCurrentModel?: boolean
  smallModelProviderID?: Provider.Model["providerID"]
  timeoutMs: number
  maxOutputTokens: number | ((model: Provider.Model) => number)
  abort?: AbortSignal
  log?: Record<string, unknown>
  onSelected?: (model: Provider.Model) => Effect.Effect<void>
}

export const DEFAULT_RAW_PREVIEW_CHARS = 1_200

export function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  if (fenced) return fenced
  const start = text.indexOf("{")
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === "{") depth++
    if (char === "}") {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
}

export function rawPreview(text: string, limit = DEFAULT_RAW_PREVIEW_CHARS) {
  const normalized = text.trim().replace(/\s+/g, " ")
  if (!normalized) return "(empty)"
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit - 3)}...`
}

function record(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function usageMetric(usage: unknown, key: string) {
  const value = record(usage)?.[key]
  return typeof value === "number" ? value : undefined
}

export function reasoningTokens(usage: unknown) {
  const direct = usageMetric(usage, "reasoningTokens")
  if (direct !== undefined) return direct
  const details = record(record(usage)?.outputTokenDetails)
  const value = details?.reasoningTokens
  return typeof value === "number" ? value : undefined
}

function configuredEnabled(config: ConfigTaskPolicy.Judge | undefined) {
  return config?.enabled !== false
}

export const selectJudgeModel = Effect.fn("JsonJudge.selectModel")(function* (input: {
  provider: Provider.Interface
  candidates: string[]
  currentModel?: Provider.Model
  includeCurrentModel?: boolean
  smallModelProviderID?: Provider.Model["providerID"]
}) {
  const seen = new Set<string>()
  const usable = Effect.fnUntraced(function* (model: Provider.Model | undefined) {
    if (!model) return undefined
    const key = `${model.providerID}/${model.id}`
    if (seen.has(key)) return undefined
    seen.add(key)
    const language = yield* input.provider.getLanguage(model).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
    return language ? { model, language } : undefined
  })

  if (input.includeCurrentModel) {
    const current = yield* usable(input.currentModel)
    if (current) return current
  }

  for (const candidate of input.candidates) {
    const parsed = Provider.parseModel(candidate)
    const model = yield* input.provider
      .getModel(parsed.providerID, parsed.modelID)
      .pipe(Effect.catchCause(() => Effect.succeed(undefined)))
    const selected = yield* usable(model)
    if (selected) return selected
  }

  if (input.smallModelProviderID) {
    const small = yield* input.provider
      .getSmallModel(input.smallModelProviderID)
      .pipe(Effect.catchCause(() => Effect.succeed(undefined)))
    const selected = yield* usable(small)
    if (selected) return selected
  }
})

export const runJsonJudge = Effect.fn("JsonJudge.run")(function* <T>(input: RunJsonJudgeInput<T>) {
  if (!configuredEnabled(input.config)) {
    return { status: "disabled", decision: undefined } satisfies JsonJudgeResult<T>
  }

  const candidateModels = input.config?.models?.length ? [...input.config.models] : input.modelCandidates
  const selected = yield* selectJudgeModel({
    provider: input.provider,
    candidates: candidateModels,
    currentModel: input.currentModel,
    includeCurrentModel: input.includeCurrentModel,
    smallModelProviderID: input.smallModelProviderID,
  })
  if (!selected) {
    yield* Effect.logWarning(`${input.name} judge unavailable`, {
      "session.id": input.sessionID,
      ...input.log,
    })
    return { status: "unavailable", decision: undefined } satisfies JsonJudgeResult<T>
  }
  if (input.onSelected) yield* input.onSelected(selected.model)

  const maxOutputTokens =
    input.config?.max_output_tokens ??
    (typeof input.maxOutputTokens === "function" ? input.maxOutputTokens(selected.model) : input.maxOutputTokens)
  const timeoutMs = input.config?.timeout_ms ?? input.timeoutMs
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs)
  const abort = () => ctrl.abort()
  if (input.abort?.aborted) ctrl.abort()
  else input.abort?.addEventListener("abort", abort, { once: true })

  const started = Date.now()
  try {
    const exit = yield* Effect.exit(
      Effect.tryPromise(() =>
        generateText({
          model: selected.language,
          maxOutputTokens,
          abortSignal: ctrl.signal,
          messages: input.messages,
        }),
      ),
    )
    const elapsedMs = Date.now() - started
    if (Exit.isFailure(exit)) {
      const message = errorMessage(Cause.squash(exit.cause))
      yield* Effect.logWarning(`${input.name} judge failed`, {
        "session.id": input.sessionID,
        providerID: selected.model.providerID,
        modelID: selected.model.id,
        elapsedMs,
        error: message,
        ...input.log,
      })
      return {
        status: "failed",
        decision: undefined,
        model: selected.model,
        elapsedMs,
        error: message,
      } satisfies JsonJudgeResult<T>
    }

    const raw = exit.value.text
    const decision = input.parse(raw)
    const status = decision ? "valid" : "invalid"
    const preview = decision ? undefined : rawPreview(raw)
    const usage = exit.value.usage
    yield* Effect.logInfo(`${input.name} judge`, {
      "session.id": input.sessionID,
      providerID: selected.model.providerID,
      modelID: selected.model.id,
      elapsedMs,
      decision: status,
      finishReason: exit.value.finishReason,
      maxOutputTokens,
      rawChars: raw.length,
      "usage.inputTokens": usageMetric(usage, "inputTokens"),
      "usage.outputTokens": usageMetric(usage, "outputTokens"),
      "usage.reasoningTokens": reasoningTokens(usage),
      "usage.totalTokens": usageMetric(usage, "totalTokens"),
      ...(preview ? { rawPreview: preview } : {}),
      ...input.log,
    })
    return {
      status,
      decision,
      model: selected.model,
      elapsedMs,
      ...(preview ? { rawPreview: preview, error: preview } : {}),
    } satisfies JsonJudgeResult<T>
  } finally {
    clearTimeout(timeout)
    input.abort?.removeEventListener("abort", abort)
  }
})

export * as JsonJudge from "./json-judge"
