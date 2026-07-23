import { Auth } from "@/auth"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./ocr-extract.txt"
import {
  BAIDU_OCR_AUTH_PROVIDER_ID,
  type SavedOcrOutput,
  baiduOcrAccessToken,
  getBaiduOcrCredentials,
  ocrOutputRoot,
  queryBaiduOcrTask,
  resolveOcrSource,
  saveBaiduOcrResult,
  submitBaiduOcrTask,
} from "./ocr-common"

const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_POLL_TIMEOUT_SECONDS = 180
const MAX_POLL_TIMEOUT_SECONDS = 900
const MAX_FILES = 10

export const Parameters = Schema.Struct({
  file: Schema.optional(Schema.String).annotate({
    description:
      "Single OCR file path, file:// URL, HTTP(S) URL, or data URL. Local paths are resolved relative to the current worktree.",
  }),
  files: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description:
      "OCR file paths, file:// URLs, HTTP(S) URLs, or data URLs. Local paths are resolved relative to the current worktree.",
  }),
  poll_timeout_seconds: Schema.optional(Schema.Number).annotate({
    description: "Maximum polling time per file in seconds, capped at 900. Defaults to 180.",
  }),
  poll_interval_seconds: Schema.optional(Schema.Number).annotate({
    description: "Polling interval in seconds. Defaults to 5, matching Baidu's 5-10 second guidance.",
  }),
  output_dir: Schema.optional(Schema.String).annotate({
    description:
      "Optional output directory. Relative paths are resolved against the worktree. Defaults to /tmp/openchinacode/ocr.",
  }),
})

type Metadata = {
  provider: string
  files: SavedOcrOutput[]
}

export const OcrExtractTool = Tool.define<typeof Parameters, Metadata, Auth.Service | FSUtil.Service>(
  "ocr_extract",
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const fs = yield* FSUtil.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const files = [...(params.file?.trim() ? [params.file.trim()] : []), ...(params.files ?? [])]
            .map((item) => item.trim())
            .filter(Boolean)
          if (!files.length) throw new Error("ocr_extract requires file or files.")
          if (files.length > MAX_FILES) throw new Error(`ocr_extract supports up to ${MAX_FILES} files per call.`)

          const pollTimeoutSeconds = Math.min(
            Math.max(params.poll_timeout_seconds ?? DEFAULT_POLL_TIMEOUT_SECONDS, 30),
            MAX_POLL_TIMEOUT_SECONDS,
          )
          const pollIntervalMs = Math.max(3, params.poll_interval_seconds ?? DEFAULT_POLL_INTERVAL_MS / 1000) * 1000
          const outputDir = ocrOutputRoot(instance, params.output_dir)

          yield* ctx.ask({
            permission: "ocr",
            patterns: ["baidu-unlimited-ocr/ocr_extract", ...files],
            always: ["*"],
            metadata: {
              provider: BAIDU_OCR_AUTH_PROVIDER_ID,
              file_count: files.length,
              poll_timeout_seconds: pollTimeoutSeconds,
              output_dir: outputDir,
            },
          })

          const credentials = yield* getBaiduOcrCredentials(auth)
          const accessToken = yield* baiduOcrAccessToken(credentials, ctx.abort)
          const saved: SavedOcrOutput[] = []

          for (const item of files) {
            if (ctx.abort.aborted) throw new Error("OCR extraction aborted.")
            const source = yield* resolveOcrSource(fs, instance, item)
            const submitted = yield* submitBaiduOcrTask(source, accessToken, ctx.abort)
            const taskID =
              typeof submitted.result === "object" && submitted.result !== null ? submitted.result.task_id : undefined
            if (!taskID) throw new Error(`Baidu OCR did not return a task_id for ${item}.`)

            yield* ctx.metadata({
              title: "OCR running",
              metadata: {
                provider: BAIDU_OCR_AUTH_PROVIDER_ID,
                source: source.type === "local" ? source.path : source.input,
                task_id: taskID,
                status: "submitted",
              },
            })

            const deadline = Date.now() + pollTimeoutSeconds * 1000
            let latest = submitted
            while (Date.now() < deadline) {
              if (ctx.abort.aborted) throw new Error("OCR extraction aborted.")
              yield* Effect.sleep(pollIntervalMs)
              latest = yield* queryBaiduOcrTask(taskID, accessToken, ctx.abort)
              const result = typeof latest.result === "object" && latest.result !== null ? latest.result : undefined
              const status = result?.status ?? "unknown"
              yield* ctx.metadata({
                title: "OCR running",
                metadata: {
                  provider: BAIDU_OCR_AUTH_PROVIDER_ID,
                  source: source.type === "local" ? source.path : source.input,
                  task_id: taskID,
                  status,
                },
              })
              if (status === "success") break
              if (status === "failed") throw new Error(`Baidu OCR failed for ${item}: ${result?.task_error ?? "unknown error"}`)
            }

            const result = typeof latest.result === "object" && latest.result !== null ? latest.result : undefined
            if (result?.status !== "success") {
              throw new Error(`Baidu OCR timed out for ${item}; task_id: ${taskID}`)
            }
            saved.push(
              yield* saveBaiduOcrResult({
                fs,
                outputDir,
                source,
                task: result,
                raw: latest,
                signal: ctx.abort,
              }),
            )
          }

          const output = [
            "OCR extraction completed.",
            `provider: ${BAIDU_OCR_AUTH_PROVIDER_ID}`,
            `file_count: ${saved.length}`,
            "",
            ...saved.flatMap((item, index) => [
              `file ${index + 1}: ${item.source}`,
              `task_id: ${item.taskID}`,
              `status: ${item.status}`,
              `markdown_path: ${item.markdownPath ?? "not returned"}`,
              `json_path: ${item.jsonPath ?? "not returned"}`,
              `metadata_path: ${item.metadataPath}`,
              "",
            ]),
            "If the user needs summary, analysis, translation, comparison, or table extraction, read markdown_path before answering.",
          ].join("\n")

          return {
            title: "OCR extracted",
            output,
            metadata: {
              provider: BAIDU_OCR_AUTH_PROVIDER_ID,
              files: saved,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
