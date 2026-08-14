import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { create } from "@opencode-ai/schema/identifier"

// The old encoding stored ts*0x1000 in a 6-byte field, which wrapped on
// 2026-08-14; every ID generated after the wrap sorted before pre-wrap IDs
// and broke ID-ordering assumptions (prompt loop exited immediately, fork
// copied the wrong range). 26*2^36 is one of the old scheme's wrap points.
const WRAP_ERA = 26 * 2 ** 36

describe("util.identifier", () => {
  test("ascending ids stay monotonic across the old wrap boundary", () => {
    const ids = [WRAP_ERA - 2, WRAP_ERA - 1, WRAP_ERA, WRAP_ERA + 1, WRAP_ERA + 2].map((ts) =>
      Identifier.create("msg", "ascending", ts),
    )
    expect([...ids].sort()).toEqual(ids)
  })

  test("same-millisecond ids are strictly increasing", () => {
    const a = Identifier.create("msg", "ascending", WRAP_ERA + 1000)
    const b = Identifier.create("msg", "ascending", WRAP_ERA + 1000)
    expect(a < b).toBe(true)
  })

  test("timestamp round-trips", () => {
    const id = Identifier.create("tool", "ascending", WRAP_ERA + 1234)
    expect(Identifier.timestamp(id)).toBe(WRAP_ERA + 1234)
  })

  test("prefix and length are unchanged", () => {
    const id = Identifier.create("msg", "ascending", Date.now())
    expect(id.startsWith("msg_")).toBe(true)
    expect(id.length).toBe(4 + 26)
  })

  test("schema identifier stays monotonic across the wrap boundary", () => {
    const before = create(false, WRAP_ERA + 2000)
    const after = create(false, WRAP_ERA + 2001)
    expect(before < after).toBe(true)
    expect(before.length).toBe(26)
  })

  test("descending ids sort newest first", () => {
    const older = create(true, WRAP_ERA + 3000)
    const newer = create(true, WRAP_ERA + 3001)
    expect(newer < older).toBe(true)
  })
})
