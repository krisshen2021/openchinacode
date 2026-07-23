import { EOL } from "os"
import { Effect } from "effect"
import { Auth as LegacyAuth } from "@/auth"
import { Catalog } from "@opencode-ai/core/catalog"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { effectCmd } from "../../effect-cmd"

export const V2Command = effectCmd({
  command: "v2",
  describe: "debug v2 catalog and built-in plugins",
  instance: false,
  handler: () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const legacyAuth: Record<string, LegacyAuth.Info> = yield* LegacyAuth.Service.use((service) =>
        service.all(),
      ).pipe(Effect.catch(() => Effect.succeed({})))
      const providers = (yield* catalog.provider.available()).sort((a, b) => a.id.localeCompare(b.id))
      const all = (yield* catalog.provider.all()).sort((a, b) => a.id.localeCompare(b.id))
      const availableModels = new Set(
        (yield* catalog.model.available()).map((model) => `${model.providerID}/${model.id}`),
      )
      const openChinaRefs = [
        ["zhipuai-pay2go", "glm-5.2"],
        ["moonshotai-cn", "kimi-k3"],
        ["deepseek", "deepseek-v4-pro"],
        ["deepseek", "deepseek-v4-flash"],
      ] as const
      const result = {
        providers: providers.map((provider) => provider.id),
        allProviders: all.map((provider) => provider.id),
        default: yield* catalog.model
          .default()
          .pipe(Effect.map((item) => (item ? `${item.providerID}/${item.id}` : undefined))),
        small: Object.fromEntries(
          yield* Effect.all(
            all.map((provider) =>
              Effect.map(catalog.model.small(provider.id), (model) => [provider.id, model?.id] as const),
            ),
            { concurrency: "unbounded" },
          ),
        ),
        openchina: Object.fromEntries(
          yield* Effect.all(
            openChinaRefs.map(([providerID, modelID]) =>
              Effect.map(catalog.model.get(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)), (model) => [
                `${providerID}/${modelID}`,
                model
                  ? {
                      available: availableModels.has(`${providerID}/${modelID}`),
                      legacyAuthBridge: legacyAuth[providerID]?.type === "api",
                      api: model.api.type === "aisdk" ? `${model.api.type}:${model.api.package}` : model.api.type,
                      url: model.api.url,
                      limit: model.limit,
                      variants: model.variants.map((variant) => variant.id),
                    }
                  : undefined,
              ]),
            ),
            { concurrency: "unbounded" },
          ),
        ),
      }
      process.stdout.write(JSON.stringify(result, null, 2) + EOL)
    }).pipe(
      Effect.withSpan("Cli.debug.v2"),
      Effect.provide(
        LocationServiceMap.Service.get(
          Location.Ref.make({
            directory: AbsolutePath.make(process.cwd()),
          }),
        ),
      ),
      Effect.provide(locationServiceMapLayer),
    ),
})
