# Vision-model discovery follow-up fixes — results

**Date:** 2026-08-22
**Branch:** memory-surgery (surgery worktree only)
**Commits:** `d08b09bf2`, `28dae2a02`, `f23885038`, `be2a74eee`

## Reported symptoms

User added the newly discovered `deepseek-v4-flash-vision-exp` (a vision
model) and pasted an image:

1. The image was still delegated to the glm-5v-turbo preprocessing subagent
   instead of the vision model inspecting it directly.
2. The session immediately started compacting, claiming context overflow.

## Root causes (all verified against logs, DB, and live reproduction)

### A. Discovered models got text-only default metadata

`discover.ts mergeInto` fell back to `attachment: false` +
`input.image: false` for models with no models.dev catalog hit. The TUI
`shouldUseVisualPreprocess` reads exactly those fields, so the genuinely
vision-capable model was routed to glm preprocessing.

**Fix:** infer vision support from the model id
(`vision` / standalone `vl` / `<digit>v` patterns) when falling back to
defaults (`d08b09bf2`). Catalog and config metadata still win.

### B. Attachment router inlined the image's data URL into a text part

The visual-preprocessing subtask references the pasted image via `@path`.
Admission (`resolvePromptParts`) hardcoded every `@`-file to `text/plain`,
so the PNG went through the read-as-text branch; the read tool returned the
image as a data-URL attachment (no `source.path`). `filePartReference` then
returned that data URL and `applyAttachmentRouter` embedded it in the
synthetic router text: one 732 KB PNG became a **999,471-char text part ≈
250k estimated tokens**, over glm-5v-turbo's 200k context →
`ContextOverflowError` → subagent compaction overflowed too (251k) → empty
subagent output.

**Fixes** (`28dae2a02`):

- `filePartReference` never inlines data URLs (root fix).
- `@`-file expansion labels image/pdf files with their real mime, so images
  reach the model as proper media parts.
- The token estimator discounts data URLs embedded inside larger strings,
  not just whole-string payloads.

### C. `usable` computed to 0 → infinite auto-compaction

`overflow.ts usable()` reserved the full `ProviderTransform.maxOutputTokens`
when computing trigger headroom. The china-transform deepseek-v4 policy
reserves **131,072** output tokens; the vision-exp model's discovered-default
context is **128,000** → usable = 0 → every turn was an overflow →
auto-compaction after every step (a smoke session compacted **17 times** at
24k usage). This is the main-session side of symptom 2.

**Fix:** bound the reservation to half the context window
(`be2a74eee`). Big-context models keep their previous trigger.

## Session persistence loss window (unresolved, instrumented)

On 2026-08-21 12:41–12:52 UTC the running server lost every durable write
for TUI-driven sessions: `created` logged, zero session/message/part/event
rows, no error anywhere; direct project-row writes in the same window
landed. The window opened ~2 min after a provider refresh
(`markInstanceForDisposal`). Not reproducible afterwards (3 independent
attempts persisted fine). `event_sequence` rows prove the durable
transactions never committed. Since normal durable publishes cannot be
dropped silently by the current code, the mechanism is unproven; a
read-after-write sentinel (`session missing from durable store after
create`, ERROR level) now converts any recurrence into evidence
(`f23885038`).

## Tests (red → green verified)

- `test/provider/discover.test.ts`: vision-id inference (fails without fix).
- `test/session/llm-budget.test.ts`: embedded data URL estimate (fails
  without fix; ~250k tokens before, <10k after).
- `test/session/prompt.test.ts`: attachment router keeps base64 out of
  router text; `resolvePromptParts` labels `.png` as `image/png`, `.ts`
  stays `text/plain` (both fail without fixes).
- `test/session/compaction.test.ts`: 128k-context deepseek-v4 model at 24k
  tokens is not an overflow (fails without fix).

Full `packages/opencode` suite: see comparison below.

## Live smoke (compiled binary `0.0.0-memory-surgery-202608212117`)

- `GET /provider`: `deepseek-v4-flash-vision-exp` now `attachment: true`,
  `input.image: true`.
- Direct vision (vision-exp + pasted image): one-turn direct answer, 2
  messages, **0 compactions, 0 glm subtasks, 0 overflow errors**.
- Non-vision path (deepseek-v4-flash + TUI-style subtask): glm-5v-turbo
  subagent promptTokens **22,920** (was 269,503), no ContextOverflowError,
  visual analysis returned and relayed.

## Baseline comparison

Full `packages/opencode` suite (both runs full-output, timing-normalized):

- Baseline `bc4552462`: 3058 pass / **194 fail** (3275 tests).
- This work: 3080 pass / **195 fail** (3280 tests, +5 new).
- Failure-name diff: the only new failure was this change's own router
  integration test hitting the default 5s timeout under full-suite load —
  fixed with an explicit 15s timeout (`b04a2943c`, verified 3/3 plus the
  diff above). **Zero real regressions; zero fixes to pre-existing
  failures** (the 194 are the known environmental/flaky baseline group).
