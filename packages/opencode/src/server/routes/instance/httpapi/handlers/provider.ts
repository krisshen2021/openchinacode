import { ProviderAuth } from "@/provider/auth"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { CustomProvider } from "@/config/custom-provider"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Provider } from "@/provider/provider"
import { Discover } from "@/provider/discover"
import { Global } from "@opencode-ai/core/global"

import { mapValues } from "remeda"
import { Effect, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForDisposal } from "../lifecycle"
import { InstanceState } from "@/effect/instance-state"
import { ProviderAuthApiError, ProviderDiscoveryApiError } from "../groups/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"

function mapProviderAuthError<A, R>(self: Effect.Effect<A, ProviderAuth.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => {
      if (error instanceof ProviderAuth.OauthMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCodeMissing) {
        return new ProviderAuthApiError({ name: error._tag, data: { providerID: error.providerID } })
      }
      if (error instanceof ProviderAuth.OauthCallbackFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: {} })
      }
      if (error instanceof ProviderAuth.ValidationFailed) {
        return new ProviderAuthApiError({ name: error._tag, data: { field: error.field, message: error.message } })
      }
      return new ProviderAuthApiError({ name: "BadRequest", data: {} })
    }),
  )
}

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider", (handlers) =>
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const provider = yield* Provider.Service
    const svc = yield* ProviderAuth.Service
    const authSvc = yield* Auth.Service

    const list = Effect.fn("ProviderHttpApi.list")(function* () {
      const config = yield* cfg.get()
      const all = yield* ModelsDev.Service.use((s) => s.get())
      const disabled = new Set(config.disabled_providers ?? [])
      const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
      const filtered: Record<string, (typeof all)[string]> = {}
      for (const [key, value] of Object.entries(all)) {
        if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) filtered[key] = value
      }
      const connected = yield* provider.list()
      const providers = Object.assign(
        mapValues(filtered, (item) => Provider.fromModelsDevProvider(item)),
        connected,
      )
      return {
        all: Object.values(providers).map(Provider.toPublicInfo),
        default: Provider.defaultModelIDs(providers),
        connected: Object.keys(connected),
      }
    })

    const auth = Effect.fn("ProviderHttpApi.auth")(function* () {
      return yield* svc.methods()
    })

    const authorize = Effect.fn("ProviderHttpApi.authorize")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.AuthorizeInput
    }) {
      return yield* mapProviderAuthError(
        svc.authorize({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          inputs: ctx.payload.inputs,
        }),
      )
    })

    const authorizeRaw = Effect.fn("ProviderHttpApi.authorizeRaw")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderAuth.AuthorizeInput))(body).pipe(
        Effect.mapError(() => new ProviderAuthApiError({ name: "BadRequest", data: {} })),
      )
      // Match legacy route behavior: when authorize() resolves without a
      // result (e.g. no further redirect), serialize as JSON `null` instead
      // of an empty body so clients can `.json()` parse the response.
      const result = yield* authorize({ params: ctx.params, payload })
      return HttpServerResponse.jsonUnsafe(result ?? null)
    })

    const callback = Effect.fn("ProviderHttpApi.callback")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuth.CallbackInput
    }) {
      yield* mapProviderAuthError(
        svc.callback({
          providerID: ctx.params.providerID,
          method: ctx.payload.method,
          code: ctx.payload.code,
        }),
      )
      return true
    })

    const discover = Effect.fn("ProviderHttpApi.discover")(function* (ctx: {
      payload: { baseURL: string; apiKey?: string; providerID?: string }
    }) {
      // Edit flow: the TUI never sends the stored key back, so fall back to
      // auth.json when a providerID is given and no key came in the payload.
      const key =
        ctx.payload.apiKey ||
        (ctx.payload.providerID
          ? yield* authSvc.get(ctx.payload.providerID).pipe(
              Effect.map((info) => (info?.type === "api" ? info.key : undefined)),
              Effect.orDie,
            )
          : undefined)
      if (!key) {
        return yield* new ProviderDiscoveryApiError({ kind: "BadRequest", message: "apiKey is required" })
      }
      const models = yield* Discover.fetchModels(ctx.payload.baseURL, key).pipe(
        Effect.mapError((error) => new ProviderDiscoveryApiError({ kind: error.kind, message: error.message })),
      )
      return { models }
    })

    const customList = Effect.fn("ProviderHttpApi.customList")(function* () {
      return yield* CustomProvider.list(Global.Path.config).pipe(Effect.orDie)
    })

    const customSave = Effect.fn("ProviderHttpApi.customSave")(function* (ctx: {
      params: { providerID: string }
      payload: { name?: string; baseURL: string; models: readonly string[]; discover_models: boolean; apiKey?: string }
    }) {
      if (!ctx.params.providerID.match(/^[a-z0-9][a-z0-9-]*$/)) {
        return yield* new ProviderDiscoveryApiError({
          kind: "BadRequest",
          message: "provider id must be lowercase letters, digits, hyphens",
        })
      }
      if (ctx.payload.models.length === 0) {
        return yield* new ProviderDiscoveryApiError({
          kind: "BadRequest",
          message: "at least one model id is required",
        })
      }
      yield* CustomProvider.save(Global.Path.config, {
        id: ctx.params.providerID,
        name: ctx.payload.name,
        baseURL: ctx.payload.baseURL,
        models: ctx.payload.models,
        discover_models: ctx.payload.discover_models,
      }).pipe(Effect.orDie)
      if (ctx.payload.apiKey) {
        yield* authSvc.set(ctx.params.providerID, { type: "api", key: ctx.payload.apiKey }).pipe(Effect.orDie)
      }
      // Config is read through two caches: the infinite-TTL cachedGlobal and the
      // per-instance Config InstanceState. Bust the global one now; the instance
      // disposal after the response (same pattern as ConfigHttpApi.update) busts
      // the per-instance one, so the TUI's sync.bootstrap() rebuilds provider
      // state with the new provider visible.
      yield* cfg.invalidate()
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return { ok: true as const }
    })

    const refresh = Effect.fn("ProviderHttpApi.refresh")(function* () {
      const before = new Set(
        Object.entries(yield* provider.list()).flatMap(([pid, p]) => Object.keys(p.models).map((m) => `${pid}/${m}`)),
      )
      yield* ModelsDev.Service.use((s) => s.refresh(true))
      const discoverCache = yield* Discover.makeCache(Global.Path.data)
      for (const id of Object.keys(yield* provider.list())) {
        yield* discoverCache.expire(id)
      }
      yield* provider.refresh()
      const after = yield* provider.list()
      const added = Object.entries(after)
        .flatMap(([pid, p]) => Object.keys(p.models).map((m) => `${pid}/${m}`))
        .filter((key) => !before.has(key))
      return { added }
    })

    return handlers
      .handle("list", list)
      .handle("auth", auth)
      .handleRaw("authorize", authorizeRaw)
      .handle("callback", callback)
      .handle("discover", discover)
      .handle("customList", customList)
      .handle("customSave", customSave)
      .handle("refresh", refresh)
  }),
)
