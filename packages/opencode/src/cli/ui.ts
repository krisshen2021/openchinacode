import { EOL } from "os"
import { Schema } from "effect"
import { logo as glyphs } from "./logo"

export class CancelledError extends Schema.TaggedErrorClass<CancelledError>()("UICancelledError", {}) {}

export const Style = {
  TEXT_HIGHLIGHT: "\x1b[96m",
  TEXT_HIGHLIGHT_BOLD: "\x1b[96m\x1b[1m",
  TEXT_DIM: "\x1b[90m",
  TEXT_DIM_BOLD: "\x1b[90m\x1b[1m",
  TEXT_NORMAL: "\x1b[0m",
  TEXT_NORMAL_BOLD: "\x1b[1m",
  TEXT_WARNING: "\x1b[93m",
  TEXT_WARNING_BOLD: "\x1b[93m\x1b[1m",
  TEXT_DANGER: "\x1b[91m",
  TEXT_DANGER_BOLD: "\x1b[91m\x1b[1m",
  TEXT_SUCCESS: "\x1b[92m",
  TEXT_SUCCESS_BOLD: "\x1b[92m\x1b[1m",
  TEXT_INFO: "\x1b[94m",
  TEXT_INFO_BOLD: "\x1b[94m\x1b[1m",
  TEXT_PINK_BOLD: "\x1b[95m\x1b[1m",
}

export function println(...message: string[]) {
  print(...message)
  process.stderr.write(EOL)
}

export function print(...message: string[]) {
  blank = false
  process.stderr.write(message.join(" "))
}

let blank = false
export function empty() {
  if (blank) return
  println("" + Style.TEXT_NORMAL)
  blank = true
}

export function logo(pad?: string) {
  const reset = "\x1b[0m"
  const plain = (line: string) => line.replaceAll("_", " ").replaceAll("^", "▀").replaceAll("~", "▀")

  if (!process.stdout.isTTY && !process.stderr.isTTY) {
    const result = []
    for (let i = 0; i < glyphs.left.length; i += 1) {
      if (pad) result.push(pad)
      result.push([plain(glyphs.left[i] ?? ""), plain(glyphs.china[i] ?? ""), plain(glyphs.right[i] ?? "")].join(" "))
      result.push(EOL)
    }
    return result.join("").trimEnd()
  }

  const result: string[] = []
  const left = {
    fg: "\x1b[90m",
    shadow: "\x1b[38;5;235m",
    bg: "\x1b[48;5;235m",
  }
  const china = {
    fg: "\x1b[38;2;255;79;184m\x1b[1m",
    shadow: "\x1b[38;5;198m",
    bg: "\x1b[48;5;198m",
  }
  const right = {
    fg: reset + "\x1b[1m",
    shadow: "\x1b[38;5;238m",
    bg: "\x1b[48;5;238m",
  }
  const draw = (line: string, fg: string, shadow: string, bg: string) => {
    const parts: string[] = []
    for (const char of line) {
      if (char === "░") {
        parts.push(shadow, "░", reset)
        continue
      }
      if (char === "_") {
        parts.push(bg, " ", reset)
        continue
      }
      if (char === "^") {
        parts.push(fg, bg, "▀", reset)
        continue
      }
      if (char === "~") {
        parts.push(shadow, "▀", reset)
        continue
      }
      if (char === " ") {
        parts.push(" ")
        continue
      }
      parts.push(fg, char, reset)
    }
    return parts.join("")
  }
  glyphs.left.forEach((row, index) => {
    if (pad) result.push(pad)
    result.push(draw(row, left.fg, left.shadow, left.bg))
    result.push(" ")
    result.push(draw(glyphs.china[index] ?? "", china.fg, china.shadow, china.bg))
    result.push(" ")
    result.push(draw(glyphs.right[index] ?? "", right.fg, right.shadow, right.bg))
    result.push(EOL)
  })
  return result.join("").trimEnd()
}

export async function input(prompt: string): Promise<string> {
  const readline = require("readline")
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export function error(message: string) {
  if (message.startsWith("Error: ")) {
    message = message.slice("Error: ".length)
  }
  println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
}

export function markdown(text: string): string {
  return text
}

export * as UI from "./ui"
