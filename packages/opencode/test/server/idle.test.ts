import { describe, expect, test } from "bun:test"
import { ServerIdle } from "../../src/server/idle"

describe("ServerIdle.shouldIdle", () => {
  test("disabled timeout (0) never idles", () => {
    ServerIdle.stamp()
    expect(ServerIdle.shouldIdle(Date.now() + 60_000, 0)).toBe(false)
  })

  test("recent activity does not idle", () => {
    ServerIdle.stamp()
    expect(ServerIdle.shouldIdle(Date.now(), 1_000)).toBe(false)
  })

  test("past timeout with no open connections idles", () => {
    ServerIdle.stamp()
    expect(ServerIdle.shouldIdle(Date.now() + 1_000, 1_000)).toBe(true)
  })

  test("an open connection blocks idle until it closes", () => {
    const done = ServerIdle.trackOpen()
    expect(ServerIdle.shouldIdle(Date.now() + 60_000, 1_000)).toBe(false)
    done()
    expect(ServerIdle.shouldIdle(Date.now() + 1_000, 1_000)).toBe(true)
  })

  test("nested connections idle only after all close", () => {
    const first = ServerIdle.trackOpen()
    const second = ServerIdle.trackOpen()
    first()
    expect(ServerIdle.shouldIdle(Date.now() + 60_000, 1_000)).toBe(false)
    second()
    expect(ServerIdle.shouldIdle(Date.now() + 1_000, 1_000)).toBe(true)
  })

  test("closing a connection stamps fresh activity", () => {
    const done = ServerIdle.trackOpen()
    done()
    // done() just stamped, so "now" is far from idle even at a generous timeout
    expect(ServerIdle.shouldIdle(Date.now(), 60_000)).toBe(false)
  })
})
