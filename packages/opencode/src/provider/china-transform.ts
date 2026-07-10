import type * as Provider from "./provider"

type Family = "glm" | "kimi" | "deepseek"

const TEXT_SCAN_LIMIT = 200_000
const LARGE_CONTEXT_CHARS = 50_000
const GLM_SERIES_OUTPUT_MAX = 131_072
const GLM_SERIES_OUTPUT_DEFAULT = 65_536
const GLM_45_OUTPUT_MAX = 98_304
const GLM_46V_OUTPUT_DEFAULT = 16_384
const GLM_VISION_OUTPUT_MAX = 32_768
const GLM_LEGACY_OUTPUT_MAX = 16_384
const KIMI_K2_CODE_OUTPUT_DEFAULT = 32_768
const DEEPSEEK_V4_OUTPUT_MAX = 393_216
const DEEPSEEK_V4_OUTPUT_DEFAULT = 131_072

type OutputPolicy = {
  default: number
  max: number
}

export type AutoMaxTokensMode = "off" | "heuristic" | "llm"

export type AutoMaxTokensConfig =
  | boolean
  | AutoMaxTokensMode
  | {
      mode?: AutoMaxTokensMode | "on" | "enable" | "enabled" | "disable" | "disabled"
      model?: string
      timeout_ms?: number
      timeoutMs?: number
    }

export type MaxOutputTokensInput = {
  model: Provider.Model
  outputTokenMax?: number
  messages?: readonly unknown[]
  variant?: string
  autoMaxTokens?: AutoMaxTokensConfig
  agentMode?: string
  toolCount?: number
}

export type MaxOutputDecision = {
  tokens?: number
  level: "default" | "max"
  mode: AutoMaxTokensMode
  reasons: string[]
  needsJudge: boolean
  policy?: OutputPolicy
}

export type AutoMaxTokensResolved = {
  mode: AutoMaxTokensMode
  model?: string
  timeoutMs: number
}

function ids(model: Provider.Model, bodyModel?: string) {
  return {
    id: String(model.id ?? "").toLowerCase(),
    api: String(model.api?.id ?? "").toLowerCase(),
    body: bodyModel?.toLowerCase() ?? "",
    provider: String(model.providerID ?? "").toLowerCase(),
  }
}

function text(model: Provider.Model, bodyModel?: string) {
  const modelIDs = ids(model, bodyModel)
  return `${modelIDs.provider}/${modelIDs.id}/${modelIDs.api}/${modelIDs.body}`
}

function includesAny(value: string, parts: string[]) {
  return parts.some((part) => value.includes(part))
}

export function normalizeAutoMaxTokens(config?: AutoMaxTokensConfig): AutoMaxTokensResolved {
  const fallback = { mode: "heuristic" as const, timeoutMs: 1_000 }
  if (config === undefined || config === true) return fallback
  if (config === false) return { ...fallback, mode: "off" }
  if (typeof config === "string") {
    if (config === "off") return { ...fallback, mode: "off" }
    if (config === "llm") return { ...fallback, mode: "llm" }
    return fallback
  }

  const mode = (() => {
    switch (config.mode) {
      case "off":
      case "disable":
      case "disabled":
        return "off" as const
      case "llm":
        return "llm" as const
      case "on":
      case "enable":
      case "enabled":
      case "heuristic":
      case undefined:
        return "heuristic" as const
    }
  })()
  const timeoutMs = config.timeout_ms ?? config.timeoutMs ?? fallback.timeoutMs
  return {
    mode,
    model: config.model,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 5_000) : fallback.timeoutMs,
  }
}

export function family(model: Provider.Model, bodyModel?: string): Family | undefined {
  const id = text(model, bodyModel)
  if (includesAny(id, ["glm-", "zhipuai", "zai"])) return "glm"
  if (includesAny(id, ["kimi-", "moonshot", "k2p"])) return "kimi"
  if (includesAny(id, ["deepseek"])) return "deepseek"
  return undefined
}

export function isChinaModel(model: Provider.Model): boolean {
  return family(model) !== undefined
}

function isOpenAICompatible(model: Provider.Model) {
  return model.api.npm === "@ai-sdk/openai-compatible"
}

function isGLM52(model: Provider.Model) {
  const id = text(model)
  return includesAny(id, ["glm-5.2", "glm-5-2", "glm-5p2"])
}

function isGLMVision(model: Provider.Model, bodyModel?: string) {
  const id = text(model, bodyModel)
  return includesAny(id, ["glm-5v", "glm-5-v", "glm-4.6v", "glm-4.5v"])
}

function isKimiK27OrNewer(model: Provider.Model, bodyModel?: string) {
  const id = text(model, bodyModel)
  return includesAny(id, ["kimi-k2.7-code", "kimi-k2-7-code", "k2p7"])
}

function deepseekThinkingDefault(model: Provider.Model, bodyModel?: string) {
  const id = text(model, bodyModel)
  if (id.includes("deepseek-chat")) return false
  if (includesAny(id, ["deepseek-v4", "deepseek-reasoner", "deepseek-r1"])) return true
  return false
}

export function temperature(model: Provider.Model): number | undefined {
  if (family(model)) return undefined
  return undefined
}

export function topP(model: Provider.Model): number | undefined {
  if (family(model)) return undefined
  return undefined
}

export function topK(_model: Provider.Model): number | undefined {
  return undefined
}

function officialOutputPolicy(model: Provider.Model): OutputPolicy | undefined {
  const id = text(model)

  switch (family(model)) {
    case "glm":
      if (includesAny(id, ["glm-5v", "glm-5-v"])) {
        return { default: GLM_SERIES_OUTPUT_DEFAULT, max: GLM_SERIES_OUTPUT_MAX }
      }
      if (includesAny(id, ["glm-4.6v"])) {
        return { default: GLM_46V_OUTPUT_DEFAULT, max: GLM_VISION_OUTPUT_MAX }
      }
      if (includesAny(id, ["glm-4.5v", "glm-4-32b-0414-128k"])) {
        return { default: GLM_LEGACY_OUTPUT_MAX, max: GLM_LEGACY_OUTPUT_MAX }
      }
      if (includesAny(id, ["glm-4.5"])) return { default: GLM_SERIES_OUTPUT_DEFAULT, max: GLM_45_OUTPUT_MAX }
      if (includesAny(id, ["glm-5", "glm-4.7", "glm-4.6"])) {
        return { default: GLM_SERIES_OUTPUT_DEFAULT, max: GLM_SERIES_OUTPUT_MAX }
      }
      return undefined

    case "kimi":
      if (includesAny(id, ["kimi-k2.7", "kimi-k2-7", "kimi-k2.6", "kimi-k2-6", "kimi-k2.5", "kimi-k2-5", "k2p"])) {
        return { default: KIMI_K2_CODE_OUTPUT_DEFAULT, max: KIMI_K2_CODE_OUTPUT_DEFAULT }
      }
      return undefined

    case "deepseek":
      if (includesAny(id, ["deepseek-v4", "deepseek-chat", "deepseek-reasoner"])) {
        return { default: DEEPSEEK_V4_OUTPUT_DEFAULT, max: DEEPSEEK_V4_OUTPUT_MAX }
      }
      return undefined
  }
}

function appendText(value: unknown, output: string[], depth = 0) {
  if (output.join("").length >= TEXT_SCAN_LIMIT || depth > 6) return

  if (typeof value === "string") {
    if (!value.startsWith("data:")) output.push(value)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) appendText(item, output, depth + 1)
    return
  }

  if (typeof value !== "object" || value === null) return

  const record = value as Record<string, unknown>
  for (const key of ["text", "content", "value", "output"]) {
    if (key in record) appendText(record[key], output, depth + 1)
  }
}

function messageText(messages: readonly unknown[] | undefined) {
  if (!messages) return ""
  const output: string[] = []
  appendText(messages, output)
  return output.join("\n").slice(0, TEXT_SCAN_LIMIT)
}

function lastUserIndex(messages: readonly unknown[] | undefined) {
  if (!messages) return -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i]
    if (typeof item === "object" && item !== null && (item as { role?: unknown }).role === "user") return i
  }
  return -1
}

function currentTurnMessages(messages: readonly unknown[] | undefined) {
  if (!messages) return undefined
  const index = lastUserIndex(messages)
  return index >= 0 ? messages.slice(index) : messages.slice(-4)
}

function latestUserText(messages: readonly unknown[] | undefined) {
  const index = lastUserIndex(messages)
  return index >= 0 ? messageText([messages![index]]) : ""
}

const LONG_OUTPUT_RE =
  /完整|全部|全量|详尽|不要省略|不要截断|逐(行|段|项)|生成完整|完整代码|完整文件|完整实现|完整方案|长文|长报告|继续输出|接着输出|full|complete|comprehensive|detailed|entire|no omission|do not omit|do not truncate|continue output/i
const CODING_INTENT_RE =
  /修复|修正|修一下|改一下|修改|改造|重构|实现|新增|添加|接入|适配|优化|性能|测试|单测|构建|编译|报错|错误|异常|失败|诊断|模型参数|架构|迁移|provider|api|cli|tui|bug|fix|fixed|refactor|implement|feature|error|exception|failed|failure|test|typecheck|build|compile|diagnostic|optimi[sz]e|performance|migrat|adapter/i
const CODE_BLOCK_RE = /```|~~~/
const FILE_PATH_RE =
  /(^|[\s`'"])(\.{0,2}\/)?[\w@.-]+\/[\w@./-]+\.(ts|tsx|js|jsx|json|jsonc|md|py|go|rs|java|kt|swift|css|scss|html|vue|svelte|yaml|yml|toml|sh|bash|zsh|fish|sql|proto|graphql|lock)\b/i
const DIFF_RE = /(^|\n)(diff --git|@@\s|[+-]{3}\s|Index: )/i
const ERROR_RE =
  /\b(error|exception|traceback|stack trace|failed|failure|diagnostic|typeerror|referenceerror|syntaxerror|build failed|test failed)\b|报错|错误|异常|失败|诊断|红色|编译不过|测试不过/i
const PLAIN_QUESTION_RE =
  /^(什么是|解释|说明|介绍|我想知道|为什么|怎么理解|what is|explain|describe|tell me about|how does)/i

function localMaxSignals(input: MaxOutputTokensInput) {
  const reasons: string[] = []
  const variant = input.variant?.toLowerCase()
  if (variant && ["max", "deep", "long", "xhigh"].includes(variant))
    return { useMax: true, needsJudge: false, reasons: ["variant"] }

  if (isGLMVision(input.model)) return { useMax: false, needsJudge: false, reasons: ["vision-default"] }

  const allText = messageText(input.messages)
  if (allText.length >= LARGE_CONTEXT_CHARS) return { useMax: true, needsJudge: false, reasons: ["large-context"] }

  const userText = latestUserText(input.messages).trim()
  const turnText = messageText(currentTurnMessages(input.messages))

  if (LONG_OUTPUT_RE.test(userText)) return { useMax: true, needsJudge: false, reasons: ["long-output-intent"] }

  let score = 0
  if (CODING_INTENT_RE.test(userText)) {
    score += 3
    reasons.push("coding-intent")
  }
  if (CODE_BLOCK_RE.test(userText)) {
    score += 2
    reasons.push("code-block")
  }
  if (FILE_PATH_RE.test(userText)) {
    score += 1
    reasons.push("file-path")
  }
  if (DIFF_RE.test(turnText)) {
    score += 2
    reasons.push("diff")
  }
  if (ERROR_RE.test(turnText)) {
    score += 2
    reasons.push("diagnostic-or-error")
  }
  if (input.agentMode === "build" && (input.toolCount ?? 0) > 0) {
    reasons.push("build-tools")
  }

  const plainQuestion = PLAIN_QUESTION_RE.test(userText) && score < 2
  if (score >= 2 && !plainQuestion) return { useMax: true, needsJudge: false, reasons }

  const mode = normalizeAutoMaxTokens(input.autoMaxTokens).mode
  const needsJudge =
    mode === "llm" &&
    !plainQuestion &&
    score > 0 &&
    (userText.length > 40 || input.agentMode === "build" || (input.toolCount ?? 0) > 0)
  return { useMax: false, needsJudge, reasons: reasons.length ? reasons : ["default"] }
}

export function maxOutputDecision(input: MaxOutputTokensInput): MaxOutputDecision | undefined {
  if (!family(input.model)) return undefined

  const policy = officialOutputPolicy(input.model)
  if (input.outputTokenMax !== undefined) {
    const tokens = policy ? Math.min(input.outputTokenMax, policy.max) : input.outputTokenMax
    return {
      tokens,
      level: policy && tokens >= policy.max ? "max" : "default",
      mode: normalizeAutoMaxTokens(input.autoMaxTokens).mode,
      reasons: ["explicit-output-token-max"],
      needsJudge: false,
      policy,
    }
  }

  if (!policy) return undefined

  const auto = normalizeAutoMaxTokens(input.autoMaxTokens)
  if (auto.mode === "off") {
    return {
      tokens: policy.default,
      level: "default",
      mode: auto.mode,
      reasons: ["auto-maxtokens-off"],
      needsJudge: false,
      policy,
    }
  }

  const signals = localMaxSignals(input)
  return {
    tokens: signals.useMax ? policy.max : policy.default,
    level: signals.useMax ? "max" : "default",
    mode: auto.mode,
    reasons: signals.reasons,
    needsJudge: signals.needsJudge,
    policy,
  }
}

export function maxOutputTokens(input: MaxOutputTokensInput): number | undefined {
  return maxOutputDecision(input)?.tokens
}

export function options(input: { model: Provider.Model; sessionID: string }): Record<string, any> | undefined {
  if (!isOpenAICompatible(input.model)) return undefined

  switch (family(input.model)) {
    case "glm":
      return {
        thinking: {
          type: "enabled",
          clear_thinking: true,
        },
        ...(isGLM52(input.model) ? { reasoningEffort: "high" } : {}),
      }

    case "kimi":
      return {
        thinking: {
          type: "enabled",
          keep: "all",
        },
        prompt_cache_key: input.sessionID,
      }

    case "deepseek":
      if (!deepseekThinkingDefault(input.model)) return undefined
      return {
        thinking: {
          type: "enabled",
        },
      }
  }
}

export function variants(model: Provider.Model): Record<string, Record<string, any>> | undefined {
  if (!model.capabilities.reasoning || !isOpenAICompatible(model)) return undefined

  if (isGLM52(model)) {
    return {
      none: { reasoningEffort: "none" },
      high: { reasoningEffort: "high" },
      max: { reasoningEffort: "max" },
    }
  }

  if (family(model) === "deepseek" && text(model).includes("deepseek-v4")) {
    return {
      none: { thinking: { type: "disabled" } },
      high: { thinking: { type: "enabled" }, reasoningEffort: "high" },
      max: { thinking: { type: "enabled" }, reasoningEffort: "max" },
    }
  }

  return undefined
}

function removeSamplingFields(body: Record<string, any>) {
  delete body.temperature
  delete body.top_p
  delete body.presence_penalty
  delete body.frequency_penalty
}

export function rewriteRequestBody(model: Provider.Model, body: Record<string, any>): Record<string, any> {
  const bodyModel = typeof body.model === "string" ? body.model : undefined
  const current = family(model, bodyModel)
  if (!current) return body

  const result = { ...body }

  if (current === "glm") {
    if (result.temperature !== undefined && result.top_p !== undefined) {
      delete result.top_p
    }
    return result
  }

  if (current === "kimi") {
    removeSamplingFields(result)
    delete result.n

    if (result.max_tokens !== undefined) {
      result.max_completion_tokens = result.max_tokens
      delete result.max_tokens
    }

    if (isKimiK27OrNewer(model, bodyModel)) {
      result.thinking = {
        ...(typeof result.thinking === "object" && result.thinking !== null ? result.thinking : {}),
        type: "enabled",
        keep: "all",
      }
    }

    if (result.tool_choice !== undefined && result.tool_choice !== "auto" && result.tool_choice !== "none") {
      result.tool_choice = "auto"
    }

    return result
  }

  const thinkingEnabled =
    typeof result.thinking === "object" && result.thinking !== null
      ? result.thinking.type !== "disabled"
      : deepseekThinkingDefault(model, bodyModel)
  if (thinkingEnabled) {
    removeSamplingFields(result)
  }

  return result
}

export function shouldPreserveReasoningForMessage(model: Provider.Model, content: unknown): boolean {
  if (family(model) === "kimi") return true
  if (family(model) !== "deepseek") return true
  if (!Array.isArray(content)) return false
  return content.some(
    (part) => typeof part === "object" && part !== null && (part as { type?: string }).type === "tool-call",
  )
}

export const ChinaTransform = {
  family,
  isChinaModel,
  temperature,
  topP,
  topK,
  normalizeAutoMaxTokens,
  maxOutputDecision,
  maxOutputTokens,
  options,
  variants,
  rewriteRequestBody,
  shouldPreserveReasoningForMessage,
}
