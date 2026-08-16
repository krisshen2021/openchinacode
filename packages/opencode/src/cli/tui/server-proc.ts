import path from "path"
import { closeSync, openSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
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

// A dedicated server (explicit network flags) never touches the shared
// registry, so its port must be known up front: the caller keeps an explicit
// --port, or reserves a free one here and forwards it explicitly. The tiny
// race between reserving and the child binding is accepted; a lost race
// surfaces as a spawn timeout with a clear error.
export async function freePort() {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const port = listener.port
  listener.stop(true)
  return port
}

export async function ensureServer(opts: { network?: { args: string[]; url: string } }) {
  if (!opts.network) {
    const entry = await ServerRegistry.read(Global.Path.data)
    if (entry) {
      const ok = await healthy(entry.url, entry.password)
      if (reusable(entry, InstallationVersion, ServerRegistry.alive, () => ok)) {
        return {
          url: entry.url,
          headers: ServerAuth.headers({ password: entry.password }),
          spawned: false,
          pid: entry.pid,
        }
      }
      await terminate(entry.pid)
    }
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
      // Auth enforcement reads OPENCODE_SERVER_PASSWORD (ServerAuth.Config)
      // while serve's registry write reads OPENCHINACODE_SERVER_PASSWORD via
      // Flag — set both so the registry entry records the password and the
      // next TUI can actually reuse this server.
      OPENCODE_SERVER_PASSWORD: password,
      OPENCHINACODE_SERVER_PASSWORD: password,
      ...(opts.network ? { OPENCODE_SKIP_REGISTRY: "1" } : {}),
    },
    stdin: "ignore",
    stdout: fd,
    stderr: fd,
    detached: true,
  })
  closeSync(fd)

  const url = await waitReady(child, opts.network, password)
  if (!url) {
    child.kill()
    throw new Error(`opencode serve failed to start within 15s (see ${log})`)
  }

  // No mid-session respawn in v1: the SSE backoff already surfaces the
  // disconnect in the UI, so a dead server only gets a stderr warning.
  void child.exited.then((code) => {
    console.error(`opencode server (pid ${child.pid}) exited with code ${code}`)
  })

  return { url, headers: ServerAuth.headers({ password }), spawned: true, pid: child.pid }
}

async function healthy(url: string, password: string | undefined) {
  const response = await fetch(`${url}/global/health`, {
    headers: ServerAuth.headers({ password }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => undefined)
  return response?.ok === true
}

async function terminate(pid: number) {
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    return
  }
  const deadline = Date.now() + 3000
  while (ServerRegistry.alive(pid) && Date.now() < deadline) {
    await sleep(100)
  }
}

async function waitReady(child: Bun.Subprocess, network: { args: string[]; url: string } | undefined, password: string) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return undefined
    const entry = network ? undefined : await ServerRegistry.read(Global.Path.data)
    const url = network?.url ?? (entry?.pid === child.pid ? entry.url : undefined)
    if (url && (await healthy(url, password))) return url
    await sleep(100)
  }
  return undefined
}
