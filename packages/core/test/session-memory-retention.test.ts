import { describe, expect } from "bun:test"
import { Duration, Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionMemory } from "@opencode-ai/core/session/memory"
import { MemoryRetention } from "@opencode-ai/core/session/memory-retention"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Session } from "@opencode-ai/schema/session"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, SessionMemory.node])))

const seed = (input: { id: string; archived?: boolean; updatedDaysAgo?: number }) =>
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
        id: Session.ID.make(input.id),
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        ...(input.archived ? { time_archived: now } : {}),
        time_created: updated,
        time_updated: updated,
      })
      .run()
      .pipe(Effect.orDie)
    const svc = yield* SessionMemory.Service
    yield* svc.put({ sessionID: Session.ID.make(input.id), content: SessionMemory.empty(), source: "judge" })
  })

describe("memory retention", () => {
  it.live("sweeps memory of archived or idle sessions past the window", () =>
    Effect.gen(function* () {
      yield* seed({ id: "ses_old", updatedDaysAgo: 30 })
      yield* seed({ id: "ses_arch", archived: true })
      yield* seed({ id: "ses_fresh" })
      expect(yield* MemoryRetention.sweepOnce(7)).toBe(2)
      const svc = yield* SessionMemory.Service
      expect(yield* svc.getRow(Session.ID.make("ses_old"))).toBeUndefined()
      expect(yield* svc.getRow(Session.ID.make("ses_arch"))).toBeUndefined()
      expect(yield* svc.getRow(Session.ID.make("ses_fresh"))).toBeDefined()
    }),
  )

  it.live("retentionDays <= 0 disables the sweep", () =>
    Effect.gen(function* () {
      yield* seed({ id: "ses_keep", updatedDaysAgo: 90 })
      expect(yield* MemoryRetention.sweepOnce(0)).toBe(0)
      const svc = yield* SessionMemory.Service
      expect(yield* svc.getRow(Session.ID.make("ses_keep"))).toBeDefined()
    }),
  )
})
