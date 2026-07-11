import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { Agent } from "../../src/agent/agent"
import type { Provider } from "../../src/provider/provider"
import { TaskPolicy } from "../../src/session/task-policy"

const agent: Agent.Info = {
  name: "general",
  mode: "subagent",
  permission: [],
  options: {},
}

const inherited = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("parent-model"),
}

function mockProvider(input: { tagged?: boolean } = {}): Provider.Interface {
  const providerID = ProviderV2.ID.make("test")
  const debugModelID = ModelV2.ID.make("debug-model")
  const glmProviderID = ProviderV2.ID.make("zhipuai-pay2go")
  const glmModelID = ModelV2.ID.make("glm-5.2")
  const glmVisionModelID = ModelV2.ID.make("glm-5v-turbo")
  const kimiProviderID = ProviderV2.ID.make("moonshotai-cn")
  const kimiHighspeedModelID = ModelV2.ID.make("kimi-k2.7-code-highspeed")
  const deepseekProviderID = ProviderV2.ID.make("deepseek")
  const deepseekProModelID = ModelV2.ID.make("deepseek-v4-pro")
  const deepseekFlashModelID = ModelV2.ID.make("deepseek-v4-flash")
  const modelBase: Omit<Provider.Model, "id" | "providerID" | "name"> = {
    api: { id: "model", npm: "@ai-sdk/openai-compatible", url: "http://localhost:1/v1" },
    capabilities: {
      attachment: false,
      reasoning: false,
      temperature: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 100000, output: 10000 },
    status: "active" as const,
    options: {},
    headers: {},
    release_date: "2026-01-01",
  }
  const model = (providerID: ProviderV2.ID, id: ModelV2.ID, name: string, extra: Partial<Provider.Model> = {}) => ({
    ...modelBase,
    id,
    providerID,
    name,
    api: { ...modelBase.api, id },
    ...extra,
  })
  const providers = {
    [providerID]: {
      id: providerID,
      name: "Test",
      source: "config" as const,
      env: [],
      options: {},
      models: {
        [debugModelID]: model(
          providerID,
          debugModelID,
          "Debug Model",
          input.tagged === false ? {} : { task_classes: ["debug"] },
        ),
      },
    },
    [glmProviderID]: {
      id: glmProviderID,
      name: "Zhipu AI Pay2Go",
      source: "api" as const,
      env: [],
      options: {},
      models: {
        [glmModelID]: model(glmProviderID, glmModelID, "GLM 5.2"),
        [glmVisionModelID]: model(glmProviderID, glmVisionModelID, "GLM 5V Turbo", {
          capabilities: {
            ...modelBase.capabilities,
            attachment: true,
            input: { ...modelBase.capabilities.input, image: true, video: true, pdf: true },
          },
        }),
      },
    },
    [kimiProviderID]: {
      id: kimiProviderID,
      name: "Moonshot AI",
      source: "api" as const,
      env: [],
      options: {},
      models: {
        [kimiHighspeedModelID]: model(kimiProviderID, kimiHighspeedModelID, "Kimi K2.7 Code Highspeed"),
      },
    },
    [deepseekProviderID]: {
      id: deepseekProviderID,
      name: "DeepSeek",
      source: "api" as const,
      env: [],
      options: {},
      models: {
        [deepseekProModelID]: model(deepseekProviderID, deepseekProModelID, "DeepSeek V4 Pro"),
        [deepseekFlashModelID]: model(deepseekProviderID, deepseekFlashModelID, "DeepSeek V4 Flash"),
      },
    },
  }

  return {
    list: () => Effect.succeed(providers),
    getProvider: (id: ProviderV2.ID) => {
      const provider = providers[id]
      return provider ? Effect.succeed(provider) : Effect.fail(new Error("not found"))
    },
    getModel: (id: ProviderV2.ID, modelID: ModelV2.ID) => {
      const model = providers[id]?.models[modelID]
      return model ? Effect.succeed(model) : Effect.fail(new Error("not found"))
    },
    getLanguage: () => Effect.die("unused"),
    getSmallModel: () => Effect.succeed(undefined),
    defaultModel: () => Effect.fail(new Error("unused")),
    closest: () => Effect.succeed(undefined),
  } as unknown as Provider.Interface
}

describe("task policy", () => {
  test("classifies debug tasks", () => {
    const result = TaskPolicy.classify({
      agent,
      description: "inspect bug",
      prompt: "debug the failing cache invalidation path",
    })

    expect(result.kind).toBe("debug")
    expect(result.complexity).toBe("medium")
    expect(result.confidence).toBeGreaterThan(0.7)
  })

  test("selects tagged model when no explicit policy map exists", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider(),
        agent,
        inherited,
        description: "inspect bug",
        prompt: "debug the failing cache invalidation path",
      }),
    )

    expect(result?.source).toBe("model_task_class")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("test"),
      modelID: ModelV2.ID.make("debug-model"),
    })
  })

  test("leaves general tasks on the inherited parent model by default", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent,
        inherited,
        description: "handle request",
        prompt: "please handle this task",
      }),
    )

    expect(result?.source).toBe("openchinacode.default")
    expect(result?.route.inherit).toBe(true)
  })

  test("routes complex architecture to GLM max", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent,
        inherited,
        description: "complex architecture plan",
        prompt: "design a complex system-wide architecture migration",
      }),
    )

    expect(result?.assignment.kind).toBe("architecture")
    expect(result?.assignment.complexity).toBe("complex")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("zhipuai-pay2go"),
      modelID: ModelV2.ID.make("glm-5.2"),
    })
    expect(result?.route.variant).toBe("max")
  })

  test("routes medium refactor to GLM high", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent,
        inherited,
        description: "refactor modules",
        prompt: "refactor the cache module layout",
      }),
    )

    expect(result?.assignment.kind).toBe("refactor")
    expect(result?.assignment.complexity).toBe("medium")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("zhipuai-pay2go"),
      modelID: ModelV2.ID.make("glm-5.2"),
    })
    expect(result?.route.variant).toBe("high")
  })

  test("routes frontend UI/UX refactor planning to GLM max", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent,
        inherited,
        description: "frontend UI/UX refactor plan",
        prompt: "基于当前结果，第一步重构前端ui/ux，需要你建议一个合适的技术栈，然后提出一个前端重构计划",
      }),
    )

    expect(result?.assignment.kind).toBe("refactor")
    expect(result?.assignment.complexity).toBe("complex")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("zhipuai-pay2go"),
      modelID: ModelV2.ID.make("glm-5.2"),
    })
    expect(result?.route.variant).toBe("max")
  })

  test("routes quick implementation to Kimi highspeed", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent,
        inherited,
        description: "quick implementation",
        prompt: "change one label",
        kindHint: "implement",
        complexityHint: "quick",
      }),
    )

    expect(result?.assignment.kind).toBe("implement")
    expect(result?.assignment.complexity).toBe("quick")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("moonshotai-cn"),
      modelID: ModelV2.ID.make("kimi-k2.7-code-highspeed"),
    })
  })

  test("routes medium implementation to GLM high", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent,
        inherited,
        description: "implement feature",
        prompt: "add support for task assignment routes",
        kindHint: "implement",
        complexityHint: "medium",
      }),
    )

    expect(result?.assignment.kind).toBe("implement")
    expect(result?.assignment.complexity).toBe("medium")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("zhipuai-pay2go"),
      modelID: ModelV2.ID.make("glm-5.2"),
    })
    expect(result?.route.variant).toBe("high")
  })

  test("routes complex implementation to GLM max", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent,
        inherited,
        description: "complex implementation",
        prompt: "implement a complex system-wide feature",
      }),
    )

    expect(result?.assignment.kind).toBe("implement")
    expect(result?.assignment.complexity).toBe("complex")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("zhipuai-pay2go"),
      modelID: ModelV2.ID.make("glm-5.2"),
    })
    expect(result?.route.variant).toBe("max")
  })

  test("routes quick review to Kimi highspeed", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent,
        inherited,
        description: "quick review",
        prompt: "review this small change",
        kindHint: "review",
        complexityHint: "quick",
      }),
    )

    expect(result?.assignment.kind).toBe("review")
    expect(result?.assignment.complexity).toBe("quick")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("moonshotai-cn"),
      modelID: ModelV2.ID.make("kimi-k2.7-code-highspeed"),
    })
  })

  test("routes medium review to GLM high", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent,
        inherited,
        description: "module review",
        prompt: "review this feature implementation",
        kindHint: "review",
        complexityHint: "medium",
      }),
    )

    expect(result?.assignment.kind).toBe("review")
    expect(result?.assignment.complexity).toBe("medium")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("zhipuai-pay2go"),
      modelID: ModelV2.ID.make("glm-5.2"),
    })
    expect(result?.route.variant).toBe("high")
  })

  test("routes complex review to GLM max", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent,
        inherited,
        description: "full project review",
        prompt: "perform a comprehensive full codebase review",
      }),
    )

    expect(result?.assignment.kind).toBe("review")
    expect(result?.assignment.complexity).toBe("complex")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("zhipuai-pay2go"),
      modelID: ModelV2.ID.make("glm-5.2"),
    })
    expect(result?.route.variant).toBe("max")
  })

  test("routes quick exploration to Kimi highspeed", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent: { ...agent, name: "explore" },
        inherited,
        description: "quick search",
        prompt: "quickly find where model routing is implemented",
      }),
    )

    expect(result?.assignment.kind).toBe("explore")
    expect(result?.assignment.complexity).toBe("quick")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("moonshotai-cn"),
      modelID: ModelV2.ID.make("kimi-k2.7-code-highspeed"),
    })
  })

  test("routes medium exploration to GLM high", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent: { ...agent, name: "explore" },
        inherited,
        description: "inspect project architecture",
        prompt: "inspect the project structure and identify the likely refactor area",
        kindHint: "explore",
        complexityHint: "medium",
      }),
    )

    expect(result?.assignment.kind).toBe("explore")
    expect(result?.assignment.complexity).toBe("medium")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("zhipuai-pay2go"),
      modelID: ModelV2.ID.make("glm-5.2"),
    })
    expect(result?.route.variant).toBe("high")
  })

  test("routes complex exploration to GLM max", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent: { ...agent, name: "explore" },
        inherited,
        description: "deep project analysis",
        prompt: "deeply inspect and explore the full codebase behavior",
      }),
    )

    expect(result?.assignment.kind).toBe("explore")
    expect(result?.assignment.complexity).toBe("complex")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("zhipuai-pay2go"),
      modelID: ModelV2.ID.make("glm-5.2"),
    })
    expect(result?.route.variant).toBe("max")
  })

  test("routes screenshot visual checks to GLM 5V Turbo", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent,
        inherited,
        description: "browser screenshot visual check",
        prompt: "请看一下浏览器页面截图，指出 UI 布局、遮挡、可访问性问题",
      }),
    )

    expect(result?.assignment.kind).toBe("visual_check")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("zhipuai-pay2go"),
      modelID: ModelV2.ID.make("glm-5v-turbo"),
    })
    expect(result?.route.variant).toBeUndefined()
  })

  test("routes explicit visual_check hints to GLM 5V Turbo for every complexity", async () => {
    for (const complexityHint of ["quick", "medium", "complex"] as const) {
      const result = await Effect.runPromise(
        TaskPolicy.select({
          cfg: {},
          provider: mockProvider({ tagged: false }),
          agent,
          inherited,
          description: `${complexityHint} visual check`,
          prompt: "inspect this screenshot",
          kindHint: "visual_check",
          complexityHint,
        }),
      )

      expect(result?.assignment.kind).toBe("visual_check")
      expect(result?.assignment.complexity).toBe(complexityHint)
      expect(result?.route.model).toEqual({
        providerID: ProviderV2.ID.make("zhipuai-pay2go"),
        modelID: ModelV2.ID.make("glm-5v-turbo"),
      })
      expect(result?.route.variant).toBeUndefined()
    }
  })

  test("routes quick and medium debug tasks to DeepSeek high", async () => {
    for (const complexityHint of ["quick", "medium"] as const) {
      const result = await Effect.runPromise(
        TaskPolicy.select({
          cfg: {},
          provider: mockProvider({ tagged: false }),
          agent,
          inherited,
          description: `${complexityHint} debug`,
          prompt: "debug the failing request path",
          kindHint: "debug",
          complexityHint,
        }),
      )

      expect(result?.assignment.kind).toBe("debug")
      expect(result?.assignment.complexity).toBe(complexityHint)
      expect(result?.route.model).toEqual({
        providerID: ProviderV2.ID.make("deepseek"),
        modelID: ModelV2.ID.make("deepseek-v4-pro"),
      })
      expect(result?.route.variant).toBe("high")
    }
  })

  test("routes complex test fixes to DeepSeek max", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent,
        inherited,
        description: "complex test fix",
        prompt: "fix a complex cross-module failing test suite",
        kindHint: "test_fix",
        complexityHint: "complex",
      }),
    )

    expect(result?.assignment.kind).toBe("test_fix")
    expect(result?.assignment.complexity).toBe("complex")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("deepseek"),
      modelID: ModelV2.ID.make("deepseek-v4-pro"),
    })
    expect(result?.route.variant).toBe("max")
  })

  test("routes compaction to GLM high", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent,
        inherited,
        description: "compact history",
        prompt: "preserve coding context during compaction",
        kindHint: "compaction",
        complexityHint: "medium",
      }),
    )

    expect(result?.assignment.kind).toBe("compaction")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("zhipuai-pay2go"),
      modelID: ModelV2.ID.make("glm-5.2"),
    })
    expect(result?.route.variant).toBe("high")
  })

  test("routes medium summaries to Kimi highspeed", async () => {
    const result = await Effect.runPromise(
      TaskPolicy.select({
        cfg: {},
        provider: mockProvider({ tagged: false }),
        agent,
        inherited,
        description: "summarize findings",
        prompt: "summarize the current investigation",
      }),
    )

    expect(result?.assignment.kind).toBe("summarize")
    expect(result?.assignment.complexity).toBe("medium")
    expect(result?.route.model).toEqual({
      providerID: ProviderV2.ID.make("moonshotai-cn"),
      modelID: ModelV2.ID.make("kimi-k2.7-code-highspeed"),
    })
  })
})
