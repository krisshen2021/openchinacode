# Phase 5.1: Durable event log retention

**Status:** done (2026-08-21)
**Driver:** production incident — `opencode-openchinacode.db` ballooned to 8.2 GB (2.9 GB `event` rows / 369k, every message/part/session update storing a full JSON snapshot forever, plus 3.5 GB freelist). Manual purge + VACUUM restored the DB (8.2 GB → 1.36 GB) with zero transcript loss, proving the log is not local truth. This task makes the purge automatic so it never regrows.

## Explore findings (agent-49, verified)

- Writers: `EventV2.publish` → `commitDurableEvent` (`packages/core/src/event.ts:205-367`) writes one `event` row per durable publish, unthrottled at semantic boundaries (text/reasoning start+end, tool states, summary/touch). Streaming deltas are NOT durable — good.
- Readers: the `event` table is load-bearing ONLY for cross-instance workspace sync / session warp (gated by `Flag.OPENCODE_EXPERIMENTAL_WORKSPACES`): `sync.history` full-table scan (`handlers/sync.ts:72-85`), `Workspace.syncHistory` (`control-plane/workspace.ts:307-364`), `sessionWarp` (`workspace.ts:645-693`), live sync loop seq-contiguity (`workspace.ts:395-429`). Nothing reads it at boot or for crash recovery; local truth lives in projection tables written transactionally by projectors.
- `event_sequence.seq` is the sync currency: fence/`waitForSync` need only `event_sequence` (proven by `workspace.test.ts:1582-1662`), so event rows may be deleted while sequence rows must stay.
- Replay dedupe (`event.ts:262-302`): stale replay (`seq <= latest`) requires the stored row to deep-match, else dies `"Replay diverged"`. After pruning, the row is gone → must become an idempotent skip instead.
- Precedent: migrations `20260604172448` and `20260622170816` already did `DELETE FROM event; DELETE FROM event_sequence;` (with workspace severance).
- GC pattern to mirror: `ToolOutputStore.cleanupNode` (`packages/core/src/tool-output-store.ts:199-210`) — `makeGlobalNode` + `Effect.repeat(Schedule.spaced(...))`; hourly forked loops also in `snapshot/index.ts:761-766`, `truncate.ts:143-148`.

## Design (strategy "retention sweep, hardened")

1. **Retention node** `packages/core/src/event/retention.ts` — `makeGlobalNode` (deps `[Database.node]`), hourly `Effect.repeat(Schedule.spaced(Duration.hours(1)))`, plus an exposed `sweepOnce` effect for tests. Deletes `event` rows only; NEVER touches `event_sequence`.
2. **Eligibility (safe floor):** aggregate (= session) prunable only when the session row exists, `session.workspace_id IS NULL`, AND (`session.time_archived IS NOT NULL` OR `session.time_updated` older than the retention window). Workspace-bound sessions are never pruned (keeps every sync guarantee in §3 of the explore report). Aggregates with no session row are left alone (`EventV2.remove` already cascades on session delete).
3. **Config:** `experimental.event_retention_days` (integer, default `7`, `0` disables the sweep) — mirror how `experimental.mcp_idle_timeout` is read and documented (commits 248e5dd06 / e86d6f305 / f0d17f275). The node lives in core; wire the config value in from the opencode layer the way other core nodes receive options. Mount the node wherever `ToolOutputStore.cleanupNode` is mounted (server layer graph), NOT in the TUI-only graph.
4. **Replay hardening** (`event.ts:262-290`): when `input.seq <= latest` and the stored row is MISSING → treat as idempotent skip (return without inserting); keep the `"Replay diverged"` die ONLY when the row exists and its payload mismatches (preserves `event.test.ts:982` semantics). Sequence-mismatch and owner rules unchanged.
5. **No VACUUM / auto_vacuum work** — deleted pages become freelist and get reused, so file size plateaus instead of shrinking; today's production VACUUM already reclaimed the historical bloat. Note this in code comments so nobody "fixes" the file size later.

## Non-goals

- No snapshot folding, no de-durabling of any event type (both break workspace sync).
- No changes to `event_sequence`, fence, `waitForSync`, sync handlers, workspace control-plane.
- No pruning of V2 `session.next.*` aggregates beyond the same eligibility rule (they're session-keyed too).

## Tests (packages/core/test/, new file `event-retention.test.ts` preferred)

1. Seed aggregates: A archived+unbound, B active, C archived but workspace-bound, D unbound but within window → run `sweepOnce` → only A's event rows gone; `event_sequence` intact for all.
2. Retention disabled (`0`) → sweep is a no-op.
3. Replay hardening: stale replay into a pruned aggregate (seq <= latest, row missing) succeeds as skip; stale replay with mismatched payload over an EXISTING row still dies (keep `event.test.ts:982` green).
4. Orphan aggregate (no session row) is not pruned.

**Must stay green:** `core/test/event.test.ts`, `session-projector.test.ts`, `session-tool-progress.test.ts`, `database-migration.test.ts`; `opencode/test/server/httpapi-sync.test.ts`, `control-plane/workspace.test.ts`, `httpapi-instance.test.ts`, session suite. Run from package dirs (`packages/core`, `packages/opencode`), never repo root. `bun typecheck` per touched package.

## Acceptance gates

- All tests above green; typecheck clean.
- Growth simulation: insert ≥100k synthetic event rows for an archived session, `sweepOnce`, assert table byte count drops to ~baseline and active-session rows untouched.
- Compiled-binary smoke (standing rule): `OPENCODE_APP_NAME=openchinacode-surgery bun run --cwd packages/opencode build --single --skip-install`, boot TUI, headless prompt, confirm sweep logs once on schedule (or via forced short interval) with no errors.
- Commit(s) on `memory-surgery` with conventional messages; numbers recorded in the plan doc.

## Results (2026-08-21, acceptance gate)

Commits on `memory-surgery`: `286f38209` (replay hardening), `b4cd7547b` (retention node + tests + config), `96d8c596b` (server mount), `cbce6a2b7` (SDK regen).

Deviations from the design section, all accepted:

1. Config read uses `Config.getGlobal()` at server boot (the sweep is process-global; `Config.get()` needs a request-scoped `InstanceRef`). Project-level overrides are not honored; changing the value needs a restart. Documented in `server.ts`.
2. Plan test 1 (aggregates A–D) kept verbatim; a fifth scenario added for the `time_updated`-beyond-window OR-branch; a sixth for divergent-replay-over-existing-row.
3. `sweepOnce` returns the eligible-aggregate count (used in tests and the sweep log line).

### Verification numbers (reproduced by reviewer, not just the implementer)

- `packages/core`: `bun typecheck` clean; `bun test test/event-retention.test.ts test/event.test.ts test/session-projector.test.ts test/session-tool-progress.test.ts test/database-migration.test.ts` → **75 pass / 0 fail** (new file 6/6).
- `packages/opencode`: `bun typecheck` clean; `bun test test/server/httpapi-sync.test.ts test/server/httpapi-instance.test.ts test/control-plane/workspace.test.ts` → **43 pass / 1 skip / 1 fail**. The 1 fail (`workspace CRUD … OPENCODE_AUTH_CONTENT` env assertion) is pre-existing/environmental — fails identically with this work reverted.
- Growth simulation (temporary test, 100k rows ≈ 300 B payload each for one archived session + 1k rows for an active session, `:memory:` DB): sweep pruned exactly 1 aggregate; event payload bytes **39,071,780 → 382,890 (37.3 MB → 0.4 MB)**; archived rows 0, active rows 1000 intact, `event_sequence` intact; file page count plateaus **56.0 → 56.0 MB**, and re-inserting the same 100k rows lands at **56.1 MB** (deleted pages reused, no regrowth). Temp test deleted after recording.
- Compiled-binary smoke (`0.0.0-memory-surgery-202608210701`): against the real surgery data dir, one session (`ses_97fca349113eB9UXa64P5VBRf3`, 7116 event rows) was aged past the window; fresh server boot logged `event retention sweep pruned durable event rows aggregates=1 retentionDays=7`; its event rows went **7116 → 0** (total 14557 → 7441), `event_sequence` kept all 8 rows (target seq 7115 preserved), sessions untouched. Headless `run "reply with just: ok"` succeeded via glm-5.2.

### Notes discovered during acceptance

- The TUI attaches to the already-running server from `server.json`; a server restart is required for a config change or to observe a boot sweep.
- bun:sqlite cannot read `PRAGMA freelist_page_count` (returns null) — page-reuse must be proven by re-insertion plateau, not by the freelist counter.
- `ToolOutputStore.cleanupNode` is a dead export in this fork (mounted nowhere); the retention node is mounted in the httpapi server graph only.
