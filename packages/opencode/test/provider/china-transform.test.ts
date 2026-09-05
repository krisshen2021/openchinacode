import { describe, expect, test } from "bun:test"
import { ChinaTransform } from "@/provider/china-transform"

function model(id: string, opts?: { reasoning?: boolean; npm?: string }) {
  return {
    id,
    providerID: "custom",
    api: { id, url: "https://example.com/v1", npm: opts?.npm ?? "@ai-sdk/openai-compatible" },
    name: id,
    capabilities: {
      temperature: true,
      reasoning: opts?.reasoning ?? true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
    family: "",
    release_date: "",
    variants: {},
  } as any
}

describe("ChinaTransform.variants GLM-5 family", () => {
  for (const id of ["glm-5", "glm-5-turbo", "glm-5.1", "glm-5.2", "glm-5-2", "glm-5p2", "glm-5.3", "glm-5.3-flash"]) {
    test(`${id} gets none/high/max variants`, () => {
      const v = ChinaTransform.variants(model(id))
      expect(Object.keys(v ?? {})).toEqual(["none", "high", "max"])
    })
  }

  for (const id of ["glm-4.5", "glm-4.6", "glm-4.7", "glm-5v"]) {
    test(`${id} gets no GLM variants`, () => {
      expect(ChinaTransform.variants(model(id))).toBeUndefined()
    })
  }

  test("kimi-k3 gets high/max variants", () => {
    expect(Object.keys(ChinaTransform.variants(model("kimi-k3")) ?? {})).toEqual(["high", "max"])
  })

  test("deepseek-v4 family gets none/high/max variants", () => {
    for (const id of ["deepseek-v4-pro", "deepseek-v4-flash"]) {
      expect(Object.keys(ChinaTransform.variants(model(id)) ?? {})).toEqual(["none", "high", "max"])
    }
  })
})

describe("ChinaTransform.inferReasoning", () => {
  test("infers reasoning for known reasoning families", () => {
    for (const id of ["glm-5", "glm-5.2", "glm-5.3-flash", "kimi-k3", "deepseek-v4-pro", "deepseek-v4-flash"]) {
      expect(ChinaTransform.inferReasoning(model(id))).toBe(true)
    }
  })

  test("returns undefined for models without reasoning rules", () => {
    for (const id of ["glm-4.7", "qwen3.8-max", "doubao-seed-evolving", "deepseek-v3"]) {
      expect(ChinaTransform.inferReasoning(model(id))).toBeUndefined()
    }
  })

  test("returns undefined for non-openai-compatible endpoints", () => {
    expect(ChinaTransform.inferReasoning(model("glm-5.2", { npm: "@ai-sdk/anthropic" }))).toBeUndefined()
  })

  test("treats a missing npm (discovered-model shape) as openai-compatible", () => {
    expect(ChinaTransform.inferReasoning({ id: "glm-5.2", api: { id: "glm-5.2" } })).toBe(true)
  })
})
