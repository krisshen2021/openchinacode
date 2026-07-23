export * as VariantPlugin from "./variant"

import type { ModelV2Info } from "@opencode-ai/sdk/v2/types"
import { Effect } from "effect"
import { define } from "./internal"
import type { ProviderV2 } from "../provider"

export const Plugin = define({
  id: "variant",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((catalog) => {
      for (const record of catalog.provider.list()) {
        for (const model of record.models.values()) {
          catalog.model.update(model.providerID, model.id, (draft) => {
            const generated = generate(draft, record.provider)
            if (generated.length === 0) return

            const explicit = new Map(draft.variants.map((variant) => [variant.id, variant]))
            const generatedIDs = new Set(generated.map((variant) => variant.id))
            draft.variants = [
              ...generated.map((variant) => explicit.get(variant.id) ?? variant),
              ...draft.variants.filter((variant) => !generatedIDs.has(variant.id)),
            ]
          })
        }
      }
    })
  }),
})

type ProviderLike = { api: ProviderV2.Api }

function projectedApi(model: ModelV2Info, provider?: ProviderLike): ModelV2Info["api"] {
  if (
    model.api.type === "native" &&
    !model.api.url &&
    Object.keys(model.api.settings).length === 0 &&
    provider?.api.type === "aisdk"
  ) {
    return { id: model.api.id, ...provider.api }
  }
  return model.api
}

export function generate(model: ModelV2Info, provider?: ProviderLike): ModelV2Info["variants"] {
  const api = projectedApi(model, provider)
  if (api.type !== "aisdk" || api.package !== "@ai-sdk/openai-compatible") return []
  const ids = `${model.id} ${model.api.id}`.toLowerCase()
  if (!["glm-5.2", "glm-5-2", "glm-5p2", "kimi-k3"].some((name) => ids.includes(name))) return []
  return ["high", "max"].map((id) => ({
    id,
    headers: {},
    body: { reasoning_effort: id },
  }))
}
