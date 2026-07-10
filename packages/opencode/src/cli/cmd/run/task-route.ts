import type { ToolPart } from "@opencode-ai/sdk/v2"

type Dict = Record<string, unknown>

function dict(value: unknown): Dict {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  return value as Dict
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const next = value.trim()
  return next || undefined
}

export function formatTaskRouteMetadata(metadata: unknown): string | undefined {
  const meta = dict(metadata)
  const model = dict(meta.model)
  const providerID = text(model.providerID)
  const modelID = text(model.modelID)
  if (!providerID || !modelID) return undefined

  const route = [`${providerID}/${modelID}`, text(meta.variant)].filter(Boolean).join("#")
  const policy = dict(meta.taskPolicy)
  const assignment = [text(policy.kind), text(policy.complexity)].filter(Boolean).join(".")
  const source = text(meta.modelSource)
  return [route, assignment, source].filter(Boolean).join(" · ")
}

export function formatTaskRoutePart(part: ToolPart): string | undefined {
  const state = part.state
  const metadata = "metadata" in state ? state.metadata : undefined
  return formatTaskRouteMetadata(metadata ?? part.metadata)
}
