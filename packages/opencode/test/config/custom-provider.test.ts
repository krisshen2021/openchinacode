import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { readFile, writeFile } from "node:fs/promises"
import path from "path"
import { parse as parseJsonc } from "jsonc-parser"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CustomProvider } from "@/config/custom-provider"
import { testEffect } from "../lib/effect"
import { tmpdir } from "../fixture/fixture"

const it = testEffect(LayerNode.compile(FSUtil.node))

const withTmpdir = <A, E, R>(fn: (dir: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    return yield* fn(tmp.path)
  })

describe("CustomProvider.save", () => {
  it.live("creates openchinacode.jsonc when missing", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        yield* CustomProvider.save(dir, {
          id: "volcengine-agent-plan",
          name: "Volcengine Ark",
          baseURL: "https://ark.cn-beijing.volces.com/api/plan/v3",
          models: ["glm-5.3", "kimi-k3"],
          discover_models: false,
        })
        const written = JSON.parse(yield* Effect.promise(() => readFile(path.join(dir, "openchinacode.jsonc"), "utf8")))
        expect(written.provider["volcengine-agent-plan"].npm).toBe("@ai-sdk/openai-compatible")
        expect(written.provider["volcengine-agent-plan"].options.baseURL).toBe(
          "https://ark.cn-beijing.volces.com/api/plan/v3",
        )
        expect(Object.keys(written.provider["volcengine-agent-plan"].models)).toEqual(["glm-5.3", "kimi-k3"])
        expect(written.provider["volcengine-agent-plan"].discover_models).toBe(false)
      }),
    ),
  )

  it.live("edits in place, preserving comments and unrelated keys", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "openchinacode.jsonc")
        yield* Effect.promise(() =>
          writeFile(
            file,
            `{
  // my default model
  "model": "zhipuai-pay2go/glm-5.2",
  "provider": {
    "volcengine-agent-plan": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://old.example/v3" },
      "models": { "glm-5.3": { "name": "glm-5.3" } }
    }
  }
}
`,
          ),
        )
        yield* CustomProvider.save(dir, {
          id: "volcengine-agent-plan",
          baseURL: "https://ark.cn-beijing.volces.com/api/plan/v3",
          models: ["glm-5.4"],
          discover_models: true,
        })
        const text = yield* Effect.promise(() => readFile(file, "utf8"))
        expect(text).toContain("// my default model")
        const written = parseJsonc(text)
        expect(written.model).toBe("zhipuai-pay2go/glm-5.2")
        expect(written.provider["volcengine-agent-plan"].options.baseURL).toBe(
          "https://ark.cn-beijing.volces.com/api/plan/v3",
        )
        expect(Object.keys(written.provider["volcengine-agent-plan"].models)).toEqual(["glm-5.4"])
        expect(written.provider["volcengine-agent-plan"].discover_models).toBe(true)
      }),
    ),
  )

  it.live("lists config-declared custom providers without apiKey", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "openchinacode.jsonc")
        yield* Effect.promise(() =>
          writeFile(
            file,
            JSON.stringify({
              provider: {
                mine: {
                  npm: "@ai-sdk/openai-compatible",
                  options: { baseURL: "https://x.example/v1", apiKey: "SECRET" },
                  discover_models: true,
                  models: { m1: { name: "m1" } },
                },
              },
            }),
          ),
        )
        const list = yield* CustomProvider.list(dir)
        expect(list).toEqual([
          { id: "mine", name: undefined, baseURL: "https://x.example/v1", models: ["m1"], discover_models: true },
        ])
        expect(JSON.stringify(list)).not.toContain("SECRET")
      }),
    ),
  )
})
