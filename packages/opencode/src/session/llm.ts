import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { llmClient } from "@opencode-ai/core/effect/app-node-platform"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Provider } from "@/provider/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Context, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { APICallError, streamText, wrapLanguageModel, type ModelMessage, type Tool } from "ai"
import type { LLMEvent } from "@opencode-ai/llm"
import { LLMClient } from "@opencode-ai/llm/route"
import type { LLMClientService } from "@opencode-ai/llm/route"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { Permission } from "@/permission"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { Wildcard } from "@/util/wildcard"
import { SessionID } from "@/session/schema"
import { Auth } from "@/auth"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { LLMAISDK } from "./llm/ai-sdk"
import { LLMNativeRuntime } from "./llm/native-runtime"
import { LLMRequestPrep } from "./llm/request"
import * as OutputBudget from "./llm/budget"
import { AutoMaxTokensJudge } from "./judge/auto-maxtokens"
import { SystemSoul } from "./soul"

export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

export type StreamInput = {
  user: SessionV1.User
  sessionID: string
  parentSessionID?: string
  model: Provider.Model
  agent: Agent.Info
  permission?: PermissionV1.Ruleset
  system: string[]
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
}

export type StreamRequest = StreamInput & {
  abort: AbortSignal
}

export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<LLMEvent, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM") {}

export const use = serviceUse(Service)

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

type TelemetryUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cacheReadInputTokens?: number
  cacheWriteInputTokens?: number
}

function telemetryUsage(value: unknown): TelemetryUsage | undefined {
  const item = asRecord(value)
  if (!item) return undefined
  const inputTokenDetails = asRecord(item.inputTokenDetails)
  const outputTokenDetails = asRecord(item.outputTokenDetails)
  const usage = {
    inputTokens: item.inputTokens,
    outputTokens: item.outputTokens,
    totalTokens: item.totalTokens,
    reasoningTokens: outputTokenDetails?.reasoningTokens ?? item.reasoningTokens,
    cacheReadInputTokens: inputTokenDetails?.cacheReadTokens ?? item.cachedInputTokens,
    cacheWriteInputTokens: inputTokenDetails?.cacheWriteTokens,
  }
  return Object.fromEntries(Object.entries(usage).filter((entry) => typeof entry[1] === "number")) as TelemetryUsage
}

function truncateLogText(value: string | undefined, max = 4_000) {
  if (!value) return undefined
  return value.length > max ? `${value.slice(0, max)}...[truncated ${value.length - max} chars]` : value
}

function headerValue(headers: Record<string, string> | undefined, names: string[]) {
  if (!headers) return undefined
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  for (const name of names) {
    const value = normalized.get(name.toLowerCase())
    if (value) return value
  }
  return undefined
}

function apiCallErrorDetails(error: unknown): Record<string, unknown> {
  if (!APICallError.isInstance(error)) return { error }
  return {
    errorName: error.name,
    errorMessage: error.message,
    statusCode: error.statusCode,
    isRetryable: error.isRetryable,
    url: error.url,
    requestID: headerValue(error.responseHeaders, [
      "x-request-id",
      "x-volc-request-id",
      "x-tt-logid",
      "x-tt-trace-id",
      "x-b3-traceid",
    ]),
    responseHeaders: error.responseHeaders,
    responseBody: truncateLogText(error.responseBody),
    data: error.data,
  }
}

function createStreamTelemetry(
  input: StreamRequest,
  maxOutputTokens: number | undefined,
): (event: unknown) => Effect.Effect<void> {
  const startedAt = Date.now()
  let firstReasoningMs: number | undefined
  let firstTextMs: number | undefined
  let firstToolMs: number | undefined

  return (event: unknown): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (input.small) return
      const item = asRecord(event)
      if (!item) return
      const type = typeof item.type === "string" ? item.type : undefined
      if (!type) return

      const elapsedMs = Date.now() - startedAt
      const base = {
        providerID: input.model.providerID,
        modelID: input.model.id,
        "session.id": input.sessionID,
        agent: input.agent.name,
        mode: input.agent.mode,
        maxOutputTokens,
      }

      if (firstReasoningMs === undefined && type === "reasoning-delta") {
        firstReasoningMs = elapsedMs
        const text = typeof item.text === "string" ? item.text : ""
        yield* Effect.logInfo("llm stream first reasoning token", {
          ...base,
          firstReasoningMs,
          chunkChars: text.length,
        })
      }

      if (firstTextMs === undefined && type === "text-delta") {
        firstTextMs = elapsedMs
        const text = typeof item.text === "string" ? item.text : ""
        yield* Effect.logInfo("llm stream first text token", {
          ...base,
          firstTextMs,
          chunkChars: text.length,
          firstReasoningMs,
        })
      }

      if (firstToolMs === undefined && (type === "tool-call" || type === "tool-input-start")) {
        firstToolMs = elapsedMs
        yield* Effect.logInfo("llm stream first tool event", {
          ...base,
          firstToolMs,
          firstReasoningMs,
          firstTextMs,
          tool: typeof item.toolName === "string" ? item.toolName : undefined,
        })
      }

      if (type === "finish-step" || type === "finish") {
        const usage = telemetryUsage(type === "finish" ? item.totalUsage : item.usage)
        yield* Effect.logInfo("llm stream finish", {
          ...base,
          event: type,
          elapsedMs,
          finishReason: typeof item.finishReason === "string" ? item.finishReason : undefined,
          rawFinishReason: typeof item.rawFinishReason === "string" ? item.rawFinishReason : undefined,
          providerMetadataKeys:
            item.providerMetadata && typeof item.providerMetadata === "object"
              ? Object.keys(item.providerMetadata as Record<string, unknown>)
              : undefined,
          firstReasoningMs,
          firstTextMs,
          firstToolMs,
          "usage.inputTokens": usage?.inputTokens,
          "usage.outputTokens": usage?.outputTokens,
          "usage.reasoningTokens": usage?.reasoningTokens,
          "usage.totalTokens": usage?.totalTokens,
          "usage.cacheReadInputTokens": usage?.cacheReadInputTokens,
          "usage.cacheWriteInputTokens": usage?.cacheWriteInputTokens,
        })
      }
    })
}

const live: Layer.Layer<
  Service,
  never,
  | Auth.Service
  | Config.Service
  | Provider.Service
  | Plugin.Service
  | Permission.Service
  | EventV2Bridge.Service
  | LLMClientService
  | RuntimeFlags.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const plugin = yield* Plugin.Service
    const perm = yield* Permission.Service
    const events = yield* EventV2Bridge.Service
    const llmClient = yield* LLMClient.Service
    const flags = yield* RuntimeFlags.Service

    const run = Effect.fn("LLM.run")(function* (input: StreamRequest) {
      yield* Effect.logInfo("stream", {
        providerID: input.model.providerID,
        modelID: input.model.id,
        "session.id": input.sessionID,
        small: (input.small ?? false).toString(),
        agent: input.agent.name,
        mode: input.agent.mode,
      })

      const [language, cfg, item, info] = yield* Effect.all(
        [
          provider.getLanguage(input.model),
          config.get(),
          provider.getProvider(input.model.providerID),
          auth.get(input.model.providerID),
        ],
        { concurrency: "unbounded" },
      )

      const isWorkflow = language instanceof GitLabWorkflowLanguageModel
      const ctx = yield* InstanceState.context
      const soulPrompt = input.agent.prompt
        ? undefined
        : yield* SystemSoul.resolve({
            config: cfg.soul,
            directory: ctx.directory,
            worktree: ctx.worktree,
          }).pipe(
            Effect.catch((error) =>
              Effect.logWarning("openchinacode soul prompt resolution failed", {
                error: String(error),
                "session.id": input.sessionID,
              }).pipe(Effect.as(undefined)),
            ),
          )
      const prepared = yield* LLMRequestPrep.prepare({
        ...input,
        provider: item,
        auth: info,
        plugin,
        flags,
        isWorkflow,
        autoMaxTokens: cfg.auto_maxtokens,
        soulPrompt,
      })
      const outputDecision = ProviderTransform.maxOutputDecision({
        model: input.model,
        outputTokenMax: flags.outputTokenMax,
        messages: prepared.messages,
        variant: input.user.model.variant,
        autoMaxTokens: cfg.auto_maxtokens,
        agentMode: input.agent.mode,
        toolCount: Object.keys(prepared.tools).length,
      })
      let maxOutputTokens = prepared.params.maxOutputTokens
      let outputLevel = outputDecision?.level
      if (!input.small && outputDecision?.needsJudge && outputDecision.policy) {
        const judged = yield* AutoMaxTokensJudge.run({
          provider,
          taskPolicyJudge: cfg.task_policy?.judges?.auto_maxtokens,
          autoMaxTokens: cfg.auto_maxtokens,
          currentModel: input.model,
          decision: outputDecision,
          messages: prepared.messages,
          agent: input.agent,
          toolCount: Object.keys(prepared.tools).length,
          sessionID: input.sessionID,
          abort: input.abort,
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("auto-maxtokens judge failed", {
              error: String(error),
              "session.id": input.sessionID,
            }).pipe(Effect.as(undefined)),
          ),
        )
        if (judged) {
          outputLevel = judged
          maxOutputTokens = judged === "max" ? outputDecision.policy.max : outputDecision.policy.default
        }
      }

      if (!input.small) {
        const budget = OutputBudget.apply({
          model: input.model,
          messages: prepared.messages,
          tools: prepared.tools,
          maxOutputTokens,
          outputDecision,
          outputLevel,
        })
        yield* Effect.logInfo("llm token budget", {
          providerID: input.model.providerID,
          modelID: input.model.id,
          "session.id": input.sessionID,
          agent: input.agent.name,
          mode: input.agent.mode,
          variant: input.user.model.variant,
          contextLimit: input.model.limit.context,
          inputLimit: input.model.limit.input,
          outputLimit: input.model.limit.output,
          toolCount: Object.keys(prepared.tools).length,
          autoMaxTokensMode: outputDecision?.mode,
          outputDecisionLevel: outputLevel,
          outputDecisionReasons: outputDecision?.reasons.join(","),
          policyDefaultOutputTokens: outputDecision?.policy?.default,
          policyMaxOutputTokens: outputDecision?.policy?.max,
          targetMaxOutputTokens: maxOutputTokens,
          promptTokens: budget.promptTokens,
          availableOutputTokens: budget.availableOutputTokens,
          minUsefulOutputTokens: budget.minUsefulOutputTokens,
          action: budget.action,
          compactReason: budget.action === "compact" ? budget.reason : undefined,
          finalMaxOutputTokens: budget.action === "use" ? budget.maxOutputTokens : undefined,
          clamped: budget.action === "use" ? budget.clamped : undefined,
        })
        if (budget.action === "compact") {
          yield* Effect.logInfo("output budget requires compaction", {
            providerID: input.model.providerID,
            modelID: input.model.id,
            "session.id": input.sessionID,
            reason: budget.reason,
            promptTokens: budget.promptTokens,
            availableOutputTokens: budget.availableOutputTokens,
            minUsefulOutputTokens: budget.minUsefulOutputTokens,
            targetOutputTokens: budget.targetOutputTokens,
          })
          return yield* Effect.fail(
            new SessionV1.ContextOverflowError({
              message: "Conversation history leaves too little output budget for this model; compacting before retry.",
            }),
          )
        }
        if (budget.clamped) {
          yield* Effect.logInfo("output budget clamped", {
            providerID: input.model.providerID,
            modelID: input.model.id,
            "session.id": input.sessionID,
            promptTokens: budget.promptTokens,
            availableOutputTokens: budget.availableOutputTokens,
            minUsefulOutputTokens: budget.minUsefulOutputTokens,
            maxOutputTokens: budget.maxOutputTokens,
          })
        }
        if (budget.maxOutputTokens !== undefined) maxOutputTokens = budget.maxOutputTokens
      }

      // Wire up toolExecutor for DWS workflow models so that tool calls
      // from the workflow service are executed via opencode's tool system
      // and results sent back over the WebSocket.
      const bridge = yield* EffectBridge.make()
      if (language instanceof GitLabWorkflowLanguageModel) {
        const workflowModel = language as GitLabWorkflowLanguageModel & {
          sessionID?: string
          sessionPreapprovedTools?: string[]
          approvalHandler?: (approvalTools: { name: string; args: string }[]) => Promise<{ approved: boolean }>
        }
        workflowModel.sessionID = input.sessionID
        workflowModel.systemPrompt = prepared.system.join("\n")
        workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
          const t = prepared.tools[toolName]
          if (!t || !t.execute) {
            return { result: "", error: `Unknown tool: ${toolName}` }
          }
          try {
            const result = await t.execute!(JSON.parse(argsJson), {
              toolCallId: _requestID,
              messages: input.messages,
              abortSignal: input.abort,
            })
            const output = typeof result === "string" ? result : (result?.output ?? JSON.stringify(result))
            return {
              result: output,
              metadata: typeof result === "object" ? result?.metadata : undefined,
              title: typeof result === "object" ? result?.title : undefined,
            }
          } catch (e: any) {
            return { result: "", error: e.message ?? String(e) }
          }
        }

        const ruleset = Permission.merge(input.agent.permission ?? [], input.permission ?? [])
        workflowModel.sessionPreapprovedTools = Object.keys(prepared.tools).filter((name) => {
          const match = ruleset.findLast((rule) => Wildcard.match(name, rule.permission))
          return !match || match.action !== "ask"
        })

        const approvedToolsForSession = new Set<string>()
        workflowModel.approvalHandler = bridge.bind(async (approvalTools) => {
          const uniqueNames = [...new Set(approvalTools.map((t: { name: string }) => t.name))] as string[]
          // Auto-approve tools that were already approved in this session
          // (prevents infinite approval loops for server-side MCP tools)
          if (uniqueNames.every((name) => approvedToolsForSession.has(name))) {
            return { approved: true }
          }

          const id = PermissionV1.ID.ascending()
          let unsub: EventV2.Unsubscribe | undefined
          try {
            unsub = await bridge.promise(
              events.listen((event) => {
                if (event.type !== Permission.Event.Replied.type) return Effect.void
                const data = event.data as EventV2.Data<typeof Permission.Event.Replied>
                if (data.requestID !== id) return Effect.void
                void data.reply
                return Effect.void
              }),
            )
            const toolPatterns = approvalTools.map((t: { name: string; args: string }) => {
              try {
                const parsed = JSON.parse(t.args) as Record<string, unknown>
                const title = (parsed?.title ?? parsed?.name ?? "") as string
                return title ? `${t.name}: ${title}` : t.name
              } catch {
                return t.name
              }
            })
            const uniquePatterns = [...new Set(toolPatterns)] as string[]
            await bridge.promise(
              perm.ask({
                id,
                sessionID: SessionID.make(input.sessionID),
                permission: "workflow_tool_approval",
                patterns: uniquePatterns,
                metadata: { tools: approvalTools },
                always: uniquePatterns,
                ruleset: [],
              }),
            )
            for (const name of uniqueNames) approvedToolsForSession.add(name)
            workflowModel.sessionPreapprovedTools = [...(workflowModel.sessionPreapprovedTools ?? []), ...uniqueNames]
            return { approved: true }
          } catch {
            return { approved: false }
          } finally {
            if (unsub) await bridge.promise(unsub)
          }
        })
      }

      const tracer = cfg.experimental?.openTelemetry
        ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
        : undefined
      const telemetryTracer = tracer
        ? new Proxy(tracer, {
            get(target, prop, receiver) {
              if (prop !== "startSpan") return Reflect.get(target, prop, receiver)
              return (...args: Parameters<typeof target.startSpan>) => {
                const span = target.startSpan(...args)
                span.setAttribute("session.id", input.sessionID)
                return span
              }
            },
          })
        : undefined

      // Runtime seam: native is an opt-in adapter over @opencode-ai/llm. It
      // either returns a ready LLMEvent stream or a concrete fallback reason.
      if (flags.experimentalNativeLlm) {
        const native = LLMNativeRuntime.stream({
          model: input.model,
          provider: item,
          auth: info,
          llmClient,
          messages: prepared.messages,
          tools: prepared.tools,
          toolChoice: input.toolChoice,
          temperature: prepared.params.temperature,
          topP: prepared.params.topP,
          topK: prepared.params.topK,
          maxOutputTokens,
          providerOptions: prepared.params.options,
          headers: prepared.headers,
          abort: input.abort,
        })
        if (native.type === "supported") {
          yield* Effect.logInfo("llm runtime selected", {
            "llm.runtime": "native",
            "llm.provider": input.model.providerID,
            "llm.model": input.model.id,
          })
          return {
            type: "native" as const,
            stream: native.stream,
          }
        }
        yield* Effect.logInfo("llm runtime selected", {
          "llm.runtime": "ai-sdk",
          "llm.provider": input.model.providerID,
          "llm.model": input.model.id,
          "llm.native_unsupported_reason": native.reason,
        })
        yield* Effect.logInfo("native runtime unavailable; falling back to ai-sdk", {
          providerID: input.model.providerID,
          modelID: input.model.id,
          "session.id": input.sessionID,
          small: (input.small ?? false).toString(),
          agent: input.agent.name,
          mode: input.agent.mode,
          reason: native.reason,
        })
      }

      yield* Effect.logInfo("llm runtime selected", {
        "llm.runtime": "ai-sdk",
        "llm.provider": input.model.providerID,
        "llm.model": input.model.id,
      })
      // Default runtime path: AI SDK owns provider execution and tool dispatch;
      // LLMAISDK.toLLMEvents below normalizes fullStream parts for the processor.
      return {
        type: "ai-sdk" as const,
        maxOutputTokens,
        result: streamText({
          onError(error) {
            bridge.fork(
              Effect.logError("stream error", {
                providerID: input.model.providerID,
                modelID: input.model.id,
                "session.id": input.sessionID,
                small: (input.small ?? false).toString(),
                agent: input.agent.name,
                mode: input.agent.mode,
                ...apiCallErrorDetails(error),
              }),
            )
          },
          // Copilot returns the authoritative billed amount only in provider-specific response fields.
          includeRawChunks: input.model.providerID.includes("github-copilot"),
          async experimental_repairToolCall(failed) {
            const lower = failed.toolCall.toolName.toLowerCase()
            if (lower !== failed.toolCall.toolName && prepared.tools[lower]) {
              return {
                ...failed.toolCall,
                toolName: lower,
              }
            }
            return {
              ...failed.toolCall,
              input: JSON.stringify({
                tool: failed.toolCall.toolName,
                error: failed.error.message,
              }),
              toolName: "invalid",
            }
          },
          temperature: prepared.params.temperature,
          topP: prepared.params.topP,
          topK: prepared.params.topK,
          providerOptions: ProviderTransform.providerOptions(input.model, prepared.params.options),
          activeTools: Object.keys(prepared.tools).filter((x) => x !== "invalid"),
          tools: prepared.tools,
          toolChoice: input.toolChoice,
          maxOutputTokens,
          abortSignal: input.abort,
          headers: prepared.headers,
          maxRetries: input.retries ?? 0,
          messages: prepared.messages,
          model: wrapLanguageModel({
            model: language,
            middleware: [
              {
                specificationVersion: "v3" as const,
                async transformParams(args) {
                  if (args.type === "stream") {
                    // @ts-expect-error
                    args.params.prompt = ProviderTransform.message(
                      args.params.prompt,
                      input.model,
                      prepared.messageTransformOptions,
                    )
                  }
                  return args.params
                },
              },
            ],
          }),
          experimental_telemetry: {
            isEnabled: cfg.experimental?.openTelemetry,
            functionId: "session.llm",
            tracer: telemetryTracer,
            metadata: {
              userId: cfg.username ?? "unknown",
              sessionId: input.sessionID,
            },
          },
        }),
      }
    })

    const stream: Interface["stream"] = (input) =>
      Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            const ctrl = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (ctrl) => Effect.sync(() => ctrl.abort()),
            )
            const request = { ...input, abort: ctrl.signal }

            const result = yield* run(request)

            if (result.type === "native") return result.stream

            // Adapter seam: both runtimes expose the same LLMEvent stream. Native
            // already returns one; AI SDK streams are converted here.
            const state = LLMAISDK.adapterState()
            const telemetry = createStreamTelemetry(request, result.maxOutputTokens)
            return Stream.fromAsyncIterable(result.result.fullStream, (e) =>
              e instanceof Error ? e : new Error(String(e)),
            ).pipe(
              Stream.mapEffect((event) =>
                Effect.gen(function* () {
                  yield* telemetry(event)
                  return yield* LLMAISDK.toLLMEvents(state, event)
                }),
              ),
              Stream.flatMap((events) => Stream.fromIterable(events)),
            )
          }),
        ),
      )

    return Service.of({ stream })
  }),
)

export const hasToolCalls = LLMRequestPrep.hasToolCalls

export const node = LayerNode.make({
  service: Service,
  layer: live,
  deps: [
    Auth.node,
    Config.node,
    Provider.node,
    Plugin.node,
    Permission.node,
    EventV2Bridge.node,
    llmClient,
    RuntimeFlags.node,
  ],
})

export * as LLM from "./llm"
