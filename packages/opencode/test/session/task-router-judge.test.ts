import { describe, expect, test } from "bun:test"
import { TaskRouterJudge } from "../../src/session/judge/task-router"

describe("TaskRouterJudge", () => {
  test("parses a delegated task router decision", () => {
    const decision = TaskRouterJudge.parseDecision(`\`\`\`json
{
  "action": "delegate",
  "task_kind": "refactor",
  "task_complexity": "complex",
  "subagent_type": "general",
  "confidence": 0.91,
  "description": "Frontend refactor plan",
  "reason": "broad UI/UX refactor",
  "subtask_prompt": "Inspect the frontend and produce a phased refactor plan."
}
\`\`\``)

    expect(decision).toMatchObject({
      action: "delegate",
      task_kind: "refactor",
      task_complexity: "complex",
      subagent_type: "general",
      confidence: 0.91,
      description: "Frontend refactor plan",
    })
  })

  test("requires enabled extra router and passes allow deny gating", () => {
    const decision = {
      action: "delegate",
      task_kind: "debug",
      task_complexity: "medium",
      subagent_type: "general",
      confidence: 0.8,
      description: "Fix failing test",
      reason: "debug request",
    } as const

    expect(TaskRouterJudge.shouldDelegate(decision, undefined)).toBe(false)
    expect(TaskRouterJudge.shouldDelegate(decision, { enabled: true, confidence_threshold: 0.9 })).toBe(false)
    expect(TaskRouterJudge.shouldDelegate(decision, { enabled: true })).toBe(true)
    expect(TaskRouterJudge.shouldDelegate(decision, { enabled: true, deny: ["debug"] })).toBe(false)
    expect(TaskRouterJudge.shouldDelegate(decision, { enabled: true, allow: ["review"] })).toBe(false)
  })

  test("builds read-only delegated prompt for plan mode", () => {
    const prompt = TaskRouterJudge.buildSubtaskPrompt({
      planReadonly: true,
      prompt: "改一下首页按钮样式",
      decision: {
        action: "delegate",
        task_kind: "implement",
        task_complexity: "medium",
        subagent_type: "general",
        confidence: 0.9,
        description: "Button style update",
        reason: "implementation request",
      },
    })

    expect(prompt).toContain("Parent mode: Plan mode is active")
    expect(prompt).toContain("do not edit files")
    expect(prompt).toContain("switch to Build mode")
  })
})
