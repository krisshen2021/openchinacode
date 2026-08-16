import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { ServerRegistry } from "../../src/server/registry"

describe("ServerRegistry", () => {
  test("write then read round-trips the entry", async () => {
    await using tmp = await tmpdir()
    const entry = {
      pid: 1234,
      url: "http://127.0.0.1:4096",
      version: "1.2.3",
      password: "secret",
      startedAt: Date.now(),
    }
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
