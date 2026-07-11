import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import * as Jsonc from "@opencode-ai/core/jsonc"

export type SoulID = "rigorous" | "friendly" | "custom"

const CONFIG_SCHEMA = "https://opencode.ai/config.json"
const PROJECT_CONFIG_FILES = ["openchinacode.jsonc", "openchinacode.json"] as const
export const DEFAULT_CUSTOM_SOUL_PATH = ".openchinacode/souls/custom.md"

export const soulInfo: Record<SoulID, { title: string; description: string }> = {
  rigorous: {
    title: "Rigorous Engineer",
    description: "Direct, precise, risk-aware engineering style. Default for OpenChinaCode.",
  },
  friendly: {
    title: "Friendly Engineer",
    description: "Warm, collaborative, and still technically grounded.",
  },
  custom: {
    title: "Custom Soul",
    description: "Use your own project personality from .openchinacode/souls/custom.md.",
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  )
}

function configSeed(text: string) {
  return text.trim() ? text : JSON.stringify({ $schema: CONFIG_SCHEMA }, null, 2)
}

async function readText(file: string) {
  try {
    return await readFile(file, "utf8")
  } catch (error) {
    if (isNotFoundError(error)) return ""
    throw error
  }
}

async function chooseExistingFile(directory: string, files: readonly string[]) {
  await mkdir(directory, { recursive: true })
  for (const name of files) {
    const file = path.join(directory, name)
    try {
      await readFile(file, "utf8")
      return file
    } catch (error) {
      if (isNotFoundError(error)) continue
      throw error
    }
  }
  return path.join(directory, files[0])
}

function patchConfigFile(file: string, patch: Record<string, unknown>) {
  return readText(file).then(async (text) => {
    const before = configSeed(text)
    const after = Jsonc.patch(before, patch)
    await mkdir(path.dirname(file), { recursive: true })
    if (after !== text) await writeFile(file, after)
    return { file, changed: after !== text }
  })
}

export function isSoulID(value: unknown): value is SoulID {
  return value === "rigorous" || value === "friendly" || value === "custom"
}

export function normalizeSoulConfig(value: unknown): { active: SoulID; custom_path?: string } {
  if (isSoulID(value)) return { active: value }
  if (!isRecord(value)) return { active: "rigorous" }
  return {
    active: isSoulID(value.active) ? value.active : "rigorous",
    custom_path: typeof value.custom_path === "string" && value.custom_path.trim() ? value.custom_path.trim() : undefined,
  }
}

export function projectSoulConfigDirectory(input: { worktree?: string; directory?: string }) {
  const root = input.worktree && input.worktree !== "/" ? input.worktree : input.directory
  return root ? path.join(root, ".openchinacode") : undefined
}

export async function projectSoulConfigFile(input: { worktree?: string; directory?: string }) {
  const directory = projectSoulConfigDirectory(input)
  if (!directory) return undefined
  return chooseExistingFile(directory, PROJECT_CONFIG_FILES)
}

export function projectCustomSoulFile(input: { worktree?: string; directory?: string }) {
  const root = input.worktree && input.worktree !== "/" ? input.worktree : input.directory
  return root ? path.join(root, DEFAULT_CUSTOM_SOUL_PATH) : undefined
}

export async function readCustomSoul(file: string | undefined) {
  if (!file) return ""
  return readText(file)
}

export async function writeSoulConfig(file: string, soul: SoulID) {
  return patchConfigFile(file, {
    soul: soul === "custom" ? { active: "custom", custom_path: DEFAULT_CUSTOM_SOUL_PATH } : { active: soul },
  })
}

export async function writeCustomSoul(input: { configFile: string; customFile: string; content: string }) {
  await mkdir(path.dirname(input.customFile), { recursive: true })
  await writeFile(input.customFile, input.content.trim() + "\n")
  return writeSoulConfig(input.configFile, "custom")
}
