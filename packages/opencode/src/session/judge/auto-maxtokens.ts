import { ConfigTaskPolicy } from "@opencode-ai/core/config/task-policy"
import { Effect } from "effect"
import type { ModelMessage } from "ai"
import type { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { JsonJudge } from "./json-judge"

export type Decision = "default" | "max"

const DEFAULT_MODEL_CANDIDATES = ["deepseek/deepseek-v4-flash"]

function appendText(value: unknown, output: string[], depth = 0) {
  if (output.join("").length >= 8_000 || depth > 5) return
  if (typeof value === "string") {
    output.push(value)
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

function compactMessageText(value: unknown, limit = 4_000) {
  const output: string[] = []
  appendText(value, output)
  return output.join("\n").slice(0, limit)
}

function latestUserText(messages: readonly ModelMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return compactMessageText(messages[i], 2_000)
  }
  return ""
}

export function parseDecision(text: string): Decision | undefined {
  const json = JsonJudge.extractJsonObject(text)
  if (json) {
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>
      const value = String(parsed.maxTokens ?? parsed.max_tokens ?? parsed.decision ?? "").toLowerCase()
      if (value === "max") return "max"
      if (value === "default") return "default"
    } catch {}
  }
  const normalized = text.trim().toLowerCase()
  if (/^max\b/.test(normalized)) return "max"
  if (/^default\b/.test(normalized)) return "default"
}

function judgeMessages(input: {
  currentModel: Provider.Model
  decision: ProviderTransform.MaxOutputDecision
  messages: readonly ModelMessage[]
  agent: Agent.Info
  toolCount: number
}): ModelMessage[] {
  return [
    {
      role: "system",
      content:
        'Decide whether this coding assistant turn needs the model\'s default output token budget or maximum output token budget. Return JSON only: {"maxTokens":"default"} or {"maxTokens":"max"}. Use max for implementation, bug fixing, refactoring, diagnostics, tests, or long outputs. Use default for simple explanation, status, or short configuration questions.',
    },
    {
      role: "user",
      content: JSON.stringify({
        agentMode: input.agent.mode,
        toolCount: input.toolCount,
        localReasons: input.decision.reasons,
        currentModel: `${input.currentModel.providerID}/${input.currentModel.id}`,
        defaultTokens: input.decision.policy?.default,
        maxTokens: input.decision.policy?.max,
        latestUserMessage: latestUserText(input.messages),
        recentTurnExcerpt: compactMessageText(input.messages.slice(-4), 2_000),
      }),
    },
  ]
}

export const run = Effect.fn("AutoMaxTokensJudge.run")(function* (input: {
  provider: Provider.Interface
  taskPolicyJudge?: ConfigTaskPolicy.Judge
  autoMaxTokens: ProviderTransform.AutoMaxTokensConfig | undefined
  currentModel: Provider.Model
  decision: ProviderTransform.MaxOutputDecision
  messages: readonly ModelMessage[]
  agent: Agent.Info
  toolCount: number
  sessionID: string
  abort: AbortSignal
}) {
  const auto = ProviderTransform.normalizeAutoMaxTokens(input.autoMaxTokens)
  if (auto.mode !== "llm") return undefined

  const modelCandidates = [...(auto.model ? [auto.model] : []), ...DEFAULT_MODEL_CANDIDATES]
  const result = yield* JsonJudge.runJsonJudge<Decision>({
    name: "auto-maxtokens",
    sessionID: input.sessionID,
    provider: input.provider,
    config: input.taskPolicyJudge,
    messages: judgeMessages(input),
    parse: parseDecision,
    modelCandidates,
    currentModel: input.currentModel,
    smallModelProviderID: input.currentModel.providerID,
    timeoutMs: auto.timeoutMs,
    maxOutputTokens: 64,
    abort: input.abort,
  })
  return result.status === "valid" ? result.decision : undefined
})

export * as AutoMaxTokensJudge from "./auto-maxtokens"
