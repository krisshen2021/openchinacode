import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Env } from "@/env"
import { Plugin } from "@/plugin/index"
import { Provider } from "@/provider/provider"
import { testEffect } from "../lib/effect"
import { provideTmpdirInstance } from "../fixture/fixture"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node, CrossSpawnSpawner.node])),
)

// The stub /models server must start before the instance config is written, so
// these tests drive provideTmpdirInstance directly instead of it.instance.
const withModelsServer = <A, E, R>(models: string[], fn: (baseURL: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.serve({ port: 0, fetch: () => Response.json({ data: models.map((id) => ({ id })) }) })),
      (server) => Effect.sync(() => server.stop(true)),
    )
    return yield* fn(`http://127.0.0.1:${server.port}`)
  })

describe("Provider state discovery", () => {
  it.live("picks up stub models when discover_models is true", () =>
    withModelsServer(["glm-9.9", "glm-9.9-air"], (baseURL) =>
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            const providers = yield* provider.list()
            const entry = providers[ProviderV2.ID.make("disc-test-auto")]
            expect(entry).toBeDefined()
            expect(Object.keys(entry.models).sort()).toEqual(["glm-9.9", "glm-9.9-air"])
            const model = entry.models["glm-9.9"]
            expect(model.providerID).toBe(ProviderV2.ID.make("disc-test-auto"))
            expect(model.api.url).toBe(baseURL)
            expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
            expect(model.limit.context).toBe(128000)
            expect(model.capabilities.toolcall).toBe(true)
          }),
        {
          config: {
            provider: {
              "disc-test-auto": {
                npm: "@ai-sdk/openai-compatible",
                options: { baseURL, apiKey: "sk-test" },
                discover_models: true,
              },
            },
          },
        },
      ),
    ),
  )

  it.live("ignores the endpoint when discover_models is false", () =>
    withModelsServer(["glm-9.9"], (baseURL) =>
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            const providers = yield* provider.list()
            const entry = providers[ProviderV2.ID.make("disc-test-off")]
            expect(entry).toBeDefined()
            expect(Object.keys(entry.models)).toEqual(["declared"])
          }),
        {
          config: {
            provider: {
              "disc-test-off": {
                npm: "@ai-sdk/openai-compatible",
                options: { baseURL, apiKey: "sk-test" },
                discover_models: false,
                models: { declared: { name: "Declared" } },
              },
            },
          },
        },
      ),
    ),
  )

  it.live("config-declared models keep their own metadata over discovered ones", () =>
    withModelsServer(["glm-9.9"], (baseURL) =>
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            const providers = yield* provider.list()
            const entry = providers[ProviderV2.ID.make("disc-test-declared")]
            expect(entry).toBeDefined()
            expect(Object.keys(entry.models)).toEqual(["glm-9.9"])
            expect(entry.models["glm-9.9"].name).toBe("Declared GLM")
            expect(entry.models["glm-9.9"].limit.context).toBe(999)
          }),
        {
          config: {
            provider: {
              "disc-test-declared": {
                npm: "@ai-sdk/openai-compatible",
                options: { baseURL, apiKey: "sk-test" },
                discover_models: true,
                models: { "glm-9.9": { name: "Declared GLM", limit: { context: 999, output: 100 } } },
              },
            },
          },
        },
      ),
    ),
  )
})
