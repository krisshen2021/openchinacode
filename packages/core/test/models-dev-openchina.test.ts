import { describe, expect, test } from "bun:test"
import { ModelsDev } from "@opencode-ai/core/models-dev"

function model(id: string, cost: ModelsDev.Model["cost"] = { input: 999, output: 999, cache_read: 999 }) {
  return {
    id,
    name: id,
    release_date: "2026-01-01",
    attachment: false,
    reasoning: true,
    temperature: true,
    tool_call: true,
    cost,
    limit: { context: 1_000_000, output: 128_000 },
  } satisfies ModelsDev.Model
}

function provider(id: string, models: Record<string, ModelsDev.Model>) {
  return {
    id,
    name: id,
    env: [`${id.toUpperCase().replaceAll("-", "_")}_API_KEY`],
    models,
  } satisfies ModelsDev.Provider
}

describe("openChinaCatalog", () => {
  test("pins GLM, Kimi, and DeepSeek costs to official CNY pricing", () => {
    const input = {
      zhipuai: provider("zhipuai", {
        "glm-5.2": model("glm-5.2"),
        "glm-5v-turbo": model("glm-5v-turbo"),
      }),
      "moonshotai-cn": provider("moonshotai-cn", {
        "kimi-k2.7-code": model("kimi-k2.7-code"),
        "kimi-k2.7-code-highspeed": model("kimi-k2.7-code-highspeed"),
      }),
      deepseek: provider("deepseek", {
        "deepseek-v4-pro": model("deepseek-v4-pro"),
        "deepseek-v4-flash": model("deepseek-v4-flash"),
        "deepseek-chat": model("deepseek-chat"),
        "other-model": model("other-model", { input: 123, output: 456, cache_read: 7 }),
      }),
      proxyprovider: provider("proxyprovider", {
        "deepseek-v4-pro": model("deepseek-v4-pro"),
      }),
    } satisfies Record<string, ModelsDev.Provider>

    const result = ModelsDev.openChinaCatalog(input)

    expect(result.proxyprovider).toBeUndefined()
    expect(result.zhipuai).toBeUndefined()
    expect(result.moonshotai).toBeUndefined()
    expect(Object.keys(result).sort()).toEqual(["deepseek", "moonshotai-cn", "zhipuai-pay2go"])
    expect(result["zhipuai-pay2go"]).toMatchObject({
      id: "zhipuai-pay2go",
      api: "https://open.bigmodel.cn/api/paas/v4",
      env: ["ZHIPUAI_PAY2GO_API_KEY"],
    })
    expect(result["zhipuai-pay2go"].models["glm-5.2"].cost).toEqual(ModelsDev.OpenChinaOfficialPricing["glm-5.2"])
    expect(result["zhipuai-pay2go"].models["glm-5v-turbo"].cost).toEqual(
      ModelsDev.OpenChinaOfficialPricing["glm-5v-turbo"],
    )
    expect(result["moonshotai-cn"].models["kimi-k2.7-code"].cost).toEqual(
      ModelsDev.OpenChinaOfficialPricing["kimi-k2.7-code"],
    )
    expect(result["moonshotai-cn"].models["kimi-k2.7-code-highspeed"].cost).toEqual(
      ModelsDev.OpenChinaOfficialPricing["kimi-k2.7-code-highspeed"],
    )
    expect(result["moonshotai-cn"].models["kimi-k3"]).toMatchObject({
      id: "kimi-k3",
      name: "Kimi K3",
      reasoning: true,
      temperature: false,
      tool_call: true,
      attachment: true,
      interleaved: { field: "reasoning_content" },
      limit: {
        context: 1_048_576,
        input: 1_048_576,
        output: 1_048_576,
      },
      modalities: {
        input: ["text", "image", "video"],
        output: ["text"],
      },
      cost: ModelsDev.OpenChinaOfficialPricing["kimi-k3"],
    })
    expect(result.deepseek.models["deepseek-v4-pro"].cost).toEqual(
      ModelsDev.OpenChinaOfficialPricing["deepseek-v4-pro"],
    )
    expect(result.deepseek.models["deepseek-v4-flash"].cost).toEqual(
      ModelsDev.OpenChinaOfficialPricing["deepseek-v4-flash"],
    )
    expect(result.deepseek.models["deepseek-chat"].cost).toEqual(
      ModelsDev.OpenChinaOfficialPricing["deepseek-v4-flash"],
    )
    expect(result.deepseek.models["other-model"].cost).toEqual({ input: 123, output: 456, cache_read: 7 })

    expect(input.zhipuai.models["glm-5.2"].cost).toEqual({ input: 999, output: 999, cache_read: 999 })
  })
})
