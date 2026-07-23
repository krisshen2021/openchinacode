import { ConfigTaskPolicy } from "@opencode-ai/core/config/task-policy"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"
import type { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"

export type TaskKind = ConfigTaskPolicy.TaskKind
export type TaskComplexity = ConfigTaskPolicy.TaskComplexity

export type ModelRef = {
  providerID: ProviderV2.ID
  modelID: ModelV2.ID
}

export type Route = {
  model?: ModelRef
  variant?: string
  inherit?: boolean
}

export type TaskPolicySource = "task_policy.agent" | "task_policy.routes" | "model_task_class" | "openchinacode.default"

export type Assignment = {
  kind: TaskKind
  complexity: TaskComplexity
  confidence: number
  reasons: string[]
}

export type Selection = {
  assignment: Assignment
  route: Route
  source: TaskPolicySource
  requested: string
}

type Candidate = {
  source: TaskPolicySource
  requested: string
  route: Route
}

const TASK_KIND_SET = new Set<string>(ConfigTaskPolicy.TaskKinds)

function isTaskKind(value: string | undefined): value is TaskKind {
  return !!value && TASK_KIND_SET.has(value)
}

function textOf(input: { description: string; prompt: string; command?: string; agent: Agent.Info }) {
  return [input.command, input.agent.name, input.description, input.prompt].filter(Boolean).join("\n").toLowerCase()
}

function match(text: string, regex: RegExp) {
  return regex.test(text)
}

function hitKind(input: {
  scores: Record<TaskKind, number>
  reasons: Record<TaskKind, string[]>
  kind: TaskKind
  weight: number
  reason: string
}) {
  input.scores[input.kind] += input.weight
  input.reasons[input.kind].push(input.reason)
}

function inferKind(input: {
  description: string
  prompt: string
  command?: string
  agent: Agent.Info
}): Pick<Assignment, "kind" | "confidence" | "reasons"> {
  const scores = {} as Record<TaskKind, number>
  const reasons = {} as Record<TaskKind, string[]>
  for (const item of ConfigTaskPolicy.TaskKinds) {
    scores[item] = 0
    reasons[item] = []
  }

  const text = textOf(input)
  const hit = (kind: TaskKind, weight: number, reason: string) => hitKind({ scores, reasons, kind, weight, reason })

  if (input.agent.name === "explore") hit("explore", 4, "subagent is explore")
  if (input.agent.name === "compaction") hit("compaction", 8, "subagent is compaction")
  if (input.agent.name === "reviewer" || input.agent.name === "review") hit("review", 4, "subagent is review")

  if (match(text, /\b(plan|proposal|roadmap|strategy)\b|计划|规划|方案|技术路线/)) {
    hit("plan", 5, "planning request")
  }
  if (match(text, /\barchitecture\b|\bsystem design\b|\bdesign\b|\bmigration\b|架构|系统设计|模块设计/)) {
    hit("architecture", 6, "architecture or system design request")
  }
  if (match(text, /\btech(?:nology)? stack\b|\bstack recommendation\b|技术栈|选型/)) {
    hit("architecture", 5, "technology stack or selection request")
  }
  if (match(text, /\brefactor\b|\brewrite\b|\brestructure\b|\bcleanup\b|\boverhaul\b|重构|改造|清理|整理/)) {
    hit("refactor", 6, "refactor request")
  }
  if (
    match(
      text,
      /\b(?:ui\/ux|frontend|front-end|front end)\b.*\b(?:refactor|rewrite|overhaul)\b|\b(?:refactor|rewrite|overhaul)\b.*\b(?:ui\/ux|frontend|front-end|front end)\b|前端.*重构|重构.*前端|界面.*重构|重构.*界面|用户体验.*重构|重构.*用户体验/,
    )
  ) {
    hit("refactor", 3, "frontend or UI/UX refactor request")
  }
  if (match(text, /\breview\b|\baudit\b|\bsecurity audit\b|审查|审核|评审|代码审计/)) {
    hit("review", 7, "review or audit request")
  }
  if (
    match(
      text,
      /\bimplement\b|\bfeature\b|\badd\b|\bcreate\b|\bsupport\b|\bintegrat[ei]\b|\bbuild\b|实现|新增|增加|接入|开发|支持/,
    )
  ) {
    hit("implement", 5, "implementation request")
  }
  if (match(text, /\bfind\b|\bsearch\b|\blocate\b|\binspect\b|\bexplore\b|\bread\b|查找|搜索|定位|查看|了解/)) {
    hit("explore", 4, "search or inspection request")
  }
  if (
    match(
      text,
      /\bbug\b|\berror\b|\bexception\b|\bfail(?:ed|ing|ure)?\b|\bbroken\b|\bdiagnos[ei]\b|\bdebug\b|报错|失败|异常|调试|排查|修复.*bug/,
    )
  ) {
    hit("debug", 7, "debugging or failure request")
  }
  if (
    match(
      text,
      /\btest\b|\bspec\b|\bunit\b|\be2e\b|\bflaky\b|\bcoverage\b|\bintegration test\b|\bbrowser check\b|\bplaywright\b|测试|单测|用例|覆盖率|联调|端到端|浏览器检查/,
    )
  ) {
    hit("test_fix", 6, "test-related request")
  }
  if (
    match(
      text,
      /\b(?:screenshot|screen ?shot|image|vision|visual|ui visual|browser check|browser screenshot|page screenshot|playwright screenshot|ocr)\b|截图|截屏|看图|识图|视觉|图像|图片|浏览器页面|页面截图|视觉检查|界面截图|截图检查/,
    )
  ) {
    hit("visual_check", 10, "visual or screenshot inspection request")
  }
  if (match(text, /\bsummar(?:y|ize)\b|\bcompact(?:ion)?\b|\bexplain\b|\bbrief\b|总结|压缩|概括|解释|说明/)) {
    hit("summarize", 4, "summary or explanation request")
  }

  const best = ConfigTaskPolicy.TaskKinds.reduce((selected, candidate) => {
    if (scores[candidate] > scores[selected]) return candidate
    return selected
  }, "general" as TaskKind)
  const score = scores[best]

  if (score <= 0) {
    return {
      kind: "general",
      confidence: 0.5,
      reasons: ["no strong task-specific signal"],
    }
  }

  return {
    kind: best,
    confidence: Math.min(0.95, 0.55 + score / 20),
    reasons: reasons[best],
  }
}

function inferComplexity(input: {
  kind: TaskKind
  description: string
  prompt: string
  command?: string
  agent: Agent.Info
}): { complexity: TaskComplexity; reasons: string[] } {
  if (input.kind === "compaction") {
    return { complexity: "medium", reasons: ["compaction defaults to medium granularity"] }
  }

  const text = textOf(input)
  if (
    match(
      text,
      /\b(comprehensive|exhaustive|full|deep|complex|large|migration|system-wide|codebase-wide|whole repo|very thorough|overhaul)\b|全量|完整|全面|深入|深度|复杂|大型|系统级|大规模|审计|通读|重写|迁移/,
    )
  ) {
    return { complexity: "complex", reasons: ["request asks for broad or deep handling"] }
  }
  if (
    match(
      text,
      /\b(?:ui\/ux|frontend|front-end|front end)\b.*\b(?:refactor|rewrite|overhaul|plan|roadmap)\b|\b(?:refactor|rewrite|overhaul|plan|roadmap)\b.*\b(?:ui\/ux|frontend|front-end|front end)\b|前端.*(?:重构|改造|计划|规划|方案|技术栈)|(?:重构|改造|计划|规划|方案|技术栈).*前端|ui\/ux.*(?:重构|计划|规划|方案|技术栈)|(?:重构|计划|规划|方案|技术栈).*ui\/ux/,
    )
  ) {
    return { complexity: "complex", reasons: ["frontend or UI/UX refactor planning is broad"] }
  }

  if (match(text, /\b(quick|simple|small|tiny|brief|find|search|locate|grep)\b|快速|简单|小范围|查找|搜索|定位/)) {
    return { complexity: "quick", reasons: ["request is narrow or search-oriented"] }
  }

  if (input.kind === "explore" && input.agent.name === "explore") {
    return { complexity: "quick", reasons: ["explore subagent defaults to quick unless deep signals are present"] }
  }

  return { complexity: "medium", reasons: ["default medium complexity"] }
}

export function classify(input: {
  description: string
  prompt: string
  command?: string
  agent: Agent.Info
  kindHint?: TaskKind
  complexityHint?: TaskComplexity
}): Assignment {
  const kindResult = input.kindHint
    ? {
        kind: input.kindHint,
        confidence: 1,
        reasons: [`task_kind hint: ${input.kindHint}`],
      }
    : inferKind(input)
  const complexityResult = input.complexityHint
    ? {
        complexity: input.complexityHint,
        reasons: [`task_complexity hint: ${input.complexityHint}`],
      }
    : inferComplexity({ ...input, kind: kindResult.kind })

  return {
    kind: kindResult.kind,
    complexity: complexityResult.complexity,
    confidence: kindResult.confidence,
    reasons: [...kindResult.reasons, ...complexityResult.reasons],
  }
}

function parseModelRef(value: string): ModelRef | undefined {
  if (!value.includes("/")) return
  const parsed = Provider.parseModel(value)
  if (!String(parsed.providerID) || !String(parsed.modelID)) return
  return parsed
}

function requestedRoute(spec: ConfigTaskPolicy.Route) {
  if (spec.inherit) return spec.variant ? `inherit#${spec.variant}` : "inherit"
  return [spec.model, spec.variant].filter(Boolean).join("#")
}

function routeFromSpec(spec: ConfigTaskPolicy.Route): Route | undefined {
  if (spec.inherit) return { inherit: true, variant: spec.variant }
  if (!spec.model) return
  const model = parseModelRef(spec.model)
  if (!model) return
  return { model, variant: spec.variant }
}

function routeKeys(assignment: Assignment) {
  return [`${assignment.kind}.${assignment.complexity}`, assignment.kind]
}

function configuredCandidates(input: { cfg: ConfigV1.Info; agent: Agent.Info; assignment: Assignment }): Candidate[] {
  const policy = input.cfg.task_policy
  if (policy?.enabled === false) return []

  const result: Candidate[] = []
  const keys = routeKeys(input.assignment)
  const agentRoutes = policy?.agents?.[input.agent.name]
  for (const key of keys) {
    const spec = agentRoutes?.[key]
    if (!spec) continue
    const route = routeFromSpec(spec)
    if (route) {
      result.push({ source: "task_policy.agent", requested: requestedRoute(spec), route })
      break
    }
  }

  for (const key of keys) {
    const spec = policy?.routes?.[key]
    if (!spec) continue
    const route = routeFromSpec(spec)
    if (route) {
      result.push({ source: "task_policy.routes", requested: requestedRoute(spec), route })
      break
    }
  }

  return result
}

function taggedCandidates(input: {
  providers: Record<ProviderV2.ID, Provider.Info>
  assignment: Assignment
  inherited: ModelRef
}): Candidate[] {
  const result: Candidate[] = []
  for (const provider of Object.values(input.providers)) {
    for (const model of Object.values(provider.models)) {
      if (!model.task_classes?.some((item) => isTaskKind(item) && item === input.assignment.kind)) continue
      const requested = `${provider.id}/${model.id}`
      result.push({
        source: "model_task_class",
        requested,
        route: { model: { providerID: provider.id, modelID: model.id } },
      })
    }
  }

  return result.sort((a, b) => {
    const aModel = a.route.model
    const bModel = b.route.model
    const aSameProvider = aModel?.providerID === input.inherited.providerID ? 0 : 1
    const bSameProvider = bModel?.providerID === input.inherited.providerID ? 0 : 1
    if (aSameProvider !== bSameProvider) return aSameProvider - bSameProvider
    return a.requested.localeCompare(b.requested)
  })
}

function builtinRoute(assignment: Assignment): ConfigTaskPolicy.Route {
  if (assignment.kind === "general") return { inherit: true }

  if (assignment.kind === "plan" || assignment.kind === "architecture" || assignment.kind === "refactor") {
    return {
      model: "zhipuai-pay2go/glm-5.2",
      variant: assignment.complexity === "complex" ? "max" : "high",
    }
  }

  if (assignment.kind === "summarize") {
    if (assignment.complexity === "quick") return { model: "moonshotai-cn/kimi-k3", variant: "high" }
    return {
      model: "zhipuai-pay2go/glm-5.2",
      variant: assignment.complexity === "complex" ? "max" : "high",
    }
  }

  if (assignment.kind === "compaction") {
    if (assignment.complexity === "quick") return { model: "zhipuai-pay2go/glm-5.2", variant: "high" }
    return { model: "moonshotai-cn/kimi-k3", variant: "high" }
  }

  if (assignment.kind === "visual_check") {
    return { model: "zhipuai-pay2go/glm-5v-turbo" }
  }

  if (assignment.kind === "review") {
    if (assignment.complexity === "quick") return { model: "moonshotai-cn/kimi-k3", variant: "high" }
    return {
      model: "zhipuai-pay2go/glm-5.2",
      variant: assignment.complexity === "complex" ? "max" : "high",
    }
  }

  if (assignment.kind === "implement") {
    if (assignment.complexity === "quick") return { model: "moonshotai-cn/kimi-k3", variant: "high" }
    return {
      model: "zhipuai-pay2go/glm-5.2",
      variant: assignment.complexity === "complex" ? "max" : "high",
    }
  }

  if (assignment.kind === "explore") {
    if (assignment.complexity === "quick") return { model: "moonshotai-cn/kimi-k3", variant: "high" }
    if (assignment.complexity === "medium") return { model: "moonshotai-cn/kimi-k3", variant: "high" }
    return { model: "zhipuai-pay2go/glm-5.2", variant: "max" }
  }

  if (assignment.kind === "debug" || assignment.kind === "test_fix") {
    return {
      model: "deepseek/deepseek-v4-pro",
      variant: assignment.complexity === "complex" ? "max" : "high",
    }
  }

  return { inherit: true }
}

function builtinCandidate(assignment: Assignment): Candidate {
  const spec = builtinRoute(assignment)
  return {
    source: "openchinacode.default",
    requested: requestedRoute(spec),
    route: routeFromSpec(spec) ?? { inherit: true },
  }
}

function uniqueCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>()
  const result: Candidate[] = []
  for (const candidate of candidates) {
    const key = candidate.route.inherit
      ? `inherit#${candidate.route.variant ?? ""}`
      : `${candidate.route.model?.providerID}/${candidate.route.model?.modelID}#${candidate.route.variant ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }
  return result
}

export const select = Effect.fn("TaskPolicy.select")(function* (input: {
  cfg: ConfigV1.Info
  provider: Provider.Interface
  agent: Agent.Info
  inherited: ModelRef
  description: string
  prompt: string
  command?: string
  kindHint?: TaskKind
  complexityHint?: TaskComplexity
}) {
  if (input.cfg.task_policy?.enabled === false) return undefined

  const assignment = classify(input)
  const providers = yield* input.provider
    .list()
    .pipe(Effect.catchCause(() => Effect.succeed({} as Record<ProviderV2.ID, Provider.Info>)))
  const candidates = uniqueCandidates([
    ...configuredCandidates({ cfg: input.cfg, agent: input.agent, assignment }),
    ...taggedCandidates({ providers, assignment, inherited: input.inherited }),
    builtinCandidate(assignment),
  ])

  for (const candidate of candidates) {
    if (candidate.route.inherit) {
      return {
        assignment,
        route: candidate.route,
        source: candidate.source,
        requested: candidate.requested,
      } satisfies Selection
    }
    const model = candidate.route.model
    if (!model) continue
    const available = yield* input.provider.getModel(model.providerID, model.modelID).pipe(
      Effect.as(true),
      Effect.catchCause(() => Effect.succeed(false)),
    )
    if (!available) continue
    return {
      assignment,
      route: candidate.route,
      source: candidate.source,
      requested: candidate.requested,
    } satisfies Selection
  }

  return {
    assignment,
    route: { inherit: true },
    source: "openchinacode.default",
    requested: "inherit",
  } satisfies Selection
})

export const defaults = {
  builtinRoute,
}

export * as TaskPolicy from "./task-policy"
