import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import path from "path"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { SessionSteer } from "../../src/session/steer"
import { SessionStatus } from "../../src/session/status"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Format } from "../../src/format"
import { TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { raw, TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    touch: () => Effect.void,
    instructions: () => Effect.succeed([]),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in steer integration tests"),
    authenticate: () => Effect.die("unexpected MCP auth in steer integration tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in steer integration tests"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const runtimeFlags = RuntimeFlags.layer({ experimentalEventSystem: true })

const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

const root = LayerNode.group([
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  LSP.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  SessionStatus.node,
  SessionRunState.node,
  SessionSteer.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  Truncate.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
  testLLMServerNode,
])

const it = testEffect(
  LayerNode.compile(root, [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, mcp],
    [RuntimeFlags.node, runtimeFlags],
  ]),
)

// Config that registers a custom "test" provider with a "test-model" model
// so provider model lookup succeeds inside the loop.
const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

const writeConfig = Effect.fn("test.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  const fs = yield* FSUtil.Service
  const text = JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config })
  yield* fs.writeWithDirs(path.join(dir, "openchinacode.json"), text)
  yield* fs.writeWithDirs(path.join(dir, "opencode.json"), text)
})

const deferredAsPromise = <A>(deferred: Deferred.Deferred<A>): PromiseLike<A> => ({
  then: (onfulfilled, onrejected) => {
    Effect.runFork(
      Deferred.await(deferred).pipe(
        Effect.match({
          onFailure: (error) => {
            onrejected?.(error)
          },
          onSuccess: (value) => {
            onfulfilled?.(value)
          },
        }),
      ),
    )
    return deferredAsPromise(deferred) as PromiseLike<never>
  },
})

// Raw OpenAI chat-completion chunk, for driving the TestLLMServer at the
// exact SSE level (a held stream is not expressible through reply()).
function chunk(delta: Record<string, unknown>, finish?: string) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [
      {
        delta,
        ...(finish ? { finish_reason: finish } : {}),
      },
    ],
  }
}

it.instance("steer cuts the in-flight reply and continues with the queued message", () =>
  Effect.gen(function* () {
    const { directory: dir } = yield* TestInstance
    const llm = yield* TestLLMServer
    yield* writeConfig(dir, providerCfg(llm.url))
    const events = yield* EventV2Bridge.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const steers = yield* SessionSteer.Service
    const status = yield* SessionStatus.Service
    const chat = yield* sessions.create({
      title: "Pinned",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })

    const gate = yield* Deferred.make<void>()
    // First request: emit the "Hello " delta immediately, then hold until the
    // test opens the gate, then emit a "world" delta that must be discarded by
    // the steer cut (takeWhile needs one more event to trip the predicate).
    yield* llm.push(
      raw({
        head: [chunk({ role: "assistant" }), chunk({ content: "Hello " })],
        wait: deferredAsPromise(gate),
        tail: [chunk({ content: "world" }), chunk({}, "stop")],
      }),
    )
    yield* llm.text("second reply")

    // Deltas are not persisted to the DB, so observe the partial text through
    // the PartDelta event the processor publishes while consuming the stream.
    const seen = yield* Deferred.make<void>()
    const off = yield* events.listen((event) => {
      if (event.type !== MessageV2.Event.PartDelta.type) return Effect.void
      const data = event.data as typeof MessageV2.Event.PartDelta.data.Type
      if (data.sessionID !== chat.id || data.delta !== "Hello ") return Effect.void
      return Deferred.succeed(seen, undefined).pipe(Effect.asVoid)
    })

    const first = yield* prompt
      .prompt({
        sessionID: chat.id,
        agent: "build",
        model: ref,
        parts: [{ type: "text", text: "first" }],
      })
      .pipe(Effect.forkChild)

    yield* awaitWithTimeout(llm.wait(1), "first LLM request never arrived", "10 seconds")
    yield* awaitWithTimeout(Deferred.await(seen), "partial text delta never observed", "10 seconds")
    yield* off

    // Queue the second user message through the real prompt path; ensureRunning
    // attaches it to the active run.
    const second = yield* prompt
      .prompt({
        sessionID: chat.id,
        agent: "build",
        model: ref,
        parts: [{ type: "text", text: "second" }],
      })
      .pipe(Effect.forkChild)

    yield* pollWithTimeout(
      sessions.messages({ sessionID: chat.id }).pipe(
        Effect.map((msgs) =>
          msgs.some(
            (msg) =>
              msg.info.role === "user" && msg.parts.some((part) => part.type === "text" && part.text === "second"),
          )
            ? (true as const)
            : undefined,
        ),
      ),
      "second user message was not persisted",
    )

    yield* steers.signal(chat.id)
    // Let the watcher fiber run handle.steer() before the next stream event.
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    yield* Deferred.succeed(gate, void 0)

    yield* awaitWithTimeout(llm.wait(2), "second LLM request never arrived", "10 seconds")

    const [exitFirst, exitSecond] = yield* Effect.all([Fiber.await(first), Fiber.await(second)])
    expect(Exit.isSuccess(exitFirst)).toBe(true)
    expect(Exit.isSuccess(exitSecond)).toBe(true)

    const inputs = yield* llm.inputs
    expect(inputs).toHaveLength(2)
    const messages = inputs[1]?.messages
    if (!Array.isArray(messages)) throw new Error("expected LLM messages")
    // The queued user message is part of the follow-up request.
    expect(messages.at(-1)).toEqual({ role: "user", content: "second" })
    // The cut assistant turn keeps the partial text and drops everything the
    // server sent after the steer ("world").
    const assistant = messages.find((message) => message.role === "assistant")
    expect(assistant).toBeDefined()
    const content = JSON.stringify(assistant?.content)
    expect(content).toContain("Hello ")
    expect(content).not.toContain("world")

    yield* pollWithTimeout(
      status.get(chat.id).pipe(Effect.map((s) => (s.type === "idle" ? (true as const) : undefined))),
      "session never returned to idle",
    )
  }),
  15_000,
)
