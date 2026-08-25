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

  test("profiles recent conversation tail instead of old oversized history", () => {
    const old = user(`OLD_ARCH_MARKER architecture plan ${"old context ".repeat(20_000)}`)
    const recent = user("RECENT_DEBUG_MARKER npm run build failed with TypeError in frontend/src/App.tsx")

    const decision = CompactionProfile.infer({
      messages: [old, recent],
    })
    const judgePrompt = CompactionProfile.judgeMessages({ messages: [old, recent] })
    const judgePayload = JSON.parse(judgePrompt[1]!.content)

    expect(decision.profiles.map((item) => item.type)).toContain("debug_trace")
    expect(decision.must_preserve.join("\n")).toContain("error strings")
    expect(judgePayload.recent_conversation_excerpt).toContain("RECENT_DEBUG_MARKER")
    expect(judgePayload.recent_conversation_excerpt).not.toContain("OLD_ARCH_MARKER")
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
    expect(prompt).toContain('"active_task"')
    expect(prompt).toContain("three-layer")
    expect(prompt).toContain("## Active Task Essential State")
    expect(prompt).toContain("## Debug Trace")
    expect(prompt).toContain("## Implementation State")
    expect(prompt).toContain("## Architecture Decisions")
    expect(prompt).toContain("exact failing command")
    expect(prompt).toContain("Extra context")
  })

  test("parses active task extraction JSON and injects it into the summary prompt", () => {
    const decision = CompactionProfile.normalize({
      profiles: [
        { type: "debug_trace", weight: 0.5 },
        { type: "implementation_state", weight: 0.5 },
      ],
      active_task: {
        present: true,
        kind: "debug",
        window_turns: 4,
        reason: "recent turns are debugging a failing frontend build",
      },
      source: "llm",
    })
    const activeTask = CompactionProfile.parseActiveTaskOutput(
      `{
        "present": true,
        "kind": "debug",
        "objective": "Fix the frontend spacing regression",
        "status": "build is failing after the CSS patch",
        "files": ["frontend/src/App.tsx", "site/styles.css"],
        "commands": ["npm run build -> failed"],
        "failures": ["TypeError in frontend/src/App.tsx"],
        "next_actions": ["inspect App.tsx spacing component"]
      }`,
      decision,
    )
    const prompt = CompactionProfile.buildPrompt({
      context: [],
      decision,
      activeTask,
    })

    expect(activeTask?.source).toBe("llm")
    expect(activeTask?.files).toEqual(["frontend/src/App.tsx", "site/styles.css"])
    expect(prompt).toContain("<active-task-essential-json>")
    expect(prompt).toContain("Fix the frontend spacing regression")
    expect(prompt).toContain("frontend/src/App.tsx")
    expect(prompt).toContain("Do not collapse it into only status")
  })

  test("parses llm judge JSON and normalizes mixed profile weights", () => {
    const decision = CompactionProfile.parseJudgeOutput(`{
      "profiles": [
        { "type": "debug_trace", "weight": 0.5 },
        { "type": "implementation_state", "weight": 0.25 },
        { "type": "architecture_memory", "weight": 0.25 }
      ],
      "must_preserve": ["exact error", "changed files"],
      "active_task": {
        "present": true,
        "kind": "debug",
        "window_turns": 5,
        "reason": "recent turns are debugging a failing build"
      },
      "risk": "high"
    }`)

    expect(decision?.source).toBe("llm")
    expect(decision?.profiles).toEqual([
      { type: "debug_trace", weight: 0.5 },
      { type: "architecture_memory", weight: 0.25 },
      { type: "implementation_state", weight: 0.25 },
    ])
    expect(decision?.must_preserve).toEqual(["exact error", "changed files"])
    expect(decision?.active_task).toEqual({
      present: true,
      kind: "debug",
      window_turns: 5,
      reason: "recent turns are debugging a failing build",
    })
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

import { SessionMemory } from "@opencode-ai/core/session/memory"

describe("session memory merge", () => {
  test("parseMemoryOutput decodes, fills at, and normalizes", () => {
    const json = JSON.stringify({
      state: {
        objective: "obj",
        status: "active",
        kind: "implement",
        files: [{ path: "a.ts", role: "modified", note: "half done" }],
        verified: [],
        failures: [],
        next_actions: ["next"],
        open_questions: [],
      },
      log: {
        decisions: [{ decision: "x", rationale: "y", rejected: [], at: 0 }],
        constraints: [],
        pitfalls: [],
        milestones: [],
      },
    })
    const parsed = CompactionProfile.parseMemoryOutput(`\`\`\`json\n${json}\n\`\`\``)
    expect(parsed?.state.objective).toBe("obj")
    expect(parsed?.log.decisions[0]?.at).toBeGreaterThan(0)
  })

  test("parseMemoryOutput rejects garbage", () => {
    expect(CompactionProfile.parseMemoryOutput("not json")).toBeUndefined()
    expect(CompactionProfile.parseMemoryOutput('{"state":{"status":"bogus"}}')).toBeUndefined()
  })

  test("fallbackMemory keeps previous memory and seeds objective from decision", () => {
    const previous = SessionMemory.empty()
    const withObjective: SessionMemory.Content = {
      ...previous,
      state: { ...previous.state, objective: "old objective" },
      log: { ...previous.log, decisions: [{ decision: "keep me", rationale: "", rejected: [], at: 5 }] },
    }
    const decision = CompactionProfile.normalize({
      active_task: { present: true, kind: "debug", window_turns: 4, reason: "debugging flakes" },
    })
    const merged = CompactionProfile.fallbackMemory({ decision, previousMemory: withObjective })
    expect(merged.state.objective).toBe("old objective")
    expect(merged.log.decisions[0]?.decision).toBe("keep me")
    const fresh = CompactionProfile.fallbackMemory({ decision })
    expect(fresh.state.objective).toBe("debugging flakes")
    expect(fresh.state.kind).toBe("debug")
  })

  test("projectActiveTask maps memory state into ActiveTaskEssential", () => {
    const base = SessionMemory.empty()
    const content: SessionMemory.Content = {
      ...base,
      state: {
        ...base.state,
        objective: "obj",
        kind: "refactor",
        files: [{ path: "a.ts", role: "modified", note: "wip" }],
        verified: ["typecheck clean"],
        next_actions: ["ship it"],
        open_questions: [{ q: "ok?", owner: "user" }],
      },
    }
    const projected = CompactionProfile.projectActiveTask(content)
    expect(projected.kind).toBe("refactor")
    expect(projected.files[0]).toContain("a.ts")
    expect(projected.findings).toContain("typecheck clean")
    expect(projected.open_questions[0]).toBe("[user] ok?")
  })
})

test("fallbackMemory seeds must_preserve as constraints so first write is non-empty", () => {
  const decision = CompactionProfile.normalize({
    must_preserve: ["keep jwt", "never delete vdi"],
  })
  const merged = CompactionProfile.fallbackMemory({ decision })
  expect(merged.log.constraints).toEqual(["keep jwt", "never delete vdi"])
  expect(SessionMemory.isEmpty(merged)).toBe(false)

  const previous = SessionMemory.empty()
  const withConstraints: SessionMemory.Content = {
    ...previous,
    log: { ...previous.log, constraints: ["keep jwt"] },
  }
  const again = CompactionProfile.fallbackMemory({ decision, previousMemory: withConstraints })
  expect(again.log.constraints).toEqual(["keep jwt", "never delete vdi"])
})
