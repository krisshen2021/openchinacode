# Session Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session-scoped structured memory layer (SQLite table + judge-maintained document + deterministic every-turn injection + agent write tool + read-only TUI/API surface) per `docs/superpowers/specs/2026-08-24-session-memory-design.md`.

**Architecture:** One new drizzle table `session_memory` (1:1 with session, FK cascade) in `packages/core`; the content document schema, clamp/merge/render pure functions, and the CRUD service all live in core (`src/session/memory.ts`). The compaction judge chain in `packages/opencode` switches from "extract then discard" to "merge into persisted memory"; prompt assembly injects the rendered document as a stable system entry every turn; a `memory_write` tool lets the agent append/update; a read-only HTTP endpoint + TUI dialog expose it to humans.

**Tech Stack:** Bun, Effect, drizzle-orm (SQLite), effect/unstable/httpapi, OpenTUI/Solid. Work happens in the `OpenChinaCode-surgery` worktree on branch `session-memory`.

**Conventions to respect:**
- Tests run from package dirs only, never repo root: `cd packages/core && bun test ...`
- Typecheck per package: `cd packages/<pkg> && bun typecheck`
- Commit messages: `type(scope): summary`, no backticks around technical words in messages
- Style: no `else` (early return), `const` over `let`, no import aliases/star imports, Bun APIs preferred
- Core module self-export at top (`export * as X from "./x"`); opencode module self-export at bottom
- After changing the public HttpApi, regenerate the SDK: `bun script/generate.ts` from repo root

---

### Task 1: Core memory document module

Pure domain module: content schema, caps/normalize, markdown renderer, git refs helper. No service yet.

**Files:**
- Create: `packages/core/src/session/memory.ts`
- Test: `packages/core/test/session-memory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/session-memory.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { SessionMemory } from "../src/session/memory"

const decision = (at: number) => ({ decision: `d${at}`, rationale: "r", rejected: [], at })

describe("normalize", () => {
  test("caps decisions at 50 by dropping oldest", () => {
    const content = SessionMemory.empty()
    content.log.decisions = Array.from({ length: 60 }, (_, i) => decision(i))
    const result = SessionMemory.normalize(content)
    expect(result.log.decisions.length).toBe(50)
    expect(result.log.decisions[0]!.decision).toBe("d10")
  })

  test("never evicts constraints", () => {
    const content = SessionMemory.empty()
    content.log.constraints = Array.from({ length: 30 }, (_, i) => `rule ${i}`)
    const result = SessionMemory.normalize(content)
    expect(result.log.constraints.length).toBeGreaterThan(0)
    expect(result.log.constraints[0]).toBe("rule 0")
  })

  test("orders failures unresolved-first", () => {
    const content = SessionMemory.empty()
    content.state.failures = [
      { error: "old resolved", resolved: true },
      { error: "still broken", resolved: false },
    ]
    const result = SessionMemory.normalize(content)
    expect(result.state.failures[0]!.error).toBe("still broken")
  })

  test("enforces the 8KB total cap", () => {
    const content = SessionMemory.empty()
    content.state.verified = Array.from({ length: 200 }, (_, i) => `fact ${i} ${"x".repeat(200)}`)
    const result = SessionMemory.normalize(content)
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(SessionMemory.CONTENT_MAX_BYTES)
  })
})

describe("render", () => {
  test("renders fixed sections with objective and pitfalls", () => {
    const content = SessionMemory.empty()
    content.state.objective = "ship ep0"
    content.state.status = "active"
    content.log.pitfalls = [{ trap: "pm2 revives port", why: "watchdog", workaround: "pm2 delete first", at: 1 }]
    const out = SessionMemory.render(content)
    expect(out).toContain("## Objective")
    expect(out).toContain("ship ep0")
    expect(out).toContain("## Pitfalls")
    expect(out).toContain("pm2 revives port")
    expect(out).not.toContain("## Decisions")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test test/session-memory.test.ts`
Expected: FAIL — module `../src/session/memory` does not exist.

- [ ] **Step 3: Implement `packages/core/src/session/memory.ts`**

```ts
export * as SessionMemory from "./memory"

import { Schema } from "effect"
import { spawnSync } from "node:child_process"

export const STATUS = ["active", "blocked-on-user", "waiting-verify", "done"] as const
export const KIND = ["debug", "implement", "refactor", "review", "research", "plan", "mixed"] as const
export const SOURCE = ["judge", "tool"] as const

export const FileEntry = Schema.Struct({
  path: Schema.String,
  role: Schema.Literals(["created", "modified", "referenced"]),
  note: Schema.String,
})
export const FailureEntry = Schema.Struct({
  error: Schema.String,
  resolved: Schema.Boolean,
  fix: Schema.optional(Schema.String),
})
export const QuestionEntry = Schema.Struct({
  q: Schema.String,
  owner: Schema.Literals(["user", "investigate"]),
})
export const DecisionEntry = Schema.Struct({
  decision: Schema.String,
  rationale: Schema.String,
  rejected: Schema.Array(Schema.String),
  at: Schema.Number,
})
export const PitfallEntry = Schema.Struct({
  trap: Schema.String,
  why: Schema.String,
  workaround: Schema.String,
  at: Schema.Number,
})
export const State = Schema.Struct({
  objective: Schema.String,
  status: Schema.Literals(STATUS),
  kind: Schema.Literals(KIND),
  files: Schema.Array(FileEntry),
  verified: Schema.Array(Schema.String),
  failures: Schema.Array(FailureEntry),
  next_actions: Schema.Array(Schema.String),
  open_questions: Schema.Array(QuestionEntry),
})
export const Log = Schema.Struct({
  decisions: Schema.Array(DecisionEntry),
  constraints: Schema.Array(Schema.String),
  pitfalls: Schema.Array(PitfallEntry),
  milestones: Schema.Array(Schema.String),
})
export const Refs = Schema.Struct({
  head_commit: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
})
export const Content = Schema.Struct({
  state: State,
  log: Log,
  refs: Schema.optional(Refs),
})
export type Content = typeof Content.Type
export type State = typeof State.Type
export type Log = typeof Log.Type
export type Source = (typeof SOURCE)[number]

export const STATE_MAX_BYTES = 3_000
export const LOG_MAX_BYTES = 5_000
export const CONTENT_MAX_BYTES = 8_000
const STRING_MAX = 420
const LIST_LIMITS = {
  files: 12,
  verified: 14,
  failures: 10,
  next_actions: 8,
  open_questions: 8,
  decisions: 50,
  constraints: 20,
  pitfalls: 30,
  milestones: 20,
} as const

export function empty(): Content {
  return {
    state: {
      objective: "",
      status: "active",
      kind: "mixed",
      files: [],
      verified: [],
      failures: [],
      next_actions: [],
      open_questions: [],
    },
    log: { decisions: [], constraints: [], pitfalls: [], milestones: [] },
  }
}

function clip(value: string, max = STRING_MAX) {
  const text = value.trim()
  return text.length > max ? text.slice(0, max) : text
}

function bytes(value: unknown) {
  return JSON.stringify(value).length
}

// Byte-cap eviction is deterministic. State zone sheds resolved failures first,
// then verified facts, files, questions, actions (newest kept). Log zone sheds
// milestones, then decisions, then pitfalls (oldest first). Constraints are
// user-issued and never evicted; they are string-clipped instead.
export function normalize(input: Content): Content {
  const state: State = {
    objective: clip(input.state.objective, 700),
    status: input.state.status,
    kind: input.state.kind,
    files: input.state.files
      .slice(0, LIST_LIMITS.files)
      .map((f) => ({ path: clip(f.path, 240), role: f.role, note: clip(f.note, 240) })),
    verified: input.state.verified.map((v) => clip(v)).slice(-LIST_LIMITS.verified),
    failures: [...input.state.failures]
      .sort((a, b) => Number(a.resolved) - Number(b.resolved))
      .slice(0, LIST_LIMITS.failures)
      .map((f) => ({ error: clip(f.error), resolved: f.resolved, ...(f.fix ? { fix: clip(f.fix, 240) } : {}) })),
    next_actions: input.state.next_actions.map((a) => clip(a)).slice(0, LIST_LIMITS.next_actions),
    open_questions: input.state.open_questions
      .slice(0, LIST_LIMITS.open_questions)
      .map((q) => ({ q: clip(q.q), owner: q.owner })),
  }
  const log: Log = {
    decisions: input.log.decisions.slice(-LIST_LIMITS.decisions),
    constraints: input.log.constraints.map((c) => clip(c)),
    pitfalls: input.log.pitfalls.slice(-LIST_LIMITS.pitfalls),
    milestones: input.log.milestones.map((m) => clip(m, 240)).slice(-LIST_LIMITS.milestones),
  }
  const content: Content = { state, log, ...(input.refs ? { refs: input.refs } : {}) }

  while (bytes(content.state) > STATE_MAX_BYTES) {
    if (dropFirst(content.state.failures, (f) => f.resolved)) continue
    if (content.state.verified.length > 1) {
      content.state.verified.shift()
      continue
    }
    if (content.state.files.length > 1) {
      content.state.files.shift()
      continue
    }
    if (content.state.open_questions.length > 1) {
      content.state.open_questions.shift()
      continue
    }
    if (content.state.next_actions.length > 1) {
      content.state.next_actions.pop()
      continue
    }
    break
  }
  while (bytes(content.log) > LOG_MAX_BYTES) {
    if (content.log.milestones.length > 1) {
      content.log.milestones.shift()
      continue
    }
    if (content.log.decisions.length > 1) {
      content.log.decisions.shift()
      continue
    }
    if (content.log.pitfalls.length > 1) {
      content.log.pitfalls.shift()
      continue
    }
    break
  }
  return content
}

function dropFirst<T>(list: T[], pred: (item: T) => boolean) {
  const index = list.findIndex(pred)
  if (index < 0) return false
  list.splice(index, 1)
  return true
}

function day(at: number) {
  return new Date(at).toISOString().slice(0, 10)
}

export function render(input: Content): string {
  const sections: string[] = []
  sections.push(`## Objective\n${input.state.objective || "(none)"}`)
  sections.push(`## Status\n${input.state.status} · ${input.state.kind}`)
  if (input.refs?.head_commit) {
    sections.push(
      `## Refs\ncommit ${input.refs.head_commit.slice(0, 12)}${input.refs.branch ? ` · ${input.refs.branch}` : ""}`,
    )
  }
  if (input.state.files.length) {
    sections.push(
      `## Files\n${input.state.files.map((f) => `- ${f.path} (${f.role})${f.note ? ` — ${f.note}` : ""}`).join("\n")}`,
    )
  }
  if (input.state.verified.length) {
    sections.push(`## Verified\n${input.state.verified.map((v) => `- ${v}`).join("\n")}`)
  }
  if (input.state.failures.length) {
    sections.push(
      `## Failures\n${input.state.failures.map((f) => `- [${f.resolved ? "resolved" : "open"}] ${f.error}${f.fix ? ` → ${f.fix}` : ""}`).join("\n")}`,
    )
  }
  if (input.state.next_actions.length) {
    sections.push(`## Next Actions\n${input.state.next_actions.map((a, i) => `${i + 1}. ${a}`).join("\n")}`)
  }
  if (input.state.open_questions.length) {
    sections.push(`## Open Questions\n${input.state.open_questions.map((q) => `- [${q.owner}] ${q.q}`).join("\n")}`)
  }
  if (input.log.decisions.length) {
    sections.push(
      `## Decisions\n${input.log.decisions
        .map(
          (d) =>
            `- ${day(d.at)} ${d.decision}${d.rationale ? ` — ${d.rationale}` : ""}${d.rejected.length ? ` (rejected: ${d.rejected.join(", ")})` : ""}`,
        )
        .join("\n")}`,
    )
  }
  if (input.log.constraints.length) {
    sections.push(`## Constraints\n${input.log.constraints.map((c) => `- ${c}`).join("\n")}`)
  }
  if (input.log.pitfalls.length) {
    sections.push(
      `## Pitfalls\n${input.log.pitfalls.map((p) => `- ${day(p.at)} ${p.trap} — ${p.why} → ${p.workaround}`).join("\n")}`,
    )
  }
  if (input.log.milestones.length) {
    sections.push(`## Milestones\n${input.log.milestones.map((m) => `- ${m}`).join("\n")}`)
  }
  return sections.join("\n\n")
}

export function gitRefs(directory: string): Content["refs"] {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" })
  if (head.status !== 0) return undefined
  const branch = spawnSync("git", ["branch", "--show-current"], { cwd: directory, encoding: "utf8" })
  const name = branch.status === 0 ? branch.stdout.trim() : ""
  return { head_commit: head.stdout.trim(), ...(name ? { branch: name } : {}) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test test/session-memory.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/core && bun typecheck`
Expected: clean.

```bash
cd /home/kris/Projects/OpenChinaCode-surgery
git add packages/core/src/session/memory.ts packages/core/test/session-memory.test.ts
git commit -m "feat(core): add session memory document module"
```

---

### Task 2: session_memory table + migration

**Files:**
- Modify: `packages/core/src/session/sql.ts` (append after `SessionContextEpochTable`)
- Generated: `packages/core/src/database/migration/<ts>_session_memory.ts`, `migration.gen.ts`, `schema.gen.ts`, `schema.json`

- [ ] **Step 1: Add the table definition**

Append to `packages/core/src/session/sql.ts`:

```ts
export const SessionMemoryTable = sqliteTable("session_memory", {
  session_id: text()
    .$type<SessionSchema.ID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  content: text({ mode: "json" }).notNull().$type<SessionMemoryDoc.Content>(),
  source: text().notNull(),
  version: integer().notNull().default(1),
  ...Timestamps,
})
```

Add the import at the top of the same file (type-only, next to the other type imports):

```ts
import type { SessionMemoryDoc } from "./memory"
```

- [ ] **Step 2: Generate the migration**

Run: `cd packages/core && bun run migration -- --name session_memory`
Expected: creates `src/database/migration/<timestamp>_session_memory.ts`, rewrites `migration.gen.ts`, `schema.gen.ts`, `schema.json`. The generated SQL must be exactly one `CREATE TABLE session_memory ...` with a FK to `session.id` — inspect the generated file.

- [ ] **Step 3: Verify migration checks + existing migration test**

Run: `cd packages/core && bun script/migration.ts --check`
Expected: exit 0 (no ungenerated migrations, schema not stale).

Run: `cd packages/core && bun test test/database-migration.test.ts`
Expected: PASS (applies the full migration chain onto a real file DB).

- [ ] **Step 4: Commit**

```bash
cd /home/kris/Projects/OpenChinaCode-surgery
git add packages/core/src/session/sql.ts packages/core/src/database packages/core/schema.json
git commit -m "feat(core): add session_memory table migration"
```

---

### Task 3: SessionMemory service (core)

CRUD service over the table: `get` / `getRow` / `rendered` / `put` / `append`. Lives in `packages/core/src/session/memory.ts` (append to the Task 1 module) so tests use the proven core DB harness.

**Files:**
- Modify: `packages/core/src/session/memory.ts`
- Test: `packages/core/test/session-memory.test.ts` (extend)

- [ ] **Step 1: Write the failing service tests**

Append to `packages/core/test/session-memory.test.ts` (seeding mirrors `test/event-retention.test.ts`):

```ts
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { AbsolutePath } from "../src/schema"
import { SessionTable, SessionMemoryTable } from "../src/session/sql"
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

it.live("put/get round-trip and version increment", () =>
  Effect.gen(function* () {
    yield* seed("ses_mem1")
    const svc = yield* SessionMemory.Service
    const content = SessionMemory.empty()
    content.state.objective = "first"
    yield* svc.put({ sessionID: Session.ID.make("ses_mem1"), content, source: "judge" })
    const first = yield* svc.getRow(Session.ID.make("ses_mem1"))
    expect(first?.content.state.objective).toBe("first")
    expect(first?.version).toBe(1)
    content.state.objective = "second"
    yield* svc.put({ sessionID: Session.ID.make("ses_mem1"), content, source: "tool" })
    const second = yield* svc.getRow(Session.ID.make("ses_mem1"))
    expect(second?.content.state.objective).toBe("second")
    expect(second?.version).toBe(2)
    expect(second?.source).toBe("tool")
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
    const gone = yield* svc.getRow(id)
    expect(gone).toBeUndefined()
  }),
)

it.live("rendered returns markdown when present", () =>
  Effect.gen(function* () {
    yield* seed("ses_mem4")
    const svc = yield* SessionMemory.Service
    const id = Session.ID.make("ses_mem4")
    const missing = yield* svc.rendered(id)
    expect(missing).toBeUndefined()
    const content = SessionMemory.empty()
    content.state.objective = "visible"
    yield* svc.put({ sessionID: id, content, source: "judge" })
    const out = yield* svc.rendered(id)
    expect(out).toContain("visible")
  }),
)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/core && bun test test/session-memory.test.ts`
Expected: FAIL — `SessionMemory.Service` / `SessionMemory.node` do not exist.

- [ ] **Step 3: Add the service to `packages/core/src/session/memory.ts`**

Append to the module (imports adjusted at top: add `Effect, Layer, Context`, `eq` from drizzle-orm, `Database`, `SessionMemoryTable`, `SessionSchema`, `makeGlobalNode`):

```ts
export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<Content | undefined>
  readonly getRow: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<{ content: Content; source: string; version: number; updated_at: number } | undefined>
  readonly rendered: (sessionID: SessionSchema.ID) => Effect.Effect<string | undefined>
  readonly put: (input: { sessionID: SessionSchema.ID; content: Content; source: Source }) => Effect.Effect<void>
  readonly append: (input: {
    sessionID: SessionSchema.ID
    state?: Partial<State>
    log?: Partial<Log>
  }) => Effect.Effect<Content>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionMemory") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db

    const getRow: Interface["getRow"] = Effect.fn("SessionMemory.getRow")(function* (sessionID) {
      const row = yield* db
        .select()
        .from(SessionMemoryTable)
        .where(eq(SessionMemoryTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!row) return undefined
      return { content: row.content, source: row.source, version: row.version, updated_at: row.time_updated }
    })

    const get: Interface["get"] = Effect.fn("SessionMemory.get")(function* (sessionID) {
      const row = yield* getRow(sessionID)
      return row?.content
    })

    const rendered: Interface["rendered"] = Effect.fn("SessionMemory.rendered")(function* (sessionID) {
      const content = yield* get(sessionID)
      if (!content) return undefined
      return render(content)
    })

    const put: Interface["put"] = Effect.fn("SessionMemory.put")(function* (input) {
      const content = normalize(input.content)
      yield* db.transaction((tx) =>
        Effect.gen(function* () {
          const existing = yield* tx
            .select()
            .from(SessionMemoryTable)
            .where(eq(SessionMemoryTable.session_id, input.sessionID))
            .get()
            .pipe(Effect.orDie)
          const version = (existing?.version ?? 0) + 1
          yield* tx
            .insert(SessionMemoryTable)
            .values({ session_id: input.sessionID, content, source: input.source, version })
            .onConflictDoUpdate({
              target: SessionMemoryTable.session_id,
              set: { content, source: input.source, version },
            })
            .run()
            .pipe(Effect.orDie)
        }),
      )
    })

    const append: Interface["append"] = Effect.fn("SessionMemory.append")(function* (input) {
      const current = (yield* get(input.sessionID)) ?? empty()
      const merged: Content = {
        ...current,
        state: { ...current.state, ...defined(input.state) },
        log: {
          decisions: [...current.log.decisions, ...(input.log?.decisions ?? [])],
          constraints: [...current.log.constraints, ...(input.log?.constraints ?? [])],
          pitfalls: [...current.log.pitfalls, ...(input.log?.pitfalls ?? [])],
          milestones: [...current.log.milestones, ...(input.log?.milestones ?? [])],
        },
      }
      yield* put({ sessionID: input.sessionID, content: merged, source: "tool" })
      return normalize(merged)
    })

    return Service.of({ get, getRow, rendered, put, append })
  }),
)

function defined<S extends Record<string, unknown>>(input: S | undefined): Partial<S> {
  if (!input) return {}
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<S>
}

export const node = makeGlobalNode({ name: "session-memory", layer, deps: [Database.node] })
```

Import additions at the top of the file:

```ts
import { Context, Effect, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionMemoryTable } from "./sql"
import type { SessionSchema } from "./schema"
```

(`SessionSchema.ID` here is the same schema as opencode's `SessionID` — opencode `src/session/schema.ts` re-exports it — so branded ids flow across the package boundary.)

- [ ] **Step 4: Run tests**

Run: `cd packages/core && bun test test/session-memory.test.ts`
Expected: PASS (doc tests + service tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/core && bun typecheck`

```bash
cd /home/kris/Projects/OpenChinaCode-surgery
git add packages/core/src/session/memory.ts packages/core/test/session-memory.test.ts
git commit -m "feat(core): add session memory service"
```

---

### Task 4: Retention sweep + config

**Files:**
- Create: `packages/core/src/session/memory-retention.ts`
- Modify: `packages/core/src/v1/config/config.ts` (experimental struct, next to `event_retention_days`)
- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts` (:194-208 options node pattern, :272 group, :297 build overrides)
- Test: `packages/core/test/session-memory-retention.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/session-memory-retention.test.ts`, mirroring `test/event-retention.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { Duration, Effect } from "effect"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { AbsolutePath } from "../src/schema"
import { SessionMemory } from "../src/session/memory"
import { MemoryRetention } from "../src/session/memory-retention"
import { SessionTable } from "../src/session/sql"
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
    yield* svc.put({
      sessionID: Session.ID.make(input.id),
      content: SessionMemory.empty(),
      source: "judge",
    })
  })

describe("memory retention", () => {
  it.live("sweeps memory of archived or idle sessions past the window", () =>
    Effect.gen(function* () {
      yield* seed({ id: "ses_old", updatedDaysAgo: 30 })
      yield* seed({ id: "ses_arch", archived: true })
      yield* seed({ id: "ses_fresh" })
      const pruned = yield* MemoryRetention.sweepOnce(7)
      expect(pruned).toBe(2)
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/core && bun test test/session-memory-retention.test.ts`
Expected: FAIL — module `../src/session/memory-retention` does not exist.

- [ ] **Step 3: Implement `packages/core/src/session/memory-retention.ts`**

Mirror `packages/core/src/event/retention.ts`:

```ts
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
 * operator opts in. `retentionDays <= 0` disables the sweep (default).
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
  yield* db.delete(SessionMemoryTable).where(inArray(SessionMemoryTable.session_id, sessions)).run().pipe(Effect.orDie)
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
      Effect.catchCause((cause) => Effect.logError("session memory retention sweep failed", { cause: Cause.pretty(cause) })),
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
```

- [ ] **Step 4: Add the config field**

In `packages/core/src/v1/config/config.ts`, in the `experimental` struct immediately after `event_retention_days`:

```ts
      memory_retention_days: Schema.optional(NonNegativeInt).annotate({
        description:
          "Days to keep session memory rows for archived or idle sessions without a workspace binding (default: 0 = keep until the session is deleted; session delete always cascades)",
      }),
```

- [ ] **Step 5: Wire into the server graph**

In `packages/opencode/src/server/routes/instance/httpapi/server.ts`:

1. Add an options node next to `eventRetentionOptionsNode` (:194):

```ts
const memoryRetentionOptionsNode = makeGlobalNode({
  service: MemoryRetention.Options,
  layer: Layer.effect(
    MemoryRetention.Options,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const cfg = yield* config.getGlobal()
      return { retentionDays: cfg.experimental?.memory_retention_days ?? MemoryRetention.DEFAULT_RETENTION_DAYS }
    }),
  ),
  deps: [Config.node],
})
```

2. Add `MemoryRetention.node` to the `LayerNode.group([...])` app graph (next to `EventRetention.node`, :272) and `SessionMemory.node` (next to `Database.node`, :220).
3. Extend the build overrides at :297:

```ts
Layer.provide(
  AppNodeBuilderV1.build(app, [
    [EventRetention.optionsNode, eventRetentionOptionsNode],
    [MemoryRetention.optionsNode, memoryRetentionOptionsNode],
  ]),
),
```

4. Imports: `import { MemoryRetention } from "@opencode-ai/core/session/memory-retention"` and `import { SessionMemory } from "@opencode-ai/core/session/memory"`.

- [ ] **Step 6: Run tests + typecheck**

Run: `cd packages/core && bun test test/session-memory-retention.test.ts test/event-retention.test.ts`
Expected: PASS.

Run: `cd packages/core && bun typecheck && cd ../opencode && bun typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
cd /home/kris/Projects/OpenChinaCode-surgery
git add packages/core/src/session/memory-retention.ts packages/core/src/v1/config/config.ts packages/core/test/session-memory-retention.test.ts packages/opencode/src/server/routes/instance/httpapi/server.ts
git commit -m "feat(core): add session memory retention sweep"
```

---

### Task 5: Compaction writes memory (merge, not extract-and-discard)

**Files:**
- Modify: `packages/opencode/src/session/compaction-profile.ts` (new `memoryMessages`, `parseMemoryOutput`, `fallbackMemory`, `projectActiveTask`)
- Modify: `packages/opencode/src/session/compaction.ts` (persist after extraction; keep-old-on-failure; deps)
- Test: `packages/opencode/test/session/compaction-profile.test.ts` (extend), `packages/opencode/test/session/compaction.test.ts` (extend)

- [ ] **Step 1: Failing unit tests for the new pure functions**

Append to `packages/opencode/test/session/compaction-profile.test.ts`:

```ts
import { SessionMemory } from "@opencode-ai/core/session/memory"

test("parseMemoryOutput decodes, fills at, and normalizes", () => {
  const json = JSON.stringify({
    state: {
      objective: "obj",
      status: "active",
      kind: "implement",
      files: [{ path: "a.ts", role: "modified", note: "half done" }],
      verified: [],
      failures: [],
      next_actions: ["next"],
      open_questions: [],
    },
    log: { decisions: [{ decision: "x", rationale: "y", rejected: [], at: 0 }], constraints: [], pitfalls: [], milestones: [] },
  })
  const parsed = CompactionProfile.parseMemoryOutput(`\`\`\`json\n${json}\n\`\`\``)
  expect(parsed?.state.objective).toBe("obj")
  expect(parsed?.log.decisions[0]?.at).toBeGreaterThan(0)
})

test("parseMemoryOutput rejects garbage", () => {
  expect(CompactionProfile.parseMemoryOutput("not json")).toBeUndefined()
  expect(CompactionProfile.parseMemoryOutput('{"state":{"status":"bogus"}}')).toBeUndefined()
})

test("fallbackMemory keeps previous memory and seeds objective from decision", () => {
  const previous = SessionMemory.empty()
  previous.state.objective = "old objective"
  previous.log.decisions = [{ decision: "keep me", rationale: "", rejected: [], at: 5 }]
  const decision = CompactionProfile.normalize({
    active_task: { present: true, kind: "debug", window_turns: 4, reason: "debugging flakes" },
  })
  const merged = CompactionProfile.fallbackMemory({ decision, previousMemory: previous })
  expect(merged.state.objective).toBe("old objective")
  expect(merged.log.decisions[0]?.decision).toBe("keep me")
  const fresh = CompactionProfile.fallbackMemory({ decision })
  expect(fresh.state.objective).toBe("debugging flakes")
  expect(fresh.state.kind).toBe("debug")
})

test("projectActiveTask maps memory state into ActiveTaskEssential", () => {
  const content = SessionMemory.empty()
  content.state.objective = "obj"
  content.state.kind = "refactor"
  content.state.files = [{ path: "a.ts", role: "modified", note: "wip" }]
  content.state.verified = ["typecheck clean"]
  content.state.next_actions = ["ship it"]
  content.state.open_questions = [{ q: "ok?", owner: "user" }]
  const projected = CompactionProfile.projectActiveTask(content)
  expect(projected.kind).toBe("refactor")
  expect(projected.files[0]).toContain("a.ts")
  expect(projected.findings).toContain("typecheck clean")
  expect(projected.open_questions[0]).toBe("[user] ok?")
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/opencode && bun test test/session/compaction-profile.test.ts`
Expected: FAIL — the three functions do not exist.

- [ ] **Step 3: Add the pure functions to `compaction-profile.ts`**

Add to `packages/opencode/src/session/compaction-profile.ts` (import: `import { SessionMemory } from "@opencode-ai/core/session/memory"`):

```ts
const MEMORY_PREVIOUS_CHARS = 8_000

export function memoryMessages(input: {
  messages: readonly SessionV1.WithParts[]
  previousSummary?: string
  decision: Decision
  previousMemory?: SessionMemory.Content
}) {
  const decision = normalize(input.decision)
  const previousSummary = tail(input.previousSummary ?? "", ACTIVE_TASK_PREVIOUS_SUMMARY_CHARS)
  const recentConversation = tail(messageText(input.messages), ACTIVE_TASK_RECENT_CONTEXT_CHARS)
  const previousMemory = input.previousMemory ? tail(JSON.stringify(input.previousMemory), MEMORY_PREVIOUS_CHARS) : ""
  const now = Date.now()
  return [
    {
      role: "system" as const,
      content: [
        "You are OpenChinaCode's session memory curator.",
        "Maintain one structured JSON memory document for this coding session. It has two zones:",
        '- "state": the CURRENT task state. Rewrite it to reflect now; drop stale items.',
        '- "log": append-only history. Keep previous entries, append new ones; when a list nears its cap, merge the oldest entries into shorter combined entries instead of dropping them.',
        "You receive the previous memory document (possibly empty) and the recent conversation delta. Merge; do not copy the delta verbatim.",
        "Return one compact JSON object only. Do not include Markdown, commentary, analysis, or explanatory text.",
        "Do not invent facts. Leave arrays empty when unknown.",
        `Set "at" to ${now} for new log entries; keep existing entries' "at" unchanged.`,
        "Schema:",
        '{"state":{"objective":"specific current objective","status":"active|blocked-on-user|waiting-verify|done","kind":"debug|implement|refactor|review|research|plan|mixed","files":[{"path":"repo-relative path","role":"created|modified|referenced","note":"one-line current state"}],"verified":["fact @ evidence, passed checks only"],"failures":[{"error":"exact error","resolved":false,"fix":"what fixed it"}],"next_actions":["priority ordered"],"open_questions":[{"q":"...","owner":"user|investigate"}]},"log":{"decisions":[{"decision":"...","rationale":"why","rejected":["rejected alternative"],"at":0}],"constraints":["user-issued rule, never expires"],"pitfalls":[{"trap":"what bit us","why":"root cause","workaround":"how to avoid","at":0}],"milestones":["major checkpoint"]}}',
        "Pitfall admission requires ALL of: resolved or workaround known; non-obvious (costly to rediscover); reusable later. Unresolved issues stay in state.failures.",
        "Caps: files ≤12, verified ≤14, failures ≤10, next_actions ≤8, open_questions ≤8, decisions ≤50, constraints ≤20, pitfalls ≤30, milestones ≤20.",
        "Keep strings short but preserve exact file paths, symbols, identifiers, and error strings.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        compaction_profile: {
          profiles: decision.profiles,
          must_preserve: decision.must_preserve,
          active_task: decision.active_task,
          risk: decision.risk,
          source: decision.source,
        },
        previous_memory: previousMemory || null,
        previous_summary_excerpt: previousSummary,
        recent_conversation_delta: recentConversation,
      }),
    },
  ]
}

export function parseMemoryOutput(text: string): SessionMemory.Content | undefined {
  const json = extractJsonObject(text)
  if (!json) return undefined
  try {
    const decoded = Schema.decodeUnknownEither(SessionMemory.Content)(JSON.parse(json))
    if (Either.isLeft(decoded)) return undefined
    const now = Date.now()
    const fill = <T extends { at: number }>(entry: T): T => (entry.at > 0 ? entry : { ...entry, at: now })
    return SessionMemory.normalize({
      ...decoded.right,
      log: {
        ...decoded.right.log,
        decisions: decoded.right.log.decisions.map(fill),
        pitfalls: decoded.right.log.pitfalls.map(fill),
      },
    })
  } catch {
    return undefined
  }
}

export function fallbackMemory(input: {
  decision: Decision
  previousMemory?: SessionMemory.Content
}): SessionMemory.Content {
  const base = input.previousMemory ?? SessionMemory.empty()
  const decision = normalize(input.decision)
  if (!decision.active_task.present) return base
  return SessionMemory.normalize({
    ...base,
    state: {
      ...base.state,
      objective: base.state.objective || decision.active_task.reason,
      kind: base.state.objective ? base.state.kind : decision.active_task.kind,
    },
  })
}

export function projectActiveTask(content: SessionMemory.Content): ActiveTaskEssential {
  return {
    present: true,
    kind: content.state.kind,
    objective: content.state.objective,
    status: content.state.status,
    focus: [],
    files: content.state.files.map((f) => `${f.path} (${f.role})${f.note ? ` — ${f.note}` : ""}`),
    decisions: content.log.decisions.slice(-8).map((d) => d.decision),
    findings: content.state.verified,
    changes: [],
    commands: [],
    failures: content.state.failures.map((f) => (f.resolved && f.fix ? `${f.error} → ${f.fix}` : f.error)),
    next_actions: content.state.next_actions,
    risks: [],
    open_questions: content.state.open_questions.map((q) => `[${q.owner}] ${q.q}`),
    source: "llm",
  }
}
```

Add `"memoryMessages"`, `"parseMemoryOutput"`, `"fallbackMemory"`, `"projectActiveTask"` to the `CompactionProfile` export object at the bottom. Add `Either` to the effect import.

- [ ] **Step 4: Run unit tests**

Run: `cd packages/opencode && bun test test/session/compaction-profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Persist in `compaction.ts`**

In `packages/opencode/src/session/compaction.ts`:

1. Import: `import { SessionMemory } from "@opencode-ai/core/session/memory"`.
2. In the layer, after `const flags = yield* RuntimeFlags.Service` (:229): `const memory = yield* SessionMemory.Service`.
3. Change `extractActiveTask` (:420): input gains `previousMemory?: SessionMemory.Content`; the `runJsonJudge` call switches to `runJsonJudge<SessionMemory.Content>` with `messages: CompactionProfile.memoryMessages({ messages: input.messages, previousSummary: input.previousSummary, decision: input.decision, previousMemory: input.previousMemory })` and `parse: (text) => CompactionProfile.parseMemoryOutput(text)`; return `memory: result.decision` in place of `activeTask`.
4. In `processCompaction`, replace the extraction block (:680-687):

```ts
        const previousMemory = yield* memory
          .get(input.sessionID)
          .pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        const extracted = yield* extractActiveTask({
          messages: visibleHistory,
          previousSummary,
          currentModel: model,
          sessionID: input.sessionID,
          decision: readyProfile,
          previousMemory,
        })
        const memoryContent =
          extracted.memory ?? CompactionProfile.fallbackMemory({ decision: readyProfile, previousMemory })
        if (readyProfile.active_task.present || previousMemory) {
          const ctx = yield* InstanceState.context
          yield* memory
            .put({
              sessionID: input.sessionID,
              content: { ...memoryContent, refs: SessionMemory.gitRefs(ctx.directory) },
              source: "judge",
            })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("session memory write failed; keeping previous", { cause: Cause.pretty(cause) }),
              ),
            )
          activeTask = extracted.memory ? CompactionProfile.projectActiveTask(memoryContent) : undefined
        }
```

(`activeTask` stays `undefined` when no task and no previous memory — same externally visible behavior as today when extraction is skipped. `Cause` import from effect.)

5. Add `SessionMemory.node` to the `deps` array of `SessionCompaction.node` (:947). Add `SessionMemory.node` to the server `LayerNode.group` only if Task 4 has not already.

- [ ] **Step 6: Integration test in `compaction.test.ts`**

Add `SessionMemory.node` to that file's `LayerNode` group (it uses `AppNodeBuilder`/`LayerNode` already), then append:

```ts
// Mirrors the file's existing process() tests; asserts the memory row exists
// after a completed compaction regardless of judge LLM availability.
it.live("compaction persists session memory", () =>
  Effect.gen(function* () {
    // ... reuse the nearest existing test's setup to create a session and run
    // SessionCompaction.process({ auto: true, ... }) with the fake provider ...
    const memory = yield* SessionMemory.Service
    const row = yield* memory.getRow(sessionID)
    expect(row).toBeDefined()
    expect(row?.source).toBe("judge")
    expect(row?.content.state.kind).toBeOneOf(["debug", "implement", "refactor", "review", "research", "plan", "mixed"])
  }),
)
```

The judge will fail or succeed depending on the fake provider; either way `fallbackMemory` guarantees a row. Copy the setup from the file's nearest passing `process(` test verbatim and only change the assertions.

- [ ] **Step 7: Run + typecheck**

Run: `cd packages/opencode && bun test test/session/compaction-profile.test.ts test/session/compaction.test.ts`
Expected: PASS.

Run: `cd packages/opencode && bun typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
cd /home/kris/Projects/OpenChinaCode-surgery
git add packages/opencode/src/session/compaction-profile.ts packages/opencode/src/session/compaction.ts packages/opencode/test/session/compaction-profile.test.ts packages/opencode/test/session/compaction.test.ts
git commit -m "feat(opencode): persist session memory during compaction"
```

---

### Task 6: Every-turn injection into the system prompt

**Files:**
- Modify: `packages/opencode/src/session/prompt.ts` (:1562 Effect.all, :1588 system array)

- [ ] **Step 1: Wire the service**

In `packages/opencode/src/session/prompt.ts`:
1. Import: `import { SessionMemory } from "@opencode-ai/core/session/memory"`.
2. In the layer closure, next to the other service yields: `const memory = yield* SessionMemory.Service`.
3. Add `SessionMemory.node` to `SessionPrompt.node`'s `deps`.

- [ ] **Step 2: Inject**

Change the `Effect.all` at :1562 to also fetch the rendered memory, then splice it into `system` (:1588) right after `instructions` (static prefix side; memory only changes on writes, so provider prompt caches survive between writes):

```ts
            const [skills, env, instructions, mcpInstructions, memoryDoc, modelMsgs] = yield* Effect.all([
              sys.skills(agent),
              sys.environment(model),
              instruction.system().pipe(Effect.orDie),
              sys.mcp(agent, session.permission),
              memory.rendered(sessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined))),
              MessageV2.toModelMessagesEffect(msgs, model, {
                // ... unchanged retention options ...
              }),
            ])
            const system = [
              // Volatile content (env block contains today's date) goes last so the
              // static prefix (instructions, memory, MCP, skills) stays byte-identical
              // across days and keeps hitting provider prompt caches (GLM/DeepSeek).
              ...instructions,
              ...(memoryDoc
                ? [
                    [
                      "The following structured session memory is maintained automatically across compactions.",
                      "Treat it as the authoritative current state of this session.",
                      `<session-memory>\n${memoryDoc}\n</session-memory>`,
                    ].join("\n"),
                  ]
                : []),
              ...(mcpInstructions ? [mcpInstructions] : []),
              ...(skills ? [skills] : []),
              ...env,
            ]
```

- [ ] **Step 3: Regression tests**

Run: `cd packages/opencode && bun test test/session/prompt.test.ts test/session/system.test.ts`
Expected: PASS (no behavior change when memory is absent; the `catchCause` keeps a failed read from breaking prompts).

- [ ] **Step 4: Typecheck + commit**

Run: `cd packages/opencode && bun typecheck`

```bash
cd /home/kris/Projects/OpenChinaCode-surgery
git add packages/opencode/src/session/prompt.ts
git commit -m "feat(opencode): inject session memory into system prompt"
```

---

### Task 7: `memory_write` tool

**Files:**
- Create: `packages/opencode/src/tool/memory-write.ts`
- Create: `packages/opencode/src/tool/memory-write.txt`
- Modify: `packages/opencode/src/tool/registry.ts` (import, yield, init, builtin list, deps)
- Test: `packages/opencode/test/tool/memory-write.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/opencode/test/tool/memory-write.test.ts` (fake ctx shape from `src/tool/tool.ts` `Context`; seed via raw table inserts like the core tests):

```ts
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionMemory } from "@opencode-ai/core/session/memory"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Session } from "@opencode-ai/schema/session"
import { Agent } from "@/agent/agent"
import { MessageID, SessionID } from "@/session/schema"
import * as Truncate from "@/tool/truncate"
import { MemoryWriteTool } from "@/tool/memory-write"
import { testEffect } from "../lib/effect"

const truncate = Layer.mock(Truncate.Service, {
  output: (output: string) => Effect.succeed({ content: output, truncated: false }),
})
const agents = Layer.mock(Agent.Service, {})

const it = testEffect(
  Layer.mergeAll(AppNodeBuilder.build(LayerNode.group([Database.node, SessionMemory.node])), truncate, agents),
)

const ctx = {
  sessionID: SessionID.make("ses_tool1"),
  messageID: MessageID.ascending(),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("memory_write tool", () => {
  it.live("appends to log and updates state", () =>
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
          id: Session.ID.make("ses_tool1"),
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

      const info = yield* MemoryWriteTool
      const def = yield* info.init()
      const result = yield* def.execute(
        {
          objective: "test the tool",
          pitfalls: [{ trap: "pm2 revives the port", why: "watchdog respawn", workaround: "pm2 delete first" }],
        },
        ctx,
      )
      expect(result.title).toBe("memory updated")
      expect(result.output).toContain("pm2 revives the port")

      const memory = yield* SessionMemory.Service
      const row = yield* memory.getRow(Session.ID.make("ses_tool1"))
      expect(row?.content.state.objective).toBe("test the tool")
      expect(row?.content.log.pitfalls[0]?.workaround).toBe("pm2 delete first")
      expect(row?.content.log.pitfalls[0]?.at).toBeGreaterThan(0)
      expect(row?.source).toBe("tool")
    }),
  )
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/opencode && bun test test/tool/memory-write.test.ts`
Expected: FAIL — module `@/tool/memory-write` does not exist.

- [ ] **Step 3: Implement `memory-write.txt` + `memory-write.ts`**

`memory-write.txt`:

```
Maintains this session's structured working memory. Use it to record facts that must survive context compaction:

- decisions: a decision with its rationale and any rejected alternatives
- pitfalls: a trap that cost real debugging time — only when resolved (or a workaround is known), non-obvious, and reusable
- constraints: rules the user issued (they never expire)
- objective/status/next_actions: keep the current task state accurate

Log entries (decisions, pitfalls, constraints, milestones) are append-only; you cannot edit or remove them. State fields you pass are overwritten; omitted fields keep their current values. Everything you write is injected into the system prompt on every subsequent turn, so keep entries short and exact (paths, identifiers, error strings).
```

`memory-write.ts`:

```ts
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./memory-write.txt"
import { SessionMemory } from "@opencode-ai/core/session/memory"

const DecisionInput = Schema.Struct({
  decision: Schema.String,
  rationale: Schema.String,
  rejected: Schema.optional(Schema.Array(Schema.String)),
})
const PitfallInput = Schema.Struct({
  trap: Schema.String,
  why: Schema.String,
  workaround: Schema.String,
})

export const Parameters = Schema.Struct({
  objective: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Literals(SessionMemory.STATUS)),
  kind: Schema.optional(Schema.Literals(SessionMemory.KIND)),
  files: Schema.optional(Schema.Array(SessionMemory.FileEntry)),
  verified: Schema.optional(Schema.Array(Schema.String)),
  failures: Schema.optional(Schema.Array(SessionMemory.FailureEntry)),
  next_actions: Schema.optional(Schema.Array(Schema.String)),
  open_questions: Schema.optional(Schema.Array(SessionMemory.QuestionEntry)),
  decisions: Schema.optional(Schema.Array(DecisionInput)),
  constraints: Schema.optional(Schema.Array(Schema.String)),
  pitfalls: Schema.optional(Schema.Array(PitfallInput)),
  milestones: Schema.optional(Schema.Array(Schema.String)),
})

export const MemoryWriteTool = Tool.define<typeof Parameters, {}, SessionMemory.Interface>(
  "memory_write",
  Effect.gen(function* () {
    const memory = yield* SessionMemory.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const now = Date.now()
          const content = yield* memory.append({
            sessionID: ctx.sessionID,
            state: {
              ...(params.objective !== undefined ? { objective: params.objective } : {}),
              ...(params.status !== undefined ? { status: params.status } : {}),
              ...(params.kind !== undefined ? { kind: params.kind } : {}),
              ...(params.files !== undefined ? { files: params.files } : {}),
              ...(params.verified !== undefined ? { verified: params.verified } : {}),
              ...(params.failures !== undefined ? { failures: params.failures } : {}),
              ...(params.next_actions !== undefined ? { next_actions: params.next_actions } : {}),
              ...(params.open_questions !== undefined ? { open_questions: params.open_questions } : {}),
            },
            log: {
              decisions: (params.decisions ?? []).map((d) => ({
                decision: d.decision,
                rationale: d.rationale,
                rejected: d.rejected ?? [],
                at: now,
              })),
              constraints: params.constraints ?? [],
              pitfalls: (params.pitfalls ?? []).map((p) => ({ ...p, at: now })),
              milestones: params.milestones ?? [],
            },
          })
          return {
            title: "memory updated",
            output: SessionMemory.render(content),
            metadata: {},
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, {}>
  }),
)
```

- [ ] **Step 4: Register in `registry.ts`**

1. Import: `import { MemoryWriteTool } from "./memory-write"`.
2. After `const todo = yield* TodoWriteTool` (:107): `const memoryWrite = yield* MemoryWriteTool`.
3. In the `Effect.all` (:219-245) add `memoryWrite: Tool.init(memoryWrite)`.
4. In `builtin` add `tool.memoryWrite` after `tool.todo`.
5. Add `SessionMemory.node` to `ToolRegistry.node` `deps` (:456-480), plus the import `import { SessionMemory } from "@opencode-ai/core/session/memory"`.

- [ ] **Step 5: Run test + typecheck**

Run: `cd packages/opencode && bun test test/tool/memory-write.test.ts`
Expected: PASS.

Run: `cd packages/opencode && bun typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /home/kris/Projects/OpenChinaCode-surgery
git add packages/opencode/src/tool/memory-write.ts packages/opencode/src/tool/memory-write.txt packages/opencode/src/tool/registry.ts packages/opencode/test/tool/memory-write.test.ts
git commit -m "feat(opencode): add memory_write tool"
```

---

### Task 8: HTTP endpoint + SDK regen

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- Generated: `packages/sdk/js/src/v2/gen` (via `bun script/generate.ts` at repo root)

- [ ] **Step 1: Add the endpoint to the group**

In `groups/session.ts`:
1. `SessionPaths` (:79-106): add `memory: \`${root}/:sessionID/memory\`,`.
2. Add the response schema near the other payload schemas:

```ts
export const MemoryInfo = Schema.Struct({
  available: Schema.Boolean,
  content: Schema.optional(SessionMemory.Content),
  rendered: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  version: Schema.optional(Schema.Number),
  updated_at: Schema.optional(Schema.Number),
})
```

3. Add the endpoint after the `get` endpoint (:133-144):

```ts
        HttpApiEndpoint.get("memory", SessionPaths.memory, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(MemoryInfo, "Session memory"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.memory",
            summary: "Get session memory",
            description: "Retrieve the structured working memory document for a session, if one has been recorded.",
          }),
        ),
```

4. Import: `import { SessionMemory } from "@opencode-ai/core/session/memory"`.

- [ ] **Step 2: Add the handler**

In `handlers/session.ts`, mirror the `todo` handler (:94-97). Yield the service at layer construction (next to the existing `todoSvc` yield): `const memorySvc = yield* SessionMemory.Service`, then:

```ts
    const memory = Effect.fn("SessionHttpApi.memory")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      const row = yield* memorySvc.getRow(ctx.params.sessionID)
      if (!row) return { available: false as const }
      return {
        available: true as const,
        content: row.content,
        rendered: SessionMemory.render(row.content),
        source: row.source,
        version: row.version,
        updated_at: row.updated_at,
      }
    })
```

Register `.handle("memory", memory)` after `.handle("get", get)` (:417). Import `SessionMemory` from core as above.

- [ ] **Step 3: Regenerate the SDK**

Run: `cd /home/kris/Projects/OpenChinaCode-surgery && bun script/generate.ts`
Expected: `packages/sdk/js/src/v2/gen` updated with the `session.memory` endpoint; no manual edits there.

- [ ] **Step 4: Typecheck + commit**

Run: `cd packages/opencode && bun typecheck && cd ../sdk/js && bun typecheck`
Expected: clean. (If sdk/js has no typecheck script, run it from the closest package that does.)

```bash
cd /home/kris/Projects/OpenChinaCode-surgery
git add packages/opencode/src/server/routes/instance/httpapi packages/sdk/js
git commit -m "feat(opencode): expose session memory over HttpApi"
```

---

### Task 9: TUI read-only viewer

**Files:**
- Create: `packages/tui/src/component/dialog-memory.tsx`
- Modify: `packages/tui/src/app.tsx` (command registration near `opencode.status`, :765)

- [ ] **Step 1: Create the dialog**

`packages/tui/src/component/dialog-memory.tsx` (structure mirrors `dialog-status.tsx`, SDK access mirrors `dialog-custom-provider.tsx`):

```tsx
import { TextAttributes } from "@opentui/core"
import { createResource, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"

export function DialogMemory(props: { sessionID: string }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sdk = useSDK()
  const [memory] = createResource(async () => {
    const result = await sdk.client.session.memory({ sessionID: props.sessionID })
    return result.data
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Session Memory
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={!memory.loading} fallback={<text fg={theme.textMuted}>Loading…</text>}>
        <Show
          when={memory()?.available}
          fallback={<text fg={theme.text}>No memory recorded for this session yet.</text>}
        >
          <scrollbox height={20}>
            <text fg={theme.text} wrapMode="word">
              {memory()?.rendered}
            </text>
          </scrollbox>
          <text fg={theme.textMuted}>
            v{memory()?.version} · {memory()?.source} · {new Date(memory()?.updated_at ?? 0).toLocaleString()}
          </text>
        </Show>
      </Show>
    </box>
  )
}
```

- [ ] **Step 2: Register the command in `app.tsx`**

Next to the `opencode.status` command (:765-772):

```tsx
      {
        name: "session.memory",
        title: "View session memory",
        slashName: "memory",
        run: () => {
          if (route.data.type !== "session") return
          const sessionID = route.data.sessionID
          dialog.replace(() => <DialogMemory sessionID={sessionID} />)
        },
        category: "Session",
      },
```

Add the import `import { DialogMemory } from "./component/dialog-memory"`.

- [ ] **Step 3: Typecheck + manual TUI check**

Run: `cd packages/tui && bun typecheck`
Expected: clean.

Manual check with the dev TUI (per `packages/opencode/AGENTS.md`):

```bash
cd /home/kris/Projects/OpenChinaCode-surgery/packages/opencode
tmux new-session -d -s occ-dev 'bun dev'
sleep 8
tmux capture-pane -pt occ-dev
tmux kill-session -t occ-dev
```

Expected: TUI boots without errors (dialog only renders when invoked; full visual check happens in the Task 10 smoke test).

- [ ] **Step 4: Commit**

```bash
cd /home/kris/Projects/OpenChinaCode-surgery
git add packages/tui/src/component/dialog-memory.tsx packages/tui/src/app.tsx
git commit -m "feat(tui): add session memory viewer"
```

---

### Task 10: Full verification + test binary

- [ ] **Step 1: Typecheck all touched packages**

```bash
cd /home/kris/Projects/OpenChinaCode-surgery/packages/core && bun typecheck
cd ../opencode && bun typecheck
cd ../tui && bun typecheck
```

Expected: all clean.

- [ ] **Step 2: Run the targeted test suites**

```bash
cd /home/kris/Projects/OpenChinaCode-surgery/packages/core && bun test test/session-memory.test.ts test/session-memory-retention.test.ts test/event-retention.test.ts test/database-migration.test.ts
cd ../opencode && bun test test/session/compaction-profile.test.ts test/session/compaction.test.ts test/session/prompt.test.ts test/tool/memory-write.test.ts
```

Expected: PASS. (Suites that require live models.dev are environment-fragile on this machine; if an unrelated test fails with a network error, confirm it also fails on `main` before treating it as a regression.)

- [ ] **Step 3: Build the isolated test binary**

```bash
cd /home/kris/Projects/OpenChinaCode-surgery/packages/opencode
OPENCODE_APP_NAME=openchinacode-surgery MODELS_DEV_API_JSON=/home/kris/.cache/openchinacode/models.json bun run build --single --skip-install
```

Expected: `dist/openchinacode-linux-x64/bin/openchinacode` built; version string embeds today's date. The `OPENCODE_APP_NAME` keeps its data dir at `~/.local/share/openchinacode-surgery/`, isolated from production. The existing `openchinacode-test` symlink already points into this worktree's dist — verify with `readlink -f ~/.local/bin/openchinacode-test` and re-point only if it does not.

- [ ] **Step 4: Smoke test (manual, tmux)**

```bash
mkdir -p /tmp/memory-smoke && cd /tmp/memory-smoke && git init -q
tmux new-session -d -s memory-smoke -c /tmp/memory-smoke 'openchinacode-test'
```

In the TUI: send a couple of prompts, run `/compact` (or let auto-compaction trigger), then `/memory` — expect the rendered document. Fallback check without TUI:

```bash
sqlite3 ~/.local/share/openchinacode-surgery/opencode-openchinacode-surgery.db \
  "select session_id, source, version, length(content) from session_memory"
```

Expected: a row for the smoke session with source `judge`. Also try asking the agent to remember a pitfall and confirm a second row version bump with source `tool`. Then `tmux kill-session -t memory-smoke`.

- [ ] **Step 5: Final commit (if any fixes) + report**

Report the smoke results to the user before any merge to `main`.

---

## Self-review notes

- Spec coverage: storage (Tasks 1-3), cleanup (Task 4 + FK cascade), write paths (Tasks 5, 7), recall path (Tasks 6, 8, 9), DB hygiene config (Task 4), testing (each task + Task 10), SDK regen rule (Task 8), isolated binary (Task 10). Non-goals untouched.
- `refs` is harness-filled in the compaction write path only (tool writes keep whatever refs the last judge write set — acceptable for v1; noted in spec as optional).
- The `session_memory` content column uses drizzle `text({ mode: "json" })` with `$type<Content>()`, so reads are typed; `normalize` still runs on every write.
