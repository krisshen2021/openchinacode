import { describe, expect } from "bun:test"
import { Duration, Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventRetention } from "@opencode-ai/core/event/retention"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Session } from "@opencode-ai/schema/session"
import { SessionV1 } from "@opencode-ai/schema/session-v1"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node])))

const DurableMessage = SessionV1.Event.MessageRemoved
const durableData = (sessionID: Session.ID, text: string) => ({
  sessionID,
  messageID: SessionV1.MessageID.ascending(`msg_${text}`),
})

const seedSession = (input: {
  readonly id: Session.ID
  readonly archived?: boolean
  readonly workspaceID?: string
  readonly updatedDaysAgo?: number
}) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const now = Date.now()
    const updated = now - (input.updatedDaysAgo ?? 0) * Duration.toMillis(Duration.days(1))
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: input.id,
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        ...(input.workspaceID ? { workspace_id: WorkspaceV2.ID.make(input.workspaceID) } : {}),
        ...(input.archived ? { time_archived: now } : {}),
        time_created: updated,
        time_updated: updated,
      })
      .run()
      .pipe(Effect.orDie)
  })

const publishTwo = Effect.fnUntraced(function* (sessionID: Session.ID) {
  const events = yield* EventV2.Service
  yield* events.publish(DurableMessage, durableData(sessionID, "one"))
  yield* events.publish(DurableMessage, durableData(sessionID, "two"))
})

const eventRows = Effect.fnUntraced(function* (aggregateID: string) {
  const { db } = yield* Database.Service
  return yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, aggregateID)).all().pipe(Effect.orDie)
})

const sequenceRows = Effect.fnUntraced(function* () {
  const { db } = yield* Database.Service
  return yield* db.select().from(EventSequenceTable).all().pipe(Effect.orDie)
})

describe("EventRetention", () => {
  it.effect("prunes only archived unbound sessions, keeping event_sequence intact", () =>
    Effect.gen(function* () {
      const archived = Session.ID.make("ses_archived_unbound")
      const active = Session.ID.make("ses_active")
      const bound = Session.ID.make("ses_archived_bound")
      const recent = Session.ID.make("ses_recent_unbound")
      yield* seedSession({ id: archived, archived: true, updatedDaysAgo: 30 })
      yield* seedSession({ id: active })
      yield* seedSession({ id: bound, archived: true, workspaceID: "wrk_bound", updatedDaysAgo: 30 })
      yield* seedSession({ id: recent, updatedDaysAgo: 3 })
      yield* publishTwo(archived)
      yield* publishTwo(active)
      yield* publishTwo(bound)
      yield* publishTwo(recent)

      const pruned = yield* EventRetention.sweepOnce(7)

      expect(pruned).toBe(1)
      expect(yield* eventRows(archived)).toEqual([])
      expect((yield* eventRows(active)).map((row) => row.seq)).toEqual([0, 1])
      expect((yield* eventRows(bound)).map((row) => row.seq)).toEqual([0, 1])
      expect((yield* eventRows(recent)).map((row) => row.seq)).toEqual([0, 1])
      expect((yield* sequenceRows()).map((row) => [row.aggregate_id, row.seq])).toEqual([
        [archived, 1],
        [active, 1],
        [bound, 1],
        [recent, 1],
      ])
    }),
  )

  it.effect("prunes unbound sessions idle beyond the window without an archive marker", () =>
    Effect.gen(function* () {
      const idle = Session.ID.make("ses_idle_unbound")
      yield* seedSession({ id: idle, updatedDaysAgo: 30 })
      yield* publishTwo(idle)

      const pruned = yield* EventRetention.sweepOnce(7)

      expect(pruned).toBe(1)
      expect(yield* eventRows(idle)).toEqual([])
      expect(yield* sequenceRows()).toHaveLength(1)
    }),
  )

  it.effect("does nothing when retention is disabled", () =>
    Effect.gen(function* () {
      const archived = Session.ID.make("ses_disabled")
      yield* seedSession({ id: archived, archived: true, updatedDaysAgo: 30 })
      yield* publishTwo(archived)

      const pruned = yield* EventRetention.sweepOnce(0)

      expect(pruned).toBe(0)
      expect(yield* eventRows(archived)).toHaveLength(2)
    }),
  )

  it.effect("leaves orphan aggregates without a session row untouched", () =>
    Effect.gen(function* () {
      const orphan = Session.ID.make("ses_orphan")
      yield* publishTwo(orphan)

      const pruned = yield* EventRetention.sweepOnce(7)

      expect(pruned).toBe(0)
      expect(yield* eventRows(orphan)).toHaveLength(2)
    }),
  )

  it.effect("skips stale replay idempotently once the stored row was pruned", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const aggregateID = Session.ID.make("ses_pruned_replay")
      yield* seedSession({ id: aggregateID, archived: true, updatedDaysAgo: 30 })
      const replayed = {
        id: EventV2.ID.create(),
        type: EventV2.versionedType(DurableMessage.type, 1),
        seq: 0,
        aggregateID,
        data: durableData(aggregateID, "original"),
      }
      yield* events.replay(replayed)
      yield* EventRetention.sweepOnce(7)
      expect(yield* eventRows(aggregateID)).toEqual([])

      yield* events.replay(replayed)
      yield* events.replay({ ...replayed, data: durableData(aggregateID, "tampered") })

      expect(yield* eventRows(aggregateID)).toEqual([])
      expect(yield* sequenceRows()).toEqual([{ aggregate_id: aggregateID, seq: 0, owner_id: null }])
    }),
  )

  it.effect("still rejects divergent stale replay over an existing row", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const aggregateID = Session.ID.make("ses_divergent_replay")
      const replayed = {
        id: EventV2.ID.create(),
        type: EventV2.versionedType(DurableMessage.type, 1),
        seq: 0,
        aggregateID,
        data: durableData(aggregateID, "original"),
      }
      yield* events.replay(replayed)

      const exit = yield* events.replay({ ...replayed, data: durableData(aggregateID, "divergent") }).pipe(Effect.exit)

      expect(String(exit)).toContain("Replay diverged")
      expect(yield* eventRows(aggregateID)).toHaveLength(1)
    }),
  )
})
