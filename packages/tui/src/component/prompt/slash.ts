export type DirectSlashCommand = {
  command: string
  args: string
}

export function parseDirectSlashCommand(text: string): DirectSlashCommand | undefined {
  if (!text.startsWith("/")) return
  const body = text.slice(1).trim()
  if (!body) return
  const match = body.match(/^(\S+)(?:\s+([\s\S]*))?$/)
  if (!match) return
  return {
    command: match[1].toLowerCase(),
    args: (match[2] ?? "").trim(),
  }
}

export function parseLspSlashAction(args: string): "status" | "on" | "off" | "help" {
  const normalized = args.trim().toLowerCase()
  if (!normalized || normalized === "status") return "status"
  if (["on", "enable", "enabled", "true", "1"].includes(normalized)) return "on"
  if (["off", "disable", "disabled", "false", "0"].includes(normalized)) return "off"
  return "help"
}

export type CompactSlashAction = { type: "run"; manualKeepTurns?: number } | { type: "help" }

export function parseCompactSlashAction(args: string): CompactSlashAction {
  const trimmed = args.trim()
  if (!trimmed) return { type: "run" }

  const [command = "", value = "", ...rest] = trimmed.split(/\s+/)
  const normalized = command.toLowerCase()
  if (["auto", "smart"].includes(normalized)) return { type: "run" }
  if (normalized !== "keep" || rest.length > 0) return { type: "help" }
  if (["auto", "smart"].includes(value.toLowerCase())) return { type: "run" }

  const turns = Number(value)
  if (!Number.isInteger(turns) || turns < 0) return { type: "help" }
  return { type: "run", manualKeepTurns: turns }
}

export type TestMcpSlashAction =
  | { type: "status" }
  | { type: "on"; headless?: boolean }
  | { type: "off" }
  | { type: "toggle" }
  | { type: "help" }

export function parseTestMcpSlashAction(args: string): TestMcpSlashAction {
  const trimmed = args.trim()
  if (!trimmed) return { type: "status" }

  const [command = "", ...rest] = trimmed.split(/\s+/)
  const normalized = command.toLowerCase()
  const flags = new Set(rest.map((value) => value.toLowerCase()))
  const headless = flags.has("headed") ? false : flags.has("headless") ? true : undefined

  if (normalized === "status") return { type: "status" }
  if (["on", "enable", "enabled", "true", "1"].includes(normalized)) return { type: "on", headless }
  if (["headless"].includes(normalized)) return { type: "on", headless: true }
  if (["headed"].includes(normalized)) return { type: "on", headless: false }
  if (["off", "disable", "disabled", "false", "0"].includes(normalized)) return { type: "off" }
  if (["toggle", "switch"].includes(normalized)) return { type: "toggle" }
  return { type: "help" }
}

export type AutoMaxTokensSlashAction =
  | { type: "status" }
  | { type: "off" }
  | { type: "heuristic" }
  | { type: "llm"; model?: string }
  | { type: "model"; model: string }
  | { type: "help" }

export function parseAutoMaxTokensSlashAction(args: string): AutoMaxTokensSlashAction {
  const trimmed = args.trim()
  if (!trimmed) return { type: "status" }

  const [command = "", ...rest] = trimmed.split(/\s+/)
  const normalized = command.toLowerCase()
  const value = rest.join(" ").trim()
  if (normalized === "status") return { type: "status" }
  if (["off", "disable", "disabled", "false", "0"].includes(normalized)) return { type: "off" }
  if (["on", "enable", "enabled", "true", "1", "heuristic"].includes(normalized)) return { type: "heuristic" }
  if (normalized === "llm") return value ? { type: "llm", model: value } : { type: "llm" }
  if (normalized === "model") return value ? { type: "model", model: value } : { type: "help" }
  return { type: "help" }
}
