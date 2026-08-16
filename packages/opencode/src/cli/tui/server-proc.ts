import path from "path"
import { closeSync, openSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import { setTimeout } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { ServerRegistry } from "@/server/registry"
import type { Entry } from "@/server/registry"
import { ServerAuth } from "@/server/auth"

declare const OPENCODE_WORKER_PATH: string

type SpawnOptions =
  | { execPath: string; compiled: true; network?: string[] }
  | { execPath: string; compiled: false; indexTs: string; network?: string[] }

export function spawnArgs(opts: SpawnOptions) {
  const base = opts.compiled
    ? [opts.execPath, "serve"]
    : [opts.execPath, "run", "--conditions=browser", opts.indexTs, "serve"]
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

// Three requestedPort cases:
//   0  — plain default launch (no network flags): any healthy entry serves it.
//  -1  — sentinel for a dedicated launch without an explicit nonzero --port
//        (bare --hostname/--mdns, or the user typed --port 0 for "random"):
//        never reuse — the caller must spawn the requested listener.
//  >0  — explicit --port: reuse only an entry listening on that port.
// Entry URLs are always http today; URL.port elides the default port, so
// normalize "" to "80" (https entries would elide 443, but none exist yet).
export function matchesRequest(entry: Entry, requestedPort: number) {
  if (requestedPort === -1) return false
  if (requestedPort === 0) return true
  const port = new URL(entry.url).port || "80"
  return port === String(requestedPort)
}

export async function ensureServer(opts: { network?: { args: string[]; port: number } }) {
  const requestedPort = opts.network?.port ?? 0
  const entry = await ServerRegistry.read(Global.Path.data)
  if (entry) {
    const ok = await healthy(entry.url, entry.password)
    const compatible = reusable(entry, InstallationVersion, ServerRegistry.alive, () => ok)
    if (compatible && matchesRequest(entry, requestedPort)) {
      return {
        url: entry.url,
        headers: ServerAuth.headers({ password: entry.password }),
        spawned: false,
        pid: entry.pid,
      }
    }
    // A compatible entry on a different port than explicitly requested is left
    // running: the dedicated spawn below still starts as asked and overwrites
    // the registry when it listens, so the registry then points at the newest
    // server (the ownership guard in ServerRegistry.remove keeps the old
    // server's shutdown from deleting that entry). Only incompatible entries
    // get reclaimed.
    if (!compatible) await terminate(entry.pid)
  }

  const password = randomBytes(16).toString("hex")
  const compiled = typeof OPENCODE_WORKER_PATH !== "undefined"
  const argv = compiled
    ? spawnArgs({ execPath: process.execPath, compiled: true, network: opts.network?.args })
    : spawnArgs({
        execPath: process.execPath,
        compiled: false,
        indexTs: fileURLToPath(new URL("../../index.ts", import.meta.url)),
        network: opts.network?.args,
      })

  // The child outlives the TUI, so its output goes to a log file instead of a
  // pipe: a pipe's read end closes on TUI exit, exposing the long-lived server
  // to SIGPIPE and backpressure. detached (setsid) keeps terminal Ctrl-C
  // (process-group SIGINT) from reaching it.
  const log = path.join(Global.Path.log, "serve.log")
  const fd = openSync(log, "a")
  const child = Bun.spawn(argv, {
    env: {
      ...process.env,
      // The fork is mid-rename OPENCODE_ → OPENCHINACODE_; server auth accepts
      // either name, but set both so this child also interops with older
      // binaries that read only one of them.
      OPENCODE_SERVER_PASSWORD: password,
      OPENCHINACODE_SERVER_PASSWORD: password,
    },
    stdin: "ignore",
    stdout: fd,
    stderr: fd,
    detached: true,
  })
  closeSync(fd)

  const winner = await waitReady(child, password, requestedPort)
  if (!winner) {
    const why = child.exitCode !== null ? `exited with code ${child.exitCode}` : "did not become ready within 15s"
    child.kill()
    throw new Error(`opencode serve ${why} (see ${log})`)
  }
  if (winner.pid !== child.pid) {
    // Lost the spawn race to a concurrent launch: retire our own child (this
    // process's fresh Bun.spawn, always safe to signal) and attach to the
    // winner instead of keeping a duplicate server.
    child.kill("SIGTERM")
    return {
      url: winner.url,
      headers: ServerAuth.headers({ password: winner.password }),
      spawned: false,
      pid: winner.pid,
    }
  }

  // No mid-session respawn in v1: the SSE backoff already surfaces the
  // disconnect in the UI, so a dead server only gets a stderr warning. Only
  // our own spawned child has a handle to watch; a reused server does not.
  void child.exited.then((code) => {
    console.error(`opencode server (pid ${child.pid}) exited with code ${code}`)
  })

  return { url: winner.url, headers: ServerAuth.headers({ password }), spawned: true, pid: child.pid }
}

async function healthy(url: string, password: string | undefined) {
  const response = await fetch(`${url}/global/health`, {
    headers: ServerAuth.headers({ password }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => undefined)
  return response?.ok === true
}

async function ownedByUs(pid: number) {
  if (process.platform !== "linux") return false
  const raw = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => undefined)
  if (!raw) return false
  const args = raw.split("\0").filter((arg) => arg !== "")
  return args.some((arg) => /openchinacode|opencode/i.test(arg)) && args.includes("serve")
}

async function terminate(pid: number) {
  // The registry entry is the only evidence that pid was our server; after a
  // reboot or pid reuse it may belong to an innocent process, so verify the
  // cmdline before signalling. On mismatch the stale server leaks and the
  // fresh spawn overwrites the registry — never kill innocents.
  if (!(await ownedByUs(pid))) return
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    return
  }
  const deadline = Date.now() + 3000
  while (ServerRegistry.alive(pid) && Date.now() < deadline) {
    await setTimeout(100)
  }
}

async function waitReady(child: Bun.Subprocess, password: string, requestedPort: number) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return undefined
    const entry = await ServerRegistry.read(Global.Path.data)
    if (entry?.pid === child.pid && (await healthy(entry.url, password))) return entry
    // Concurrent launch: another server registered first (or appeared while
    // the initial read found none). Converge on it when it is healthy,
    // same-version, and serves this launch's request — the caller retires our
    // child — instead of keeping a duplicate; otherwise keep waiting for our
    // own child until the timeout.
    if (entry && matchesRequest(entry, requestedPort)) {
      const ok = await healthy(entry.url, entry.password)
      if (reusable(entry, InstallationVersion, ServerRegistry.alive, () => ok)) return entry
    }
    await setTimeout(100)
  }
  return undefined
}
