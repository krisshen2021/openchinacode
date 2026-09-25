import { describe, expect, test } from "bun:test"
import { SessionMemory } from "@opencode-ai/core/session/memory"

const decision = (at: number) => ({ decision: `d${at}`, rationale: "r", rejected: [], at })

function withState(partial: Partial<SessionMemory.State>): SessionMemory.Content {
  const base = SessionMemory.empty()
  return { ...base, state: { ...base.state, ...partial } }
}

function withLog(partial: Partial<SessionMemory.Log>): SessionMemory.Content {
  const base = SessionMemory.empty()
  return { ...base, log: { ...base.log, ...partial } }
}

describe("normalize", () => {
  test("caps decisions at 50 by dropping oldest", () => {
    const result = SessionMemory.normalize(withLog({ decisions: Array.from({ length: 60 }, (_, i) => decision(i)) }))
    expect(result.log.decisions.length).toBe(50)
    expect(result.log.decisions[0]!.decision).toBe("d10")
  })

  test("never evicts constraints", () => {
    const result = SessionMemory.normalize(withLog({ constraints: Array.from({ length: 30 }, (_, i) => `rule ${i}`) }))
    expect(result.log.constraints.length).toBeGreaterThan(0)
    expect(result.log.constraints[0]).toBe("rule 0")
  })

  test("orders failures unresolved-first", () => {
    const result = SessionMemory.normalize(
      withState({
        failures: [
          { error: "old resolved", resolved: true },
          { error: "still broken", resolved: false },
        ],
      }),
    )
    expect(result.state.failures[0]!.error).toBe("still broken")
  })

  test("enforces the state byte cap", () => {
    const result = SessionMemory.normalize(
      withState({ verified: Array.from({ length: 200 }, (_, i) => `fact ${i} ${"x".repeat(200)}`) }),
    )
    expect(JSON.stringify(result.state).length).toBeLessThanOrEqual(SessionMemory.STATE_MAX_BYTES)
  })
})

describe("render", () => {
  test("renders fixed sections with objective and pitfalls", () => {
    const base = withState({ objective: "ship ep0", status: "active" })
    const content: SessionMemory.Content = {
      ...base,
      log: {
        ...base.log,
        pitfalls: [{ trap: "pm2 revives port", why: "watchdog", workaround: "pm2 delete first", at: 1 }],
      },
    }
    const out = SessionMemory.render(content)
    expect(out).toContain("## Objective")
    expect(out).toContain("ship ep0")
    expect(out).toContain("## Pitfalls")
    expect(out).toContain("pm2 revives port")
    expect(out).not.toContain("## Decisions")
  })
})

import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Session } from "@opencode-ai/schema/session"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, SessionMemory.node])))

const seed = (sessionID: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: Session.ID.make(sessionID),
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .run()
      .pipe(Effect.orDie)
  })

describe("service", () => {
  it.live("put/get round-trip and version increment", () =>
    Effect.gen(function* () {
      yield* seed("ses_mem1")
      const svc = yield* SessionMemory.Service
      const id = Session.ID.make("ses_mem1")
      const first = withState({ objective: "first" })
      yield* svc.put({ sessionID: id, content: first, source: "judge" })
      const one = yield* svc.getRow(id)
      expect(one?.content.state.objective).toBe("first")
      expect(one?.version).toBe(1)
      yield* svc.put({ sessionID: id, content: withState({ objective: "second" }), source: "tool" })
      const two = yield* svc.getRow(id)
      expect(two?.content.state.objective).toBe("second")
      expect(two?.version).toBe(2)
      expect(two?.source).toBe("tool")
    }),
  )

  it.live("append merges log append-only and overwrites state fields", () =>
    Effect.gen(function* () {
      yield* seed("ses_mem2")
      const svc = yield* SessionMemory.Service
      const id = Session.ID.make("ses_mem2")
      yield* svc.append({
        sessionID: id,
        state: { objective: "obj" },
        log: { decisions: [{ decision: "use jwt", rationale: "stateless", rejected: ["session"], at: 1 }] },
      })
      yield* svc.append({ sessionID: id, log: { pitfalls: [{ trap: "t", why: "w", workaround: "x", at: 2 }] } })
      const row = yield* svc.getRow(id)
      expect(row?.content.state.objective).toBe("obj")
      expect(row?.content.log.decisions.length).toBe(1)
      expect(row?.content.log.pitfalls.length).toBe(1)
      expect(row?.source).toBe("tool")
    }),
  )

  it.live("session delete cascades to memory", () =>
    Effect.gen(function* () {
      yield* seed("ses_mem3")
      const svc = yield* SessionMemory.Service
      const id = Session.ID.make("ses_mem3")
      yield* svc.put({ sessionID: id, content: SessionMemory.empty(), source: "judge" })
      const { db } = yield* Database.Service
      yield* db.delete(SessionTable).where(eq(SessionTable.id, id)).run().pipe(Effect.orDie)
      expect(yield* svc.getRow(id)).toBeUndefined()
    }),
  )

  it.live("rendered returns markdown when present", () =>
    Effect.gen(function* () {
      yield* seed("ses_mem4")
      const svc = yield* SessionMemory.Service
      const id = Session.ID.make("ses_mem4")
      expect(yield* svc.rendered(id)).toBeUndefined()
      yield* svc.put({ sessionID: id, content: withState({ objective: "visible" }), source: "judge" })
      expect(yield* svc.rendered(id)).toContain("visible")
    }),
  )
})

describe("isEmpty", () => {
  test("empty document is empty, any content makes it non-empty", () => {
    expect(SessionMemory.isEmpty(SessionMemory.empty())).toBe(true)
    expect(SessionMemory.isEmpty(withState({ objective: "x" }))).toBe(false)
    expect(SessionMemory.isEmpty(withLog({ pitfalls: [{ trap: "t", why: "w", workaround: "x", at: 1 }] }))).toBe(false)
  })
})
