export * as MemoryRetention from "./memory-retention"

import { Cause, Context, Duration, Effect, Layer, Schedule } from "effect"
import { and, inArray, isNotNull, isNull, lt, or } from "drizzle-orm"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionMemoryTable, SessionTable } from "../session/sql"

export const DEFAULT_RETENTION_DAYS = 0

export class Options extends Context.Service<Options, { readonly retentionDays: number }>()(
  "@opencode/v2/MemoryRetention/Options",
) {}

/**
 * Deletes session_memory rows whose session has no workspace binding and is
 * archived or untouched within the retention window. Session deletion itself
 * cascades via FK; this sweep only handles long-lived idle sessions when the
 * operator opts in. `retentionDays <= 0` disables the sweep (the default).
 */
export const sweepOnce = Effect.fn("MemoryRetention.sweepOnce")(function* (retentionDays: number) {
  if (retentionDays <= 0) return 0
  const database = yield* Database.Service
  const db = database.db
  const cutoff = Date.now() - Duration.toMillis(Duration.days(retentionDays))
  const eligible = db
    .select({ id: SessionTable.id })
    .from(SessionTable)
    .where(
      and(
        isNull(SessionTable.workspace_id),
        or(isNotNull(SessionTable.time_archived), lt(SessionTable.time_updated, cutoff)),
      ),
    )
  const sessions = yield* eligible.all().pipe(Effect.orDie)
  if (sessions.length === 0) return 0
  yield* db.delete(SessionMemoryTable).where(inArray(SessionMemoryTable.session_id, eligible)).run().pipe(Effect.orDie)
  yield* Effect.logInfo("session memory retention sweep pruned rows", {
    sessions: sessions.length,
    retentionDays,
  })
  return sessions.length
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const options = yield* Options
    if (options.retentionDays <= 0) {
      yield* Effect.logInfo("session memory retention sweep disabled", { retentionDays: options.retentionDays })
      return
    }
    yield* sweepOnce(options.retentionDays).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("session memory retention sweep failed", { cause: Cause.pretty(cause) }),
      ),
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

export const node = makeGlobalNode({ name: "memory-retention", layer, deps: [Database.node, optionsNode] })
