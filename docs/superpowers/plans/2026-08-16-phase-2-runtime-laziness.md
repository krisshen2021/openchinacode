# Phase 2: Runtime Service-Graph Laziness Implementation Plan — ✅ COMPLETE (2026-08-16)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop paying for idle MCP child processes (~193 MB RSS each for playwright) by reaping idle local MCP servers and transparently respawning them on demand; remove the dead marked/shiki context; record investigation findings for LSP/ModelsDev.

**Architecture:** Child plan of `2026-08-16-memory-surgery.md` Phase 2, executed on branch `memory-surgery` in worktree `../OpenChinaCode-surgery`. All work happens ONLY in this worktree. NEVER touch `/home/kris/Projects/OpenChinaCode` (the user's production main).

**Tech Stack:** Bun 1.3, TypeScript, Effect 4.0-beta.

---

## Investigation findings (2026-08-16, four explore agents — settled, do not re-litigate)

1. **MCP:** local servers spawn on first `InstanceState.get(state)` (TUI boot triggers it via `command.list` + `mcp.status` + `experimental.resource.list`). The close→`failed/"Connection closed"`→`respawnClosed` revival machinery already exists and is battle-tested (playwright wrapper `--idle-timeout` self-exit uses it). Missing piece: a host-side reaper. Full deferral of spawn was rejected — `tools()` needs live handshakes for tool defs, and the model would never see the tools.
2. **LSP:** already lazy. `LSP.node` layer construction is a cheap `ScopedCache`; language servers spawn only via `touchFile`/`run` on first matching file. No boot change needed. Idle reaping of long-lived LSP servers deferred to Phase 5.
3. **shiki/marked:** `packages/ui/src/context/marked.tsx` already loads grammars per-language on demand AND has zero consumers anywhere in the repo (TUI uses OpenTUI tree-sitter). It is dead code — delete it.
4. **ModelsDev:** the +27 MB import probe attributes the _shared_ EventV2/Database/drizzle/platform-node subgraph to whichever module imports it first; models-dev.ts's own top level measures 0 MB once deps are warm, and the real server boot needs that subgraph regardless. Structural light/heavy split deferred to Phase 5. Only hygiene: drop the unused `FetchHttpClient` import specifier.

## Conventions to respect

- Run `bun typecheck` from the package dir (`packages/opencode`, `packages/core`, `packages/ui`), never `tsc`, never repo root. Tests run from `packages/opencode` dir only.
- Commits: conventional style, e.g. `feat(opencode): reap idle local MCP servers`.
- Style: no semicolons, no import aliases/star imports, early returns over `else`, `const` over `let`, avoid `any`, avoid `try`/`catch` in Effect code (use Effect error channels).
- Test rules (`packages/opencode/test/AGENTS.md`): use `testEffect`/`it.live`/`it.instance` from `test/lib/effect.ts` + fixtures from `test/fixture/fixture.ts`; NEVER use `Effect.sleep` to wait for concurrent work — use `pollWithTimeout` from `test/lib/effect.ts`.
- `Effect.sleep(reapInterval)` with a number is millis. `Effect.forkScoped` ties the fiber to the instance-state scope (state init already uses `Effect.addFinalizer` at `mcp/index.ts:567`, so a scope is present).

---

## Task 2.1: MCP idle-timeout reaping

**Behavior contract:** local (stdio) MCP servers that have been idle for `experimental.mcp_idle_timeout` ms (default 600000 = 10 min, matching the existing playwright-wrapper precedent; 0 disables) are closed by a per-instance reaper fiber. Closing goes through `closeMcpClient` WITHOUT pre-deleting state, so the existing `watch` onclose handler (`mcp/index.ts:479-491`) transitions the server to `failed/"Connection closed"` and publishes `ToolsChanged`, making it eligible for the existing `respawnClosed` (`mcp/index.ts:668-694`) transparent revival on the next `tools()`/`clients()`/prompt/resource call. Remote servers are never reaped.

**Files:**

- Modify: `packages/core/src/v1/config/config.ts` (experimental struct, after `mcp_timeout` at lines 213-215)
- Modify: `packages/opencode/src/mcp/index.ts` (State 142-148, state init 528-582, closeClient 584-591, storeClient 593-611, clients 632-635, respawnClosed 663-694, collectFromConnected 746-770, withClient 796-822, Interface 166-200, Service.of 1043-1063)
- Modify: `packages/opencode/src/session/tools.ts` (MCP execute wrapper, inner gen at lines 421-424)
- Modify: `packages/opencode/test/mcp/lifecycle.test.ts` (integration test, reuses its existing mock harness)
- Create: `packages/opencode/test/mcp/idle-reap.test.ts` (unit tests for the pure selection function)

- [x] **Step 1: config field**

In `packages/core/src/v1/config/config.ts`, immediately after the `mcp_timeout` field (lines 213-215):

```ts
      mcp_idle_timeout: Schema.optional(NonNegativeInt).annotate({
        description:
          "Idle timeout in milliseconds for local MCP servers (default: 600000). Idle servers are closed and transparently respawned on next use; 0 disables reaping",
      }),
```

Verify: `cd packages/core && bun typecheck` — clean.

- [x] **Step 2: State field + export**

In `packages/opencode/src/mcp/index.ts`:

- Change `interface State {` (line 142) to `export interface State {` and add a field:

```ts
export interface State {
  config: Record<string, ConfigMCPV1.Info>
  status: Record<string, Status>
  clients: Record<string, MCPClient>
  defs: Record<string, MCPToolDef[]>
  instructions: Record<string, string>
  lastUsedAt: Record<string, number>
}
```

- In the state initializer (lines 533-539) add `lastUsedAt: {}` to the object literal.

- [x] **Step 3: pure selection function (write failing unit test first)**

Create `packages/opencode/test/mcp/idle-reap.test.ts` with failing tests, then implement.

Test file:

```ts
import { describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { idleLocalServers } from "../../src/mcp/index"
import type { State } from "../../src/mcp/index"

function state(overrides: Partial<State>): State {
  return { config: {}, status: {}, clients: {}, defs: {}, instructions: {}, lastUsedAt: {}, ...overrides }
}

const client = {} as Client
const local = { type: "local" as const, command: ["true"] }
const remote = { type: "remote" as const, url: "https://example.com/mcp" }

describe("idleLocalServers", () => {
  const now = 1_000_000

  test("selects connected local server idle past timeout", () => {
    const s = state({
      clients: { pw: client },
      status: { pw: { status: "connected" } },
      lastUsedAt: { pw: now - 60_000 },
    })
    expect(idleLocalServers(s, { pw: local }, now, 30_000)).toEqual(["pw"])
  })

  test("skips recently used servers", () => {
    const s = state({
      clients: { pw: client },
      status: { pw: { status: "connected" } },
      lastUsedAt: { pw: now - 10_000 },
    })
    expect(idleLocalServers(s, { pw: local }, now, 30_000)).toEqual([])
  })

  test("skips remote servers", () => {
    const s = state({
      clients: { gh: client },
      status: { gh: { status: "connected" } },
      lastUsedAt: { gh: 0 },
    })
    expect(idleLocalServers(s, { gh: remote }, now, 30_000)).toEqual([])
  })

  test("skips non-connected servers", () => {
    const s = state({
      clients: { pw: client },
      status: { pw: { status: "failed", error: "Connection closed" } },
      lastUsedAt: { pw: 0 },
    })
    expect(idleLocalServers(s, { pw: local }, now, 30_000)).toEqual([])
  })

  test("runtime-added config in state takes precedence over file config", () => {
    const s = state({
      config: { pw: remote },
      clients: { pw: client },
      status: { pw: { status: "connected" } },
      lastUsedAt: { pw: 0 },
    })
    expect(idleLocalServers(s, { pw: local }, now, 30_000)).toEqual([])
  })

  test("missing lastUsedAt counts as never used", () => {
    const s = state({
      clients: { pw: client },
      status: { pw: { status: "connected" } },
    })
    expect(idleLocalServers(s, { pw: local }, now, 30_000)).toEqual(["pw"])
  })
})
```

Run: `cd packages/opencode && bun test test/mcp/idle-reap.test.ts` — expected FAIL (`idleLocalServers` not exported).

Then implement in `packages/opencode/src/mcp/index.ts`, at module level just before the `// --- Effect Service ---` comment (line 140):

```ts
export function idleLocalServers(
  s: State,
  configured: Record<string, ConfigMCPV1.Info>,
  now: number,
  idleTimeout: number,
) {
  return Object.keys(s.clients).filter((name) => {
    if (s.status[name]?.status !== "connected") return false
    const mcp = s.config[name] ?? configured[name]
    if (mcp.type !== "local" || mcp.enabled === false) return false
    return now - (s.lastUsedAt[name] ?? 0) >= idleTimeout
  })
}
```

Note: `configured` values passed in are filtered `ConfigMCPV1.Info` by the caller (the reaper skips non-configured entries before calling, or pass `cfg.mcp` entries through `isMcpConfigured` — simplest correct call is shown in Step 6; the test's `local`/`remote` literals satisfy the type).

Run the test again — expected PASS (6/6).

- [x] **Step 4: track usage (storeClient / closeClient / finalizer / watch)**

In `storeClient` (lines 593-611), after `s.clients[name] = client` add:

```ts
s.lastUsedAt[name] = Date.now()
```

In `closeClient` (lines 584-591), add `delete s.lastUsedAt[name]` next to the other deletes.

In the instance finalizer (lines 567-578), add `s.lastUsedAt = {}` next to the other resets.

In the `watch` onclose handler (lines 479-491), add `delete s.lastUsedAt[name]` next to the other deletes.

- [x] **Step 5: `touch` service method + respawn gap fixes**

Add to `Interface` (after `clients` at line 168):

```ts
  readonly touch: (clientName: string) => Effect.Effect<void>
```

Implement after the `clients` definition (line 635):

```ts
const clients = Effect.fn("MCP.clients")(function* () {
  const s = yield* InstanceState.get(state)
  yield* respawnClosed(s)
  return s.clients
})

const touch = Effect.fn("MCP.touch")(function* (clientName: string) {
  const s = yield* InstanceState.get(state)
  s.lastUsedAt[clientName] = Date.now()
})
```

(That is the existing `clients` with the one `yield* respawnClosed(s)` line added — `respawnClosed` is declared later at line 668 but only referenced inside closures that run after layer construction, so this is valid.)

In `collectFromConnected` (line 753, first line inside `Effect.gen(function* () {`), add before the `cfg` read:

```ts
yield * respawnClosed(s)
```

In `withClient` (lines 796-822), after `const s = yield* InstanceState.get(state)` add:

```ts
yield * respawnClosed(s)
s.lastUsedAt[clientName] = Date.now()
```

Add `touch` to the `Service.of({...})` literal (lines 1043-1063), after `clients,`.

- [x] **Step 6: reaper fiber in state init**

In the state init closure, immediately after the connect-all `Effect.forEach` block ends (after line 565) and before `yield* Effect.addFinalizer(...)` (line 567), insert:

```ts
// OPENCODE_MCP_REAP_INTERVAL (ms) overrides the 30s tick; test/ops knob.
const reapInterval = Number(process.env.OPENCODE_MCP_REAP_INTERVAL) || 30_000
yield *
  Effect.gen(function* () {
    const cfg = yield* cfgSvc.get()
    const idleTimeout = cfg.experimental?.mcp_idle_timeout ?? 600_000
    if (idleTimeout <= 0) return
    const now = Date.now()
    const configured = Object.fromEntries(
      Object.entries(cfg.mcp ?? {}).filter((entry): entry is [string, ConfigMCPV1.Info] => isMcpConfigured(entry[1])),
    )
    for (const name of idleLocalServers(s, configured, now, idleTimeout)) {
      const client = s.clients[name]
      if (!client) continue
      yield* Effect.logInfo("closing idle MCP server", { server: name })
      // Do not delete state here: the client's onclose handler transitions
      // the server to failed/"Connection closed", making it eligible for
      // transparent respawn via respawnClosed.
      yield* closeMcpClient(name, client)
    }
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("MCP idle reaper tick failed", { cause: String(cause) })),
    Effect.andThen(Effect.sleep(reapInterval)),
    Effect.forever,
    Effect.forkScoped,
  )
```

- [x] **Step 7: touch on MCP tool execution**

In `packages/opencode/src/session/tools.ts`, in the MCP tool execute wrapper's inner gen (lines 421-424), before `yield* ctx.ask(...)`:

```ts
if (entry.clientName) yield * mcp.touch(entry.clientName)
```

Do NOT touch in `tools()` itself — it runs every prompt step and would defeat idleness.

- [x] **Step 8: typecheck**

Run: `cd packages/opencode && bun typecheck` — clean.

- [x] **Step 9: integration test in lifecycle.test.ts (reap → respawn cycle)**

Read `packages/opencode/test/mcp/lifecycle.test.ts` first — it mocks `@modelcontextprotocol/sdk/client/*` with a `clientStates` map tracking `closed`, `listToolsCalls`, etc. Find how existing tests simulate a connection close (search for `onclose` / `"Connection closed"` in that file) and how they build the MCP layer with a local stdio server config.

Add a test to that file:

- Configure a local stdio server (as existing local-server tests do) plus `experimental: { mcp_idle_timeout: 1 }` in the config.
- Set `process.env.OPENCODE_MCP_REAP_INTERVAL = "100"` before the MCP state initializes (restore in a finally/afterEach).
- Connect/await `status()` shows `connected` (use existing harness patterns).
- Use `pollWithTimeout` from `test/lib/effect.ts` to wait until the mock client's `closed` flag is true (the reaper fired). NEVER `Effect.sleep` to wait.
- If the mock's `close()` does not fire the `onclose` handler the service registered, fire it the way existing close-simulation tests do.
- Assert `status()` now reports `{ status: "failed", error: "Connection closed" }`.
- Call `tools()`; assert the server was respawned (a new mock client connected / `listToolsCalls` incremented) and the returned map contains that server's tools.

Run: `cd packages/opencode && bun test test/mcp/lifecycle.test.ts test/mcp/idle-reap.test.ts` — all green.

- [x] **Step 10: full mcp test suite + commit**

Run: `cd packages/opencode && bun test test/mcp/ test/server/httpapi-mcp.test.ts` — all green (no regressions in oauth/session-recovery neighbors).

```bash
git add packages/core/src/v1/config/config.ts packages/opencode/src/mcp/index.ts packages/opencode/src/session/tools.ts packages/opencode/test/mcp/
git commit -m "feat(opencode): reap idle local MCP servers"
```

---

## Task 2.2: delete dead marked/shiki context + prune ui deps

**Files:**

- Delete: `packages/ui/src/context/marked.tsx`
- Modify: `packages/ui/package.json` (dependencies + devDependencies, only entries with zero remaining importers)

- [x] **Step 1: re-verify zero consumers**

From the worktree root, run and confirm each prints nothing outside `marked.tsx` itself:

```bash
rg -l "useMarked|MarkedProvider|context/marked" packages/
```

Expected: only `packages/ui/src/context/marked.tsx` (or zero lines). If any real consumer appears, STOP and report — do not delete.

- [x] **Step 2: audit which deps become unused**

Run from worktree root:

```bash
for dep in katex marked marked-shiki shiki marked-katex-extension @shikijs/transformers @shikijs/stream; do
  echo "== $dep"; rg -l "from \"${dep}[\"/]" packages/ui/src packages/tui/src packages/app/src 2>/dev/null
done
```

Known upfront: `@pierre/diffs` stays (used by `packages/ui/src/custom-elements.d.ts:1` and `packages/ui/src/context/worker-pool.tsx:1` — do not remove). Record which of the seven audited deps have zero remaining importers.

- [x] **Step 3: delete + prune**

```bash
rm packages/ui/src/context/marked.tsx
```

In `packages/ui/package.json` remove ONLY the deps confirmed unused in Step 2 (candidates: `katex`, `marked`, `marked-shiki`, `shiki`, `marked-katex-extension`, `@types/katex` from devDependencies; keep `@shikijs/*` if still referenced by `v2/` components). Also remove `@types/katex` only if `katex` goes.

Run: `bun install` (from worktree root).

- [x] **Step 4: typecheck**

Run: `cd packages/ui && bun typecheck` then `cd packages/tui && bun typecheck` — both clean.

- [x] **Step 5: commit**

```bash
git add packages/ui/package.json packages/ui/src/context/marked.tsx bun.lock
git commit -m "chore(ui): remove dead marked/shiki context"
```

---

## Task 2.3: models-dev hygiene + record findings

**Files:**

- Modify: `packages/core/src/models-dev.ts:3` (drop unused `FetchHttpClient` specifier from the `effect/unstable/http` import — verify with `rg FetchHttpClient packages/core/src/models-dev.ts` that it appears only in the import)
- Modify: `docs/superpowers/plans/2026-08-16-memory-surgery.md` (Phase 2 section → point to this child plan and record the four findings; Phase 5 candidates → add "LSP idle reaping for long-lived servers", "ModelsDev light/heavy module split", "MCP execution-time respawn that keeps defs cached across idle reaps")

- [x] **Step 1: edit + typecheck**

Remove the specifier; run `cd packages/core && bun typecheck` — clean.

- [x] **Step 2: doc updates**

Apply the two plan-doc edits above. Keep them short.

- [x] **Step 3: commit**

```bash
git add packages/core/src/models-dev.ts docs/superpowers/plans/
git commit -m "chore(core): drop unused FetchHttpClient import"
```

---

## Task 2.4: Phase 2 verification gate

- [x] **Step 1: typecheck + tests**

```bash
cd packages/opencode && bun typecheck && bun test test/mcp/
```

- [x] **Step 2: CLI bench**

```bash
bun run script/bench-rss.ts
```

Record both rows; `--help` should still be ~144 MB (Phase 1 result — no regression).

- [x] **Step 3: compiled-binary smoke (MANDATORY — dev path cannot catch bundle-order issues)**

Build (background, ~3-4 min):

```bash
cd packages/opencode && OPENCODE_APP_NAME=openchinacode-surgery bun run build --single --skip-install
```

Binary: `packages/opencode/dist/openchinacode-linux-x64/bin/openchinacode` (already symlinked as `~/.local/bin/openchinacode-test`).

Set `experimental.mcp_idle_timeout: 60000` in `~/.local/share/openchinacode-surgery/openchinacode.jsonc` (keep the real playwright MCP entry).

Then, in a scratch dir with a playwright MCP configured (e.g. `~/Projects/aiwallpaper`):

1. `tmux new-session -d -s p2gate 'cd ~/Projects/aiwallpaper && ~/.local/bin/openchinacode-test'` — boot TUI.
2. After ~15 s: `pgrep -af playwright | grep -v tmux` — playwright MCP child IS running (boot connect preserved).
3. Note main-process RSS from `/proc/<pid>/status` VmRSS — expect ≤ ~500 MB (Phase 1 compiled baseline was 449 MB).
4. Wait ~100 s (past the 60 s idle timeout + 30 s tick): playwright child IS GONE.
5. `~/.local/bin/openchinacode-test run "say hi"` in the same dir — a prompt forces `mcp.tools()` → playwright child respawns (`pgrep -af playwright` shows it again).
6. Kill the tmux session; kill leftover MCP children by ppid. Restore `mcp_idle_timeout` in the surgery config to its previous value (or remove the override).

- [x] **Step 4: record results + commit**

Fill the checkboxes in this file and the Phase 2 section of `2026-08-16-memory-surgery.md` with the measured numbers, then:

```bash
git add docs/superpowers/plans/
git commit -m "docs: record phase 2 verification results"
```

**Phase 2 merge to `main` is NOT part of this plan** — the user holds that decision until the surgery binary proves itself in daily use.

---

## Verification results (2026-08-16, all gates passed)

**Commits:** `248e5dd06` feat (reaper) · `e86d6f305` fix (NonNegativeInt + boot grace + sdk gen) · `f0d17f275` fix (hardening: interrupt propagation, interval clamp, missing-config guard, TOCTOU re-check, codemode touch, TUI neutral "Connection closed" rendering, +3 tests) · `95b95207ab` chore (delete marked.tsx + prune 6 ui deps) · `3ee7b21ec` chore (FetchHttpClient + catalog scrub + findings).

**Tests/typecheck:** `bun test test/mcp/ test/server/httpapi-mcp.test.ts test/tool/code-mode.test.ts` 125/125 green; typecheck clean in `packages/core`, `packages/opencode`, `packages/ui`, `packages/tui`. Both spec and quality review passed per task (quality re-review after hardening: "ready to merge").

**CLI bench:** `--help` peak 147 MB, `models --help` 137 MB (Phase 1: 144 MB — no regression).

**Compiled-binary smoke** (`0.0.0-memory-surgery-202608160631`, `OPENCODE_APP_NAME=openchinacode-surgery`, aiwallpaper dir, config `experimental.mcp_idle_timeout: 60000`, playwright local via wrapper + miro remote):
- TUI boot idle main-process RSS **455 MB** (gate ≤ 500 MB ✓; Phase 1 compiled baseline 449 MB).
- playwright MCP child present at boot (~193 MB) — boot connect preserved ✓
- after ~75 s idle (60 s timeout + ≤30 s tick): playwright child **reaped, 0 idle MCP children** ✓; main RSS steady 455 MB
- `hi` sent via tmux into the TUI: playwright child **transparently respawned** (new pid), prompt cycle healthy (DeepSeek V4 Flash answered, 20.7K tokens ¥0.01, cache fine)
- miro (remote) never reaped, as designed
- cleanup verified: no leftover surgery processes; production instances (main branch) untouched throughout
