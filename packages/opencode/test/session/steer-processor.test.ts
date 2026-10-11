import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Context, Deferred, Effect, Fiber, Layer, Queue, Stream } from "effect"
import path from "path"
import type { Agent } from "../../src/agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionSummary } from "../../src/session/summary"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { LLMEvent } from "@opencode-ai/llm"

class Events extends Context.Service<Events, { readonly queue: Queue.Queue<LLMEvent> }>()("@test/SteerEvents") {}

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

function agent(): Agent.Info {
  return {
    name: "build",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }
}

const waitFor = <A>(check: Effect.Effect<A | undefined>, message: string) =>
  Effect.gen(function* () {
    const stop = Date.now() + 500
    while (Date.now() < stop) {
      const value = yield* check
      if (value !== undefined) return value
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error(message))
  })

const user = Effect.fn("TestSession.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const assistant = Effect.fn("TestSession.assistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  root: string,
) {
  const session = yield* Session.Service
  const msg: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  yield* session.updateMessage(msg)
  return msg
})

function input(parent: SessionV1.User, sessionID: SessionID, model: Provider.Model) {
  return {
    user: {
      id: parent.id,
      sessionID,
      role: "user",
      time: parent.time,
      agent: parent.agent,
      model: { providerID: ref.providerID, modelID: ref.modelID },
    } satisfies SessionV1.User,
    sessionID,
    model,
    agent: agent(),
    system: [],
    messages: [{ role: "user", content: "hi" }],
    tools: {},
  } satisfies LLM.StreamInput
}

// Fake LLM whose stream is fed event-by-event through a queue the test holds,
// giving exact control over which event the steer cut point lands on.
const events = LayerNode.make({
  service: Events,
  layer: Layer.effect(Events, Effect.map(Queue.unbounded<LLMEvent>(), (queue) => ({ queue }))),
  deps: [],
})

const fakeLLM = LayerNode.make({
  service: LLM.Service,
  layer: Layer.effect(
    LLM.Service,
    Effect.map(Events, (feed) => LLM.Service.of({ stream: () => Stream.fromQueue(feed.queue) })),
  ),
  deps: [events],
})

const root = LayerNode.group([
  SessionProcessor.node,
  Session.node,
  SessionProjector.node,
  Provider.node,
  Database.node,
  EventV2Bridge.node,
  CrossSpawnSpawner.node,
  events,
])
const replacements = [
  [SessionSummary.node, summary],
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
] as const
const env = LayerNode.compile(root, [...replacements, [LLM.node, fakeLLM]])

const it = testEffect(env)

const boot = Effect.fn("test.boot")(function* () {
  const processors = yield* SessionProcessor.Service
  const session = yield* Session.Service
  const provider = yield* Provider.Service
  return { processors, session, provider }
})

// Resolves once a PartDelta with the given text is published for msg, proving
// the delta event was consumed by the processor (deltas are not in the DB).
const onDelta = Effect.fn("test.onDelta")(function* (messageID: MessageID, delta: string) {
  const bridge = yield* EventV2Bridge.Service
  const seen = yield* Deferred.make<void>()
  const off = yield* bridge.listen((event) => {
    if (event.type !== MessageV2.Event.PartDelta.type) return Effect.void
    const data = event.data as typeof MessageV2.Event.PartDelta.data.Type
    if (data.messageID !== messageID || data.delta !== delta) return Effect.void
    return Deferred.succeed(seen, undefined)
  })
  return { seen, off }
})

it.live("session.processor steer cuts a pure text stream at the next event", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const feed = yield* Events

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "hi")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })

        const hello = yield* onDelta(msg.id, "Hello ")
        const run = yield* handle.process(input(parent, chat.id, mdl)).pipe(Effect.forkChild)

        yield* Queue.offer(feed.queue, LLMEvent.textStart({ id: "text-1" }))
        yield* Queue.offer(feed.queue, LLMEvent.textDelta({ id: "text-1", text: "Hello " }))
        yield* awaitWithTimeout(Deferred.await(hello.seen), "timed out waiting for text delta")
        yield* hello.off

        handle.steer()
        // Triggers the takeUntil check; it must be discarded before tap persists it.
        yield* Queue.offer(feed.queue, LLMEvent.textDelta({ id: "text-1", text: "world" }))

        const result = yield* Fiber.join(run)
        const parts = yield* MessageV2.parts(msg.id)
        const text = parts.find((part): part is SessionV1.TextPart => part.type === "text")

        expect(result).toBe("continue")
        expect(text?.text).toBe("Hello ")
        expect(text?.time?.end).toBeDefined()
        expect(handle.message.time.completed).toBeDefined()
        expect(handle.message.error).toBeUndefined()
      }),
    { config: cfg },
  ),
)

it.live("session.processor steer waits out an in-flight tool call and cuts at the tool boundary", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const { processors, session, provider } = yield* boot()
        const feed = yield* Events

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "hi")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })

        const during = yield* onDelta(msg.id, "during")
        const run = yield* handle.process(input(parent, chat.id, mdl)).pipe(Effect.forkChild)

        yield* Queue.offer(feed.queue, LLMEvent.toolInputStart({ id: "call-1", name: "bash" }))
        yield* Queue.offer(feed.queue, LLMEvent.toolCall({ id: "call-1", name: "bash", input: { cmd: "pwd" } }))
        yield* waitFor(
          MessageV2.parts(msg.id).pipe(
            Effect.map((parts) =>
              parts.find(
                (part): part is SessionV1.ToolPart =>
                  part.type === "tool" && part.callID === "call-1" && part.state.status === "running",
              ),
            ),
            Effect.provideService(Database.Service, database),
          ),
          "timed out waiting for running tool part",
        )

        handle.steer()
        // The tool call is unsettled, so the cut point must stay closed and
        // these events must be processed normally.
        yield* Queue.offer(feed.queue, LLMEvent.textStart({ id: "text-1" }))
        yield* Queue.offer(feed.queue, LLMEvent.textDelta({ id: "text-1", text: "during" }))
        yield* awaitWithTimeout(Deferred.await(during.seen), "timed out waiting for delta during tool call")
        yield* during.off
        expect(handle.message.time.completed).toBeUndefined()

        yield* Queue.offer(
          feed.queue,
          LLMEvent.toolResult({ id: "call-1", name: "bash", result: { type: "text", value: "done" } }),
        )
        yield* waitFor(
          MessageV2.parts(msg.id).pipe(
            Effect.map((parts) =>
              parts.find(
                (part): part is SessionV1.ToolPart =>
                  part.type === "tool" && part.callID === "call-1" && part.state.status === "completed",
              ),
            ),
            Effect.provideService(Database.Service, database),
          ),
          "timed out waiting for completed tool part",
        )

        // The stream is sequential, so this pull happens after the tool-result
        // handler settled call-1; the cut triggers before the event is persisted.
        yield* Queue.offer(feed.queue, LLMEvent.toolInputStart({ id: "call-2", name: "bash" }))

        const result = yield* Fiber.join(run)
        const parts = yield* MessageV2.parts(msg.id)
        const tools = parts.filter((part): part is SessionV1.ToolPart => part.type === "tool")

        expect(result).toBe("continue")
        expect(tools.length).toBe(1)
        expect(tools[0]?.callID).toBe("call-1")
        expect(tools[0]?.state.status).toBe("completed")
        expect(handle.message.time.completed).toBeDefined()
        expect(handle.message.error).toBeUndefined()
      }),
    { config: cfg },
  ),
)
