import { isRecord } from "../../util/record"

// Submits a question reply/reject and normalizes every failure mode to a
// message string. These calls used to be fire-and-forget (`void`), so any
// transient failure left the question dialog on screen forever with zero
// feedback and the session parked on an unanswered question.
export async function submitQuestion(input: {
  send: () => Promise<{ error?: unknown }>
  timeoutMs?: number
}): Promise<string | undefined> {
  const timeoutMs = input.timeoutMs ?? 15_000
  let timer: Timer | undefined
  try {
    const result = await Promise.race([
      input.send(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("submit timed out")), timeoutMs)
      }),
    ])
    if (result.error) return errorText(result.error)
    return undefined
  } catch (error) {
    return errorText(error)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (isRecord(error) && isRecord(error.data) && typeof error.data.message === "string") return error.data.message
  if (typeof error === "string") return error
  return String(error)
}
