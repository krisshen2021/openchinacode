import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Discover } from "@/provider/discover"
import { testEffect } from "../lib/effect"
import { tmpdir } from "../fixture/fixture"

const it = testEffect(LayerNode.compile(FSUtil.node))

// fetchModels needs no Effect services, so these tests stay promise-style.
const withServer = <A>(handler: (req: Request) => Response | Promise<Response>, fn: (port: number) => Promise<A>) =>
  (async () => {
    const server = Bun.serve({ port: 0, fetch: handler })
    try {
      return await fn(server.port!)
    } finally {
      server.stop(true)
    }
  })()

const failKind = (exit: Exit.Exit<unknown, Discover.DiscoverError>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as Discover.DiscoverError).kind : undefined

describe("Discover.fetchModels", () => {
  test("parses the OpenAI shape and keeps id + name", async () => {
    const models = await withServer(
      () =>
        Response.json({
          object: "list",
          data: [{ id: "glm-5.4", object: "model", created: 1, owned_by: "zhipu" }, { id: "glm-5.3-air" }],
        }),
      (port) => Effect.runPromise(Discover.fetchModels(`http://127.0.0.1:${port}/v4`, "sk-test")),
    )
    expect(models).toEqual([
      { id: "glm-5.4", name: "glm-5.4" },
      { id: "glm-5.3-air", name: "glm-5.3-air" },
    ])
  })

  test("sends the bearer key", async () => {
    let seen: string | null = null
    const models = await withServer(
      (req) => {
        seen = req.headers.get("authorization")
        return Response.json({ data: [{ id: "m1" }] })
      },
      (port) => Effect.runPromise(Discover.fetchModels(`http://127.0.0.1:${port}`, "sk-secret")),
    )
    expect(seen ?? "").toBe("Bearer sk-secret")
    expect(models).toHaveLength(1)
  })

  test("fails with Auth on 401", async () => {
    const exit = await withServer(
      () => new Response("unauthorized", { status: 401 }),
      (port) => Effect.runPromiseExit(Discover.fetchModels(`http://127.0.0.1:${port}`, "bad")),
    )
    expect(failKind(exit)).toBe("Auth")
  })

  test("fails with Unsupported on 404 and on non-JSON bodies", async () => {
    for (const response of [new Response("nope", { status: 404 }), new Response("<html>", { status: 200 })]) {
      const exit = await withServer(
        () => response,
        (port) => Effect.runPromiseExit(Discover.fetchModels(`http://127.0.0.1:${port}`, "k")),
      )
      expect(failKind(exit)).toBe("Unsupported")
    }
  })

  test("fails with Network on connection refused", async () => {
    const exit = await Effect.runPromiseExit(Discover.fetchModels("http://127.0.0.1:1", "k"))
    expect(failKind(exit)).toBe("Network")
  })
})

describe("Discover cache", () => {
  it.live("round-trips entries and reports TTL freshness", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const cache = yield* Discover.makeCache(tmp.path)
      yield* cache.write("zhipuai-pay2go", [{ id: "glm-5.4", name: "glm-5.4" }])
      const fresh = yield* cache.read()
      expect(fresh["zhipuai-pay2go"].models).toEqual([{ id: "glm-5.4", name: "glm-5.4" }])
      expect(cache.isFresh(fresh["zhipuai-pay2go"])).toBe(true)
      yield* cache.expire("zhipuai-pay2go")
      const expired = yield* cache.read()
      expect(cache.isFresh(expired["zhipuai-pay2go"])).toBe(false)
    }),
  )

  it.live("treats a missing cache file as empty", () =>
    Effect.gen(function* () {
      const cache = yield* Discover.makeCache("/tmp/discover-test-nonexistent-dir")
      const data = yield* cache.read()
      expect(data).toEqual({})
    }),
  )
})

describe("Discover.mergeInto", () => {
  const stateModel = (id: string, name = id): any => ({
    id,
    providerID: "volcengine-agent-plan",
    name,
    family: "",
    api: { id, url: "https://ark.example/v3", npm: "@ai-sdk/openai-compatible" },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 8192 },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  })

  test("adds discovered models with defaults, never overwriting existing ones", () => {
    const provider: any = { models: { declared: stateModel("declared") } }
    Discover.mergeInto(
      provider,
      [
        { id: "declared", name: "declared" },
        { id: "new-model", name: "new-model" },
      ],
      undefined,
    )
    expect(Object.keys(provider.models).sort()).toEqual(["declared", "new-model"])
    expect(provider.models["new-model"].limit.context).toBe(128000)
    expect(provider.models["new-model"].capabilities.toolcall).toBe(true)
  })

  test("clones metadata from a catalog match when provided", () => {
    const provider: any = { models: {} }
    const catalogHit: any = stateModel("glm-5.4", "GLM 5.4")
    catalogHit.limit = { context: 200000, output: 128000 }
    Discover.mergeInto(provider, [{ id: "glm-5.4", name: "glm-5.4" }], (id: string) =>
      id === "glm-5.4" ? catalogHit : undefined,
    )
    expect(provider.models["glm-5.4"].limit.context).toBe(200000)
    expect(provider.models["glm-5.4"].name).toBe("GLM 5.4")
  })

  test("infers vision capability from the model id when no catalog metadata exists", () => {
    const provider: any = { models: {} }
    Discover.mergeInto(
      provider,
      [
        { id: "deepseek-v4-flash-vision-exp", name: "deepseek-v4-flash-vision-exp" },
        { id: "glm-5v-turbo", name: "glm-5v-turbo" },
        { id: "qwen-vl-max", name: "qwen-vl-max" },
        { id: "deepseek-v4-flash", name: "deepseek-v4-flash" },
      ],
      undefined,
    )
    expect(provider.models["deepseek-v4-flash-vision-exp"].capabilities.input.image).toBe(true)
    expect(provider.models["deepseek-v4-flash-vision-exp"].capabilities.attachment).toBe(true)
    expect(provider.models["glm-5v-turbo"].capabilities.input.image).toBe(true)
    expect(provider.models["qwen-vl-max"].capabilities.input.image).toBe(true)
    expect(provider.models["deepseek-v4-flash"].capabilities.input.image).toBe(false)
    expect(provider.models["deepseek-v4-flash"].capabilities.attachment).toBe(false)
  })

  test("infers reasoning capability for known reasoning families when no catalog metadata exists", () => {
    const provider: any = { models: {} }
    Discover.mergeInto(
      provider,
      [
        { id: "glm-5.3-flash", name: "glm-5.3-flash" },
        { id: "kimi-k3", name: "kimi-k3" },
        { id: "deepseek-v4-flash-vision-exp", name: "deepseek-v4-flash-vision-exp" },
        { id: "glm-4.7", name: "glm-4.7" },
        { id: "qwen3.8-max", name: "qwen3.8-max" },
      ],
      undefined,
    )
    expect(provider.models["glm-5.3-flash"].capabilities.reasoning).toBe(true)
    expect(provider.models["kimi-k3"].capabilities.reasoning).toBe(true)
    expect(provider.models["deepseek-v4-flash-vision-exp"].capabilities.reasoning).toBe(true)
    expect(provider.models["glm-4.7"].capabilities.reasoning).toBe(false)
    expect(provider.models["qwen3.8-max"].capabilities.reasoning).toBe(true)
  })

  test("sets reasoning_content interleaved field for reasoning families that stream it", () => {
    const provider: any = { models: {} }
    Discover.mergeInto(
      provider,
      [
        { id: "qwen3.8-flash", name: "qwen3.8-flash" },
        { id: "deepseek-v4-flash", name: "deepseek-v4-flash" },
        { id: "glm-4.7", name: "glm-4.7" },
      ],
      undefined,
    )
    expect(provider.models["qwen3.8-flash"].capabilities.interleaved).toEqual({ field: "reasoning_content" })
    expect(provider.models["deepseek-v4-flash"].capabilities.interleaved).toEqual({ field: "reasoning_content" })
    expect(provider.models["glm-4.7"].capabilities.interleaved).toBe(false)
  })

  test("inherits limits from the longest family-prefix catalog entry", () => {
    const catalog: Array<readonly [string, { limit: { context: number; output: number } }]> = [
      ["deepseek-v4-flash", { limit: { context: 1000000, output: 384000 } }],
      ["deepseek-v4", { limit: { context: 500000, output: 100000 } }],
    ]
    expect(Discover.familyLimit(catalog, "deepseek-v4-flash-vision-exp")).toEqual({
      context: 1000000,
      output: 384000,
    })
    expect(Discover.familyLimit(catalog, "deepseek-v4-pro")).toEqual({ context: 500000, output: 100000 })
    expect(Discover.familyLimit(catalog, "deepseek-v4-flash")).toEqual({ context: 500000, output: 100000 })
    expect(Discover.familyLimit(catalog, "deepseek")).toBeUndefined()
    expect(Discover.familyLimit(catalog, "glm-4.5")).toBeUndefined()
  })

  test("family-prefix requires a separator boundary", () => {
    const catalog: Array<readonly [string, { limit: { context: number; output: number } }]> = [
      ["glm-5", { limit: { context: 200000, output: 32000 } }],
    ]
    expect(Discover.familyLimit(catalog, "glm-55-special")).toBeUndefined()
    expect(Discover.familyLimit(catalog, "glm-5.3")).toEqual({ context: 200000, output: 32000 })
  })

  test("prefix-inherited limits apply only when there is no catalog hit", () => {
    const provider: any = { models: {} }
    const prefixLimit = (id: string) =>
      id === "deepseek-v4-flash-vision-exp" ? { context: 1000000, output: 384000 } : undefined
    Discover.mergeInto(
      provider,
      [
        { id: "deepseek-v4-flash-vision-exp", name: "deepseek-v4-flash-vision-exp" },
        { id: "other-model", name: "other-model" },
      ],
      undefined,
      prefixLimit,
    )
    expect(provider.models["deepseek-v4-flash-vision-exp"].limit).toEqual({ context: 1000000, output: 384000 })
    expect(provider.models["other-model"].limit).toEqual({ context: 128000, output: 8192 })
  })
})

describe("Discover.enabled", () => {
  test("defaults on for the built-in trio, off for custom, config wins", () => {
    expect(Discover.enabled(undefined, "zhipuai-pay2go")).toBe(true)
    expect(Discover.enabled(undefined, "moonshotai-cn")).toBe(true)
    expect(Discover.enabled(undefined, "deepseek")).toBe(true)
    expect(Discover.enabled(undefined, "volcengine-agent-plan")).toBe(false)
    expect(Discover.enabled({ discover_models: false }, "zhipuai-pay2go")).toBe(false)
    expect(Discover.enabled({ discover_models: true }, "volcengine-agent-plan")).toBe(true)
  })
})
