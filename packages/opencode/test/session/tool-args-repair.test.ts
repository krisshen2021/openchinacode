import { describe, expect, test } from "bun:test"
import { parseToolArguments, repairMediaPromptToolArguments } from "../../src/session/tool-args-repair"

describe("media tool argument repair", () => {
  test("keeps valid JSON unchanged", () => {
    expect(parseToolArguments("image_generate", '{"prompt":"poster text \\"OPENCHINACODE\\"","size":"2K"}')).toEqual({
      prompt: 'poster text "OPENCHINACODE"',
      size: "2K",
    })
  })

  test("repairs bare double quotes inside image prompt", () => {
    const repaired = repairMediaPromptToolArguments(
      "image_generate",
      '{"prompt":"make a poster with text "OPENCHINACODE", cyberpunk style","size":"2K"}',
    )
    expect(repaired).toEqual({
      prompt: 'make a poster with text "OPENCHINACODE", cyberpunk style',
      size: "2K",
    })
  })

  test("repairs bare double quotes inside video prompt with following fields", () => {
    expect(
      parseToolArguments(
        "video_generate",
        '{"prompt":"camera pans across a sign saying "Made in China", neon night","ratio":"16:9","duration":5}',
      ),
    ).toEqual({
      prompt: 'camera pans across a sign saying "Made in China", neon night',
      ratio: "16:9",
      duration: 5,
    })
  })

  test("does not repair non-media tools", () => {
    expect(repairMediaPromptToolArguments("bash", '{"prompt":"say "hello""}')).toBeUndefined()
  })
})
