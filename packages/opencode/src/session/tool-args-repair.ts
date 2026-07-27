const REPAIRABLE_PROMPT_TOOLS = new Set(["image_generate", "video_generate"])

function isRepairablePromptTool(toolName: string) {
  return REPAIRABLE_PROMPT_TOOLS.has(toolName.toLowerCase())
}

function isEscaped(value: string, index: number) {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && value[i] === "\\"; i--) backslashes++
  return backslashes % 2 === 1
}

function isLikelyPromptEnd(value: string, quoteIndex: number) {
  const rest = value.slice(quoteIndex + 1)
  return /^\s*}/.test(rest) || /^\s*,\s*"[A-Za-z_][A-Za-z0-9_]*"\s*:/.test(rest)
}

function escapeJsonStringFragment(value: string) {
  let output = ""
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char === '"' && !isEscaped(value, i)) {
      output += '\\"'
      continue
    }
    if (char === "\n") {
      output += "\\n"
      continue
    }
    if (char === "\r") {
      output += "\\r"
      continue
    }
    if (char === "\t") {
      output += "\\t"
      continue
    }
    output += char
  }
  return output
}

export function repairMediaPromptToolArguments(toolName: string, argsJson: string) {
  if (!isRepairablePromptTool(toolName)) return undefined

  const match = /"prompt"\s*:\s*"/.exec(argsJson)
  if (!match) return undefined

  const valueStart = match.index + match[0].length
  let valueEnd = -1
  for (let i = valueStart; i < argsJson.length; i++) {
    if (argsJson[i] !== '"' || isEscaped(argsJson, i)) continue
    if (isLikelyPromptEnd(argsJson, i)) {
      valueEnd = i
      break
    }
  }
  if (valueEnd < 0) return undefined

  const repaired =
    argsJson.slice(0, valueStart) +
    escapeJsonStringFragment(argsJson.slice(valueStart, valueEnd)) +
    argsJson.slice(valueEnd)

  try {
    return JSON.parse(repaired) as unknown
  } catch {
    return undefined
  }
}

export function parseToolArguments(toolName: string, argsJson: string) {
  try {
    return JSON.parse(argsJson) as unknown
  } catch (error) {
    const repaired = repairMediaPromptToolArguments(toolName, argsJson)
    if (repaired !== undefined) return repaired
    throw error
  }
}
