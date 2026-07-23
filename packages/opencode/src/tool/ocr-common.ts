import { Auth } from "@/auth"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import type { InstanceContext } from "@/project/instance-context"
import { json, safeFilename, timestampSlug } from "./media-common"

export const BAIDU_OCR_AUTH_PROVIDER_ID = "baidu-unlimited-ocr"
export const BAIDU_OCR_BASE_URL = "https://aip.baidubce.com"
export const DEFAULT_OCR_ROOT = path.join(os.tmpdir(), "openchinacode", "ocr")

export const OCR_DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".ofd",
  ".doc",
  ".docx",
  ".txt",
  ".wps",
  ".ppt",
  ".pptx",
] as const

export const OCR_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"] as const

export const OCR_DOCUMENT_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
])

export const OCR_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/bmp",
  "image/tiff",
])

const ALL_EXTENSIONS = new Set<string>([...OCR_DOCUMENT_EXTENSIONS, ...OCR_IMAGE_EXTENSIONS])
const MAX_IMAGE_FILE_DATA_BYTES = 10 * 1024 * 1024
const MAX_DOCUMENT_FILE_DATA_BYTES = 50 * 1024 * 1024

export type BaiduOcrCredentials = {
  apiKey: string
  secretKey: string
}

export type BaiduOcrTaskResult = {
  task_id?: string
  status?: "pending" | "running" | "success" | "failed" | string
  task_error?: string | null
  markdown_url?: string
  parse_result_url?: string
}

export type BaiduOcrResponse = {
  log_id?: string | number
  error_code?: number
  error_msg?: string
  result?: BaiduOcrTaskResult | string | null
}

export type OcrSource =
  | { type: "local"; input: string; path: string; filename: string; bytes: Uint8Array; mime: string }
  | { type: "url"; input: string; url: string; filename: string }
  | { type: "data"; input: string; filename: string; base64: string; mime: string }

export type SavedOcrOutput = {
  source: string
  taskID: string
  status: string
  markdownPath?: string
  jsonPath?: string
  metadataPath: string
  markdownBytes?: number
  jsonBytes?: number
}

export function isSupportedOcrExtension(input: string) {
  return ALL_EXTENSIONS.has(path.extname(input).toLowerCase())
}

export function isSupportedOcrMime(mime: string, includeImages = true) {
  return OCR_DOCUMENT_MIMES.has(mime) || (includeImages && OCR_IMAGE_MIMES.has(mime))
}

export function ocrOutputRoot(instance: InstanceContext, requested?: string) {
  return requested?.trim() ? path.resolve(instance.worktree, requested) : DEFAULT_OCR_ROOT
}

export function getBaiduOcrCredentials(auth: Auth.Interface) {
  return Effect.gen(function* () {
    const credentials = yield* auth.get(BAIDU_OCR_AUTH_PROVIDER_ID).pipe(Effect.orDie)
    if (credentials?.type === "api") {
      const apiKey = credentials.key.trim()
      const secretKey = credentials.metadata?.secret_key?.trim()
      if (apiKey && secretKey) return { apiKey, secretKey } satisfies BaiduOcrCredentials
    }

    const apiKey = process.env.BAIDU_OCR_API_KEY?.trim()
    const secretKey = process.env.BAIDU_OCR_SECRET_KEY?.trim()
    if (apiKey && secretKey) return { apiKey, secretKey } satisfies BaiduOcrCredentials

    throw new Error(
      `Missing Baidu Unlimited-OCR credentials. Set them with /ocr-auth or export BAIDU_OCR_API_KEY and BAIDU_OCR_SECRET_KEY. Auth provider id: ${BAIDU_OCR_AUTH_PROVIDER_ID}.`,
    )
  })
}

export function resolveOcrSource(fs: FSUtil.Interface, instance: InstanceContext, input: string) {
  return Effect.gen(function* () {
    const trimmed = input.trim()
    if (!trimmed) throw new Error("Empty OCR file reference.")

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const filename = filenameFromUrl(trimmed)
      if (!isSupportedOcrExtension(filename)) {
        throw new Error(`Unsupported OCR URL file extension: ${filename}`)
      }
      return { type: "url", input: trimmed, url: trimmed, filename } satisfies OcrSource
    }

    if (trimmed.startsWith("data:")) {
      const match = trimmed.match(/^data:([^;,]+);base64,(.*)$/)
      if (!match) throw new Error("OCR data URL must be base64 encoded.")
      const mime = match[1].toLowerCase()
      if (!isSupportedOcrMime(mime, true)) throw new Error(`Unsupported OCR data URL media type: ${mime}`)
      const bytes = Math.floor((match[2].length * 3) / 4)
      validateOcrFileDataSize(`attachment.${extensionFromMime(mime)}`, mime, bytes)
      return {
        type: "data",
        input: "data-url",
        filename: `attachment.${extensionFromMime(mime)}`,
        base64: match[2],
        mime,
      } satisfies OcrSource
    }

    const filepath = trimmed.startsWith("file://")
      ? fileURLToPath(trimmed)
      : path.isAbsolute(trimmed)
        ? trimmed
        : path.resolve(instance.worktree, trimmed)
    const exists = yield* fs.existsSafe(filepath)
    if (!exists) throw new Error(`OCR file not found: ${input} (${filepath})`)
    const stat = yield* fs.stat(filepath).pipe(Effect.orDie)
    if (stat.type !== "File") throw new Error(`OCR path is not a file: ${filepath}`)
    const filename = path.basename(filepath)
    const mime = FSUtil.mimeType(filepath)
    if (!isSupportedOcrExtension(filename) && !isSupportedOcrMime(mime, true)) {
      throw new Error(`Unsupported OCR file type for ${filepath}: ${mime || path.extname(filepath)}`)
    }
    const bytes = yield* fs.readFile(filepath).pipe(Effect.orDie)
    validateOcrFileDataSize(filename, mime, bytes.byteLength)
    return { type: "local", input: trimmed, path: filepath, filename, bytes, mime } satisfies OcrSource
  })
}

export function baiduOcrAccessToken(credentials: BaiduOcrCredentials, signal?: AbortSignal) {
  return Effect.tryPromise({
    try: async () => {
      const params = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: credentials.apiKey,
        client_secret: credentials.secretKey,
      })
      const response = await fetch(`${BAIDU_OCR_BASE_URL}/oauth/2.0/token?${params}`, { signal })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.access_token) {
        const detail = body.error_description ?? body.error ?? response.statusText
        throw new Error(`Baidu OCR token request failed: HTTP ${response.status}: ${detail}`)
      }
      return String(body.access_token)
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

export function baiduOcrPostForm<T>(path: string, accessToken: string, data: Record<string, string>, signal?: AbortSignal) {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${BAIDU_OCR_BASE_URL}${path}?access_token=${encodeURIComponent(accessToken)}`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(data),
      })
      const text = await response.text()
      const parsed = text ? tryParseJson(text) : undefined
      if (!response.ok) {
        throw new Error(`Baidu OCR request failed: HTTP ${response.status}: ${text || response.statusText}`)
      }
      const err = parsed as BaiduOcrResponse | undefined
      if (typeof err?.error_code === "number" && err.error_code !== 0) {
        throw new Error(`Baidu OCR request failed (${err.error_code}): ${err.error_msg ?? "unknown error"}`)
      }
      return parsed as T
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

export function submitBaiduOcrTask(source: OcrSource, accessToken: string, signal?: AbortSignal) {
  const data: Record<string, string> =
    source.type === "url"
      ? { file_url: source.url, file_name: source.filename }
      : {
          file_data: source.type === "data" ? source.base64 : Buffer.from(source.bytes).toString("base64"),
          file_name: source.filename,
        }
  return baiduOcrPostForm<BaiduOcrResponse>(
    "/rest/2.0/brain/online/v2/unlimited-ocr-parser/task",
    accessToken,
    data,
    signal,
  )
}

export function queryBaiduOcrTask(taskID: string, accessToken: string, signal?: AbortSignal) {
  return baiduOcrPostForm<BaiduOcrResponse>(
    "/rest/2.0/brain/online/v2/unlimited-ocr-parser/task/query",
    accessToken,
    { task_id: taskID },
    signal,
  )
}

export function saveBaiduOcrResult(input: {
  fs: FSUtil.Interface
  outputDir: string
  source: OcrSource
  task: BaiduOcrTaskResult
  raw: BaiduOcrResponse
  signal?: AbortSignal
}) {
  return Effect.gen(function* () {
    const base = `${timestampSlug()}-${safeFilename(path.basename(input.source.filename, path.extname(input.source.filename)), "ocr")}`
    yield* input.fs.ensureDir(input.outputDir).pipe(Effect.orDie)

    let markdownPath: string | undefined
    let jsonPath: string | undefined
    let markdownBytes: number | undefined
    let jsonBytes: number | undefined

    if (input.task.markdown_url) {
      const downloaded = yield* downloadBytes(input.task.markdown_url, input.signal)
      markdownPath = path.join(input.outputDir, `${base}.md`)
      markdownBytes = downloaded.byteLength
      yield* input.fs.writeFile(markdownPath, downloaded).pipe(Effect.orDie)
    }

    if (input.task.parse_result_url) {
      const downloaded = yield* downloadBytes(input.task.parse_result_url, input.signal)
      jsonPath = path.join(input.outputDir, `${base}.parse.json`)
      jsonBytes = downloaded.byteLength
      yield* input.fs.writeFile(jsonPath, downloaded).pipe(Effect.orDie)
    }

    const metadataPath = path.join(input.outputDir, `${base}.metadata.json`)
    yield* input.fs
      .writeFileString(
        metadataPath,
        json({
          provider: BAIDU_OCR_AUTH_PROVIDER_ID,
          source: summarizeSource(input.source),
          task: input.task,
          raw_response: input.raw,
          markdown_path: markdownPath,
          json_path: jsonPath,
          downloaded_at: new Date().toISOString(),
        }),
      )
      .pipe(Effect.orDie)

    return {
      source: input.source.type === "local" ? input.source.path : input.source.input,
      taskID: input.task.task_id ?? "",
      status: input.task.status ?? "unknown",
      markdownPath,
      jsonPath,
      metadataPath,
      markdownBytes,
      jsonBytes,
    } satisfies SavedOcrOutput
  })
}

function downloadBytes(url: string, signal?: AbortSignal) {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error(`OCR output download failed: HTTP ${response.status}: ${response.statusText}`)
      return new Uint8Array(await response.arrayBuffer())
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

function summarizeSource(source: OcrSource) {
  if (source.type === "local") {
    return { type: source.type, path: source.path, filename: source.filename, mime: source.mime, bytes: source.bytes.byteLength }
  }
  if (source.type === "data") return { type: source.type, filename: source.filename, mime: source.mime }
  return { type: source.type, url: source.url, filename: source.filename }
}

function validateOcrFileDataSize(filename: string, mime: string, bytes: number) {
  const ext = path.extname(filename).toLowerCase()
  const image = OCR_IMAGE_MIMES.has(mime) || OCR_IMAGE_EXTENSIONS.includes(ext as (typeof OCR_IMAGE_EXTENSIONS)[number])
  if (image && bytes > MAX_IMAGE_FILE_DATA_BYTES) {
    throw new Error(
      `Baidu Unlimited-OCR image file_data limit is 10MB; ${filename} is ${formatBytes(bytes)}. Use an HTTP(S) file_url instead.`,
    )
  }
  if (!image && bytes > MAX_DOCUMENT_FILE_DATA_BYTES) {
    throw new Error(
      `Baidu Unlimited-OCR local file_data should not exceed 50MB; ${filename} is ${formatBytes(bytes)}. Upload it somewhere reachable and pass an HTTP(S) file_url instead.`,
    )
  }
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${bytes}B`
}

function filenameFromUrl(input: string) {
  try {
    const url = new URL(input)
    const filename = path.basename(decodeURIComponent(url.pathname))
    return filename || "document.pdf"
  } catch {
    return "document.pdf"
  }
}

function extensionFromMime(mime: string) {
  if (mime === "application/pdf") return "pdf"
  if (mime === "image/jpeg") return "jpg"
  if (mime === "image/png") return "png"
  if (mime === "image/bmp") return "bmp"
  if (mime === "image/tiff") return "tiff"
  if (mime === "text/plain") return "txt"
  return "bin"
}

function tryParseJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
