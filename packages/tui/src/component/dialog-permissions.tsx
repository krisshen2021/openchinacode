import { TextAttributes } from "@opentui/core"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useProject } from "../context/project"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import { useSDK } from "../context/sdk"
import { errorMessage } from "../util/error"
import {
  applyRuntimePermissionRules,
  describePermissionConfig,
  permissionConfigForPreset,
  permissionPresetInfo,
  permissionRulesFromConfig,
  projectPermissionConfigFile,
  writePermissionPreset,
  type PermissionPreset,
} from "../util/permission-config"

export function DialogPermissions() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const project = useProject()
  const sync = useSync()
  const toast = useToast()
  const sdk = useSDK()

  dialog.setSize("large")

  const effective = createMemo(() =>
    describePermissionConfig((sync.data.config as { permission?: unknown }).permission),
  )
  const currentDirectory = createMemo(() => project.instance.directory() || sdk.directory)
  const currentWorktree = createMemo(() => {
    const worktree = project.instance.path().worktree
    return worktree && worktree !== "/" ? worktree : undefined
  })
  const target = createMemo(() => currentWorktree() ?? currentDirectory())

  const options = createMemo<DialogSelectOption<PermissionPreset>[]>(() =>
    (["trust-all", "safe", "ask", "readonly", "reset"] as const).map((preset) => {
      const info = permissionPresetInfo[preset]
      return {
        title: info.title,
        value: preset,
        category: "Project",
        description: info.description,
      }
    }),
  )

  async function applyPreset(preset: PermissionPreset) {
    const file = await projectPermissionConfigFile({ worktree: currentWorktree(), directory: currentDirectory() })
    if (!file) {
      toast.show({
        title: "Project directory unavailable",
        message: "OpenChinaCode cannot find a current directory for project permission config.",
        variant: "error",
      })
      return
    }

    const permissionConfig = permissionConfigForPreset(preset)
    const rules = permissionRulesFromConfig(permissionConfig)
    const result = await writePermissionPreset(file, preset)
    await applyRuntimePermissionRules({
      baseUrl: sdk.url,
      fetch: sdk.fetch,
      directory: currentDirectory(),
      workspace: project.workspace.current(),
      rules,
    })

    sync.set("config", "permission" as any, permissionConfig as any)
    toast.show({
      title: preset === "reset" ? "Project permissions reset" : "Project permissions updated",
      message: `${result.changed ? "Updated" : "Already set"}: ${result.file}. Runtime policy is active for this instance.`,
      variant: "success",
      duration: 8000,
    })
    dialog.clear()
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          OpenChinaCode Permissions
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={0}>
        <text fg={theme.textMuted}>Effective policy: {effective()}</text>
        <Show when={target()}>{(value) => <text fg={theme.textMuted}>Project target: {value()}</text>}</Show>
      </box>
      <DialogSelect<PermissionPreset>
        title="Project Permission Strategy"
        options={options()}
        renderFilter={false}
        onSelect={(option) => {
          void applyPreset(option.value).catch((error) => {
            toast.show({
              title: "Failed to update permissions",
              message: errorMessage(error),
              variant: "error",
              duration: 8000,
            })
          })
        }}
        footer={<text fg={theme.textMuted}>Writes .openchinacode/openchinacode.jsonc and applies immediately.</text>}
      />
    </box>
  )
}
