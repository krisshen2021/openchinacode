import { ServerIdle } from "@/server/idle"
import { Effect } from "effect"
import { HttpRouter } from "effect/unstable/http"

// Global transport policy: client activity is what keeps the server alive for
// idle shutdown — every in-flight HTTP request counts as an open connection
// (rejected requests release immediately, long LLM turns stay counted for the
// whole handling time). Server-side background events (file watcher, LSP, MCP)
// deliberately do NOT count; see the serve command for the rationale.
export const activityLayer = HttpRouter.middleware(
  (effect) =>
    Effect.acquireUseRelease(
      Effect.sync(ServerIdle.trackOpen),
      () => effect,
      (done) => Effect.sync(done),
    ),
  { global: true },
)
