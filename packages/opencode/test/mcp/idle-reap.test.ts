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
