type ModelInfoLike = {
  capabilities?: {
    attachment?: boolean
    input?: {
      image?: boolean
    }
  }
}

export function supportsDirectImageInput(model: ModelInfoLike | undefined) {
  return model?.capabilities?.attachment === true && model.capabilities.input?.image === true
}

export function shouldUseVisualPreprocess(input: {
  imageCount: number
  isPromptCommand: boolean
  model: ModelInfoLike | undefined
}) {
  if (input.imageCount <= 0) return false
  if (input.isPromptCommand) return false
  return !supportsDirectImageInput(input.model)
}
