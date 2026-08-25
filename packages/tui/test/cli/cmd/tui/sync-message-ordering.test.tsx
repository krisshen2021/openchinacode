/** @jsxImportSource @opentui/solid */
/**
 * Regression for the 2026-08-14 48-bit ID wrap: pre-wrap IDs (msg_fff8...)
 * sort after newer IDs (msg_001c.../msg_6800...), so the TUI's binary-search
 * insertion placed message.updated events in the middle of the store array
 * and new replies never appeared at the bottom of the transcript.
 */
import { expect, test } from "bun:test"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"

const sessionID = "ses_wrap_ordering"
const directory = "/tmp/opencode/packages/opencode"

const session = {
  id: sessionID,
  title: "wrap",
  time: { created: 0, updated: 0 },
  version: "1.15.13",
  directory,
}

const preWrapAssistant = {
  id: "msg_fff8b38850027vchR7UdWcnSy7",
  sessionID,
  role: "assistant" as const,
  agent: "build",
  modelID: "model",
  providerID: "test",
  mode: "build",
  parentID: "msg_fff899749001TATB316TPMdQlG",
  path: { cwd: directory, root: directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1000, completed: 1001 },
}

const postWrapUser = {
  id: "msg_001c73561001wbDbeIB4b56SDQ",
  sessionID,
  role: "user" as const,
  agent: "build",
  model: { providerID: "test", modelID: "model" },
  time: { created: 2000 },
}

const newAssistant = {
  ...preWrapAssistant,
  id: "msg_680098b089c2I2zLLLlDjyofv2",
  parentID: postWrapUser.id,
  time: { created: 3000 },
}

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory: "/tmp/other", project: "proj_test", payload }
}

test("message store stays chronological across mixed-era IDs and live events", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      return json([
        { info: preWrapAssistant, parts: [] },
        { info: postWrapUser, parts: [] },
      ])
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    await sync.session.sync(sessionID)

    // Hydration keeps server (chronological) order, not ID order.
    expect(sync.data.message[sessionID].map((message) => message.id)).toEqual([preWrapAssistant.id, postWrapUser.id])

    // A live message.updated event must land at the end (newest), not in the
    // middle where ID-binary-search used to place it.
    emit(global({ id: "evt_new", type: "message.updated", properties: { sessionID, info: newAssistant } }))
    await wait(() => sync.data.message[sessionID].length === 3)
    expect(sync.data.message[sessionID].map((message) => message.id)).toEqual([
      preWrapAssistant.id,
      postWrapUser.id,
      newAssistant.id,
    ])
    expect(sync.data.message[sessionID].at(-1)?.id).toBe(newAssistant.id)

    // Updating an existing message replaces it in place without duplicating.
    emit(
      global({
        id: "evt_complete",
        type: "message.updated",
        properties: { sessionID, info: { ...newAssistant, time: { created: 3000, completed: 3001 } } },
      }),
    )
    await wait(() => {
      const message = sync.data.message[sessionID].at(-1)
      return message?.role === "assistant" && message.time.completed === 3001
    })
    expect(sync.data.message[sessionID].length).toBe(3)
    expect(sync.data.message[sessionID].map((message) => message.id)).toEqual([
      preWrapAssistant.id,
      postWrapUser.id,
      newAssistant.id,
    ])
  } finally {
    app.renderer.destroy()
  }
})
