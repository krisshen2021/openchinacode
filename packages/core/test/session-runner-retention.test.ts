import { describe, expect, test } from "bun:test"
import { ConfigCompaction } from "../src/config/compaction"

function turns(metadata: Record<string, unknown> | undefined, key: ConfigCompaction.RetentionKey) {
  const override = ConfigCompaction.sessionOverride(metadata)
  return ConfigCompaction.retentionTurns(key, ConfigCompaction.retentionMaster(override), override)
}

describe("ConfigCompaction session-scoped retention", () => {
  test("unset metadata is off (keep everything), matching upstream default", () => {
    expect(turns(undefined, "reasoning_retention_turns")).toBeUndefined()
    expect(turns({}, "reasoning_retention_turns")).toBeUndefined()
    expect(turns({ compaction: {} }, "reasoning_retention_turns")).toBeUndefined()
  })

  test("session value applies when the master switch is absent or true", () => {
    expect(turns({ compaction: { reasoning_retention_turns: 6 } }, "reasoning_retention_turns")).toBe(6)
    expect(
      turns({ compaction: { retention_enabled: true, reasoning_retention_turns: 6 } }, "reasoning_retention_turns"),
    ).toBe(6)
  })

  test("master switch false makes configured values inert without deleting them", () => {
    const metadata = { compaction: { retention_enabled: false, reasoning_retention_turns: 6 } }
    expect(turns(metadata, "reasoning_retention_turns")).toBeUndefined()
    expect(turns(metadata, "tool_output_retention_turns")).toBeUndefined()
    expect(turns(metadata, "attachment_retention_turns")).toBeUndefined()
  })

  test("zero is a valid aggressive setting, not off", () => {
    expect(turns({ compaction: { tool_output_retention_turns: 0 } }, "tool_output_retention_turns")).toBe(0)
  })

  test("null explicitly disables the window for the session", () => {
    expect(turns({ compaction: { reasoning_retention_turns: null } }, "reasoning_retention_turns")).toBeUndefined()
    // other windows unaffected
    expect(
      turns(
        { compaction: { reasoning_retention_turns: null, attachment_retention_turns: 2 } },
        "attachment_retention_turns",
      ),
    ).toBe(2)
  })

  test("windows resolve independently", () => {
    const metadata = { compaction: { reasoning_retention_turns: 4, attachment_retention_turns: 8 } }
    expect(turns(metadata, "reasoning_retention_turns")).toBe(4)
    expect(turns(metadata, "tool_output_retention_turns")).toBeUndefined()
    expect(turns(metadata, "attachment_retention_turns")).toBe(8)
  })

  test("malformed metadata yields no overrides", () => {
    expect(ConfigCompaction.sessionOverride(undefined)).toEqual({})
    expect(ConfigCompaction.sessionOverride({ compaction: "nope" })).toEqual({})
    expect(ConfigCompaction.sessionOverride({ compaction: [1, 2] })).toEqual({})
    expect(turns({ compaction: "nope" }, "reasoning_retention_turns")).toBeUndefined()
  })
})
