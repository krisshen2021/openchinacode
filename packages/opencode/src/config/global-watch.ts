export * as ConfigGlobalWatch from "./global-watch"

import path from "path"
import { Cause, Effect } from "effect"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"

// Basenames that make up the global config (see loadGlobal). Anything else in
// the dir (auth.json, ...) must not invalidate the cached global config.
const CONFIG_FILES = new Set(["config.json", "openchinacode.json", "openchinacode.jsonc", "config"])

// The cached global config is loaded once per process with an infinite TTL, so
// edits made by another server process (e.g. /connect saving a custom provider
// in a different project directory) never reach this one. Watch the dir and
// invalidate on change. Degrades silently when the native binding is missing.
export const watch = Effect.fn("ConfigGlobalWatch.watch")(function* (dir: string, invalidate: Effect.Effect<void>) {
  const pending = Watcher.subscribeRaw(dir, (_error, events) => {
    if (events.some((event) => CONFIG_FILES.has(path.basename(event.path)))) Effect.runFork(invalidate)
  })
  if (!pending) return
  const subscription = yield* Effect.promise(() => pending).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("failed to watch global config dir", { dir, cause: Cause.pretty(cause) }).pipe(
        Effect.as(undefined),
      ),
    ),
  )
  if (!subscription) return
  yield* Effect.addFinalizer(() => Effect.promise(() => subscription.unsubscribe()))
})
