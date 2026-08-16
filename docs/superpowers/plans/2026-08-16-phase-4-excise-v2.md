# Phase 4: Excise the V2 Session Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the experimental V2 session runtime (~9,200 lines / ~85 modules: SessionV2/SessionExecution/SessionRunner graph, core V2 tool stack, `@opencode-ai/protocol` + `@opencode-ai/server` packages, `v2` CLI command) with zero user-visible behavior change. Expected: ~25-40 MB RSS off the server process, smaller per-location layer graph, faster CLI.

**Architecture:** Child plan of `2026-08-16-memory-surgery.md` Phase 4, on branch `memory-surgery` in worktree `../OpenChinaCode-surgery`. ALL work in this worktree only. NEVER touch `/home/kris/Projects/OpenChinaCode`. Order matters: 4.1 severs the six keep→V2 import edges FIRST, then 4.2/4.3 delete, then 4.4 regen, then 4.5 gate.

**Tech Stack:** Bun 1.3, TypeScript, Effect 4.0-beta.

---

## Audit conclusions (2026-08-16, two explore agents — settled, do not re-litigate)

**The TUI never calls the V2 session runtime.** Its live `v2.*` SDK calls (`location.get`, `agent/command/integration/model/provider/reference/skill.list`, `fs.find`, `projectCopy.*`) are all backed by location-scoped core services — they stay. Its five SessionV2-backed calls (`v2.session.get/messages/permission.list/question.list`, `v2.permission.saved.list` at `packages/tui/src/context/data.tsx:422-459`) are never-invoked dead code — they get deleted in Task 4.4. `run`/`--mini`/acp use only legacy V1 routes.

**The six keep→V2 entanglements (fixed in Task 4.1):**
- B1 `packages/core/src/permission.ts`: imports `SessionV2` (:9) + `SessionStore` (:10); uses `SessionV2.ID`/`NotFoundError` (:93-94,97,138,142,295) and `sessions.get(sessionID)` to read `session.agent` (:115,141); dep `SessionStore.node` (:308). NOTE: this file alone drags the whole V2 graph into every V1 process via `plugin.ts → skill.ts → permission.ts → session.ts`.
- B2 `packages/core/src/control-plane/move-session.ts`: `SessionV2` (:9), `SessionStore` (:12), `SessionV2.NotFoundError` (:57,79), `SessionStore.Service` (:75), dep `SessionStore.node` (:147). (`SessionEvent.Moved` at :106 stays — keep-list.)
- B3 `packages/core/src/location-services.ts`: runner imports (:27-29), system-context registry/builtins (:33-34,61-62), core tool nodes (:35-37,66-68,74-75), `SessionTodo.node` (:72), `SessionRunnerModel/LLM` (:76,78). The module STAYS (V1 resolves FileSystem/Pty/Reference/PluginV2 through it); the V2 entries get cut.
- B4 `packages/opencode/src/session/prompt.ts:20` imports `MAX_STEPS_PROMPT` from `core/session/runner/max-steps` (used at :1579). 16-line constant — inline it.
- B5 `packages/opencode/src/session/schema.ts:4,7`: `SessionID = SessionV2.ID` — re-point to `SessionSchema.ID` from `core/session/schema.ts` (keep-list thin re-export).
- B6 `packages/opencode/src/server/routes/instance/httpapi/handlers/control-plane.ts:2,31` uses `SessionV2.NotFoundError` — re-point to wherever B2 puts it.
- Non-issues (verified): `opencode/src/session/session.ts:13-15` imports of `SessionV2`/`SessionExecutionLocal`/`locationServiceMapLayer` are dead — delete the lines.

**Keep-list (verified clean):** `Database`, `EventV2` (+ `event-v2-bridge`), `Credential`, `PtyTicket`, `PermissionSaved`, `ProjectV2`, `ModelsDev`, `Ripgrep`, `Npm`, `FSUtil`, `SessionProjector` closure (`session/sql.ts`, `projector.ts`, `message-updater.ts`, `input.ts`, `context-epoch.ts`, `history.ts`, `error.ts`, thin re-exports `message.ts`/`event.ts`/`prompt.ts`/`schema.ts`, `system-context/index.ts`), `location-service-map.ts`, `location-services.ts` (pruned), `control-plane/move-session.ts` (fixed), `core/src/tool/shell-safety.ts`, `@opencode-ai/sdk/v2` (regenerated in 4.4). `SessionInputTable` stays (harmless). `debug v2` command STAYS (catalog debug, not session runtime).

**Whole-package deaths:** `packages/protocol` (only consumers are packages/server + `httpapi/api.ts:28` + server middleware that also dies) and `packages/server` EXCEPT `cors.ts` (34 lines) and `pty-environment.ts` (19 lines) — inline those two into opencode before deletion. Root `package.json` workspaces, `packages/opencode/package.json` deps, `packages/core/package.json` exports (`./session/runner`, `./system-context`) all update; `bun install` regenerates the lockfile.

**Test fallout:** ~35 of 88 `packages/core/test` files die with the runtime. In `packages/opencode/test`: `session/prompt.test.ts:42-43,690-693` and `session/compaction.test.ts:21-23,721-722` use `SessionV2` + `noopLayer` as a read-back assertion helper — rework to query `SessionMessageTable` directly; `httpapi-control-plane.test.ts:8` uses `SessionV2.NotFoundError`; `server/httpapi-session.test.ts`, `httpapi-public-openapi.test.ts:141-294`, `httpapi-query-schema-drift.test.ts` assert the dying V2 API surface — update; `test/v2/session-message-updater.test.ts` tests KEEP-list code — relocate to `test/session/`.

## Conventions

- Same as prior phases: package-dir typecheck/tests, conventional commits, no semicolons/aliases/star imports, early returns.
- After Task 4.3 the public HttpApi changes → SDK regen in Task 4.4 (root `script/generate.ts`; the regen WILL surface the known pre-existing `packages/sdk/openapi.json` drift — accept it in its own commit, do not mix with hand edits).
- Every task: `cd packages/opencode && bun typecheck` (plus `packages/core`/`packages/tui` when touched) + targeted tests green.

---

## Task 4.1: sever the six keep→V2 import edges

**Files:**
- Modify: `packages/core/src/permission.ts`, `packages/core/src/control-plane/move-session.ts`, `packages/core/src/location-services.ts`, `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/session/schema.ts`, `packages/opencode/src/server/routes/instance/httpapi/handlers/control-plane.ts`, `packages/opencode/src/session/session.ts` (dead imports only)

- [ ] **Step 1: B5 + B6 + dead imports (mechanical re-points)**
  - `session/schema.ts`: `SessionID` re-pointed to `SessionSchema.ID` (verify the exact export name in `packages/core/src/session/schema.ts`).
  - `handlers/control-plane.ts:2,31`: import `NotFoundError` from its new home (see Step 2).
  - `session/session.ts:13-15`: delete the three dead imports.

- [ ] **Step 2: B2 move-session.ts**
  Replace `SessionStore` usage with a direct `Database` select on `SessionTable` (`packages/core/src/session/sql.ts`, keep-list); `SessionV2.NotFoundError` → define/reuse a `NotFoundError` in a keep-list module (check if one already exists in `@opencode-ai/schema` or core session error module — `session/error.ts`; reuse it there and in B6). Remove the `SessionStore.node` dep, add `Database.node` if not present. `SessionV2.ID` → same source as B5.

- [ ] **Step 3: B1 permission.ts**
  Same treatment: `sessions.get(sessionID)` (reads `session.agent`) → direct `SessionTable` select via `Database`; `SessionV2.ID`/`NotFoundError` re-pointed; `SessionStore.node` dep → `Database.node`. Careful: this file is on the V1 hot path — behavior must be identical (same error shapes thrown at the same call sites).

- [ ] **Step 4: B4 prompt.ts**
  Inline the `MAX_STEPS_PROMPT` constant (copy the 16-line string verbatim from `packages/core/src/session/runner/max-steps.ts` into `prompt.ts` near its use at :1579).

- [ ] **Step 5: B3 location-services.ts**
  Cut the V2 entries: `runner/*` imports + `SessionRunnerModel.node`/`SessionRunnerLLM.node`/`SessionTodo.node` + `SystemContextRegistry`/`BuiltIns` nodes + core tool nodes (`:35-37,66-68,74-75`). The module's keep entries stay byte-identical.

- [ ] **Step 6: verify**
  `cd packages/core && bun typecheck && bun test test/permission* test/control-plane* 2>/dev/null`; `cd packages/opencode && bun typecheck && bun test test/server/httpapi-control-plane.test.ts test/session/prompt.test.ts test/session/compaction.test.ts` — green except the documented pre-existing prompt.test.ts failures (2, provider-env related). Confirm NO file outside the list changed.

- [ ] **Step 7: commit**

```bash
git add packages/core/src/permission.ts packages/core/src/control-plane/move-session.ts packages/core/src/location-services.ts packages/opencode/src/session/prompt.ts packages/opencode/src/session/schema.ts packages/opencode/src/server/routes/instance/httpapi/handlers/control-plane.ts packages/opencode/src/session/session.ts
git commit -m "refactor(core): sever keep-list imports from the V2 session runtime"
```

---

## Task 4.2: delete the V2 session runtime in core + opencode

Prerequisite: 4.1 merged (no keep-list module imports the V2 runtime anymore — re-verify with one grep before starting: `rg "session/runner|session/execution|session/store|from \"./session\"|from \"@opencode-ai/core/session\"" packages/core/src packages/opencode/src` — every hit must be explainable).

**Files to delete (verify each with a fresh grep before deleting):**
- `packages/core/src/session.ts` (SessionV2), `session/store.ts`, `session/execution.ts`, `session/execution/local.ts`, `session/run-coordinator.ts`, `session/runner/` (whole dir), `session/revert.ts`, `session/compaction.ts`, `session/todo.ts`; `session/info.ts` ONLY if 4.1 didn't keep using `fromRow`
- `packages/core/src/system-context/registry.ts`, `builtins.ts`, `packages/core/src/instruction-context.ts`, `packages/core/src/skill/guidance.ts`, `packages/core/src/reference/guidance.ts` (keep `system-context/index.ts`!)
- `packages/core/src/tool/*` EXCEPT `shell-safety.ts` (~21 files; re-verify `shell-safety.ts` is the only V1-imported one)
- `packages/schema/src/prompt-input.ts`, `session-delivery.ts`
- `packages/opencode/src/cli/cmd/v2.ts` + its registration in `packages/opencode/src/index.ts`
- Tests: the ~35 V2-only files in `packages/core/test`; rework `packages/opencode/test/session/prompt.test.ts` + `compaction.test.ts` read-back helpers to query `SessionMessageTable` directly; relocate `test/v2/session-message-updater.test.ts` → `test/session/`

- [ ] **Step 1: grep-verify every deletion target** (print evidence per file group in your report)
- [ ] **Step 2: delete sources; fix residual compile errors** (expect fallout in `location-services.ts` leftovers, `core/package.json` exports `./session/runner` + `./system-context`, `test/` imports)
- [ ] **Step 3: rework the two opencode test helpers** (SessionV2+noopLayer read-back → direct `SessionMessageTable` queries via the keep-list `Database`)
- [ ] **Step 4: verify** — `cd packages/core && bun typecheck && bun test`; `cd packages/opencode && bun typecheck && bun test test/session test/server`; record remaining failures (must be a subset of the documented pre-existing set: prompt.test.ts ×2, test/server ×7, test/cli orphans)
- [ ] **Step 5: commit** — `refactor(core)!: delete the V2 session runtime` (message body: line count removed)

---

## Task 4.3: remove the mounts + protocol/server packages

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts` (remove `serverRoutes` :179-183, V2 layers :301-306, co-removable provides `sessionLocationLayer`/`locationLayer`/`PtyEnvironment.layer` :298-300 — keep `locationServiceMapV2` :276,307 for MoveSession; update the merge at :283)
- Modify: `packages/opencode/src/server/routes/instance/httpapi/api.ts` (remove `ServerApi`/`makeApi` :48-52, merge :83, imports :28-30; check `public.ts` `isV2ApiPath` special-casing becomes dead — remove)
- Inline-then-delete: move `packages/server/src/cors.ts` + `pty-environment.ts` into `packages/opencode/src/server/shared/` (fix their importers), then delete `packages/protocol/` and `packages/server/` whole
- Modify: root `package.json` (workspaces), `packages/opencode/package.json` (deps :88,:92), `bun install`
- Modify tests: `httpapi-session.test.ts` (delete — V2 API surface), `httpapi-public-openapi.test.ts:141-294` (remove `/api/session/*` assertions), `httpapi-query-schema-drift.test.ts` (update), `httpapi-sdk.test.ts:392` (keep `v2.fs.find` — that route stays? VERIFY: fs.find is FileSystem-backed and must survive; if it was part of the dying ServerApi, the test goes with it and the TUI's `autocomplete.tsx:327` call becomes a Task 4.4 migration item — DECIDE AND DOCUMENT)

- [ ] **Step 1: inline cors.ts + pty-environment.ts** (grep their importers first; one is used by `server/server.ts:14` type import)
- [ ] **Step 2: remove mounts + api.ts surgery; typecheck packages/opencode until clean**
- [ ] **Step 3: decide the /api keep-set explicitly.** The live TUI routes (`/api/location`, `/api/agent`, `/api/command`, `/api/integration`, `/api/model`, `/api/provider`, `/api/reference`, `/api/skill`, `/api/fs/find`, `/experimental/project/*/copy*`) are served by handlers in `packages/server` — deleting the whole package deletes them too, breaking the TUI. Two options: (a) port the ~10 live handlers into the opencode instance API as ordinary instance routes (new versioned paths or same paths — but NO new endpoints without SDK regen… which 4.4 does anyway), or (b) keep a slimmed `packages/server` containing only the live handlers. **Choose (a): port the live handlers into the opencode httpapi as instance routes** (they're thin wrappers over location-scoped services; follow `httpapi/AGENTS.md` patterns), keeping the SAME route paths so the TUI + SDK need zero call-site changes. The dead groups (session write surface, permission/question request flows, credential, pty, event, health, provider.get, integration.get/connect.*, fs.read/list) are NOT ported.
- [ ] **Step 4: delete the packages + workspace/dep updates + bun install**
- [ ] **Step 5: verify** — typecheck opencode/core/tui; `bun test test/server test/session`; TUI dev smoke optional (compiled gate in 4.5 covers it)
- [ ] **Step 6: commit** — `refactor(server)!: remove the V2 public API and fold its live routes into the instance API`

---

## Task 4.4: SDK regeneration + TUI dead-code removal

- [ ] **Step 1: delete the TUI dead v2 calls** — `packages/tui/src/context/data.tsx:422-459` (the five never-invoked refresh functions and any store fields that become unused — verify with greps before removing fields; `useData`'s only live consumer is `autocomplete.tsx:93` reading `data.location.reference.list`)
- [ ] **Step 2: SDK regen** — run the generator (root `script/generate.ts` per this repo's layout); inspect the diff: expected = v2 `/api/session*` etc. operations vanish from `sdk.gen.ts`/`types.gen.ts`, plus the known pre-existing openapi.json drift. Remove the `V2SessionHistoryData` post-processing regex in `packages/sdk/js/script/build.ts:79` if present. Commit generated files SEPARATELY: `chore(sdk): regenerate after V2 API removal`.
- [ ] **Step 3: typecheck** `packages/tui`, `packages/opencode`; run `bun test test/cli` in opencode (watch the help-snapshot test — command set changed when `v2` was removed; update snapshot if it's managed in-repo)
- [ ] **Step 4: commit** hand edits: `refactor(tui): remove dead v2 session data calls`

---

## Task 4.5: docs + Phase 4 verification gate

- [ ] **Step 1: docs** — root `AGENTS.md`: delete the "V2 Session Core" section + the stale `packages/client` bullet. Root `CONTEXT.md`: replace V2 vocabulary with a short V1-architecture description; keep the good ideas (durable prompt admission, provider-turn boundaries, context epochs) as "possible future ports" notes in the surgery plan's Phase 5 list. Update the main plan's Phase 4 section with results.
- [ ] **Step 2: full verification** — typecheck core/opencode/tui/ui; `bun test` suites in core+opencode (failures must be subset of documented pre-existing); `bun run script/bench-rss.ts` (expect `--help` visibly below 144 MB).
- [ ] **Step 3: compiled-binary smoke (MANDATORY)**

```bash
cd packages/opencode && OPENCODE_APP_NAME=openchinacode-surgery bun run build --single --skip-install
```

tmux TUI in aiwallpaper: boots; `hi` prompt works; sidebar shows; **server process idle RSS vs the 334 MB Phase-3 baseline — record the delta (this is the payoff number)**; TUI process RSS vs 221 MB; kill/relaunch reuse still works; `openchinacode-test serve` + `attach` still work; `v2` command is gone from `--help`.
- [ ] **Step 4: record + commit** — fill both plan docs; `docs: record phase 4 verification results`.

**Merging Phase 4 to `main` is NOT part of this plan** — the user holds that decision.
