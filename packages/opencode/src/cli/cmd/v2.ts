import { EOL } from "node:os"
import path from "node:path"
import type { Argv } from "yargs"
import { Duration, Effect, Layer } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
import { Auth as LegacyAuth } from "@/auth"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap, buildLocationServiceMap } from "@opencode-ai/core/location-services"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import type { Message as V2Message } from "@opencode-ai/core/session/message"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import * as SessionExecutionLocal from "@opencode-ai/core/session/execution/local"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { effectCmd, fail } from "../effect-cmd"

type Args = {
  prompt?: string[]
  model?: string
  session?: string
  cwd?: string
  json?: boolean
}

const DEFAULT_MODEL = "zhipuai-pay2go/glm-5.2#max"
const V2_AGENT_ID = AgentV2.ID.make("v2-basic")
const CATALOG_WAIT_ATTEMPTS = 100
const CATALOG_WAIT_DELAY = Duration.millis(50)

const parseModelRef = (input: string): ModelV2.Ref => {
  const [base, variant] = input.split("#", 2)
  if (!base || !base.includes("/")) throw new Error(`Invalid model reference: ${input}`)
  const parsed = ModelV2.parse(base)
  return {
    providerID: parsed.providerID,
    id: parsed.modelID,
    ...(variant ? { variant: ModelV2.VariantID.make(variant) } : {}),
  }
}

const textOnlyAgent = (model: ModelV2.Ref) => {
  const info: AgentV2.Info = {
    id: V2_AGENT_ID,
    model,
    request: { headers: {}, body: {} },
    system:
      "You are OpenChinaCode V2 basic runner. Answer directly and do not request or simulate tool use. This experimental mode validates the V2 session runner only.",
    description: "OpenChinaCode V2 phase-1 text-only experimental agent.",
    mode: "primary",
    hidden: false,
    permissions: [{ action: "*", resource: "*", effect: "deny" }],
  }

  return Layer.succeed(
    AgentV2.Service,
    AgentV2.Service.of({
      transform: () => Effect.succeed({ dispose: Effect.void }),
      reload: () => Effect.void,
      get: (id) => Effect.succeed(id === V2_AGENT_ID ? info : undefined),
      default: () => Effect.succeed(info),
      resolve: (id) => Effect.succeed(id === undefined || id === V2_AGENT_ID ? info : undefined),
      select: (id) => {
        const selected = id === undefined ? V2_AGENT_ID : AgentV2.ID.make(id)
        return Effect.succeed({ id: selected, info: selected === V2_AGENT_ID ? info : undefined })
      },
      all: () => Effect.succeed([info]),
    }),
  )
}

type LegacyAuthMap = Record<string, LegacyAuth.Info>

const legacyCredential = (auth: LegacyAuthMap, providerID: ProviderV2.ID): Credential.Value | undefined => {
  const info = auth[providerID]
  if (info?.type !== "api") return
  return Credential.Key.make({
    type: "key",
    key: info.key,
    ...(info.metadata ? { metadata: info.metadata } : {}),
  })
}

const selectedVariantReady = (model: ModelV2.Info, requested: ModelV2.Ref | undefined) => {
  const variant = requested?.variant
  if (variant === undefined || variant === "default") return true
  return model.variants.some((item) => item.id === variant)
}

const waitForSelectedModel = (
  catalog: Catalog.Interface,
  requested: ModelV2.Ref,
  attempt = 0,
): Effect.Effect<ModelV2.Info | undefined> =>
  catalog.model.get(requested.providerID, requested.id).pipe(
    Effect.flatMap((model) => {
      if (model && selectedVariantReady(model, requested)) return Effect.succeed(model)
      if (attempt >= CATALOG_WAIT_ATTEMPTS) return Effect.succeed(model)
      return Effect.sleep(CATALOG_WAIT_DELAY).pipe(
        Effect.andThen(waitForSelectedModel(catalog, requested, attempt + 1)),
      )
    }),
  )

const v2ModelResolver = (auth: LegacyAuthMap) =>
  Layer.effect(
    SessionRunnerModel.Service,
    Effect.gen(function* () {
      const catalog: Catalog.Interface = yield* Catalog.Service
      return SessionRunnerModel.Service.of({
        resolve: Effect.fn("Cli.v2.modelResolver")(function* (session) {
          const requested = session.model
          if (!requested) return yield* new SessionRunnerModel.ModelNotSelectedError({ sessionID: session.id })

          const selected = yield* waitForSelectedModel(catalog, requested)
          if (!selected)
            return yield* new SessionRunnerModel.ModelUnavailableError({
              providerID: requested.providerID,
              modelID: requested.id,
            })

          return yield* SessionRunnerModel.resolve(session, selected, legacyCredential(auth, selected.providerID))
        }),
      })
    }),
  )

const v2Layer = (model: ModelV2.Ref, auth: LegacyAuthMap) => {
  const locationMap = buildLocationServiceMap([
    [AgentV2.node, textOnlyAgent(model)],
    [SessionRunnerModel.node, v2ModelResolver(auth)],
  ])
  return AppNodeBuilderV1.build(SessionV2.node, [
    [LocationServiceMap.node, locationMap],
    [SessionExecution.node, SessionExecutionLocal.node],
  ])
}

const readPrompt = (args: Args) =>
  Effect.gen(function* () {
    const positional = args.prompt?.join(" ").trim()
    if (positional) return positional
    if (!process.stdin.isTTY) {
      const text = yield* Effect.promise(() => new Response(Bun.stdin.stream()).text())
      const trimmed = text.trim()
      if (trimmed) return trimmed
    }
    return yield* fail("Usage: openchinacode v2 --model zhipuai-pay2go/glm-5.2#max \"your prompt\"")
  })

const formatError = (error: unknown) => (error instanceof Error ? error.message : String(error))

const assistantText = (messages: V2Message[]) => {
  const assistant = messages
    .filter((message) => message.type === "assistant")
    .at(-1)
  if (!assistant || assistant.type !== "assistant") return ""
  return assistant.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim()
}

const toolSummary = (messages: V2Message[]) => {
  const assistant = messages
    .filter((message) => message.type === "assistant")
    .at(-1)
  if (!assistant || assistant.type !== "assistant") return []
  return assistant.content
    .filter((part) => part.type === "tool")
    .map((part) => `${part.name}:${part.state.status}`)
}

export const V2Command = effectCmd({
  command: "v2 [prompt..]",
  describe: "experimental OpenChinaCode V2 core runner",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("prompt", {
        describe: "Prompt text. If omitted, reads stdin.",
        type: "string",
        array: true,
      })
      .option("model", {
        describe: "Model reference provider/model#variant",
        type: "string",
        default: DEFAULT_MODEL,
      })
      .option("session", {
        describe: "Optional V2 session id to reuse",
        type: "string",
      })
      .option("cwd", {
        describe: "Session working directory",
        type: "string",
      })
      .option("json", {
        describe: "Print raw V2 messages as JSON",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.v2")(function* (args: Args) {
    const prompt = yield* readPrompt(args)
    const auth = yield* LegacyAuth.Service.use((service) => service.all()).pipe(Effect.catch(() => Effect.succeed({})))
    let model: ModelV2.Ref
    try {
      model = parseModelRef(args.model ?? DEFAULT_MODEL)
    } catch (error) {
      return yield* fail(formatError(error))
    }
    const directory = AbsolutePath.make(path.resolve(args.cwd ?? process.cwd()))

    const session = yield* SessionV2.Service.use((sessions) =>
      Effect.gen(function* () {
        const info = yield* sessions.create({
          ...(args.session ? { id: SessionV2.ID.make(args.session) } : {}),
          agent: V2_AGENT_ID,
          model,
          location: Location.Ref.make({ directory }),
        })
        yield* sessions.prompt({
          sessionID: info.id,
          prompt: { text: prompt },
          resume: false,
        })
        yield* sessions.resume(info.id)
        const messages = yield* sessions.messages({ sessionID: info.id, order: "asc" })
        return { info, messages }
      }),
    ).pipe(
      Effect.provide(v2Layer(model, auth)),
      Effect.catch((error) => fail(`V2 runner failed: ${formatError(error)}`)),
    )

    if (args.json) {
      process.stdout.write(JSON.stringify(session, null, 2) + EOL)
      return
    }

    const text = assistantText(session.messages)
    const tools = toolSummary(session.messages)
    process.stderr.write(`V2 session: ${session.info.id}${EOL}`)
    process.stderr.write(`V2 model: ${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ""}${EOL}`)
    if (tools.length) process.stderr.write(`V2 tools: ${tools.join(", ")}${EOL}`)
    process.stdout.write((text || "(no assistant text)") + EOL)
  }),
})
