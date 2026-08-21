import path from "path"
import { Duration, Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"

export const TTL = Duration.toMillis(Duration.hours(1))
export const CACHE_FILE = "discovered-models.json"

export const Model = Schema.Struct({ id: Schema.String, name: Schema.String })
export type Model = Schema.Schema.Type<typeof Model>

export const CacheData = Schema.Record(
  Schema.String,
  Schema.Struct({ fetchedAt: Schema.Number, models: Schema.mutable(Schema.Array(Model)) }),
)
export type CacheData = Schema.Schema.Type<typeof CacheData>

export class DiscoverError extends Schema.TaggedErrorClass<DiscoverError>()("DiscoverError", {
  kind: Schema.Literals(["Unsupported", "Auth", "Network"]),
  message: Schema.String,
}) {}

const fail = (kind: "Unsupported" | "Auth" | "Network", message: string) => new DiscoverError({ kind, message })

/**
 * Fetches the model list from an OpenAI-compatible `GET {baseURL}/models`.
 * Keeps only the model id (display name falls back to the id); unknown fields
 * are ignored so relay endpoints with extra payload still parse.
 */
export const fetchModels = Effect.fn("Discover.fetchModels")(function* (baseURL: string, apiKey: string) {
  const url = `${baseURL.replace(/\/+$/, "")}/models`
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(url, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }),
    catch: () => fail("Network", `GET ${url} failed (timeout or transport error)`),
  })
  if (response.status === 401 || response.status === 403) {
    return yield* fail("Auth", `GET ${url} returned ${response.status}; check the API key`)
  }
  if (!response.ok) {
    return yield* fail(
      "Unsupported",
      `GET ${url} returned ${response.status}; endpoint does not support model enumeration`,
    )
  }
  const body = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: () => fail("Unsupported", `GET ${url} did not return JSON; endpoint does not support model enumeration`),
  })
  const parsed = yield* Schema.decodeUnknownEffect(
    Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) }),
  )(body).pipe(Effect.mapError(() => fail("Unsupported", `GET ${url} returned an unrecognized shape`)))
  return parsed.data.map((model) => ({ id: model.id, name: model.id }))
})

export interface Cache {
  readonly read: () => Effect.Effect<CacheData>
  readonly write: (providerID: string, models: Model[]) => Effect.Effect<void>
  readonly expire: (providerID: string) => Effect.Effect<void>
  readonly isFresh: (entry: { fetchedAt: number } | undefined) => boolean
}

/** Cache is a plain factory (not an Effect service) so tests can point it at a temp dir. */
export const makeCache = (dir: string) =>
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const file = path.join(dir, CACHE_FILE)
    const decode = Schema.decodeUnknownEffect(CacheData)

    const read = Effect.fnUntraced(function* () {
      const raw = yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))
      return yield* decode(raw).pipe(Effect.orElseSucceed((): CacheData => ({})))
    })

    const write = Effect.fnUntraced(function* (providerID: string, models: Model[]) {
      const data = yield* read()
      yield* fsys
        .writeJson(file, { ...data, [providerID]: { fetchedAt: Date.now(), models } }, 0o600)
        .pipe(Effect.orDie)
    })

    const expire = Effect.fnUntraced(function* (providerID: string) {
      const data = yield* read()
      const entry = data[providerID]
      if (!entry) return
      yield* fsys.writeJson(file, { ...data, [providerID]: { ...entry, fetchedAt: 0 } }, 0o600).pipe(Effect.orDie)
    })

    const isFresh = (entry: { fetchedAt: number } | undefined) =>
      entry !== undefined && Date.now() - entry.fetchedAt < TTL

    return { read, write, expire, isFresh } satisfies Cache
  })

const BUILTIN_DISCOVERY = ["zhipuai-pay2go", "moonshotai-cn", "deepseek"]

export const enabled = (config: { discover_models?: boolean } | undefined, providerID: string): boolean =>
  config?.discover_models ?? BUILTIN_DISCOVERY.includes(providerID)

/**
 * Merges discovered models into a provider state model map. Never overwrites
 * existing entries (config-declared or previously merged). `catalogHit` is the
 * state-shaped model cloned from a cross-provider models.dev match; when
 * absent, conservative defaults are used (128k/8k, toolcall on). The caller
 * completes provider-specific fields (`providerID`, `api.url`, `api.npm`).
 */
export const mergeInto = (
  provider: { models: Record<string, unknown> },
  discovered: Model[],
  catalogHit: ((id: string) => unknown | undefined) | undefined,
) => {
  for (const model of discovered) {
    if (provider.models[model.id]) continue
    const hit = catalogHit?.(model.id)
    if (hit) {
      provider.models[model.id] = hit
      continue
    }
    provider.models[model.id] = {
      id: model.id,
      name: model.name,
      family: "",
      api: { id: model.id },
      status: "active",
      headers: {},
      options: {},
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 128000, output: 8192 },
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      release_date: "",
      variants: {},
    }
  }
}

export * as Discover from "./discover"
