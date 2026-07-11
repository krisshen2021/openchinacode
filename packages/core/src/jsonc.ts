export * as Jsonc from "./jsonc"

import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function patch(input: string, value: unknown, path: string[] = []): string {
  if (!isRecord(value)) {
    const edits = modify(input, path, value, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    return applyEdits(input, edits)
  }

  return Object.entries(value).reduce((result, [key, child]) => patch(result, child, [...path, key]), input)
}

export function parse(input: string): unknown {
  return parseJsonc(input)
}
