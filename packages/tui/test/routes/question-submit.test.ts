import { describe, expect, test } from "bun:test"
import { submitQuestion } from "../../src/routes/session/question-submit"

describe("submitQuestion", () => {
  test("returns undefined when the reply succeeds", async () => {
    const result = await submitQuestion({ send: () => Promise.resolve({}) })
    expect(result).toBeUndefined()
  })

  test("returns the message when the sdk resolves with an error body", async () => {
    const result = await submitQuestion({ send: () => Promise.resolve({ error: new Error("boom") }) })
    expect(result).toBe("boom")
  })

  test("extracts the message from structured api errors", async () => {
    const result = await submitQuestion({
      send: () => Promise.resolve({ error: { name: "QuestionError", data: { message: "already answered" } } }),
    })
    expect(result).toBe("already answered")
  })

  test("returns the message when the sdk throws", async () => {
    const result = await submitQuestion({ send: () => Promise.reject(new Error("connection reset")) })
    expect(result).toBe("connection reset")
  })

  test("times out a hung submission instead of waiting forever", async () => {
    const started = Date.now()
    const result = await submitQuestion({ send: () => new Promise(() => {}), timeoutMs: 30 })
    expect(result).toBe("submit timed out")
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
