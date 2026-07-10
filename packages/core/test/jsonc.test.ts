import { describe, expect, test } from "bun:test"
import * as Jsonc from "@opencode-ai/core/jsonc"
import { parse } from "jsonc-parser"

describe("Jsonc", () => {
  test("patches nested values while preserving comments", () => {
    const input = `{
  // keep this comment
  "model": "zhipuai-pay2go/glm-5.2",
  "lsp": false
}`

    const output = Jsonc.patch(input, { lsp: true })

    expect(output).toContain("// keep this comment")
    expect(parse(output)).toMatchObject({
      model: "zhipuai-pay2go/glm-5.2",
      lsp: true,
    })
  })

  test("adds missing values", () => {
    const output = Jsonc.patch(`{\n  "$schema": "https://opencode.ai/config.json"\n}`, { lsp: true })

    expect(parse(output)).toEqual({
      $schema: "https://opencode.ai/config.json",
      lsp: true,
    })
  })
})
