export * as SessionMemory from "./memory"

import { Context, Effect, Layer, Schema } from "effect"
import { spawnSync } from "node:child_process"
import { eq } from "drizzle-orm"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionMemoryTable } from "./sql"
import type { SessionSchema } from "./schema"

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

function shrinkState(state: State): State {
  if (bytes(state) <= STATE_MAX_BYTES) return state
  const resolved = state.failures.findIndex((f) => f.resolved)
  if (resolved >= 0) return shrinkState({ ...state, failures: state.failures.filter((_, i) => i !== resolved) })
  if (state.verified.length > 1) return shrinkState({ ...state, verified: state.verified.slice(1) })
  if (state.files.length > 1) return shrinkState({ ...state, files: state.files.slice(1) })
  if (state.open_questions.length > 1) return shrinkState({ ...state, open_questions: state.open_questions.slice(1) })
  if (state.next_actions.length > 1) return shrinkState({ ...state, next_actions: state.next_actions.slice(0, -1) })
  return state
}

function shrinkLog(log: Log): Log {
  if (bytes(log) <= LOG_MAX_BYTES) return log
  if (log.milestones.length > 1) return shrinkLog({ ...log, milestones: log.milestones.slice(1) })
  if (log.decisions.length > 1) return shrinkLog({ ...log, decisions: log.decisions.slice(1) })
  if (log.pitfalls.length > 1) return shrinkLog({ ...log, pitfalls: log.pitfalls.slice(1) })
  return log
}

// Byte-cap eviction is deterministic. State zone sheds resolved failures first,
// then verified facts, files, questions, actions. Log zone sheds milestones,
// then decisions, then pitfalls (oldest first). Constraints are user-issued and
// never evicted; they are string-clipped instead.
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
  return { state: shrinkState(state), log: shrinkLog(log), ...(input.refs ? { refs: input.refs } : {}) }
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

function defined<S extends Record<string, unknown>>(input: S | undefined): Partial<S> {
  if (!input) return {}
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<S>
}

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
      yield* db
        .transaction((tx) =>
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
        .pipe(Effect.orDie)
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

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
