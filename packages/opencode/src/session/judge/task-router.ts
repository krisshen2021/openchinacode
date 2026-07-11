import { ConfigTaskPolicy } from "@opencode-ai/core/config/task-policy"
import { Effect } from "effect"
import type { ModelMessage } from "ai"
import type { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { TaskPolicy, type Assignment } from "../task-policy"
import { JsonJudge } from "./json-judge"

export type Decision = {
  action: "direct" | "delegate"
  task_kind: ConfigTaskPolicy.TaskKind
  task_complexity: ConfigTaskPolicy.TaskComplexity
  subagent_type: string
  confidence: number
  reason: string
  description: string
  subtask_prompt?: string
}

const DEFAULT_MODEL_CANDIDATES = ["deepseek/deepseek-v4-flash"]
const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_MAX_OUTPUT_TOKENS = 1_024
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7
const DEFAULT_ALLOW = new Set<ConfigTaskPolicy.TaskKind>([
  "plan",
  "architecture",
  "refactor",
  "review",
  "implement",
  "explore",
  "visual_check",
  "debug",
  "test_fix",
])
const DEFAULT_DENY = new Set<ConfigTaskPolicy.TaskKind>(["general", "summarize", "compaction"])
const KIND_SET = new Set<string>(ConfigTaskPolicy.TaskKinds)
const COMPLEXITY_SET = new Set<string>(ConfigTaskPolicy.TaskComplexities)

function isTaskKind(value: unknown): value is ConfigTaskPolicy.TaskKind {
  return typeof value === "string" && KIND_SET.has(value)
}

function isTaskComplexity(value: unknown): value is ConfigTaskPolicy.TaskComplexity {
  return typeof value === "string" && COMPLEXITY_SET.has(value)
}

function clamp(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

function limit(value: unknown, max: number) {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 3)}...` : trimmed
}

function record(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function parseDecision(text: string): Decision | undefined {
  const json = JsonJudge.extractJsonObject(text)
  if (!json) return
  let parsed: Record<string, unknown>
  try {
    const item = record(JSON.parse(json))
    if (!item) return
    parsed = item
  } catch {
    return
  }

  const kind = parsed.task_kind ?? parsed.kind
  const complexity = parsed.task_complexity ?? parsed.complexity
  if (!isTaskKind(kind) || !isTaskComplexity(complexity)) return

  const rawAction = String(parsed.action ?? parsed.decision ?? "").toLowerCase()
  const delegateFlag = parsed.delegate === true || parsed.should_delegate === true
  const action: Decision["action"] =
    rawAction === "delegate" || rawAction === "subtask" || rawAction === "auto_delegate" || delegateFlag
      ? "delegate"
      : "direct"
  const subagentRaw = limit(parsed.subagent_type ?? parsed.subagent ?? "", 40)
  const subagent = subagentRaw || (kind === "explore" ? "explore" : "general")
  const description = limit(parsed.description, 80) || `${kind}.${complexity}`
  const reason = limit(parsed.reason, 240) || "judge decision"
  const subtaskPrompt = limit(parsed.subtask_prompt ?? parsed.prompt, 12_000)

  return {
    action,
    task_kind: kind,
    task_complexity: complexity,
    subagent_type: subagent,
    confidence: clamp(parsed.confidence, action === "delegate" ? 0.7 : 0.5),
    reason,
    description,
    ...(subtaskPrompt ? { subtask_prompt: subtaskPrompt } : {}),
  }
}

function judgeMessages(input: {
  prompt: string
  recentContext?: string
  currentModel: Provider.Model
  agent: Agent.Info
  localAssignment: Assignment
  partSummary: string[]
}): ModelMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are OpenChinaCode's fast extra task router judge.",
        "Decide whether the current user request should be delegated to a subagent before the primary model answers.",
        "Return one compact JSON object only. Do not include Markdown or explanations.",
        "Delegate when the request is project-dependent and benefits from a focused subagent: planning, architecture, refactor, review, implementation, exploration, debugging, failing tests, or visual inspection.",
        "Do not delegate simple factual questions, status checks, tiny one-step edits, pure chat, slash-command help, compaction requests, or generic summaries.",
        "If the request is mixed, choose the dominant coding task that should run first.",
        "Schema:",
        '{"action":"direct|delegate","task_kind":"general|plan|architecture|refactor|review|implement|explore|visual_check|debug|test_fix|summarize|compaction","task_complexity":"quick|medium|complex","subagent_type":"general|explore","confidence":0.0,"description":"3-8 word title","reason":"short reason","subtask_prompt":"self-contained delegated task prompt"}',
        "Use subagent_type=explore only for repository discovery/search/investigation. Otherwise use general.",
        "When action=delegate, subtask_prompt must be self-contained and include the user's exact goal, relevant recent context, constraints, and expected output.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        current_model: `${input.currentModel.providerID}/${input.currentModel.id}`,
        agent: { name: input.agent.name, mode: input.agent.mode },
        local_assignment: input.localAssignment,
        part_summary: input.partSummary,
        user_prompt: input.prompt,
        recent_context_excerpt: input.recentContext ?? "",
      }),
    },
  ]
}

function configuredSet(values: ConfigTaskPolicy.TaskKind[] | undefined, fallback: Set<ConfigTaskPolicy.TaskKind>) {
  if (!values?.length) return fallback
  return new Set(values)
}

export function shouldDelegate(decision: Decision, config: ConfigTaskPolicy.ExtraRouter | undefined) {
  if (config?.enabled !== true) return false
  if (decision.action !== "delegate") return false
  const threshold = config.confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD
  if (decision.confidence < threshold) return false
  const deny = configuredSet(config.deny, DEFAULT_DENY)
  if (deny.has(decision.task_kind)) return false
  const allow = configuredSet(config.allow, DEFAULT_ALLOW)
  if (!allow.has(decision.task_kind)) return false
  return true
}

export function buildSubtaskPrompt(input: { decision: Decision; prompt: string; recentContext?: string }) {
  return [
    "OpenChinaCode extra task router delegated this task before the primary model response.",
    `Task: ${input.decision.task_kind}.${input.decision.task_complexity}`,
    `Reason: ${input.decision.reason}`,
    "",
    "User request:",
    input.prompt,
    ...(input.recentContext ? ["", "Relevant recent parent-session context:", input.recentContext] : []),
    ...(input.decision.subtask_prompt ? ["", "Judge task focus:", input.decision.subtask_prompt] : []),
    "",
    "Do the delegated work directly. Use tools when useful. Return concrete findings, edits, verification, or a clear plan depending on the task.",
  ].join("\n")
}

export const run = Effect.fn("TaskRouterJudge.run")(function* (input: {
  provider: Provider.Interface
  taskPolicyJudge?: ConfigTaskPolicy.Judge
  prompt: string
  recentContext?: string
  currentModel: Provider.Model
  agent: Agent.Info
  localAssignment: Assignment
  partSummary: string[]
  sessionID: string
  abort?: AbortSignal
}) {
  const result = yield* JsonJudge.runJsonJudge<Decision>({
    name: "task-router",
    sessionID: input.sessionID,
    provider: input.provider,
    config: input.taskPolicyJudge,
    messages: judgeMessages(input),
    parse: parseDecision,
    modelCandidates: DEFAULT_MODEL_CANDIDATES,
    currentModel: input.currentModel,
    smallModelProviderID: input.currentModel.providerID,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    abort: input.abort,
    log: {
      localTaskKind: input.localAssignment.kind,
      localTaskComplexity: input.localAssignment.complexity,
    },
  })
  return result
})

export function localAssignment(input: { prompt: string; agent: Agent.Info; command?: string }): Assignment {
  return TaskPolicy.classify({
    description: "user prompt",
    prompt: input.prompt,
    command: input.command,
    agent: input.agent,
  })
}

export * as TaskRouterJudge from "./task-router"
