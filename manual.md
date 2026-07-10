# OpenChinaCode 定制版说明

OpenChinaCode 是基于 opencode 源码分支改造的本地 CLI/TUI 编程助手，目标是针对中国主力模型进行精简、稳定、强壮的深度优化。

技术实现、维护入口、测试命令见 [`tech.md`](./tech.md)。

当前重点支持三类 provider：

- GLM / 智谱：`zhipuai-pay2go`
- Kimi / Moonshot：`moonshotai-cn`
- DeepSeek：`deepseek`

命令名已改为：

```bash
openchinacode
```

不会和系统里已有的 `opencode` 冲突。

## 安装与升级

安装最新 GitHub Release：

```bash
curl -fsSL https://openchinacode.muffin-labs.com/install | bash
```

安装指定版本：

```bash
curl -fsSL https://openchinacode.muffin-labs.com/install | bash -s -- --version 0.1.2
```

安装脚本会从 `krisshen2021/openchinacode` 的 GitHub Releases 下载匹配当前系统的二进制，默认安装到：

```text
~/.local/bin/openchinacode
```

已安装用户可以在 TUI 提示或命令行中使用：

```bash
openchinacode upgrade
openchinacode upgrade 0.1.2
```

`openchinacode upgrade` 默认读取 GitHub latest release，并复用同一套安装脚本 / release 资产。备用 raw 安装入口：

```bash
curl -fsSL https://raw.githubusercontent.com/krisshen2021/openchinacode/main/install | bash
```

## 主要定制功能

### 1. Provider 精简

OpenChinaCode 的默认 provider 目标是只保留 GLM、Kimi、DeepSeek 三家。

已完成的方向：

- 移除/隐藏不需要的代理类 provider，例如 OpenRouter。
- 减少重复 provider，例如 Kimi、Z.AI、Zhipu AI 的多套冗余命名。
- 将 OpenChinaCode 的默认模型策略集中到三家中国模型上。

敏感信息不写入本文档。API key 仍应放在本机 auth/config 文件中。

### 2. CLI/TUI 品牌化

- 二进制命令：`openchinacode`
- 启动 logo：`OPENCHINACODE`
- 默认 TUI 主题：`synthwave84`
- 版本显示：`openchinacode: 0.0.0-openchinacode...`
- TUI 中可直接看到 subagent 使用的模型路由信息。

### 3. 人民币费用显示

OpenChinaCode 已将三家 provider 的价格固定到模型配置中，用于：

- 右侧面板 `spent`
- 底部费用显示
- session usage 统计

费用按模型元数据中的输入/输出/cache 价格计算，显示为人民币。

### 4. 真实上下文使用率

右侧面板中的 context 使用率按当前模型上下文窗口计算。

例如不同模型切换时：

- GLM 5.2 Max
- GLM 5V Turbo
- Kimi K2.7
- DeepSeek V4 Pro / Flash

会使用对应模型的 `context` limit 计算百分比，而不是固定上游默认值。

### 5. Max Tokens 滑动策略

OpenChinaCode 对输出 token 做了模型感知优化：

- 简单任务使用较低输出预算，降低浪费。
- 复杂实现、复杂审查、架构任务自动提高输出预算。
- 上下文接近溢出时，会根据可用上下文降级输出预算，避免强行触发 overflow。
- 支持 `/auto-maxtokens` 控制策略。

这部分是当前模型效率优化的核心之一。

### 6. Subagent 任务路由

主 agent delegate 到 subagent 时，会先做任务分配：

- `kind`：任务类型
- `complexity`：复杂度，`quick` / `medium` / `complex`

然后按路由表选择模型。

TUI 中会显示类似：

```text
Explore Task - Thorough project code review
↳ zhipuai-pay2go/glm-5.2#high · review.complex · openchinacode.default
↳ Bash python -m pytest tests/ -v 2>&1 | head -80
```

日志也会记录：

```bash
tail -f ~/.local/share/openchinacode/log/openchinacode.log | grep --line-buffered "subagent route"
```

### 7. Compaction 路由优化

上下文压缩不再简单继承当前模型，而是接入同一套 task policy。

默认：

```text
compaction.* -> zhipuai-pay2go/glm-5.2#high
```

这样压缩摘要更偏向保留后续编程所需的结构化上下文。

同时，compaction prompt 已加入 OpenChinaCode 的 profile 判断层。压缩发生时会先用 judge 模型根据当前上下文生成稳定 profile JSON，再拼出对应的 Markdown 分区模板，避免所有任务都被压成同一种摘要。

当前压缩采用三层策略：

```text
1. General Compaction Summary
2. Active Task Essential Extraction
3. Minimal Raw Recent Tail
```

默认 `/compact` 使用智能策略；`/compact keep N` 是手动 override，会额外保留最近 N 个原始用户轮次及其后续 assistant/tool 消息。TUI 的 Smart Compaction 面板会显示 `strategy`、`retention`、`active-task`、`selection` 等调试阶段。

当前 profile 类型：

| Profile                | 重点保留                       |
| ---------------------- | ------------------------------ |
| `debug_trace`          | 报错、失败命令、诊断、排查假设 |
| `implementation_state` | 已改文件、未完成实现、验证结果 |
| `architecture_memory`  | 架构决策、技术栈、迁移约束     |
| `review_findings`      | 审查发现、风险、证据位置       |
| `tool_research`        | 已读文件、代码路径、搜索结果   |
| `general_summary`      | 用户偏好、长期约束、普通上下文 |

默认 judge 候选优先级：

```text
当前 compaction 路由选中的模型
moonshotai-cn/kimi-k2.7-code-highspeed
deepseek/deepseek-v4-flash
当前 provider 的 small model
```

默认情况下，当前 compaction 模型就是 `zhipuai-pay2go/glm-5.2#high`。compaction 不是高频动作，但摘要质量会直接影响后续开发，所以 profile judge 优先使用这个主压缩模型。judge 只接收截断后的判断上下文，不会把完整超大历史再喂给模型。judge 输出必须是合法 JSON，并经过 schema normalize；超时、模型不可用、JSON 无效时会自动 fallback 到本地 heuristic。

### 8. LSP 开关

增加了 TUI slash command：

```text
/lsp
```

可用于查看或切换 LSP。LSP 打开后，模型在改代码时可以看到语言服务器诊断，帮助它修复类型错误、语法错误、引用错误等。

### 9. 粘贴图片视觉预处理

在 TUI 输入框里 Ctrl+V 粘贴图片后，OpenChinaCode 会先把图片保存到本地临时目录，并自动调用 GLM-5V 做视觉识别。识别结果会作为上下文喂给当前主模型。

这意味着你可以直接：

```text
[Ctrl+V 粘贴网页截图]
看看这张截图，按钮状态哪里不对
```

运行时会先出现一个视觉预处理 subtask：

```text
General Task - Pasted image visual preprocessing
↳ zhipuai-pay2go/glm-5v-turbo
```

然后主模型会基于 GLM-5V 的观察继续分析、改代码或给方案。这样即使当前主模型是 DeepSeek / GLM-5.2 / 其它非视觉模型，也能稳定理解截图内容。

粘贴图片保存位置：

```text
/tmp/openchinacode/attachments
```

默认不会因为粘贴图片再去 Playwright 重新截当前页面；只有当你明确要求检查 live browser / 当前浏览器状态时，才应该走 Playwright MCP。

Slash command 暂不走这个自动预处理，避免影响 `/image-generate`、`/video-generate` 使用粘贴图片作为参考素材。

### 10. 原生生图 / 生视频

OpenChinaCode 新增了原生媒体生成工具：

- `image_generate`：火山方舟 Seedream 5 Pro
- `video_generate`：火山方舟 Seedance 2.0 Mini
- `video_status`：查询并下载 Seedance 任务结果

自然语言触发时，模型会优先使用这些工具。参数不明确时，会先用 TUI question 追问用户，而不是随意猜关键参数。

Slash command 入口：

```text
/media-auth
/image-generate
/video-generate
```

生成文件会立即下载到本机临时目录：

```text
/tmp/openchinacode/media/images
/tmp/openchinacode/media/videos
```

每次成功调用都会返回 `output_path` 和 `metadata_path`。

## 当前内置任务路由表

优先级：

```text
explicit task model
> subagent model
> task_policy agent route
> task_policy global route
> model task_classes tag
> OpenChinaCode builtin route
> parent model fallback
```

内置默认策略：

| Task kind      | quick                                    | medium                                   | complex                       |
| -------------- | ---------------------------------------- | ---------------------------------------- | ----------------------------- |
| `general`      | 继承父模型                               | 继承父模型                               | 继承父模型                    |
| `plan`         | `zhipuai-pay2go/glm-5.2#high`            | `zhipuai-pay2go/glm-5.2#high`            | `zhipuai-pay2go/glm-5.2#max`  |
| `architecture` | `zhipuai-pay2go/glm-5.2#high`            | `zhipuai-pay2go/glm-5.2#high`            | `zhipuai-pay2go/glm-5.2#max`  |
| `refactor`     | `zhipuai-pay2go/glm-5.2#high`            | `zhipuai-pay2go/glm-5.2#high`            | `zhipuai-pay2go/glm-5.2#max`  |
| `review`       | `moonshotai-cn/kimi-k2.7-code-highspeed` | `moonshotai-cn/kimi-k2.7-code-highspeed` | `zhipuai-pay2go/glm-5.2#high` |
| `implement`    | `moonshotai-cn/kimi-k2.7-code-highspeed` | `moonshotai-cn/kimi-k2.7-code-highspeed` | `zhipuai-pay2go/glm-5.2#high` |
| `explore`      | `moonshotai-cn/kimi-k2.7-code-highspeed` | `zhipuai-pay2go/glm-5.2#high`            | `zhipuai-pay2go/glm-5.2#max`  |
| `visual_check` | `zhipuai-pay2go/glm-5v-turbo`            | `zhipuai-pay2go/glm-5v-turbo`            | `zhipuai-pay2go/glm-5v-turbo` |
| `debug`        | `deepseek/deepseek-v4-pro`               | `deepseek/deepseek-v4-pro`               | `deepseek/deepseek-v4-pro`    |
| `test_fix`     | `deepseek/deepseek-v4-pro`               | `deepseek/deepseek-v4-pro`               | `deepseek/deepseek-v4-pro`    |
| `summarize`    | `moonshotai-cn/kimi-k2.7-code-highspeed` | `moonshotai-cn/kimi-k2.7-code-highspeed` | `zhipuai-pay2go/glm-5.2#high` |
| `compaction`   | `zhipuai-pay2go/glm-5.2#high`            | `zhipuai-pay2go/glm-5.2#high`            | `zhipuai-pay2go/glm-5.2#high` |

## 定制 Slash Commands

这些是 OpenChinaCode 定制开发过程中新增或强化的命令。

### `/auto-maxtokens`

控制输出 token 预算策略。

```text
/auto-maxtokens
/auto-maxtokens status
/auto-maxtokens off
/auto-maxtokens heuristic
/auto-maxtokens llm
/auto-maxtokens llm deepseek/deepseek-v4-flash
/auto-maxtokens model deepseek/deepseek-v4-flash
```

含义：

| 命令                                   | 作用                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `/auto-maxtokens`                      | 查看当前策略                                                                                 |
| `/auto-maxtokens status`               | 查看当前策略                                                                                 |
| `/auto-maxtokens off`                  | 关闭自动输出预算，尽量使用模型/provider 默认值                                               |
| `/auto-maxtokens heuristic`            | 使用本地启发式判断，不调用额外 judge 模型                                                    |
| `/auto-maxtokens llm`                  | 开启 LLM 判断，模糊场景用 judge 模型决定输出档位；默认 judge 是 `deepseek/deepseek-v4-flash` |
| `/auto-maxtokens llm provider/model`   | 开启 LLM 判断并指定 judge 模型                                                               |
| `/auto-maxtokens model provider/model` | 修改 judge 模型，并保持 LLM 判断模式                                                         |

推荐日常设置：

```text
/auto-maxtokens heuristic
```

如果希望更激进地自动判断复杂度：

```text
/auto-maxtokens llm deepseek/deepseek-v4-flash
```

### `/compact`

执行智能压缩。

```text
/compact
/compact keep 3
/compact keep auto
/summarize
/summarize keep 3
```

含义：

| 命令                 | 作用                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `/compact`           | 使用三层智能压缩：general summary、active task essential extraction、minimal raw recent tail |
| `/compact keep N`    | 在智能压缩之外，额外保留最近 N 个原始用户轮次                                                |
| `/compact keep auto` | 回到默认智能策略                                                                             |
| `/summarize`         | `/compact` 的别名                                                                            |

### `/lsp`

查看或修改 LSP 开关。

```text
/lsp
/lsp status
/lsp on
/lsp off
```

含义：

| 命令          | 作用                   |
| ------------- | ---------------------- |
| `/lsp`        | 查看当前 LSP 状态      |
| `/lsp status` | 查看当前 LSP 状态      |
| `/lsp on`     | 写入配置，启用内置 LSP |
| `/lsp off`    | 写入配置，关闭 LSP     |

修改后通常需要重启 OpenChinaCode。

### `/test-mcp`

查看或修改 Playwright MCP 开关。这个命令是给新用户准备的 TUI 内置入口，不需要退出 openchinacode 去敲命令行。

```text
/test-mcp
/test-mcp status
/test-mcp on
/test-mcp off
/test-mcp toggle
/test-mcp headless
/test-mcp headed
```

含义：

| 命令                 | 作用                                                 |
| -------------------- | ---------------------------------------------------- |
| `/test-mcp`          | 查看当前 Playwright MCP 配置状态                     |
| `/test-mcp status`   | 查看当前 Playwright MCP 配置状态                     |
| `/test-mcp on`       | 写入全局配置，立即连接 Playwright MCP，默认 headless |
| `/test-mcp off`      | 写入全局配置，立即断开 Playwright MCP                |
| `/test-mcp toggle`   | 在启用/关闭之间切换                                  |
| `/test-mcp headless` | 启用 Playwright MCP，并使用无头浏览器                |
| `/test-mcp headed`   | 启用 Playwright MCP，并使用可见浏览器窗口            |

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

`/test-mcp on/headless/headed` 会写入配置并立即 hot-connect；`/test-mcp off` 会写入 disabled 并立即 disconnect。通常不需要重启。
默认浏览器是系统 Google Chrome。执行 `/test-mcp on/headless/headed` 时会先做 Chrome 预检；如果没有安装，会直接提示安装方法，不会写入启用配置，也不会等开发任务跑到浏览器工具调用时才失败。
内置 Playwright MCP 默认启用官方 `config/network/storage/testing/pdf/vision` 能力，因此模型可以看到官方的 screenshot、snapshot、evaluate 等工具，但默认不暴露 devtools 录屏工具。对于“是否在转、是否在动、动画是否生效”这类问题，OpenChinaCode 要求模型优先用 `getAnimations()`、computed transform 或裁剪区域像素差做确定性判断；截图和 `visual_check` 只用于理解用户可见外观。浏览器录屏默认不作为模型输入路径，除非用户明确要求生成视频证据。

Playwright MCP 产物默认写入系统临时目录，避免截图、snapshot、console log 被丢到项目根目录：

```text
/tmp/openchinacode-playwright
```

如果模型给 screenshot / snapshot / PDF 等工具传了 `filename`，OpenChinaCode 会把相对文件名安全改写到这个目录下；需要自定义时可在 MCP 命令里显式传 `--output-dir`。

### 粘贴图片视觉预处理

普通自然语言输入只要包含 Ctrl+V 粘贴的图片，OpenChinaCode 会自动先用 GLM-5V 做一次视觉预处理，再把识别结果交给当前主模型。

使用方式：

```text
[Ctrl+V 粘贴图片]
看看这张截图哪里有问题
```

内部行为：

- 剪贴板图片会保存到 `/tmp/openchinacode/attachments`
- 先运行 `zhipuai-pay2go/glm-5v-turbo`
- GLM-5V 会输出图片内容、相关 UI/布局/颜色/状态判断、OCR 和不确定点
- 当前主模型随后基于“原始 prompt + GLM-5V 视觉结论 + 图片路径”继续处理

这条链路不依赖关键词触发；只要普通 prompt 里有粘贴图片就会先视觉预处理。Slash command 暂不启用该自动预处理，避免影响媒体生成命令把图片作为参考素材。

### `/media-auth`

保存火山方舟 API key，供 `image_generate`、`video_generate`、`video_status` 使用。

```text
/media-auth
/media-auth <ARK_API_KEY>
```

保存位置：

```text
~/.local/share/openchinacode/auth.json
```

provider id：

```text
volcengine-ark
```

也可以使用环境变量兜底：

```bash
export ARK_API_KEY="your-volcengine-ark-api-key"
```

### `/image-generate`

打开 Seedream 5 Pro 生图向导。支持无参数 wizard，也支持把 slash 后面的文字作为初始 prompt。

```text
/image-generate
/image-generate 一只赛博朋克猫 mascot，粉色霓虹，干净矢量风
```

向导会询问：

- prompt
- aspect ratio：`1:1`、`16:9`、`9:16`、`4:3`、`3:4`、`3:2`、`2:3`、`21:9`
- size：`1K`、`2K`，或符合 Seedream 5 Pro 限制的 `宽x高` 像素值。`3K/4K` 是 Seedream 5.0 Lite 档位，不适用于 Pro。
- output format：`png`、`jpeg`
- reference images：本地路径、`file://`、HTTP(S) URL 或 `data:image`
- watermark

本地参考图会被读取并转成 `data:image/...;base64,...` 传给方舟；HTTP(S) URL 和已有 `data:image` 会保持原样。

自然语言也可以触发，例如：

```text
帮我生成一张小猫的图
用 ./assets/logo.png 作为参考图，生成 16:9 项目海报
```

如果参考图不存在、参考图数量超过 10 张、或比例不支持，工具会直接报出具体原因。成功后默认保存到：

```text
/tmp/openchinacode/media/images
```

同时会写入同名 metadata JSON。模型回复用户时应该明确给出 `output_path` 和 `metadata_path`。

### `/video-generate`

打开 Seedance 2.0 Mini 生视频向导。支持无参数 wizard，也支持把 slash 后面的文字作为初始 prompt。

```text
/video-generate
/video-generate 一个 5 秒项目宣传短片，镜头缓慢推进，科技感但不浮夸
```

向导会询问：

- prompt
- ratio：`adaptive`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`、`21:9`
- resolution：`720p`、`480p`
- duration：4 到 15 秒的整数
- generate audio
- input mode：普通参考素材、首帧、首尾帧
- reference images：最多 9 张，本地路径、`file://`、HTTP(S) URL 或 `data:image`
- reference video URLs：最多 3 个，URL 或素材 asset id；当前 MVP 不支持本地视频文件直传
- first frame / first + last frame：用于严格首帧或首尾帧控制，不能和普通 reference images / reference videos 混用
- watermark

图生视频时，本地图片会被转成 base64 data URL 上传；参考视频当前只接受公网 URL 或 `asset://...` 素材 ID，不上传本地视频文件。严格首尾帧模式会分别以 `first_frame` / `last_frame` role 发送给 Seedance。

自然语言也可以触发，例如：

```text
给这个页面增加一段项目宣传视频
用 ./screenshots/home.png 做参考图，生成 8 秒 16:9 视频
```

成功后默认保存到：

```text
/tmp/openchinacode/media/videos
```

`video_generate` 默认会轮询任务完成并下载本地文件。如果任务仍在运行，会返回 `task_id`，之后可以让模型调用 `video_status` 查询并下载。

TUI 工具调用行会显示安全摘要，不展示完整路径、URL 或 base64：

```text
⚙image_generate [prompt=..., aspect_ratio=16:9, size=2K, reference_images=1]
⚙video_generate [prompt=..., ratio=9:16, duration=5, first_frame=home.png]
⚙video_generate [prompt=..., reference_images=2, reference_videos=1]
```

其中 `reference_images=N`、`reference_videos=N` 表示数量；`first_frame` / `last_frame` 会显示安全 basename、host/name、`asset://...` 摘要或 `data:image` 类型。

### `/task-policy`

打开本地 TUI policy 面板，直接查看当前 OpenChinaCode 的内置任务路由表。这个命令不调用模型，也不会把 policy 输出写入当前对话上下文。

```text
/task-policy
/task-policy review
/task-policy compaction
```

用法：

```text
/task-policy [focus]
```

示例：

```text
/task-policy review
```

会打开同一张固定策略表，并标记 focus。表中包含 `compaction` 的 quick / medium / complex 路由，以及模型 ID legend 和覆盖优先级。

### `/task-classify`

让模型根据任务内容判断：

- task kind
- complexity
- 默认模型路由
- 关键判断信号

用法：

```text
/task-classify <task>
```

示例：

```text
/task-classify 做一次全量代码审查，找出架构风险和测试缺口
```

预期会输出类似：

```text
kind: review
complexity: complex
default route: zhipuai-pay2go/glm-5.2#high
```

### `/integration-test`

让模型按 OpenChinaCode 标准流程执行前后端联调和 E2E 验证。

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

让模型做浏览器层检查，优先使用 Playwright MCP，其次使用 OpenChinaCode Playwright Test 模板。需要理解截图、页面布局、遮挡、视觉可访问性时，会通过 `visual_check` subtask 路由到 `zhipuai-pay2go/glm-5v-turbo`。

```text
/browser-check
/browser-check http://127.0.0.1:5173
/browser-check 检查设置页交互
```

如果 Playwright MCP 还没有启用，优先在 TUI 中执行：

```text
/test-mcp on
```

连接成功后当前对话就可以使用 Playwright MCP。`openchinacode test mcp` 是同一配置的命令行版本，更适合脚本和 TUI 外部场景。

## 用户配置覆盖

OpenChinaCode 的 task policy 已切换到新 schema，不再兼容旧的 `tasks/default` 形态。

目前不提供 TUI 交互式编辑。策略表比较复杂，建议直接编辑配置文件，便于 review、备份和按项目区分。

全局配置文件：

```text
~/.config/openchinacode/openchinacode.jsonc
```

项目级配置文件：

```text
./openchinacode.jsonc
./.openchinacode/openchinacode.jsonc
```

全局配置适合个人默认策略；项目级配置适合某个代码库单独覆盖。不要修改 `~/.config/opencode/opencode.json`，那个属于原版 opencode。

示例：

```jsonc
{
  "task_policy": {
    "enabled": true,
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

route key 支持：

- `kind`
- `kind.complexity`

例如：

```text
review
review.complex
implement.medium
compaction
```

配置影响：

- `routes` 是全局 task policy 覆盖，影响所有 subagent 和 compaction。
- `agents` 是按 subagent 名称覆盖，只影响指定 agent。
- `kind.complexity` 比 `kind` 更精确，会优先匹配。
- `inherit: true` 表示继承父模型。
- `enabled: false` 会关闭 OpenChinaCode task policy，回到更接近父模型继承的行为。
- 配置里指定的模型必须存在于当前 provider 列表，否则会跳过该条，继续尝试后续候选。
- 修改后建议重启 OpenChinaCode，确保 TUI 和 session runtime 读取最新配置。

需要注意：`/task-policy` 当前显示的是内置默认策略表，不是合并用户配置后的 effective policy。实际运行时会尊重这里的用户配置，subagent footer 中显示的 `source` 会体现命中的来源，例如 `task_policy.routes`、`task_policy.agent` 或 `openchinacode.default`。

## 常用测试命令

版本：

```bash
openchinacode --version
```

目标测试：

```bash
cd ~/Projects/OpenChinaCode/packages/opencode
bun test test/session/compaction-profile.test.ts
bun test test/session/task-policy.test.ts
bun test test/tool/task.test.ts
bun test test/session/compaction.test.ts
bun run typecheck

cd ~/Projects/OpenChinaCode/packages/tui
bun run typecheck

cd ~/Projects/OpenChinaCode/packages/core
bun run typecheck
```

构建并安装当前机器的二进制：

```bash
cd ~/Projects/OpenChinaCode/packages/opencode
bun run build
install -m 0755 dist/openchinacode-linux-x64/bin/openchinacode ~/.local/bin/openchinacode
openchinacode --version
```

## 调试可观测性

查看 subagent 路由日志：

```bash
tail -f ~/.local/share/openchinacode/log/openchinacode.log | grep --line-buffered "subagent route"
```

查看 compaction profile 日志：

```bash
tail -f ~/.local/share/openchinacode/log/openchinacode.log | grep --line-buffered "compaction profile"
```

TUI 中 task 行也会显示：

```text
↳ provider/model#variant · kind.complexity · source
```

例如：

```text
↳ zhipuai-pay2go/glm-5.2#high · review.complex · openchinacode.default
```

这表示：

- 这次 subagent 使用 GLM 5.2 high
- 任务被判定为 complex review
- 路由来源是 OpenChinaCode 内置默认策略
