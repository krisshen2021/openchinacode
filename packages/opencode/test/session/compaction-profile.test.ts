import { describe, expect, test } from "bun:test"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { CompactionProfile } from "@/session/compaction-profile"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

const sessionID = SessionID.make("ses_compaction_profile_test")

function user(text: string): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "user",
      sessionID,
      agent: "build",
      model: { providerID: "test" as any, modelID: "test-model" as any },
      time: { created: Date.now() },
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID,
        type: "text",
        text,
      },
    ],
  }
}

describe("CompactionProfile", () => {
  test("normalizes profile weights into a stable sorted JSON shape", () => {
    const decision = CompactionProfile.normalize({
      profiles: [
        { type: "debug_trace", weight: 3 },
        { type: "implementation_state", weight: 2 },
        { type: "debug_trace", weight: 1 },
      ],
      must_preserve: [" failing command ", ""],
      source: "heuristic",
    })

    expect(decision.profiles).toEqual([
      { type: "debug_trace", weight: 0.67 },
      { type: "implementation_state", weight: 0.33 },
    ])
    expect(decision.must_preserve).toEqual(["failing command"])
    expect(decision.risk).toBe("high")
  })

  test("infers mixed debug, implementation, and architecture profiles", () => {
    const decision = CompactionProfile.infer({
      messages: [
        user(
          "We are refactoring frontend architecture in frontend/vite.config.ts. npm run build failed with TypeError and LSP diagnostics. Next action: inspect i18n config.",
        ),
      ],
    })

    expect(decision.profiles.map((item) => item.type)).toContain("debug_trace")
    expect(decision.profiles.map((item) => item.type)).toContain("implementation_state")
    expect(decision.profiles.map((item) => item.type)).toContain("architecture_memory")
    expect(decision.must_preserve.join("\n")).toContain("error strings")
  })

  test("builds deterministic sectioned prompt from profile JSON", () => {
    const decision = CompactionProfile.normalize({
      profiles: [
        { type: "debug_trace", weight: 0.45 },
        { type: "implementation_state", weight: 0.35 },
        { type: "architecture_memory", weight: 0.2 },
      ],
      must_preserve: ["exact failing command"],
      risk: "high",
      source: "heuristic",
    })
    const prompt = CompactionProfile.buildPrompt({
      previousSummary: "Existing summary",
      context: ["Extra context"],
      decision,
    })

    expect(prompt).toContain("<compaction-profile-json>")
    expect(prompt).toContain('"type": "debug_trace"')
    expect(prompt).toContain("## Debug Trace")
    expect(prompt).toContain("## Implementation State")
    expect(prompt).toContain("## Architecture Decisions")
    expect(prompt).toContain("exact failing command")
    expect(prompt).toContain("Extra context")
  })

  test("parses llm judge JSON and normalizes mixed profile weights", () => {
    const decision = CompactionProfile.parseJudgeOutput(`{
      "profiles": [
        { "type": "debug_trace", "weight": 0.5 },
        { "type": "implementation_state", "weight": 0.25 },
        { "type": "architecture_memory", "weight": 0.25 }
      ],
      "must_preserve": ["exact error", "changed files"],
      "risk": "high"
    }`)

    expect(decision?.source).toBe("llm")
    expect(decision?.profiles).toEqual([
      { type: "debug_trace", weight: 0.5 },
      { type: "architecture_memory", weight: 0.25 },
      { type: "implementation_state", weight: 0.25 },
    ])
    expect(decision?.must_preserve).toEqual(["exact error", "changed files"])
    expect(decision?.risk).toBe("high")
  })

  test("parses fenced llm judge JSON and rejects invalid output", () => {
    const fenced = CompactionProfile.parseJudgeOutput(`\`\`\`json
    {
      "profiles": [{ "type": "review_findings", "weight": 1 }],
      "must_preserve": ["severity and evidence"],
      "risk": "medium"
    }
    \`\`\``)
    const invalid = CompactionProfile.parseJudgeOutput("not json")

    expect(fenced?.source).toBe("llm")
    expect(fenced?.profiles).toEqual([{ type: "review_findings", weight: 1 }])
    expect(invalid).toBeUndefined()
  })
})
