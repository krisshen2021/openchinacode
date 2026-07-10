import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  ToolSchema,
  type Tool as MCPToolDef,
} from "@modelcontextprotocol/sdk/types.js"
import { dynamicTool, jsonSchema, type JSONSchema7, type Tool } from "ai"
import { Effect } from "effect"
import fs from "fs"
import os from "os"
import path from "path"

const DEFAULT_TIMEOUT = 30_000
const MAX_LIST_PAGES = 1_000
const PLAYWRIGHT_ARTIFACT_DIR = path.join(os.tmpdir(), "openchinacode-playwright")
const PLAYWRIGHT_ARTIFACT_TOOLS = new Set([
  "browser_console_messages",
  "browser_evaluate",
  "browser_network_request",
  "browser_network_requests",
  "browser_pdf_save",
  "browser_snapshot",
  "browser_start_video",
  "browser_storage_state",
  "browser_take_screenshot",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function defaultArtifactExt(toolName: string, args: Record<string, unknown>) {
  if (toolName === "browser_take_screenshot") return args.type === "jpeg" ? ".jpg" : ".png"
  if (toolName === "browser_pdf_save") return ".pdf"
  if (toolName === "browser_start_video") return ".webm"
  if (toolName === "browser_snapshot") return ".yml"
  if (toolName === "browser_storage_state") return ".json"
  return ".log"
}

function safeArtifactName(toolName: string, args: Record<string, unknown>, filename: string) {
  const trimmed = filename.trim()
  const base = path.basename(trimmed).replace(/[^a-zA-Z0-9._-]+/g, "_")
  const fallback = `${toolName.replace(/^browser_/, "").replaceAll("_", "-")}-${Date.now()}`
  const safe = !base || base === "." || base === ".." ? fallback : base
  return path.extname(safe) ? safe : safe + defaultArtifactExt(toolName, args)
}

async function rewritePlaywrightArtifactArgs(toolName: string, args: unknown) {
  const input = isRecord(args) ? { ...args } : {}
  if (!PLAYWRIGHT_ARTIFACT_TOOLS.has(toolName)) return { args: input }
  const filename = input.filename
  if (filename === undefined || filename === null) return { args: input }
  if (typeof filename !== "string") return { args: input }

  const trimmed = filename.trim()
  if (!trimmed || trimmed === "<auto>") {
    delete input.filename
    return { args: input }
  }

  await fs.promises.mkdir(PLAYWRIGHT_ARTIFACT_DIR, { recursive: true })
  const artifactPath = path.join(PLAYWRIGHT_ARTIFACT_DIR, safeArtifactName(toolName, input, trimmed))
  input.filename = artifactPath
  return { args: input, artifactPath }
}

function rewritePlaywrightArtifactResult<T extends { content: Array<{ type: string; text?: string }> }>(
  result: T,
  artifactPath: string | undefined,
): T {
  if (!artifactPath) return result
  const relative = `./${path.basename(artifactPath)}`
  return {
    ...result,
    content: result.content.map((item) =>
      item.type === "text" && typeof item.text === "string"
        ? { ...item, text: item.text.split(relative).join(artifactPath) }
        : item,
    ),
  }
}

const TolerantListToolsResultSchema = ListToolsResultSchema.extend({
  tools: ToolSchema.omit({ outputSchema: true }).array(),
})

export async function paginate<T, R extends { nextCursor?: string }>(
  list: (cursor?: string) => Promise<R>,
  items: (result: R) => T[],
) {
  const result: T[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const page = await list(cursor)
    result.push(...items(page))
    if (page.nextCursor === undefined) return result
    if (cursors.has(page.nextCursor)) throw new Error(`MCP list returned duplicate cursor: ${page.nextCursor}`)
    cursors.add(page.nextCursor)
    cursor = page.nextCursor
  }

  throw new Error(`MCP list exceeded ${MAX_LIST_PAGES} pages`)
}

export function defs(client: Client, timeout?: number) {
  return listTools(client, timeout ?? DEFAULT_TIMEOUT).pipe(Effect.catch(() => Effect.void))
}

export function convertTool(mcpTool: MCPToolDef, client: Client, timeout?: number): Tool {
  const inputSchema: JSONSchema7 = {
    ...(mcpTool.inputSchema as JSONSchema7),
    type: "object",
    properties: (mcpTool.inputSchema.properties ?? {}) as JSONSchema7["properties"],
    additionalProperties: false,
  }

  return dynamicTool({
    description: mcpTool.description ?? "",
    inputSchema: jsonSchema(inputSchema),
    execute: async (args: unknown, options) => {
      const rewritten = await rewritePlaywrightArtifactArgs(mcpTool.name, args)
      const result = await client.callTool(
        {
          name: mcpTool.name,
          arguments: rewritten.args,
        },
        CallToolResultSchema,
        {
          resetTimeoutOnProgress: true,
          signal: options.abortSignal,
          timeout,
          // The MCP SDK only sends a progress token when this hook is present, enabling timeout resets.
          onprogress: () => {},
        },
      )
      const output = rewritePlaywrightArtifactResult(result, rewritten.artifactPath)
      if (output.isError)
        throw new Error(
          output.content
            .flatMap((item) => (item.type === "text" ? [item.text] : []))
            .filter((text) => text.trim())
            .join("\n\n") || "MCP tool returned an error",
        )
      if (output.content.length > 0 || output.structuredContent === undefined || output.structuredContent === null)
        return output
      return {
        ...output,
        content: [{ type: "text" as const, text: JSON.stringify(output.structuredContent) }],
      }
    },
  })
}

export function fetch<T extends { name: string }>(
  clientName: string,
  client: Client,
  list: (client: Client) => Promise<T[]>,
  label: string,
  key?: (item: T) => string,
) {
  return Effect.tryPromise({
    try: () => list(client),
    catch: (error) => error,
  }).pipe(
    Effect.tapError((error) =>
      Effect.logWarning(`failed to get ${label}`, {
        clientName,
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
    Effect.map((items) => {
      const sanitizedClient = sanitize(clientName)
      // Escape both the separator and escape marker so `server:uri` keys remain unambiguous.
      const resourceClient = clientName.replaceAll("%", "%25").replaceAll(":", "%3A")
      return Object.fromEntries(
        items.map((item) => [
          key ? resourceClient + ":" + key(item) : sanitizedClient + ":" + sanitize(item.name),
          { ...item, client: clientName },
        ]),
      )
    }),
    Effect.orElseSucceed(() => undefined),
  )
}

export const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")

export const toolName = (clientName: string, name: string) => sanitize(clientName) + "_" + sanitize(name)

export function prompts(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.prompts) return Promise.resolve([])
  return paginate(
    (cursor) => client.listPrompts(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.prompts,
  )
}

export function resources(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.resources) return Promise.resolve([])
  return paginate(
    (cursor) => client.listResources(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.resources,
  )
}

export function resourceTemplates(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.resources) return Promise.resolve([])
  return paginate(
    (cursor) => client.listResourceTemplates(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.resourceTemplates,
  )
}

function listTools(client: Client, timeout: number) {
  return Effect.tryPromise({
    try: () =>
      paginate(
        async (cursor) => {
          const params = cursor === undefined ? undefined : { cursor }
          try {
            return await client.listTools(params, { timeout })
          } catch (error) {
            if (!(error instanceof Error) || !isOutputSchemaValidationError(error)) throw error
            return client.request({ method: "tools/list", params }, TolerantListToolsResultSchema, { timeout })
          }
        },
        (result) => result.tools,
      ),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

function isOutputSchemaValidationError(error: Error) {
  return /can't resolve reference|resolves to more than one schema|outputSchema|schema.*reference|reference.*schema/i.test(
    error.message,
  )
}

export * as McpCatalog from "./catalog"
