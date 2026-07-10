# OpenChinaCode Reactor Plan

## Mission

OpenChinaCode is a CLI-only fork of opencode focused on Chinese LLM providers and model families:

- GLM: ZhipuAI / Z.ai
- KIMI: Moonshot AI / Kimi
- DEEPSEEK: DeepSeek official and compatible first-party routes

The first milestone is an MVP CLI named `openchinacode` that can run prompts, list models, and manage credentials without conflicting with the existing system `opencode` installation.

## Product Boundary

- This is an unpublished private fork. Do not preserve backward compatibility for internal pre-release
  config fields, command names, schema names, provider aliases, or routing policy names. Prefer the
  current clean design and remove stale compatibility paths during iteration.

## TODO TASK

### Active Sprint

- [x] Clone upstream source into `/home/kris/Projects/OpenChinaCode`.
- [x] Create branch `openchinacode`.
- [x] Add architecture plan in `reactor.md`.
- [x] Rename CLI package/bin/build output from `opencode` to `openchinacode`.
- [x] Isolate runtime directories under `openchinacode`.
- [x] Change default command to help/status instead of TUI.
- [x] Reduce exposed CLI commands to MVP surface.
- [x] Filter built-in provider catalog to GLM/KIMI/DEEPSEEK families.
- [x] Add `zhipuai-pay2go` as a first-class GLM provider alias.
- [x] Add China-model default priority for model selection.
- [x] Build a local binary and smoke-test `--version`, `--help`, `models`, and `providers list`.
- [x] Install local `openchinacode` command via `~/.local/bin/openchinacode`.
- [x] Migrate independent OpenChinaCode auth for `zhipuai-pay2go` and `moonshotai-cn`.
- [x] Set default model to `zhipuai-pay2go/glm-5.2`.
- [x] Verify real GLM 5.2 end-to-end call.
- [x] Research official GLM/KIMI/DEEPSEEK model parameter docs and fold implementation policy into the provider strategy and TECH notes.
- [x] Set official max-output policies for GLM/KIMI/DEEPSEEK and rebuild the installed `openchinacode` binary.
- [x] Pin official GLM/KIMI/DEEPSEEK CNY pricing for session cost display and rebuild the installed `openchinacode` binary.
- [x] Reduce runtime provider list to the three configured providers: `zhipuai-pay2go`, `moonshotai-cn`, and `deepseek`.
- [x] Add task-class-aware subagent model routing with user-configurable policy.
- [x] Add slash/debug entry points for inspecting task routing.

### Later Tasks

- [x] Move China-specific request settings into a dedicated `china-transform` module.
- [x] Replace the first-pass `china-transform` defaults with an official policy table per provider/model family.
- [x] Set max output ceilings per target model family instead of always using upstream's 32000 cap.
- [x] Add sliding max-token policy: use practical defaults normally and slide to provider maximum for long-output requests or `max` variants.
- [x] Add outbound request-body tests for GLM-5.2, Kimi K2.7 Code, and DeepSeek-V4-Pro.
- [x] Add Kimi-specific `max_completion_tokens`, `prompt_cache_key`, and preserved `reasoning_content` handling.
- [x] Add DeepSeek-V4-Pro/V4-Flash reasoning variants and keep deprecated `deepseek-chat`/`deepseek-reasoner` aliases out of the primary path.
- [ ] Add provider-specific tool-call policy:
  - [x] GLM/KIMI: stronger system prompt and richer tool descriptions because target APIs mainly rely on `auto` tool choice.
  - [ ] DEEPSEEK: use `required` or named tool choice when a tool call is mandatory.
- [ ] Add tool-call test matrix for auto selection, forced selection, schema conformance, streaming argument reconstruction, and reasoning-content replay.
- [ ] Add UI-side direct slash actions for editing task routing policy interactively.
- [ ] Add focused tests for provider filtering and config path isolation.
- [ ] Remove unused web/desktop/tui workspace packages after MVP is stable.
- [ ] Decide whether OpenChinaCode should keep any plugin support.
- [ ] Add install/update script only after local CLI behavior is stable.

### In Scope for MVP

- CLI command: `openchinacode`
- Non-interactive prompt execution through `run`
- Model listing through `models`
- Credential management for the supported providers
- Debug commands needed for local diagnosis
- Provider catalog reduced to GLM, KIMI, and DEEPSEEK
- China-model-specific parameter strategy
- Separate config, cache, data, state, and log directories

### Out of Scope for MVP

- Web UI
- Desktop app
- TUI-first default experience
- GitHub PR automation
- Plugin marketplace features
- General provider marketplace
- OpenRouter, OpenAI, Claude, Gemini, Grok, and other non-MVP providers
- Publishing to npm or a package registry

## Command Shape

Primary command:

```bash
openchinacode
```

MVP commands:

```bash
openchinacode run -m zhipuai/glm-5.2 "hello"
openchinacode run -m moonshotai-cn/kimi-k2.7-code "hello"
openchinacode models
openchinacode models zhipuai
openchinacode providers
openchinacode debug config
openchinacode debug paths
```

Default behavior:

- `openchinacode` should show concise help and provider status.
- It should not start the upstream full TUI by default.

## Filesystem Isolation

OpenChinaCode must not reuse opencode's runtime directories.

Upstream paths to avoid:

```text
~/.config/opencode
~/.cache/opencode
~/.local/share/opencode
~/.local/state/opencode
/tmp/opencode
```

OpenChinaCode paths:

```text
~/.config/openchinacode
~/.cache/openchinacode
~/.local/share/openchinacode
~/.local/state/openchinacode
/tmp/openchinacode
```

Config files:

```text
~/.config/openchinacode/openchinacode.json
~/.local/share/openchinacode/auth.json
```

## Provider MVP

Allowed provider IDs:

```text
zhipuai
zhipuai-pay2go
zai
zhipuai-coding-plan
zai-coding-plan
moonshotai-cn
moonshotai
kimi-for-coding
deepseek
```

Provider policy:

- Provider catalog must be allowlist-filtered.
- Unsupported providers should not appear in `models`, provider selection, or auth prompts.
- Existing upstream provider implementation code can remain in the repository during MVP, but the runtime surface must expose only allowed providers.
- Avoid custom user-provider blocks for these official providers unless the upstream provider is missing or broken.

## Model MVP

Initial model priority list:

### GLM

```text
zhipuai/glm-5.2
zhipuai/glm-5.1
zhipuai/glm-5
zai/glm-5.1
zai/glm-5
zhipuai-coding-plan/glm-5.2
zai-coding-plan/glm-5.2
```

### KIMI

```text
moonshotai-cn/kimi-k2.7-code
moonshotai-cn/kimi-k2.7-code-highspeed
moonshotai-cn/kimi-k2.6
moonshotai-cn/kimi-k2.5
kimi-for-coding/k2p7
```

### DEEPSEEK

Exact provider IDs and model IDs must be verified from the current catalog before implementation. Expected target families:

```text
deepseek-v4
deepseek-v4-pro
deepseek-v4-flash
deepseek-r1
deepseek-v3
deepseek-v3.2
```

## China Model Parameter Strategy

The upstream `ProviderTransform` is compatibility-oriented. OpenChinaCode needs a dedicated strategy layer for Chinese models.

The former standalone research note has been folded into the provider strategy implementation and `tech.md`.

Proposed module:

```text
packages/opencode/src/provider/china-transform.ts
```

Responsibilities:

- Set safe default temperature/topP/topK per model family.
- Set max output ceilings per model family instead of always using upstream's 32000 cap.
- Enable provider-specific thinking/reasoning controls.
- Keep GLM, KIMI, and DEEPSEEK behavior explicit and testable.

Initial policy draft:

### GLM

- Enable thinking for `zhipuai` and `zai` compatible APIs.
- Use `reasoning_effort: high` by default for GLM-5.2 instead of leaving the provider to default to slow `max` reasoning.
- Keep `reasoning_content` / interleaved reasoning compatibility.
- Use 64K as the practical default for GLM-5.x/4.7/4.6 and slide to the official ceiling, 128K, for long-output requests or `max` variants.

### KIMI

- Treat Kimi K2.7 code models as code-first reasoning models.
- Do not blindly pass temperature if the model catalog says unsupported.
- Preserve image/video capability metadata where official model list confirms it.
- Prefer `kimi-k2.7-code-highspeed` ahead of the standard model in sorting/default selection while keeping both models available.
- Use Kimi K2 Code's official 32K generation default and send it as `max_completion_tokens`.

### DEEPSEEK

- Separate R1 reasoning behavior from V3/V4 chat/coding behavior.
- Preserve reasoning content in follow-up turns.
- Avoid settings that break OpenAI-compatible routes.
- Use 128K as the practical DeepSeek V4 default and slide to the official 384K ceiling for long-output requests or `max` variants.

## Source Architecture Notes

Likely files to modify first:

```text
packages/opencode/package.json
packages/opencode/script/build.ts
packages/opencode/src/index.ts
packages/opencode/src/cli/cmd/*.ts
packages/opencode/src/provider/provider.ts
packages/opencode/src/provider/transform.ts
packages/core/src/models-dev.ts
packages/core/src/global.ts
packages/core/src/flag/flag.ts
```

Current upstream CLI package:

```text
packages/opencode
```

This package already owns the mature CLI commands and should be the MVP base.

The former experimental `lildax` CLI workspace has been removed from the OpenChinaCode MVP tree.

## Implementation Phases

### Phase 0: Branch and Planning

- Create branch `openchinacode`.
- Add this `reactor.md`.
- Keep upstream `dev` as the rebase target.

### Phase 1: CLI Identity and Isolation

- Rename CLI binary output to `openchinacode`.
- Update package bin mapping.
- Ensure runtime command help says OpenChinaCode.
- Change runtime directories from `opencode` to `openchinacode`.
- Confirm existing system `opencode` remains untouched.

Validation:

```bash
openchinacode --version
openchinacode debug paths
command -v opencode
command -v openchinacode
```

### Phase 2: CLI Surface Reduction

- Disable default TUI launch.
- Keep `run`, `models`, `providers`, and minimal `debug`.
- Hide or remove web, desktop, plugin, GitHub, PR, stats, upgrade, uninstall, ACP, and broad MCP commands from the MVP command surface.

Validation:

```bash
openchinacode --help
openchinacode run --help
openchinacode models --help
```

### Phase 3: Provider Catalog Allowlist

- Add provider allowlist for GLM/KIMI/DEEPSEEK providers.
- Filter `models.dev` catalog before it reaches provider selection.
- Ensure unsupported providers are not shown even if credentials exist.

Validation:

```bash
openchinacode models
openchinacode providers
```

Expected output must not include broad providers such as OpenRouter, OpenAI, Anthropic, Gemini, xAI, or generic aggregators.

### Phase 4: Model Catalog Corrections

- Ensure GLM-5.2 is present for `zhipuai`.
- Ensure Kimi K2.7 code and highspeed are present for `moonshotai-cn`.
- Verify DeepSeek official provider model IDs.
- Decide whether to ship catalog patches, live refresh, or both.

Validation:

```bash
openchinacode models zhipuai
openchinacode models moonshotai-cn
openchinacode models deepseek
```

### Phase 5: China Parameter Strategy

- Add explicit GLM/KIMI/DEEPSEEK parameter logic.
- Route strategy through request preparation without breaking provider-specific options.
- Add focused tests for parameter output.

Validation:

```bash
bun test test/provider/transform.test.ts
bun typecheck
```

Run from `packages/opencode`, not from repository root.

### Phase 6: Local Binary Build

- Build local binary.
- Install to a non-conflicting path, for example:

```text
~/.openchinacode/bin/openchinacode
```

- Do not overwrite `~/.opencode/bin/opencode`.

Validation:

```bash
~/.openchinacode/bin/openchinacode --version
~/.openchinacode/bin/openchinacode models zhipuai
~/.openchinacode/bin/openchinacode run -m zhipuai/glm-5.2 "Say hello in one sentence."
```

## Rebase Strategy

Keep the fork rebase-friendly:

- Prefer allowlist filters over deleting large upstream subsystems.
- Keep branding and China-model strategy in small dedicated modules where possible.
- Avoid broad package renames until the MVP works.
- Keep changes grouped by phase.

Suggested branch lifecycle:

```text
dev -> openchinacode
```

Later:

```bash
git fetch origin
git rebase origin/dev
```

## Risks

- Upstream `models.dev` refresh may overwrite local model corrections.
- Provider IDs may differ between China and international endpoints.
- Model metadata returned by `/v1/models` is incomplete for pricing and advanced capabilities.
- TUI dependencies may still be pulled by CLI code paths until removed carefully.
- Renaming global paths may have hidden assumptions in tests and storage.
- Removing commands too early may break useful shared runtime setup.

## MVP Definition of Done

The MVP is done when:

- `openchinacode` exists as a separate local binary.
- It does not conflict with system `opencode`.
- It uses `~/.config/openchinacode`, `~/.cache/openchinacode`, and `~/.local/share/openchinacode`.
- `openchinacode --help` shows only the MVP CLI surface.
- `openchinacode models` exposes only GLM/KIMI/DEEPSEEK providers.
- `openchinacode run` works with one GLM model and one KIMI model.
- DeepSeek provider/model IDs are verified and visible.
- China-specific request parameter strategy is implemented for at least GLM-5.2 and Kimi K2.7 Code.

## Completed Follow-up Tasks

- Added `/lsp`, `/lsp status`, `/lsp on`, and `/lsp off` support in the TUI prompt.
- `/lsp on/off` updates the global OpenChinaCode JSONC config and asks the user to restart.
- Added reusable JSONC patch helper in core for config-preserving edits.
- Updated the home tip from manual LSP config editing to `/lsp on`.

## V2 Core Migration Plan

### Phase V2-1: Basic Runner Loop

Goal: prove that OpenChinaCode can execute one prompt through the existing core V2 session runner without replacing the current TUI.

Status: implemented and installed in local binary `0.0.0-openchinacode-202607061429`.

Scope:

- Add an experimental `openchinacode v2 [prompt]` command.
- Create or reuse one V2 session in the current directory.
- Require or accept an explicit model reference such as `zhipuai-pay2go/glm-5.2#max`.
- Submit one prompt through `SessionV2.prompt(..., resume: false)`.
- Run `SessionV2.resume(sessionID)` and wait for completion.
- Print final assistant text and basic tool/result summaries.
- Default to a `v2-basic` text-only agent with all tools disabled.
- Bridge legacy `~/.local/share/openchinacode/auth.json` API keys into the V2 model resolver for this command.
- Register `openchinacode debug v2` for inspecting the V2 catalog, OpenChina model limits, variants, and legacy-auth bridge state.

Non-goals:

- No TUI integration.
- No slash commands.
- No interactive permission UI.
- No streaming renderer.
- No subagent routing.
- No tool-writing workflow beyond proving the runner can advertise an empty tool set safely.

Validation:

```bash
openchinacode v2 --model zhipuai-pay2go/glm-5.2#max "用一句话回答：你是谁？"
openchinacode v2 --model moonshotai-cn/kimi-k2.7-code-highspeed "只回复 OK"
openchinacode v2 --model deepseek/deepseek-v4-flash "只回复 OK"
openchinacode debug v2
```

Expected behavior:

- The command creates a V2 session.
- The runner performs one provider turn.
- The process exits after printing assistant output.
- Current `openchinacode` TUI behavior remains unchanged.
- `debug v2` may show V2-native `available: false` until credentials are migrated into V2 Credential storage; `legacyAuthBridge: true` means the phase-1 runner can still authenticate with existing OpenChinaCode keys.

### Phase V2-2: Tool and Permission Loop

Goal: run safe read-only V2 tools without hanging on permission requests.

Scope:

- Add a non-interactive permission policy option.
- Enable `read`, `glob`, and `grep`.
- Keep mutation tools disabled.
- Render tool calls and tool results in plain CLI output.

### Phase V2-3: OpenChinaCode Policy Integration

Goal: port China-model optimization policy into V2 runner.

Scope:

- Apply GLM/Kimi/DeepSeek model policy.
- Apply max-token sliding policy.
- Apply task policy and subagent routing.
- Apply intelligent compaction judge.

### Phase V2-4: TUI Decision Point

Goal: decide whether V2 is ready to become the OpenChinaCode main execution path.

Gate:

- V2 can complete a real repository read-only review.
- V2 can complete a small implementation task.
- V2 can compact and continue without losing task state.
- V2 has enough model/tool visibility for debugging.

## Integration Test Kit Plan

Goal: make frontend/backend integration testing a first-class OpenChinaCode capability instead of leaving agents to improvise with curl and raw browser commands.

Status: phase 1 implemented.

Phase 1 scope:

- Add `integration_test` config schema for base URL, health URL, frontend/backend service commands, Playwright config path, report directory, and Playwright MCP template preferences.
- Add `openchinacode test init` to generate a project-local Playwright template under `.openchinacode/test-kit`.
- Add `openchinacode test mcp` to write an official Playwright MCP local-server template.
- Add `openchinacode test run` to start configured services, run Playwright, collect logs, and write markdown/json reports under `.openchinacode/reports`.
- Add `/integration-test` and `/browser-check` prompt slash commands.
- Add `/test-mcp` local TUI command to enable/disable Playwright MCP without invoking the model.
- Update shared OpenChinaCode tool prompt so browser checks prefer Playwright MCP/Test over ad-hoc Chrome commands.

Phase 2 candidates:

- Add a TUI report viewer for latest integration reports.
- Add project framework-specific templates for Vite, Next.js, FastAPI, Django, Flask, and full-stack monorepos.
- Add bug object extraction into a stable machine-readable schema for agent follow-up.
- Add visual snapshot and accessibility checks as optional generated specs.
