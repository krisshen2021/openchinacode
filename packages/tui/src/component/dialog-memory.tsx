import { TextAttributes } from "@opentui/core"
import { createResource, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"

export function DialogMemory(props: { sessionID: string }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sdk = useSDK()
  const [memory] = createResource(async () => {
    const result = await sdk.client.session.memory({ sessionID: props.sessionID })
    return result.data
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Session Memory
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={!memory.loading} fallback={<text fg={theme.textMuted}>Loading…</text>}>
        <Show
          when={memory()?.available}
          fallback={<text fg={theme.text}>No memory recorded for this session yet.</text>}
        >
          <scrollbox height={20}>
            <text fg={theme.text} wrapMode="word">
              {memory()?.rendered}
            </text>
          </scrollbox>
          <text fg={theme.textMuted}>
            v{memory()?.version} · {memory()?.source} · {new Date(memory()?.updated_at ?? 0).toLocaleString()}
          </text>
        </Show>
      </Show>
    </box>
  )
}
