import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createSignal, onCleanup, onMount } from "solid-js"

const id = "internal:sidebar-memory"

// The TUI main thread shares its process with the in-process backend worker,
// so rss here is the whole instance's footprint — the same number ps reports.
function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [rss, setRss] = createSignal(process.memoryUsage().rss)

  onMount(() => {
    const timer = setInterval(() => setRss(process.memoryUsage().rss), 5000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Memory</b>
      </text>
      <text fg={theme().textMuted}>{Math.round(rss() / 1048576).toLocaleString()} MB this instance</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
