import { describe, expect, test } from "bun:test"
import { shouldUseVisualPreprocess, supportsDirectImageInput } from "../../src/component/prompt/visual-preprocess"

const imageModel = {
  capabilities: {
    attachment: true,
    input: {
      image: true,
    },
  },
}

const textModel = {
  capabilities: {
    attachment: false,
    input: {
      image: false,
    },
  },
}

describe("prompt visual preprocessing", () => {
  test("detects models that can receive pasted images directly", () => {
    expect(supportsDirectImageInput(imageModel)).toBe(true)
    expect(supportsDirectImageInput(textModel)).toBe(false)
    expect(supportsDirectImageInput(undefined)).toBe(false)
  })

  test("uses visual subagent only when pasted images cannot go to the current model", () => {
    expect(
      shouldUseVisualPreprocess({
        imageCount: 1,
        isPromptCommand: false,
        model: imageModel,
      }),
    ).toBe(false)

    expect(
      shouldUseVisualPreprocess({
        imageCount: 1,
        isPromptCommand: false,
        model: textModel,
      }),
    ).toBe(true)
  })

  test("does not preprocess slash commands or prompts without images", () => {
    expect(
      shouldUseVisualPreprocess({
        imageCount: 1,
        isPromptCommand: true,
        model: textModel,
      }),
    ).toBe(false)

    expect(
      shouldUseVisualPreprocess({
        imageCount: 0,
        isPromptCommand: false,
        model: textModel,
      }),
    ).toBe(false)
  })
})
