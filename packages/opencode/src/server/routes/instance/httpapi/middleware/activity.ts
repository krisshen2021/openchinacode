import { ServerIdle } from "@/server/idle"
import { Effect } from "effect"
import { HttpRouter } from "effect/unstable/http"

// Global transport policy: every HTTP request is server activity for idle
// shutdown, so the stamp lives here instead of per-route. Stamp before
// dispatch so rejected requests (auth, 404) count too.
export const activityLayer = HttpRouter.middleware((effect) => Effect.andThen(Effect.sync(ServerIdle.stamp), effect), {
  global: true,
})
