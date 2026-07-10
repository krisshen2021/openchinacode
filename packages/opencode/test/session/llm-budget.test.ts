import { describe, expect, test } from "bun:test"
import * as OutputBudget from "@/session/llm/budget"

describe("OutputBudget.apply", () => {
  const createModel = (context: number, output = 384_000, input?: number): any => ({
    id: "deepseek-v4-pro",
    providerID: "deepseek",
    api: {
      id: "deepseek-v4-pro",
      url: "https://api.deepseek.com",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "DeepSeek V4 Pro",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: { field: "reasoning_content" },
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context, input, output },
    status: "active",
    options: {},
    headers: {},
  })

  const outputDecision = {
    tokens: 393_216,
    level: "max" as const,
    mode: "heuristic" as const,
    reasons: ["coding-intent"],
    needsJudge: false,
    policy: { default: 131_072, max: 393_216 },
  }

  test("clamps a max turn to available context when it is still useful", () => {
    const result = OutputBudget.apply({
      model: createModel(1_000_000),
      messages: [{ role: "user", content: "修复这个 bug" }],
      tools: {},
      maxOutputTokens: 393_216,
      outputDecision,
      outputLevel: "max",
      promptTokens: 700_000,
    })

    expect(result.action).toBe("use")
    if (result.action === "use") {
      expect(result.clamped).toBe(true)
      expect(result.availableOutputTokens).toBe(280_000)
      expect(result.maxOutputTokens).toBe(280_000)
      expect(result.minUsefulOutputTokens).toBe(65_536)
    }
  })

  test("requests compaction when remaining output is below max-turn useful floor", () => {
    const result = OutputBudget.apply({
      model: createModel(1_000_000),
      messages: [{ role: "user", content: "重构这个架构并补测试" }],
      tools: {},
      maxOutputTokens: 393_216,
      outputDecision,
      outputLevel: "max",
      promptTokens: 950_000,
    })

    expect(result.action).toBe("compact")
    if (result.action === "compact") {
      expect(result.reason).toBe("output-budget")
      expect(result.availableOutputTokens).toBe(30_000)
      expect(result.minUsefulOutputTokens).toBe(65_536)
    }
  })

  test("uses a lower useful floor for default turns", () => {
    const result = OutputBudget.apply({
      model: createModel(1_000_000),
      messages: [{ role: "user", content: "解释一下 compaction" }],
      tools: {},
      maxOutputTokens: 131_072,
      outputDecision: { ...outputDecision, tokens: 131_072, level: "default" },
      outputLevel: "default",
      promptTokens: 945_000,
    })

    expect(result.action).toBe("use")
    if (result.action === "use") {
      expect(result.clamped).toBe(true)
      expect(result.availableOutputTokens).toBe(35_000)
      expect(result.maxOutputTokens).toBe(35_000)
      expect(result.minUsefulOutputTokens).toBe(32_768)
    }
  })

  test("does not gate models with unknown context", () => {
    const result = OutputBudget.apply({
      model: createModel(0),
      messages: [{ role: "user", content: "hello" }],
      tools: {},
      maxOutputTokens: 20_000,
      promptTokens: 10_000,
    })

    expect(result.action).toBe("use")
    if (result.action === "use") {
      expect(result.maxOutputTokens).toBe(20_000)
      expect(result.clamped).toBe(false)
      expect(result.availableOutputTokens).toBeUndefined()
    }
  })

  test("does not count base64 media payloads as text prompt tokens", () => {
    const result = OutputBudget.apply({
      model: createModel(200_000, 131_072),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Please inspect this screenshot." },
            { type: "file", mediaType: "image/png", data: "a".repeat(1_200_000) },
          ],
        },
      ] as any,
      tools: {},
      maxOutputTokens: 65_536,
      outputDecision: {
        tokens: 65_536,
        level: "default",
        mode: "heuristic",
        reasons: ["vision-default"],
        needsJudge: false,
        policy: { default: 65_536, max: 131_072 },
      },
      outputLevel: "default",
    })

    expect(result.action).toBe("use")
    expect(result.promptTokens).toBeLessThan(50_000)
    if (result.action === "use") {
      expect(result.maxOutputTokens).toBe(65_536)
      expect(result.availableOutputTokens).toBeGreaterThan(100_000)
    }
  })
})
