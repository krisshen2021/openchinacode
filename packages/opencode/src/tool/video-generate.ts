import { Auth } from "@/auth"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./video-generate.txt"
import {
  SEEDANCE_2_MINI_MODEL,
  VIDEO_RATIOS,
  VIDEO_RESOLUTIONS,
  arkFetch,
  downloadMedia,
  getArkApiKey,
  mediaRoot,
  referenceToImageInput,
  referenceToVideoUrl,
  safeFilename,
  timestampSlug,
} from "./media-common"

const MAX_REFERENCE_IMAGES = 10
const POLL_INTERVAL_MS = 10_000
const DEFAULT_POLL_TIMEOUT_SECONDS = 300
const MAX_POLL_TIMEOUT_SECONDS = 900

export const Parameters = Schema.Struct({
  prompt: Schema.String.annotate({
    description:
      "The video prompt. Include scene, camera motion, style, pacing, text/logo constraints, target audience, and user-provided creative details.",
  }),
  reference_images: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description:
      "Optional reference image paths, file:// URLs, HTTP(S) URLs, or data:image URLs. Local image paths are resolved relative to the current worktree.",
  }),
  reference_videos: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description:
      "Optional reference video URLs. Local video files are not supported in this MVP; use a public URL or uploaded asset id.",
  }),
  ratio: Schema.optional(Schema.Literals(VIDEO_RATIOS)).annotate({
    description: "Video aspect ratio. Defaults to adaptive. Supported: adaptive, 16:9, 4:3, 1:1, 3:4, 9:16, 21:9.",
  }),
  resolution: Schema.optional(Schema.Literals(VIDEO_RESOLUTIONS)).annotate({
    description: "Video resolution for Seedance 2.0 Mini. Defaults to 720p. Supported: 480p, 720p.",
  }),
  duration: Schema.optional(Schema.Number).annotate({
    description: "Video duration in seconds. Supported explicit range: 4 to 15. Defaults to 5.",
  }),
  generate_audio: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to generate audio. Defaults to true.",
  }),
  watermark: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to request a provider watermark. Defaults to false.",
  }),
  poll: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to poll until completion and download the video. Defaults to true.",
  }),
  poll_timeout_seconds: Schema.optional(Schema.Number).annotate({
    description: "Maximum polling time in seconds, capped at 900. Defaults to 300.",
  }),
  output_dir: Schema.optional(Schema.String).annotate({
    description: "Optional output directory relative to the worktree. Defaults to .openchinacode/media/videos.",
  }),
  filename_hint: Schema.optional(Schema.String).annotate({
    description: "Optional short filename hint, without extension.",
  }),
})

export type ArkVideoTask = {
  id?: string
  model?: string
  status?: string
  content?: {
    video_url?: string
  }
  output?: {
    video_url?: string
  }
  video_url?: string
  created_at?: number
  updated_at?: number
  resolution?: string
  ratio?: string
  duration?: number
  error?: {
    message?: string
    code?: string
  }
}

type Metadata = {
  model: string
  task_id: string
  status: string
  output_path?: string
  metadata_path?: string
  ratio: string
  resolution: string
  duration: number
}

export const VideoGenerateTool = Tool.define<typeof Parameters, Metadata, Auth.Service | FSUtil.Service>(
  "video_generate",
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const fs = yield* FSUtil.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const prompt = params.prompt.trim()
          if (!prompt) throw new Error("Video prompt is required.")

          const referenceImages = (params.reference_images ?? []).map((item) => item.trim()).filter(Boolean)
          const referenceVideos = (params.reference_videos ?? []).map((item) => item.trim()).filter(Boolean)
          if (referenceImages.length > MAX_REFERENCE_IMAGES) {
            throw new Error(
              `Seedance 2.0 Mini supports up to ${MAX_REFERENCE_IMAGES} reference images; received ${referenceImages.length}.`,
            )
          }

          const duration = params.duration ?? 5
          if (!Number.isInteger(duration) || duration < 4 || duration > 15) {
            throw new Error("Seedance 2.0 Mini duration must be an integer from 4 to 15 seconds.")
          }

          const ratio = params.ratio ?? "adaptive"
          const resolution = params.resolution ?? "720p"
          const apiKey = yield* getArkApiKey(auth)

          yield* ctx.ask({
            permission: "media",
            patterns: ["volcengine-ark/video_generate", ...referenceImages, ...referenceVideos],
            always: ["*"],
            metadata: {
              provider: "volcengine-ark",
              model: SEEDANCE_2_MINI_MODEL,
              ratio,
              resolution,
              duration,
              generate_audio: params.generate_audio ?? true,
              reference_image_count: referenceImages.length,
              reference_video_count: referenceVideos.length,
              prompt_preview: prompt.slice(0, 160),
            },
          })

          const imageInputs = yield* Effect.forEach(
            referenceImages,
            (item) => referenceToImageInput(fs, instance, item),
            { concurrency: 2 },
          )
          const videoInputs = yield* Effect.forEach(
            referenceVideos,
            (item) => referenceToVideoUrl(fs, instance, item),
            { concurrency: 2 },
          )

          const content = [
            { type: "text", text: prompt },
            ...imageInputs.map((url) => ({
              type: "image_url",
              role: "reference_image",
              image_url: { url },
            })),
            ...videoInputs.map((url) => ({
              type: "video_url",
              role: "reference_video",
              video_url: { url },
            })),
          ]

          const body = {
            model: SEEDANCE_2_MINI_MODEL,
            content,
            ratio,
            resolution,
            duration,
            generate_audio: params.generate_audio ?? true,
            watermark: params.watermark ?? false,
          }

          const created = yield* arkFetch<ArkVideoTask>({
            path: "/contents/generations/tasks",
            method: "POST",
            apiKey,
            body,
            signal: ctx.abort,
          })
          const taskID = created.id
          if (!taskID) throw new Error("Ark video generation did not return a task id.")

          const poll = params.poll ?? true
          if (!poll) {
            return {
              title: "Video task created",
              output: [
                "Video generation task created.",
                `model: ${SEEDANCE_2_MINI_MODEL}`,
                `task_id: ${taskID}`,
                `status: ${created.status ?? "queued"}`,
                "Run video_status with this task_id to check and download the result.",
              ].join("\n"),
              metadata: {
                model: SEEDANCE_2_MINI_MODEL,
                task_id: taskID,
                status: created.status ?? "queued",
                ratio,
                resolution,
                duration,
              },
            }
          }

          const timeoutSeconds = Math.min(
            Math.max(params.poll_timeout_seconds ?? DEFAULT_POLL_TIMEOUT_SECONDS, 30),
            MAX_POLL_TIMEOUT_SECONDS,
          )
          const deadline = Date.now() + timeoutSeconds * 1000
          let latest = created
          while (Date.now() < deadline) {
            if (ctx.abort.aborted) throw new Error("Video generation aborted.")
            latest = yield* arkFetch<ArkVideoTask>({
              path: `/contents/generations/tasks/${encodeURIComponent(taskID)}`,
              apiKey,
              signal: ctx.abort,
            })
            const status = latest.status ?? "unknown"
            if (status === "succeeded") break
            if (status === "failed" || status === "cancelled" || status === "expired") {
              const detail = latest.error?.message ? `: ${latest.error.message}` : ""
              throw new Error(`Video generation ${status}${detail}`)
            }
            yield* Effect.sleep(POLL_INTERVAL_MS)
          }

          if (latest.status !== "succeeded") {
            return {
              title: "Video task still running",
              output: [
                "Video generation is still running.",
                `model: ${SEEDANCE_2_MINI_MODEL}`,
                `task_id: ${taskID}`,
                `status: ${latest.status ?? "unknown"}`,
                `poll_timeout_seconds: ${timeoutSeconds}`,
                "Run video_status with this task_id later to download the result.",
              ].join("\n"),
              metadata: {
                model: SEEDANCE_2_MINI_MODEL,
                task_id: taskID,
                status: latest.status ?? "unknown",
                ratio,
                resolution,
                duration,
              },
            }
          }

          const videoUrl = extractVideoUrl(latest)
          if (!videoUrl) throw new Error("Ark video generation succeeded but did not return a video_url.")
          const outputDir = mediaRoot(instance, "videos", params.output_dir)
          const filename = `${timestampSlug()}-${safeFilename(params.filename_hint, "seedance")}.mp4`
          const downloaded = yield* downloadMedia({
            fs,
            url: videoUrl,
            outputDir,
            filename,
            signal: ctx.abort,
            metadata: {
              provider: "volcengine-ark",
              model: SEEDANCE_2_MINI_MODEL,
              task_id: taskID,
              request: {
                ...body,
                content: `[text + ${imageInputs.length} image reference(s) + ${videoInputs.length} video reference(s)]`,
              },
              task: latest,
              source_url_expires: "provider URL expires; local file downloaded immediately",
            },
          })

          return {
            title: "Video generated",
            output: [
              "Video generated successfully.",
              `model: ${SEEDANCE_2_MINI_MODEL}`,
              `task_id: ${taskID}`,
              `status: succeeded`,
              `output_path: ${downloaded.path}`,
              `metadata_path: ${downloaded.metadataPath}`,
              `ratio: ${ratio}`,
              `resolution: ${resolution}`,
              `duration: ${duration}`,
            ].join("\n"),
            metadata: {
              model: SEEDANCE_2_MINI_MODEL,
              task_id: taskID,
              status: "succeeded",
              output_path: downloaded.path,
              metadata_path: downloaded.metadataPath,
              ratio,
              resolution,
              duration,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export function extractVideoUrl(task: ArkVideoTask) {
  return task.content?.video_url ?? task.output?.video_url ?? task.video_url
}
