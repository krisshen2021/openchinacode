import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Fiber } from "effect"
import { SessionID } from "../../src/session/schema"
import { SessionSteer } from "../../src/session/steer"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(SessionSteer.node))

const id = SessionID.make("ses_steertest")

describe("session.steer", () => {
  it.instance("signal reaches a live watcher", () =>
    Effect.gen(function* () {
      const steer = yield* SessionSteer.Service
      let fired = 0
      const watcher = yield* steer.watch(id, () => fired++).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* steer.signal(id)
      yield* Effect.yieldNow
      expect(fired).toBe(1)
      yield* steer.signal(id)
      yield* Effect.yieldNow
      expect(fired).toBe(2)
      yield* Fiber.interrupt(watcher)
    }),
  )

  it.instance("signal without a watcher is a no-op and does not go stale", () =>
    Effect.gen(function* () {
      const steer = yield* SessionSteer.Service
      yield* steer.signal(id) // no subscribers, must not throw
      let fired = 0
      const watcher = yield* steer.watch(id, () => fired++).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Effect.sleep("10 millis")
      expect(fired).toBe(0) // earlier signal must not linger for later watchers
      yield* Fiber.interrupt(watcher)
    }),
  )

  it.instance("signals are scoped by sessionID", () =>
    Effect.gen(function* () {
      const steer = yield* SessionSteer.Service
      const other = SessionID.make("ses_other")
      let fired = 0
      const watcher = yield* steer.watch(id, () => fired++).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* steer.signal(other)
      yield* Effect.yieldNow
      expect(fired).toBe(0)
      yield* Fiber.interrupt(watcher)
    }),
  )

  it.instance("interrupting the watcher releases the subscription", () =>
    Effect.gen(function* () {
      const steer = yield* SessionSteer.Service
      let first = 0
      const watcher = yield* steer.watch(id, () => first++).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Fiber.interrupt(watcher)
      let second = 0
      const next = yield* steer.watch(id, () => second++).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* steer.signal(id)
      yield* Effect.yieldNow
      expect(first).toBe(0) // interrupted watcher stays dead
      expect(second).toBe(1)
      yield* Fiber.interrupt(next)
    }),
  )
})
