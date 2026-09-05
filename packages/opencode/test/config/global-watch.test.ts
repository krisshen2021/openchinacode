import { expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { pollWithTimeout } from "../lib/effect"
import { ConfigGlobalWatch } from "../../src/config/global-watch"

test("invokes invalidate when a global config file changes", async () => {
  await using tmp = await tmpdir()
  let calls = 0
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* ConfigGlobalWatch.watch(
          tmp.path,
          Effect.sync(() => {
            calls++
          }),
        )
        yield* Effect.promise(() => Bun.write(path.join(tmp.path, "openchinacode.jsonc"), "{}\n"))
        yield* pollWithTimeout(Effect.sync(() => (calls > 0 ? (true as const) : undefined)), "watcher never fired")
      }),
    ),
  )
  expect(calls).toBeGreaterThan(0)
})

test("ignores changes to non-config files", async () => {
  await using tmp = await tmpdir()
  let calls = 0
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* ConfigGlobalWatch.watch(
          tmp.path,
          Effect.sync(() => {
            calls++
          }),
        )
        // Liveness is proven by the companion test above; this one isolates the
        // basename filter, so no in-flight config-write events can leak in.
        yield* Effect.promise(() => Bun.write(path.join(tmp.path, "auth.json"), "{}\n"))
        yield* Effect.sleep("500 millis")
        expect(calls).toBe(0)
      }),
    ),
  )
})
