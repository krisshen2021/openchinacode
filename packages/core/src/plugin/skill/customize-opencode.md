<!--
  Built-in skill. Name and description are registered in code at
  packages/core/src/plugin/skill.ts and packages/opencode/src/skill/index.ts.
  The skill name remains "customize-opencode" for compatibility, but this
  content documents OpenChinaCode's current config system.
-->

# Customizing OpenChinaCode

OpenChinaCode validates its own config strictly and can refuse to start when a
field shape is wrong. Use this guide whenever the user asks to configure
OpenChinaCode itself, including providers, MCP servers, permissions, agents,
commands, skills, task policy, compaction, LSP, Playwright, native media, OCR,
or OpenChinaCode project/global config files.

Do not apply upstream opencode config examples verbatim. OpenChinaCode uses the
`openchinacode` command, `openchinacode.json(c)` config files, `.openchinacode/`
project directories, and `~/.config/openchinacode/` global config.

## Config Loading

OpenChinaCode reads config once when the instance starts. After editing a config
file, agent file, command file, skill, or plugin, tell the user to restart
OpenChinaCode unless the feature explicitly supports hot-apply, such as
`/task-policy`, `/permission`, `/test-mcp`, `/media-auth`, or `/ocr-auth`.

Config precedence is:

1. Global config from `~/.config/openchinacode/openchinacode.jsonc` or
   `~/.config/openchinacode/openchinacode.json`.
2. Project root config discovered upward from the working directory:
   `openchinacode.jsonc` or `openchinacode.json`.
3. Project directory config discovered upward:
   `.openchinacode/openchinacode.jsonc` or
   `.openchinacode/openchinacode.json`.
4. Explicit overrides from environment flags such as `OPENCODE_CONFIG` and
   `OPENCODE_CONFIG_CONTENT`.

Project config overrides global config. Preserve existing unrelated fields.

## File Locations

| Scope            | Path                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| Global config    | `~/.config/openchinacode/openchinacode.jsonc`                                                       |
| Project config   | `./openchinacode.jsonc` or `.openchinacode/openchinacode.jsonc`                                     |
| Global auth      | `~/.local/share/openchinacode/auth.json`                                                            |
| MCP OAuth auth   | `~/.local/share/openchinacode/mcp-auth.json`                                                        |
| Project agents   | `.openchinacode/agent/<name>.md` or `.openchinacode/agents/<name>.md`                               |
| Global agents    | `~/.config/openchinacode/agent/<name>.md` or `~/.config/openchinacode/agents/<name>.md`             |
| Project commands | `.openchinacode/command/<name>.md` or `.openchinacode/commands/<name>.md`                           |
| Global commands  | `~/.config/openchinacode/command/<name>.md` or `~/.config/openchinacode/commands/<name>.md`         |
| Project skills   | `.openchinacode/skill/<name>/SKILL.md` or `.openchinacode/skills/<name>/SKILL.md`                   |
| Global skills    | `~/.config/openchinacode/skill/<name>/SKILL.md` or `~/.config/openchinacode/skills/<name>/SKILL.md` |
| External skills  | `~/.claude/skills/<name>/SKILL.md`, `~/.agents/skills/<name>/SKILL.md`                              |

## Base Config Shape

Use JSONC for examples because user configs often contain comments.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "zhipuai-pay2go/glm-5.2#max",
  "default_agent": "build",
  "soul": "rigorous",
  "lsp": true,
  "formatter": true,
  "auto_maxtokens": "heuristic",
  "tool_output": { "max_lines": 2000, "max_bytes": 51200 },
  "compaction": { "auto": true, "tail_turns": "auto" },

  "task_policy": {
    "enabled": true,
    "extra_router": { "enabled": false },
  },

  "mcp": {},
  "agent": {},
  "command": {},
  "provider": {},
  "permission": {},
  "skills": {
    "paths": [".openchinacode/skills"],
    "urls": [],
  },
  "plugin": [],
}
```

Important shape rules:

- `model` is `provider/model` with optional `#variant`, for example
  `moonshotai-cn/kimi-k3#high`.
- Use `agent`, `command`, `provider`, `plugin`, `permission` in config files.
  Do not invent plural aliases unless the local schema explicitly supports them.
- `mcp` is an object keyed by server name. It is not `mcpServers`.
- Local MCP `command` is an array of strings, never one shell string.
- Remote MCP uses `type: "remote"` and `url`.
- Remote MCP OAuth is enabled by default unless `oauth: false`; use `oauth: {}`
  when you want to make OAuth intent explicit.
- String values in headers can use `{env:VAR}` interpolation. Shell-style
  `${VAR}` is not substituted.

## MCP Servers

### Local MCP

```jsonc
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": [
        "openchinacode",
        "mcp",
        "playwright",
        "--headless",
        "--isolated",
        "--browser=chrome",
        "--caps=default",
      ],
      "enabled": true,
      "timeout": 30000,
    },
  },
}
```

`--isolated` is the recommended default for Playwright MCP. It avoids reusing a
persistent `mcp-chrome-<hash>` profile and reduces `SingletonLock` / `Browser is
already in use` failures.

### Remote OAuth MCP

```jsonc
{
  "mcp": {
    "miro": {
      "type": "remote",
      "url": "https://mcp.miro.com",
      "enabled": true,
      "oauth": {},
      "timeout": 30000,
    },
  },
}
```

After adding a remote OAuth MCP server, the user must authenticate:

```bash
openchinacode mcp auth miro
openchinacode mcp list
```

If the TUI status says `Needs authentication`, do not rewrite the MCP config into
`mcpServers`. Run `openchinacode mcp auth <name>` instead.

### Adding Miro MCP

Miro's official MCP endpoint is:

```text
https://mcp.miro.com
```

Use this OpenChinaCode config:

```jsonc
{
  "mcp": {
    "miro": {
      "type": "remote",
      "url": "https://mcp.miro.com",
      "enabled": true,
      "oauth": {},
      "timeout": 30000,
    },
  },
}
```

Then authenticate with:

```bash
openchinacode mcp auth miro
```

Miro board access is scoped to the Miro team selected during OAuth. If a prompt
references a board URL from another team, ask the user to re-authenticate or use
a board in the authorized team.

## Providers And Auth

OpenChinaCode's built-in model surface is intentionally focused on GLM, Kimi,
and DeepSeek. Prefer built-in providers over re-adding generic OpenAI-compatible
duplicates.

Native media generation and OCR use auth entries, not normal LLM providers:

- Volcengine Ark Seedream/Seedance auth is saved by `/media-auth` or
  `ARK_API_KEY`, under `~/.local/share/openchinacode/auth.json`.
- Baidu Unlimited-OCR auth is saved by `/ocr-auth` or
  `BAIDU_OCR_API_KEY` + `BAIDU_OCR_SECRET_KEY`, under
  `~/.local/share/openchinacode/auth.json`.

Do not store secrets directly in project config when an auth command or
environment variable is available.

## Agents

Inline:

```jsonc
{
  "agent": {
    "reviewer": {
      "description": "Reviews code for correctness and regression risk.",
      "mode": "subagent",
      "model": "zhipuai-pay2go/glm-5.2#high",
      "permission": { "edit": "deny", "bash": "ask" },
      "prompt": "You are a strict code reviewer...",
    },
  },
}
```

File:

```text
.openchinacode/agents/reviewer.md
```

```markdown
---
description: Reviews code for correctness and regression risk.
mode: subagent
model: zhipuai-pay2go/glm-5.2#high
permission:
  edit: deny
  bash: ask
---

You are a strict code reviewer...
```

The file body becomes the prompt. Do not duplicate it as a `prompt:` field.

## Commands

Command files live under `.openchinacode/commands/` or
`~/.config/openchinacode/commands/`.

```text
.openchinacode/commands/deploy-check.md
```

```markdown
---
description: Check deployment readiness.
agent: build
model: moonshotai-cn/kimi-k3#high
---

Inspect the project deployment config and report blockers.
User input: $ARGUMENTS
```

The command body is the template. `$ARGUMENTS` expands to the text after the
slash command.

## Skills

Skill files must be named exactly `SKILL.md`:

```text
.openchinacode/skills/my-skill/SKILL.md
```

```markdown
---
name: my-skill
description: Use when the user asks for ...
---

# My Skill

Instructions...
```

`name` is required, lowercase hyphen-separated, and should match the folder
name. `description` is required in practice because skills without descriptions
are not advertised to the model.

## Permissions

```jsonc
{
  "permission": {
    "edit": "deny",
    "bash": { "*": "ask", "git status*": "allow" },
    "external_directory": { "*": "ask", "~/Projects/**": "allow" },
    "task": "allow",
  },
}
```

Actions are `allow`, `ask`, and `deny`. For object rules, insertion order
matters and the last matching rule wins. Per-agent `permission` overrides
top-level `permission`.

Plan mode must remain read-only. If editing a plan agent or subagent used from
plan mode, make sure `edit`, `write`, `apply_patch`, and similar write tools
remain denied.

## OpenChinaCode-Specific Settings

### Task Policy

```jsonc
{
  "task_policy": {
    "enabled": true,
    "extra_router": { "enabled": false },
  },
}
```

Users can hot-toggle in TUI:

```text
/task-policy on
/task-policy off
/task-policy extra-on
/task-policy extra-off
```

### Soul

```jsonc
{
  "soul": "rigorous",
}
```

Supported built-ins: `rigorous`, `friendly`, `custom`. The custom path defaults
to `.openchinacode/souls/custom.md`.

### Compaction

```jsonc
{
  "compaction": {
    "auto": true,
    "tail_turns": "auto",
  },
}
```

OpenChinaCode smart compaction combines general summary, active-task essential
extraction, and a minimal raw recent tail. Do not replace this with upstream
opencode-only compaction advice.

## Escape Hatches

These environment variables are still named `OPENCODE_*` for compatibility with
upstream internals:

- `OPENCODE_DISABLE_PROJECT_CONFIG=1`: skip project config.
- `OPENCODE_CONFIG=/path/to/openchinacode.jsonc`: load an explicit config file.
- `OPENCODE_CONFIG_CONTENT='{"model":"zhipuai-pay2go/glm-5.2"}'`: inject inline
  config.
- `OPENCODE_DISABLE_DEFAULT_PLUGINS=1`: skip default plugins.
- `OPENCODE_PURE=1`: skip external plugins.
- `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`: skip external skills.

Use these only as emergency recovery tools when config prevents startup.

## Before Writing Config

- Read the existing file first and preserve unrelated fields.
- Prefer `openchinacode.jsonc` over `openchinacode.json`.
- Prefer `.openchinacode/` over `.opencode/` for project-local customization.
- Use `openchinacode mcp auth <name>` for OAuth; do not invent tokens.
- Use `/media-auth` and `/ocr-auth` for native media/OCR credentials.
- After file edits, tell the user whether restart is required.
