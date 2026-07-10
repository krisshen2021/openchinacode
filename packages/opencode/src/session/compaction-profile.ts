import type { SessionV1 } from "@opencode-ai/core/v1/session"

export const ProfileTypes = [
  "debug_trace",
  "implementation_state",
  "architecture_memory",
  "review_findings",
  "tool_research",
  "general_summary",
] as const

export type ProfileType = (typeof ProfileTypes)[number]
export type ProfileWeight = "low" | "medium" | "high"
export type ProfileRisk = "low" | "medium" | "high"

export type Profile = {
  type: ProfileType
  weight: number
}

export type Decision = {
  profiles: Profile[]
  must_preserve: string[]
  risk: ProfileRisk
  source: "llm" | "heuristic" | "fallback"
}

type BuildInput = {
  previousSummary?: string
  context: readonly string[]
  decision: Decision
}

const TYPE_SET = new Set<string>(ProfileTypes)
const TEXT_SCAN_LIMIT = 120_000
const JUDGE_PREVIOUS_SUMMARY_CHARS = 4_000
const JUDGE_RECENT_CONTEXT_CHARS = 20_000

const SECTION_BY_TYPE: Record<ProfileType, string[]> = {
  debug_trace: ["Debug Trace", "Known Failures"],
  implementation_state: ["Implementation State"],
  architecture_memory: ["Architecture Decisions"],
  review_findings: ["Review Findings"],
  tool_research: ["Research Map"],
  general_summary: ["General Context"],
}

const SECTION_INSTRUCTION: Record<string, string> = {
  "Current Goal": "the user's current objective and why it matters",
  "Critical Continuity Facts": "facts that future turns must not lose",
  "Architecture Decisions": "architecture, design, stack, migration, and tradeoff decisions",
  "Implementation State": "files changed, partial edits, verified behavior, unfinished code work",
  "Debug Trace": "errors, commands, logs, hypotheses, attempts, and what each attempt proved",
  "Known Failures": "current failing tests/builds/LSP diagnostics and exact error strings",
  "Review Findings": "findings, risks, severity, evidence locations, and unresolved questions",
  "Research Map": "important files, symbols, code paths, commands used, and observations",
  "General Context": "useful conversation facts, user preferences, and durable constraints",
  "Next Actions": "concrete next steps in priority order",
}

function isProfileType(value: unknown): value is ProfileType {
  return typeof value === "string" && TYPE_SET.has(value)
}

function rounded(value: number) {
  return Math.round(value * 100) / 100
}

function level(weight: number): ProfileWeight {
  if (weight >= 0.35) return "high"
  if (weight >= 0.15) return "medium"
  return "low"
}

export function normalize(input: Partial<Decision> | undefined): Decision {
  const raw = (input?.profiles ?? []).flatMap((item): Profile[] => {
    if (!isProfileType(item?.type)) return []
    const weight = Number(item.weight)
    if (!Number.isFinite(weight) || weight <= 0) return []
    return [{ type: item.type, weight: Math.min(1, weight) }]
  })

  const merged = new Map<ProfileType, number>()
  for (const item of raw) {
    merged.set(item.type, (merged.get(item.type) ?? 0) + item.weight)
  }

  const total = [...merged.values()].reduce((sum, value) => sum + value, 0)
  const profiles =
    total > 0
      ? [...merged.entries()]
          .map(([type, weight]) => ({ type, weight: rounded(weight / total) }))
          .sort((a, b) => b.weight - a.weight || a.type.localeCompare(b.type))
          .slice(0, 4)
      : [{ type: "general_summary" as const, weight: 1 }]

  const risk = input?.risk === "high" || input?.risk === "medium" || input?.risk === "low" ? input.risk : riskOf(profiles)
  const must_preserve = (input?.must_preserve ?? [])
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 8)

  return {
    profiles,
    must_preserve,
    risk,
    source:
      input?.source === "llm"
        ? "llm"
        : input?.source === "heuristic"
          ? "heuristic"
          : input?.source === "fallback"
            ? "fallback"
            : "fallback",
  }
}

function riskOf(profiles: Profile[]): ProfileRisk {
  const high = profiles.some(
    (item) =>
      item.weight >= 0.35 &&
      (item.type === "debug_trace" || item.type === "review_findings" || item.type === "architecture_memory"),
  )
  if (high) return "high"
  if (profiles.some((item) => item.weight >= 0.25 && item.type !== "general_summary")) return "medium"
  return "low"
}

function appendText(value: unknown, output: string[], depth = 0) {
  if (output.join("").length >= TEXT_SCAN_LIMIT || depth > 5) return
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
  for (const key of ["text", "content", "output", "raw", "value", "title", "tool"]) {
    if (key in record) appendText(record[key], output, depth + 1)
  }
}

function messageText(messages: readonly SessionV1.WithParts[]) {
  const output: string[] = []
  for (const message of messages) {
    appendText(message.parts, output)
  }
  return output.join("\n").slice(0, TEXT_SCAN_LIMIT)
}

function hit(text: string, regex: RegExp) {
  return regex.test(text)
}

export function infer(input: { messages: readonly SessionV1.WithParts[]; previousSummary?: string }): Decision {
  const text = [input.previousSummary ?? "", messageText(input.messages)].join("\n").toLowerCase()
  const scores = new Map<ProfileType, number>(ProfileTypes.map((type) => [type, type === "general_summary" ? 1 : 0]))
  const add = (type: ProfileType, score: number) => scores.set(type, (scores.get(type) ?? 0) + score)

  if (
    hit(
      text,
      /\b(error|exception|traceback|stack trace|failed|failure|diagnostic|lsp|typeerror|referenceerror|syntaxerror|debug|bug|broken)\b|报错|错误|异常|失败|诊断|调试|排查|红色|测试不过|编译不过/,
    )
  ) {
    add("debug_trace", 5)
  }
  if (hit(text, /\b(test|pytest|vitest|npm run|build|typecheck|lint|tsc)\b|测试|构建|编译|单测/)) {
    add("debug_trace", 2)
  }
  if (
    hit(
      text,
      /\b(implement|implemented|edit|edited|modify|modified|write|patch|apply_patch|refactor|rewrite|feature|migration)\b|实现|修改|改造|重构|新增|接入|迁移/,
    )
  ) {
    add("implementation_state", 4)
  }
  if (hit(text, /\b[\w@./-]+\.(ts|tsx|js|jsx|json|jsonc|py|go|rs|css|html|vue|md|yaml|yml|toml)\b/)) {
    add("implementation_state", 2)
    add("tool_research", 1)
  }
  if (
    hit(
      text,
      /\b(architecture|system design|design|stack|frontend|ui\/ux|module|boundary|tradeoff|roadmap)\b|架构|系统设计|技术栈|选型|模块|边界|方案|规划|前端/,
    )
  ) {
    add("architecture_memory", 4)
  }
  if (hit(text, /\b(review|audit|risk|finding|security|vulnerability|regression)\b|审查|审核|评审|审计|风险|漏洞/)) {
    add("review_findings", 4)
  }
  if (hit(text, /\b(read|grep|glob|search|find|inspect|explore|ls|cat|sed|rg)\b|查找|搜索|定位|查看|阅读|探索/)) {
    add("tool_research", 3)
  }

  const profiles = [...scores.entries()]
    .filter(([, score]) => score > 0)
    .map(([type, score]) => ({ type, weight: score }))

  return normalize({
    profiles,
    must_preserve: mustPreserve(text),
    source: "heuristic",
  })
}

function tail(value: string, length: number) {
  if (value.length <= length) return value
  return value.slice(-length)
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const input = fenced ?? text.trim()
  const start = input.indexOf("{")
  const end = input.lastIndexOf("}")
  if (start < 0 || end <= start) return undefined
  return input.slice(start, end + 1)
}

export function parseJudgeOutput(text: string): Decision | undefined {
  const json = extractJsonObject(text)
  if (!json) return undefined
  try {
    const parsed = JSON.parse(json) as Partial<Decision>
    const normalized = normalize({
      profiles: parsed.profiles,
      must_preserve: parsed.must_preserve,
      risk: parsed.risk,
      source: "llm",
    })
    if (!normalized.profiles.length) return undefined
    return normalized
  } catch {
    return undefined
  }
}

export function judgeMessages(input: { messages: readonly SessionV1.WithParts[]; previousSummary?: string }) {
  const previousSummary = tail(input.previousSummary ?? "", JUDGE_PREVIOUS_SUMMARY_CHARS)
  const recentConversation = tail(messageText(input.messages), JUDGE_RECENT_CONTEXT_CHARS)
  return [
    {
      role: "system" as const,
      content: [
        "You are OpenChinaCode's compaction profile judge.",
        "Classify what the next conversation summary must preserve for future coding work.",
        "The conversation may be mixed. Use multiple profiles with weights when needed.",
        "Return one compact JSON object only. Do not include Markdown, commentary, analysis, or explanatory text.",
        "The profile type value must be one of the exact enum strings below. Do not translate or invent type names.",
        "Schema:",
        '{"profiles":[{"type":"debug_trace|implementation_state|architecture_memory|review_findings|tool_research|general_summary","weight":0.0}],"must_preserve":["short durable preservation rule"],"risk":"low|medium|high"}',
        "Use debug_trace for failures, diagnostics, test/build output, debugging hypotheses.",
        "Use implementation_state for changed files, partial edits, current work state, verification.",
        "Use architecture_memory for system design, refactor plans, stack choices, migration constraints.",
        "Use review_findings for audit/review findings, risks, severity, evidence locations.",
        "Use tool_research for files inspected, symbols traced, commands used, research map.",
        "Use general_summary for user preferences and durable context that does not fit the other profiles.",
        "Keep must_preserve to at most 8 short items.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        profile_types: ProfileTypes,
        previous_summary_excerpt: previousSummary,
        recent_conversation_excerpt: recentConversation,
      }),
    },
  ]
}

function mustPreserve(text: string) {
  const result: string[] = []
  if (hit(text, /\b(error|failed|failure|traceback|diagnostic|lsp)\b|报错|错误|失败|诊断/)) {
    result.push("exact failing commands, diagnostics, error strings, and current hypothesis")
  }
  if (hit(text, /\b[\w@./-]+\.(ts|tsx|js|jsx|json|jsonc|py|go|rs|css|html|vue|md|yaml|yml|toml)\b/)) {
    result.push("file paths, symbols, and code locations already inspected or changed")
  }
  if (hit(text, /\b(refactor|architecture|migration|design|stack)\b|重构|架构|迁移|技术栈|方案/)) {
    result.push("architecture/refactor decisions, constraints, and rejected alternatives")
  }
  if (hit(text, /\b(next|todo|follow-up|remaining|blocked)\b|下一步|待办|未完成|阻塞/)) {
    result.push("next actions, blockers, and unfinished work")
  }
  return result
}

function sections(decision: Decision) {
  const result = new Set<string>(["Current Goal", "Critical Continuity Facts"])
  for (const profile of decision.profiles) {
    if (profile.weight < 0.12 && profile.type !== "general_summary") continue
    for (const section of SECTION_BY_TYPE[profile.type]) result.add(section)
  }
  result.add("Next Actions")
  return [...result]
}

function profileLines(decision: Decision) {
  return decision.profiles.map((profile) => `- ${profile.type}: ${level(profile.weight)} detail (${profile.weight})`)
}

function template(decision: Decision) {
  return sections(decision)
    .map((section) => {
      const instruction = SECTION_INSTRUCTION[section] ?? "relevant durable facts"
      return `## ${section}\n- [${instruction}; write \"(none)\" if empty]`
    })
    .join("\n\n")
}

export function buildPrompt(input: BuildInput) {
  const decision = normalize(input.decision)
  const profileJson = JSON.stringify(
    {
      profiles: decision.profiles,
      must_preserve: decision.must_preserve,
      risk: decision.risk,
      source: decision.source,
    },
    null,
    2,
  )

  return [
    input.previousSummary
      ? `Update the anchored working memory below using the conversation history above.\nPreserve still-true details, remove stale details, and merge in the new facts.\n<previous-summary>\n${input.previousSummary}\n</previous-summary>`
      : "Create a new anchored working memory from the conversation history.",
    "Use the stable compaction profile JSON below to decide what to preserve and how much detail each section needs.",
    `<compaction-profile-json>\n${profileJson}\n</compaction-profile-json>`,
    "Profile priorities:\n" + profileLines(decision).join("\n"),
    decision.must_preserve.length
      ? "Must preserve:\n" + decision.must_preserve.map((item) => `- ${item}`).join("\n")
      : "Must preserve:\n- exact file paths, symbols, commands, error strings, URLs, identifiers, and next actions when known",
    "Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.",
    `<template>\n${template(decision)}\n</template>`,
    "Rules:\n- Keep every section, even when empty.\n- Use terse bullets, not prose paragraphs.\n- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.\n- Do not mention the summary process, profiles, JSON, or that context was compacted.\n- Prefer actionable state over narrative chronology.",
    ...input.context,
  ].join("\n\n")
}

export const CompactionProfile = {
  ProfileTypes,
  normalize,
  infer,
  parseJudgeOutput,
  judgeMessages,
  buildPrompt,
}
