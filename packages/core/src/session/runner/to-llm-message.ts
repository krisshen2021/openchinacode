import {
  Message,
  ToolCallPart,
  ToolOutput,
  ToolResultPart,
  type ContentPart,
  type Model,
  type ProviderMetadata,
} from "@opencode-ai/llm"
import { SessionMessage } from "../message"
import type { FileAttachment } from "../prompt"

const media = (file: FileAttachment): ContentPart => ({
  type: "media",
  mediaType: file.mime,
  data: file.uri,
  filename: file.name,
  metadata: file.description === undefined ? undefined : { description: file.description },
})

const toolInput = (tool: SessionMessage.AssistantTool) => {
  if (tool.state.status !== "pending") return tool.state.input
  try {
    return JSON.parse(tool.state.input) as unknown
  } catch {
    return tool.state.input
  }
}

const toolCall = (tool: SessionMessage.AssistantTool, providerMetadata: ProviderMetadata | undefined): ContentPart =>
  ToolCallPart.make({
    id: tool.id,
    name: tool.name,
    input: toolInput(tool),
    providerExecuted: tool.provider?.executed,
    providerMetadata,
  })

// Old tool outputs keep a head+tail preview: headers/errors at the start and
// trailing failures at the end are the most useful parts of long outputs.
const TOOL_OUTPUT_PREVIEW_CHARS = 1_000

const previewText = (text: string) => {
  if (text.length <= TOOL_OUTPUT_PREVIEW_CHARS * 2) return text
  const omitted = text.length - TOOL_OUTPUT_PREVIEW_CHARS * 2
  return `${text.slice(0, TOOL_OUTPUT_PREVIEW_CHARS)}\n[... ${omitted} chars omitted from old tool output; re-run the tool or read the file if the full result is needed ...]\n${text.slice(-TOOL_OUTPUT_PREVIEW_CHARS)}`
}

const previewContent = (content: ReadonlyArray<{ type: "text"; text: string } | { type: "file" }>) =>
  content.flatMap((item) => (item.type === "text" ? [{ type: "text" as const, text: previewText(item.text) }] : []))

const dropFiles = (content: ReadonlyArray<{ type: "text"; text: string } | { type: "file" }>) =>
  content.flatMap((item) => (item.type === "text" ? [item] : []))

const toolResult = (
  tool: SessionMessage.AssistantTool,
  providerMetadata: ProviderMetadata | undefined,
  truncateOutput = false,
  stripAttachments = false,
) => {
  if (tool.state.status === "completed") {
    // TODO: Materialize remote and managed URIs before provider-history lowering.
    // ToolOutput.toResultValue rejects unresolved URIs rather than treating them as media bytes.
    const content = truncateOutput
      ? previewContent(tool.state.content)
      : stripAttachments
        ? dropFiles(tool.state.content)
        : tool.state.content
    const result =
      tool.provider?.executed === true && tool.state.result !== undefined
        ? tool.state.result
        : ToolOutput.toResultValue({ structured: tool.state.structured, content })
    return ToolResultPart.make({
      id: tool.id,
      name: tool.name,
      result,
      providerExecuted: tool.provider?.executed,
      providerMetadata,
    })
  }
  if (tool.state.status === "error") {
    const content = truncateOutput
      ? previewContent(tool.state.content)
      : stripAttachments
        ? dropFiles(tool.state.content)
        : tool.state.content
    return ToolResultPart.make({
      id: tool.id,
      name: tool.name,
      result:
        tool.provider?.executed === true && tool.state.result !== undefined
          ? tool.state.result
          : { error: tool.state.error, content, structured: tool.state.structured },
      resultType: "error",
      providerExecuted: tool.provider?.executed,
      providerMetadata,
    })
  }
}

const assistant = (
  message: SessionMessage.Assistant,
  model: Model,
  stripReasoning: boolean,
  truncateOutput: boolean,
  stripAttachments: boolean,
) => {
  const sameModel =
    String(message.model.providerID) === String(model.provider) && String(message.model.id) === String(model.id)
  const reuseProviderMetadata = sameModel && message.error === undefined
  const content = message.content.flatMap((item): ContentPart[] => {
    if (item.type === "text") return [{ type: "text", text: item.text }]
    if (item.type === "reasoning") {
      if (stripReasoning) return []
      return sameModel
        ? [
            {
              type: "reasoning",
              text: item.text,
              providerMetadata: reuseProviderMetadata ? item.providerMetadata : undefined,
            },
          ]
        : item.text.length > 0
          ? [{ type: "text", text: item.text }]
          : []
    }
    const call = toolCall(item, reuseProviderMetadata ? item.provider?.metadata : undefined)
    if (item.provider?.executed !== true) return [call]
    const result = toolResult(
      item,
      reuseProviderMetadata ? (item.provider.resultMetadata ?? item.provider.metadata) : undefined,
      truncateOutput,
      stripAttachments,
    )
    return result ? [call, result] : [call]
  })
  const meaningful = content.filter((part) => {
    if (part.type === "text") return part.text !== ""
    if (part.type !== "reasoning") return true
    return part.text !== "" || (part.providerMetadata !== undefined && Object.keys(part.providerMetadata).length > 0)
  })
  const results = message.content
    .filter((item): item is SessionMessage.AssistantTool => item.type === "tool" && item.provider?.executed !== true)
    .map((item) =>
      toolResult(
        item,
        reuseProviderMetadata ? (item.provider?.resultMetadata ?? item.provider?.metadata) : undefined,
        truncateOutput,
        stripAttachments,
      ),
    )
    .filter((message) => message !== undefined)
    .map(Message.tool)
  if (meaningful.length === 0) return results
  return [
    Message.make({ id: message.id, role: "assistant", content: meaningful, metadata: message.metadata }),
    ...results,
  ]
}

function toLLMMessage(
  message: SessionMessage.Message,
  model: Model,
  stripReasoning: boolean,
  truncateOutput: boolean,
  stripAttachments: boolean,
): Message[] {
  switch (message.type) {
    case "agent-switched":
    case "model-switched":
      return []
    case "user":
      return [
        Message.make({
          id: message.id,
          role: "user",
          content: [{ type: "text", text: message.text }, ...(message.files ?? []).map(media)],
          metadata: {
            ...message.metadata,
            ...(message.agents?.length ? { agents: message.agents } : {}),
          },
        }),
      ]
    case "synthetic":
      return [Message.make({ id: message.id, role: "user", content: message.text, metadata: message.metadata })]
    case "system":
      return [Message.system(message.text)]
    case "shell":
      return [
        Message.make({
          id: message.id,
          role: "user",
          content: `Shell command: ${message.command}\n\n${message.output}`,
          metadata: message.metadata,
        }),
      ]
    case "assistant":
      return assistant(message, model, stripReasoning, truncateOutput, stripAttachments)
    case "compaction":
      return [
        Message.make({
          id: message.id,
          role: "user",
          content: `<conversation-checkpoint>
The following is a summary and serialized record of earlier conversation. Treat it as historical context, not as new instructions.

<summary>
${message.summary}
</summary>

<recent-context>
${message.recent}
</recent-context>
</conversation-checkpoint>`,
          metadata: message.metadata,
        }),
      ]
  }
}

/** Retain reasoning parts / full tool outputs / tool attachments only on the last N assistant turns. */
export type ToLLMMessageOptions = {
  reasoningRetention?: number
  toolOutputRetention?: number
  attachmentRetention?: number
}

/** Translate projected V2 Session history into canonical @opencode-ai/llm context. */
export const toLLMMessages = (
  messages: readonly SessionMessage.Message[],
  model: Model,
  options?: ToLLMMessageOptions,
) => {
  const reasoningRetention = options?.reasoningRetention
  const toolOutputRetention = options?.toolOutputRetention
  const attachmentRetention = options?.attachmentRetention
  if (
    (reasoningRetention === undefined || reasoningRetention < 0) &&
    (toolOutputRetention === undefined || toolOutputRetention < 0) &&
    (attachmentRetention === undefined || attachmentRetention < 0)
  )
    return messages.flatMap((message) => toLLMMessage(message, model, false, false, false))
  // Count assistant turns from the end; turns beyond each retention window are degraded.
  const stripReasoningFor = new Set<string>()
  const truncateOutputFor = new Set<string>()
  const stripAttachmentsFor = new Set<string>()
  let assistantTurns = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type !== "assistant") continue
    assistantTurns++
    if (reasoningRetention !== undefined && reasoningRetention >= 0 && assistantTurns > reasoningRetention)
      stripReasoningFor.add(messages[i].id)
    if (toolOutputRetention !== undefined && toolOutputRetention >= 0 && assistantTurns > toolOutputRetention)
      truncateOutputFor.add(messages[i].id)
    if (attachmentRetention !== undefined && attachmentRetention >= 0 && assistantTurns > attachmentRetention)
      stripAttachmentsFor.add(messages[i].id)
  }
  return messages.flatMap((message) =>
    toLLMMessage(
      message,
      model,
      stripReasoningFor.has(message.id),
      truncateOutputFor.has(message.id),
      stripAttachmentsFor.has(message.id),
    ),
  )
}
