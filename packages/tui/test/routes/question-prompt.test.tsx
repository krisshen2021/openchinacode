/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createEventSource, createFetch, directory, json } from "../fixture/tui-sdk"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function clickText(app: Awaited<ReturnType<typeof testRender>>, lineIncludes: string[], text: string) {
  const lines = app.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => lineIncludes.every((part) => line.includes(part)))
  const x = lines[y]?.indexOf(text) ?? -1
  expect(y).toBeGreaterThanOrEqual(0)
  expect(x).toBeGreaterThanOrEqual(0)
  await app.mockMouse.click(x + 1, y)
}

async function mountQuestion(root: string) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const events = createEventSource()
  const calls = createFetch(undefined, events)
  const replies: unknown[] = []
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === "/question/question-1/reply") {
      replies.push(input instanceof Request ? await input.clone().json() : undefined)
      return json(true)
    }
    return calls.fetch(input)
  }) as typeof globalThis.fetch

  const request: QuestionRequest = {
    id: "question-1",
    sessionID: "session-1",
    questions: [
      {
        header: "First",
        question: "Choose the first answer",
        options: [{ label: "Default", description: "Use the default" }],
      },
      {
        header: "Second",
        question: "Choose the second answer",
        options: [{ label: "Other", description: "Use the other value" }],
      },
    ],
  }

  const [
    { QuestionPrompt },
    { KVProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { ToastProvider },
    { SDKProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
  ] = await Promise.all([
    import("../../src/routes/session/question"),
    import("../../src/context/kv"),
    import("../../src/context/theme"),
    import("../../src/config"),
    import("../../src/ui/toast"),
    import("../../src/context/sdk"),
    import("../../src/keymap"),
  ])

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createTuiResolvedConfig({ leader_timeout: 1000 })
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)

    return (
      <TestTuiContexts directory={root} paths={{ home: root, state, worktree: root }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <SDKProvider url="http://test" directory={directory} events={events.source} fetch={fetch}>
                    <QuestionPrompt request={request} directory={directory} />
                  </SDKProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true, width: 100, height: 30 })
  return { app, replies }
}

test("confirm tab stays keyboard operable while a custom answer is being edited", async () => {
  await using tmp = await tmpdir()
  const { app, replies } = await mountQuestion(tmp.path)
  try {
    await wait(() => app.captureCharFrame().includes("Confirm"))
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await wait(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    await app.mockInput.typeText("custom answer")

    const lines = app.captureCharFrame().split("\n")
    const y = lines.findIndex((line) => line.includes("Confirm"))
    const x = lines[y]?.indexOf("Confirm") ?? -1
    expect(x).toBeGreaterThanOrEqual(0)
    await app.mockMouse.click(x + 1, y)
    await wait(() => app.captureCharFrame().includes("Review"))

    app.mockInput.pressEnter()
    await Bun.sleep(100)

    expect(replies).toEqual([{ answers: [["custom answer"], []] }])
  } finally {
    app.renderer.destroy()
  }
})

test("picking a normal option after editing a custom answer does not reuse a destroyed editor", async () => {
  await using tmp = await tmpdir()
  const { app, replies } = await mountQuestion(tmp.path)
  const parserErrors: unknown[][] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    if (
      args.some((arg) => {
        const text = String(arg)
        return text.includes("stdin-parser-error") || text.includes("EditBuffer is destroyed")
      })
    ) {
      parserErrors.push(args)
    }
    originalError(...args)
  }

  try {
    await wait(() => app.captureCharFrame().includes("Confirm"))
    app.mockInput.pressArrow("right")
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await wait(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const editor = app.renderer.currentFocusedEditor
    if (!(editor instanceof TextareaRenderable)) throw new Error("expected custom answer editor")
    await app.mockInput.typeText("draft")

    await wait(() => app.captureCharFrame().includes("Choose the second answer"))
    await clickText(app, ["Other"], "Other")
    await wait(() => app.captureCharFrame().includes("Review"))
    await wait(() => editor.isDestroyed)

    await clickText(app, ["First", "Second", "Confirm"], "Second")
    app.mockInput.pressArrow("right")
    app.mockInput.pressEnter()
    await Bun.sleep(100)

    expect(parserErrors).toEqual([])
    expect(replies).toEqual([{ answers: [[], ["Other"]] }])
  } finally {
    console.error = originalError
    app.renderer.destroy()
  }
})
