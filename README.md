# OpenChinaCode

[English](./README.md) | [简体中文](./README.zh-CN.md)

OpenChinaCode is a customized fork of [opencode](https://github.com/anomalyco/opencode), focused on a lean CLI/TUI coding agent for GLM, Kimi, and DeepSeek.

This project exists because Chinese LLM providers behave differently in real coding workflows. OpenChinaCode keeps the opencode terminal experience, but rewires provider selection, model parameters, task routing, compaction, testing helpers, and observability around China-focused models.

## Credits

OpenChinaCode stands on the work of the opencode project and its maintainers. The original project provides the core terminal coding-agent architecture, tool system, session model, and developer experience that made this fork possible.

This repository is not affiliated with, endorsed by, or maintained by the opencode team. Upstream opencode remains the right place for general opencode usage, bug reports, and upstream contributions.

## Project Goals

- Keep only the CLI/TUI workflow needed for coding.
- Use `openchinacode` as the command name so it can coexist with `opencode`.
- Optimize for three provider families:
  - GLM / Zhipu: `zhipuai-pay2go`
  - Kimi / Moonshot: `moonshotai-cn`
  - DeepSeek: `deepseek`
- Prefer direct official provider APIs instead of proxy providers.
- Make model routing, token budgets, compaction, testing, and costs visible enough to debug.

## What Changed

OpenChinaCode is not a theme-only fork. The current fork includes:

- First-class `openchinacode` CLI command and branded TUI.
- Provider list reduced to GLM, Kimi, and DeepSeek for the default workflow.
- China-model request transforms for reasoning, sampling parameters, max tokens, and tool calling behavior.
- Sliding max-token strategy with `/auto-maxtokens`.
- RMB pricing and model-aware context usage display.
- Subagent task routing by task kind and complexity.
- Smart compaction routed through task policy, with active-task extraction and debug output.
- LSP toggle command for code diagnostics.
- Built-in Playwright MCP launcher and testing commands.
- Visual-check routing to GLM-5V for screenshot/layout inspection.

For the full feature manual, see [readme.md](./readme.md).

For architecture notes, maintenance entry points, config fields, and test commands, see [tech.md](./tech.md).

## Install

Install the latest GitHub release:

```bash
curl -fsSL https://raw.githubusercontent.com/krisshen2021/openchinacode/main/install | bash
```

Install a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/krisshen2021/openchinacode/main/install | bash -s -- --version 0.1.0
```

The installer downloads the matching binary from GitHub Releases and installs `openchinacode` into `~/.local/bin` by default. Use `--install-dir <dir>` for a different location, or `--no-modify-path` if you do not want the script to update shell config files.

The GitHub raw URL is the MVP install endpoint. A future website can expose the same script as:

```bash
curl -fsSL https://openchinacode.example/install | bash
```

## Build From Source

Build the standalone binary from the repo root:

```bash
bun install
bun run --cwd packages/opencode build --single
```

The generated Linux binary is typically under:

```text
packages/opencode/dist/openchinacode-linux-x64/bin/openchinacode
```

Install it somewhere on your `PATH`, for example:

```bash
install -m 755 packages/opencode/dist/openchinacode-linux-x64/bin/openchinacode ~/.local/bin/openchinacode
```

Then start it:

```bash
openchinacode
```

## Configuration

OpenChinaCode uses its own config and data directories:

```text
~/.config/openchinacode
~/.local/share/openchinacode
~/.cache/openchinacode
~/.local/state/openchinacode
```

Common files:

```text
~/.config/openchinacode/openchinacode.jsonc
~/.local/share/openchinacode/auth.json
~/.local/share/openchinacode/log/openchinacode.log
```

API keys should stay in local auth/config files. Do not commit credentials.

## Custom Slash Commands

OpenChinaCode custom commands are grouped under `OpenChinaCode` in the TUI command palette.

| Command             | Purpose                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `/auto-maxtokens`   | View or change automatic output-token budgeting                            |
| `/compact`          | Run smart compaction; use `/compact keep N` to preserve N recent raw turns |
| `/lsp`              | View or toggle LSP diagnostics                                             |
| `/task-policy`      | Inspect current task-routing policy                                        |
| `/task-classify`    | Classify a task description against routing policy                         |
| `/test-mcp`         | Configure built-in Playwright MCP from inside the TUI                      |
| `/browser-check`    | Ask the agent to run browser-level checks                                  |
| `/integration-test` | Ask the agent to create/run an integration test plan                       |

See [readme.md](./readme.md) for command usage.

## Model Routing

OpenChinaCode routes subagent work by task kind and complexity. Examples:

| Task kind      | Quick               | Medium              | Complex         |
| -------------- | ------------------- | ------------------- | --------------- |
| `plan`         | GLM-5.2 high        | GLM-5.2 high        | GLM-5.2 max     |
| `refactor`     | GLM-5.2 high        | GLM-5.2 high        | GLM-5.2 max     |
| `review`       | Kimi K2.7 highspeed | Kimi K2.7 highspeed | GLM-5.2 high    |
| `implement`    | Kimi K2.7 highspeed | Kimi K2.7 highspeed | GLM-5.2 high    |
| `debug`        | DeepSeek V4 Pro     | DeepSeek V4 Pro     | DeepSeek V4 Pro |
| `visual_check` | GLM-5V Turbo        | GLM-5V Turbo        | GLM-5V Turbo    |
| `compaction`   | GLM-5.2 high        | GLM-5.2 high        | GLM-5.2 high    |

The table is intentionally opinionated. Users can override routing through config when needed.

## Development

Requirements:

- Bun 1.3+
- Git

Useful commands:

```bash
bun install
bun run typecheck
bun test
bun run --cwd packages/opencode build --single
```

Package-specific checks used most often in this fork:

```bash
bun test --cwd packages/opencode
bun test --cwd packages/llm
bun run --cwd packages/opencode typecheck
bun run --cwd packages/llm typecheck
```

## Status

OpenChinaCode is an experimental, fast-moving fork. Breaking changes are acceptable when they make the China-focused CLI simpler, more stable, or easier to debug.

Use the upstream opencode project if you want the general-purpose upstream product. Use OpenChinaCode if you want a focused GLM/Kimi/DeepSeek coding-agent lab.
