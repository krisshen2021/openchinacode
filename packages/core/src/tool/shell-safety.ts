export * as ShellSafety from "./shell-safety"

const KILL_TARGET = /(?:node|npm|bun|tsx|vite|next|nuxt|python|uvicorn|server|dev)/i

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"])
const LONG_RUNNING_SCRIPTS = new Set(["dev", "start", "serve", "preview"])
const LONG_RUNNING_COMMANDS = new Set(["tsx", "vite", "uvicorn", "flask", "fastapi"])
const KILLALL_TARGETS = new Set(["node", "npm", "bun", "tsx", "vite", "next", "nuxt", "python", "uvicorn"])
const BACKGROUND_LAUNCHERS = new Set(["nohup", "setsid", "disown"])

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

// Split a command line into pipeline/sequence segments. Shell control
// operators (|, ;, &&, ||, &) inside quotes or after an escape are literal.
function segments(command: string) {
  const result: string[] = []
  let current = ""
  let quote: string | undefined
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (ch === "\\" && quote !== "'") {
      current += ch + (command[i + 1] ?? "")
      i++
      continue
    }
    if (ch === quote) {
      quote = undefined
      current += ch
      continue
    }
    if (!quote && (ch === '"' || ch === "'")) {
      quote = ch
      current += ch
      continue
    }
    if (!quote && (ch === "|" || ch === ";" || ch === "&")) {
      if (command[i + 1] === ch) i++
      result.push(current)
      current = ""
      continue
    }
    current += ch
  }
  result.push(current)
  return result
}

function tokens(segment: string) {
  const raw = segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
  return raw.map((token) => token.replace(/^(['"])(.*)\1$/, "$2"))
}

function basename(token: string | undefined) {
  if (!token) return ""
  const name = token.split(/[\\/]/).pop() ?? ""
  return name.replace(/\.(exe|cmd|bat|ps1)$/i, "")
}

// Resolve the executable of one segment, skipping leading VAR=value
// assignments and unwrapping sudo/env prefixes.
function resolveCommand(list: string[]): { name: string; args: string[] } | undefined {
  let i = 0
  while (i < list.length && ENV_ASSIGNMENT.test(list[i])) i++
  let name = basename(list[i])
  while (name === "sudo" || name === "env") {
    i++
    while (i < list.length && (list[i].startsWith("-") || ENV_ASSIGNMENT.test(list[i]))) i++
    name = basename(list[i])
  }
  if (!name) return undefined
  return { name, args: list.slice(i + 1) }
}

function hasBroadKill(command: string) {
  for (const segment of segments(command)) {
    const resolved = resolveCommand(tokens(segment))
    if (!resolved) continue
    if (resolved.name === "pkill" && resolved.args.includes("-f") && KILL_TARGET.test(segment)) return true
    if (resolved.name === "killall" && resolved.args.some((arg) => KILLALL_TARGETS.has(arg.toLowerCase()))) return true
    if (resolved.name === "xargs" && resolved.args[0] === "kill") return true
  }
  return false
}

function startsLongRunningService(command: string) {
  for (const segment of segments(command)) {
    const resolved = resolveCommand(tokens(segment))
    if (!resolved) continue
    const { name, args } = resolved
    if (PACKAGE_MANAGERS.has(name)) {
      const script = args[0] === "run" ? args[1] : args[0]
      if (script !== undefined && LONG_RUNNING_SCRIPTS.has(script)) return true
      continue
    }
    if (name === "npx" && args[0] === "tsx") return true
    if (LONG_RUNNING_COMMANDS.has(name)) return true
    if ((name === "next" || name === "nuxt") && args[0] === "dev") return true
    if ((name === "python" || name === "python3") && args[0] === "-m" && args[1] === "http.server") return true
  }
  return false
}

// A single & outside quotes is a background launch. &&, &>, and >& are not.
function hasSingleBackgroundAmpersand(command: string) {
  let quote: string | undefined
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (ch === "\\" && quote !== "'") {
      i++
      continue
    }
    if (ch === quote) {
      quote = undefined
      continue
    }
    if (!quote && (ch === '"' || ch === "'")) {
      quote = ch
      continue
    }
    if (quote || ch !== "&") continue
    if (command[i - 1] === "&" || command[i + 1] === "&") continue
    if (command[i + 1] === ">" || command[i - 1] === ">") continue
    return true
  }
  return false
}

function hasRawBackgroundLaunch(command: string) {
  for (const segment of segments(command)) {
    const resolved = resolveCommand(tokens(segment))
    if (resolved && BACKGROUND_LAUNCHERS.has(resolved.name)) return true
  }
  return hasSingleBackgroundAmpersand(command)
}

export function safetyBlock(command: string) {
  if (hasBroadKill(command)) {
    return [
      "Command blocked by OpenChinaCode shell safety policy.",
      "",
      "Reason: broad process-kill patterns such as pkill -f, killall, or xargs kill can terminate unrelated user processes and have caused unstable tool runs.",
      "",
      "Use process_stop for OpenChinaCode-managed processes. For an unmanaged external process, inspect exact PIDs first and stop only the specific PID.",
    ].join("\n")
  }
  if (startsLongRunningService(command)) {
    return [
      "Command blocked by OpenChinaCode shell safety policy.",
      "",
      "Reason: this looks like a long-running server, watcher, preview, or background launch. Running it through bash makes the tool wait until timeout or lose ownership of the child process.",
      "",
      "Use process_start with workdir/name/log/readiness options, then process_status, process_logs, and process_stop for lifecycle control.",
    ].join("\n")
  }
  if (hasRawBackgroundLaunch(command)) {
    return [
      "Command blocked by OpenChinaCode shell safety policy.",
      "",
      "Reason: raw background launches with &, nohup, setsid, or disown are not observable or stoppable by the bash tool.",
      "",
      "Use process_start for managed background work, or run a short foreground command that exits.",
    ].join("\n")
  }
  return
}
