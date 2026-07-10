import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./image-generate.txt"
import {
  IMAGE_RATIOS,
  SEEDREAM_5_PRO_MODEL,
  downloadMedia,
  getArkApiKey,
  mediaRoot,
  referenceToImageInput,
  saveDataUrl,
  safeFilename,
  timestampSlug,
  arkFetch,
} from "./media-common"
import { Auth } from "@/auth"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"

const OUTPUT_FORMATS = ["png", "jpeg"] as const
const IMAGE_SIZE_TIERS = ["1K", "2K"] as const
const IMAGE_PIXEL_MIN = 1280 * 720
const IMAGE_PIXEL_MAX = 4_624_220
const MAX_REFERENCE_IMAGES = 10
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024

export const Parameters = Schema.Struct({
  prompt: Schema.String.annotate({
    description:
      "The image prompt. Include subject, style, composition, text requirements, constraints, and any user-provided creative details.",
  }),
  reference_images: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description:
      "Optional reference image paths, file:// URLs, HTTP(S) URLs, or data:image URLs. Local paths are resolved relative to the current worktree.",
  }),
  aspect_ratio: Schema.optional(Schema.Literals(IMAGE_RATIOS)).annotate({
    description: "Optional desired aspect ratio intent. Supported: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9.",
  }),
  size: Schema.optional(Schema.String).annotate({
    description:
      "Seedream 5 Pro image size. Defaults to 2K. Supported tiers: 1K, 2K. Also supports explicit WIDTHxHEIGHT pixels when total pixels are 921600-4624220 and aspect ratio is 1/16-16.",
  }),
  output_format: Schema.optional(Schema.Literals(OUTPUT_FORMATS)).annotate({
    description: "Saved image format. Defaults to png.",
  }),
  watermark: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to request a provider watermark. Defaults to false.",
  }),
  output_dir: Schema.optional(Schema.String).annotate({
    description:
      "Optional output directory. Relative paths are resolved against the worktree. Defaults to /tmp/openchinacode/media/images.",
  }),
  filename_hint: Schema.optional(Schema.String).annotate({
    description: "Optional short filename hint, without extension.",
  }),
})

type ArkImageResponse = {
  data?: Array<{
    url?: string
    b64_json?: string
    revised_prompt?: string
  }>
  created?: number
}

type Metadata = {
  model: string
  output_path: string
  metadata_path: string
  reference_count: number
  aspect_ratio?: string
  size: string
  output_format: string
}

function validateSeedream5ProSize(input: string | undefined) {
  const value = (input ?? "2K").trim()
  if ((IMAGE_SIZE_TIERS as readonly string[]).includes(value)) return value

  if (/^\d+[xX]\d+$/.test(value)) {
    const [widthRaw, heightRaw] = value.toLowerCase().split("x")
    const width = Number(widthRaw)
    const height = Number(heightRaw)
    const pixels = width * height
    const ratio = width / height
    if (
      Number.isSafeInteger(width) &&
      Number.isSafeInteger(height) &&
      width > 0 &&
      height > 0 &&
      pixels >= IMAGE_PIXEL_MIN &&
      pixels <= IMAGE_PIXEL_MAX &&
      ratio >= 1 / 16 &&
      ratio <= 16
    ) {
      return `${width}x${height}`
    }
    throw new Error(
      `Invalid Seedream 5 Pro image size "${input}". Explicit WIDTHxHEIGHT must have total pixels in [921600, 4624220] and aspect ratio in [1/16, 16].`,
    )
  }

  throw new Error(
    `Invalid Seedream 5 Pro image size "${input}". Supported values are 1K, 2K, or explicit WIDTHxHEIGHT pixels. 3K/4K are Seedream 5.0 Lite tiers, not Seedream 5.0 Pro tiers.`,
  )
}

export const ImageGenerateTool = Tool.define<typeof Parameters, Metadata, Auth.Service | FSUtil.Service>(
  "image_generate",
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
          if (!prompt) throw new Error("Image prompt is required.")

          const references = (params.reference_images ?? []).map((item) => item.trim()).filter(Boolean)
          if (references.length > MAX_REFERENCE_IMAGES) {
            throw new Error(
              `Seedream 5 Pro supports up to ${MAX_REFERENCE_IMAGES} reference images; received ${references.length}.`,
            )
          }

          const outputFormat = params.output_format ?? "png"
          const size = validateSeedream5ProSize(params.size)
          const ratioInstruction = params.aspect_ratio ? `\nAspect ratio requirement: ${params.aspect_ratio}.` : ""
          const finalPrompt = `${prompt}${ratioInstruction}`.trim()
          const apiKey = yield* getArkApiKey(auth)

          yield* ctx.ask({
            permission: "media",
            patterns: ["volcengine-ark/image_generate", ...references],
            always: ["*"],
            metadata: {
              provider: "volcengine-ark",
              model: SEEDREAM_5_PRO_MODEL,
              size,
              output_format: outputFormat,
              aspect_ratio: params.aspect_ratio,
              reference_count: references.length,
              prompt_preview: prompt.slice(0, 160),
            },
          })

          const imageInputs = yield* Effect.forEach(references, (item) => referenceToImageInput(fs, instance, item), {
            concurrency: 2,
          })

          const body = {
            model: SEEDREAM_5_PRO_MODEL,
            prompt: finalPrompt,
            size,
            output_format: outputFormat,
            response_format: "url",
            watermark: params.watermark ?? false,
            ...(imageInputs.length === 1
              ? { image: imageInputs[0] }
              : imageInputs.length > 1
                ? { image: imageInputs }
                : {}),
          }

          const result = yield* arkFetch<ArkImageResponse>({
            path: "/images/generations",
            method: "POST",
            apiKey,
            body,
            signal: ctx.abort,
          })

          const item = result.data?.[0]
          const url = item?.url ?? (item?.b64_json ? `data:image/${outputFormat};base64,${item.b64_json}` : undefined)
          if (!url)
            throw new Error("Ark image generation succeeded but did not return an image URL or b64_json payload.")

          const outputDir = mediaRoot(instance, "images", params.output_dir)
          const filename = `${timestampSlug()}-${safeFilename(params.filename_hint, "seedream")}.${outputFormat === "jpeg" ? "jpg" : "png"}`
          const downloaded = url.startsWith("data:")
            ? yield* saveDataUrl({
                fs,
                url,
                outputDir,
                filename,
                metadata: {
                  provider: "volcengine-ark",
                  model: SEEDREAM_5_PRO_MODEL,
                  request: {
                    ...body,
                    image: imageInputs.length ? `[${imageInputs.length} reference image(s)]` : undefined,
                  },
                  revised_prompt: item?.revised_prompt,
                },
              })
            : yield* downloadMedia({
                fs,
                url,
                outputDir,
                filename,
                signal: ctx.abort,
                metadata: {
                  provider: "volcengine-ark",
                  model: SEEDREAM_5_PRO_MODEL,
                  request: {
                    ...body,
                    image: imageInputs.length ? `[${imageInputs.length} reference image(s)]` : undefined,
                  },
                  revised_prompt: item?.revised_prompt,
                  source_url_expires: "provider URL expires; local file downloaded immediately",
                },
              })

          const output = [
            "Image generated successfully.",
            `model: ${SEEDREAM_5_PRO_MODEL}`,
            `output_path: ${downloaded.path}`,
            `metadata_path: ${downloaded.metadataPath}`,
            `reference_count: ${references.length}`,
            `aspect_ratio: ${params.aspect_ratio ?? "not specified"}`,
            `size: ${size}`,
            `format: ${outputFormat}`,
          ].join("\n")

          return {
            title: "Image generated",
            output,
            metadata: {
              model: SEEDREAM_5_PRO_MODEL,
              output_path: downloaded.path,
              metadata_path: downloaded.metadataPath,
              reference_count: references.length,
              ...(params.aspect_ratio ? { aspect_ratio: params.aspect_ratio } : {}),
              size,
              output_format: outputFormat,
            },
            attachments:
              downloaded.bytes.byteLength <= MAX_ATTACHMENT_BYTES
                ? [
                    {
                      type: "file" as const,
                      mime: downloaded.mime,
                      url: `data:${downloaded.mime};base64,${Buffer.from(downloaded.bytes).toString("base64")}`,
                    },
                  ]
                : undefined,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
