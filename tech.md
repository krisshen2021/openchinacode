# OpenChinaCode 技术说明

本文是 OpenChinaCode 的维护索引。`manual.md` 面向日常使用；本文记录当前 fork 的架构约定、定制功能入口、配置字段、调试方式和测试命令。

## 项目边界

- OpenChinaCode 是 opencode 的私有未发布 fork，目标是 CLI/TUI 编程助手，不做 webui、desktop、独立 tui 包发行目标。
- 命令名是 `openchinacode`，避免和本机原版 `opencode` 冲突。
- 当前只面向三家 provider：GLM / 智谱、Kimi / Moonshot、DeepSeek。
- 这是内部 fork，不保留旧 schema、旧 slash command、旧 provider 命名、旧 task routing 兼容。需要破坏式清理时直接清理。
- 不在仓库文档中记录 API key。

## 运行目录

核心入口在 `packages/core/src/global.ts`，app name 固定为 `openchinacode`。

常用路径：

```text
~/.config/openchinacode
~/.local/share/openchinacode
~/.cache/openchinacode
~/.local/state/openchinacode
```

常用文件：

```text
~/.config/openchinacode/openchinacode.jsonc
~/.local/share/openchinacode/auth.json
~/.local/share/openchinacode/log/openchinacode.log
```

全局配置文件优先读取：

```text
openchinacode.json
openchinacode.jsonc
```

TUI slash command 写配置时也会优先写 `~/.config/openchinacode/openchinacode.jsonc`。

## Provider 与模型

Provider catalog 精简入口：

- `packages/core/src/models-dev.ts`
- `packages/opencode/src/provider/provider.ts`
- `packages/tui/src/component/dialog-provider.tsx`

只保留：

| Provider         | 目标                         | 协议              |
| ---------------- | ---------------------------- | ----------------- |
| `zhipuai-pay2go` | GLM / BigModel pay-as-you-go | OpenAI compatible |
| `moonshotai-cn`  | Kimi / Moonshot China        | OpenAI compatible |
| `deepseek`       | DeepSeek official API        | OpenAI compatible |

`zhipuai-pay2go` 从上游 `zhipuai` 派生，固定：

```text
base url: https://open.bigmodel.cn/api/paas/v4
env: ZHIPUAI_PAY2GO_API_KEY
```

OpenRouter、重复的 Kimi/Z.AI/Zhipu coding plan 等 provider 不作为 OpenChinaCode 默认面向对象。

## 价格与上下文

价格表在 `packages/core/src/models-dev.ts`：

| Model                      | Input | Output | Cache read | Currency        |
| -------------------------- | ----: | -----: | ---------: | --------------- |
| `glm-5.2`                  |     8 |     28 |          2 | CNY / 1M tokens |
| `glm-5v-turbo`             |     5 |     22 |        1.2 | CNY / 1M tokens |
| `kimi-k2.7-code`           |   6.5 |     27 |        1.3 | CNY / 1M tokens |
| `kimi-k2.7-code-highspeed` |    13 |     54 |        2.6 | CNY / 1M tokens |
| `deepseek-v4-flash`        |     1 |      2 |       0.02 | CNY / 1M tokens |
| `deepseek-v4-pro`          |     3 |      6 |      0.025 | CNY / 1M tokens |

TUI 右侧 `spent` 和底部费用按人民币显示。上下文百分比按当前模型 metadata 的 `limit.context` 计算，切换模型后应随模型上下文窗口变化。

## 中国模型请求优化

核心代码：

- `packages/opencode/src/provider/china-transform.ts`
- `packages/opencode/src/provider/transform.ts`
- `packages/opencode/src/session/llm.ts`
- `packages/opencode/src/session/llm/budget.ts`
- `packages/opencode/src/session/llm/request.ts`

协议均按 OpenAI-compatible 发送，但会按模型族重写参数。

GLM：

- 默认开启 thinking。
- GLM 5.2 默认 `reasoningEffort: "high"`。
- 支持 variant：`none`、`high`、`max`。
- 如果同时出现 `temperature` 和 `top_p`，删除 `top_p`，避免不兼容。

Kimi：

- 删除 `temperature`、`top_p`、presence/frequency penalty 等采样字段，让官方默认值生效。
- `max_tokens` 改写为 `max_completion_tokens`。
- Kimi K2.7 code 开启 `thinking.keep = "all"`。
- 使用 `prompt_cache_key = sessionID`。
- 非 `auto` / `none` 的 `tool_choice` 会降为 `auto`。

DeepSeek：

- `deepseek-v4`、`deepseek-reasoner`、`deepseek-r1` 默认开启 thinking；`deepseek-chat` 默认不开。
- thinking 开启时删除采样字段。
- DeepSeek V4 支持 variant：`none`、`high`、`max`。

## Max Tokens 策略

输出 token 策略在 `packages/opencode/src/provider/china-transform.ts` 和 `packages/opencode/src/session/llm/budget.ts`。

官方输出预算：

| Family                    | default |     max |
| ------------------------- | ------: | ------: |
| GLM 5.x / 4.7 / 4.6       |  65,536 | 131,072 |
| GLM 4.5                   |  65,536 |  98,304 |
| Kimi K2.5/K2.6/K2.7 code  |  32,768 |  32,768 |
| DeepSeek V4/chat/reasoner | 131,072 | 393,216 |

本地判断会在以下场景倾向 max：

- variant 是 `max` / `deep` / `long` / `xhigh`
- 大上下文
- 用户明确要求完整、全量、不要省略、继续输出
- 当前 turn 有编码意图、代码块、文件路径、diff、报错、诊断

`auto_maxtokens` 配置：

```jsonc
{
  "auto_maxtokens": "heuristic",
}
```

可选形式：

```jsonc
{
  "auto_maxtokens": {
    "mode": "llm",
    "model": "deepseek/deepseek-v4-flash",
    "timeout_ms": 1000,
  },
}
```

模式：

- `off`：使用官方 default。
- `heuristic`：只用本地启发式，默认模式。
- `llm`：本地判断不确定时，用低成本 judge 模型判断 `default` 或 `max`。未显式配置时默认使用 `deepseek/deepseek-v4-flash`。

上下文接近溢出时，`llm/budget.ts` 会按当前模型上下文、prompt tokens、工具 schema 和安全 buffer 做 clamp。如果可用输出小于最低有效输出，会触发 compaction，而不是硬塞一个过大的 `max_tokens`。

## Slash Commands

OpenChinaCode 定制 slash command 的 TUI 入口在 `packages/tui/src/component/prompt/index.tsx`。Ctrl+P 中统一归类为 `OpenChinaCode`。

### `/auto-maxtokens`

本地 TUI command，不调用当前对话模型。写入全局配置。

```text
/auto-maxtokens
/auto-maxtokens status
/auto-maxtokens off
/auto-maxtokens heuristic
/auto-maxtokens llm
/auto-maxtokens llm deepseek/deepseek-v4-flash
/auto-maxtokens model deepseek/deepseek-v4-flash
```

别名：

```text
/auto-max-tokens
```

### `/compact`

本地 TUI command，不调用当前对话模型来解释命令本身。实际压缩模型由 task policy 路由，默认是 `zhipuai-pay2go/glm-5.2#high`。

```text
/compact
/compact auto
/compact smart
/compact keep N
/compact keep auto
/summarize
/summarize keep N
```

行为：

- `/compact` 使用 OpenChinaCode 三层智能压缩：general summary、active task essential extraction、minimal raw recent tail。
- `/compact keep N` 是手动 override，会在三层策略外额外请求保留最近 N 个原始用户轮次及其后续 assistant/tool 消息。
- `/compact keep auto` 回到默认智能策略。
- TUI Smart Compaction 面板会显示 `strategy`、`retention`、`route`、`judge`、`profile`、`active-task`、`selection`、`summary` 等阶段。

### `/lsp`

本地 TUI command，不调用当前对话模型。写入全局配置。

```text
/lsp
/lsp status
/lsp on
/lsp off
```

`/lsp on/off` 修改 `lsp` 配置后通常需要重启 OpenChinaCode。

### `/permissions`

本地 TUI command，不调用当前对话模型。打开项目权限策略面板。

```text
/permissions
```

实现入口：

- `packages/tui/src/component/dialog-permissions.tsx`
- `packages/tui/src/routes/session/permission.tsx`
- `packages/tui/src/util/permission-config.ts`
- `packages/opencode/src/permission/index.ts`
- `packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/permission.ts`

配置写入位置：

```text
project: <worktree>/.openchinacode/openchinacode.jsonc
global:  ~/.config/openchinacode/openchinacode.jsonc
```

`/permissions` 写项目级策略，并同步调用 `POST /permission/runtime`，让当前 instance 立即应用 runtime rules。runtime rules 的优先级：

```text
agent defaults/config -> runtime project policy -> current-session Allow always
```

项目策略：

| 策略                        | permission config                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `Project Trust All`         | `"allow"`                                                                                                            |
| `Project Safe`              | read/glob/grep/list/task/lsp/todowrite/question/webfetch allow；edit/bash/external_directory/websearch/doom_loop ask |
| `Project Ask Everything`    | `"ask"`                                                                                                              |
| `Project Readonly`          | read/search/lsp/question allow；edit/todowrite/doom_loop deny；task/bash/external_directory ask                      |
| `Reset Project Permissions` | 删除 `permission` 字段                                                                                               |

权限弹窗新增 `Project` / `Global` 按钮。它们不会应用整套策略，只把当前请求的 `permission + always patterns` 写入对应配置，并同时下发 runtime allow rules；随后发送现有 `always` reply 解除当前 pending permission。

### `/test-mcp`

本地 TUI command，不调用当前对话模型。面向新用户的一键 Playwright MCP 配置入口，写入全局配置。

```text
/test-mcp
/test-mcp status
/test-mcp on
/test-mcp off
/test-mcp toggle
/test-mcp headless
/test-mcp headed
```

别名：

```text
/playwright-mcp
```

写入位置：

```text
~/.config/openchinacode/openchinacode.jsonc
```

默认写入：

```jsonc
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["openchinacode", "mcp", "playwright", "--headless", "--browser=chrome", "--caps=default"],
      "enabled": true,
      "timeout": 30000,
    },
  },
}
```

`/test-mcp on/headless/headed` 会先写入全局配置，再通过 runtime MCP API 立即 hot-connect 内置 Playwright MCP；`/test-mcp off` 会写入 disabled 并立即 disconnect。CLI 里的 `openchinacode test mcp` 保留给脚本、自动化或 TUI 外部使用；日常新用户优先用 `/test-mcp on`。

默认浏览器是系统 Google Chrome。TUI 的 `/test-mcp on/headless/headed` 会先检查 Chrome 是否存在；底层 `openchinacode mcp playwright --browser=chrome` 也会做同样的硬预检。缺失时会立即给出安装提示，避免开发到一半才在 Playwright tool call 阶段失败。

### `/sessions`

Session picker 改造：

```text
/sessions
/resume
/continue
```

实现入口：

- `packages/tui/src/component/dialog-session-list.tsx`
- `packages/tui/src/app.tsx`
- `packages/tui/src/context/sync.tsx`

行为：

- `session.list` command 的 slash name 是 `/sessions`，aliases 是 `/resume`、`/continue`。
- 默认 scope 是 `project`，只列当前项目 session。
- 左右方向键切换 scope：`project` / `all`。
- `project` scope 使用 `sdk.client.session.list({ scope: "project" })`。
- `all` scope 使用 `globalClient().experimental.session.list(...)`，展示所有项目 session。
- 当前项目列表支持 pin/unpin；全局列表隐藏 pin/unpin。
- 删除、重命名能力保留。
- 选择跨项目 session 时进入 `DialogCrossProjectSession`：
  - `Open original project`：直接进入原 session。
  - `Use current directory`：fork session，并通过 control plane move 到当前目录，原 session 不变。

Playwright MCP 默认产物目录：

```text
/tmp/openchinacode-playwright
```

实现入口：

- `packages/opencode/src/cli/cmd/mcp.ts`：`DEFAULT_PLAYWRIGHT_OUTPUT_DIR`，启动 `@playwright/mcp` 时设置 `outputDir`。
- `packages/opencode/src/mcp/catalog.ts`：对 screenshot、snapshot、PDF、console、network、storage、video 等 artifact tool 的 `filename` 做安全重写。

规则：

- 模型传相对 `filename` 时，OpenChinaCode 会改写到 `/tmp/openchinacode-playwright/<safe-name>`。
- 模型传空 filename 或 `<auto>` 时，删除 filename，让 Playwright MCP 自己处理。
- 可以通过 `openchinacode mcp playwright --output-dir <dir>` 覆盖默认目录。
- 目标是避免截图、`.yml` snapshot、console log 等临时产物落到用户项目根目录。

内置 Playwright MCP 入口：

```text
openchinacode mcp playwright --headless --browser=chrome --caps=default
```

`--caps=default` 在 OpenChinaCode 中展开为 `config,network,storage,testing,pdf,vision`。默认不启用 `devtools`，避免模型看到高成本录屏工具后误用。高级用户可以手动改成 `--caps=all` 来启用 `devtools`。

动画/过渡/播放状态检查的目标链路是：

```text
Playwright MCP telemetry / computed transform / cropped pixel diff -> optional screenshot -> task_kind=visual_check -> glm-5v-turbo 判断视觉外观
```

DOM/CSS `getComputedStyle()`、`getAnimations()`、computed transform 采样、裁剪区域像素差，是判断“动画是否实际运行”的主证据。GLM-5V 只负责截图和视觉外观语义；如果两者冲突，应该明确报告冲突，并以浏览器 telemetry / 像素变化判断动画状态。浏览器录屏默认不作为模型输入路径，除非用户明确要求生成视频证据。

### 粘贴图片视觉预处理

目标：用户在 TUI prompt 中 Ctrl+V 粘贴图片后，不依赖当前主模型是否支持 vision，也不依赖关键词判断，先用 GLM-5V 做稳定视觉预处理，再把结果交给主模型继续编程任务。

实现入口：

- `packages/tui/src/clipboard.ts`：跨平台读取剪贴板图片，返回 base64 `image/png`。
- `packages/tui/src/component/prompt/index.tsx`：
  - `pasteAttachment()`：剪贴板图片保存到 `/tmp/openchinacode/attachments/<session|draft>/clipboard-<hash>.<ext>`。
  - `visualPreprocessSubtask()`：构造 `subtask` part，显式指定 `zhipuai-pay2go/glm-5v-turbo`。
  - `visualPreprocessPrompt()`：把用户原始 prompt 和 `@/tmp/...` 图片引用交给 GLM-5V。
  - `visualPreprocessUserText()`：给主模型注入原始 prompt、图片路径和“使用视觉预处理结果”的约束。
- `packages/tui/src/prompt/history.tsx`、`packages/plugin/src/tui.ts`：Prompt part 类型允许 `SubtaskPart`。

运行机制：

```text
User prompt + pasted image
-> TUI saves image to /tmp/openchinacode/attachments
-> User message includes original prompt text + visual preprocessing subtask
-> session loop runs subtask first
-> GLM-5V sees prompt + image file reference and returns visual observations
-> primary model continues with original prompt + subtask result
```

设计约束：

- 普通自然语言 prompt 只要包含 image file part 就触发，不做“看图/截图/UI”关键词判断。
- Slash command 不触发，避免破坏 `/image-generate`、`/video-generate` 使用图片作为参考素材。
- 图片 file part 不再直接送给主模型，避免 DeepSeek / GLM-5.2 等非视觉模型收到 unsupported image input 后走偏。
- 主模型提示中明确要求不要因为粘贴图片再去 Playwright 重截；只有用户明确要求 live browser / 当前页面状态时才使用 Playwright MCP。

### `/media-auth`, `/image-generate`, `/video-generate`

原生媒体生成入口。

TUI slash command：

```text
/media-auth
/image-generate [prompt]
/video-generate [prompt]
```

工具入口：

- `packages/opencode/src/tool/media-common.ts`
- `packages/opencode/src/tool/image-generate.ts`
- `packages/opencode/src/tool/video-generate.ts`
- `packages/opencode/src/tool/video-status.ts`
- `packages/opencode/src/tool/registry.ts`

模型提示词合约：

- `packages/opencode/src/session/prompt/china-tools.txt`

认证：

```text
provider id: volcengine-ark
env fallback: ARK_API_KEY
auth file: ~/.local/share/openchinacode/auth.json
```

火山方舟配置：

```text
base url: https://ark.cn-beijing.volces.com/api/v3
image model: doubao-seedream-5-0-pro-260628
video model: doubao-seedance-2-0-mini-260615
```

默认输出：

```text
/tmp/openchinacode/media/images
/tmp/openchinacode/media/videos
```

工具行为：

- `image_generate` 支持本地图片路径、`file://`、HTTP(S) URL、`data:image` 作为参考图。
- 本地图片参考会通过 `referenceToImageInput` 转成 `data:image/<format>;base64,...`；HTTP(S)、`data:image` 和支持的 asset URL 保持原样。
- `image_generate` 最多 10 张参考图，默认 `2K`、`png`、不加 watermark。Seedream 5 Pro size 仅支持 `1K`、`2K` 或合法 `宽x高` 像素值；`3K/4K` 属于 Seedream 5.0 Lite 档位。
- `video_generate` 支持最多 9 张本地图片参考；参考视频最多 3 个，本地视频文件在 MVP 中不上传，要求 URL 或 asset id。
- `video_generate` 支持严格首帧/首尾帧控制：`first_frame_image`、`last_frame_image`。该模式不能和普通 `reference_images` / `reference_videos` 混用。
- `first_frame_image` / `last_frame_image` 会以 Seedance 的 `first_frame` / `last_frame` role 发送；普通 `reference_images` 以 `reference_image` role 发送。
- 图生视频里的本地图片同样转成 base64 data URL；参考视频只允许公网 URL 或素材 ID，不做本地视频 base64 上传。
- `video_generate` 默认 `720p`、5 秒、`generate_audio=true`、不加 watermark。
- Seedance 2.0 Mini 当前只暴露 `480p`、`720p`，显式 duration 限制为 4 到 15 秒整数。
- 生成结果立即下载到本地，并写同名 `.json` metadata。模型必须把 `output_path` 和 `metadata_path` 告诉用户。

TUI 工具调用摘要：

- 实现入口：`packages/tui/src/routes/session/index.tsx` 的 `toolInput()` / `mediaToolInput()`。
- `image_generate` 隐藏完整 `reference_images`，只显示 `reference_images=N`。
- `video_generate` 隐藏完整 `reference_images` / `reference_videos` / `first_frame_image` / `last_frame_image`。
- 首尾帧显示安全摘要：basename、`host/name`、`asset://...` 前缀，或 `data:image` 类型。
- 目的是让用户看到 role 和数量，但不把完整本地路径、临时 URL 或 base64 刷满 TUI。

### `/task-policy`

本地 TUI 面板，不调用模型，不把策略表写入上下文。

```text
/task-policy
/task-policy review
/task-policy compaction
/task-policy extra-status
/task-policy extra-on
/task-policy extra-off
```

实现入口：

- `packages/tui/src/component/dialog-task-policy.tsx`
- `packages/tui/src/component/prompt/index.tsx`
- `packages/tui/src/component/prompt/slash.ts`

注意：当前面板展示的是内置默认策略表，不是用户配置覆盖后的 effective policy。运行时会尊重用户配置，subagent footer 的 `source` 会显示来源。

`extra-on/off/status` 是本地 TUI command，写入全局配置：

```jsonc
{
  "task_policy": {
    "extra_router": {
      "enabled": true,
    },
  },
}
```

运行管线：

```text
ordinary prompt
-> SessionPrompt.applyExtraTaskRouter()
-> TaskRouterJudge.run() fast JSON judge
-> insert synthetic route note + subtask part
-> MessageV2.latest() picks queued subtask
-> TaskTool receives task_kind/task_complexity
-> TaskPolicy.select() chooses routed model
```

保护条件：

- `task_policy.extra_router.enabled !== true` 时不运行。
- `noReply`、显式 `subtask`、显式 `agent`、file attachment、slash-like prompt、subagent 自己的 prompt 都跳过。
- 目标是补足普通 build/plan/debug/refactor 请求不会主动调用 `task` tool 的短板，不干扰粘贴图片视觉预处理和媒体生成命令。

### `/task-classify`

这是 prompt slash command，会交给当前模型解释分类，不是本地 TUI 面板。

```text
/task-classify <task description>
```

它用于人工调试和理解 task kind / complexity / route，不参与自动 build 路由的真实执行。

实现入口：

- `packages/opencode/src/command/index.ts`

### `/integration-test`

这是 prompt slash command，会要求模型执行 OpenChinaCode 标准联调流程：

```text
/integration-test
/integration-test 检查登录流程
/integration-test 只验证前端页面是否有 console error
```

预期流程：

```text
检查 package scripts / integration_test 配置
-> 必要时运行 openchinacode test init
-> 运行 openchinacode test run
-> 阅读 .openchinacode/reports/**/integration-report.md 和日志
-> 定义 bug / 修复 / 重跑
```

### `/browser-check`

这是 prompt slash command，用于浏览器层检查：

```text
/browser-check
/browser-check http://127.0.0.1:5173
/browser-check 检查设置页交互
```

优先级：

```text
Playwright MCP
-> OpenChinaCode Playwright Test template
-> raw google-chrome fallback
```

raw Chrome 只是最后 fallback，不是默认策略。

当检查需要理解截图、布局、遮挡、OCR 或视觉可访问性时，模型应通过 `visual_check` subtask 路由到 `zhipuai-pay2go/glm-5v-turbo`。视觉模型返回结构化观察结果后，后续修复仍回到 `test_fix` / `debug` / `implement` 路由。

## Integration Test Kit

目标：补齐 opencode 类 agent 在前后端联调、浏览器测试和稳定报告上的短板，避免测试主要依赖 curl 和临时 shell 脚本。

CLI：

```text
openchinacode test init
openchinacode test init --base-url http://127.0.0.1:5173 --health-url http://127.0.0.1:8000/health
openchinacode test mcp
openchinacode test mcp --global
openchinacode test run
openchinacode test run --no-start --base-url http://127.0.0.1:5173
```

TUI 新用户优先使用：

```text
/test-mcp on
```

这会写入全局 Playwright MCP 配置，并在当前 TUI 进程里立即 hot-connect。连接成功后模型可以直接看到 Playwright MCP 工具。`openchinacode test mcp` 是同一配置的命令行版本，主要用于脚本和非 TUI 场景。

生成文件：

```text
.openchinacode/test-kit/playwright.config.ts
.openchinacode/test-kit/e2e/smoke.spec.ts
.openchinacode/reports/integration-*/integration-report.md
.openchinacode/reports/integration-*/integration-report.json
```

配置字段：

```jsonc
{
  "integration_test": {
    "base_url": "http://127.0.0.1:5173",
    "health_url": "http://127.0.0.1:8000/health",
    "frontend": {
      "command": "npm run dev",
      "host": "127.0.0.1",
      "port": 5173,
      "wait_timeout_ms": 120000,
    },
    "backend": {
      "command": "python -m uvicorn app.main:app --reload",
      "host": "127.0.0.1",
      "port": 8000,
      "wait_timeout_ms": 120000,
    },
    "playwright_config": ".openchinacode/test-kit/playwright.config.ts",
    "report_dir": ".openchinacode/reports",
    "mcp": {
      "enabled": false,
      "headless": true,
      "timeout": 30000,
    },
  },
}
```

`openchinacode test mcp` 写入的 MCP 模板：

```jsonc
{
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["openchinacode", "mcp", "playwright", "--headless", "--browser=chrome", "--caps=default"],
      "enabled": true,
      "timeout": 30000,
    },
  },
}
```

实现入口：

- `packages/core/src/config/integration-test.ts`
- `packages/opencode/src/integration-test/kit.ts`
- `packages/opencode/src/cli/cmd/test.ts`
- `packages/opencode/src/command/index.ts`

## Task Policy

配置 schema：

- `packages/core/src/config/task-policy.ts`
- `packages/core/src/config.ts`

任务分类和路由：

- `packages/opencode/src/session/task-policy.ts`
- `packages/opencode/src/session/judge/json-judge.ts`
- `packages/opencode/src/session/judge/auto-maxtokens.ts`
- `packages/opencode/src/session/judge/task-router.ts`
- `packages/opencode/src/session/compaction-profile.ts`

Shared LLM judge runner:

```text
JsonJudge.runJsonJudge()
```

统一处理：

- judge 模型候选选择
- current model / configured model / fallback small model
- timeout + abort
- JSON 抽取
- invalid raw preview
- usage / reasoning token 日志

当前业务 judge：

| Judge                    | 配置路径                                    | 默认模型候选                            | 用途                                          |
| ------------------------ | ------------------------------------------- | --------------------------------------- | --------------------------------------------- |
| `auto_maxtokens`         | `task_policy.judges.auto_maxtokens`         | `deepseek/deepseek-v4-flash`            | 模糊场景判断 `default` / `max` 输出预算       |
| `compaction_profile`     | `task_policy.judges.compaction_profile`     | current model -> Kimi -> DeepSeek flash | 智能压缩前输出稳定 profile JSON               |
| `compaction_active_task` | `task_policy.judges.compaction_active_task` | current model -> Kimi -> DeepSeek flash | 智能压缩前抽取当前活跃任务的细颗粒状态        |
| `task_router`            | `task_policy.judges.task_router`            | `deepseek/deepseek-v4-flash`            | 普通 prompt 前判断是否自动插入 routed subtask |

Task kinds：

```text
general, plan, architecture, refactor, review, implement, explore, visual_check, debug, test_fix, summarize, compaction
```

Complexities：

```text
quick, medium, complex
```

路由优先级：

```text
explicit task model
> subagent model
> task_policy agent route
> task_policy global route
> model task_classes tag
> OpenChinaCode builtin route
> parent model fallback
```

内置默认表：

| Task kind      | quick                      | medium                     | complex           |
| -------------- | -------------------------- | -------------------------- | ----------------- |
| `general`      | inherit                    | inherit                    | inherit           |
| `plan`         | `glm-5.2#high`             | `glm-5.2#high`             | `glm-5.2#max`     |
| `architecture` | `glm-5.2#high`             | `glm-5.2#high`             | `glm-5.2#max`     |
| `refactor`     | `glm-5.2#high`             | `glm-5.2#high`             | `glm-5.2#max`     |
| `review`       | `kimi-k2.7-code-highspeed` | `kimi-k2.7-code-highspeed` | `glm-5.2#high`    |
| `implement`    | `kimi-k2.7-code-highspeed` | `kimi-k2.7-code-highspeed` | `glm-5.2#high`    |
| `explore`      | `kimi-k2.7-code-highspeed` | `glm-5.2#high`             | `glm-5.2#max`     |
| `visual_check` | `glm-5v-turbo`             | `glm-5v-turbo`             | `glm-5v-turbo`    |
| `debug`        | `deepseek-v4-pro`          | `deepseek-v4-pro`          | `deepseek-v4-pro` |
| `test_fix`     | `deepseek-v4-pro`          | `deepseek-v4-pro`          | `deepseek-v4-pro` |
| `summarize`    | `kimi-k2.7-code-highspeed` | `kimi-k2.7-code-highspeed` | `glm-5.2#high`    |
| `compaction`   | `glm-5.2#high`             | `glm-5.2#high`             | `glm-5.2#high`    |

模型完整 ID：

```text
zhipuai-pay2go/glm-5.2
zhipuai-pay2go/glm-5v-turbo
moonshotai-cn/kimi-k2.7-code-highspeed
deepseek/deepseek-v4-pro
deepseek/deepseek-v4-flash
```

用户覆盖配置：

```jsonc
{
  "task_policy": {
    "enabled": true,
    "extra_router": {
      "enabled": false,
      "confidence_threshold": 0.7,
      "allow": [
        "plan",
        "architecture",
        "refactor",
        "review",
        "implement",
        "explore",
        "visual_check",
        "debug",
        "test_fix",
      ],
      "deny": ["general", "summarize", "compaction"],
    },
    "judges": {
      "auto_maxtokens": {
        "models": ["deepseek/deepseek-v4-flash"],
        "timeout_ms": 1000,
        "max_output_tokens": 64,
      },
      "compaction_profile": {
        "models": ["zhipuai-pay2go/glm-5.2", "moonshotai-cn/kimi-k2.7-code-highspeed", "deepseek/deepseek-v4-flash"],
        "timeout_ms": 60000,
      },
      "task_router": {
        "models": ["deepseek/deepseek-v4-flash"],
        "timeout_ms": 12000,
        "max_output_tokens": 1024,
      },
    },
    "routes": {
      "review.complex": {
        "model": "zhipuai-pay2go/glm-5.2",
        "variant": "high",
      },
      "explore.quick": {
        "model": "moonshotai-cn/kimi-k2.7-code-highspeed",
      },
      "visual_check": {
        "model": "zhipuai-pay2go/glm-5v-turbo",
      },
      "general": {
        "inherit": true,
      },
    },
    "agents": {
      "explore": {
        "review.complex": {
          "model": "zhipuai-pay2go/glm-5.2",
          "variant": "high",
        },
      },
    },
  },
}
```

`routes` 是全局覆盖；`agents` 是按 subagent 名称覆盖。key 支持 `kind` 和 `kind.complexity`，精确 key 优先。`extra_router` 默认关闭，开启后普通 prompt 会先经过 fast judge，适合时自动插入 subtask。`judges` 配置共享 LLM judge 的模型候选、超时和输出 token。

## Subagent 管线

模型看到的 task tool contract：

- `packages/opencode/src/tool/task.ts`
- `packages/opencode/src/tool/task.txt`
- `packages/opencode/src/session/prompt/china-tools.txt`

原则：

- 计划、技术选型、架构、重构、审查、实施、调试、测试修复、深度探索，应先调用 `task`。
- 纯探索用 `subagent_type="explore"`。
- 其他多步骤任务用 `subagent_type="general"`。
- 尽量显式传 `task_kind` 和 `task_complexity`。

TUI subagent 行应显示：

```text
↳ provider/model#variant · kind.complexity · source
```

相关实现：

- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/tool/task.ts`
- `packages/opencode/src/cli/cmd/run/tool.ts`

## Build 模式

默认情况下，build 模式不做额外代码级自动实施路由。用户在 build 模式里确认“可以开始”“继续执行”时，primary build agent 会按正常对话执行；是否调用 `task` 由模型根据 `china-tools.txt` 的 task routing contract 自行决定。

如果启用 `task_policy.extra_router.enabled`，普通 build/plan prompt 会先经过 `TaskRouterJudge`。当 judge 判断应委派时，runtime 会直接插入 `subtask` part，而不是只提示主模型“应该调用 task”。这条路径用于让 implement/refactor/debug/test_fix 等不常主动触发 tool call 的任务也能进入 task policy。

曾经加入过一版代码级自动策略：由 `packages/opencode/src/session/prompt.ts` 捕捉批准实施的 turn，自动包装成 `general` subtask，并用本地/LLM 分类判断 `implement.quick|medium|complex`。这版已回滚，因为它可能在 build 管线里引入上下文拼接、复杂度判断或 subagent 执行时机问题。

后续如果重新做 build 自动路由，应先补齐可观测性和小步验证：

- 在日志和 TUI 中明确显示 primary turn 是否被代码自动改写。
- 先只对显式 `/delegate` 或新的 slash command 生效，不直接拦截普通 build 输入。
- 明确 parent context 摘录策略、token 上限、权限继承和失败回退。
- 先用固定 fixtures 测 quick / medium / complex，再做真实模型实测。

## Compaction

实现入口：

- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/session/compaction-profile.ts`
- `packages/core/src/session/compaction.ts`

机制：

- compaction 通过同一套 task policy 路由。
- 默认 `compaction.* -> zhipuai-pay2go/glm-5.2#high`。
- 如果 compaction agent 自己显式配置了 model，则优先使用 agent model。
- compaction 使用三层策略：general summary、active task essential extraction、minimal raw recent tail。active task essential extraction 现在是独立 LLM JSON 抽取，不只是 summary prompt 里的文字提示。
- 默认 `compaction.tail_turns` 为 `auto` 语义，即 minimal raw tail；如果配置为数字或使用 `/compact keep N`，会额外保留对应最近原始轮次。
- 已完成 compaction summary 会作为后续压缩的锚点。
- 输出预算层如果发现当前上下文留给输出的空间不足，会触发 compaction，而不是盲目降低到无效输出。

智能 profile：

- 压缩前先由 judge 模型输出稳定 JSON：`profiles`、`must_preserve`、`active_task`、`risk`。
- 默认 judge 候选：当前 compaction 路由选中的模型，然后 `moonshotai-cn/kimi-k2.7-code-highspeed`，然后 `deepseek/deepseek-v4-flash`，最后当前 provider 的 small model。
- 默认 compaction 路由是 `zhipuai-pay2go/glm-5.2#high`，因此默认 profile judge 也使用 GLM high。
- judge 只拿截断后的判断上下文：previous summary tail 和 recent conversation tail，不会把完整超大历史再塞给 judge。
- `CompactionProfile.parseJudgeOutput` 解析并 normalize JSON，最终 Decision 增加 `source`。
- `CompactionProfile.buildPrompt` 根据 JSON 拼接固定 Markdown section 模板。
- judge 超时、模型不可用、JSON 无效或调用失败时，fallback 到 `CompactionProfile.infer` 的本地 heuristic。
- heuristic 只作为兜底，不作为主策略。

Active task extraction：

- profile judge 后，如果 `active_task.present=true`，会再调用 `compaction_active_task` judge。
- 默认候选同 profile judge：当前 compaction 路由模型，然后 Kimi highspeed，然后 DeepSeek flash。
- 默认超时 90s，默认输出上限 16384 tokens，可通过 `task_policy.judges.compaction_active_task` 覆盖。
- 输出 JSON 字段包括 `objective`、`status`、`focus`、`files`、`decisions`、`findings`、`changes`、`commands`、`failures`、`next_actions`、`risks`、`open_questions`。
- 最终 summary prompt 会把这份 JSON 作为 `Active Task Essential State` 的权威输入，避免近期任务状态被压缩成一句话。
- 如果该 judge 失败或 JSON 无效，会退回 profile-based fallback，不阻断 compaction。
- TUI Smart Compaction 面板会显示 `active-task extraction: started/result`，日志中对应 `compaction active task extraction judge` 和 `compaction active task`。

Profile 类型：

| Profile                | Section                         | 用途                                   |
| ---------------------- | ------------------------------- | -------------------------------------- |
| `debug_trace`          | `Debug Trace`, `Known Failures` | 保留失败命令、报错、LSP 诊断、排查结论 |
| `implementation_state` | `Implementation State`          | 保留已改文件、未完成实现、验证结果     |
| `architecture_memory`  | `Architecture Decisions`        | 保留架构、技术栈、迁移和取舍           |
| `review_findings`      | `Review Findings`               | 保留审查发现、风险、证据位置           |
| `tool_research`        | `Research Map`                  | 保留已搜索/阅读的文件、符号和代码路径  |
| `general_summary`      | `General Context`               | 保留普通上下文和用户偏好               |

Active task：

```json
{
  "present": true,
  "kind": "debug|implement|refactor|review|research|plan|mixed",
  "window_turns": 4,
  "reason": "short reason"
}
```

`window_turns` 是给 summary prompt 的活动任务窗口提示，不等同于原始轮次保留。原始保留由 `compaction.tail_turns` 或 `/compact keep N` 控制。

日志：

```bash
tail -f ~/.local/share/openchinacode/log/openchinacode.log | grep --line-buffered "compaction profile"
```

日志里 `compaction profile judge` 表示 judge 调用结果；`compaction profile` 的 `source` 为 `llm` 表示使用 judge 输出，为 `heuristic` 表示 fallback。

相关测试：

```text
packages/opencode/test/session/compaction-profile.test.ts
packages/opencode/test/session/compaction.test.ts
```

## LSP

LSP runtime：

- `packages/opencode/src/lsp/lsp.ts`
- `packages/opencode/src/lsp/server.ts`
- `packages/opencode/src/tool/lsp.ts`

工具集成：

- `packages/opencode/src/tool/read.ts`
- `packages/opencode/src/tool/edit.ts`
- `packages/opencode/src/tool/write.ts`
- `packages/opencode/src/tool/apply_patch.ts`

TUI 状态：

- `packages/tui/src/feature-plugins/sidebar/lsp.tsx`
- `packages/tui/src/component/dialog-status.tsx`

作用：

- 读文件时后台 warm up 对应语言服务器。
- 修改文件后收集 diagnostics，并把相关错误追加到工具结果中，模型可以据此继续修复。
- LSP server 是外部进程。OpenChinaCode 包含 runtime、server 描述和部分安装/启动逻辑，但不代表所有语言服务器都已随源码自带。

## Branding / TUI

入口：

- `packages/tui/src/logo.ts`
- `packages/tui/src/component/logo.tsx`
- `packages/tui/src/context/theme.tsx`
- `packages/opencode/src/cli/cmd/run/splash.ts`

当前定制：

- 默认主题：`synthwave84`
- 启动和首页 logo：`OPENCHINACODE`
- `CHINA` 部分使用粉色。
- 版本显示为 `openchinacode: <version>`。
- terminal title 为 `OpenChinaCode`。

## 常用调试

版本：

```bash
openchinacode --version
```

日志：

```bash
tail -f ~/.local/share/openchinacode/log/openchinacode.log
```

看 subagent 路由：

```bash
tail -f ~/.local/share/openchinacode/log/openchinacode.log | grep --line-buffered "subagent route"
```

看 auto max tokens：

```bash
tail -f ~/.local/share/openchinacode/log/openchinacode.log | grep --line-buffered "auto-maxtokens\\|output budget"
```

看 LSP：

```bash
tail -f ~/.local/share/openchinacode/log/openchinacode.log | grep --line-buffered "LSP\\|lsp"
```

## 常用测试

Task policy：

```bash
cd ~/Projects/OpenChinaCode/packages/opencode
bun test test/session/task-policy.test.ts
bun test test/tool/task.test.ts
```

Compaction：

```bash
cd ~/Projects/OpenChinaCode/packages/opencode
bun test test/session/compaction.test.ts
```

Prompt / build 自动实施路由：

```bash
cd ~/Projects/OpenChinaCode/packages/opencode
bun test test/session/prompt.test.ts -t "auto-route|implementation classifier"
```

Typecheck：

```bash
cd ~/Projects/OpenChinaCode/packages/core && bun run typecheck
cd ~/Projects/OpenChinaCode/packages/tui && bun run typecheck
cd ~/Projects/OpenChinaCode/packages/opencode && bun run typecheck
```

构建安装：

```bash
cd ~/Projects/OpenChinaCode/packages/opencode
bun run build
install -m 0755 dist/openchinacode-linux-x64/bin/openchinacode ~/.local/bin/openchinacode
openchinacode --version
```

一键安装 / release 链路：

```bash
# 用户安装入口
curl -fsSL https://openchinacode.muffin-labs.com/install | bash

# 备用 raw 安装入口
curl -fsSL https://raw.githubusercontent.com/krisshen2021/openchinacode/main/install | bash

# 升级到 latest release
openchinacode upgrade

# 升级到指定版本
openchinacode upgrade 0.1.3

# 本地验证 installer，不依赖 GitHub Release
./install --binary packages/opencode/dist/openchinacode-linux-x64/bin/openchinacode --install-dir /tmp/occ-bin --no-modify-path

# 本地打包当前平台 release 资产
cd ~/Projects/OpenChinaCode/packages/opencode
bun run build --single --archive

# 本地验证全平台 release 资产打包，不上传
OPENCODE_VERSION=0.1.0 OPENCODE_CHANNEL=latest bun run build --archive

# 触发 GitHub release workflow
cd ~/Projects/OpenChinaCode
script/release 0.1.3
```

GitHub Release 资产命名必须和 `install` 中的 target 映射保持一致，例如 `openchinacode-linux-x64.tar.gz`、`openchinacode-darwin-arm64.zip`、`openchinacode-windows-x64.zip`。`openchinacode upgrade` 通过 `packages/opencode/src/installation/index.ts` 读取 `krisshen2021/openchinacode/releases/latest`，curl 安装方式会调用 `https://openchinacode.muffin-labs.com/install`。

## 后续维护原则

- 优先保持三家 provider 的主力模型高质量，而不是扩大 provider 数量。
- 参数优化应优先基于官方文档和实测，不为单次异常过度拟合。
- 路由失败要先看 TUI subagent footer 和日志中的 `source`、`kind.complexity`、`model#variant`。
- 新增配置字段时直接使用 OpenChinaCode 新 schema，不保留 opencode fork 早期内部字段兼容。
- 新增 slash command 时同步更新 `manual.md` 和本文，并放入 Ctrl+P 的 `OpenChinaCode` 分类。
