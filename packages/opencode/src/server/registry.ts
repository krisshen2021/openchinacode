import path from "path"
import { chmod, rename, rm, writeFile } from "node:fs/promises"

export interface Entry {
  pid: number
  url: string
  version: string
  password?: string
  startedAt: number
}

const file = (dir: string) => path.join(dir, "server.json")

export async function read(dir: string): Promise<Entry | undefined> {
  const json = await Bun.file(file(dir))
    .json()
    .catch(() => undefined)
  if (!json || typeof json.pid !== "number" || typeof json.url !== "string" || typeof json.version !== "string") {
    return undefined
  }
  return json as Entry
}

export async function write(dir: string, entry: Entry) {
  // Atomic via write-then-rename so a concurrent reader never sees a partial
  // file; the tmp name is per-process because two concurrent serve children
  // (double launch) can write at the same time. writeFile mode applies on
  // creation and rename preserves it; chmod covers umask drift.
  const tmp = `${file(dir)}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(entry), { mode: 0o600 })
  await rename(tmp, file(dir))
  await chmod(file(dir), 0o600).catch(() => {})
}

export async function remove(dir: string, expectedPid?: number) {
  // Ownership guard: a stale server may outlive its replacement's startup, so
  // a shutdown hook must not delete a fresh owner's entry.
  if (expectedPid !== undefined) {
    const entry = await read(dir)
    if (entry?.pid !== expectedPid) return
  }
  await rm(file(dir), { force: true }).catch(() => {})
}

export function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export * as ServerRegistry from "./registry"
