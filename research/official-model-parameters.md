# Official model parameter research for OpenChinaCode

Source date: 2026-07-04

Scope: official documentation only. This note records the API/protocol facts that should drive the OpenChinaCode MVP for GLM, Kimi, and DeepSeek.

## Executive summary

All three target providers can be used through OpenAI-compatible Chat Completions for the CLI MVP.

DeepSeek also has an official Anthropic-compatible endpoint, but GLM and Kimi are naturally aligned with OpenAI-compatible Chat Completions. Keeping one protocol path in the MVP is simpler and enough to support `run`, `models`, auth, tools, streaming, and reasoning output.

The important correction is that these providers cannot share one generic parameter profile:

- GLM-5.2: supports `thinking`, `reasoning_effort`, `tool_stream`, 1M context, and up to 128K output. It recommends adjusting `temperature` or `top_p`, not both.
- Kimi K2.7 Code: thinking is always on, preserved thinking is always on, `temperature` and `top_p` are fixed and should not be explicitly set for normal requests.
- DeepSeek-V4-Pro: thinking is on by default; in thinking mode, `temperature`, `top_p`, `presence_penalty`, and `frequency_penalty` have no effect and should be omitted by our client.

Tool calling needs its own provider policy. A schema that works with Claude/Opus should not be assumed to work unchanged with GLM, Kimi, or DeepSeek.

- GLM and Kimi do not give us a reliable API-level "force this exact tool" path for the target models; tool use must be induced by precise system instructions and high-signal tool descriptions.
- DeepSeek supports `required` and named tool choice, so OpenChinaCode can force a tool call when the workflow logically requires one.
- Kimi and DeepSeek thinking models have strict historical `reasoning_content` requirements around tool calls; losing those fields can break follow-up tool loops.
- Streaming tool calls must be reconstructed by concatenating partial `function.arguments` chunks. We need tests for this before enabling streaming tool calls broadly.

## Provider and model targets

| Provider                | Primary model IDs                            | Base URL                               | MVP protocol                       | Notes                                                                   |
| ----------------------- | -------------------------------------------- | -------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| Zhipu/GLM pay-as-you-go | `glm-5.2`                                    | `https://open.bigmodel.cn/api/paas/v4` | OpenAI-compatible Chat Completions | User's current key is for this pay-as-you-go endpoint.                  |
| Kimi/Moonshot CN        | `kimi-k2.7-code`, `kimi-k2.7-code-highspeed` | `https://api.moonshot.cn/v1`           | OpenAI-compatible Chat Completions | Highspeed has identical parameters and higher output speed.             |
| DeepSeek                | `deepseek-v4-pro`, `deepseek-v4-flash`       | `https://api.deepseek.com`             | OpenAI-compatible Chat Completions | Anthropic endpoint also exists at `https://api.deepseek.com/anthropic`. |

## GLM-5.2

Official positioning:

- Model ID: `glm-5.2`.
- Flagship coding/long-horizon model.
- Text input and text output.
- Context length: 1M.
- Maximum output: 128K.
- API endpoint for the user's current pay-as-you-go route: `https://open.bigmodel.cn/api/paas/v4/chat/completions`.

Important request parameters:

- `thinking`: supported on GLM-4.5 and newer; default `thinking.type` is `enabled`.
- `thinking.clear_thinking`: default `true`. With `true`, previous turns' `reasoning_content` is ignored/removed. With `false`, the client must preserve full historical reasoning content exactly and in order.
- `reasoning_effort`: only GLM-5.2 supports it directly. Official values include `max`, `xhigh`, `high`, `medium`, `low`, `minimal`, `none`; default is `max`. Compatibility mappings: `low`/`medium` map to `high`, `xhigh` maps to `max`, `none`/`minimal` skip thinking.
- `temperature`: default `1.0`, range `0.0` to `1.0`.
- `top_p`: default `0.95`, range `0.01` to `1.0`.
- Official recommendation: tune `temperature` or `top_p`, not both.
- `max_tokens`: up to `131072` for GLM-5.2.
- `tool_stream`: default `false`; can be enabled with streaming tool calls to receive tool arguments incrementally.
- `tools`: supports function tools. The chat completion API lists a maximum of 128 functions.
- `tool_choice`: GLM-compatible API currently documents `auto` for tool selection.

Implementation policy:

- Keep `glm-5.2` as the default GLM model for OpenChinaCode.
- Use OpenAI-compatible chat completions.
- Do not blindly send both `temperature` and `top_p`. Prefer provider defaults unless the user explicitly overrides one parameter.
- Default to `thinking: { type: "enabled", clear_thinking: true }` until OpenChinaCode can prove it preserves full historical reasoning blocks correctly. Add a later "preserved thinking" mode only after storage and replay are tested.
- For coding-agent requests, expose a balanced/deep switch:
  - balanced: `reasoning_effort: "high"`
  - deep/default: `reasoning_effort: "max"`
- If streaming with tools, add `tool_stream: true` once the stream parser can correctly concatenate partial tool-call arguments.
- Because GLM cannot be force-routed to a specific tool through `tool_choice`, the system prompt and tool descriptions must explicitly say when to call each tool and that the model should call tools instead of guessing file/system/project state.
- Default to a practical output budget for recognized model families and slide to the official ceiling only when the request needs long output or the user selects a deep/max variant. For GLM-5.x/4.7/4.6, the practical default is 64K and the ceiling is 128K. Respect an explicit user output-token override.

## Kimi K2.7 Code

Official positioning:

- Model IDs: `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`.
- K2.7 Code is Kimi's strongest coding model.
- Highspeed is the same model with identical parameters, higher output speed.
- Context length: 256K for `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`, `kimi-k2.6`, and `kimi-k2.5`.
- Base URL in China docs: `https://api.moonshot.cn/v1`.

Important request parameters:

- `thinking`: K2.7 Code always has thinking enabled. Passing disabled thinking returns an error.
- Preserved Thinking is always enabled for K2.7. Historical assistant `reasoning_content` must be preserved in `messages` as-is.
- `temperature`: fixed `1.0`. Other values error. Official best practice says do not set it explicitly.
- `top_p`: fixed `0.95`. Other values error. Official best practice says do not set it explicitly.
- `n`: fixed `1`.
- `presence_penalty` and `frequency_penalty`: fixed `0.0`.
- `max_tokens`: deprecated in the API reference; use `max_completion_tokens`.
- Tool use: `tool_choice` can only be `auto` or `none`.
- Tool loops: during multi-step tool calling, the assistant message's `reasoning_content` must be kept in context.
- Official best practice recommends `max_tokens >= 16000` for thinking/tool-call workloads and streaming output to avoid timeouts.
- `prompt_cache_key`: recommended for coding agents; usually a stable session ID or task ID. Required for Kimi Code Plan to improve cache hit rate.
- Tool call messages must preserve the assistant `tool_calls` block and append matching `tool` role messages with the original `tool_call_id`.
- In streaming mode, `tool_calls[].function.arguments` can arrive in chunks and must be accumulated by index/id.

Implementation policy:

- Use `kimi-k2.7-code` as the default Kimi model and keep `kimi-k2.7-code-highspeed` as an explicit fast option.
- Use OpenAI-compatible chat completions.
- Do not inject `temperature`, `top_p`, penalties, or `n` for K2.7/K2.6/K2.5.
- Convert OpenChinaCode's requested output limit to `max_completion_tokens` for Kimi. Avoid `max_tokens` unless the SDK layer makes it unavoidable and live tests confirm compatibility.
- Add `prompt_cache_key` from the OpenChinaCode session ID.
- Preserve Kimi `reasoning_content` exactly for historical assistant messages. This is mandatory for K2.7, not an optimization.
- Enforce/normalize `tool_choice` to `auto` or `none`.
- Since Kimi cannot use `required` or named tool forcing for K2.7, strengthen tool descriptions and the system prompt. The prompt should explicitly require tool calls for repository/file/shell facts and forbid answering those from memory.
- Prefer streaming for interactive CLI runs.

## DeepSeek-V4-Pro

Official positioning:

- Model IDs: `deepseek-v4-pro`, `deepseek-v4-flash`.
- V4-Pro: 1.6T total parameters / 49B active parameters.
- V4-Flash: 284B total parameters / 13B active parameters.
- Context length: 1M.
- Maximum output: 384K.
- Base URL for OpenAI format: `https://api.deepseek.com`.
- Base URL for Anthropic format: `https://api.deepseek.com/anthropic`.
- `deepseek-chat` and `deepseek-reasoner` are compatibility aliases for V4-Flash non-thinking/thinking and are scheduled for retirement after 2026-07-24 15:59 UTC.

Important request parameters:

- `thinking`: `enabled` or `disabled`, default `enabled`.
- `reasoning_effort`: `high` or `max`. Default is `high` for regular requests; complex agent requests such as OpenCode may be automatically set to `max`.
- Compatibility mappings: `low`/`medium` map to `high`, `xhigh` maps to `max`.
- Thinking mode does not support `temperature`, `top_p`, `presence_penalty`, or `frequency_penalty`. DeepSeek accepts them for compatibility but ignores them.
- `reasoning_content` is returned alongside `content` in thinking mode.
- Historical `reasoning_content` handling differs by turn type:
  - no tool call: old reasoning content does not need to be resent and will be ignored if sent.
  - tool call: the assistant message's reasoning content must be passed back in all subsequent requests, otherwise the API can return 400.
- `tool_choice`: supports `none`, `auto`, `required`, and named function choice.
- `tools`: supports up to 128 tools.
- Strict function calling is available through the beta endpoint. In strict mode every tool must set `strict: true`, function schemas must be `object` roots, all properties must be listed in `required`, and `additionalProperties: false` is required.

Implementation policy:

- Use `deepseek-v4-pro` as the default DeepSeek model. Keep `deepseek-v4-flash` as fast/cheap option.
- Remove or hide `deepseek-chat` and `deepseek-reasoner` from the default model list because they are deprecated aliases.
- Use OpenAI-compatible chat completions for MVP. Keep Anthropic support as a possible later adapter, not part of the first CLI path.
- In thinking mode, omit `temperature`, `top_p`, `presence_penalty`, and `frequency_penalty`.
- For workflows where a tool call is mandatory, use `tool_choice: "required"` or a named function choice instead of relying only on prompt wording.
- Use strict mode only after an adapter can route DeepSeek calls to `/beta` and normalize our schemas to strict-compatible JSON Schema.
- Provide policy variants:
  - default/balanced: `thinking: { type: "enabled" }`, `reasoning_effort: "high"`
  - deep-agent: `thinking: { type: "enabled" }`, `reasoning_effort: "max"`
  - fast/no-thinking: `thinking: { type: "disabled" }`
- Preserve `reasoning_content` only when required by a tool-call turn. Do not blindly replay old reasoning for every normal assistant turn.
- Default to a practical DeepSeek V4 output budget of 128K and slide to the official 384K ceiling only when the request needs long output or the user selects a deep/max variant. Respect an explicit user output-token override.

## Tool call policy across providers

| Provider        | Tool selection                                                                  | Schema policy                                                                   | Streaming policy                                     | OpenChinaCode implication                                                                                          |
| --------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GLM-5.2         | `auto` documented. No dependable named/required forcing in the target API docs. | Function JSON Schema, max 128 functions.                                        | `tool_stream` can stream function arguments.         | Use explicit system prompt and rich descriptions. Do not assume Claude-style concise tool descriptions are enough. |
| Kimi K2.7 Code  | `auto` or `none` only.                                                          | Function tools in OpenAI format. Tool definitions count against context tokens. | Arguments stream in deltas and must be concatenated. | Preserve `reasoning_content`; set high enough output budget; make tool descriptions very explicit.                 |
| DeepSeek-V4-Pro | `none`, `auto`, `required`, or named function.                                  | Normal mode accepts common schemas; strict beta requires stricter schema shape. | OpenAI-style streaming tool deltas.                  | Use `required`/named tool choice for mandatory tool workflows; use strict mode later for argument correctness.     |

Tool description style for OpenChinaCode:

- Tool names should be stable, short, and action-oriented.
- Each tool description should include the exact condition for calling it, not just what it does.
- Parameter descriptions should state units, path relativity, allowed values, and when a field must be omitted.
- For GLM and Kimi, the system prompt should say: if a user asks about repository files, command output, current environment, installed packages, or any state that can be inspected, call tools before answering.
- For DeepSeek, when a workflow step has no valid answer without tool output, prefer API-level `tool_choice: "required"` or a named tool choice.

Recommended tool-call test matrix:

1. Auto-selection: ask for facts that require file/shell inspection and verify whether each provider calls a tool.
2. Forced-selection: for DeepSeek only, verify `required` and named function choice.
3. Argument conformance: enum, nested object, relative path, optional fields, and invalid value rejection.
4. Streaming reconstruction: verify partial `function.arguments` chunks assemble to valid JSON.
5. Reasoning replay: verify Kimi preserves historical `reasoning_content`; verify DeepSeek preserves it only when a tool-call turn requires it.
6. Output budget: verify 8K, 16K, 32K, and provider maximum caps on long tool-result summarization.

## Current OpenChinaCode implementation status

Implemented in the current branch:

- `ChinaTransform` centralizes GLM/Kimi/DeepSeek request policy.
- Default sampling parameters are no longer injected for GLM/Kimi/DeepSeek. GLM request-body rewrite also removes `top_p` when both sampling controls are present.
- Kimi request bodies convert `max_tokens` to `max_completion_tokens`, preserve thinking with `keep: "all"`, add `prompt_cache_key`, and normalize unsupported `tool_choice` values to `auto`.
- DeepSeek V4 thinking requests enable `thinking`, remove sampling/penalty fields that are ignored in thinking mode, and preserve historical `reasoning_content` only for tool-call turns.
- GLM defaults to `thinking: { type: "enabled", clear_thinking: true }`; GLM-5.2 also defaults to `reasoning_effort: high` so the provider does not silently use slow max reasoning.
- Max-output policy is now sliding: default budgets are GLM 64K, Kimi K2 Code 32K, and DeepSeek V4 128K; long-output requests and `max` variants slide GLM to 128K and DeepSeek V4 to 384K.
- Provider transform tests cover these outbound parameter policies.

Remaining gaps:

- DeepSeek mandatory-tool workflows still need API-level `required` or named tool choice where the opencode tool pipeline can express it safely.
- Streaming tool-call argument reconstruction needs focused tests before enabling provider-specific streaming enhancements such as GLM `tool_stream`.
- Schema generation still needs stricter provider-specific validation for DeepSeek beta strict mode and GLM/Kimi tool-selection reliability.

## Implementation TODO

1. Replace the current broad `ChinaTransform` with a policy table keyed by provider/model family.
2. Add outbound request tests for:
   - GLM-5.2: thinking, reasoning effort, no dual default sampling parameters.
   - Kimi K2.7: no `temperature`/`top_p`, uses `max_completion_tokens`, sends `prompt_cache_key`, preserves `reasoning_content`.
   - DeepSeek V4 Pro: thinking body, reasoning effort, no sampling parameters in thinking mode.
   - Tool calls: selection mode, argument schema conformance, streaming argument reconstruction, and reasoning-content replay.
3. Update model catalog priority:
   - GLM: `glm-5.2`
   - Kimi: `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`
   - DeepSeek: `deepseek-v4-pro`, `deepseek-v4-flash`
4. Add CLI-visible model mode names only after the base policy works:
   - `balanced`
   - `deep`
   - `fast`
5. Live-test providers with available credentials:
   - GLM: available locally and already smoke-tested.
   - Kimi: available locally, needs a K2.7 body smoke test after request adapter changes.
   - DeepSeek: available locally and V4 Pro has been smoke-tested.

## Official source URLs

- GLM pay-as-you-go quick start: https://docs.bigmodel.cn/cn/api/introduction
- GLM chat completion API: https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8
- GLM-5.2 overview: https://docs.z.ai/guides/llm/glm-5.2
- GLM-5.2 migration guide: https://docs.z.ai/guides/overview/migrate-to-glm-new
- Z.AI function calling: https://docs.z.ai/guides/capabilities/function-calling
- Z.AI streaming tool calls: https://docs.z.ai/guides/capabilities/stream-tool
- Kimi API overview: https://platform.kimi.com/docs/api/overview
- Kimi K2.7 Code guide: https://platform.kimi.com/docs/guide/kimi-k2-7-code-quickstart
- Kimi chat completion API: https://platform.kimi.com/docs/api/chat
- Kimi tool calls guide: https://platform.kimi.com/docs/guide/use-kimi-api-to-complete-tool-calls
- Kimi thinking model guide: https://platform.kimi.com/docs/guide/use-kimi-k2-thinking-model
- DeepSeek V4 release: https://api-docs.deepseek.com/news/news260424
- DeepSeek models and pricing: https://api-docs.deepseek.com/quick_start/pricing
- DeepSeek thinking mode: https://api-docs.deepseek.com/guides/thinking_mode
- DeepSeek chat completion API: https://api-docs.deepseek.com/api/create-chat-completion
- DeepSeek tool calls: https://api-docs.deepseek.com/guides/tool_calls
- DeepSeek Anthropic API: https://api-docs.deepseek.com/guides/anthropic_api
