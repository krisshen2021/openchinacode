import { describe, expect, test } from "bun:test"
import { Config } from "../src/config"
import { ConfigCompaction } from "../src/config/compaction"
import { retentionTurns } from "../src/session/runner/llm"

function doc(compaction: Partial<ConfigCompaction.Info>): Config.Entry {
  return new Config.Document({
    type: "document",
    info: new Config.Info({ compaction: new ConfigCompaction.Info(compaction) }),
  })
}

describe("session.runner.retentionTurns", () => {
  test("unset key is off (keep everything), matching upstream default", () => {
    expect(retentionTurns([], "reasoning_retention_turns")).toBeUndefined()
    expect(retentionTurns([doc({})], "reasoning_retention_turns")).toBeUndefined()
  })

  test("configured value applies when the master switch is absent or true", () => {
    expect(retentionTurns([doc({ reasoning_retention_turns: 6 })], "reasoning_retention_turns")).toBe(6)
    expect(
      retentionTurns([doc({ retention_enabled: true, reasoning_retention_turns: 6 })], "reasoning_retention_turns"),
    ).toBe(6)
  })

  test("master switch false makes configured values inert without deleting them", () => {
    const documents = [doc({ retention_enabled: false, reasoning_retention_turns: 6 })]
    expect(retentionTurns(documents, "reasoning_retention_turns")).toBeUndefined()
    // other keys are gated too
    expect(retentionTurns(documents, "tool_output_retention_turns")).toBeUndefined()
    expect(retentionTurns(documents, "attachment_retention_turns")).toBeUndefined()
  })

  test("zero is a valid aggressive setting, not off", () => {
    expect(retentionTurns([doc({ tool_output_retention_turns: 0 })], "tool_output_retention_turns")).toBe(0)
  })

  test("highest-priority document wins for both gate and key", () => {
    // low → high priority order
    const locked = [doc({ retention_enabled: false }), doc({ retention_enabled: true, attachment_retention_turns: 2 })]
    expect(retentionTurns(locked, "attachment_retention_turns")).toBe(2)

    const unlockedLowLockedHigh = [
      doc({ retention_enabled: true, attachment_retention_turns: 2 }),
      doc({ retention_enabled: false }),
    ]
    expect(retentionTurns(unlockedLowLockedHigh, "attachment_retention_turns")).toBeUndefined()
  })

  test("gate in one document and key in another still combine", () => {
    const documents = [doc({ reasoning_retention_turns: 3 }), doc({ retention_enabled: false })]
    expect(retentionTurns(documents, "reasoning_retention_turns")).toBeUndefined()
  })
})

describe("ConfigCompaction session overrides", () => {
  const global = { retention_enabled: undefined, reasoning_retention_turns: 6 }

  test("absent session keys inherit global config", () => {
    const override = ConfigCompaction.sessionOverride({ compaction: {} })
    const master = ConfigCompaction.retentionMaster(global, override)
    expect(ConfigCompaction.retentionTurns("reasoning_retention_turns", master, global, override)).toBe(6)
  })

  test("session value wins over global config", () => {
    const override = ConfigCompaction.sessionOverride({ compaction: { reasoning_retention_turns: 2 } })
    const master = ConfigCompaction.retentionMaster(global, override)
    expect(ConfigCompaction.retentionTurns("reasoning_retention_turns", master, global, override)).toBe(2)
  })

  test("session null disables the window even when global configures it", () => {
    const override = ConfigCompaction.sessionOverride({ compaction: { reasoning_retention_turns: null } })
    const master = ConfigCompaction.retentionMaster(global, override)
    expect(ConfigCompaction.retentionTurns("reasoning_retention_turns", master, global, override)).toBeUndefined()
  })

  test("session master unlock re-enables globally locked windows and keeps global turns", () => {
    const locked = { retention_enabled: false, reasoning_retention_turns: 6 }
    const override = ConfigCompaction.sessionOverride({ compaction: { retention_enabled: true } })
    const master = ConfigCompaction.retentionMaster(locked, override)
    expect(master).toBe(true)
    expect(ConfigCompaction.retentionTurns("reasoning_retention_turns", master, locked, override)).toBe(6)
  })

  test("session master lock disables globally configured windows", () => {
    const override = ConfigCompaction.sessionOverride({ compaction: { retention_enabled: false } })
    const master = ConfigCompaction.retentionMaster(global, override)
    expect(ConfigCompaction.retentionTurns("reasoning_retention_turns", master, global, override)).toBeUndefined()
  })

  test("master lock wins over session turns values", () => {
    const override = ConfigCompaction.sessionOverride({
      compaction: { retention_enabled: false, reasoning_retention_turns: 2 },
    })
    const master = ConfigCompaction.retentionMaster(global, override)
    expect(ConfigCompaction.retentionTurns("reasoning_retention_turns", master, global, override)).toBeUndefined()
  })

  test("malformed metadata yields no overrides", () => {
    expect(ConfigCompaction.sessionOverride(undefined)).toEqual({})
    expect(ConfigCompaction.sessionOverride({ compaction: "nope" })).toEqual({})
    expect(ConfigCompaction.sessionOverride({ compaction: [1, 2] })).toEqual({})
  })
})
