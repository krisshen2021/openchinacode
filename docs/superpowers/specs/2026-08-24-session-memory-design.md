# Session memory (structured working memory) — design

**Date:** 2026-08-24
**Status:** approved in dialogue (2026-08-24), pending written-spec review
**Scope:** OpenChinaCode `main` branch. Phase A only: session-scoped structured memory. Project-level persistence ("phase B") and any vector retrieval are explicitly out of scope.

## Problem

Long sessions lose critical state through repeated summarizing compaction: decisions drift, resolved pitfalls get rediscovered the hard way, half-done work loses its thread. The harness today has two memory layers — the context window (working set) and the summary chain (swap) — but no persistent structured store (filesystem). Project docs indexed from AGENTS.md are a manual version of that third layer, but reading them depends on LLM initiative; there is no deterministic "page fault" that forces recall.

User-confirmed framing: the three hard problems of external memory are **what to record, when to recall, how to retrieve**, plus **where to write** and **how to keep the DB clean**.

## Decisions (each confirmed by the user in dialogue)

1. **Scope: session-level first**, architected so a project-level layer can be added later. Session level has a deterministic recall moment (every prompt build) and is the cheapest to validate.
2. **No vector RAG for the main channel.** The content is precise structured state at KB scale; deterministic SQL + full injection beats fuzzy top-k, and RAG does not solve the recall-timing problem at all. A future `memory_search` tool over archived history may use embeddings, but not in this phase.
3. **Write timing: compaction-time judge-chain update as the deterministic floor + a `memory_write` tool as the agent-initiated ceiling.** Tool calls are observable, which yields data on what the agent considers worth recording.
4. **Storage: one new SQLite table** via the existing drizzle/migration setup in `packages/core`. Lifetime follows the session row; nothing is written into user project directories.
5. **Recall: deterministic full injection on every prompt build** (bounded, ~1.5–2k tokens). No LLM discretion, no trigger heuristics.
6. **DB hygiene: cascade delete with the session, opt-in time-based retention defaulting to off**, following the `packages/core/src/event/retention.ts` pattern (background sweep + config knob + logging). The memory table is bounded (KB per session) and is not a bloat source; message/part retention is a separate proposal, out of scope.

## Grounded facts (verified during exploration)

- Compaction pipeline: `packages/opencode/src/session/compaction.ts` — `processCompaction` (:507), profile judge (:343), active-task extraction (:420). The extraction already produces almost exactly the state content this design persists; today it is folded into the summary prompt and discarded.
- Extraction schema/prompts: `packages/opencode/src/session/compaction-profile.ts` — `ActiveTaskEssential` (:31-47), `activeTaskMessages` (:464, "extract from recent" prompt, 45k char window + 6k previous-summary excerpt), `normalizeActiveTaskEssential` (:211, clamping), `fallbackActiveTask` (:505), `buildPrompt` (:582).
- Prompt assembly injects model messages at `packages/opencode/src/session/prompt.ts:1567` via `MessageV2.toModelMessagesEffect`; per-session retention overrides already live in `session.metadata.compaction` (`packages/core/src/config/compaction.ts:16-42`) — precedent for session-scoped memory metadata.
- DB: drizzle schema in `packages/core/src/**/*.sql.ts`, migrations applied by core. The production DB is user-critical (184 sessions incl. "SideGame-Reactor v2"); the migration must be **additive only** — new table, zero changes to existing tables, rollback = drop table.
- Event retention precedent: `packages/core/src/event/retention.ts` (`experimental.event_retention_days`, default 7 days, 0 = off) — copy this shape for memory retention.
- Public HttpApi changes require SDK regeneration via root `script/generate.ts` (root AGENTS.md); instance API groups live in `packages/opencode/src/server/routes/instance/httpapi/groups/`.
- New tools follow the existing module pattern in `packages/opencode/src/tool/` (self-contained module + registration).
- `refs` (git HEAD, branch) are harness-known: do not let the LLM author them.

## Design

### 1. Storage

New table `session_memory`, one row per session:

| column       | type                  | notes                                                              |
| ------------ | --------------------- | ------------------------------------------------------------------ |
| `session_id` | text PK, FK → session | cascade delete in the same transaction as session delete           |
| `content`    | text (JSON)           | the structured document below, hard cap 8 KB                       |
| `source`     | text                  | last writer: `judge` (compaction merge) \| `tool` (`memory_write`) |
| `version`    | integer               | incremented per write; debugging/optimism                          |
| `updated_at` | integer               | ms epoch                                                           |

Additive migration only. If the migration or a read fails, the feature disables itself with a warn log and compaction behaves exactly as today.

### 2. Content schema

Two zones with different mutation rules:

**`state` (≤ 3 KB, wholesale rewrite each compaction — describes "now")**

```
objective        one sentence
status           active | blocked-on-user | waiting-verify | done
kind             reuse existing ActiveTaskKind enum
files: [{ path, role: created | modified | referenced, note }]   ≤ 12
verified: []     "fact @ evidence" strings; passed checks only, no command logs
failures: [{ error, resolved: bool, fix? }]                      unresolved first
next_actions: [] priority ordered, ≤ 8
open_questions: [{ q, owner: user | investigate }]
```

**`log` (≤ 5 KB, append-only; the merge logic, not the LLM, owns eviction)**

```
decisions: [{ decision, rationale, rejected: [], at }]           ≤ 50, merge oldest when full
constraints: [] user-issued rules; never expire
pitfalls: [{ trap, why, workaround, at }]                        ≤ 30, admission requires all of:
             resolved-or-workaround-known, non-obvious (high rediscovery cost), reusable
milestones: []   optional one-liners for major checkpoints
```

**Harness-authored fields (never LLM-written):** `refs { head_commit, branch }`, `updated_at`, `source`.

On write overflow (> 8 KB), the writer (judge prompt or tool validation) must self-compact before persisting; the normalize/clamp step enforces hard limits as today.

### 3. Write path

- **Compaction-time (floor):** `activeTaskMessages` changes from "extract from recent conversation" to "merge delta into existing memory": input = previous memory content + conversation delta since last compaction. The judge chain, fallbacks, timeouts, and progress events are reused unchanged. On judge failure the previous memory is kept — a failed write never wipes.
- **Write gate (revised 2026-08-25):** the merge runs on every compaction, unconditionally. The row is persisted when `previousMemory` exists OR the merged content is non-empty (`SessionMemory.isEmpty`). The earlier gate on the judge's `active_task.present` dead-ended sessions whose judge conservatively reports "none detected": no first write → no previous memory → every later compaction skipped again (observed live on a 246-message dev session).
- **Judge flakiness hardening (revised 2026-08-25):** reasoning judges occasionally return reasoning-only, empty-content completions (observed: 46 reasoning tokens, `finishReason=stop`, rawChars=0 on a healthy endpoint). Three layers: `runJsonJudge` gains an opt-in `retries` (the memory merge retries once on invalid output); `fallbackMemory` now seeds the profile judge's `must_preserve` into `log.constraints` (deduped) so a successful profile judge alone guarantees a non-empty first write; the merge prompt tells the model to return the previous document unchanged when there is nothing to add.
- **Pitfall promotion:** during the same merge, entries in `state.failures` that are resolved and meet the admission criteria are promoted into `log.pitfalls`.
- **`memory_write` tool (ceiling):** agent-facing tool accepting partial state/log updates; validated through the same normalize/clamp path; tagged `source: "tool"`. Log-zone fields are append-only through the tool as well.
- Harness fills `refs`, `updated_at`, `source` deterministically at write time.

### 4. Recall path (the page fault)

- Every prompt build injects the memory, rendered as one Markdown document with a fixed section order (state sections, then log sections). The same rendering feeds the TUI view and the model — one renderer, two consumers.
- Injected as a dedicated system-prompt entry (position-stable between writes, so provider prompt caches survive; content only changes on writes).
- Read-only HTTP endpoint `GET /session/:id/memory` returning `{ content, rendered, updated_at, source, version }` (requires SDK regen via `script/generate.ts`).
- TUI: read-only viewer (dialog or sidebar entry, placement decided in the plan phase). No editing UI in v1.

### 5. DB hygiene

- Session delete cascades to `session_memory` in the same transaction — no orphans.
- Inactive sessions never inject (recall rides prompt builds), so stale rows cost nothing at runtime.
- New config `experimental.memory_retention_days` (default 0 = cascade-only, no active sweep), implemented in the style of `event/retention.ts`: background sweep, warn-level logging of deletions.
- Expected size: KB per session; even 10k sessions ≈ tens of MB. Not a bloat source.

### 6. Error handling

- Judge failure / invalid JSON → keep previous memory, publish the existing judge progress events, compaction proceeds as today.
- `memory_write` validation failure → tool error describing the violated constraint (size, cap, enum).
- Migration/read failure at startup → feature off + warn log; zero impact on compaction.

### 7. Testing

- Unit (real SQLite, no mocks; run from package dirs, never repo root): schema round-trip, cascade delete, log-cap merge eviction, normalize clamps, pitfall admission.
- Integration: run a compaction in a fixture session → row written → next prompt build contains the rendered memory → agent `memory_write` update appears on the following turn.
- Regression: compaction of a session whose memory write fails must behave identically to current main.

## Non-goals (YAGNI)

- Project-level persistent memory (phase B; `pitfalls` is the priority candidate to promote when that phase starts).
- Vector/embedding retrieval or a `memory_search` tool over archives.
- Retention governance for message/part tables (separate proposal).
- TUI editing of memory, multi-agent shared memory, cross-session memory queries.

## Implementation anchors (for the plan phase)

1. `packages/core`: `session_memory` table + additive migration; retention sweep module; config field.
2. `packages/opencode/src/session/compaction-profile.ts`: merge-style prompt + previous-memory input; extended normalize for the new schema.
3. `packages/opencode/src/session/compaction.ts`: persist memory after extraction; keep-old-on-failure.
4. `packages/opencode/src/session/prompt.ts`: inject rendered memory in prompt assembly.
5. `packages/opencode/src/tool/`: `memory_write` tool.
6. HttpApi group + `script/generate.ts` SDK regen; TUI read-only viewer.
7. Branch name per AGENTS.md: `session-memory`.

## Revision 2026-08-26: merge judge failure hardening

Production logs showed the merge judge failing regularly: 9 timeouts at exactly 90s, 2 provider errors, 14 invalid outputs over ~10 days. Root cause was budget miscalibration, not flakiness — successful deepseek-v4-flash merge calls cluster at 60-89s (reasoning dominates; observed max 89.3s), so the 90s timeout cut through the middle of the latency distribution.

- `ACTIVE_TASK_EXTRACT_TIMEOUT_MS` 90s → 180s (2x headroom over observed max).
- `ACTIVE_TASK_EXTRACT_MAX_OUTPUT_TOKENS` 65536 → 16384 (merged doc is ≤ ~5k tokens; unbounded reasoning was the latency driver).
- `runJsonJudge` now retries `failed` (provider errors) while retries remain, in addition to `invalid`. Timeouts and external aborts are never retried — the shared abort controller is already dead, so another attempt would fail instantly.
