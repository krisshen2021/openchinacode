import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createMemo, onMount } from "solid-js"
import { useTuiConfig } from "../config"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { getScrollAcceleration } from "../util/scroll"

const routes = [
  {
    kind: "general",
    quick: "parent model",
    medium: "parent model",
    complex: "parent model",
    note: "Default catch-all task. Inherits the parent model unless configured explicitly.",
  },
  {
    kind: "plan",
    quick: "GLM 5.2 high",
    medium: "GLM 5.2 high",
    complex: "GLM 5.2 max",
    note: "Planning tasks.",
  },
  {
    kind: "architecture",
    quick: "GLM 5.2 high",
    medium: "GLM 5.2 high",
    complex: "GLM 5.2 max",
    note: "System design and architecture decisions.",
  },
  {
    kind: "refactor",
    quick: "GLM 5.2 high",
    medium: "GLM 5.2 high",
    complex: "GLM 5.2 max",
    note: "Code restructuring tasks.",
  },
  {
    kind: "summarize",
    quick: "Kimi 2.7 highspeed",
    medium: "Kimi 2.7 highspeed",
    complex: "GLM 5.2 high",
    note: "Summaries requested by subagents.",
  },
  {
    kind: "compaction",
    quick: "GLM 5.2 high",
    medium: "GLM 5.2 high",
    complex: "GLM 5.2 high",
    note: "Auto/manual context compaction. Runtime currently submits compaction.medium.",
  },
  {
    kind: "review",
    quick: "Kimi 2.7 highspeed",
    medium: "GLM 5.2 high",
    complex: "GLM 5.2 max",
    note: "Code review and audit tasks.",
  },
  {
    kind: "implement",
    quick: "Kimi 2.7 highspeed",
    medium: "GLM 5.2 high",
    complex: "GLM 5.2 max",
    note: "Code implementation tasks.",
  },
  {
    kind: "explore",
    quick: "Kimi 2.7 highspeed",
    medium: "GLM 5.2 high",
    complex: "GLM 5.2 max",
    note: "Repository search and investigation.",
  },
  {
    kind: "visual_check",
    quick: "GLM 5V Turbo",
    medium: "GLM 5V Turbo",
    complex: "GLM 5V Turbo",
    note: "Screenshot, image, browser visual, OCR, and visual accessibility checks.",
  },
  {
    kind: "debug",
    quick: "DeepSeek v4 pro high",
    medium: "DeepSeek v4 pro high",
    complex: "DeepSeek v4 pro max",
    note: "Bug diagnosis.",
  },
  {
    kind: "test_fix",
    quick: "DeepSeek v4 pro high",
    medium: "DeepSeek v4 pro high",
    complex: "DeepSeek v4 pro max",
    note: "Fixing failing tests.",
  },
] as const

const models = [
  ["GLM 5.2 high", "zhipuai-pay2go/glm-5.2#high"],
  ["GLM 5.2 max", "zhipuai-pay2go/glm-5.2#max"],
  ["GLM 5V Turbo", "zhipuai-pay2go/glm-5v-turbo"],
  ["Kimi 2.7 highspeed", "moonshotai-cn/kimi-k2.7-code-highspeed"],
  ["DeepSeek v4 pro", "deepseek/deepseek-v4-pro"],
  ["DeepSeek v4 pro high", "deepseek/deepseek-v4-pro#high"],
  ["DeepSeek v4 pro max", "deepseek/deepseek-v4-pro#max"],
  ["DeepSeek v4 flash", "deepseek/deepseek-v4-flash"],
  ["parent model", "inherit the current parent model"],
] as const

export function DialogTaskPolicy(props: { focus?: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()

  onMount(() => dialog.setSize("large"))

  const focus = createMemo(() => props.focus?.trim().toLowerCase())
  const scrollHeight = createMemo(() => {
    const topOffset = Math.ceil(dimensions().height / 4)
    return Math.max(4, dimensions().height - topOffset - 5)
  })
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  function rowFg(kind: string) {
    if (focus() && kind.includes(focus()!)) return theme.primary
    return theme.text
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          OpenChinaCode Task Policy
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show when={focus()}>{(value) => <text fg={theme.textMuted}>Focus: {value()}</text>}</Show>

      <scrollbox
        maxHeight={scrollHeight()}
        verticalScrollbarOptions={{ visible: true }}
        horizontalScrollbarOptions={{ visible: false }}
        scrollAcceleration={scrollAcceleration()}
      >
        <box gap={0}>
          <box flexDirection="row" gap={1}>
            <text width={14} fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              task
            </text>
            <text width={20} fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              quick
            </text>
            <text width={20} fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              medium
            </text>
            <text width={20} fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              complex
            </text>
          </box>
          <For each={routes}>
            {(route) => (
              <box flexDirection="row" gap={1}>
                <text
                  width={14}
                  fg={rowFg(route.kind)}
                  attributes={route.kind === "compaction" ? TextAttributes.BOLD : 0}
                >
                  {route.kind}
                </text>
                <text width={20} fg={rowFg(route.kind)}>
                  {route.quick}
                </text>
                <text width={20} fg={rowFg(route.kind)}>
                  {route.medium}
                </text>
                <text width={20} fg={rowFg(route.kind)}>
                  {route.complex}
                </text>
              </box>
            )}
          </For>
        </box>

        <box gap={0} paddingTop={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            Model ids
          </text>
          <For each={models}>
            {([label, id]) => (
              <text fg={theme.textMuted} wrapMode="word">
                {label}: {id}
              </text>
            )}
          </For>
        </box>

        <box gap={0} paddingTop={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            Priority
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            explicit task model, subagent model, task_policy agent route, task_policy global route, model task_classes,
            OpenChinaCode default, parent model fallback
          </text>
        </box>

        <box gap={0} paddingTop={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            Runtime controls
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            Use /task-policy off to hot-disable task policy routing when you want only the current main model to handle
            the next tasks. Use /task-policy on to re-enable. Use /task-policy status to inspect both switches.
          </text>
        </box>

        <box gap={0} paddingTop={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            Extra router
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            Disabled by default. Use /task-policy extra-on to run a fast judge before ordinary prompts and auto-insert a
            routed subtask when useful. Use /task-policy extra-off to disable. All switches hot-apply to new turns.
          </text>
        </box>
      </scrollbox>
    </box>
  )
}
