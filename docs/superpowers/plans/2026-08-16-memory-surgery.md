# Memory Surgery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut OpenChinaCode's idle RSS from ~930 MB (measured: 736 MB main process + 193 MB idle MCP child) and simplify the runtime structure, without changing user-visible behavior per phase.

**Architecture:** Five phases executed on the `memory-surgery` branch (worktree `../OpenChinaCode-surgery`), each phase independently verifiable and mergeable to `main`: (0) measurement harness, (1) CLI module-graph slimming via handler-time dynamic imports, (2) runtime service-graph laziness (MCP/LSP/highlighting), (3) TUI/backend process split, (4) excision of the experimental V2 session runtime + V2 public API (V1 stays the live heart), (5) long-running V1 in-place refactor track, harvesting V2's good ideas where they pay off.

**Strategic decision (2026-08-16, user):** No upstream sync; `main` is the fork's own line. The heart transplant is INVERTED from the original plan — instead of completing V2 to parity and migrating to it, the experimental V2 session runtime is deleted and V1 is refactored in place. Rationale: diagnosis never implicated V1 session logic in the memory profile; V2 is phase-1 experimental (text-only, all tools denied, see `packages/opencode/src/cli/cmd/v2.ts`); deleting V2 removes the dual-runtime tax at a fraction of the cost of finishing it.

**Tech Stack:** Bun 1.3, TypeScript, Effect 4.0-beta, yargs, OpenTUI/SolidJS, Drizzle/SQLite.

---

## Diagnosis evidence (measured 2026-08-15, worktree `main@544be4ebe`)

| Item                                           | Value                         | How measured                                                                            |
| ---------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| Bare `bun -e`                                  | 32 MB RSS                     | `process.memoryUsage()`                                                                 |
| Full backend module graph, no services started | 191 MB RSS / 36 MB heap       | phased dynamic-import probe                                                             |
| `--` protocol/api import step alone            | +40 MB RSS, heap 9→36 MB      | same probe (Effect Schema codec compilation; a large share is the V2 public API groups) |
| `--` core/models-dev import step               | +27 MB RSS                    | same probe                                                                              |
| TUI startup peak / idle stable                 | ~950 MB / ~736 MB, 48 threads | `ps` sampling via tmux                                                                  |
| MCP child (playwright), idle                   | ~193 MB                       | `ps --ppid`                                                                             |

**Key structural finding:** the live TUI + `run` paths are served by V1 session services (`packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` imports `@/session/session`, `@/session/prompt`, ...). The V2 runtime (`SessionV2`/`SessionExecution`) is mounted in parallel (`server.ts:178-182` serverRoutes + `server.ts:300-304` layers) but is phase-1 experimental.

**Critical nuance for Phase 4:** "delete V2" means the V2 _session experiment_ (`SessionV2`, `SessionExecution`, `SessionRunner`, the V2 public API in `@opencode-ai/protocol`/`@opencode-ai/server`, the `v2` CLI command) — NOT shared core infrastructure that the V1 live path already uses: `Database`, `EventV2` (the `event-v2-bridge` feeds TUI events through it), `Credential`, `PtyTicket`, `PermissionSaved`, `ProjectV2`, `ModelsDev`, `Ripgrep`, `Npm`, `FSUtil` all boot in the V1 service graph (`server.ts:212-270`).

**Service graph evidence:** `packages/opencode/src/server/routes/instance/httpapi/server.ts:212-270` builds one eager `LayerNode.group` of ~55 services (LSP, MCP, Snapshot, ShareNext, Worktree, Format, ...). The comment at lines 308-311 confirms eagerly forked fibers at build time (ModelsDev refresh).

**CLI static-import evidence:** `packages/opencode/src/index.ts:3-15` statically imports all command modules; command modules top-level-import heavy graphs, e.g. `cli/cmd/acp.ts` → `@agentclientprotocol/sdk` + `@opencode-ai/sdk/v2`, `cli/cmd/github.handler.ts` → `@octokit/rest` + `@actions/core`, `cli/cmd/mcp.ts` → `@modelcontextprotocol/sdk`, `cli/cmd/export.ts`/`import.ts` → `@/session/session` + Database, `cli/cmd/run.ts:1-27` → SDK v2 + session types. Every CLI invocation (including `--help`) pays for all of them.

## Conventions to respect (from AGENTS.md files)

- Run `bun typecheck` from `packages/opencode`, never `tsc`; tests run from package dirs, never repo root.
- Branch names: ≤3 hyphenated words, no slashes (`memory-surgery` already exists).
- Commits: conventional style, e.g. `refactor(opencode): lazify command imports`.
- AGENTS.md style: "Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope." Avoid `await import("./x").then((m) => m.f())` chains.
- No import aliases, no star imports, no `export namespace`; early returns over `else`; `const` over `let`.
- Keep route/middleware patterns per `packages/opencode/src/server/routes/instance/httpapi/AGENTS.md` when touching server code.

---

## Phase 0: Measurement harness

Every phase needs before/after numbers from the same tool. Do this first, commit the script.

### Task 0.1: RSS benchmark script

**Files:**

- Create: `script/bench-rss.ts`

- [ ] **Step 1: Write the script**

```ts
// script/bench-rss.ts — measure CLI memory at defined checkpoints.
// Usage: bun run script/bench-rss.ts
import { spawn } from "node:child_process"

const CLI = ["bun", "run", "--conditions=browser", "packages/opencode/src/index.ts"]

async function maxRss(args: string[], killAfterMs: number): Promise<number> {
  const child = spawn(CLI[0], [...CLI.slice(1), ...args], { stdio: "ignore" })
  let peak = 0
  const timer = setInterval(() => {
    try {
      const status = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(child.pid)])
        .stdout.toString()
        .trim()
      peak = Math.max(peak, Number(status) || 0)
    } catch {}
  }, 250)
  await new Promise<void>((resolve) => {
    const killer = setTimeout(() => {
      child.kill("SIGTERM")
      resolve()
    }, killAfterMs)
    child.on("exit", () => {
      clearTimeout(killer)
      resolve()
    })
  })
  clearInterval(timer)
  return peak / 1024 // MB
}

const rows: [string, number][] = []
rows.push(["--help (module graph only)", await maxRss(["--help"], 60_000)])
rows.push(["models --help", await maxRss(["models", "--help"], 60_000)])
for (const [label, mb] of rows) console.log(`${label.padEnd(34)} peak RSS ${mb.toFixed(0)} MB`)
```

- [ ] **Step 2: Record the baseline**

Run: `bun run script/bench-rss.ts`
Expected: prints both rows; save output into the commit message of Task 0.1 as the Phase 1 baseline.

- [ ] **Step 3: Commit**

```bash
git add script/bench-rss.ts
git commit -m "chore(script): add RSS benchmark harness"
```

---

## Phase 1: CLI module-graph slimming (dynamic command imports)

**Target:** `--help` peak RSS down from the Phase 0 baseline toward ~120 MB; TUI startup peak down by the share of command modules the TUI path never uses (`github`, `mcp`, `acp`, `export`, `import`, `plug`, ...).

**Pattern (already sanctioned by AGENTS.md and used at `cli/cmd/run.ts:92`):** keep each command module's top level limited to the yargs spec (`command`, `describe`, `builder`, `handler`); move every heavy top-level import into the `handler` via `await import(...)`, destructuring bindings at the top of the handler. Type-only imports (`import type`) are erased and may stay.

### Task 1.1: Reference conversion — `run` command

**Files:**

- Modify: `packages/opencode/src/cli/cmd/run.ts` (top-level imports, lines 1-27)

- [ ] **Step 1: Read the current handler body**

Run: `sed -n 1,120p packages/opencode/src/cli/cmd/run.ts`
Confirm which of these top-level imports are used only inside `handler`/`builder` callbacks: `node:fs/promises`, `effect`, `@/cli/ui` (`UI`), `../effect-cmd` (`effectCmd`), `@opencode-ai/sdk/v2` (`createOpencodeClient`), `@/util/filesystem`, `./run/runtime.stdin`. `import type` lines stay.

- [ ] **Step 2: Convert**

Rewrite the module so the top level keeps only `cmd` spec construction; inside `handler`, first line block:

```ts
handler: async (args) => {
  const { open } = await import("node:fs/promises")
  const { Effect } = await import("effect")
  const { UI } = await import("../ui")
  const { createOpencodeClient } = await import("@opencode-ai/sdk/v2")
  // ...rest unchanged
}
```

Apply the AGENTS.md rule: destructure at the top of the handler scope; no `.then()` chains. If the `builder` uses heavy modules, wrap identically (`builder: async (yargs) => ...` is supported by yargs).

- [ ] **Step 3: Typecheck**

Run: `cd packages/opencode && bun typecheck`
Expected: clean.

- [ ] **Step 4: Behavior check**

Run: `bun run --conditions=browser packages/opencode/src/index.ts run --help`
Expected: same help output as before conversion (diff against `git stash`ed version if unsure).

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/cli/cmd/run.ts
git commit -m "refactor(opencode): lazify run command imports"
```

### Task 1.2: Convert the remaining heavy command modules

Apply the Task 1.1 pattern file-by-file. Verified heavy top-level imports to move (audit 2026-08-16):

| File                        | Imports to move into handler                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `cli/cmd/acp.ts`            | `@agentclientprotocol/sdk`, `@opencode-ai/sdk/v2`                                                                                 |
| `cli/cmd/mcp.ts`            | `@modelcontextprotocol/sdk/...` (both), `@opencode-ai/core/v1/config/config`                                                      |
| `cli/cmd/github.handler.ts` | `@octokit/rest`, `@octokit/graphql`, `@actions/core`, `@clack/prompts`                                                            |
| `cli/cmd/export.ts`         | `@/session/session`, `@opencode-ai/core/v1/session`, `../../session/message-v2`                                                   |
| `cli/cmd/import.ts`         | `@/session/session`, `@opencode-ai/core/database/database`, `@opencode-ai/core/session/sql`                                       |
| `cli/cmd/account.ts`        | `@/account/account`, `@/account/schema`                                                                                           |
| `cli/cmd/agent.ts`          | `@clack/prompts`, `gray-matter`                                                                                                   |
| `cli/cmd/plug.ts`           | `@clack/prompts`, `../../plugin/install`, `../../plugin/shared`                                                                   |
| `cli/cmd/db.ts`             | `@opencode-ai/core/database/database`, `drizzle-orm`                                                                              |
| `cli/cmd/models.ts`         | `@opencode-ai/core/models-dev`, `@opencode-ai/core/provider`                                                                      |
| `cli/cmd/tui.ts`            | keep `Rpc`/worker types as `import type`; audit `@opencode-ai/tui/util/error` (small, leaf) — move only if it drags the TUI graph |

- [ ] **Step 1: Convert each file above** (one commit per file, message `refactor(opencode): lazify <name> command imports`)

- [ ] **Step 2: Typecheck after each file**

Run: `cd packages/opencode && bun typecheck`

- [ ] **Step 3: Full CLI smoke**

Run each: `bun run --conditions=browser packages/opencode/src/index.ts <cmd> --help` for `run tui serve models providers mcp upgrade generate debug v2 test`
Expected: all print help, zero `Cannot find module`/top-level side-effect errors.

- [ ] **Step 4: Measure**

Run: `bun run script/bench-rss.ts`
Expected: `--help` peak RSS visibly below the Phase 0 baseline (target ≤ ~120 MB); record both numbers in the merge commit.

- [ ] **Step 5: Merge to `main`**

```bash
cd ../OpenChinaCode   # main worktree
git merge memory-surgery
```

---

## Phase 2: Runtime service-graph laziness (spec — expand into full plan at phase start)

**Scope:** the eager ~55-service `LayerNode.group` at `server/routes/instance/httpapi/server.ts:212-270`. Spec expanded into `2026-08-16-phase-2-runtime-laziness.md`. Findings:

- **MCP idle reaping: implemented** (commits 248e5dd06, e86d6f305, f0d17f275) — per-instance reaper closes local stdio servers idle past `experimental.mcp_idle_timeout` (default 600000, 0 disables); transparent respawn via existing respawnClosed machinery.
- **LSP: already lazy** — language servers spawn only on touchFile/run; boot change unnecessary.
- **shiki/marked:** `packages/ui/src/context/marked.tsx` was already per-language lazy AND had zero consumers — deleted (commit 95b95207ab) with dep prune.
- **ModelsDev:** the +27 MB import probe attributes the shared EventV2/Database/drizzle/platform-node subgraph; models-dev.ts's own top level is ~0 MB once deps warm. Structural split deferred.

**Verification gate:** TUI idle RSS after GC (tmux + `ps` sampling as in diagnosis) — target ≤ 500 MB main process, 0 idle MCP children.

## Phase 3: TUI/backend process split — ✅ DONE (2026-08-16)

Expanded into `2026-08-16-phase-3-process-split.md` (verification results there). Default TUI spawns-or-reuses a detached `serve` process over localhost HTTP+SSE (registry in `Global.Path.data/server.json`, ownership-guarded, version-matched, throwaway Basic password); `--in-process` keeps the old worker path. TUI exit leaves the server running; sessions survive TUI restarts. Measured: TUI 221 MB / server 334 MB (Phase 2 single-process was 455 MB). Add-on (Task 3.5): TUI-spawned servers self-exit after 60 min fully idle (no requests, bus events, or open SSE/WS connections); a manual `serve` stays resident unless `--idle-timeout <ms>` is passed.

## Phase 4: Excise the experimental V2 session runtime — ✅ DONE (2026-08-17)

Executed per the expanded plan `2026-08-16-phase-4-excise-v2.md`, audit-first: two explore agents settled the keep/delete lists, then Task 4.1 severed the six keep→V2 import edges before anything was deleted. ~18k lines removed across the V2 session runtime and the `@opencode-ai/protocol`/`@opencode-ai/server` packages; the live `/api/*` routes were folded into the opencode instance HttpApi (`groups/v2.ts` + `handlers/v2.ts`) with byte-compatible paths and wire shapes; the v2 SDK was regenerated. Commits: 4.1 `1bc3c9b70` (+ `548f6fdcf` test-preload fix), 4.2 `a53bd6e67`, 4.3 `5d16d6033`, 4.4 `1b8c34e0c` + `273a8de04` + `e062dcb96`.

**Independent of Phases 1-3; may run earlier if desired. Zero user-visible behavior change expected — the live product is V1.**

- [ ] **Task 4.0: dependency audit (do first, produces the exact deletion list)**
  - Enumerate what imports `SessionV2`, `SessionExecution`, `SessionRunner`, `@opencode-ai/server/{api,handlers}`, `@opencode-ai/protocol`, the V2 groups in `packages/schema`. Known entry points to verify: `cli/cmd/v2.ts`, `server/routes/instance/httpapi/server.ts:178-182` (serverRoutes mount) and `:300-304` (SessionV2/SessionExecution layers).
  - Explicitly confirm the keep-list is load-bearing for V1: `Database`, `EventV2` (via `event-v2-bridge`), `Credential`, `PtyTicket`, `PermissionSaved`, `ProjectV2`, `ModelsDev`, `Ripgrep`, `Npm`, `FSUtil`.
  - Confirm no other client (TUI, `attach`, `web`, external scripts) calls V2 API routes. Grep the TUI and sdk/js for V2 route paths.
- [ ] **Task 4.1: remove the mounts** — delete `serverRoutes` + V2 layers + `v2` command from `packages/opencode`; typecheck + TUI smoke.
- [ ] **Task 4.2: delete the now-unreferenced packages/modules** — `@opencode-ai/server` handlers+api, V2 groups in `@opencode-ai/protocol`, V2-only contracts in `@opencode-ai/schema`, `packages/core/src/session/{execution,runner,...}` per the audit (keep `sql.ts` if `import.ts`/storage migration still uses it — verify). Remove from workspace list in root `package.json` if whole packages die.
- [ ] **Task 4.3: rewrite docs to match reality** — root `CONTEXT.md` is almost entirely V2 vocabulary (System Context algebra, drains, Context Epochs); the V2 Session Core section of root `AGENTS.md` likewise. Replace with a short description of the fork's V1-based architecture; keep the good ideas as "possible future ports" notes for Phase 5.
- **Verify:** `bun typecheck` all touched packages; full TUI regression; benchmark — expect a meaningful chunk of the +40 MB protocol/api codec tax gone.

## Phase 5: V1 in-place refactor track (ongoing; one focused plan per item)

Not a single phase with an end date — the standing "重构" track on the slimmed codebase. Candidate items, each gets its own plan when picked up:

- **Trim V1's own fat:** audit `packages/opencode/src/session/` for dead/experimental modules (e.g. `soul.ts`, `judge/`) and unused paths.
- **Port V2 ideas that solve real V1 pain:** durable prompt admission (crash recovery), explicit provider-turn boundaries, context-epoch baseline caching — port one at a time into `@/session/*`, driven by observed bugs or profile data, not by ideology.
- **Session memory residency:** bound in-memory message/part graphs for long sessions (the 2 GB watchdog in `cli/heap.ts` exists for a reason).
- **LSP idle reaping:** language servers spawned via `touchFile` live until instance disposal; add an idle-timeout reaper mirroring the MCP one (long sessions accumulate LSP children).
- **ModelsDev light/heavy split:** keep schemas/pricing tables in `models-dev.ts`; move `Service`/`layer`/`node` + heavy imports to `models-dev/live.ts` so type-only consumers (e.g. `provider/model-status.ts`) stop paying the closure; optionally drop the EventV2 hard dep via `Effect.serviceOption`.
- **MCP execution-time respawn:** keep tool defs cached across idle reaps and respawn at tool-execution time instead of enumeration time; also covers the stale-captured-client window (reap lands between `SessionTools.resolve` and execute → one retryable ConnectionClosed today).
- **Finish the server-auth env rename (one source of truth):** ServerAuth.Config and Flag.OPENCODE*SERVER_PASSWORD/\_USERNAME now both accept OPENCHINACODE*_ with OPENCODE\__ fallback (identical precedence), and split-server spawn still exports both names for old-binary interop. Residual: pick the canonical name, drop the legacy fallback and the dual-env spawn in `cli/tui/server-proc.ts`. (The `@opencode-ai/server` half of this item was closed by Task 4.2's package deletion.)
- **Test env-var plumbing audit:** several test preloads/fixtures still set old `OPENCODE_*` names the fork renamed to `OPENCHINACODE_*` (only `OPENCHINACODE_DB` was fixed in `548f6fdcf`) — audit the rest.
- **httpapi-exercise harness:** still carries dead v2 scenarios (`v2.health.get`, credential, integration connect/attempt, event subscribe — routes that were not ported); clean up or delete.

---

## Execution strategy (agreed with user)

- Work happens in `../OpenChinaCode-surgery` on `memory-surgery` (or short per-task branches off it).
- Merge to `main` per phase, never mid-phase; `main` stays releasable.
- No upstream sync — `dev`/upstream tracking is abandoned per user decision. V2 is dropped; V1 is the refactor base.
- Every phase ends with: `bun typecheck` clean, package tests green, benchmark numbers recorded in the merge commit.
- **Every phase's verification must include a compiled-binary smoke test**, not just dev-path runs: `OPENCODE_APP_NAME=openchinacode-surgery bun run --cwd packages/opencode build --single --skip-install`, then boot the TUI and run a headless prompt with the artifact. Phase 1 proved dev mode and `bun build --compile` diverge: a latent `filesystem.ts ⇄ filesystem/search.ts` value-import cycle produced an undefined layer-node dependency only in the compiled bundle (fixed in b5c7e127f; guards added in cbed32437). Any future module-graph change can flip bundle chunk order the same way.
- A test binary built with `OPENCODE_APP_NAME=openchinacode-surgery` uses isolated XDG dirs (`~/.local/share/openchinacode-surgery` etc.); copy `auth.json` and `openchinacode.jsonc` from the official dirs to run it with real providers without touching the official install.
