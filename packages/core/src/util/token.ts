export * as Token from "./token"

const CHARS_PER_TOKEN = 4

// CJK and other densely-tokenized scripts (~1 char/token vs ~4 for ASCII).
// Covers Hangul Jamo, CJK radicals/punctuation, Hiragana, Katakana,
// CJK Unified + extensions A/B, Hangul syllables/compat Jamo,
// CJK compatibility ideographs, halfwidth/fullwidth forms.
const CJK_REGEX =
  /[\u1100-\u11FF\u2E80-\u2FFF\u3000-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u{20000}-\u{2FA1F}]/gu

export const estimate = (input: string) => {
  if (input.length === 0) return 0
  const cjk = input.match(CJK_REGEX)?.length ?? 0
  if (cjk === 0) return Math.round(input.length / CHARS_PER_TOKEN)
  const rest = input.length - cjk
  return Math.max(0, cjk + Math.round(rest / CHARS_PER_TOKEN))
}
