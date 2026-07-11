import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Session } from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { MessageV2 } from "./message-v2"
import { Token } from "@/util/token"
import { SessionProcessor } from "./processor"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/storage"

import { Effect, Layer, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { isOverflow as overflow, usable } from "./overflow"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionCompactionEvent } from "@opencode-ai/schema/session-compaction-event"
import { TaskPolicy } from "./task-policy"
import { CompactionProfile, type ActiveTaskEssential, type Decision } from "./compaction-profile"
import { JsonJudge } from "./judge/json-judge"

export const Event = SessionCompactionEvent

export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const PRUNE_PROTECTED_TOOLS = ["skill"]
const DEFAULT_TAIL_TURNS = 2
const MIN_PRESERVE_RECENT_TOKENS = 2_000
const MAX_PRESERVE_RECENT_TOKENS = 8_000
// The profile judge is an optional quality step before summary generation.
// Give China-hosted reasoning models enough time to return a small JSON decision;
// failures still fall back to deterministic local inference.
const PROFILE_JUDGE_TIMEOUT_MS = 60_000
const PROFILE_JUDGE_FALLBACKS = ["moonshotai-cn/kimi-k2.7-code-highspeed", "deepseek/deepseek-v4-flash"]
const ACTIVE_TASK_EXTRACT_TIMEOUT_MS = 90_000
const ACTIVE_TASK_EXTRACT_FALLBACKS = PROFILE_JUDGE_FALLBACKS
const ACTIVE_TASK_EXTRACT_MAX_OUTPUT_TOKENS = 16_384
type ProgressData = typeof Event.Progress.data.Type
type ProgressStage = ProgressData["stage"]
type ProgressModel = ProgressData["model"]
type ProgressJudge = ProgressData["judge"]
type ProgressProfile = ProgressData["profile"]
type ProfileJudgeResult = {
  status: NonNullable<ProgressJudge>["status"]
  decision?: Decision
  model?: NonNullable<ProgressModel>
  elapsedMs?: number
  error?: string
}
type ActiveTaskExtractResult = {
  status: NonNullable<ProgressJudge>["status"]
  activeTask?: ActiveTaskEssential
  model?: NonNullable<ProgressModel>
  elapsedMs?: number
  error?: string
}
type Turn = {
  start: number
  end: number
  id: MessageID
}

type Tail = {
  start: number
  id: MessageID
}

type RetentionRequest = {
  turns: number
  source: "manual" | "config" | "auto"
  message: string
}

type CompletedCompaction = {
  userIndex: number
  assistantIndex: number
  summary: string | undefined
}

function summaryText(message: SessionV1.WithParts) {
  const text = message.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
  return text || undefined
}

function completedCompactions(messages: SessionV1.WithParts[]) {
  const users = new Map<MessageID, number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (!msg.parts.some((part) => part.type === "compaction")) continue
    users.set(msg.info.id, i)
  }

  return messages.flatMap((msg, assistantIndex): CompletedCompaction[] => {
    if (msg.info.role !== "assistant") return []
    if (!msg.info.summary || !msg.info.finish || msg.info.error) return []
    const userIndex = users.get(msg.info.parentID)
    if (userIndex === undefined) return []
    return [{ userIndex, assistantIndex, summary: summaryText(msg) }]
  })
}

function preserveRecentBudget(input: { cfg: ConfigV1.Info; model: Provider.Model }) {
  return (
    input.cfg.compaction?.preserve_recent_tokens ??
    Math.min(MAX_PRESERVE_RECENT_TOKENS, Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usable(input) * 0.25)))
  )
}

function retentionRequest(input: { cfg: ConfigV1.Info; manualKeepTurns?: number }): RetentionRequest {
  if (input.manualKeepTurns !== undefined) {
    const turns = Math.max(0, Math.floor(input.manualKeepTurns))
    return {
      turns,
      source: "manual",
      message: `manual raw tail keep ${turns} turn${turns === 1 ? "" : "s"}`,
    }
  }

  const configured = input.cfg.compaction?.tail_turns
  if (typeof configured === "number") {
    const turns = Math.max(0, Math.floor(configured))
    return {
      turns,
      source: "config",
      message: `config raw tail keep ${turns} turn${turns === 1 ? "" : "s"}`,
    }
  }

  return {
    turns: DEFAULT_TAIL_TURNS,
    source: "auto",
    message: `auto minimal raw tail keep ${DEFAULT_TAIL_TURNS} turns`,
  }
}

function turns(messages: SessionV1.WithParts[]) {
  const result: Turn[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (msg.parts.some((part) => part.type === "compaction")) continue
    result.push({
      start: i,
      end: messages.length,
      id: msg.info.id,
    })
  }
  for (let i = 0; i < result.length - 1; i++) {
    result[i].end = result[i + 1].start
  }
  return result
}

function splitTurn(input: {
  messages: SessionV1.WithParts[]
  turn: Turn
  model: Provider.Model
  budget: number
  estimate: (input: { messages: SessionV1.WithParts[]; model: Provider.Model }) => Effect.Effect<number>
}) {
  return Effect.gen(function* () {
    if (input.budget <= 0) return undefined
    if (input.turn.end - input.turn.start <= 1) return undefined
    for (let start = input.turn.start + 1; start < input.turn.end; start++) {
      const size = yield* input.estimate({
        messages: input.messages.slice(start, input.turn.end),
        model: input.model,
      })
      if (size > input.budget) continue
      return {
        start,
        id: input.messages[start]!.info.id,
      } satisfies Tail
    }
    return undefined
  })
}

export interface Interface {
  readonly isOverflow: (input: {
    tokens: SessionV1.Assistant["tokens"]
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
  readonly process: (input: {
    parentID: MessageID
    messages: SessionV1.WithParts[]
    sessionID: SessionID
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<"continue" | "stop">
  readonly create: (input: {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
    auto: boolean
    overflow?: boolean
    manual_keep_turns?: number
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const session = yield* Session.Service
    const agents = yield* Agent.Service
    const plugin = yield* Plugin.Service
    const processors = yield* SessionProcessor.Service
    const provider = yield* Provider.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service

    const publishProgress = Effect.fn("SessionCompaction.progress")(function* (input: {
      sessionID: SessionID
      stage: ProgressStage
      message: string
      model?: ProgressModel
      judge?: ProgressJudge
      profile?: ProgressProfile
    }) {
      yield* events.publish(Event.Progress, {
        sessionID: input.sessionID,
        stage: input.stage,
        message: input.message,
        ...(input.model ? { model: input.model } : {}),
        ...(input.judge ? { judge: input.judge } : {}),
        ...(input.profile ? { profile: input.profile } : {}),
      })
    })

    function modelProgress(
      model: Pick<Provider.Model, "providerID" | "id">,
      variant?: string,
    ): NonNullable<ProgressModel> {
      return {
        providerID: model.providerID,
        modelID: model.id,
        ...(variant ? { variant } : {}),
      }
    }

    function profileProgress(profile: Decision): NonNullable<ProgressProfile> {
      return {
        source: profile.source,
        risk: profile.risk,
        profiles: profile.profiles.map((item) => ({ type: item.type, weight: item.weight })),
        mustPreserve: profile.must_preserve,
      }
    }

    const isOverflow = Effect.fn("SessionCompaction.isOverflow")(function* (input: {
      tokens: SessionV1.Assistant["tokens"]
      model: Provider.Model
    }) {
      return overflow({
        cfg: yield* config.get(),
        tokens: input.tokens,
        model: input.model,
        outputTokenMax: flags.outputTokenMax,
      })
    })

    const estimate = Effect.fn("SessionCompaction.estimate")(function* (input: {
      messages: SessionV1.WithParts[]
      model: Provider.Model
    }) {
      const msgs = yield* MessageV2.toModelMessagesEffect(input.messages, input.model)
      return Token.estimate(JSON.stringify(msgs))
    })

    const select = Effect.fn("SessionCompaction.select")(function* (input: {
      messages: SessionV1.WithParts[]
      cfg: ConfigV1.Info
      model: Provider.Model
      retention: RetentionRequest
    }) {
      const limit = input.retention.turns
      if (limit <= 0) return { head: input.messages, tail_start_id: undefined }
      const budget = preserveRecentBudget({ cfg: input.cfg, model: input.model })
      const all = turns(input.messages)
      if (!all.length) return { head: input.messages, tail_start_id: undefined }
      const recent = all.slice(-limit)
      const sizes = yield* Effect.forEach(
        recent,
        (turn) =>
          estimate({
            messages: input.messages.slice(turn.start, turn.end),
            model: input.model,
          }),
        { concurrency: 1 },
      )

      let total = 0
      let keep: Tail | undefined
      for (let i = recent.length - 1; i >= 0; i--) {
        const turn = recent[i]!
        const size = sizes[i]
        if (total + size <= budget) {
          total += size
          keep = { start: turn.start, id: turn.id }
          continue
        }
        const remaining = budget - total
        const split = yield* splitTurn({
          messages: input.messages,
          turn,
          model: input.model,
          budget: remaining,
          estimate,
        })
        if (split) keep = split
        else if (!keep) {
          yield* Effect.logInfo("tail fallback", { budget, size, total })
        }
        break
      }

      if (!keep || keep.start === 0) return { head: input.messages, tail_start_id: undefined }
      return {
        head: input.messages.slice(0, keep.start),
        tail_start_id: keep.id,
      }
    })

    const judgeProfile = Effect.fn("SessionCompaction.profileJudge")(function* (input: {
      messages: readonly SessionV1.WithParts[]
      previousSummary?: string
      currentModel: Provider.Model
      sessionID: SessionID
    }) {
      const cfg = yield* config.get()
      const result = yield* JsonJudge.runJsonJudge<Decision>({
        name: "compaction profile",
        sessionID: input.sessionID,
        provider,
        config: cfg.task_policy?.judges?.compaction_profile,
        messages: CompactionProfile.judgeMessages({
          messages: input.messages,
          previousSummary: input.previousSummary,
        }),
        parse: CompactionProfile.parseJudgeOutput,
        modelCandidates: PROFILE_JUDGE_FALLBACKS,
        currentModel: input.currentModel,
        includeCurrentModel: true,
        smallModelProviderID: input.currentModel.providerID,
        timeoutMs: PROFILE_JUDGE_TIMEOUT_MS,
        maxOutputTokens: (model) => ProviderTransform.maxOutputTokens(model, flags.outputTokenMax),
        onSelected: (model) =>
          publishProgress({
            sessionID: input.sessionID,
            stage: "judge_started",
            message: "Compaction profile judge started",
            model: modelProgress(model),
            judge: {
              status: "skipped",
              providerID: model.providerID,
              modelID: model.id,
            },
          }),
      })

      const model = result.model ? modelProgress(result.model) : undefined
      const progressJudge: ProgressJudge = {
        status: result.status === "disabled" ? "skipped" : result.status,
        ...(result.model
          ? {
              providerID: result.model.providerID,
              modelID: result.model.id,
            }
          : {}),
        ...(result.elapsedMs !== undefined ? { elapsedMs: result.elapsedMs } : {}),
        ...(result.error
          ? { error: result.status === "invalid" ? `invalid output: ${result.error}` : result.error }
          : {}),
      }
      yield* publishProgress({
        sessionID: input.sessionID,
        stage: "judge_result",
        message:
          result.status === "valid"
            ? "Compaction judge returned a valid profile"
            : result.status === "invalid"
              ? "Compaction judge returned invalid JSON; using heuristic profile"
              : result.status === "disabled"
                ? "Compaction judge disabled; using heuristic profile"
                : result.status === "unavailable"
                  ? "Compaction judge unavailable; using heuristic profile"
                  : "Compaction judge failed; using heuristic profile",
        model,
        judge: progressJudge,
      })
      return {
        status: progressJudge.status,
        decision: result.decision,
        model,
        elapsedMs: result.elapsedMs,
        error: result.error,
      } satisfies ProfileJudgeResult
    })

    const extractActiveTask = Effect.fn("SessionCompaction.activeTaskExtract")(function* (input: {
      messages: readonly SessionV1.WithParts[]
      previousSummary?: string
      currentModel: Provider.Model
      sessionID: SessionID
      decision: Decision
    }) {
      const cfg = yield* config.get()
      if (!input.decision.active_task.present) {
        return { status: "skipped" } satisfies ActiveTaskExtractResult
      }

      const result = yield* JsonJudge.runJsonJudge<ActiveTaskEssential>({
        name: "compaction active task extraction",
        sessionID: input.sessionID,
        provider,
        config: cfg.task_policy?.judges?.compaction_active_task,
        messages: CompactionProfile.activeTaskMessages({
          messages: input.messages,
          previousSummary: input.previousSummary,
          decision: input.decision,
        }),
        parse: (text) => CompactionProfile.parseActiveTaskOutput(text, input.decision),
        modelCandidates: ACTIVE_TASK_EXTRACT_FALLBACKS,
        currentModel: input.currentModel,
        includeCurrentModel: true,
        smallModelProviderID: input.currentModel.providerID,
        timeoutMs: ACTIVE_TASK_EXTRACT_TIMEOUT_MS,
        maxOutputTokens: (model) =>
          Math.min(ProviderTransform.maxOutputTokens(model, flags.outputTokenMax), ACTIVE_TASK_EXTRACT_MAX_OUTPUT_TOKENS),
        onSelected: (model) =>
          publishProgress({
            sessionID: input.sessionID,
            stage: "active_task_extract_started",
            message: "Active task essential extraction started",
            model: modelProgress(model),
            judge: {
              status: "skipped",
              providerID: model.providerID,
              modelID: model.id,
            },
          }),
      })

      const model = result.model ? modelProgress(result.model) : undefined
      const progressJudge: ProgressJudge = {
        status: result.status === "disabled" ? "skipped" : result.status,
        ...(result.model
          ? {
              providerID: result.model.providerID,
              modelID: result.model.id,
            }
          : {}),
        ...(result.elapsedMs !== undefined ? { elapsedMs: result.elapsedMs } : {}),
        ...(result.error
          ? { error: result.status === "invalid" ? `invalid output: ${result.error}` : result.error }
          : {}),
      }
      const activeTask = result.decision ?? CompactionProfile.fallbackActiveTask({ decision: input.decision })
      yield* publishProgress({
        sessionID: input.sessionID,
        stage: "active_task_extract_result",
        message:
          result.status === "valid"
            ? CompactionProfile.describeActiveTaskEssential(activeTask)
            : result.status === "disabled"
              ? "Active task extraction disabled; using profile fallback"
              : result.status === "unavailable"
                ? "Active task extraction unavailable; using profile fallback"
                : result.status === "invalid"
                  ? "Active task extraction returned invalid JSON; using profile fallback"
                  : "Active task extraction failed; using profile fallback",
        model,
        judge: progressJudge,
      })
      return {
        status: progressJudge.status,
        activeTask,
        model,
        elapsedMs: result.elapsedMs,
        error: result.error,
      } satisfies ActiveTaskExtractResult
    })

    // goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
    // calls, then erases output of older tool calls to free context space
    const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
      const cfg = yield* config.get()
      if (!cfg.compaction?.prune) return
      yield* Effect.logInfo("pruning")

      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
      if (!msgs) return

      let total = 0
      let pruned = 0
      const toPrune: SessionV1.ToolPart[] = []
      let turns = 0

      loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex]
        if (msg.info.role === "user") turns++
        if (turns < 2) continue
        if (msg.info.role === "assistant" && msg.info.summary) break loop
        for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = msg.parts[partIndex]
          if (part.type !== "tool") continue
          if (part.state.status !== "completed") continue
          if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
          if (part.state.time.compacted) break loop
          const estimate = Token.estimate(part.state.output)
          total += estimate
          if (total <= PRUNE_PROTECT) continue
          pruned += estimate
          toPrune.push(part)
        }
      }

      yield* Effect.logInfo("found", { pruned, total })
      if (pruned > PRUNE_MINIMUM) {
        for (const part of toPrune) {
          if (part.state.status === "completed") {
            part.state.time.compacted = Date.now()
            yield* session.updatePart(part)
          }
        }
        yield* Effect.logInfo("pruned", { count: toPrune.length })
      }
    })

    const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: {
      parentID: MessageID
      messages: SessionV1.WithParts[]
      sessionID: SessionID
      auto: boolean
      overflow?: boolean
    }) {
      const parent = input.messages.findLast((m) => m.info.id === input.parentID)
      if (!parent || parent.info.role !== "user") {
        throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
      }
      const userMessage = parent.info
      const compactionPart = parent.parts.find((part): part is SessionV1.CompactionPart => part.type === "compaction")
      yield* publishProgress({
        sessionID: input.sessionID,
        stage: "started",
        message: `${input.auto ? "Auto" : "Manual"} compaction started${input.overflow ? " after context overflow" : ""}`,
        model: {
          providerID: userMessage.model.providerID,
          modelID: userMessage.model.modelID,
          ...(userMessage.model.variant ? { variant: userMessage.model.variant } : {}),
        },
      })

      let messages = input.messages
      let replay:
        | {
            info: SessionV1.User
            parts: SessionV1.Part[]
          }
        | undefined
      if (input.overflow) {
        const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
        for (let i = idx - 1; i >= 0; i--) {
          const msg = input.messages[i]
          if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
            replay = { info: msg.info, parts: msg.parts }
            messages = input.messages.slice(0, i)
            break
          }
        }
        const hasContent =
          replay && messages.some((m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"))
        if (!hasContent) {
          replay = undefined
          messages = input.messages
        }
      }

      const cfg = yield* config.get()
      const agent = yield* agents.get("compaction")
      const inheritedRef = agent.model ?? {
        providerID: userMessage.model.providerID,
        modelID: userMessage.model.modelID,
      }
      const inheritedModel = yield* provider.getModel(inheritedRef.providerID, inheritedRef.modelID).pipe(Effect.orDie)
      const taskPolicy = agent.model
        ? undefined
        : yield* TaskPolicy.select({
            cfg,
            provider,
            agent,
            inherited: inheritedRef,
            description: "compact conversation history",
            prompt: "Summarize prior conversation with enough detail for future coding work.",
            command: input.auto ? "auto-compaction" : "manual-compaction",
            kindHint: "compaction",
            complexityHint: "medium",
          })
      const policyModel = taskPolicy?.route.inherit ? undefined : taskPolicy?.route.model
      const model = policyModel
        ? yield* provider.getModel(policyModel.providerID, policyModel.modelID).pipe(Effect.orDie)
        : inheritedModel
      const routeVariant = agent.model ? undefined : taskPolicy?.route.variant
      const sameAsOriginalModel =
        model.providerID === userMessage.model.providerID && model.id === userMessage.model.modelID
      const routedUserMessage: SessionV1.User = {
        ...userMessage,
        model: {
          providerID: model.providerID,
          modelID: model.id,
          variant: routeVariant ?? (sameAsOriginalModel ? userMessage.model.variant : undefined),
        },
      }
      yield* publishProgress({
        sessionID: input.sessionID,
        stage: "route",
        message: taskPolicy
          ? `Compaction routed by task policy: ${taskPolicy.assignment.kind}.${taskPolicy.assignment.complexity} via ${taskPolicy.requested}`
          : agent.model
            ? "Compaction using agent-configured model"
            : "Compaction using inherited model",
        model: modelProgress(model, routedUserMessage.model.variant),
      })
      const history = compactionPart && messages.at(-1)?.info.id === input.parentID ? messages.slice(0, -1) : messages
      const prior = completedCompactions(history)
      const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
      const previousSummary = prior.at(-1)?.summary
      const visibleHistory = history.filter((_, index) => !hidden.has(index))
      const retention = retentionRequest({
        cfg,
        manualKeepTurns: compactionPart?.manual_keep_turns,
      })
      yield* publishProgress({
        sessionID: input.sessionID,
        stage: "strategy",
        message: "general summary + active task essential extraction + minimal raw recent tail",
      })
      yield* publishProgress({
        sessionID: input.sessionID,
        stage: "retention",
        message: `${retention.message} (${retention.source})`,
      })
      const selected = yield* select({
        messages: visibleHistory,
        cfg,
        model,
        retention,
      })
      const retainedMessages = Math.max(0, visibleHistory.length - selected.head.length)
      yield* publishProgress({
        sessionID: input.sessionID,
        stage: "selection",
        message: [
          `summary head ${selected.head.length}/${visibleHistory.length} messages`,
          `retained tail ${retainedMessages} messages`,
          `requested raw tail ${retention.turns} turn${retention.turns === 1 ? "" : "s"}`,
          selected.tail_start_id ? `tail starts at ${selected.tail_start_id}` : "tail not retained",
          previousSummary ? "previous summary yes" : "previous summary no",
        ].join(" - "),
      })
      // Allow plugins to inject context or replace compaction prompt.
      const compacting = yield* plugin.trigger(
        "experimental.session.compacting",
        { sessionID: input.sessionID },
        { context: [], prompt: undefined },
      )
      let profile: Decision | undefined
      let activeTask: ActiveTaskEssential | undefined
      if (compacting.prompt) {
        yield* publishProgress({
          sessionID: input.sessionID,
          stage: "profile_ready",
          message: "Compaction profile skipped because a plugin supplied the prompt",
          judge: { status: "skipped" },
        })
      } else {
        const judged = yield* judgeProfile({
          messages: visibleHistory,
          previousSummary,
          currentModel: model,
          sessionID: input.sessionID,
        })
        const readyProfile =
          judged.decision ??
          CompactionProfile.infer({
            messages: visibleHistory,
            previousSummary,
          })
        profile = readyProfile
        yield* publishProgress({
          sessionID: input.sessionID,
          stage: "profile_ready",
          message: `Compaction profile ready from ${readyProfile.source}`,
          profile: profileProgress(readyProfile),
        })
        yield* publishProgress({
          sessionID: input.sessionID,
          stage: "active_task",
          message: readyProfile.active_task.present
            ? `${readyProfile.active_task.kind}, window ${readyProfile.active_task.window_turns} turns - ${readyProfile.active_task.reason}`
            : "none detected",
        })
        const extracted = yield* extractActiveTask({
          messages: visibleHistory,
          previousSummary,
          currentModel: model,
          sessionID: input.sessionID,
          decision: readyProfile,
        })
        activeTask = extracted.activeTask
      }
      if (profile) {
        yield* Effect.logInfo("compaction profile", {
          "session.id": input.sessionID,
          profiles: JSON.stringify(profile.profiles),
          mustPreserve: profile.must_preserve.join("; "),
          risk: profile.risk,
          source: profile.source,
        })
      }
      if (activeTask) {
        yield* Effect.logInfo("compaction active task", {
          "session.id": input.sessionID,
          source: activeTask.source,
          kind: activeTask.kind,
          objective: activeTask.objective,
          status: activeTask.status,
          files: activeTask.files.join("; "),
          nextActions: activeTask.next_actions.join("; "),
        })
      }
      const nextPrompt =
        compacting.prompt ??
        CompactionProfile.buildPrompt({
          previousSummary,
          context: compacting.context,
          decision: profile ?? CompactionProfile.normalize(undefined),
          activeTask,
        })
      const msgs = structuredClone(selected.head)
      yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
      const modelMessages = yield* MessageV2.toModelMessagesEffect(msgs, model, {
        stripMedia: true,
        toolOutputMaxChars: TOOL_OUTPUT_MAX_CHARS,
      })
      const ctx = yield* InstanceState.context
      const msg: SessionV1.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        parentID: input.parentID,
        sessionID: input.sessionID,
        mode: "compaction",
        agent: "compaction",
        variant: routedUserMessage.model.variant,
        summary: true,
        path: {
          cwd: ctx.directory,
          root: ctx.worktree,
        },
        cost: 0,
        tokens: {
          output: 0,
          input: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: model.id,
        providerID: model.providerID,
        time: {
          created: Date.now(),
        },
      }
      yield* publishProgress({
        sessionID: input.sessionID,
        stage: "summary_started",
        message: "Compaction summary generation started",
        model: modelProgress(model, routedUserMessage.model.variant),
      })
      yield* session.updateMessage(msg)
      const processor = yield* processors.create({
        assistantMessage: msg,
        sessionID: input.sessionID,
        model,
      })
      const result = yield* processor.process({
        user: routedUserMessage,
        agent,
        sessionID: input.sessionID,
        tools: {},
        system: [],
        messages: [
          ...modelMessages,
          {
            role: "user",
            content: [{ type: "text", text: nextPrompt }],
          },
        ],
        model,
      })

      if (result === "compact") {
        yield* publishProgress({
          sessionID: input.sessionID,
          stage: "summary_failed",
          message: replay
            ? "Compaction summary exceeded context after replay trimming"
            : "Compaction summary exceeded context after media stripping",
          model: modelProgress(model, routedUserMessage.model.variant),
        })
        processor.message.error = new SessionV1.ContextOverflowError({
          message: replay
            ? "Conversation history too large to compact - exceeds model context limit"
            : "Session too large to compact - context exceeds model limit even after stripping media",
        }).toObject()
        processor.message.finish = "error"
        yield* session.updateMessage(processor.message)
        return "stop"
      }

      if (compactionPart && selected.tail_start_id && compactionPart.tail_start_id !== selected.tail_start_id) {
        yield* session.updatePart({
          ...compactionPart,
          tail_start_id: selected.tail_start_id,
        })
      }

      if (result === "continue" && input.auto) {
        if (replay) {
          const original = replay.info
          const replayMsg = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: input.sessionID,
            time: { created: Date.now() },
            agent: original.agent,
            model: original.model,
            format: original.format,
            tools: original.tools,
            system: original.system,
          })
          for (const part of replay.parts) {
            if (part.type === "compaction") continue
            const replayPart =
              part.type === "file" && MessageV2.isMedia(part.mime)
                ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
                : part
            yield* session.updatePart({
              ...replayPart,
              id: PartID.ascending(),
              messageID: replayMsg.id,
              sessionID: input.sessionID,
            })
          }
        }

        if (!replay) {
          const info = yield* provider.getProvider(userMessage.model.providerID)
          if (
            (yield* plugin.trigger(
              "experimental.compaction.autocontinue",
              {
                sessionID: input.sessionID,
                agent: userMessage.agent,
                model: yield* provider
                  .getModel(userMessage.model.providerID, userMessage.model.modelID)
                  .pipe(Effect.orDie),
                provider: {
                  source: info.source,
                  info,
                  options: info.options,
                },
                message: userMessage,
                overflow: input.overflow === true,
              },
              { enabled: true },
            )).enabled
          ) {
            const continueMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: userMessage.agent,
              model: userMessage.model,
            })
            const text =
              (input.overflow
                ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
                : "") +
              "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: continueMsg.id,
              sessionID: input.sessionID,
              type: "text",
              // Internal marker for auto-compaction followups so provider plugins
              // can distinguish them from manual post-compaction user prompts.
              // This is not a stable plugin contract and may change or disappear.
              metadata: { compaction_continue: true },
              synthetic: true,
              text,
              time: {
                start: Date.now(),
                end: Date.now(),
              },
            })
          }
        }
      }

      if (processor.message.error) {
        yield* publishProgress({
          sessionID: input.sessionID,
          stage: "summary_failed",
          message: "Compaction summary generation failed",
          model: modelProgress(model, routedUserMessage.model.variant),
        })
        return "stop"
      }
      if (result === "continue") {
        yield* publishProgress({
          sessionID: input.sessionID,
          stage: "summary_finished",
          message: "Compaction summary generation finished",
          model: modelProgress(model, routedUserMessage.model.variant),
        })
        yield* events.publish(Event.Compacted, { sessionID: input.sessionID })
      }
      return result
    })

    const create = Effect.fn("SessionCompaction.create")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      auto: boolean
      overflow?: boolean
      manual_keep_turns?: number
    }) {
      const msg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: Date.now() },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
        manual_keep_turns: input.manual_keep_turns,
      })
    })

    return Service.of({
      isOverflow,
      prune,
      process: processCompaction,
      create,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    Config.node,
    Session.node,
    Agent.node,
    Plugin.node,
    SessionProcessor.node,
    Provider.node,
    EventV2Bridge.node,
    RuntimeFlags.node,
  ],
})

export * as SessionCompaction from "./compaction"
