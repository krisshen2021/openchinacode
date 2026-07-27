import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { JsonJudge } from "../../src/session/judge/json-judge"
import { Provider } from "../../src/provider/provider"
import { ProviderTest } from "../fake/provider"

function language(modelId: string) {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId,
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error("not used")),
    doStream: () => Promise.reject(new Error("not used")),
  } satisfies LanguageModelV3
}

describe("JsonJudge.selectJudgeModel", () => {
  test("uses configured candidates before the current model when current model inclusion is disabled", async () => {
    const current = ProviderTest.model({
      providerID: ProviderV2.ID.make("moonshotai-cn"),
      id: ModelV2.ID.make("kimi-k3"),
    })
    const flash = ProviderTest.model({
      providerID: ProviderV2.ID.make("deepseek"),
      id: ModelV2.ID.make("deepseek-v4-flash"),
    })
    const seen: string[] = []
    const models = new Map<string, Provider.Model>([
      [`${current.providerID}/${current.id}`, current],
      [`${flash.providerID}/${flash.id}`, flash],
    ])
    const provider = Provider.Service.of({
      list: Effect.fn("TestProvider.list")(() => Effect.succeed({})),
      getProvider: Effect.fn("TestProvider.getProvider")(() => Effect.die(new Error("not used"))),
      getModel: Effect.fn("TestProvider.getModel")((providerID, modelID) => {
        const model = models.get(`${providerID}/${modelID}`)
        return model ? Effect.succeed(model) : Effect.die(new Error(`Unknown test model: ${providerID}/${modelID}`))
      }),
      getLanguage: Effect.fn("TestProvider.getLanguage")((model) => {
        seen.push(`${model.providerID}/${model.id}`)
        return Effect.succeed(language(`${model.providerID}/${model.id}`))
      }),
      closest: Effect.fn("TestProvider.closest")(() => Effect.succeed(undefined)),
      getSmallModel: Effect.fn("TestProvider.getSmallModel")(() => Effect.succeed(current)),
      defaultModel: Effect.fn("TestProvider.defaultModel")(() =>
        Effect.succeed({ providerID: current.providerID, modelID: current.id }),
      ),
    })

    const selected = await Effect.runPromise(
      JsonJudge.selectJudgeModel({
        provider,
        candidates: ["deepseek/deepseek-v4-flash"],
        currentModel: current,
        includeCurrentModel: false,
        smallModelProviderID: current.providerID,
      }),
    )

    expect(selected?.model.providerID).toBe(ProviderV2.ID.make("deepseek"))
    expect(selected?.model.id).toBe(ModelV2.ID.make("deepseek-v4-flash"))
    expect(seen).toEqual(["deepseek/deepseek-v4-flash"])
  })
})
