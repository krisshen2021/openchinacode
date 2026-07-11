import { TextAttributes } from "@opentui/core"
import { createMemo, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useProject } from "../context/project"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import {
  normalizeSoulConfig,
  projectCustomSoulFile,
  projectSoulConfigFile,
  readCustomSoul,
  soulInfo,
  writeCustomSoul,
  writeSoulConfig,
  type SoulID,
} from "../util/soul-config"

export function DialogSoul(props: { initialAction?: SoulID }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const project = useProject()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()

  dialog.setSize("large")

  const currentDirectory = createMemo(() => project.instance.directory() || sdk.directory)
  const currentWorktree = createMemo(() => {
    const worktree = project.instance.path().worktree
    return worktree && worktree !== "/" ? worktree : undefined
  })
  const current = createMemo(() => normalizeSoulConfig((sync.data.config as { soul?: unknown }).soul).active)

  function configTarget() {
    return {
      worktree: currentWorktree(),
      directory: currentDirectory(),
    }
  }

  async function refreshInstance() {
    await sdk.client.instance.dispose().catch(() => undefined)
    await sync.bootstrap({ fatal: false }).catch(() => undefined)
  }

  async function applySoul(soul: SoulID) {
    if (soul === "custom") {
      await editCustomSoul()
      return
    }

    const file = await projectSoulConfigFile(configTarget())
    if (!file) {
      toast.show({
        title: "Soul config unavailable",
        message: "OpenChinaCode cannot find a current project directory.",
        variant: "error",
      })
      return
    }

    const result = await writeSoulConfig(file, soul)
    sync.set("config", "soul" as any, { active: soul } as any)
    await refreshInstance()
    toast.show({
      title: "Soul updated",
      message: `${soulInfo[soul].title} is active for new turns. ${result.changed ? "Updated" : "Already set"}: ${result.file}`,
      variant: "success",
      duration: 7000,
    })
    dialog.clear()
  }

  async function editCustomSoul() {
    const target = configTarget()
    const configFile = await projectSoulConfigFile(target)
    const customFile = projectCustomSoulFile(target)
    if (!configFile || !customFile) {
      toast.show({
        title: "Custom soul unavailable",
        message: "OpenChinaCode cannot find a current project directory.",
        variant: "error",
      })
      return
    }

    const existing = await readCustomSoul(customFile)
    const value = await DialogPrompt.show(dialog, "Custom Soul", {
      value: existing.trim(),
      placeholder: "Describe how OpenChinaCode should think, communicate, and make engineering decisions.",
      description: () => (
        <text fg={theme.textMuted}>
          Saved to {customFile}. Enter saves and activates custom soul for new turns.
        </text>
      ),
    })
    if (!value?.trim()) {
      dialog.clear()
      return
    }

    const result = await writeCustomSoul({ configFile, customFile, content: value })
    sync.set("config", "soul" as any, { active: "custom", custom_path: ".openchinacode/souls/custom.md" } as any)
    await refreshInstance()
    toast.show({
      title: "Custom soul saved",
      message: `${result.changed ? "Updated" : "Already set"}: ${customFile}`,
      variant: "success",
      duration: 8000,
    })
    dialog.clear()
  }

  onMount(() => {
    if (!props.initialAction) return
    void applySoul(props.initialAction).catch((error) => {
      toast.show({
        title: "Failed to update soul",
        message: errorMessage(error),
        variant: "error",
        duration: 8000,
      })
    })
  })

  const options = createMemo<DialogSelectOption<SoulID>[]>(() =>
    (["rigorous", "friendly", "custom"] as const).map((soul) => ({
      title: soulInfo[soul].title,
      value: soul,
      category: "OpenChinaCode",
      description: soulInfo[soul].description,
      details:
        soul === current()
          ? ["Current soul"]
          : soul === "custom"
            ? ["Select to edit custom.md, then activate it."]
            : undefined,
    })),
  )

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          OpenChinaCode Soul
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <DialogSelect<SoulID>
        title="Select Soul"
        options={options()}
        current={current()}
        renderFilter={false}
        onSelect={(option) => {
          void applySoul(option.value).catch((error) => {
            toast.show({
              title: "Failed to update soul",
              message: errorMessage(error),
              variant: "error",
              duration: 8000,
            })
          })
        }}
        footer={<text fg={theme.textMuted}>Writes project .openchinacode/openchinacode.jsonc.</text>}
      />
    </box>
  )
}
