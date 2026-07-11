import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"
import * as Jsonc from "@opencode-ai/core/jsonc"

export type PermissionAction = "ask" | "allow" | "deny"
export type PermissionRuleConfig = PermissionAction | Record<string, PermissionAction>
export type PermissionConfig = PermissionAction | Record<string, PermissionRuleConfig>
export type PermissionPreset = "trust-all" | "safe" | "ask" | "readonly" | "reset"
export type PermissionRule = { permission: string; pattern: string; action: PermissionAction }

const CONFIG_SCHEMA = "https://opencode.ai/config.json"
const GLOBAL_CONFIG_FILES = ["openchinacode.jsonc", "openchinacode.json", "config.json"] as const
const PROJECT_CONFIG_FILES = ["openchinacode.jsonc", "openchinacode.json"] as const

const SAFE_PERMISSION: PermissionConfig = {
  read: "allow",
  glob: "allow",
  grep: "allow",
  list: "allow",
  task: "allow",
  lsp: "allow",
  todowrite: "allow",
  question: "allow",
  webfetch: "allow",
  websearch: "ask",
  edit: "ask",
  bash: "ask",
  external_directory: "ask",
  doom_loop: "ask",
}

const READONLY_PERMISSION: PermissionConfig = {
  read: "allow",
  glob: "allow",
  grep: "allow",
  list: "allow",
  webfetch: "allow",
  websearch: "allow",
  lsp: "allow",
  question: "allow",
  task: "ask",
  bash: "ask",
  external_directory: "ask",
  edit: "deny",
  todowrite: "deny",
  doom_loop: "deny",
}

export const permissionPresetInfo: Record<PermissionPreset, { title: string; description: string; details: string[] }> =
  {
    "trust-all": {
      title: "Project Trust All",
      description: "Allow every tool permission in this project.",
      details: ["Best for trusted local repos.", 'Writes permission: "allow" to project config.'],
    },
    safe: {
      title: "Project Safe",
      description: "Allow reads/search/subtasks; ask before edits, shell, web search, and external directories.",
      details: ["Good default for active coding.", "Keeps destructive or high-cost actions visible."],
    },
    ask: {
      title: "Project Ask Everything",
      description: "Ask before every tool permission in this project.",
      details: ["Maximum visibility.", "Useful when auditing unfamiliar code."],
    },
    readonly: {
      title: "Project Readonly",
      description: "Allow inspection tools but deny edits and todo writes.",
      details: ["Shell still asks because read-only shell commands can vary.", "Use this for review-only sessions."],
    },
    reset: {
      title: "Reset Project Permissions",
      description: "Remove the project permission block and return to defaults/global config.",
      details: ["Does not change provider/model/task policy settings.", "Current runtime override is cleared."],
    },
  }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isAction(value: unknown): value is PermissionAction {
  return value === "ask" || value === "allow" || value === "deny"
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

export function projectPermissionConfigDirectory(input: { worktree?: string; directory?: string }) {
  const root = input.worktree && input.worktree !== "/" ? input.worktree : input.directory
  return root ? path.join(root, ".openchinacode") : undefined
}

export async function projectPermissionConfigFile(input: { worktree?: string; directory?: string }) {
  const directory = projectPermissionConfigDirectory(input)
  if (!directory) return undefined
  return chooseExistingFile(directory, PROJECT_CONFIG_FILES)
}

export async function globalPermissionConfigFile() {
  return chooseExistingFile(Global.Path.config, GLOBAL_CONFIG_FILES)
}

function parseConfigRoot(text: string): Record<string, unknown> {
  const parsed = Jsonc.parse(configSeed(text))
  return isRecord(parsed) ? parsed : {}
}

function normalizePermissionConfig(value: unknown): Record<string, PermissionRuleConfig> {
  if (isAction(value)) return { "*": value }
  if (!isRecord(value)) return {}

  const result: Record<string, PermissionRuleConfig> = {}
  for (const [permission, rule] of Object.entries(value)) {
    if (isAction(rule)) {
      result[permission] = rule
      continue
    }
    if (!isRecord(rule)) continue
    const patterns: Record<string, PermissionAction> = {}
    for (const [pattern, action] of Object.entries(rule)) {
      if (isAction(action)) patterns[pattern] = action
    }
    result[permission] = patterns
  }
  return result
}

function expandPattern(pattern: string) {
  if (pattern.startsWith("~/")) return homedir() + pattern.slice(1)
  if (pattern === "~") return homedir()
  if (pattern.startsWith("$HOME/")) return homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return homedir() + pattern.slice(5)
  return pattern
}

export function permissionRulesFromConfig(value: unknown): PermissionRule[] {
  if (isAction(value)) return [{ permission: "*", pattern: "*", action: value }]
  const config = normalizePermissionConfig(value)
  const result: PermissionRule[] = []
  for (const [permission, rule] of Object.entries(config)) {
    if (isAction(rule)) {
      result.push({ permission, pattern: "*", action: rule })
      continue
    }
    for (const [pattern, action] of Object.entries(rule)) {
      result.push({ permission, pattern: expandPattern(pattern), action })
    }
  }
  return result
}

export function permissionRulesForAllow(permission: string, patterns: readonly string[]): PermissionRule[] {
  const values = patterns.length > 0 ? patterns : ["*"]
  return values.map((pattern) => ({ permission, pattern: expandPattern(pattern), action: "allow" as const }))
}

export function permissionConfigForPreset(preset: PermissionPreset): PermissionConfig | undefined {
  switch (preset) {
    case "trust-all":
      return "allow"
    case "safe":
      return SAFE_PERMISSION
    case "ask":
      return "ask"
    case "readonly":
      return READONLY_PERMISSION
    case "reset":
      return undefined
  }
}

export function describePermissionConfig(value: unknown) {
  if (value === undefined) return "default"
  if (value === "allow") return "trust all"
  if (value === "ask") return "ask everything"
  if (value === "deny") return "deny all"
  if (!isRecord(value)) return "custom"
  const normalized = normalizePermissionConfig(value)
  if (normalized["*"] === "allow") return "trust all"
  if (normalized["*"] === "ask") return "ask everything"
  if (normalized.edit === "deny" && normalized.todowrite === "deny") return "readonly/custom"
  if (normalized.edit === "ask" && normalized.bash === "ask") return "safe/custom"
  return "custom"
}

async function patchConfigFile(file: string, patch: Record<string, unknown>) {
  const text = await readText(file)
  const before = configSeed(text)
  const after = Jsonc.patch(before, patch)
  await mkdir(path.dirname(file), { recursive: true })
  if (after !== text) await writeFile(file, after)
  return { file, changed: after !== text }
}

export async function writePermissionPreset(file: string, preset: PermissionPreset) {
  return patchConfigFile(file, { permission: permissionConfigForPreset(preset) })
}

export async function writePersistentPermissionAllow(file: string, permission: string, patterns: readonly string[]) {
  const text = await readText(file)
  const root = parseConfigRoot(text)
  const current = normalizePermissionConfig(root.permission)
  const existing = current[permission]
  const nextRule: Record<string, PermissionAction> = isAction(existing) ? { "*": existing } : { ...(existing ?? {}) }
  for (const pattern of patterns.length > 0 ? patterns : ["*"]) {
    nextRule[pattern] = "allow"
  }
  current[permission] = nextRule
  return patchConfigFile(file, { permission: current })
}

export async function applyRuntimePermissionRules(input: {
  baseUrl: string
  fetch: typeof fetch
  directory?: string
  workspace?: string
  rules: readonly PermissionRule[]
}) {
  const url = new URL("/permission/runtime", input.baseUrl)
  if (input.directory) url.searchParams.set("directory", input.directory)
  if (input.workspace) url.searchParams.set("workspace", input.workspace)
  const response = await input.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.rules),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(text || `Permission runtime update failed: HTTP ${response.status}`)
  }
}
