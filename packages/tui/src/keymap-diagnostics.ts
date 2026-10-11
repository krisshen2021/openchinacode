// Diagnostics for silent keyboard freezes.
//
// Background: opentui's KeyHandler.processParsedKey wraps the whole "keypress"
// emit in try/catch and reports failures with console.error, which lands in
// opentui's hidden in-memory console — invisible to users. When some keypress
// listener throws persistently, every key dies while mouse and textarea input
// (a separate path) keep working. This module mirrors those errors to a file
// and adds a SIGUSR2 state dump so the next freeze leaves evidence.

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs"
import path from "node:path"
import type { CliRenderer } from "@opentui/core"
import { getOpencodeModeStack, type OpenTuiKeymap } from "./keymap"

const MAX_BYTES = 5 * 1024 * 1024

export type KeymapDiagnosticsInput = {
  keymap: OpenTuiKeymap
  renderer: CliRenderer
  logDir: string
}

export function installKeymapDiagnostics(input: KeymapDiagnosticsInput) {
  mkdirSync(input.logDir, { recursive: true })
  const file = path.join(input.logDir, "tui-keymap.log")
  rotate(file)

  const write = (kind: string, payload: unknown) => {
    try {
      const detail =
        payload instanceof Error
          ? `${payload.message}\n${payload.stack ?? ""}`
          : typeof payload === "string"
            ? payload
            : JSON.stringify(payload)
      appendFileSync(file, `${new Date().toISOString()} [${kind}] ${detail}\n`)
    } catch {
      // diagnostics must never break the app
    }
  }

  const originalError = console.error
  console.error = (...args: unknown[]) => {
    write(
      "console.error",
      args.map((item) => (item instanceof Error ? `${item.message}\n${item.stack ?? ""}` : String(item))).join(" "),
    )
    originalError.apply(console, args)
  }
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    write(
      "console.warn",
      args.map((item) => (item instanceof Error ? `${item.message}\n${item.stack ?? ""}` : String(item))).join(" "),
    )
    originalWarn.apply(console, args)
  }

  const offKeymapError = input.keymap.on("error", (event) => {
    const { code, message, error } = event as { code?: string; message?: string; error?: unknown }
    write("keymap.error", `${code ?? ""} ${message ?? ""}${error instanceof Error ? `\n${error.stack ?? error.message}` : ""}`)
  })

  const dump = () => {
    write("dump", `SIGUSR2 state dump (pid ${process.pid})`)
    // Each probe is wrapped individually: if one of these calls throws, that
    // throw is itself the prime suspect — record it and keep probing.
    probe(write, "mode", () => getOpencodeModeStack(input.keymap).current())
    probe(write, "pendingSequence", () => JSON.stringify(input.keymap.getPendingSequence()))
    probe(write, "activeKeys", () => JSON.stringify(input.keymap.getActiveKeys()).slice(0, 2000))
    probe(write, "focusedEditor", () => {
      const editor = input.renderer.currentFocusedEditor
      return editor ? `${editor.constructor.name}#${editor.id}` : "none"
    })
    probe(write, "keypressListeners", () => String(input.renderer.keyInput.listenerCount("keypress")))
  }
  process.on("SIGUSR2", dump)

  return () => {
    console.error = originalError
    console.warn = originalWarn
    offKeymapError()
    process.off("SIGUSR2", dump)
  }
}

function probe(write: (kind: string, payload: unknown) => void, name: string, fn: () => unknown) {
  try {
    write("dump", `${name}: ${fn()}`)
  } catch (error) {
    write("dump.throw", `${name} threw: ${error instanceof Error ? `${error.message}\n${error.stack}` : error}`)
  }
}

function rotate(file: string) {
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, file + ".old")
  } catch {
    // missing file is fine
  }
}
