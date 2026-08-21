import { Global } from "@opencode-ai/core/global"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"

const testStateLayer = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.promise(() => resetDatabase()),
    () => Effect.promise(() => resetDatabase()),
  ),
)

const it = testEffect(Layer.mergeAll(testStateLayer, httpApiLayer))
const projectOptions = { config: { formatter: false, lsp: false } }

const withModelsServer = <A, E, R>(
  handler: (req: Request) => Response,
  fn: (baseURL: string) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.serve({ port: 0, fetch: handler })),
      (server) => Effect.sync(() => server.stop(true)),
    )
    return yield* fn(`http://127.0.0.1:${server.port}`)
  })

describe("provider discovery HttpApi", () => {
  it.instance(
    "POST /provider/discover probes an OpenAI-compatible endpoint",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      yield* withModelsServer(
        () => Response.json({ data: [{ id: "m1", object: "model" }, { id: "m2" }] }),
        (baseURL) =>
          Effect.gen(function* () {
            const response = yield* request("/provider/discover", {
              method: "POST",
              headers: { "x-opencode-directory": directory, "content-type": "application/json" },
              body: JSON.stringify({ baseURL, apiKey: "sk-test" }),
            })
            expect(response.status).toBe(200)
            expect(JSON.parse(yield* response.text)).toEqual({
              models: [
                { id: "m1", name: "m1" },
                { id: "m2", name: "m2" },
              ],
            })
          }),
      )
    }),
    projectOptions,
    30000,
  )

  it.instance(
    "POST /provider/discover returns a declared Unsupported error on 404",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      yield* withModelsServer(
        () => new Response("nope", { status: 404 }),
        (baseURL) =>
          Effect.gen(function* () {
            const response = yield* request("/provider/discover", {
              method: "POST",
              headers: { "x-opencode-directory": directory, "content-type": "application/json" },
              body: JSON.stringify({ baseURL, apiKey: "sk-test" }),
            })
            expect(response.status).toBe(400)
            const body = JSON.parse(yield* response.text)
            expect(body.kind).toBe("Unsupported")
            expect(body.message).toContain("does not support model enumeration")
          }),
      )
    }),
    projectOptions,
    30000,
  )

  it.instance(
    "PUT then GET /provider/custom round-trips without exposing the apiKey",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const headers = { "x-opencode-directory": directory, "content-type": "application/json" }
      const saved = yield* request("/provider/custom/mine", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          name: "Mine",
          baseURL: "https://x.example/v1",
          models: ["m1", "m2"],
          discover_models: true,
          apiKey: "SECRET",
        }),
      })
      expect(saved.status).toBe(200)
      expect(JSON.parse(yield* saved.text)).toEqual({ ok: true })

      const listed = yield* request("/provider/custom", { headers })
      expect(listed.status).toBe(200)
      const body = yield* listed.text
      expect(JSON.parse(body)).toEqual([
        { id: "mine", name: "Mine", baseURL: "https://x.example/v1", models: ["m1", "m2"], discover_models: true },
      ])
      expect(body).not.toContain("SECRET")

      // the key landed in auth.json instead of the config file
      const auth = yield* Effect.promise(() => Bun.file(path.join(Global.Path.data, "auth.json")).json())
      expect(auth.mine).toEqual({ type: "api", key: "SECRET" })
    }),
    projectOptions,
    30000,
  )

  it.instance(
    "PUT /provider/custom rejects bad ids and empty model lists",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const headers = { "x-opencode-directory": directory, "content-type": "application/json" }
      const badID = yield* request("/provider/custom/Mine", {
        method: "PUT",
        headers,
        body: JSON.stringify({ baseURL: "https://x.example/v1", models: ["m1"], discover_models: false }),
      })
      expect(badID.status).toBe(400)
      expect(JSON.parse(yield* badID.text).kind).toBe("BadRequest")

      const empty = yield* request("/provider/custom/mine", {
        method: "PUT",
        headers,
        body: JSON.stringify({ baseURL: "https://x.example/v1", models: [], discover_models: false }),
      })
      expect(empty.status).toBe(400)
      expect(JSON.parse(yield* empty.text).kind).toBe("BadRequest")
    }),
    projectOptions,
    30000,
  )

  it.instance(
    "POST /provider/refresh rebuilds provider state and reports added models",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* request("/provider/refresh", {
        method: "POST",
        headers: { "x-opencode-directory": directory },
      })
      expect(response.status).toBe(200)
      const body = JSON.parse(yield* response.text)
      expect(Array.isArray(body.added)).toBe(true)
    }),
    projectOptions,
    30000,
  )
})
