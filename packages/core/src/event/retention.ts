export * as EventRetention from "./retention"

import { Cause, Context, Duration, Effect, Layer, Schedule } from "effect"
import { and, inArray, isNotNull, isNull, lt, or } from "drizzle-orm"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionTable } from "../session/sql"
import { EventTable } from "./sql"

export const DEFAULT_RETENTION_DAYS = 7

export class Options extends Context.Service<Options, { readonly retentionDays: number }>()(
  "@opencode/v2/EventRetention/Options",
) {}

/**
 * Deletes durable `event` rows for aggregates whose session row exists, has no
 * workspace binding, and is archived or untouched within the retention window.
 * Returns the number of eligible aggregates; `retentionDays <= 0` disables the
 * sweep.
 */
export const sweepOnce = Effect.fn("EventRetention.sweepOnce")(function* (retentionDays: number) {
  if (retentionDays <= 0) return 0
  const database = yield* Database.Service
  const db = database.db
  const cutoff = Date.now() - Duration.toMillis(Duration.days(retentionDays))
  // Workspace-bound sessions are never pruned: the event log stays load-bearing
  // for cross-instance sync there. Aggregates with no session row are left to
  // EventV2.remove, which cascades on session delete.
  const eligible = db
    .select({ id: SessionTable.id })
    .from(SessionTable)
    .where(
      and(
        isNull(SessionTable.workspace_id),
        or(isNotNull(SessionTable.time_archived), lt(SessionTable.time_updated, cutoff)),
      ),
    )
  const aggregates = yield* eligible.all().pipe(Effect.orDie)
  if (aggregates.length === 0) return 0
  // event_sequence must never be deleted: fence/waitForSync depend on it. The
  // deleted event pages become freelist and get reused, so the database file
  // plateaus instead of shrinking — do not "fix" the file size with VACUUM.
  yield* db.delete(EventTable).where(inArray(EventTable.aggregate_id, eligible)).run().pipe(Effect.orDie)
  yield* Effect.logInfo("event retention sweep pruned durable event rows", {
    aggregates: aggregates.length,
    retentionDays,
  })
  return aggregates.length
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const options = yield* Options
    if (options.retentionDays <= 0) {
      yield* Effect.logInfo("event retention sweep disabled", { retentionDays: options.retentionDays })
      return
    }
    yield* sweepOnce(options.retentionDays).pipe(
      Effect.catchCause((cause) => Effect.logError("event retention sweep failed", { cause: Cause.pretty(cause) })),
      Effect.repeat(Schedule.spaced(Duration.hours(1))),
      Effect.forkScoped,
    )
  }),
)

export const optionsNode = makeGlobalNode({
  service: Options,
  layer: Layer.succeed(Options, { retentionDays: DEFAULT_RETENTION_DAYS }),
  deps: [],
})

export const node = makeGlobalNode({ name: "event-retention", layer, deps: [Database.node, optionsNode] })
