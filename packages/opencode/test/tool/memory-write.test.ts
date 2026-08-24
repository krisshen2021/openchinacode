import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionMemory } from "@opencode-ai/core/session/memory"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Agent } from "@/agent/agent"
import { MessageID, SessionID } from "@/session/schema"
import * as Truncate from "@/tool/truncate"
import { MemoryWriteTool } from "@/tool/memory-write"
import { Tool } from "@/tool/tool"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, SessionMemory.node])))

const mocks = Layer.mergeAll(
  Layer.mock(Truncate.Service, {
    output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
  }),
  Layer.mock(Agent.Service, {
    get: () => Effect.succeed({ name: "build", permission: [] } as any),
  }),
)

const sessionID = SessionID.make("ses_memory_write_tool")
const ctx: Tool.Context = {
  sessionID,
  messageID: MessageID.make("msg_memory_write_tool"),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("memory_write tool", () => {
  it.live("appends to the log and overwrites passed state fields", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()
        .pipe(Effect.orDie)

      const def = yield* MemoryWriteTool.pipe(Effect.flatMap(Tool.init), Effect.provide(mocks))
      const result = yield* def.execute(
        {
          objective: "test the tool",
          pitfalls: [{ trap: "pm2 revives the port", why: "watchdog respawn", workaround: "pm2 delete first" }],
        },
        ctx,
      )
      expect(result.title).toBe("memory updated")
      expect(result.output).toContain("pm2 revives the port")

      const memory = yield* SessionMemory.Service
      const row = yield* memory.getRow(sessionID)
      expect(row?.content.state.objective).toBe("test the tool")
      expect(row?.content.log.pitfalls[0]?.workaround).toBe("pm2 delete first")
      expect(row?.content.log.pitfalls[0]?.at).toBeGreaterThan(0)
      expect(row?.source).toBe("tool")
    }),
  )
})
