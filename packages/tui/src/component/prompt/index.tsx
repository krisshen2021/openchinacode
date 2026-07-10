import {
  BoxRenderable,
  RGBA,
  TextareaRenderable,
  MouseEvent,
  PasteEvent,
  decodePasteBytes,
  type KeyEvent,
  type Renderable,
} from "@opentui/core"
import type { CommandContext } from "@opentui/keymap"
import { createEffect, createMemo, onMount, createSignal, onCleanup, on, Show, Switch, Match } from "solid-js"
import { registerOpencodeSpinner } from "../register-spinner"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "path"
import { fileURLToPath } from "url"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { useLocal } from "../../context/local"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { which } from "@opencode-ai/core/util/which"
import * as Jsonc from "@opencode-ai/core/jsonc"
import { tint, useTheme } from "../../context/theme"
import { EmptyBorder, SplitBorder } from "../../ui/border"
import { useTuiPaths, useTuiTerminalEnvironment } from "../../context/runtime"
import { useClipboard } from "../../context/clipboard"
import { Spinner } from "../spinner"
import { useSDK } from "../../context/sdk"
import { useRoute } from "../../context/route"
import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { useEvent } from "../../context/event"
import { editorSelectionKey, useEditorContext, type EditorSelection } from "../../context/editor"
import { normalizePromptContent, openEditor } from "../../editor"
import { useExit } from "../../context/exit"
import { promptOffsetWidth } from "../../prompt/display"
import { createStore, produce, unwrap } from "solid-js/store"
import { usePromptHistory, type PromptInfo } from "../../prompt/history"
import { computePromptTraits } from "../../prompt/traits"
import { expandPastedTextPlaceholders, expandTrackedPastedText } from "../../prompt/part"
import { usePromptStash } from "../../prompt/stash"
import { DialogStash } from "../dialog-stash"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import type { AssistantMessage, FilePart, SubtaskPart, UserMessage } from "@opencode-ai/sdk/v2"
import { Locale } from "../../util/locale"
import { errorMessage } from "../../util/error"
import { formatDuration } from "../../util/format"
import { createColors, createFrames } from "../../ui/spinner"
import { useDialog } from "../../ui/dialog"
import { DialogProvider as DialogProviderConnect } from "../dialog-provider"
import { DialogAlert } from "../../ui/dialog-alert"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useToast } from "../../ui/toast"
import { useKV } from "../../context/kv"
import { createFadeIn } from "../../util/signal"
import { DialogSkill } from "../dialog-skill"
import { DialogTaskPolicy } from "../dialog-task-policy"
import { DialogWorkspaceUnavailable } from "../dialog-workspace-unavailable"
import { useArgs } from "../../context/args"
import {
  COMMAND_PALETTE_COMMAND,
  OPENCODE_BASE_MODE,
  useBindings,
  useCommandShortcut,
  useLeaderActive,
  useOpencodeKeymap,
} from "../../keymap"
import { useTuiConfig } from "../../config"
import { usePromptWorkspace } from "./workspace"
import { usePromptMove } from "./move"
import { readLocalAttachment } from "./local-attachment"
import {
  parseAutoMaxTokensSlashAction,
  parseCompactSlashAction,
  parseDirectSlashCommand,
  parseLspSlashAction,
  parseTestMcpSlashAction,
} from "./slash"

registerOpencodeSpinner()

export type PromptProps = {
  sessionID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef | undefined) => void
  hint?: JSX.Element
  right?: JSX.Element
  showPlaceholder?: boolean
  placeholders?: {
    normal?: string[]
    shell?: string[]
  }
}

function pastedFilepath(value: string, platform: string) {
  const raw = value.replace(/^['"]+|['"]+$/g, "")
  if (raw.startsWith("file://")) {
    try {
      return fileURLToPath(raw)
    } catch {}
  }
  if (platform === "win32") return raw
  return raw.replace(/\\(.)/g, "$1")
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}

const money = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
})

const DRAFT_RETENTION_MIN_CHARS = 20
const CONFIG_SCHEMA = "https://opencode.ai/config.json"
const GLOBAL_CONFIG_FILES = ["openchinacode.jsonc", "openchinacode.json", "config.json"] as const
const BUILTIN_PROMPT_COMMANDS = new Set(["task-policy", "task-classify"])
const TEST_MCP_NAME = "playwright"
const TEST_MCP_TIMEOUT_MS = 30_000
const ARK_AUTH_PROVIDER_ID = "volcengine-ark"
const VISUAL_PREPROCESS_PROVIDER_ID = "zhipuai-pay2go"
const VISUAL_PREPROCESS_MODEL_ID = "glm-5v-turbo"
const VISUAL_PREPROCESS_ROOT = path.join(tmpdir(), "openchinacode", "attachments")

function randomIndex(count: number) {
  if (count <= 0) return 0
  return Math.floor(Math.random() * count)
}

function fadeColor(color: RGBA, alpha: number) {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}

function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function imageExt(mime: string) {
  if (mime === "image/jpeg") return "jpg"
  if (mime === "image/png") return "png"
  if (mime === "image/webp") return "webp"
  if (mime === "image/gif") return "gif"
  if (mime === "image/avif") return "avif"
  return "img"
}

function isImageFilePart(part: PromptInfo["parts"][number]): part is Omit<FilePart, "id" | "messageID" | "sessionID"> {
  return part.type === "file" && part.mime.startsWith("image/")
}

function filePartPath(part: Omit<FilePart, "id" | "messageID" | "sessionID">) {
  if (part.source?.type === "file" && part.source.path) return part.source.path
  try {
    const url = new URL(part.url)
    if (url.protocol === "file:") return fileURLToPath(url)
  } catch {}
}

function promptPath(value: string) {
  return value.replace(/\\/g, "/")
}

function visualPreprocessPrompt(inputText: string, imagePaths: string[]) {
  const original = inputText.trim() || "(The user pasted image(s) without additional text.)"
  const images = imagePaths.map((item, index) => `${index + 1}. @${promptPath(item)}`).join("\n")
  return [
    "OpenChinaCode visual preprocessing task.",
    "",
    "The user pasted image(s) into the prompt. Inspect the image(s) directly with vision capability before the primary coding model continues.",
    "",
    "Original user prompt:",
    original,
    "",
    "Image files:",
    images,
    "",
    "Return a concise, concrete visual analysis for the primary coding agent.",
    "Include:",
    "- What is visibly present in each image.",
    "- Any visible UI/layout/color/state issue relevant to the user's prompt.",
    "- OCR or visible text when relevant.",
    "- Precise uncertainty when the image is ambiguous.",
    "- The local image path(s) you inspected.",
    "",
    "Match the user's language. If the user wrote Chinese, respond in Chinese.",
  ].join("\n")
}

function visualPreprocessUserText(inputText: string, imagePaths: string[]) {
  const original = inputText.trim() || "请先识别我粘贴的图片，然后基于图片内容继续处理。"
  const images = imagePaths.map((item, index) => `${index + 1}. ${item}`).join("\n")
  return [
    original,
    "",
    "<openchinacode-visual-preprocess>",
    `The user pasted ${imagePaths.length} image(s). OpenChinaCode will run a GLM-5V visual preprocessing subtask first.`,
    "After that subtask finishes, use its visual observations as the authoritative description of the pasted image(s).",
    "Do not re-open Playwright or re-capture the browser unless the user explicitly asks for the current live browser/page state.",
    "",
    "Local pasted image path(s):",
    images,
    "</openchinacode-visual-preprocess>",
  ].join("\n")
}

function visualPreprocessSubtask(inputText: string, imagePaths: string[]): Omit<SubtaskPart, "id" | "messageID" | "sessionID"> {
  return {
    type: "subtask",
    agent: "general",
    description: "Pasted image visual preprocessing",
    command: "openchinacode.visual_preprocess",
    model: {
      providerID: VISUAL_PREPROCESS_PROVIDER_ID,
      modelID: VISUAL_PREPROCESS_MODEL_ID,
    },
    prompt: visualPreprocessPrompt(inputText, imagePaths),
  }
}

function chromeAbsoluteCandidates() {
  if (process.platform === "darwin") return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  if (process.platform === "win32") {
    return [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
      .filter((item): item is string => !!item)
      .map((base) => path.join(base, "Google", "Chrome", "Application", "chrome.exe"))
  }
  return []
}

function findChromeExecutable() {
  for (const candidate of chromeAbsoluteCandidates()) {
    if (existsSync(candidate)) return candidate
  }
  for (const candidate of ["google-chrome-stable", "google-chrome", "chrome"]) {
    const found = which(candidate)
    if (found) return found
  }
}

function chromeMissingMessage() {
  return [
    "OpenChinaCode Playwright MCP defaults to Google Chrome.",
    "Install Chrome first, then run /test-mcp on again.",
    "Ubuntu/Debian: wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && sudo apt install ./google-chrome-stable_current_amd64.deb",
    "macOS: brew install --cask google-chrome",
  ].join("\n")
}

async function readGlobalConfigFile() {
  await mkdir(Global.Path.config, { recursive: true })
  const candidates = GLOBAL_CONFIG_FILES.map((file) => path.join(Global.Path.config, file))
  for (const file of candidates) {
    try {
      return { file, text: await readFile(file, "utf8") }
    } catch (error) {
      if (isNotFoundError(error)) continue
      throw error
    }
  }
  return { file: candidates[0], text: "" }
}

async function writeGlobalLspConfig(enabled: boolean) {
  const current = await readGlobalConfigFile()
  const before = current.text.trim() ? current.text : JSON.stringify({ $schema: CONFIG_SCHEMA }, null, 2)
  const after = Jsonc.patch(before, { lsp: enabled })
  if (after !== current.text) await writeFile(current.file, after)
  return {
    file: current.file,
    changed: after !== current.text,
  }
}

function playwrightMcpConfig(input: { enabled: boolean; headless?: boolean }) {
  return {
    type: "local" as const,
    command: [
      "openchinacode",
      "mcp",
      "playwright",
      input.headless === false ? "--headed" : "--headless",
      "--browser=chrome",
      "--caps=default",
    ],
    enabled: input.enabled,
    timeout: TEST_MCP_TIMEOUT_MS,
  }
}

async function writeGlobalTestMcpConfig(input: { enabled: boolean; headless?: boolean }) {
  const current = await readGlobalConfigFile()
  const before = current.text.trim() ? current.text : JSON.stringify({ $schema: CONFIG_SCHEMA }, null, 2)
  const value = input.enabled ? playwrightMcpConfig(input) : { enabled: false }
  const after = Jsonc.patch(before, { mcp: { [TEST_MCP_NAME]: value } })
  if (after !== current.text) await writeFile(current.file, after)
  return {
    file: current.file,
    changed: after !== current.text,
    value,
  }
}

type AutoMaxTokensConfig = "off" | "heuristic" | "llm" | { mode: "llm"; model?: string; timeout_ms?: number }

async function writeGlobalAutoMaxTokensConfig(value: AutoMaxTokensConfig) {
  const current = await readGlobalConfigFile()
  const before = current.text.trim() ? current.text : JSON.stringify({ $schema: CONFIG_SCHEMA }, null, 2)
  const after = Jsonc.patch(before, { auto_maxtokens: value })
  if (after !== current.text) await writeFile(current.file, after)
  return {
    file: current.file,
    changed: after !== current.text,
  }
}

function hasEditorRangeSelection(selection: EditorSelection["ranges"][number]) {
  return (
    selection.selection.start.line !== selection.selection.end.line ||
    selection.selection.start.character !== selection.selection.end.character
  )
}

function getEditorRangeLabel(selection: EditorSelection["ranges"][number]) {
  if (!hasEditorRangeSelection(selection)) return
  if (selection.selection.start.line === selection.selection.end.line) return `#${selection.selection.start.line}`
  return `#${selection.selection.start.line}-${selection.selection.end.line}`
}

function formatEditorContext(selection: EditorSelection) {
  const selected = selection.ranges.filter(hasEditorRangeSelection)
  if (selected.length === 0)
    return `<system-reminder>Note: The user opened the file "${selection.filePath}". This may or may not be relevant to the current task.</system-reminder>\n`

  const ranges = selected.map((range, index) => {
    const prefix = selected.length > 1 ? `Selection ${index + 1}: ` : ""
    return `Note: The user selected ${prefix}${getEditorRangeLabel(range)} from "${selection.filePath}". \`\`\`${range.text}\`\`\`\n\n`
  })

  return `<system-reminder>${ranges.join("\n")} This may or may not be relevant to the current task.</system-reminder>\n`
}

let stashed: { prompt: PromptInfo; cursor: number } | undefined

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  const [inputTarget, setInputTarget] = createSignal<TextareaRenderable | undefined>()

  const leader = useLeaderActive()
  const local = useLocal()
  const args = useArgs()
  const paths = useTuiPaths()
  const terminalEnvironment = useTuiTerminalEnvironment()
  const clipboard = useClipboard()
  const sdk = useSDK()
  const editor = useEditorContext()
  const route = useRoute()
  const project = useProject()
  const sync = useSync()
  const tuiConfig = useTuiConfig()
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => sync.data.session_status?.[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const stash = usePromptStash()
  const keymap = useOpencodeKeymap()
  const agentShortcut = useCommandShortcut("agent.cycle")
  const paletteShortcut = useCommandShortcut("command.palette.show")
  const renderer = useRenderer()
  const exit = useExit()
  const dimensions = useTerminalDimensions()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  const animationsEnabled = createMemo(() => kv.get("animations_enabled", true))
  const list = createMemo(() => props.placeholders?.normal ?? [])
  const shell = createMemo(() => props.placeholders?.shell ?? [])
  const fileContextEnabled = createMemo(() => kv.get("file_context_enabled", true))
  const [dismissedEditorSelectionKey, setDismissedEditorSelectionKey] = createSignal<string>()
  const editorContext = createMemo(() => {
    const selection = fileContextEnabled() ? editor.selection() : undefined
    if (!selection) return
    return editorSelectionKey(selection) === dismissedEditorSelectionKey() ? undefined : selection
  })
  const editorPath = createMemo(() => editorContext()?.filePath)
  const editorSelectionLabel = createMemo(() => {
    const ranges = editorContext()?.ranges
    if (!ranges) return
    const first = ranges.find(hasEditorRangeSelection) ?? ranges[0]
    if (!first) return
    return [getEditorRangeLabel(first), ranges.length > 1 ? `+${ranges.length - 1}` : undefined]
      .filter(Boolean)
      .join(" ")
  })
  const editorFileLabel = createMemo(() => {
    const value = editorPath()
    if (!value) return
    const filename = path.basename(value)
    const file = /^index\.[^./]+$/.test(filename)
      ? [path.basename(path.dirname(value)), filename].filter(Boolean).join("/")
      : filename
    return `${file.split(path.sep).join("/")}${editorSelectionLabel() ?? ""}`
  })
  const editorFileLabelDisplay = createMemo(() => {
    const file = editorFileLabel()
    if (!file) return
    return Locale.truncateMiddle(file, Math.max(12, Math.min(48, Math.floor(dimensions().width / 3))))
  })
  const editorContextLabelState = createMemo(() => editor.labelState())
  const [auto, setAuto] = createSignal<AutocompleteRef>()
  const workspace = usePromptWorkspace(props.sessionID)
  const move = usePromptMove({ projectID: project.project, sessionID: () => props.sessionID })
  const [cursorVersion, setCursorVersion] = createSignal(0)
  const currentProviderLabel = createMemo(() => local.model.parsed().provider)
  const hasRightContent = createMemo(() => Boolean(props.right))

  function promptModelWarning() {
    toast.show({
      variant: "warning",
      message: "Connect a provider to send prompts",
      duration: 3000,
    })
    if (sync.data.provider.length === 0) {
      dialog.replace(() => <DialogProviderConnect />)
    }
  }

  function lspEnabled() {
    return sync.data.config.lsp !== undefined && sync.data.config.lsp !== false
  }

  function showLspStatus() {
    const active = sync.data.lsp.length
    if (!lspEnabled()) {
      toast.show({
        title: "LSP disabled",
        message: "Run /lsp on to enable built-in language servers. Restart OpenChinaCode after changing it.",
        variant: "warning",
        duration: 6000,
      })
      return
    }

    toast.show({
      title: "LSP enabled",
      message:
        active > 0
          ? `${active} language server${active === 1 ? "" : "s"} active.`
          : "Enabled in config. Language servers activate when matching files are read.",
      variant: active > 0 ? "success" : "info",
      duration: 6000,
    })
  }

  async function setLspEnabled(enabled: boolean) {
    try {
      const result = await writeGlobalLspConfig(enabled)
      sync.set("config", "lsp", enabled)
      toast.show({
        title: enabled ? "LSP enabled" : "LSP disabled",
        message: `${result.changed ? "Updated config" : "Config already set"}: ${result.file}. Restart OpenChinaCode to apply it.`,
        variant: "success",
        duration: 7000,
      })
    } catch (error) {
      toast.show({
        title: "Failed to update LSP",
        message: errorMessage(error),
        variant: "error",
        duration: 7000,
      })
    }
  }

  function handleLspSlash(args: string) {
    const action = parseLspSlashAction(args)
    switch (action) {
      case "status":
        showLspStatus()
        return
      case "on":
        void setLspEnabled(true)
        return
      case "off":
        void setLspEnabled(false)
        return
      case "help":
        toast.show({
          title: "LSP command",
          message: "Usage: /lsp, /lsp status, /lsp on, /lsp off",
          variant: "info",
          duration: 7000,
        })
        return
    }
  }

  function handleCompactSlash(args: string) {
    const action = parseCompactSlashAction(args)
    if (action.type === "help") {
      toast.show({
        title: "Compact command",
        message: "Usage: /compact, /compact keep N, /compact keep auto",
        variant: "info",
        duration: 7000,
      })
      return
    }

    if (!props.sessionID) {
      toast.show({
        title: "Compact session",
        message: "No active session to compact.",
        variant: "warning",
        duration: 4000,
      })
      return
    }

    const selectedModel = local.model.current()
    if (!selectedModel) {
      toast.show({
        variant: "warning",
        message: "Connect a provider to summarize this session",
        duration: 3000,
      })
      return
    }

    void sdk.client.session.summarize({
      sessionID: props.sessionID,
      modelID: selectedModel.modelID,
      providerID: selectedModel.providerID,
      manual_keep_turns: action.manualKeepTurns,
    })
    toast.show({
      title: "Smart compaction started",
      message:
        action.manualKeepTurns === undefined
          ? "Using active-task extraction with minimal raw recent tail."
          : `Using active-task extraction and raw tail keep ${action.manualKeepTurns} turn${action.manualKeepTurns === 1 ? "" : "s"}.`,
      variant: "info",
      duration: 5000,
    })
  }

  function currentMcpConfig() {
    const mcp = (sync.data.config as { mcp?: unknown }).mcp
    return isRecord(mcp) ? mcp : {}
  }

  function currentTestMcpConfig() {
    return currentMcpConfig()[TEST_MCP_NAME]
  }

  function testMcpEnabled() {
    const entry = currentTestMcpConfig()
    if (!isRecord(entry)) return false
    return entry.enabled !== false
  }

  function testMcpRuntimeStatus() {
    return sync.data.mcp[TEST_MCP_NAME]?.status
  }

  function testMcpModeLabel(entry: unknown) {
    if (!isRecord(entry)) return "not configured"
    const command = Array.isArray(entry.command) ? entry.command.filter((item) => typeof item === "string") : []
    const headed = !command.includes("--headless")
    const enabled = entry.enabled === false ? "disabled" : "enabled"
    return `${enabled}, ${headed ? "headed" : "headless"}`
  }

  function showTestMcpStatus() {
    const entry = currentTestMcpConfig()
    const runtime = testMcpRuntimeStatus()
    const chrome = findChromeExecutable()
    toast.show({
      title: "Playwright MCP",
      message: `${testMcpModeLabel(entry)}${runtime ? `, runtime: ${runtime}` : ""}. Chrome: ${chrome ? `found (${chrome})` : "missing"}. Usage: /test-mcp on, /test-mcp off, /test-mcp headed, /test-mcp status`,
      variant: testMcpEnabled() ? "success" : "info",
      duration: 8000,
    })
  }

  async function setTestMcpEnabled(enabled: boolean, headless?: boolean) {
    try {
      if (enabled && !findChromeExecutable()) {
        toast.show({
          title: "Chrome required for Playwright MCP",
          message: chromeMissingMessage(),
          variant: "error",
          duration: 14_000,
        })
        return
      }
      const result = await writeGlobalTestMcpConfig({ enabled, headless })
      const existing = currentTestMcpConfig()
      const runtimeConfig = playwrightMcpConfig({ enabled: true, headless })
      const nextEntry =
        enabled || !isRecord(existing)
          ? runtimeConfig
          : {
              ...existing,
              enabled: false,
            }
      sync.set(
        "config",
        "mcp" as any,
        {
          ...currentMcpConfig(),
          [TEST_MCP_NAME]: nextEntry,
        } as any,
      )

      if (enabled) {
        const added = await sdk.client.mcp.add({ name: TEST_MCP_NAME, config: runtimeConfig })
        if (added.error) throw added.error
        sync.set("mcp", added.data ?? {})
        const status = added.data?.[TEST_MCP_NAME]?.status ?? "configured"
        toast.show({
          title: status === "connected" ? "Playwright MCP connected" : "Playwright MCP configured",
          message: `${result.changed ? "Updated config" : "Config already set"}: ${result.file}. Runtime status: ${status}.`,
          variant: status === "connected" ? "success" : status === "failed" ? "error" : "info",
          duration: 9000,
        })
        return
      }

      const disconnected = await sdk.client.mcp.disconnect({ name: TEST_MCP_NAME })
      if (disconnected.error && !errorMessage(disconnected.error).toLowerCase().includes("not found")) {
        throw disconnected.error
      }
      const refreshed = await sdk.client.mcp.status()
      if (refreshed.error) throw refreshed.error
      sync.set("mcp", refreshed.data ?? {})
      toast.show({
        title: "Playwright MCP disabled",
        message: `${result.changed ? "Updated config" : "Config already set"}: ${result.file}. Disconnected in current session.`,
        variant: "success",
        duration: 8000,
      })
    } catch (error) {
      toast.show({
        title: "Failed to update Playwright MCP",
        message: errorMessage(error),
        variant: "error",
        duration: 8000,
      })
    }
  }

  function handleTestMcpSlash(args: string) {
    const action = parseTestMcpSlashAction(args)
    switch (action.type) {
      case "status":
        showTestMcpStatus()
        return
      case "on":
        void setTestMcpEnabled(true, action.headless)
        return
      case "off":
        void setTestMcpEnabled(false)
        return
      case "toggle":
        void setTestMcpEnabled(!testMcpEnabled())
        return
      case "help":
        toast.show({
          title: "Playwright MCP command",
          message: "Usage: /test-mcp [status|on|off|toggle|headless|headed]. Requires Google Chrome by default.",
          variant: "info",
          duration: 8000,
        })
        return
    }
  }

  function currentAutoMaxTokensConfig() {
    return (sync.data.config as { auto_maxtokens?: unknown }).auto_maxtokens
  }

  function describeAutoMaxTokensConfig(value: unknown) {
    if (value === false || value === "off") return "off"
    if (value === "llm") return "llm"
    if (typeof value === "object" && value !== null) {
      const config = value as { mode?: unknown; model?: unknown; timeout_ms?: unknown }
      const mode = config.mode === "llm" ? "llm" : config.mode === "off" ? "off" : "heuristic"
      const model = typeof config.model === "string" && config.model ? `, judge: ${config.model}` : ""
      const timeout = typeof config.timeout_ms === "number" ? `, timeout: ${config.timeout_ms}ms` : ""
      return `${mode}${model}${timeout}`
    }
    return "heuristic"
  }

  function showAutoMaxTokensStatus() {
    toast.show({
      title: "Auto max tokens",
      message: `Current strategy: ${describeAutoMaxTokensConfig(currentAutoMaxTokensConfig())}`,
      variant: "info",
      duration: 7000,
    })
  }

  async function setAutoMaxTokensConfig(value: AutoMaxTokensConfig) {
    try {
      const result = await writeGlobalAutoMaxTokensConfig(value)
      sync.set("config", "auto_maxtokens" as any, value as any)
      toast.show({
        title: "Auto max tokens updated",
        message: `${result.changed ? "Updated config" : "Config already set"}: ${result.file}. Restart OpenChinaCode to apply it.`,
        variant: "success",
        duration: 7000,
      })
    } catch (error) {
      toast.show({
        title: "Failed to update auto max tokens",
        message: errorMessage(error),
        variant: "error",
        duration: 7000,
      })
    }
  }

  function handleAutoMaxTokensSlash(args: string) {
    const action = parseAutoMaxTokensSlashAction(args)
    switch (action.type) {
      case "status":
        showAutoMaxTokensStatus()
        return
      case "off":
        void setAutoMaxTokensConfig("off")
        return
      case "heuristic":
        void setAutoMaxTokensConfig("heuristic")
        return
      case "llm":
        void setAutoMaxTokensConfig(action.model ? { mode: "llm", model: action.model } : "llm")
        return
      case "model":
        void setAutoMaxTokensConfig({ mode: "llm", model: action.model })
        return
      case "help":
        toast.show({
          title: "Auto max tokens command",
          message: "Usage: /auto-maxtokens [status|off|heuristic|llm [provider/model]|model provider/model]",
          variant: "info",
          duration: 8000,
        })
        return
    }
  }

  function selectDialog<T>(title: string, options: readonly DialogSelectOption<T>[], current?: T) {
    return new Promise<T | null>((resolve) => {
      let settled = false
      const finish = (value: T | null) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      dialog.replace(
        () => (
          <DialogSelect<T>
            title={title}
            options={[...options]}
            current={current}
            onSelect={(option) => {
              finish(option.value)
              dialog.clear()
            }}
          />
        ),
        () => finish(null),
      )
    })
  }

  function optionalLines(value: string | null) {
    if (value === null) return null
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  function submitSyntheticPrompt(text: string) {
    input.setText(text)
    setStore("prompt", {
      input: text,
      parts: [],
    })
    input.gotoBufferEnd()
    dialog.clear()
    setTimeout(() => {
      void submit()
    }, 0)
  }

  async function handleMediaAuthSlash(args: string) {
    try {
      const key =
        args.trim() ||
        (await DialogPrompt.show(dialog, "Volcengine Ark API key", {
          placeholder: "ARK API key",
          description: () => (
            <text fg={theme.textMuted}>Stored as {ARK_AUTH_PROVIDER_ID}. Environment fallback: ARK_API_KEY.</text>
          ),
        }))
      if (!key?.trim()) {
        dialog.clear()
        return
      }
      dialog.clear()
      await sdk.client.auth.set({
        providerID: ARK_AUTH_PROVIDER_ID,
        auth: {
          type: "api",
          key: key.trim(),
        },
      })
      await sdk.client.instance.dispose()
      await sync.bootstrap()
      toast.show({
        title: "Media auth saved",
        message: `Saved API key for ${ARK_AUTH_PROVIDER_ID}.`,
        variant: "success",
        duration: 6000,
      })
    } catch (error) {
      toast.show({
        title: "Failed to save media auth",
        message: errorMessage(error),
        variant: "error",
        duration: 7000,
      })
    }
  }

  async function runImageGenerateWizard(initialPrompt = "") {
    const prompt = await DialogPrompt.show(dialog, "Image prompt", {
      value: initialPrompt,
      placeholder: "Describe the image to generate",
    })
    if (!prompt?.trim()) {
      dialog.clear()
      return
    }

    const ratio = await selectDialog("Image aspect ratio", [
      { title: "1:1", value: "1:1", description: "Square" },
      { title: "16:9", value: "16:9", description: "Wide landscape" },
      { title: "9:16", value: "9:16", description: "Vertical phone/poster" },
      { title: "4:3", value: "4:3", description: "Classic landscape" },
      { title: "3:4", value: "3:4", description: "Classic portrait" },
      { title: "3:2", value: "3:2", description: "Photo landscape" },
      { title: "2:3", value: "2:3", description: "Photo portrait" },
      { title: "21:9", value: "21:9", description: "Cinematic wide" },
    ] as const)
    if (!ratio) return

    const sizeChoice = await selectDialog(
      "Image size",
      [
        { title: "2K", value: "2K", description: "Default, Seedream 5 Pro maximum tier" },
        { title: "1K", value: "1K", description: "Faster and lower cost" },
        { title: "Custom pixels", value: "custom", description: "Enter WIDTHxHEIGHT, for example 2048x1024" },
      ] as const,
      "2K",
    )
    if (!sizeChoice) return
    const size =
      sizeChoice === "custom"
        ? await DialogPrompt.show(dialog, "Image size pixels", {
            placeholder: "WIDTHxHEIGHT, e.g. 2048x1024",
          })
        : sizeChoice
    if (!size?.trim()) {
      dialog.clear()
      return
    }

    const outputFormat = await selectDialog(
      "Image format",
      [
        { title: "PNG", value: "png", description: "Lossless, best for UI/assets" },
        { title: "JPEG", value: "jpeg", description: "Smaller photo-style output" },
      ] as const,
      "png",
    )
    if (!outputFormat) return

    const refs = optionalLines(
      await DialogPrompt.show(dialog, "Reference images", {
        placeholder: "Optional paths/URLs, comma or newline separated",
      }),
    )
    if (refs === null) return

    const watermark = await selectDialog(
      "Watermark",
      [
        { title: "Off", value: false, description: "Default" },
        { title: "On", value: true, description: "Request provider watermark" },
      ] as const,
      false,
    )
    if (watermark === null) return

    submitSyntheticPrompt(
      [
        "Use OpenChinaCode native image generation.",
        "Call the image_generate tool with these parameters. If a reference path is invalid or an option is unsupported, stop and report the exact problem.",
        `prompt: ${prompt.trim()}`,
        `aspect_ratio: ${ratio}`,
        `size: ${size.trim()}`,
        `output_format: ${outputFormat}`,
        `watermark: ${watermark}`,
        refs.length ? `reference_images:\n${refs.map((item) => `- ${item}`).join("\n")}` : "reference_images: none",
        "After the tool succeeds, tell me the output_path and metadata_path.",
      ].join("\n"),
    )
  }

  async function runVideoGenerateWizard(initialPrompt = "") {
    const prompt = await DialogPrompt.show(dialog, "Video prompt", {
      value: initialPrompt,
      placeholder: "Describe the video to generate",
    })
    if (!prompt?.trim()) {
      dialog.clear()
      return
    }

    const ratio = await selectDialog(
      "Video aspect ratio",
      [
        { title: "Adaptive", value: "adaptive", description: "Let Seedance choose from prompt/references" },
        { title: "16:9", value: "16:9", description: "Wide landscape" },
        { title: "9:16", value: "9:16", description: "Vertical short video" },
        { title: "1:1", value: "1:1", description: "Square" },
        { title: "4:3", value: "4:3", description: "Classic landscape" },
        { title: "3:4", value: "3:4", description: "Classic portrait" },
        { title: "21:9", value: "21:9", description: "Cinematic wide" },
      ] as const,
      "adaptive",
    )
    if (!ratio) return

    const resolution = await selectDialog(
      "Video resolution",
      [
        { title: "720p", value: "720p", description: "Default for Seedance Mini" },
        { title: "480p", value: "480p", description: "Faster and lower cost" },
      ] as const,
      "720p",
    )
    if (!resolution) return

    const durationChoice = await selectDialog(
      "Video duration",
      [
        { title: "5s", value: "5", description: "Default" },
        { title: "8s", value: "8", description: "Short promo clip" },
        { title: "10s", value: "10", description: "Longer narrative beat" },
        { title: "15s", value: "15", description: "Maximum explicit duration" },
        { title: "Custom", value: "custom", description: "Enter 4-15 seconds" },
      ] as const,
      "5",
    )
    if (!durationChoice) return
    const duration =
      durationChoice === "custom"
        ? await DialogPrompt.show(dialog, "Video duration seconds", {
            placeholder: "Integer from 4 to 15",
            value: "5",
          })
        : durationChoice
    if (!duration?.trim()) {
      dialog.clear()
      return
    }

    const audio = await selectDialog(
      "Generate audio",
      [
        { title: "On", value: true, description: "Default" },
        { title: "Off", value: false, description: "Silent video" },
      ] as const,
      true,
    )
    if (audio === null) return

    const inputMode = await selectDialog(
      "Video input mode",
      [
        { title: "Text/reference", value: "reference", description: "Prompt plus optional reference images/videos" },
        { title: "First frame", value: "first_frame", description: "Use one image as the exact first frame" },
        { title: "First + last frame", value: "first_last_frame", description: "Use two images as strict first and last frames" },
      ] as const,
      "reference",
    )
    if (!inputMode) return

    let imageRefs: string[] = []
    let videoRefs: string[] = []
    let firstFrameImage = ""
    let lastFrameImage = ""
    if (inputMode === "reference") {
      const imageInput = optionalLines(
        await DialogPrompt.show(dialog, "Reference images", {
          placeholder: "Optional image paths/URLs, comma or newline separated; max 9",
        }),
      )
      if (imageInput === null) return
      imageRefs = imageInput

      const videoInput = optionalLines(
        await DialogPrompt.show(dialog, "Reference video URLs", {
          placeholder: "Optional URLs or asset ids; max 3; local video files are not supported",
        }),
      )
      if (videoInput === null) return
      videoRefs = videoInput
    } else {
      const first = await DialogPrompt.show(dialog, "First frame image", {
        placeholder: "Image path/URL/data URL/asset id",
      })
      if (!first?.trim()) {
        dialog.clear()
        return
      }
      firstFrameImage = first.trim()

      if (inputMode === "first_last_frame") {
        const last = await DialogPrompt.show(dialog, "Last frame image", {
          placeholder: "Image path/URL/data URL/asset id",
        })
        if (!last?.trim()) {
          dialog.clear()
          return
        }
        lastFrameImage = last.trim()
      }
    }

    const watermark = await selectDialog(
      "Watermark",
      [
        { title: "Off", value: false, description: "Default" },
        { title: "On", value: true, description: "Request provider watermark" },
      ] as const,
      false,
    )
    if (watermark === null) return

    submitSyntheticPrompt(
      [
        "Use OpenChinaCode native video generation.",
        "Call the video_generate tool with these parameters. If a reference path is invalid or an option is unsupported, stop and report the exact problem.",
        `prompt: ${prompt.trim()}`,
        `ratio: ${ratio}`,
        `resolution: ${resolution}`,
        `duration: ${duration.trim()}`,
        `generate_audio: ${audio}`,
        `watermark: ${watermark}`,
        inputMode === "reference"
          ? imageRefs.length
            ? `reference_images:\n${imageRefs.map((item) => `- ${item}`).join("\n")}`
            : "reference_images: none"
          : `first_frame_image: ${firstFrameImage}`,
        inputMode === "reference"
          ? videoRefs.length
            ? `reference_videos:\n${videoRefs.map((item) => `- ${item}`).join("\n")}`
            : "reference_videos: none"
          : lastFrameImage
            ? `last_frame_image: ${lastFrameImage}`
            : "last_frame_image: none",
        "After the tool succeeds, tell me the task_id, output_path, and metadata_path.",
      ].join("\n"),
    )
  }

  function insertPromptCommand(command: string) {
    const text = `/${command} `
    input.setText(text)
    setStore("prompt", {
      input: text,
      parts: [],
    })
    input.gotoBufferEnd()
    dialog.clear()
  }

  function showTaskPolicyDialog(focus?: string) {
    const promptText = store.prompt.input.trim()
    const slash = parseDirectSlashCommand(promptText)
    const isSlashDraft = promptText.startsWith("/") && !promptText.match(/\s/)
    if (isSlashDraft || slash?.command === "task-policy") clearPrompt()
    dialog.replace(() => <DialogTaskPolicy focus={focus} />)
  }

  function dismissEditorContext() {
    setDismissedEditorSelectionKey(editorSelectionKey(editorContext()))
    editor.clearSelection()
  }
  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId = 0
  const event = useEvent()

  event.on("tui.prompt.append", (evt, { workspace }) => {
    if (workspace !== project.workspace.current()) return
    if (!input || input.isDestroyed) return
    input.insertText(evt.properties.text)
    setTimeout(() => {
      // setTimeout is a workaround and needs to be addressed properly
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      input.gotoBufferEnd()
      renderer.requestRender()
    }, 0)
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.text
  })

  const lastUserMessage = createMemo(() => {
    if (!props.sessionID) return undefined
    const messages = sync.data.message[props.sessionID]
    if (!messages) return undefined
    return messages.findLast((m): m is UserMessage => m.role === "user")
  })

  const usage = createMemo(() => {
    if (!props.sessionID) return
    const session = sync.session.get(props.sessionID)
    const msg = sync.data.message[props.sessionID] ?? []
    const last = msg.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) return

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return

    const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const pct = model?.limit.context ? `${Math.round((tokens / model.limit.context) * 100)}%` : undefined
    const cost = session?.cost ?? 0
    return {
      context: pct ? `${Locale.number(tokens)} (${pct})` : Locale.number(tokens),
      cost: cost > 0 ? money.format(cost) : undefined,
    }
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
    placeholder: number
  }>({
    placeholder: randomIndex(list().length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
  })

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setStore("placeholder", randomIndex(list().length))
      },
      { defer: true },
    ),
  )

  // Initialize agent/model/variant from the persisted session state when a
  // session is opened. Fall back to the last user message for older sessions.
  let syncedSessionID: string | undefined
  createEffect(() => {
    const sessionID = props.sessionID
    const session = sessionID ? sync.session.get(sessionID) : undefined
    const msg = lastUserMessage()

    if (sessionID !== syncedSessionID) {
      if (!sessionID) return

      const model = session?.model
        ? {
            providerID: session.model.providerID,
            modelID: session.model.id,
            variant: session.model.variant === "default" ? undefined : session.model.variant,
          }
        : msg?.model
      const agent = session?.agent ?? msg?.agent

      if (!agent && !model) return
      if (agent && sync.data.agent.length === 0) return
      if (model) {
        const provider = sync.data.provider.find((item) => item.id === model.providerID)
        if (!provider?.models[model.modelID]) return
      }

      syncedSessionID = sessionID

      // Only set agent if it's a primary agent (not a subagent)
      const isPrimaryAgent = agent ? local.agent.list().some((x) => x.name === agent) : false
      if (agent && isPrimaryAgent) {
        // Keep command line --agent if specified.
        if (!args.agent) local.agent.set(agent)
      }

      if (model) {
        local.model.set(model)
        local.model.variant.set(model.variant)
      }
    }
  })

  const promptCommands = createMemo(() =>
    [
      {
        title: "Clear prompt",
        name: "prompt.clear",
        category: "Prompt",
        hidden: true,
        run: () => {
          clearPrompt()
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        name: "prompt.submit",
        category: "Prompt",
        hidden: true,
        run: async () => {
          if (!input.focused) return
          const handled = await submit()
          if (!handled) return

          dialog.clear()
        },
      },
      {
        title: "Remove editor context",
        name: "prompt.editor_context.clear",
        category: "Prompt",
        enabled: Boolean(editorContext()),
        run: () => {
          dismissEditorContext()
          dialog.clear()
        },
      },
      {
        title: "Paste",
        name: "prompt.paste",
        category: "Prompt",
        hidden: true,
        run: async (ctx: CommandContext<Renderable, KeyEvent>) => {
          ctx.event.preventDefault()
          ctx.event.stopPropagation()
          const content = await clipboard.read?.()
          if (content?.mime.startsWith("image/")) {
            await pasteAttachment({
              filename: "clipboard",
              mime: content.mime,
              content: content.data,
            })
            return
          }
          if (content?.mime === "text/plain") {
            await pasteInputText(content.data)
          }
        },
      },
      {
        title: "Interrupt session",
        name: "session.interrupt",
        category: "Session",
        hidden: true,
        enabled: status().type !== "idle",
        run: () => {
          if (auto()?.visible) return
          if (!input.focused) return
          // TODO: this should be its own command
          if (store.mode === "shell") {
            setStore("mode", "normal")
            return
          }
          if (!props.sessionID) return

          setStore("interrupt", store.interrupt + 1)

          setTimeout(() => {
            setStore("interrupt", 0)
          }, 5000)

          if (store.interrupt >= 2) {
            void sdk.client.session.abort({
              sessionID: props.sessionID,
            })
            setStore("interrupt", 0)
          }
          dialog.clear()
        },
      },
      {
        title: "Smart compaction",
        desc: "Usage: /compact [auto|smart|keep N|keep auto] - smart compaction with optional raw recent-turn retention",
        name: "openchinacode.compact",
        category: "OpenChinaCode",
        slashName: "compact",
        slashAliases: ["summarize"],
        run: () => {
          handleCompactSlash("")
          dialog.clear()
        },
      },
      {
        title: "LSP status",
        desc: "Usage: /lsp [status|on|off] - show or change language server support",
        name: "lsp.status",
        category: "OpenChinaCode",
        slashName: "lsp",
        run: () => {
          handleLspSlash("")
          dialog.clear()
        },
      },
      {
        title: "Auto max tokens",
        desc: "Usage: /auto-maxtokens [status|off|heuristic|llm [provider/model]|model provider/model]",
        name: "auto-maxtokens.status",
        category: "OpenChinaCode",
        slashName: "auto-maxtokens",
        slashAliases: ["auto-max-tokens"],
        run: () => {
          handleAutoMaxTokensSlash("")
          dialog.clear()
        },
      },
      {
        title: "Playwright MCP",
        desc: "Usage: /test-mcp [status|on|off|toggle|headless|headed] - configure browser test MCP; requires Chrome by default",
        name: "openchinacode.test_mcp",
        category: "OpenChinaCode",
        slashName: "test-mcp",
        slashAliases: ["playwright-mcp"],
        run: () => {
          handleTestMcpSlash("")
          dialog.clear()
        },
      },
      {
        title: "Generate image",
        desc: "Usage: /image-generate [prompt] - Seedream 5 Pro native image wizard",
        name: "openchinacode.image_generate",
        category: "OpenChinaCode",
        slashName: "image-generate",
        slashAliases: ["image"],
        run: () => {
          void runImageGenerateWizard()
        },
      },
      {
        title: "Generate video",
        desc: "Usage: /video-generate [prompt] - Seedance 2.0 Mini native video wizard",
        name: "openchinacode.video_generate",
        category: "OpenChinaCode",
        slashName: "video-generate",
        slashAliases: ["video"],
        run: () => {
          void runVideoGenerateWizard()
        },
      },
      {
        title: "Media auth",
        desc: "Usage: /media-auth - save Volcengine Ark API key for native image/video generation",
        name: "openchinacode.media_auth",
        category: "OpenChinaCode",
        slashName: "media-auth",
        slashAliases: ["ark-auth"],
        run: () => {
          void handleMediaAuthSlash("")
        },
      },
      {
        title: "Task policy",
        desc: "Usage: /task-policy [focus] - show OpenChinaCode task routing",
        name: "openchinacode.task_policy",
        category: "OpenChinaCode",
        slashName: "task-policy",
        run: () => showTaskPolicyDialog(),
      },
      {
        title: "Task classify",
        desc: "Usage: /task-classify <task> - classify kind/complexity and show the default route",
        name: "openchinacode.task_classify",
        category: "OpenChinaCode",
        slashName: "task-classify",
        run: () => insertPromptCommand("task-classify"),
      },
      {
        title: "Open editor",
        category: "Session",
        name: "prompt.editor",
        slashName: "editor",
        run: async () => {
          dialog.clear()

          // replace summarized text parts with the actual text
          const text = store.prompt.parts
            .filter((p) => p.type === "text")
            .reduce((acc, p) => {
              if (!p.source) return acc
              return acc.replace(p.source.text.value, p.text)
            }, store.prompt.input)

          const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

          const value = text
          const content = await openEditor({
            renderer,
            value,
            cwd:
              (project.instance.path().worktree === "/" ? undefined : project.instance.path().worktree) ||
              project.instance.directory() ||
              paths.cwd,
          })
          if (!content) return
          const normalized = normalizePromptContent(content)

          input.setText(normalized)

          // Update positions for nonTextParts based on their location in new content
          // Filter out parts whose virtual text was deleted
          // this handles a case where the user edits the text in the editor
          // such that the virtual text moves around or is deleted
          const updatedNonTextParts = nonTextParts
            .map((part) => {
              let virtualText = ""
              if (part.type === "file" && part.source?.text) {
                virtualText = part.source.text.value
              } else if (part.type === "agent" && part.source) {
                virtualText = part.source.value
              }

              if (!virtualText) return part

              const newStart = normalized.indexOf(virtualText)
              // if the virtual text is deleted, remove the part
              if (newStart === -1) return null

              const newEnd = newStart + virtualText.length

              if (part.type === "file" && part.source?.text) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    text: {
                      ...part.source.text,
                      start: newStart,
                      end: newEnd,
                    },
                  },
                }
              }

              if (part.type === "agent" && part.source) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    start: newStart,
                    end: newEnd,
                  },
                }
              }

              return part
            })
            .filter((part) => part !== null)

          setStore("prompt", {
            input: normalized,
            // keep only the non-text parts because the text parts were
            // already expanded inline
            parts: updatedNonTextParts,
          })
          restoreExtmarksFromParts(updatedNonTextParts)
          input.cursorOffset = Bun.stringWidth(normalized)
        },
      },
      {
        title: "Skills",
        name: "prompt.skills",
        category: "Prompt",
        slashName: "skills",
        run: () => {
          dialog.replace(() => (
            <DialogSkill
              onSelect={(skill) => {
                input.setText(`/${skill} `)
                setStore("prompt", {
                  input: `/${skill} `,
                  parts: [],
                })
                input.gotoBufferEnd()
              }}
            />
          ))
        },
      },
      {
        title: "Warp",
        desc: "Change the workspace for the session",
        name: "workspace.set",
        category: "Session",
        enabled: Flag.OPENCODE_EXPERIMENTAL_WORKSPACES,
        slashName: "warp",
        run: () => {
          workspace.open()
        },
      },
      {
        title: "Move session",
        desc: "Move to another project dir",
        name: "session.move",
        category: "Session",
        slashName: "move",
        run: () => {
          move.open()
        },
      },
    ].map((entry) => ({
      namespace: "palette",
      ...entry,
    })),
  )

  useBindings(() => ({
    commands: promptCommands(),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    bindings: tuiConfig.keybinds.gather("prompt.palette", [
      "prompt.submit",
      "prompt.editor",
      "prompt.editor_context.clear",
      "prompt.stash",
      "prompt.stash.pop",
      "prompt.stash.list",
      "prompt.skills",
      "openchinacode.compact",
      "lsp.status",
      "auto-maxtokens.status",
      "openchinacode.test_mcp",
      "openchinacode.image_generate",
      "openchinacode.video_generate",
      "openchinacode.media_auth",
      "openchinacode.task_policy",
      "openchinacode.task_classify",
      "session.interrupt",
      "workspace.set",
      "session.move",
    ]),
  }))

  const ref: PromptRef = {
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      input.setText(prompt.input)
      setStore("prompt", prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
    },
    submit() {
      void submit()
    },
  }

  onMount(() => {
    const saved = stashed
    stashed = undefined
    if (store.prompt.input) return
    if (saved && saved.prompt.input) {
      input.setText(saved.prompt.input)
      setStore("prompt", saved.prompt)
      restoreExtmarksFromParts(saved.prompt.parts)
      input.cursorOffset = saved.cursor
    }
  })

  onCleanup(() => {
    if (store.prompt.input) {
      stashed = { prompt: unwrap(store.prompt), cursor: input.cursorOffset }
    }
    setInputTarget(undefined)
    props.ref?.(undefined)
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (props.visible === false || dialog.stack.length > 0) {
      if (input.focused) input.blur()
      return
    }

    // Slot/plugin updates can remount the background prompt while a dialog is open.
    // Keep focus with the dialog and let the prompt reclaim it after the dialog closes.
    if (!input.focused) input.focus()
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    input.traits = {
      ...input.traits,
      ...computePromptTraits({
        mode: store.mode,
        autocompleteVisible: !!auto()?.visible,
      }),
    }
  })

  function restoreExtmarksFromParts(parts: PromptInfo["parts"]) {
    input.extmarks.clear()
    setStore("extmarkToPartIndex", new Map())

    parts.forEach((part, partIndex) => {
      let start = 0
      let end = 0
      let virtualText = ""
      let styleId: number | undefined

      if (part.type === "file" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = fileStyleId
      } else if (part.type === "agent" && part.source) {
        start = part.source.start
        end = part.source.end
        virtualText = part.source.value
        styleId = agentStyleId
      } else if (part.type === "text" && part.source?.text) {
        start = part.source.text.start
        end = part.source.text.end
        virtualText = part.source.text.value
        styleId = pasteStyleId
      }

      if (virtualText) {
        const extmarkId = input.extmarks.create({
          start,
          end,
          virtual: true,
          styleId,
          typeId: promptPartTypeId,
        })
        setStore("extmarkToPartIndex", (map: Map<number, number>) => {
          const newMap = new Map(map)
          newMap.set(extmarkId, partIndex)
          return newMap
        })
      }
    })
  }

  function syncExtmarksWithPromptParts() {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    setStore(
      produce((draft) => {
        const newMap = new Map<number, number>()
        const newParts: typeof draft.prompt.parts = []

        for (const extmark of allExtmarks) {
          const partIndex = draft.extmarkToPartIndex.get(extmark.id)
          if (partIndex !== undefined) {
            const part = draft.prompt.parts[partIndex]
            if (part) {
              if (part.type === "agent" && part.source) {
                part.source.start = extmark.start
                part.source.end = extmark.end
              } else if (part.type === "file" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              } else if (part.type === "text" && part.source?.text) {
                part.source.text.start = extmark.start
                part.source.text.end = extmark.end
              }
              newMap.set(extmark.id, newParts.length)
              newParts.push(part)
            }
          }
        }

        draft.extmarkToPartIndex = newMap
        draft.prompt.parts = newParts
      }),
    )
  }

  const stashCommands = createMemo(() =>
    [
      {
        title: "Stash prompt",
        name: "prompt.stash",
        category: "Prompt",
        enabled: !!store.prompt.input,
        run: () => {
          if (!store.prompt.input) return
          stash.push({
            input: store.prompt.input,
            parts: store.prompt.parts,
          })
          input.extmarks.clear()
          input.clear()
          setStore("prompt", { input: "", parts: [] })
          setStore("extmarkToPartIndex", new Map())
          dialog.clear()
        },
      },
      {
        title: "Stash pop",
        name: "prompt.stash.pop",
        category: "Prompt",
        enabled: stash.list().length > 0,
        run: () => {
          const entry = stash.pop()
          if (entry) {
            input.setText(entry.input)
            setStore("prompt", { input: entry.input, parts: entry.parts })
            restoreExtmarksFromParts(entry.parts)
            input.gotoBufferEnd()
          }
          dialog.clear()
        },
      },
      {
        title: "Stash list",
        name: "prompt.stash.list",
        category: "Prompt",
        enabled: stash.list().length > 0,
        run: () => {
          dialog.replace(() => (
            <DialogStash
              onSelect={(entry) => {
                input.setText(entry.input)
                setStore("prompt", { input: entry.input, parts: entry.parts })
                restoreExtmarksFromParts(entry.parts)
                input.gotoBufferEnd()
              }}
            />
          ))
        },
      },
    ].map((entry) => ({
      namespace: "palette",
      ...entry,
    })),
  )

  useBindings(() => ({
    commands: stashCommands(),
  }))

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: inputTarget() !== undefined && !props.disabled,
      bindings: tuiConfig.keybinds.get("prompt.paste"),
    }
  })

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: inputTarget() !== undefined && !props.disabled && store.prompt.input !== "",
      bindings: tuiConfig.keybinds.get("prompt.clear"),
    }
  })

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: (() => {
        cursorVersion()
        return (
          inputTarget() !== undefined &&
          !props.disabled &&
          store.mode === "normal" &&
          !auto()?.visible &&
          input?.visualCursor.offset === 0
        )
      })(),
      bindings: [
        {
          key: "!",
          desc: "Shell mode",
          group: "Prompt",
          cmd: () => {
            setStore("placeholder", randomIndex(shell().length))
            setStore("mode", "shell")
          },
        },
      ],
    }
  })

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: inputTarget() !== undefined && store.mode === "shell",
      bindings: [{ key: "escape", desc: "Exit shell mode", group: "Prompt", cmd: () => setStore("mode", "normal") }],
    }
  })

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: (() => {
        cursorVersion()
        return inputTarget() !== undefined && store.mode === "shell" && input?.visualCursor.offset === 0
      })(),
      bindings: [{ key: "backspace", desc: "Exit shell mode", group: "Prompt", cmd: () => setStore("mode", "normal") }],
    }
  })

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: (() => {
        cursorVersion()
        return inputTarget() !== undefined && !props.disabled && !auto()?.visible && input !== undefined
      })(),
      commands: [
        {
          name: "prompt.history.previous",
          title: "Previous prompt history",
          category: "Prompt",
          run() {
            if (input.cursorOffset !== 0) {
              if (input.scrollY + input.visualCursor.visualRow === 0) input.cursorOffset = 0
              return false
            }

            const item = history.move(-1, input.plainText)
            if (!item) return false
            input.setText(item.input)
            setStore("prompt", item)
            setStore("mode", item.mode ?? "normal")
            restoreExtmarksFromParts(item.parts)
            input.cursorOffset = 0
          },
        },
      ],
      bindings: tuiConfig.keybinds.get("prompt.history.previous"),
    }
  })

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: (() => {
        cursorVersion()
        return inputTarget() !== undefined && !props.disabled && !auto()?.visible && input !== undefined
      })(),
      commands: [
        {
          name: "prompt.history.next",
          title: "Next prompt history",
          category: "Prompt",
          run() {
            if (input.cursorOffset !== input.plainText.length) {
              if (
                input.scrollY + input.visualCursor.visualRow ===
                Math.max(0, input.editorView.getTotalVirtualLineCount() - 1)
              )
                input.cursorOffset = input.plainText.length
              return false
            }

            const item = history.move(1, input.plainText)
            if (!item) return false
            input.setText(item.input)
            setStore("prompt", item)
            setStore("mode", item.mode ?? "normal")
            restoreExtmarksFromParts(item.parts)
            input.cursorOffset = input.plainText.length
          },
        },
      ],
      bindings: tuiConfig.keybinds.get("prompt.history.next"),
    }
  })

  let submitting = false
  async function submit() {
    // Prevent overlapping invocations (e.g. a double-pressed Enter, or the
    // input's native onSubmit racing another dispatch). Without this guard,
    // a second call slips past the empty-input check before the first call
    // clears `store.prompt.input`, then awaits its own `session.create` and
    // ultimately reads the now-empty store — sending a phantom empty prompt
    // to a freshly created session.
    if (submitting) return false
    submitting = true
    try {
      return await submitInner()
    } finally {
      submitting = false
    }
  }

  async function submitInner() {
    workspace.clearNotice()

    // IME: double-defer may fire before onContentChange flushes the last
    // composed character (e.g. Korean hangul) to the store, so read
    // plainText directly and sync before any downstream reads.
    if (input && !input.isDestroyed && input.plainText !== store.prompt.input) {
      setStore("prompt", "input", input.plainText)
      syncExtmarksWithPromptParts()
    }
    if (props.disabled) return false
    if (workspace.creating() || move.creating()) return false
    if (auto()?.visible) return false
    if (!store.prompt.input) return false
    const trimmed = store.prompt.input.trim()
    if (dispatchDirectSlashCommand(trimmed)) return false

    const agent = local.agent.current()
    if (!agent) return false
    if (trimmed === "exit" || trimmed === "quit" || trimmed === ":q") {
      void exit()
      return true
    }
    const selectedModel = local.model.current()
    if (!selectedModel) {
      void promptModelWarning()
      return false
    }

    const workspaceSession = props.sessionID ? sync.session.get(props.sessionID) : undefined
    const workspaceID = workspaceSession?.workspaceID
    const workspaceStatus = workspaceID ? (project.workspace.status(workspaceID) ?? "error") : undefined
    if (props.sessionID && workspaceID && workspaceStatus !== "connected") {
      dialog.replace(() => (
        <DialogWorkspaceUnavailable
          onRestore={() => {
            workspace.open()
            return false
          }}
        />
      ))
      return false
    }

    const variant = local.model.variant.current()
    let sessionID = props.sessionID
    let finishMoveProgress = false
    if (sessionID == null) {
      const selectedWorkspace = workspace.selection()
      const workspaceID = selectedWorkspace?.type === "existing" ? selectedWorkspace.workspaceID : undefined

      const directory = await move.getDirectory(store.prompt.input)
      if (move.pending() && !directory) return false
      finishMoveProgress = Boolean(move.progress())

      const res = await sdk.client.session.create({
        directory,
        workspace: workspaceID,
        agent: agent.name,
        model: {
          providerID: selectedModel.providerID,
          id: selectedModel.modelID,
          variant,
        },
      })

      if (res.error) {
        if (finishMoveProgress) move.finishSubmit()
        console.log("Creating a session failed:", res.error)

        toast.show({
          message: "Creating a session failed. Open console for more details.",
          variant: "error",
        })

        return true
      }

      sessionID = res.data.id
    }

    const inputText = expandTrackedPastedText(
      store.prompt.input,
      input.extmarks.getAllForTypeId(promptPartTypeId).flatMap((extmark) => {
        const partIndex = store.extmarkToPartIndex.get(extmark.id)
        const part = partIndex === undefined ? undefined : store.prompt.parts[partIndex]
        if (part?.type !== "text") return []
        return [{ start: extmark.start, end: extmark.end, text: part.text }]
      }),
    )

    // Filter out text parts (pasted content) since they're now expanded inline
    const nonTextParts = store.prompt.parts.filter((part) => part.type !== "text")
    const imageParts = nonTextParts.filter(isImageFilePart)
    const imagePaths = imageParts.flatMap((part) => {
      const value = filePartPath(part)
      return value ? [value] : []
    })
    const shouldVisualPreprocess = imagePaths.length > 0 && !isPromptCommand(inputText)
    const nonImageParts = shouldVisualPreprocess ? nonTextParts.filter((part) => !isImageFilePart(part)) : nonTextParts

    // Capture mode before it gets reset
    const currentMode = store.mode
    const editorSelection = editorContext()
    const editorParts =
      editorSelection && editor.labelState() === "pending"
        ? [
            {
              type: "text" as const,
              text: formatEditorContext(editorSelection),
              synthetic: true,
              metadata: {
                kind: "editor_context",
                source: editorSelection.source ?? "editor",
                filePath: editorSelection.filePath,
                ranges: editorSelection.ranges,
              },
            },
          ]
        : []

    if (store.mode === "shell") {
      move.startSubmit()
      void sdk.client.session.shell({
        sessionID,
        agent: agent.name,
        model: {
          providerID: selectedModel.providerID,
          modelID: selectedModel.modelID,
        },
        command: inputText,
      })
      setStore("mode", "normal")
    } else if (isPromptCommand(inputText)) {
      move.startSubmit()
      // Parse command from first line, preserve multi-line content in arguments
      const firstLineEnd = inputText.indexOf("\n")
      const firstLine = firstLineEnd === -1 ? inputText : inputText.slice(0, firstLineEnd)
      const [command, ...firstLineArgs] = firstLine.split(" ")
      const restOfInput = firstLineEnd === -1 ? "" : inputText.slice(firstLineEnd + 1)
      const args = firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : "")

      void sdk.client.session.command({
        sessionID,
        command: command.slice(1),
        arguments: args,
        agent: agent.name,
        model: `${selectedModel.providerID}/${selectedModel.modelID}`,
        variant,
        parts: nonTextParts.filter((x) => x.type === "file"),
      })
    } else {
      move.startSubmit()
      const promptText = shouldVisualPreprocess ? visualPreprocessUserText(inputText, imagePaths) : inputText
      sdk.client.session
        .prompt(
          {
            sessionID,
            ...selectedModel,
            agent: agent.name,
            model: selectedModel,
            variant,
            parts: [
              ...editorParts,
              {
                type: "text",
                text: promptText,
              },
              ...(shouldVisualPreprocess ? [visualPreprocessSubtask(inputText, imagePaths)] : []),
              ...nonImageParts,
            ],
          },
          { throwOnError: true },
        )
        .catch((error) => {
          toast.show({
            title: "Failed to send prompt",
            message: errorMessage(error),
            variant: "error",
          })
        })
      if (editorParts.length > 0) editor.markSelectionSent()
    }
    history.append({
      ...store.prompt,
      mode: currentMode,
    })
    input.extmarks.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
    props.onSubmit?.()

    // temporary hack to make sure the message is sent
    if (!props.sessionID) {
      if (editorParts.length > 0) editor.preserveSelectionFromNewSession()
      setTimeout(() => {
        route.navigate({
          type: "session",
          sessionID,
        })
      }, 50)
    }
    input.clear()
    if (finishMoveProgress) move.finishSubmit()
    return true
  }

  function isPromptCommand(inputText: string) {
    if (!inputText.startsWith("/")) return false
    const command = inputText.split("\n")[0].split(" ")[0].slice(1).toLowerCase()
    if (BUILTIN_PROMPT_COMMANDS.has(command)) return true
    return sync.data.command.some((x) => x.name.toLowerCase() === command)
  }

  function pasteText(text: string, virtualText: string) {
    const currentOffset = input.cursorOffset
    const extmarkStart = currentOffset
    const extmarkEnd = extmarkStart + promptOffsetWidth(virtualText)

    input.insertText(virtualText + " ")

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push({
          type: "text" as const,
          text,
          source: {
            text: {
              start: extmarkStart,
              end: extmarkEnd,
              value: virtualText,
            },
          },
        })
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
  }

  async function pasteInputText(text: string) {
    const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    const pastedContent = normalizedText.trim()
    const filepath = pastedFilepath(pastedContent, terminalEnvironment.platform)
    const isUrl = /^(https?):\/\//.test(filepath)
    if (!isUrl) {
      const attachment = await readLocalAttachment(filepath)
      const filename = path.basename(filepath)
      if (attachment?.type === "text") {
        pasteText(attachment.content, `[SVG: ${filename ?? "image"}]`)
        return
      }
      if (attachment?.type === "binary") {
        await pasteAttachment({
          filename,
          filepath,
          mime: attachment.mime,
          content: Buffer.from(attachment.content).toString("base64"),
        })
        return
      }
    }

    const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
    if (
      (lineCount >= 3 || pastedContent.length > 150) &&
      kv.get("paste_summary_enabled", !sync.data.config.experimental?.disable_paste_summary)
    ) {
      pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
      return
    }

    input.insertText(normalizedText)

    setTimeout(() => {
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      renderer.requestRender()
    }, 0)
  }

  async function pasteAttachment(file: { filename?: string; filepath?: string; content: string; mime: string }) {
    let filepath = file.filepath
    let filename = file.filename
    if (file.mime.startsWith("image/") && !filepath) {
      const bytes = Buffer.from(file.content, "base64")
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16)
      const dir = path.join(VISUAL_PREPROCESS_ROOT, props.sessionID ?? "draft")
      await mkdir(dir, { recursive: true })
      filepath = path.join(dir, `clipboard-${hash}.${imageExt(file.mime)}`)
      await writeFile(filepath, bytes)
      filename = path.basename(filepath)
    }
    const currentOffset = input.cursorOffset
    const extmarkStart = currentOffset
    const pdf = file.mime === "application/pdf"
    const count = store.prompt.parts.filter((x) => {
      if (x.type !== "file") return false
      if (pdf) return x.mime === "application/pdf"
      return x.mime.startsWith("image/")
    }).length
    const virtualText = pdf ? `[PDF ${count + 1}]` : `[Image ${count + 1}]`
    const extmarkEnd = extmarkStart + virtualText.length
    const textToInsert = virtualText + " "

    input.insertText(textToInsert)

    const extmarkId = input.extmarks.create({
      start: extmarkStart,
      end: extmarkEnd,
      virtual: true,
      styleId: pasteStyleId,
      typeId: promptPartTypeId,
    })

    const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
      type: "file" as const,
      mime: file.mime,
      filename,
      url: `data:${file.mime};base64,${file.content}`,
      source: {
        type: "file",
        path: filepath ?? filename ?? "",
        text: {
          start: extmarkStart,
          end: extmarkEnd,
          value: virtualText,
        },
      },
    }
    setStore(
      produce((draft) => {
        const partIndex = draft.prompt.parts.length
        draft.prompt.parts.push(part)
        draft.extmarkToPartIndex.set(extmarkId, partIndex)
      }),
    )
    return
  }

  function clearPrompt() {
    if (store.prompt.input.trim().length >= DRAFT_RETENTION_MIN_CHARS || store.prompt.parts.length > 0) {
      history.append({
        ...store.prompt,
        mode: store.mode,
      })
    }
    input.clear()
    input.extmarks.clear()
    setStore("prompt", {
      input: "",
      parts: [],
    })
    setStore("extmarkToPartIndex", new Map())
  }

  function dispatchDirectSlashCommand(text: string) {
    const parsed = parseDirectSlashCommand(text)
    if (!parsed) return false
    if (parsed.command === "lsp") {
      clearPrompt()
      handleLspSlash(parsed.args)
      return true
    }
    if (parsed.command === "auto-maxtokens" || parsed.command === "auto-max-tokens") {
      clearPrompt()
      handleAutoMaxTokensSlash(parsed.args)
      return true
    }
    if (parsed.command === "test-mcp" || parsed.command === "playwright-mcp") {
      clearPrompt()
      handleTestMcpSlash(parsed.args)
      return true
    }
    if (parsed.command === "image-generate" || parsed.command === "image") {
      clearPrompt()
      void runImageGenerateWizard(parsed.args)
      return true
    }
    if (parsed.command === "video-generate" || parsed.command === "video") {
      clearPrompt()
      void runVideoGenerateWizard(parsed.args)
      return true
    }
    if (parsed.command === "media-auth" || parsed.command === "ark-auth") {
      clearPrompt()
      void handleMediaAuthSlash(parsed.args)
      return true
    }
    if (parsed.command === "compact" || parsed.command === "summarize") {
      clearPrompt()
      handleCompactSlash(parsed.args)
      return true
    }
    if (parsed.command === "task-policy") {
      showTaskPolicyDialog(parsed.args)
      return true
    }
    if (parsed.args) return false
    const requested = parsed.command
    const entries = keymap.getCommandEntries({
      visibility: "reachable",
      namespace: "palette",
      filter: (entry) => entry.hidden !== true && entry.name !== COMMAND_PALETTE_COMMAND,
    })
    const match = entries.find((entry) => {
      const slashName = entry.command.slashName
      const slashAliases = entry.command.slashAliases
      if (typeof slashName === "string" && slashName.toLowerCase() === requested) return true
      if (!Array.isArray(slashAliases)) return false
      return slashAliases.some((alias) => typeof alias === "string" && alias.toLowerCase() === requested)
    })
    if (!match) return false

    clearPrompt()
    keymap.dispatchCommand(match.command.name)
    return true
  }

  const highlight = createMemo(() => {
    if (leader()) return theme.border
    if (store.mode === "shell") return theme.primary
    const agent = local.agent.current()
    if (!agent) return theme.border
    return local.agent.color(agent.name)
  })

  const showVariant = createMemo(() => {
    const variants = local.model.variant.list()
    if (variants.length === 0) return false
    const current = local.model.variant.current()
    return !!current
  })

  const agentMetaAlpha = createFadeIn(() => !!local.agent.current(), animationsEnabled)
  const modelMetaAlpha = createFadeIn(() => !!local.agent.current() && store.mode === "normal", animationsEnabled)
  const variantMetaAlpha = createFadeIn(
    () => !!local.agent.current() && store.mode === "normal" && showVariant(),
    animationsEnabled,
  )
  const borderHighlight = createMemo(() => tint(theme.border, highlight(), agentMetaAlpha()))

  const placeholderText = createMemo(() => {
    if (props.showPlaceholder === false) return undefined
    if (store.mode === "shell") {
      if (!shell().length) return undefined
      const example = shell()[store.placeholder % shell().length]
      return `Run a command... "${example}"`
    }
    if (!list().length) return undefined
    return `Ask anything... "${list()[store.placeholder % list().length]}"`
  })

  const spinnerDef = createMemo(() => {
    const agent =
      status().type !== "idle"
        ? (local.agent.list().find((a) => a.name === lastUserMessage()?.agent) ?? local.agent.current())
        : local.agent.current()
    const color = agent ? local.agent.color(agent.name) : theme.border
    return {
      frames: createFrames({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
      color: createColors({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
    }
  })
  const maxHeight = createMemo(() => tuiConfig.prompt?.max_height ?? Math.max(6, Math.floor(dimensions().height / 3)))
  const moveLabelWidth = createMemo(() => Math.max(12, Math.min(44, dimensions().width - 48)))

  return (
    <>
      <box ref={(r: BoxRenderable) => (anchor = r)} visible={props.visible !== false} width="100%">
        <box
          width="100%"
          border={["left"]}
          borderColor={borderHighlight()}
          customBorderChars={{
            ...SplitBorder.customBorderChars,
            bottomLeft: "╹",
          }}
        >
          <box
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            flexShrink={0}
            backgroundColor={theme.backgroundElement}
            flexGrow={1}
            width="100%"
          >
            <textarea
              width="100%"
              placeholder={placeholderText()}
              placeholderColor={theme.textMuted}
              textColor={leader() ? theme.textMuted : theme.text}
              focusedTextColor={leader() ? theme.textMuted : theme.text}
              minHeight={1}
              maxHeight={maxHeight()}
              onContentChange={() => {
                const value = input.plainText
                setStore("prompt", "input", value)
                auto()?.onInput(value)
                syncExtmarksWithPromptParts()
                setCursorVersion((value) => value + 1)
              }}
              onCursorChange={() => setCursorVersion((value) => value + 1)}
              onKeyDown={(e: { preventDefault(): void }) => {
                if (props.disabled) {
                  e.preventDefault()
                  return
                }
              }}
              onSubmit={() => {
                // IME: double-defer so the last composed character (e.g. Korean
                // hangul) is flushed to plainText before we read it for submission.
                setTimeout(() => setTimeout(() => submit(), 0), 0)
              }}
              onPaste={async (event: PasteEvent) => {
                if (props.disabled) {
                  event.preventDefault()
                  return
                }

                // Normalize line endings at the boundary
                // Windows ConPTY/Terminal often sends CR-only newlines in bracketed paste
                // Replace CRLF first, then any remaining CR
                const normalizedText = decodePasteBytes(event.bytes).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
                const pastedContent = normalizedText.trim()

                // Windows Terminal <1.25 can surface image-only clipboard as an
                // empty bracketed paste. Windows Terminal 1.25+ does not.
                if (!pastedContent) {
                  keymap.dispatchCommand("prompt.paste")
                  return
                }

                // Once we cross an async boundary below, the terminal may perform its
                // default paste unless we suppress it first and handle insertion ourselves.
                event.preventDefault()

                await pasteInputText(normalizedText)
              }}
              ref={(r: TextareaRenderable) => {
                input = r
                Object.assign(r, {
                  getClipboardText: (text: string) => expandPastedTextPlaceholders(text, store.prompt.parts),
                })
                setInputTarget(r)
                if (promptPartTypeId === 0) {
                  promptPartTypeId = input.extmarks.registerType("prompt-part")
                }
                props.ref?.(ref)
                setTimeout(() => {
                  // setTimeout is a workaround and needs to be addressed properly
                  if (!input || input.isDestroyed) return
                  input.cursorColor = theme.text
                }, 0)
              }}
              onMouseDown={(r: MouseEvent) => r.target?.focus()}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={props.disabled ? theme.backgroundElement : theme.text}
              syntaxStyle={syntax()}
            />
            <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1} justifyContent="space-between">
              <box flexDirection="row" gap={1}>
                <Show when={local.agent.current()} fallback={<box height={1} />}>
                  {(agent) => (
                    <>
                      <text fg={fadeColor(highlight(), agentMetaAlpha())}>
                        {store.mode === "shell" ? "Shell" : Locale.titlecase(agent().name)}
                      </text>
                      <Show when={store.mode === "normal" && local.permission.mode === "auto"}>
                        <text fg={fadeColor(theme.textMuted, agentMetaAlpha())}>auto</text>
                      </Show>
                      <Show when={store.mode === "normal"}>
                        <box flexDirection="row" gap={1}>
                          <text fg={fadeColor(theme.textMuted, modelMetaAlpha())}>·</text>
                          <text
                            flexShrink={0}
                            fg={fadeColor(leader() ? theme.textMuted : theme.text, modelMetaAlpha())}
                          >
                            {local.model.parsed().model}
                          </text>
                          <text fg={fadeColor(theme.textMuted, modelMetaAlpha())}>{currentProviderLabel()}</text>
                          <Show when={showVariant()}>
                            <text fg={fadeColor(theme.textMuted, variantMetaAlpha())}>·</text>
                            <text>
                              <span style={{ fg: fadeColor(theme.warning, variantMetaAlpha()), bold: true }}>
                                {local.model.variant.current()}
                              </span>
                            </text>
                          </Show>
                        </box>
                      </Show>
                    </>
                  )}
                </Show>
              </box>
              <Show when={hasRightContent()}>
                <box flexDirection="row" gap={1} alignItems="center">
                  {props.right}
                </box>
              </Show>
            </box>
          </box>
        </box>
        <box
          height={1}
          border={["left"]}
          borderColor={borderHighlight()}
          customBorderChars={{
            ...EmptyBorder,
            vertical: theme.backgroundElement.a !== 0 ? "╹" : " ",
          }}
        >
          <box
            height={1}
            border={["bottom"]}
            borderColor={theme.backgroundElement}
            customBorderChars={
              theme.backgroundElement.a !== 0
                ? {
                    ...EmptyBorder,
                    horizontal: "▀",
                  }
                : {
                    ...EmptyBorder,
                    horizontal: " ",
                  }
            }
          />
        </box>
        <box width="100%" flexDirection="row" justifyContent="space-between">
          <Switch>
            <Match when={status().type !== "idle"}>
              <box
                flexDirection="row"
                gap={1}
                flexGrow={1}
                justifyContent={status().type === "retry" ? "space-between" : "flex-start"}
              >
                <box flexShrink={0} flexDirection="row" gap={1}>
                  <box marginLeft={1}>
                    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
                      <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
                    </Show>
                  </box>
                  <box flexDirection="row" gap={1} flexShrink={0}>
                    {(() => {
                      const retry = createMemo(() => {
                        const s = status()
                        if (s.type !== "retry") return
                        return s
                      })
                      const message = createMemo(() => {
                        const r = retry()
                        if (!r) return
                        if (r.message.includes("exceeded your current quota") && r.message.includes("gemini"))
                          return "gemini is way too hot right now"
                        if (r.message.length > 80) return r.message.slice(0, 80) + "..."
                        return r.message
                      })
                      const isTruncated = createMemo(() => {
                        const r = retry()
                        if (!r) return false
                        return r.message.length > 120
                      })
                      const [seconds, setSeconds] = createSignal(0)
                      onMount(() => {
                        const timer = setInterval(() => {
                          const next = retry()?.next
                          if (next) setSeconds(Math.round((next - Date.now()) / 1000))
                        }, 1000)

                        onCleanup(() => {
                          clearInterval(timer)
                        })
                      })
                      const handleMessageClick = () => {
                        const r = retry()
                        if (!r) return
                        if (isTruncated()) {
                          void DialogAlert.show(dialog, "Retry Error", r.message)
                        }
                      }

                      const retryText = () => {
                        const r = retry()
                        if (!r) return ""
                        const baseMessage = message()
                        const truncatedHint = isTruncated() ? " (click to expand)" : ""
                        const duration = formatDuration(seconds())
                        const retryInfo = ` [retrying ${duration ? `in ${duration} ` : ""}attempt #${r.attempt}]`
                        return baseMessage + truncatedHint + retryInfo
                      }

                      return (
                        <Show when={retry()}>
                          <box onMouseUp={handleMessageClick}>
                            <text fg={theme.error}>{retryText()}</text>
                          </box>
                        </Show>
                      )
                    })()}
                  </box>
                </box>
                <text fg={store.interrupt > 0 ? theme.primary : theme.text}>
                  esc{" "}
                  <span style={{ fg: store.interrupt > 0 ? theme.primary : theme.textMuted }}>
                    {store.interrupt > 0 ? "again to interrupt" : "interrupt"}
                  </span>
                </text>
              </box>
            </Match>
            <Match when={workspace.notice()}>
              {(notice) => (
                <box paddingLeft={3}>
                  <text fg={theme.accent}>{notice()}</text>
                </box>
              )}
            </Match>
            <Match when={workspace.label()}>
              {(label) => (
                <box paddingLeft={3} flexDirection="row" gap={1}>
                  <Show when={workspace.creating()}>
                    <Spinner color={theme.accent} />
                  </Show>
                  <text fg={workspace.creating() ? theme.accent : theme.text}>
                    {(() => {
                      const item = label()
                      if (item.type === "new") {
                        if (workspace.creating())
                          return `Creating ${item.workspaceType}${".".repeat(workspace.creatingDots())}`
                        return (
                          <>
                            Workspace <span style={{ fg: theme.textMuted }}>(new {item.workspaceType})</span>
                          </>
                        )
                      }
                      return (
                        <>
                          Workspace <span style={{ fg: theme.textMuted }}>{item.workspaceName}</span>
                        </>
                      )
                    })()}
                  </text>
                </box>
              )}
            </Match>
            <Match when={move.progress()}>
              {(progress) => (
                <box paddingLeft={3}>
                  <Spinner color={theme.accent}>
                    {progress()}
                    <span style={{ fg: theme.textMuted }}>{".".repeat(move.creatingDots())}</span>
                  </Spinner>
                </box>
              )}
            </Match>
            <Match when={move.pendingNew()}>
              <box paddingLeft={3}>
                <text fg={theme.accent}>(new working copy)</text>
              </box>
            </Match>
            <Match when={true}>{props.hint ?? <text />}</Match>
          </Switch>
          <Show when={status().type !== "retry"}>
            <box gap={2} flexDirection="row">
              <Show when={editorContextLabelState() !== "none" ? editorFileLabelDisplay() : undefined}>
                {(file) => (
                  <text fg={editorContextLabelState() === "pending" ? theme.secondary : theme.textMuted}>{file()}</text>
                )}
              </Show>
              <Switch>
                <Match when={store.mode === "normal"}>
                  <Switch>
                    <Match when={usage()}>
                      {(item) => (
                        <text fg={theme.textMuted} wrapMode="none">
                          {[item().context, item().cost].filter(Boolean).join(" · ")}
                        </text>
                      )}
                    </Match>
                    <Match when={true}>
                      <text fg={theme.text}>
                        {agentShortcut()} <span style={{ fg: theme.textMuted }}>agents</span>
                      </text>
                    </Match>
                  </Switch>
                  <text fg={theme.text}>
                    {paletteShortcut()} <span style={{ fg: theme.textMuted }}>commands</span>
                  </text>
                </Match>
                <Match when={store.mode === "shell"}>
                  <text fg={theme.text}>
                    esc <span style={{ fg: theme.textMuted }}>exit shell mode</span>
                  </text>
                </Match>
              </Switch>
            </box>
          </Show>
        </box>
      </box>
      <Autocomplete
        sessionID={props.sessionID}
        ref={(r) => {
          setAuto(() => r)
        }}
        anchor={() => anchor}
        input={() => input}
        setPrompt={(cb) => {
          setStore("prompt", produce(cb))
        }}
        setExtmark={(partIndex, extmarkId) => {
          setStore("extmarkToPartIndex", (map: Map<number, number>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, partIndex)
            return newMap
          })
        }}
        value={store.prompt.input}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        promptPartTypeId={() => promptPartTypeId}
      />
    </>
  )
}
