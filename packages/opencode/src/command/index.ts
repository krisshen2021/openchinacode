import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance-context"
import { Effect, Layer, Context, Schema } from "effect"
import { Config } from "@/config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import { LegacyEvent } from "@opencode-ai/schema/legacy-event"

type State = {
  commands: Record<string, Info>
}

export const Event = {
  Executed: LegacyEvent.CommandExecuted,
}

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["command", "mcp", "skill"])),
  // Some command templates are lazy promises from MCP prompt resolution.
  template: Schema.Unknown,
  subtask: Schema.optional(Schema.Boolean),
  hints: Schema.Array(Schema.String),
}).annotate({ identifier: "Command" })

export type Info = Omit<Schema.Schema.Type<typeof Info>, "template"> & { template: Promise<string> | string }

export function hints(template: string) {
  const result: string[] = []
  const numbered = template.match(/\$\d+/g)
  if (numbered) {
    for (const match of [...new Set(numbered)].sort()) result.push(match)
  }
  if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
  return result
}

export const Default = {
  INIT: "init",
  REVIEW: "review",
  TASK_POLICY: "task-policy",
  TASK_CLASSIFY: "task-classify",
  INTEGRATION_TEST: "integration-test",
  BROWSER_CHECK: "browser-check",
} as const

const PROMPT_TASK_POLICY = [
  "Explain OpenChinaCode's subagent task model policy and show a concise openchinacode.json example.",
  "",
  "Task assignment uses kind + complexity.",
  "Task kinds: general, plan, architecture, refactor, review, implement, explore, visual_check, debug, test_fix, summarize, compaction.",
  "Task complexities: quick, medium, complex.",
  "",
  "Default model routing:",
  "- general: inherit the parent model unless configured explicitly",
  "- complex plan, architecture, refactor: zhipuai-pay2go/glm-5.2#max",
  "- quick/medium plan, architecture, refactor: zhipuai-pay2go/glm-5.2#high",
  "- complex implement, complex review, and complex explore: zhipuai-pay2go/glm-5.2#max",
  "- medium implement, medium review, and medium summarize: zhipuai-pay2go/glm-5.2#high",
  "- complex summarize: zhipuai-pay2go/glm-5.2#max",
  "- quick implement, quick review, quick summarize, and quick explore: moonshotai-cn/kimi-k3#high",
  "- medium explore: moonshotai-cn/kimi-k3#high",
  "- medium/complex compaction: moonshotai-cn/kimi-k3#high",
  "- quick compaction: zhipuai-pay2go/glm-5.2#high",
  "- visual_check: zhipuai-pay2go/glm-5v-turbo",
  "- quick/medium debug and test_fix: deepseek/deepseek-v4-pro#high",
  "- complex debug and test_fix: deepseek/deepseek-v4-pro#max",
  "",
  "Policy priority: explicit task model, subagent model, task_policy agent route, task_policy global route, model task_classes tag, OpenChinaCode default, parent model fallback.",
  "",
  "Runtime controls:",
  "- /task-policy status: show task policy and extra router state",
  "- /task-policy off: hot-disable task policy routing so the current main model handles work directly",
  "- /task-policy on: hot-enable task policy routing again",
  "- /task-policy extra-on/off: hot-toggle fast judge auto-delegation for ordinary prompts",
  "",
  "User focus: $ARGUMENTS",
].join("\n")

const PROMPT_TASK_CLASSIFY = [
  "Classify this task for OpenChinaCode subagent routing.",
  "",
  "Allowed task kinds: general, plan, architecture, refactor, review, implement, explore, visual_check, debug, test_fix, summarize, compaction.",
  "Allowed task complexities: quick, medium, complex.",
  "",
  "Return: task kind, complexity, confidence, key signals, and the default model route.",
  "",
  "Task:",
  "$ARGUMENTS",
].join("\n")

const PROMPT_INTEGRATION_TEST = [
  "Run the OpenChinaCode integration test workflow for this project.",
  "",
  "Use tools. Do not rely on memory.",
  "If browser MCP tools are needed but not connected, tell TUI users to run /test-mcp on once. It writes config and hot-connects Playwright MCP. Use openchinacode test mcp only when operating from scripts or outside the TUI.",
  "",
  "Required workflow:",
  "1. Inspect package scripts and openchinacode.jsonc integration_test config.",
  "2. If .openchinacode/test-kit/playwright.config.ts is missing, run: openchinacode test init",
  "3. Run: openchinacode test run",
  "4. Read .openchinacode/reports/**/integration-report.md and the referenced logs.",
  "5. Define bugs with severity, reproduction, expected behavior, actual behavior, and evidence.",
  "6. If the user asks for fixing, implement focused fixes and rerun openchinacode test run.",
  "7. Summarize final status, report path, bugs found, fixes made, and remaining risks.",
  "",
  "User focus:",
  "$ARGUMENTS",
].join("\n")

const PROMPT_BROWSER_CHECK = [
  "Run a browser-level check for this project/page.",
  "",
  "If Playwright MCP is not connected, tell TUI users to run /test-mcp on once. It writes config and hot-connects Playwright MCP. Use openchinacode test mcp only when operating from scripts or outside the TUI.",
  "When screenshot/image/UI visual inspection is needed, delegate that subtask with task_kind=visual_check and task_complexity=medium so OpenChinaCode routes it to zhipuai-pay2go/glm-5v-turbo.",
  "For animation, transition, hover, loading, playback, or moving-state checks, first gather deterministic browser evidence when possible: getAnimations(), computed animation styles, computed transforms sampled over time, trace data when available, or cropped frame/pixel differences.",
  "Do not use browser video recording by default for animation checks; recordings are expensive, large, and often less reliable for small UI targets. Only create a recording when the user explicitly asks for a video artifact.",
  "If the user asks whether something is moving, rotating, pulsing, animating, playing, or visually changing over time, deterministic browser telemetry is primary for the actual animation state. Use task_kind=visual_check for screenshots and user-visible appearance. If visual_check conflicts with browser telemetry, transform changes, trace data, or pixel-diff evidence, report the conflict and prefer deterministic evidence for whether the animation is running.",
  "If the active model cannot inspect the screenshot/image directly, do not ask the user to inspect it manually. Call the task tool with subagent_type=general, task_kind=visual_check, task_complexity=quick or medium, and include the artifact path plus the exact visual question.",
  "",
  "Use the most stable available browser path in this order:",
  "1. Playwright MCP tools, if connected and visible.",
  "2. Project Playwright tests through openchinacode test run --no-start when a server is already running.",
  "3. Generated OpenChinaCode Playwright template via openchinacode test init, then openchinacode test run.",
  "",
  "Collect page load result, console errors, page errors, failed 5xx responses, screenshot/report artifacts when available, and exact reproduction steps.",
  "Avoid ad-hoc raw google-chrome commands unless Playwright MCP and Playwright Test are both unavailable.",
  "",
  "Target or focus:",
  "$ARGUMENTS",
].join("\n")

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Command") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const skill = yield* Skill.Service

    const init = Effect.fn("Command.state")(function* (ctx: InstanceContext) {
      const cfg = yield* config.get()
      const bridge = yield* EffectBridge.make()
      const commands: Record<string, Info> = {}

      commands[Default.INIT] = {
        name: Default.INIT,
        description: "guided AGENTS.md setup",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      }
      commands[Default.REVIEW] = {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        source: "command",
        get template() {
          return PROMPT_REVIEW.replace("${path}", ctx.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      }
      commands[Default.TASK_POLICY] = {
        name: Default.TASK_POLICY,
        description:
          "Usage: /task-policy [focus|status|on|off|extra-status|extra-on|extra-off] - show or hot-toggle OpenChinaCode task routing",
        source: "command",
        get template() {
          return PROMPT_TASK_POLICY
        },
        hints: hints(PROMPT_TASK_POLICY),
      }
      commands[Default.TASK_CLASSIFY] = {
        name: Default.TASK_CLASSIFY,
        description: "Usage: /task-classify <task> - classify kind/complexity and show the default route",
        source: "command",
        get template() {
          return PROMPT_TASK_CLASSIFY
        },
        hints: hints(PROMPT_TASK_CLASSIFY),
      }
      commands[Default.INTEGRATION_TEST] = {
        name: Default.INTEGRATION_TEST,
        description: "Usage: /integration-test [focus] - run the OpenChinaCode Playwright integration workflow",
        source: "command",
        get template() {
          return PROMPT_INTEGRATION_TEST
        },
        hints: hints(PROMPT_INTEGRATION_TEST),
      }
      commands[Default.BROWSER_CHECK] = {
        name: Default.BROWSER_CHECK,
        description:
          "Usage: /browser-check [url|focus] - inspect a page with Playwright MCP/Test and report browser bugs",
        source: "command",
        get template() {
          return PROMPT_BROWSER_CHECK
        },
        hints: hints(PROMPT_BROWSER_CHECK),
      }

      for (const [name, command] of Object.entries(cfg.command ?? {})) {
        commands[name] = {
          name,
          agent: command.agent,
          model: command.model,
          description: command.description,
          source: "command",
          get template() {
            return command.template
          },
          subtask: command.subtask,
          hints: hints(command.template),
        }
      }

      for (const [name, prompt] of Object.entries(yield* mcp.prompts())) {
        commands[name] = {
          name,
          source: "mcp",
          description: prompt.description,
          get template() {
            return bridge.promise(
              mcp
                .getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                    : {},
                )
                .pipe(
                  Effect.map(
                    (template) =>
                      template?.messages
                        .map((message) => (message.content.type === "text" ? message.content.text : ""))
                        .join("\n") || "",
                  ),
                ),
            )
          },
          hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
        }
      }

      for (const item of yield* skill.all()) {
        if (commands[item.name]) continue
        const dir = item.location === "<built-in>" ? undefined : path.dirname(item.location)
        commands[item.name] = {
          name: item.name,
          description: item.description,
          source: "skill",
          get template() {
            if (!dir) return item.content
            return [
              item.content,
              "",
              `Base directory for this skill: ${dir}`,
              "Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.",
            ].join("\n")
          },
          hints: [],
        }
      }

      return {
        commands,
      }
    })

    const state = yield* InstanceState.make<State>((ctx) => init(ctx))

    const get = Effect.fn("Command.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.commands[name]
    })

    const list = Effect.fn("Command.list")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.commands)
    })

    return Service.of({ get, list })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [Config.node, MCP.node, Skill.node] })

export * as Command from "."
