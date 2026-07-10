# Contributing to OpenChinaCode

OpenChinaCode is a focused fork of opencode. Contributions should improve the GLM/Kimi/DeepSeek CLI/TUI coding-agent workflow, not broaden the project back into a general opencode distribution.

## Before You Start

Open an issue or start a design discussion before large changes. This project accepts breaking changes, but they should be intentional and documented.

Good contribution areas:

- GLM, Kimi, or DeepSeek provider behavior.
- Model parameter tuning.
- Task routing and subagent delegation.
- Smart compaction quality and observability.
- Token-budget and context-window handling.
- LSP diagnostics.
- Browser and integration testing workflows.
- Documentation for OpenChinaCode-specific behavior.

Usually out of scope:

- Re-adding broad provider catalogs.
- Re-adding proxy-provider-first workflows.
- Desktop app, web UI, or unrelated product surfaces.
- Cosmetic changes that do not help the CLI/TUI coding workflow.
- Compatibility layers for old OpenChinaCode configs unless explicitly requested.

## Relationship to Upstream opencode

OpenChinaCode is built on opencode and should keep upstream credit visible. However, this repository is maintained as its own fork.

If a bug or feature is general to opencode, consider contributing it upstream first. If a change is specific to China-model routing, provider transforms, RMB pricing, or OpenChinaCode workflow, keep it here.

Do not copy upstream maintainer policies, team references, community workflows, trust lists, or issue automation into this fork unless the fork actually uses them.

## Development Setup

From the repo root:

```bash
bun install
```

Run the local CLI during development:

```bash
bun dev
```

Run it against another project:

```bash
bun dev /path/to/project
```

Build the standalone binary:

```bash
bun run --cwd packages/opencode build --single
```

The binary is generated under `packages/opencode/dist/`.

## Useful Checks

Run focused checks for the packages you changed:

```bash
bun run --cwd packages/opencode typecheck
bun test --cwd packages/opencode

bun run --cwd packages/llm typecheck
bun test --cwd packages/llm
```

Before pushing a broad change, run:

```bash
bun run typecheck
```

If a check is too expensive or blocked locally, mention that clearly in the PR or commit notes.

## Code Guidelines

- Follow existing local patterns before adding abstractions.
- Keep changes scoped to the behavior being improved.
- Prefer structured parsing and typed data over ad hoc string handling.
- Avoid compatibility code for old internal config unless there is a clear current need.
- Do not commit API keys, local auth files, screenshots containing secrets, or generated personal config.
- Add tests when changing routing, request transforms, token budgeting, compaction, or tool behavior.
- Keep comments short and useful.

## OpenChinaCode-Specific Rules

Provider work should preserve the project boundary:

- Default providers are `zhipuai-pay2go`, `moonshotai-cn`, and `deepseek`.
- OpenAI-compatible protocol is the default path for these providers.
- Model metadata should include realistic context limits and RMB pricing when used by the TUI.
- Request transforms should be covered by tests when provider behavior changes.

Task-routing work should be observable:

- TUI output should make delegated model, task kind, and complexity visible.
- Compaction should expose route, judge result, profile source, and summary phase.
- Browser visual checks should prefer deterministic browser telemetry when judging animation or state.

Documentation updates should cover both:

- User-facing behavior in `README.md` or `manual.md`.
- Maintainer details in `tech.md` when internals change.

## Pull Request Expectations

Keep PRs small enough to review. Explain:

- What changed.
- Why the change belongs in OpenChinaCode.
- Which models/providers are affected.
- How you verified it.
- Any known risks or follow-up work.

Use concise titles, preferably conventional commits:

- `feat: add GLM routing variant`
- `fix: clamp max tokens before compaction`
- `docs: update task policy guide`
- `test: cover Kimi request transform`
- `refactor: simplify provider catalog`

## Maintainer Notes

This fork values practical model performance over broad compatibility. When a change improves reliability for GLM/Kimi/DeepSeek coding workflows but breaks unused upstream behavior, prefer the simpler OpenChinaCode path and document the tradeoff.
