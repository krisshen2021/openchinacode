import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { activityLayer } from "../../src/server/routes/instance/httpapi/middleware/activity"
import { ServerIdle } from "../../src/server/idle"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(NodeHttpServer.layerTest, NodeServices.layer))

describe("ServerIdle activity middleware", () => {
  it.live("an in-flight request blocks idle until it completes", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      yield* HttpRouter.add(
        "GET",
        "/slow",
        Effect.andThen(Deferred.complete(entered, Effect.void), Deferred.await(gate)).pipe(
          Effect.as(HttpServerResponse.text("ok")),
        ),
      ).pipe(Layer.provide(activityLayer), HttpRouter.serve, Layer.build)

      const fiber = yield* HttpClientRequest.get("/slow").pipe(HttpClient.execute, Effect.forkChild)
      yield* Deferred.await(entered)
      // The request is being handled by the server right now: a client is
      // actively waiting, so the idle watchdog must not fire no matter how old
      // the last stamp is.
      expect(ServerIdle.shouldIdle(Date.now() + 3_600_000, 1_000)).toBe(false)

      yield* Deferred.complete(gate, Effect.void)
      yield* Fiber.await(fiber)
      expect(ServerIdle.shouldIdle(Date.now() + 3_600_000, 1_000)).toBe(true)
    }),
  )
})
