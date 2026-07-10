import { Auth } from "@/auth"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./video-status.txt"
import {
  SEEDANCE_2_MINI_MODEL,
  arkFetch,
  downloadMedia,
  getArkApiKey,
  mediaRoot,
  safeFilename,
  timestampSlug,
} from "./media-common"
import { extractVideoUrl, type ArkVideoTask } from "./video-generate"

export const Parameters = Schema.Struct({
  task_id: Schema.String.annotate({ description: "The Ark Seedance task id returned by video_generate." }),
  download: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to download the video when the task has succeeded. Defaults to true.",
  }),
  output_dir: Schema.optional(Schema.String).annotate({
    description:
      "Optional output directory. Relative paths are resolved against the worktree. Defaults to /tmp/openchinacode/media/videos.",
  }),
  filename_hint: Schema.optional(Schema.String).annotate({
    description: "Optional short filename hint, without extension.",
  }),
})

type Metadata = {
  model?: string
  task_id: string
  status: string
  output_path?: string
  metadata_path?: string
}

export const VideoStatusTool = Tool.define<typeof Parameters, Metadata, Auth.Service | FSUtil.Service>(
  "video_status",
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const fs = yield* FSUtil.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const taskID = params.task_id.trim()
          if (!taskID) throw new Error("task_id is required.")

          const instance = yield* InstanceState.context
          const apiKey = yield* getArkApiKey(auth)

          yield* ctx.ask({
            permission: "media",
            patterns: ["volcengine-ark/video_status"],
            always: ["*"],
            metadata: {
              provider: "volcengine-ark",
              task_id: taskID,
              download: params.download ?? true,
            },
          })

          const task = yield* arkFetch<ArkVideoTask>({
            path: `/contents/generations/tasks/${encodeURIComponent(taskID)}`,
            apiKey,
            signal: ctx.abort,
          })
          const status = task.status ?? "unknown"
          const model = task.model ?? SEEDANCE_2_MINI_MODEL

          if (status !== "succeeded" || params.download === false) {
            return {
              title: "Video task status",
              output: [
                "Video task status.",
                `model: ${model}`,
                `task_id: ${taskID}`,
                `status: ${status}`,
                status === "succeeded" && params.download === false
                  ? "download: skipped by request"
                  : "download: not available until task succeeds",
              ].join("\n"),
              metadata: {
                model,
                task_id: taskID,
                status,
              },
            }
          }

          const videoUrl = extractVideoUrl(task)
          if (!videoUrl) throw new Error("Task succeeded but did not return a video_url.")
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
              model,
              task_id: taskID,
              task,
              source_url_expires: "provider URL expires; local file downloaded immediately",
            },
          })

          return {
            title: "Video downloaded",
            output: [
              "Video task succeeded and the output was downloaded.",
              `model: ${model}`,
              `task_id: ${taskID}`,
              `status: ${status}`,
              `output_path: ${downloaded.path}`,
              `metadata_path: ${downloaded.metadataPath}`,
            ].join("\n"),
            metadata: {
              model,
              task_id: taskID,
              status,
              output_path: downloaded.path,
              metadata_path: downloaded.metadataPath,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
