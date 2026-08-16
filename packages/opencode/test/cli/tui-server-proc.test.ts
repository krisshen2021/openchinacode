import { describe, expect, test } from "bun:test"
import { spawnArgs, reusable, matchesRequest } from "../../src/cli/tui/server-proc"

describe("spawnArgs", () => {
  test("compiled build spawns self with serve", () => {
    expect(spawnArgs({ execPath: "/bin/openchinacode", compiled: true })).toEqual(["/bin/openchinacode", "serve"])
  })

  test("dev build spawns bun run on the repo index", () => {
    const args = spawnArgs({
      execPath: "/usr/bin/bun",
      compiled: false,
      indexTs: "/repo/packages/opencode/src/index.ts",
    })
    expect(args).toEqual([
      "/usr/bin/bun",
      "run",
      "--conditions=browser",
      "/repo/packages/opencode/src/index.ts",
      "serve",
    ])
  })

  test("network flags are forwarded", () => {
    expect(spawnArgs({ execPath: "/bin/oc", compiled: true, network: ["--port", "4200"] })).toEqual([
      "/bin/oc",
      "serve",
      "--port",
      "4200",
    ])
  })

  test("idle timeout flag is appended", () => {
    expect(spawnArgs({ execPath: "/bin/oc", compiled: true, idleTimeoutMs: 3_600_000 })).toEqual([
      "/bin/oc",
      "serve",
      "--idle-timeout",
      "3600000",
    ])
  })

  test("idle timeout composes with network flags and dev builds", () => {
    expect(
      spawnArgs({
        execPath: "/usr/bin/bun",
        compiled: false,
        indexTs: "/repo/packages/opencode/src/index.ts",
        network: ["--port", "4200"],
        idleTimeoutMs: 3_600_000,
      }),
    ).toEqual([
      "/usr/bin/bun",
      "run",
      "--conditions=browser",
      "/repo/packages/opencode/src/index.ts",
      "serve",
      "--port",
      "4200",
      "--idle-timeout",
      "3600000",
    ])
  })
})

describe("reusable", () => {
  const entry = { pid: 1, url: "http://127.0.0.1:4096", version: "1", startedAt: 0 }

  test("same version + healthy = reuse", () => {
    expect(
      reusable(
        entry,
        "1",
        () => true,
        () => true,
      ),
    ).toBe(true)
  })
  test("version mismatch = no reuse", () => {
    expect(
      reusable(
        entry,
        "2",
        () => true,
        () => true,
      ),
    ).toBe(false)
  })
  test("dead pid = no reuse", () => {
    expect(
      reusable(
        entry,
        "1",
        () => false,
        () => true,
      ),
    ).toBe(false)
  })
  test("unhealthy = no reuse", () => {
    expect(
      reusable(
        entry,
        "1",
        () => true,
        () => false,
      ),
    ).toBe(false)
  })
  test("missing entry = no reuse", () => {
    expect(
      reusable(
        undefined,
        "1",
        () => true,
        () => true,
      ),
    ).toBe(false)
  })
})

describe("matchesRequest", () => {
  const entry = { pid: 1, url: "http://127.0.0.1:4096", version: "1", startedAt: 0 }

  test("default launch (0) matches any entry", () => {
    expect(matchesRequest(entry, 0)).toBe(true)
  })
  test("matching explicit port = reuse serves the intent", () => {
    expect(matchesRequest(entry, 4096)).toBe(true)
  })
  test("different explicit port = dedicated spawn instead", () => {
    expect(matchesRequest(entry, 4519)).toBe(false)
  })
  test("sentinel -1 never matches, even for an otherwise compatible entry", () => {
    // tui.ts maps portless dedicated launches (bare --hostname/--mdns) and an
    // explicit --port 0 ("random port") to the -1 sentinel.
    expect(matchesRequest(entry, -1)).toBe(false)
  })
  test("entry on default http port 80 matches an explicit --port 80", () => {
    expect(matchesRequest({ ...entry, url: "http://127.0.0.1:80" }, 80)).toBe(true)
  })
})
