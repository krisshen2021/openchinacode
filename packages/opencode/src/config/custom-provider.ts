export * as CustomProvider from "./custom-provider"

import path from "path"
import { Effect } from "effect"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"
import { FSUtil } from "@opencode-ai/core/fs-util"

export interface Input {
  readonly id: string
  readonly name?: string
  readonly baseURL: string
  readonly models: readonly string[]
  readonly discover_models: boolean
}

export interface Entry {
  readonly id: string
  readonly name?: string
  readonly baseURL: string
  readonly models: string[]
  readonly discover_models: boolean
}

const FILE = "openchinacode.jsonc"

export const save = Effect.fn("CustomProvider.save")(function* (dir: string, input: Input) {
  const fsys = yield* FSUtil.Service
  const file = path.join(dir, FILE)
  const text = yield* fsys.readFileString(file).pipe(Effect.orElseSucceed(() => ""))
  const base = text.trim() ? text : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n'
  const models: Record<string, { name: string }> = {}
  for (const id of input.models) models[id] = { name: id }
  const entry: Record<string, unknown> = {
    npm: "@ai-sdk/openai-compatible",
    options: { baseURL: input.baseURL },
    discover_models: input.discover_models,
    models,
  }
  if (input.name) entry.name = input.name
  const edits = modify(base, ["provider", input.id], entry, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })
  yield* fsys.writeFileString(file, applyEdits(base, edits)).pipe(Effect.orDie)
})

export const list = Effect.fn("CustomProvider.list")(function* (dir: string) {
  const fsys = yield* FSUtil.Service
  const file = path.join(dir, FILE)
  const text = yield* fsys.readFileString(file).pipe(Effect.orElseSucceed(() => ""))
  if (!text.trim()) return [] as Entry[]
  const parsed = parseJsonc(text) as { provider?: Record<string, any> }
  return Object.entries(parsed.provider ?? {})
    .filter(([, value]) => typeof value?.options?.baseURL === "string")
    .map(([id, value]) => ({
      id,
      name: value.name,
      baseURL: value.options.baseURL,
      models: Object.keys(value.models ?? {}),
      discover_models: value.discover_models ?? false,
    }))
})
