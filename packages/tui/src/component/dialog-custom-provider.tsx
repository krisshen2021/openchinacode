import { onMount } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import { DialogModel } from "./dialog-model"

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]*$/

/**
 * Add/edit a custom OpenAI-compatible provider. Driven imperatively through
 * chained dialog.replace calls (same pattern as PromptsMethod in
 * dialog-provider.tsx): entry select → id/name/baseURL/apiKey prompts →
 * pull-or-manual model entry → save → model picker, no restart needed.
 */
export function DialogCustomProvider() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()

  onMount(async () => {
    const listed = await sdk.client.provider.custom.list({})
    const existing = listed.data ?? []

    const choice = await select<{ id: string }>({
      title: "自定义 provider",
      options: [
        { title: "新建自定义 provider…", value: { id: "" } },
        ...existing.map((p) => ({ title: `编辑 ${p.id}`, value: { id: p.id }, description: p.baseURL })),
      ],
    })
    if (choice === null) return
    const editing = existing.find((p) => p.id === choice.id)

    let id = editing?.id ?? ""
    while (!editing) {
      const value = await prompt({ title: "Provider ID", placeholder: "小写字母、数字、连字符,如 volcengine-plan" })
      if (value === null) return
      if (PROVIDER_ID.test(value.trim())) {
        id = value.trim()
        break
      }
      toast.show({ variant: "error", message: "ID 只能包含小写字母、数字、连字符,且不能以连字符开头" })
    }

    const name = await prompt({
      title: "显示名称(可留空)",
      placeholder: editing ? "留空保持不变" : "如:火山方舟",
      value: editing?.name ?? "",
    })
    if (name === null) return

    const baseURL = await prompt({
      title: "baseURL",
      placeholder: "https://example.com/v1",
      value: editing?.baseURL ?? "",
    })
    if (baseURL === null) return
    if (!baseURL.trim()) {
      toast.show({ variant: "error", message: "baseURL 不能为空" })
      return
    }

    const apiKey = await prompt({
      title: "API key",
      placeholder: editing ? "留空保持不变" : "sk-...",
    })
    if (apiKey === null) return
    if (!editing && !apiKey.trim()) {
      toast.show({ variant: "error", message: "新建 provider 必须填写 API key" })
      return
    }

    const mode = await select<string>({
      title: "模型列表",
      options: [
        { title: "自动拉取模型列表", value: "auto", description: "GET {baseURL}/models" },
        { title: "手动输入模型 ID", value: "manual" },
      ],
    })
    if (mode === null) return

    let models: string[] = []
    let discovered = false
    if (mode === "auto") {
      const result = await sdk.client.provider.discover({ baseURL: baseURL.trim(), apiKey: apiKey.trim() })
      if (result.error || !result.data || result.data.models.length === 0) {
        const message =
          result.error && typeof result.error === "object" && "message" in result.error
            ? String(result.error.message)
            : "拉取失败,请检查 baseURL 和 API key"
        toast.show({ variant: "error", message: `${message},请改为手动输入` })
      } else {
        const confirm = await select<string>({
          title: `拉取到 ${result.data.models.length} 个模型`,
          options: [
            { title: `添加全部 ${result.data.models.length} 个模型`, value: "all" },
            { title: "改为手动输入", value: "manual" },
          ],
        })
        if (confirm === null) return
        if (confirm === "all") {
          models = result.data.models.map((m) => m.id)
          discovered = true
        }
      }
    }
    if (!discovered) {
      const manual = await prompt({
        title: "模型 ID 列表",
        placeholder: "逗号或空格分隔,如 glm-5.3, kimi-k3",
        value: editing?.models.join(", ") ?? "",
      })
      if (manual === null) return
      models = manual.split(/[,\s]+/).filter(Boolean)
      if (models.length === 0) {
        toast.show({ variant: "error", message: "至少输入一个模型 ID" })
        return
      }
    }

    const saved = await sdk.client.provider.custom.save({
      providerID: id,
      name: name.trim() || undefined,
      baseURL: baseURL.trim(),
      models,
      discover_models: discovered,
      apiKey: apiKey.trim() || undefined,
    })
    if (saved.error) {
      const message =
        saved.error && typeof saved.error === "object" && "message" in saved.error
          ? String(saved.error.message)
          : JSON.stringify(saved.error)
      toast.show({ variant: "error", message })
      dialog.clear()
      return
    }
    toast.show({ message: "已保存,模型立即可用", variant: "info" })
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={id} />)
  })

  function prompt(options: { title: string; placeholder?: string; value?: string }) {
    return DialogPrompt.show(dialog, options.title, { placeholder: options.placeholder, value: options.value })
  }

  function select<T>(input: { title: string; options: { title: string; value: T; description?: string }[] }) {
    return new Promise<T | null>((resolve) => {
      dialog.replace(
        () => (
          <DialogSelect title={input.title} options={input.options} onSelect={(option) => resolve(option.value)} />
        ),
        () => resolve(null),
      )
    })
  }

  return null
}
