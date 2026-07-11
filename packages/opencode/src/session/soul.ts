import path from "node:path"
import { readFile } from "node:fs/promises"
import { Effect } from "effect"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import PROMPT_SOUL_RIGOROUS from "./prompt/soul-rigorous.txt"
import PROMPT_SOUL_FRIENDLY from "./prompt/soul-friendly.txt"

export type SoulID = "rigorous" | "friendly" | "custom"

export const DEFAULT_SOUL: SoulID = "rigorous"
export const DEFAULT_CUSTOM_PATH = ".openchinacode/souls/custom.md"

type SoulConfig = NonNullable<ConfigV1.Info["soul"]>

export function isSoulID(value: unknown): value is SoulID {
  return value === "rigorous" || value === "friendly" || value === "custom"
}

export function normalizeConfig(value: unknown): { active: SoulID; custom_path?: string } {
  if (isSoulID(value)) return { active: value }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { active: DEFAULT_SOUL }
  const config = value as { active?: unknown; custom_path?: unknown }
  return {
    active: isSoulID(config.active) ? config.active : DEFAULT_SOUL,
    custom_path: typeof config.custom_path === "string" && config.custom_path.trim() ? config.custom_path.trim() : undefined,
  }
}

export function customPath(input: { config?: SoulConfig; directory: string; worktree?: string }) {
  const normalized = normalizeConfig(input.config)
  const raw = normalized.custom_path ?? DEFAULT_CUSTOM_PATH
  if (path.isAbsolute(raw)) return raw
  if (raw.startsWith("~/")) return path.join(process.env.HOME ?? "", raw.slice(2))
  const root = input.worktree && input.worktree !== "/" ? input.worktree : input.directory
  return path.resolve(root, raw)
}

export function resolve(input: {
  config?: SoulConfig
  directory: string
  worktree?: string
}): Effect.Effect<string | undefined> {
  return Effect.gen(function* () {
    const normalized = normalizeConfig(input.config)
    if (normalized.active === "rigorous") return PROMPT_SOUL_RIGOROUS
    if (normalized.active === "friendly") return PROMPT_SOUL_FRIENDLY

    const file = customPath(input)
    const text = yield* Effect.promise(() => readFile(file, "utf8").catch(() => ""))
    const trimmed = text.trim()
    if (!trimmed) return undefined
    return `<openchinacode_soul name="custom" source="${file}">\n${trimmed}\n</openchinacode_soul>`
  })
}

export * as SystemSoul from "./soul"
