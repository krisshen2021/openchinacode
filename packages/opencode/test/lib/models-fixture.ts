import path from "path"
import { Effect, Layer } from "effect"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"

// OpenChinaCode's models.dev catalog is China-only (openChinaCatalog filters
// to OpenChinaProviderIDs), so upstream catalog providers like anthropic,
// openai, google, or amazon-bedrock are absent from the database. These
// helpers serve the shared fixture catalog (test/tool/fixtures/models-api.json)
// in place of the filtered catalog so provider tests stay self-contained.
export const catalog = JSON.parse(
  await Bun.file(path.join(import.meta.dir, "../tool/fixtures/models-api.json")).text(),
) as Record<string, ModelsDev.Provider>

// LayerNode.compile replacement pair: swap the live ModelsDev service for the
// fixture catalog, e.g. LayerNode.compile(node, [catalogReplacement]).
export const catalogReplacement = [
  ModelsDev.node,
  Layer.succeed(ModelsDev.Service, {
    get: () => Effect.succeed(catalog),
    refresh: () => Effect.void,
  }),
] as const

export function configModel(model: ModelsDev.Model) {
  return {
    id: model.id,
    name: model.name,
    family: model.family,
    release_date: model.release_date,
    attachment: model.attachment,
    reasoning: model.reasoning,
    temperature: model.temperature,
    tool_call: model.tool_call,
    interleaved: model.interleaved,
    cost: model.cost ? { ...model.cost, tiers: undefined } : undefined,
    limit: model.limit,
    modalities: model.modalities,
    status: model.status,
    provider: model.provider,
  }
}

type ConfigModel = NonNullable<NonNullable<ConfigV1.Info["provider"]>[string]["models"]>[string]

// Inline a fixture provider (with all of its models) as a config provider
// entry, for tests that run against the real instance stack where a
// LayerNode replacement is not reachable (e.g. HttpApi tests).
export function catalogProviderConfig(providerID: string) {
  const provider = catalog[providerID]
  if (!provider) throw new Error(`Missing provider in fixture: ${providerID}`)
  return {
    name: provider.name,
    env: [...provider.env],
    npm: provider.npm,
    api: provider.api,
    models: Object.fromEntries(
      Object.entries(provider.models).map(([id, model]) => [id, configModel(model) as ConfigModel]),
    ),
  }
}
