import path from "path"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ModelsDev } from "@opencode-ai/schema/models-dev"
import { Global } from "./global"
import { Flag } from "./flag/flag"
import { Flock } from "./util/flock"
import { Hash } from "./util/hash"
import { FSUtil } from "./fs-util"
import { InstallationChannel, InstallationVersion } from "./installation/version"
import { EventV2 } from "./event"
import { makeGlobalNode } from "./effect/app-node"
import { httpClient } from "./effect/app-node-platform"

export const CatalogModelStatus = Schema.Literals(["alpha", "beta", "deprecated"])
export type CatalogModelStatus = typeof CatalogModelStatus.Type

const USER_AGENT = `opencode/${InstallationChannel}/${InstallationVersion}/${Flag.OPENCODE_CLIENT}`

const CostTier = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Finite,
  }),
})

const Cost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  tiers: Schema.optional(Schema.Array(CostTier)),
  context_over_200k: Schema.optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: Schema.optional(Schema.Finite),
      cache_write: Schema.optional(Schema.Finite),
    }),
  ),
})

export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  release_date: Schema.String,
  attachment: Schema.Boolean,
  reasoning: Schema.Boolean,
  temperature: Schema.Boolean,
  tool_call: Schema.Boolean,
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Literal(true),
      Schema.Struct({
        field: Schema.Literals(["reasoning", "reasoning_content", "reasoning_details"]),
      }),
    ]),
  ),
  cost: Schema.optional(Cost),
  limit: Schema.Struct({
    context: Schema.Finite,
    input: Schema.optional(Schema.Finite),
    output: Schema.Finite,
  }),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
      output: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      modes: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            cost: Schema.optional(Cost),
            provider: Schema.optional(
              Schema.Struct({
                body: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
                headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
  status: Schema.optional(CatalogModelStatus),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) }),
  ),
})
export type Model = Schema.Schema.Type<typeof Model>

export const Provider = Schema.Struct({
  api: Schema.optional(Schema.String),
  name: Schema.String,
  env: Schema.Array(Schema.String),
  id: Schema.String,
  npm: Schema.optional(Schema.String),
  models: Schema.Record(Schema.String, Model),
})

export type Provider = Schema.Schema.Type<typeof Provider>

export const Event = ModelsDev.Event

export const OpenChinaProviderIDs = ["zhipuai-pay2go", "moonshotai-cn", "deepseek"] as const

const openChinaProviderSet = new Set<string>(OpenChinaProviderIDs)

type ModelCost = NonNullable<Model["cost"]>

export const OpenChinaCostCurrency = "CNY"

export const OpenChinaOfficialPricingSource = {
  glm: "https://bigmodel.cn/pricing",
  kimi: "https://www.kimi.com/API",
  deepseek: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
} as const

// OpenChinaCode treats model cost as CNY per 1M tokens. The upstream opencode
// UI historically formats this field as USD, so the fork updates money
// formatters to CNY alongside this table.
export const OpenChinaOfficialPricing = {
  "glm-5.2": {
    input: 8,
    output: 28,
    cache_read: 2,
    cache_write: 0,
  },
  "glm-5v-turbo": {
    input: 5,
    output: 22,
    cache_read: 1.2,
    cache_write: 0,
  },
  "kimi-k2.7-code": {
    input: 6.5,
    output: 27,
    cache_read: 1.3,
    cache_write: 0,
  },
  "kimi-k2.7-code-highspeed": {
    input: 13,
    output: 54,
    cache_read: 2.6,
    cache_write: 0,
  },
  // Official K3 API pricing is USD-denominated ($3 input / $15 output /
  // $0.30 cache hit per MTok). OpenChinaCode displays CNY, so this uses the
  // same Moonshot CNY conversion basis as the existing K2.7 entries.
  "kimi-k3": {
    input: 20.5,
    output: 101.25,
    cache_read: 2.05,
    cache_write: 0,
  },
  "deepseek-v4-flash": {
    input: 1,
    output: 2,
    cache_read: 0.02,
    cache_write: 0,
  },
  "deepseek-v4-pro": {
    input: 3,
    output: 6,
    cache_read: 0.025,
    cache_write: 0,
  },
} satisfies Record<string, ModelCost>

const deepseekV4FlashAliases = new Set(["deepseek-chat", "deepseek-reasoner"])

function officialPricingKey(modelID: string): keyof typeof OpenChinaOfficialPricing | undefined {
  const id = modelID.toLowerCase().replaceAll("_", "-")
  const leaf = id.split("/").pop() ?? id
  const normalized = leaf.replace("k2-7", "k2.7")

  if (normalized in OpenChinaOfficialPricing) return normalized as keyof typeof OpenChinaOfficialPricing
  if (deepseekV4FlashAliases.has(normalized)) return "deepseek-v4-flash"
}

function applyOpenChinaOfficialPricing(provider: Provider): Provider {
  let updated = false
  const models: Record<string, Model> = {}
  for (const [modelKey, model] of Object.entries(provider.models)) {
    const key = officialPricingKey(model.id) ?? officialPricingKey(modelKey)
    models[modelKey] = key ? { ...model, cost: { ...OpenChinaOfficialPricing[key] } } : model
    updated ||= key !== undefined
  }
  return updated ? cloneProvider(provider, { models }) : provider
}

function withOpenChinaBuiltinModels(provider: Provider): Provider {
  if (provider.id !== "moonshotai-cn") return provider
  const existing = provider.models["kimi-k3"]
  const models: Record<string, Model> = {
    ...provider.models,
    "kimi-k3": {
      ...existing,
      id: "kimi-k3",
      name: existing?.name ?? "Kimi K3",
      family: existing?.family ?? "kimi-k3",
      release_date: existing?.release_date ?? "2026-07-23",
      attachment: true,
      reasoning: true,
      temperature: false,
      tool_call: true,
      interleaved: existing?.interleaved ?? { field: "reasoning_content" },
      cost: { ...OpenChinaOfficialPricing["kimi-k3"] },
      limit: {
        context: 1_048_576,
        input: existing?.limit.input ?? 1_048_576,
        output: 1_048_576,
      },
      modalities: {
        input: ["text", "image", "video"],
        output: ["text"],
      },
    },
  }
  return cloneProvider(provider, { models })
}

function cloneProvider(provider: Provider, patch: Partial<Provider>): Provider {
  return {
    ...(JSON.parse(JSON.stringify(provider)) as Provider),
    ...patch,
  }
}

export function openChinaCatalog(input: Record<string, Provider>): Record<string, Provider> {
  const result: Record<string, Provider> = {}
  for (const [id, provider] of Object.entries(input)) {
    if (!openChinaProviderSet.has(id)) continue
    result[id] = applyOpenChinaOfficialPricing(withOpenChinaBuiltinModels(provider))
  }

  if (input.zhipuai && !result["zhipuai-pay2go"]) {
    result["zhipuai-pay2go"] = applyOpenChinaOfficialPricing(
      cloneProvider(input.zhipuai, {
        id: "zhipuai-pay2go",
        name: "Zhipu AI Pay2Go",
        env: ["ZHIPUAI_PAY2GO_API_KEY"],
        api: "https://open.bigmodel.cn/api/paas/v4",
      }),
    )
  }

  return result
}

declare const OPENCODE_MODELS_DEV: Record<string, Provider> | undefined

export interface Interface {
  readonly get: () => Effect.Effect<Record<string, Provider>>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelsDev") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const events = yield* EventV2.Service
    const http = HttpClient.filterStatusOk(
      (yield* HttpClient.HttpClient).pipe(
        HttpClient.retryTransient({
          retryOn: "errors-and-responses",
          times: 2,
          schedule: Schedule.exponential(200).pipe(Schedule.jittered),
        }),
      ),
    )

    const source = Flag.OPENCODE_MODELS_URL || "https://models.dev"
    const filepath = path.join(
      Global.Path.cache,
      source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`,
    )
    const ttl = Duration.minutes(5)
    const lockKey = `models-dev:${filepath}`

    const fresh = Effect.fnUntraced(function* () {
      const stat = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!stat) return false
      const mtime = Option.getOrElse(stat.mtime, () => new Date(0)).getTime()
      return Date.now() - mtime < Duration.toMillis(ttl)
    })

    const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* () {
      return yield* HttpClientRequest.get(`${source}/api.json`).pipe(
        HttpClientRequest.setHeader("User-Agent", USER_AGENT),
        http.execute,
        Effect.flatMap((res) => res.text),
        Effect.timeout("10 seconds"),
      )
    })

    const loadFromDisk = fs.readJson(Flag.OPENCODE_MODELS_PATH ?? filepath).pipe(
      Effect.catch((error) => {
        if (
          Flag.OPENCODE_MODELS_PATH === undefined &&
          error._tag === "FileSystemError" &&
          error.method === "readJson"
        ) {
          return fs.remove(filepath, { force: true }).pipe(Effect.ignore, Effect.as(undefined))
        }
        return Effect.succeed(undefined)
      }),
      Effect.map((v) => v as Record<string, Provider> | undefined),
    )

    const loadSnapshot = Effect.sync(() =>
      typeof OPENCODE_MODELS_DEV === "undefined" ? undefined : OPENCODE_MODELS_DEV,
    )

    const fetchAndWrite = Effect.fn("ModelsDev.fetchAndWrite")(function* () {
      const text = yield* fetchApi()
      const tempfile = `${filepath}.${process.pid}.${Date.now()}.tmp`
      yield* fs.writeWithDirs(tempfile, text).pipe(
        Effect.andThen(fs.rename(tempfile, filepath)),
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* fs.remove(tempfile, { force: true }).pipe(Effect.ignore)
            return yield* Effect.fail(error)
          }),
        ),
      )
      return text
    })

    const populate = Effect.gen(function* () {
      const fromDisk = yield* loadFromDisk
      if (fromDisk) return openChinaCatalog(fromDisk)
      const snapshot = yield* loadSnapshot
      if (snapshot) return openChinaCatalog(snapshot)
      if (Flag.OPENCODE_DISABLE_MODELS_FETCH) return {}
      // Flock is cross-process: concurrent opencode CLIs can race on this cache file.
      const text = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          return yield* fetchAndWrite()
        }),
      )
      return openChinaCatalog(JSON.parse(text) as Record<string, Provider>)
    }).pipe(Effect.withSpan("ModelsDev.populate"), Effect.orDie)

    const [cachedGet, invalidate] = yield* Effect.cachedInvalidateWithTTL(populate, Duration.infinity)

    const get = (): Effect.Effect<Record<string, Provider>> => cachedGet

    const refresh = Effect.fn("ModelsDev.refresh")(function* (force = false) {
      if (!force && (yield* fresh())) return
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          // Re-check under the lock: another process may have refreshed between
          // our outer check and lock acquisition.
          if (!force && (yield* fresh())) return
          yield* fetchAndWrite()
          yield* invalidate
          yield* events.publish(Event.Refreshed, {})
        }),
      ).pipe(
        Effect.tapCause((cause) => Effect.logError("Failed to fetch models.dev", { cause: cause })),
        Effect.ignore,
      )
    })

    if (!Flag.OPENCODE_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
      // Schedule.spaced runs the effect once, then waits between completions.
      yield* Effect.forkScoped(refresh().pipe(Effect.repeat(Schedule.spaced("60 minutes")), Effect.ignore))
    }

    return Service.of({ get, refresh })
  }),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [FSUtil.node, EventV2.node, httpClient] })

export * as ModelsDev from "./models-dev"
