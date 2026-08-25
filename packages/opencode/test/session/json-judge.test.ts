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
      refresh: Effect.fn("TestProvider.refresh")(() => Effect.void),
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

describe("JsonJudge.runJsonJudge retries", () => {
  function providerWith(texts: (string | Error)[], calls: string[]) {
    const lang = {
      specificationVersion: "v3",
      provider: "test",
      modelId: "m",
      supportedUrls: {},
      doGenerate: () => {
        calls.push("call")
        const item = texts.shift() ?? "{}"
        if (item instanceof Error) return Promise.reject(item)
        const text = item
        return Promise.resolve({
          content: [{ type: "text" as const, text }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        })
      },
      doStream: () => Promise.reject(new Error("not used")),
    } satisfies LanguageModelV3
    return providerFor(lang)
  }

  function providerFor(lang: LanguageModelV3) {
    const model = ProviderTest.model({
      providerID: ProviderV2.ID.make("deepseek"),
      id: ModelV2.ID.make("deepseek-v4-flash"),
    })
    return Provider.Service.of({
      list: Effect.fn("TestProvider.list")(() => Effect.succeed({})),
      refresh: Effect.fn("TestProvider.refresh")(() => Effect.void),
      getProvider: Effect.fn("TestProvider.getProvider")(() => Effect.die(new Error("not used"))),
      getModel: Effect.fn("TestProvider.getModel")(() => Effect.succeed(model)),
      getLanguage: Effect.fn("TestProvider.getLanguage")(() => Effect.succeed(lang)),
      closest: Effect.fn("TestProvider.closest")(() => Effect.succeed(undefined)),
      getSmallModel: Effect.fn("TestProvider.getSmallModel")(() => Effect.succeed(model)),
      defaultModel: Effect.fn("TestProvider.defaultModel")(() =>
        Effect.succeed({ providerID: model.providerID, modelID: model.id }),
      ),
    })
  }

  const parse = (text: string): { ok: boolean } | undefined => {
    if (!text.startsWith("{")) return undefined
    return JSON.parse(text)
  }

  test("retries once on invalid output and returns the second parse", async () => {
    const calls: string[] = []
    // Effect.fn with a generic generator widens the effect to unknown/any;
    // production callers consume it through generators, so pin the type here.
    const result = await Effect.runPromise(
      JsonJudge.runJsonJudge<{ ok: boolean }>({
        name: "test judge",
        sessionID: "ses_retry",
        provider: providerWith(["garbage", '{"ok":true}'], calls),
        messages: [{ role: "user", content: "hi" }],
        parse,
        modelCandidates: ["deepseek/deepseek-v4-flash"],
        timeoutMs: 5000,
        maxOutputTokens: 100,
        retries: 1,
      }) as Effect.Effect<JsonJudge.JsonJudgeResult<{ ok: boolean }>>,
    )
    expect(result.status).toBe("valid")
    expect(result.decision?.ok).toBe(true)
    expect(calls.length).toBe(2)
  })

  test("no retry when retries is unset", async () => {
    const calls: string[] = []
    const result = await Effect.runPromise(
      JsonJudge.runJsonJudge<{ ok: boolean }>({
        name: "test judge",
        sessionID: "ses_noretry",
        provider: providerWith(["garbage", '{"ok":true}'], calls),
        messages: [{ role: "user", content: "hi" }],
        parse,
        modelCandidates: ["deepseek/deepseek-v4-flash"],
        timeoutMs: 5000,
        maxOutputTokens: 100,
      }) as Effect.Effect<JsonJudge.JsonJudgeResult<{ ok: boolean }>>,
    )
    expect(result.status).toBe("invalid")
    expect(calls.length).toBe(1)
  })

  test("retries once on provider failure and returns the successful result", async () => {
    const calls: string[] = []
    const result = await Effect.runPromise(
      JsonJudge.runJsonJudge<{ ok: boolean }>({
        name: "test judge",
        sessionID: "ses_fail_retry",
        provider: providerWith([new Error("provider boom"), '{"ok":true}'], calls),
        messages: [{ role: "user", content: "hi" }],
        parse,
        modelCandidates: ["deepseek/deepseek-v4-flash"],
        timeoutMs: 5000,
        maxOutputTokens: 100,
        retries: 1,
      }) as Effect.Effect<JsonJudge.JsonJudgeResult<{ ok: boolean }>>,
    )
    expect(result.status).toBe("valid")
    expect(result.decision?.ok).toBe(true)
    expect(calls.length).toBe(2)
  })

  test("returns failed after retries are exhausted on repeated provider failure", async () => {
    const calls: string[] = []
    const result = await Effect.runPromise(
      JsonJudge.runJsonJudge<{ ok: boolean }>({
        name: "test judge",
        sessionID: "ses_fail_exhaust",
        provider: providerWith([new Error("boom 1"), new Error("boom 2")], calls),
        messages: [{ role: "user", content: "hi" }],
        parse,
        modelCandidates: ["deepseek/deepseek-v4-flash"],
        timeoutMs: 5000,
        maxOutputTokens: 100,
        retries: 1,
      }) as Effect.Effect<JsonJudge.JsonJudgeResult<{ ok: boolean }>>,
    )
    expect(result.status).toBe("failed")
    expect(calls.length).toBe(2)
  })

  test("does not retry when the timeout kills the attempt", async () => {
    const calls: string[] = []
    const lang = {
      specificationVersion: "v3",
      provider: "test",
      modelId: "m",
      supportedUrls: {},
      doGenerate: (options: { abortSignal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          calls.push("call")
          options.abortSignal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError")),
          )
        }),
      doStream: () => Promise.reject(new Error("not used")),
    } satisfies LanguageModelV3
    const result = await Effect.runPromise(
      JsonJudge.runJsonJudge<{ ok: boolean }>({
        name: "test judge",
        sessionID: "ses_timeout",
        provider: providerFor(lang),
        messages: [{ role: "user", content: "hi" }],
        parse,
        modelCandidates: ["deepseek/deepseek-v4-flash"],
        timeoutMs: 20,
        maxOutputTokens: 100,
        retries: 1,
      }) as Effect.Effect<JsonJudge.JsonJudgeResult<{ ok: boolean }>>,
    )
    expect(result.status).toBe("failed")
    expect(result.error).toContain("timeout")
    expect(calls.length).toBe(1)
  })
})
