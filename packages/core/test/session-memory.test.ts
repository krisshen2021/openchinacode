import { describe, expect, test } from "bun:test"
import { SessionMemory } from "@opencode-ai/core/session/memory"

const decision = (at: number) => ({ decision: `d${at}`, rationale: "r", rejected: [], at })

function withState(partial: Partial<SessionMemory.State>): SessionMemory.Content {
  const base = SessionMemory.empty()
  return { ...base, state: { ...base.state, ...partial } }
}

function withLog(partial: Partial<SessionMemory.Log>): SessionMemory.Content {
  const base = SessionMemory.empty()
  return { ...base, log: { ...base.log, ...partial } }
}

describe("normalize", () => {
  test("caps decisions at 50 by dropping oldest", () => {
    const result = SessionMemory.normalize(
      withLog({ decisions: Array.from({ length: 60 }, (_, i) => decision(i)) }),
    )
    expect(result.log.decisions.length).toBe(50)
    expect(result.log.decisions[0]!.decision).toBe("d10")
  })

  test("never evicts constraints", () => {
    const result = SessionMemory.normalize(
      withLog({ constraints: Array.from({ length: 30 }, (_, i) => `rule ${i}`) }),
    )
    expect(result.log.constraints.length).toBeGreaterThan(0)
    expect(result.log.constraints[0]).toBe("rule 0")
  })

  test("orders failures unresolved-first", () => {
    const result = SessionMemory.normalize(
      withState({
        failures: [
          { error: "old resolved", resolved: true },
          { error: "still broken", resolved: false },
        ],
      }),
    )
    expect(result.state.failures[0]!.error).toBe("still broken")
  })

  test("enforces the state byte cap", () => {
    const result = SessionMemory.normalize(
      withState({ verified: Array.from({ length: 200 }, (_, i) => `fact ${i} ${"x".repeat(200)}`) }),
    )
    expect(JSON.stringify(result.state).length).toBeLessThanOrEqual(SessionMemory.STATE_MAX_BYTES)
  })
})

describe("render", () => {
  test("renders fixed sections with objective and pitfalls", () => {
    const base = withState({ objective: "ship ep0", status: "active" })
    const content: SessionMemory.Content = {
      ...base,
      log: { ...base.log, pitfalls: [{ trap: "pm2 revives port", why: "watchdog", workaround: "pm2 delete first", at: 1 }] },
    }
    const out = SessionMemory.render(content)
    expect(out).toContain("## Objective")
    expect(out).toContain("ship ep0")
    expect(out).toContain("## Pitfalls")
    expect(out).toContain("pm2 revives port")
    expect(out).not.toContain("## Decisions")
  })
})
