import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { installKeymapDiagnostics } from "../src/keymap-diagnostics"

const dirs: string[] = []

function fixture() {
  const logDir = mkdtempSync(path.join(tmpdir(), "keymap-diag-"))
  dirs.push(logDir)
  const errors: unknown[] = []
  const keymap = {
    on: (_name: string, fn: (event: unknown) => void) => {
      errors.push(fn)
      return () => {}
    },
    getPendingSequence: () => [],
    getActiveKeys: () => ["a", "b"],
  }
  const renderer = {
    currentFocusedEditor: undefined,
    keyInput: { listenerCount: () => 3 },
  }
  return { logDir, keymap, renderer, errors }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test("mirrors console.error to the log file and restores it on dispose", () => {
  const { logDir, keymap, renderer } = fixture()
  const original = console.error
  const dispose = installKeymapDiagnostics({ keymap: keymap as never, renderer: renderer as never, logDir })
  try {
    console.error("boom", new Error("keyboard died"))
    const content = readFileSync(path.join(logDir, "tui-keymap.log"), "utf8")
    expect(content).toContain("[console.error]")
    expect(content).toContain("boom")
    expect(content).toContain("keyboard died")
  } finally {
    dispose()
  }
  expect(console.error).toBe(original)
})

test("logs keymap error events with stack", () => {
  const { logDir, keymap, renderer, errors } = fixture()
  const dispose = installKeymapDiagnostics({ keymap: keymap as never, renderer: renderer as never, logDir })
  try {
    const handler = errors[0] as (event: unknown) => void
    handler({ code: "test-error", message: "probe", error: new Error("layer exploded") })
    const content = readFileSync(path.join(logDir, "tui-keymap.log"), "utf8")
    expect(content).toContain("[keymap.error]")
    expect(content).toContain("test-error")
    expect(content).toContain("layer exploded")
  } finally {
    dispose()
  }
})

test("SIGUSR2 dump records probe results and probe failures", async () => {
  const { logDir, keymap, renderer } = fixture()
  const broken = {
    ...keymap,
    getPendingSequence: () => {
      throw new Error("pending sequence exploded")
    },
  }
  const dispose = installKeymapDiagnostics({ keymap: broken as never, renderer: renderer as never, logDir })
  try {
    process.kill(process.pid, "SIGUSR2")
    await new Promise((resolve) => setTimeout(resolve, 50))
    const content = readFileSync(path.join(logDir, "tui-keymap.log"), "utf8")
    expect(content).toContain("SIGUSR2 state dump")
    expect(content).toContain("[dump.throw] pendingSequence threw: pending sequence exploded")
    expect(content).toContain("keypressListeners: 3")
  } finally {
    dispose()
  }
})
