import type { TreeSitterClient } from "@opentui/core"

const disabledClient = {
  highlightOnce: async () => ({ highlights: [] }),
  destroy: async () => {},
} as unknown as TreeSitterClient

export function disabledTreeSitterClient(): TreeSitterClient {
  return disabledClient
}
