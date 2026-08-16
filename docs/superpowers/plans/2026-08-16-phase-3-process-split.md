# Phase 3: TUI/Backend Process Split Implementation Plan — ✅ COMPLETE (2026-08-16)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** The default `openchinacode` TUI launch spawns (or reuses) a SEPARATE headless server process and attaches over localhost HTTP+SSE, instead of hosting the backend in a worker thread. The in-process worker stays behind `--in-process`.

**Architecture:** Child plan of `2026-08-16-memory-surgery.md` Phase 3, on branch `memory-surgery` in worktree `../OpenChinaCode-surgery`. ALL work in this worktree only. NEVER touch `/home/kris/Projects/OpenChinaCode`.

**Honest expectation (state in docs/commit):** for a single TUI the TOTAL memory is roughly unchanged (the backend graph moves to its own process). The wins: (1) N TUIs/projects share ONE server, (2) sessions survive TUI exit/restart/crash, (3) TUI process RSS drops ~200 MB (no backend module graph), (4) structure ready for Phase 5.

**Tech Stack:** Bun 1.3, TypeScript, Effect 4.0-beta, yargs.

---

## Investigation findings (2026-08-16, two explore agents — settled)

1. **TUI↔backend transport is already HTTP-shaped.** `tui.ts:211-246`: worker thread hosts the full HttpApi (`worker.ts:31-49` RPC-bridged fetch); but when `--port/--hostname/--mdns` is passed, the TUI already runs pure HTTP+SSE (`{url, fetch: undefined, events: undefined}`), and the (unregistered) `attach` command (`cli/cmd/attach.ts`) is a working pure-HTTP reference. Event parity: worker `global.event` RPC ↔ SSE `GET /global/event` (handlers/global.ts:36-57), same GlobalBus source; SSE reconnect/backoff exists in `packages/tui/src/context/sdk.tsx:82-117`.
2. **`serve`/`attach` exist but are NOT registered** in `packages/opencode/src/index.ts:70-79` (fork注销). Today `openchinacode serve` mis-parses as TUI with `project="serve"`. Upstream registers them. Some pre-existing `test/cli` failures wait on these commands — registering may flip them green.
3. **`serve` is already lazy** (`serve.ts:13-14` dynamic imports in handler) and multi-tenant (`instance: false`; per-request `x-opencode-directory` header, middleware/workspace-routing.ts:86-88). Port: tries 4096 then random (server.ts:117-122). Prints `opencode server listening on http://...` (serve.ts:20).
4. **Auth:** HTTP Basic via `OPENCODE_SERVER_PASSWORD`/`_USERNAME` env; password unset = auth disabled (middleware/authorization.ts:104). `ServerAuth.headers({password})` builds client headers (`src/server/auth.ts:44-48`). `?auth_token=` query fallback exists for SSE/WS.
5. **No discovery/reuse exists** — no registry/port file anywhere. `GET /global/health` → `{healthy, version}` is the probe.
6. **Worker-RPC-only features needing a split-mode answer:** `reload` (SIGUSR2 → config invalidate + dispose all instances) and heap `snapshot` (server half RPC-only). `shutdown`/`server` RPCs are replaced by process spawn/leave-running. `checkUpgrade` RPC is dead code (leave it alone).
7. **TUI never uses PTY/multipart** — images are inlined data-URLs. No protocol gaps.
8. **Memory:** the ~190 MB backend module graph lives in the worker isolate (server routes statically import 164 backend modules). `packages/tui` itself imports NO backend src (only `@opencode-ai/core` subsets, sdk, plugin, ui).
9. **Do NOT add HTTP endpoints** — that forces SDK regen (`bun run generate`), which currently surfaces large pre-existing drift. Reuse existing routes only.

## Conventions

- `bun typecheck`/`bun test` from `packages/opencode` (or the relevant package dir), never repo root.
- Commits: conventional style. No semicolons, no import aliases/star imports, early returns, `const` over `let`, avoid `any`.
- AGENTS.md: dynamic imports for heavy modules in startup-sensitive paths, destructure at top of handler; no `(await import()).member` chains.
- Tests: `testEffect`/`it.live`/`it.instance` from `test/lib/effect.ts`, fixtures from `test/fixture/fixture.ts`, no `Effect.sleep` for readiness (use `pollWithTimeout`); read `packages/opencode/test/AGENTS.md` first.
- CLI bench gate: `bun run script/bench-rss.ts` from worktree root — `--help` must stay ≤ ~150 MB (Phase 2 result: 147 MB).

---

## Task 3.1: register `serve` + `attach` commands

**Files:**
- Modify: `packages/opencode/src/index.ts` (command registration, lines 70-79)

- [x] **Step 1: measure before**

Run `bun run script/bench-rss.ts` from worktree root; record (`--help` expect ~147 MB).

- [x] **Step 2: register**

In `packages/opencode/src/index.ts` add `ServeCommand` and `AttachCommand` imports + `.command(...)` entries, following the exact pattern of the existing registrations. Do NOT register `acp`/`web` (out of scope).

- [x] **Step 3: verify no bench regression**

Re-run the bench. If `--help` regresses by >5 MB, find which static import chain is responsible (`serve.ts` top imports `../effect-cmd`; check whether `effect-cmd.ts` statically pulls `app-runtime`) and restructure so the heavy path stays handler-time (e.g. convert to plain `cmd` with the effect machinery dynamically imported inside the handler, mirroring how other lazified commands look after Phase 1). Repeat until regression ≤5 MB.

- [x] **Step 4: smoke + tests**

```bash
bun run --conditions=browser packages/opencode/src/index.ts serve --help
bun run --conditions=browser packages/opencode/src/index.ts attach --help
bun run --conditions=browser packages/opencode/src/index.ts --help
```

All print help; `serve`/`attach` appear in the root help. Then `cd packages/opencode && bun test test/cli` — report which previously-failing tests (the ones waiting on unregistered `serve`/`attach`) now pass; do NOT chase unrelated pre-existing failures (29 known at baseline, mostly acp/serve/web orphans).

- [x] **Step 5: commit**

```bash
git add packages/opencode/src/index.ts
git commit -m "feat(opencode): register serve and attach commands"
```

---

## Task 3.2: server registry (discoverability for reuse)

A per-app-identity registry file at `Global.Path.data/server.json` (already app-scoped: `openchinacode` vs `openchinacode-surgery` never collide). Written by `serve` on successful listen, removed on clean exit. Mode 0600 (may carry the Basic-auth password).

**Files:**
- Create: `packages/opencode/src/server/registry.ts`
- Modify: `packages/opencode/src/cli/cmd/serve.ts`
- Create: `packages/opencode/test/server/registry.test.ts`

- [x] **Step 1: failing tests first**

Create `test/server/registry.test.ts` (plain `bun:test` + `tmpdir()` fixture is fine; no Effect services needed if the module is pure functions taking a directory):

```ts
import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { ServerRegistry } from "../../src/server/registry"

describe("ServerRegistry", () => {
  test("write then read round-trips the entry", async () => {
    await using tmp = await tmpdir()
    const entry = { pid: 1234, url: "http://127.0.0.1:4096", version: "1.2.3", password: "secret", startedAt: Date.now() }
    await ServerRegistry.write(tmp.path, entry)
    expect(await ServerRegistry.read(tmp.path)).toEqual(entry)
  })

  test("read returns undefined for missing file", async () => {
    await using tmp = await tmpdir()
    expect(await ServerRegistry.read(tmp.path)).toBeUndefined()
  })

  test("read returns undefined for corrupt json", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "server.json"), "{nope")
    expect(await ServerRegistry.read(tmp.path)).toBeUndefined()
  })

  test("remove deletes the file and is idempotent", async () => {
    await using tmp = await tmpdir()
    await ServerRegistry.write(tmp.path, { pid: 1, url: "http://127.0.0.1:1", version: "x", startedAt: 0 })
    await ServerRegistry.remove(tmp.path)
    await ServerRegistry.remove(tmp.path)
    expect(await ServerRegistry.read(tmp.path)).toBeUndefined()
  })

  test("alive detects pids", () => {
    expect(ServerRegistry.alive(process.pid)).toBe(true)
    expect(ServerRegistry.alive(2 ** 22)).toBe(false)
  })

  test("registry file is owner-only", async () => {
    await using tmp = await tmpdir()
    await ServerRegistry.write(tmp.path, { pid: 1, url: "http://127.0.0.1:1", version: "x", startedAt: 0 })
    const stat = await Bun.file(path.join(tmp.path, "server.json")).stat()
    expect(stat.mode & 0o777).toBe(0o600)
  })
})
```

Run: `cd packages/opencode && bun test test/server/registry.test.ts` — expected FAIL (module missing).

- [x] **Step 2: implement `src/server/registry.ts`**

```ts
import path from "path"
import { chmod, rm } from "node:fs/promises"

export interface Entry {
  pid: number
  url: string
  version: string
  password?: string
  startedAt: number
}

const file = (dir: string) => path.join(dir, "server.json")

async function read(dir: string): Promise<Entry | undefined> {
  const json = await Bun.file(file(dir))
    .json()
    .catch(() => undefined)
  if (!json || typeof json.pid !== "number" || typeof json.url !== "string" || typeof json.version !== "string") {
    return undefined
  }
  return json as Entry
}

async function write(dir: string, entry: Entry) {
  await Bun.write(file(dir), JSON.stringify(entry))
  await chmod(file(dir), 0o600).catch(() => {})
}

async function remove(dir: string) {
  await rm(file(dir), { force: true }).catch(() => {})
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const ServerRegistry = { read, write, remove, alive }
```

Note: follow the repo self-export pattern used in sibling modules (check `src/server/auth.ts` for the local convention — if it uses named exports + `export * as X from` elsewhere, match that instead of the const-object). Run the tests — green.

- [x] **Step 3: serve writes/removes the registry**

In `packages/opencode/src/cli/cmd/serve.ts` handler, after `Server.listen` resolves and the listening line prints:

```ts
    const { Global } = yield* Effect.promise(() => import("@opencode-ai/core/global"))
    const { Installation } = yield* Effect.promise(() => import("@opencode-ai/core/installation"))
    const { ServerRegistry } = yield* Effect.promise(() => import("../../server/registry"))
    if (!process.env.OPENCODE_SKIP_REGISTRY) {
      const password = Flag.OPENCODE_SERVER_PASSWORD
      yield* Effect.promise(() =>
        ServerRegistry.write(Global.Path.data, {
          pid: process.pid,
          url: `http://${server.hostname}:${server.port}`,
          version: Installation.VERSION,
          password,
          startedAt: Date.now(),
        }),
      )
      // Signal handlers (not process.on("exit")) so the async removal completes.
      const shutdown = () =>
        ServerRegistry.remove(Global.Path.data).finally(() => process.exit(0))
      process.once("SIGINT", shutdown)
      process.once("SIGTERM", shutdown)
    }
```

Note: a crashed/killed -9 server leaves a stale registry — the TUI-side reuse logic (Task 3.3) detects that via `alive()` + health probe, so no other cleanup path is needed.

IMPORTANT: verify the real export names before writing — `Installation.VERSION` vs `InstallationVersion` constant, and the exact module specifier (`@opencode-ai/core/installation`); look at how `models-dev.ts:18` and the build script reference version/channel and match that. `Flag.OPENCODE_SERVER_PASSWORD` — check `packages/core/src/flag/flag.ts` for the exact name (serve.ts:15 already uses it). `password` field: include only when set (don't write `password: undefined` — build the object conditionally per repo style).

- [x] **Step 4: typecheck + tests + smoke**

`cd packages/opencode && bun typecheck` clean; `bun test test/server/registry.test.ts` green; then:

```bash
rm -f ~/.local/share/openchinacode-surgery/server.json
OPENCODE_APP_NAME=openchinacode-surgery bun run --conditions=browser packages/opencode/src/index.ts serve &
sleep 6; cat ~/.local/share/openchinacode-surgery/server.json; kill %1; sleep 1
test -f ~/.local/share/openchinacode-surgery/server.json && echo "REGISTRY NOT CLEANED" || echo "registry cleaned"
```

Registry appears with correct pid/url/version, vanishes on SIGTERM.

- [x] **Step 5: commit**

```bash
git add packages/opencode/src/server/registry.ts packages/opencode/src/cli/cmd/serve.ts packages/opencode/test/server/registry.test.ts
git commit -m "feat(opencode): register listening server in data dir"
```

---

## Task 3.3: TUI spawn-or-reuse (the split itself)

**Files:**
- Create: `packages/opencode/src/cli/tui/server-proc.ts`
- Modify: `packages/opencode/src/cli/cmd/tui.ts` (builder + handler transport selection lines 211-246, SIGUSR2 213-216, stop 218-225, onSnapshot 269-273)
- Create: `packages/opencode/test/cli/tui-server-proc.test.ts`

**Behavior contract:**
- Default (no flags): reuse a healthy same-version registry entry (alive pid + `/global/health` ok with its auth); otherwise spawn `serve` as a detached child with a generated throwaway `OPENCODE_SERVER_PASSWORD`, wait for ITS registry entry (poll, 15 s timeout), health-probe, attach. On TUI exit the server is LEFT RUNNING (sessions survive).
- `--in-process`: today's worker-thread behavior, unchanged (including `--port` worker-listener semantics).
- Default + network flags (`--port/--hostname/--mdns`): spawn a DEDICATED child with those args + `OPENCODE_SKIP_REGISTRY=1` (never clobbers the shared registry); attach to its URL; still left running on exit.
- Version mismatch or dead pid or failed health → SIGTERM the stale pid (same app identity only — registry is per-app data dir), wait ≤3 s, spawn fresh.
- Spawn failure/timeout → `UI.error` + non-zero exit (no silent worker fallback).

- [x] **Step 1: failing tests for the pure helpers**

`test/cli/tui-server-proc.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { spawnArgs, reusable } from "../../src/cli/tui/server-proc"

describe("spawnArgs", () => {
  test("compiled build spawns self with serve", () => {
    expect(spawnArgs({ execPath: "/bin/openchinacode", compiled: true })).toEqual(["/bin/openchinacode", "serve"])
  })

  test("dev build spawns bun run on the repo index", () => {
    const args = spawnArgs({ execPath: "/usr/bin/bun", compiled: false, indexTs: "/repo/packages/opencode/src/index.ts" })
    expect(args).toEqual(["/usr/bin/bun", "run", "--conditions=browser", "/repo/packages/opencode/src/index.ts", "serve"])
  })

  test("network flags are forwarded", () => {
    expect(
      spawnArgs({ execPath: "/bin/oc", compiled: true, network: ["--port", "4200"] }),
    ).toEqual(["/bin/oc", "serve", "--port", "4200"])
  })
})

describe("reusable", () => {
  const entry = { pid: 1, url: "http://127.0.0.1:4096", version: "1", startedAt: 0 }

  test("same version + healthy = reuse", () => {
    expect(reusable(entry, "1", () => true, () => true)).toBe(true)
  })
  test("version mismatch = no reuse", () => {
    expect(reusable(entry, "2", () => true, () => true)).toBe(false)
  })
  test("dead pid = no reuse", () => {
    expect(reusable(entry, "1", () => false, () => true)).toBe(false)
  })
  test("unhealthy = no reuse", () => {
    expect(reusable(entry, "1", () => true, () => false)).toBe(false)
  })
  test("missing entry = no reuse", () => {
    expect(reusable(undefined, "1", () => true, () => true)).toBe(false)
  })
})
```

Run — FAIL (module missing).

- [x] **Step 2: implement `src/cli/tui/server-proc.ts`**

Contents (adjust names to repo reality; keep the pure helpers exported for tests):

```ts
import { Global } from "@opencode-ai/core/global"
import { ServerRegistry } from "@/server/registry"
import type { Entry } from "@/server/registry"

export function spawnArgs(opts: { execPath: string; compiled: boolean; indexTs?: string; network?: string[] }) {
  const base = opts.compiled
    ? [opts.execPath, "serve"]
    : [opts.execPath, "run", "--conditions=browser", opts.indexTs!, "serve"]
  return [...base, ...(opts.network ?? [])]
}

export function reusable(
  entry: Entry | undefined,
  version: string,
  alive: (pid: number) => boolean,
  healthy: () => boolean,
) {
  if (!entry) return false
  if (entry.version !== version) return false
  if (!alive(entry.pid)) return false
  return healthy()
}
```

Plus the effectful `ensureServer(opts): Promise<{ url: string; headers: Record<string, string>; spawned: boolean; pid: number }>`:
1. `entry = await ServerRegistry.read(Global.Path.data)`; probe health FIRST: `const healthOk = await fetch(entry.url + "/global/health", { headers: ServerAuth.headers({ password: entry.password }), signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false)` (only when entry exists).
2. If `reusable(entry, VERSION, ServerRegistry.alive, () => healthOk)` → return attached-to-existing. (`reusable` stays sync/pure; the awaited probe result is captured in the closure.)
3. If entry exists but not reusable → `process.kill(entry.pid, "SIGTERM")` (guard errors), poll `!alive(pid)` ≤3 s.
4. Generate `password` (16 random bytes hex), build argv via `spawnArgs` (compiled = `typeof OPENCODE_WORKER_PATH !== "undefined"`; dev indexTs = `fileURLToPath(new URL("../../index.ts", import.meta.url))` — verify this resolves to `src/index.ts` from `src/cli/tui/`), `Bun.spawn(argv, { env: { ...process.env, OPENCODE_SERVER_PASSWORD: password, ...skipRegistryEnv }, stdin: "ignore", stdout: "pipe", stderr: "pipe" })`; drain both streams in background (append to a log file under `Global.Path.log` or just discard — prevent pipe backpressure).
5. Poll `ServerRegistry.read` every 100 ms ≤15 s for `entry.pid === child.pid`; then health-probe with the generated password; on timeout kill child + throw.
6. Return `{ url, headers: ServerAuth.headers({ password }), spawned: true, pid: child.pid }`.

For the dedicated-spawn (network flags) case: skip steps 1-3, pass `OPENCODE_SKIP_REGISTRY: "1"` in env, and since no registry entry is written, read the port from the child's stdout `listening on http://...` line OR pass an explicit pre-picked free port. Pick whichever is simpler; document the choice in code. Build the forwarded network args inline from `args` (`--port`, `--hostname`, `--mdns`, `--mdns-domain`, `--cors` — only those actually set; no helper extraction needed).

For `InstallationVersion`/version: use the same module the codebase already uses for version identity (check `src/server/routes/instance/httpapi/groups/global.ts` health handler — reuse its version source so TUI and server always agree).

- [x] **Step 3: wire into `tui.ts`**

- Builder: add

```ts
      .option("in-process", {
        type: "boolean",
        describe: "host the server in a worker thread instead of a separate process",
        default: false,
      })
```

- Handler, replacing the worker-only block (current lines 211-246). Restructure with early returns so there are NO non-null assertions (`client!`) — e.g. extract the worker-mode branch into a local block that owns its own `worker`/`client` bindings. Shape:

```ts
      const network = resolveNetworkOptionsNoConfig(args)
      const external = hasArg("--port") || hasArg("--hostname") || network.mdns === true
      const inProcess = args["in-process"] === true

      if (inProcess) {
        // existing worker path verbatim: spawn worker, Rpc.client, transport
        // selection (including the external-listener sub-branch), SIGUSR2 reload
        // RPC, stop() with shutdown RPC + terminate, dual heapsnapshot
      }
      // split mode (default):
      const { ensureServer } = await import("../tui/server-proc")
      const server = await ensureServer({
        network: external ? <forwarded network args from args> : undefined,
      })
      const transport = { url: server.url, fetch: undefined, events: undefined, headers: server.headers }
```

Keep the shared tail (validateSession + run(...)) common to both branches; only `transport`, the SIGUSR2 `reload`, `stop()`, and `onSnapshot` differ. If the cleanest expression is a small local function per mode returning `{ transport, reload, stop, onSnapshot }`, do that — one level of indirection max, no new files.

- SIGUSR2 reload: in split mode use HTTP (verify exact routes/methods first — `handlers/config.ts` for config invalidate, `groups/global.ts` for dispose):

```ts
      const reload = () => {
        void fetch(`${transport.url}/config/invalidate`, { method: "POST", headers: transport.headers }).catch(() => {})
        void fetch(`${transport.url}/global/dispose`, { method: "POST", headers: transport.headers }).catch(() => {})
      }
```

(The worker branch keeps its existing RPC reload.) If `/config/invalidate` turns out not to exist, keep only the dispose call and note it in the report.

- `stop()`: split mode = just remove the SIGUSR2 listener and return (leave server running); in-process path unchanged (`shutdown` RPC + terminate).

- `onSnapshot`: split mode returns `[writeHeapSnapshot("tui.heapsnapshot")]` only (comment: server snapshot unavailable in split mode); in-process unchanged.

- Child-death monitor (split mode): `child.exited.then(code => ...)` — if the TUI is still running, `console.error` a warning that the server died and sessions are unavailable (SSE backoff already surfaces disconnects in UI). Do not auto-respawn mid-session in v1.

- [x] **Step 4: typecheck + tests**

`cd packages/opencode && bun typecheck` clean; `bun test test/cli/tui-server-proc.test.ts test/server/registry.test.ts` green; `bun run script/bench-rss.ts` no regression (>5 MB) since the new module must only be dynamically imported in the handler.

- [x] **Step 5: dev-mode smoke**

```bash
cd ~/Projects/aiwallpaper  # any project dir
OPENCODE_APP_NAME=openchinacode-surgery bun run --conditions=browser /home/kris/Projects/OpenChinaCode-surgery/packages/opencode/src/index.ts
```

TUI boots, works; `pgrep -af "serve"` shows the child server; Ctrl-q; server still alive. Then `--in-process` boots with NO serve child. Kill the leftover server (`kill <pid>`).

- [x] **Step 6: commit**

```bash
git add packages/opencode/src/cli/tui/server-proc.ts packages/opencode/src/cli/cmd/tui.ts packages/opencode/test/cli/tui-server-proc.test.ts
git commit -m "feat(opencode): default TUI to a split server process"
```

---

## Task 3.4: Phase 3 verification gate

- [x] **Step 1: typecheck + tests**

```bash
cd packages/opencode && bun typecheck && bun test test/cli test/server/registry.test.ts test/mcp/
cd packages/tui && bun typecheck
```

- [x] **Step 2: bench** — `bun run script/bench-rss.ts`; `--help` ≤ ~150 MB.

- [x] **Step 3: compiled-binary smoke (MANDATORY)**

```bash
cd packages/opencode && OPENCODE_APP_NAME=openchinacode-surgery bun run build --single --skip-install
```

Then in `~/Projects/aiwallpaper` (or a scratch dir):

1. Remove any stale `~/.local/share/openchinacode-surgery/server.json`; ensure no leftover surgery `serve` process.
2. `tmux new-session -d -s p3gate 'cd ~/Projects/aiwallpaper && ~/.local/bin/openchinacode-test'`
3. After ~15 s: TWO processes — TUI (`openchinacode-test`) + `serve` child. Record both VmRSS from `/proc/<pid>/status`. Expect TUI ≤ ~250 MB (Phase 2: 455 MB with in-process backend), server ≤ ~400 MB.
4. Sidebar memory display (`ctrl+x b`) now shows the TUI process only — note the new meaning in the report.
5. Send `hi` via `tmux send-keys`, confirm the model responds (full prompt cycle over HTTP+SSE).
6. Kill the TUI (`tmux kill-session -t p3gate`): the `serve` process MUST still be alive; `server.json` still present.
7. Relaunch the TUI: it must REUSE the same serve pid (compare pids), boot faster, and `--continue` the session from step 5 must show the prior conversation (sessions survive).
8. Kill the serve process while the TUI is up: TUI shows the disconnect/warning, doesn't crash.
9. Cleanup: kill tmux session + serve child; verify no orphans (`pgrep -af openchinacode-surgery`).

- [x] **Step 4: record + commit**

Fill this plan's results section (RSS numbers, before/after) and update `2026-08-16-memory-surgery.md` Phase 3 section; mark checkboxes.

```bash
git add docs/superpowers/plans/
git commit -m "docs: record phase 3 verification results"
```

**Merging Phase 3 to `main` is NOT part of this plan** — the user holds that decision.

---

## Verification results (2026-08-16, all gates passed)

**Commits:** `44ff05768` feat (register serve/attach) · `3c4d036fb` feat (server registry) · `5b5e90b5c` feat (split) · `d9b5e3cd4` fix (ownership race + auth env align) · `a9b50c02e` fix (spawn convergence + lifecycle hardening) · `a2b8e60de` fix (portless-dedicated sentinel). Three review rounds per task; final verdict "ready".

**Tests/typecheck:** `test/cli/tui-server-proc` 13 + `test/server/registry` 7 + `test/mcp` 83 green; typecheck clean in `packages/opencode` + `packages/tui`. CLI bench: `--help` 144 MB (no regression). Bonus: registering serve/attach flipped 12 pre-existing `test/cli` failures to pass.

**Compiled-binary smoke** (`0.0.0-memory-surgery-202608161021`, aiwallpaper):
- Boot → TWO processes: **TUI 221 MB** (Phase 2 single-process: 455 MB → **−51%**) + **server 334 MB** (+ playwright MCP child 194 MB, reaped on idle per Phase 2). Sidebar memory display now reflects the TUI process only.
- Prompt cycle over HTTP+SSE healthy (model responded, cache fine).
- Kill TUI → server + `server.json` survive ✓; relaunch `--continue` → **same serve pid reused**, prior session restored (tokens shown) ✓.
- Kill server with TUI up → TUI stays alive, no crash (SSE backoff; stderr warning accepted as v1 UX) ✓.
- Cleanup verified: zero orphan processes.

**Accepted semantics (documented during review):** TUI exit leaves the server running (sessions survive — the point of the phase); concurrent double-launch converges onto one server; stale registry entries are only SIGTERMed after `/proc` cmdline ownership verification; dedicated network-flag launches register like any server ("newest wins"); portless dedicated launches (`--hostname`/`--mdns` without `--port`) never silently reuse the shared server.
