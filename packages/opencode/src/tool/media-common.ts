import { Auth } from "@/auth"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import type { InstanceContext } from "@/project/instance-context"

export const ARK_AUTH_PROVIDER_ID = "volcengine-ark"
export const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
export const SEEDREAM_5_PRO_MODEL = "doubao-seedream-5-0-pro-260628"
export const SEEDANCE_2_MINI_MODEL = "doubao-seedance-2-0-mini-260615"
export const DEFAULT_MEDIA_ROOT = path.join(os.tmpdir(), "openchinacode", "media")

export const IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"] as const
export const VIDEO_RATIOS = ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"] as const
export const VIDEO_RESOLUTIONS = ["480p", "720p"] as const

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/webm"])
const ASSET_REF_PREFIXES = ["asset://", "qasset://"]

type ArkErrorBody = {
  error?: {
    message?: string
    code?: string
  }
  message?: string
}

export type MediaFile = {
  path: string
  mime: string
  bytes: Uint8Array
}

export type DownloadedMedia = {
  path: string
  metadataPath: string
  bytes: Uint8Array
  mime: string
}

export function safeFilename(input: string | undefined, fallback: string) {
  const cleaned = (input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return cleaned || fallback
}

export function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

export function json(value: unknown) {
  return JSON.stringify(value, null, 2)
}

export function getArkApiKey(auth: Auth.Interface) {
  return Effect.gen(function* () {
    const credentials = yield* auth.get(ARK_AUTH_PROVIDER_ID).pipe(Effect.orDie)
    if (credentials?.type === "api" && credentials.key.trim()) return credentials.key.trim()
    const env = process.env.ARK_API_KEY?.trim()
    if (env) return env
    throw new Error(
      `Missing Volcengine Ark API key. Set it with /media-auth or export ARK_API_KEY. Auth provider id: ${ARK_AUTH_PROVIDER_ID}.`,
    )
  })
}

export function mediaRoot(instance: InstanceContext, kind: "images" | "videos", requested?: string) {
  return requested?.trim()
    ? path.resolve(instance.worktree, requested)
    : path.join(DEFAULT_MEDIA_ROOT, kind)
}

export function resolveInputPath(instance: InstanceContext, input: string) {
  const raw = input.trim()
  if (!raw) throw new Error("Empty media reference path")
  if (raw.startsWith("file://")) return fileURLToPath(raw)
  return path.isAbsolute(raw) ? raw : path.resolve(instance.worktree, raw)
}

export function readLocalMedia(fs: FSUtil.Interface, instance: InstanceContext, input: string, allowed: Set<string>) {
  return Effect.gen(function* () {
    const filepath = resolveInputPath(instance, input)
    const exists = yield* fs.existsSafe(filepath)
    if (!exists) throw new Error(`Reference file not found: ${input} (${filepath})`)
    const stat = yield* fs.stat(filepath).pipe(Effect.orDie)
    if (stat.type !== "File") throw new Error(`Reference path is not a file: ${filepath}`)
    const mime = FSUtil.mimeType(filepath)
    if (!allowed.has(mime)) {
      throw new Error(`Unsupported reference media type for ${filepath}: ${mime}`)
    }
    const bytes = yield* fs.readFile(filepath).pipe(Effect.orDie)
    return { path: filepath, mime, bytes } satisfies MediaFile
  })
}

export function referenceToImageInput(fs: FSUtil.Interface, instance: InstanceContext, input: string) {
  return Effect.gen(function* () {
    const trimmed = input.trim()
    if (!trimmed) return ""
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:image/")) {
      return trimmed
    }
    if (ASSET_REF_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return trimmed
    const file = yield* readLocalMedia(fs, instance, trimmed, IMAGE_MIMES)
    return `data:${file.mime};base64,${Buffer.from(file.bytes).toString("base64")}`
  })
}

export function referenceToVideoUrl(fs: FSUtil.Interface, instance: InstanceContext, input: string) {
  return Effect.gen(function* () {
    const trimmed = input.trim()
    if (!trimmed) return ""
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed
    if (ASSET_REF_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return trimmed
    if (trimmed.startsWith("data:video/")) {
      throw new Error(
        "Seedance video references require a URL or uploaded asset id; local/base64 video input is not supported in this MVP.",
      )
    }
    yield* readLocalMedia(fs, instance, trimmed, VIDEO_MIMES)
    throw new Error(
      "Seedance video references require a URL or uploaded asset id; local video files are not supported in this MVP.",
    )
  })
}

export function arkFetch<T>(input: {
  path: string
  method?: string
  apiKey: string
  body?: unknown
  signal?: AbortSignal
}) {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${ARK_BASE_URL}${input.path}`, {
        method: input.method ?? "GET",
        signal: input.signal,
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      })
      const text = await response.text()
      const parsed = text ? tryParseJson(text) : undefined
      if (!response.ok) {
        const err = parsed as ArkErrorBody | undefined
        const message = err?.error?.message ?? err?.message ?? text ?? response.statusText
        const code = err?.error?.code ? ` (${err.error.code})` : ""
        throw new Error(`Ark API request failed: HTTP ${response.status}${code}: ${message}`)
      }
      return parsed as T
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

export function downloadMedia(input: {
  fs: FSUtil.Interface
  url: string
  outputDir: string
  filename: string
  metadata: Record<string, unknown>
  signal?: AbortSignal
}) {
  return Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(input.url, { signal: input.signal })
        if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}: ${response.statusText}`)
        const mime = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream"
        const bytes = new Uint8Array(await response.arrayBuffer())
        return { mime, bytes }
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })

    const filepath = path.join(input.outputDir, input.filename)
    const metadataPath = `${filepath}.json`
    yield* input.fs.ensureDir(input.outputDir).pipe(Effect.orDie)
    yield* input.fs.writeFile(filepath, result.bytes).pipe(Effect.orDie)
    yield* input.fs
      .writeFileString(
        metadataPath,
        json({
          ...input.metadata,
          output_path: filepath,
          mime: result.mime,
          bytes: result.bytes.byteLength,
          downloaded_at: new Date().toISOString(),
        }),
      )
      .pipe(Effect.orDie)

    return { path: filepath, metadataPath, bytes: result.bytes, mime: result.mime } satisfies DownloadedMedia
  })
}

export function saveDataUrl(input: {
  fs: FSUtil.Interface
  url: string
  outputDir: string
  filename: string
  metadata: Record<string, unknown>
}) {
  return Effect.gen(function* () {
    const match = input.url.match(/^data:([^;,]+);base64,(.*)$/)
    if (!match) throw new Error("Unsupported data URL returned by Ark media generation.")
    const mime = match[1]
    const bytes = Buffer.from(match[2], "base64")
    const filepath = path.join(input.outputDir, input.filename)
    const metadataPath = `${filepath}.json`
    yield* input.fs.ensureDir(input.outputDir).pipe(Effect.orDie)
    yield* input.fs.writeFile(filepath, bytes).pipe(Effect.orDie)
    yield* input.fs
      .writeFileString(
        metadataPath,
        json({
          ...input.metadata,
          output_path: filepath,
          mime,
          bytes: bytes.byteLength,
          downloaded_at: new Date().toISOString(),
        }),
      )
      .pipe(Effect.orDie)
    return { path: filepath, metadataPath, bytes, mime } satisfies DownloadedMedia
  })
}

function tryParseJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
