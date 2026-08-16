import { describe, expect, test } from "bun:test"
import { spawnArgs, reusable, matchesRequest } from "../../src/cli/tui/server-proc"

describe("spawnArgs", () => {
  test("compiled build spawns self with serve", () => {
    expect(spawnArgs({ execPath: "/bin/openchinacode", compiled: true })).toEqual(["/bin/openchinacode", "serve"])
  })

  test("dev build spawns bun run on the repo index", () => {
    const args = spawnArgs({ execPath: "/usr/bin/bun", compiled: false, indexTs: "/repo/packages/opencode/src/index.ts" })
    expect(args).toEqual(["/usr/bin/bun", "run", "--conditions=browser", "/repo/packages/opencode/src/index.ts", "serve"])
  })

  test("network flags are forwarded", () => {
    expect(spawnArgs({ execPath: "/bin/oc", compiled: true, network: ["--port", "4200"] })).toEqual([
      "/bin/oc",
      "serve",
      "--port",
      "4200",
    ])
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

describe("matchesRequest", () => {
  const entry = { pid: 1, url: "http://127.0.0.1:4096", version: "1", startedAt: 0 }

  test("no explicit port matches any entry", () => {
    expect(matchesRequest(entry, 0)).toBe(true)
  })
  test("matching explicit port = reuse serves the intent", () => {
    expect(matchesRequest(entry, 4096)).toBe(true)
  })
  test("different explicit port = dedicated spawn instead", () => {
    expect(matchesRequest(entry, 4519)).toBe(false)
  })
})
