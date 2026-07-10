import { describe, expect, test } from "bun:test"
import { providerOptions } from "../../../../src/component/dialog-provider"

describe("providerOptions", () => {
  test("does not include a synthetic Other option", () => {
    expect(providerOptions([{ id: "deepseek", name: "DeepSeek" }]).map((option) => option.value)).toEqual(["deepseek"])
  })

  test("uses a configured-provider category", () => {
    expect(providerOptions([{ id: "deepseek", name: "DeepSeek" }])[0]?.category).toBe("Configured providers")
  })

  test("keeps configured OpenChinaCode providers first and sorts the rest alphabetically", () => {
    expect(
      providerOptions([
        { id: "moonshotai-cn", name: "Moonshot AI (China)" },
        { id: "custom-z", name: "Zebra Provider" },
        { id: "deepseek", name: "DeepSeek" },
        { id: "zhipuai-pay2go", name: "Zhipu AI Pay2Go" },
        { id: "custom-a", name: "Alpha Provider" },
      ]).map((option) => option.value),
    ).toEqual(["zhipuai-pay2go", "moonshotai-cn", "deepseek", "custom-a", "custom-z"])
  })
})
