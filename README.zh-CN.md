# OpenChinaCode

[English](./README.md) | [简体中文](./README.zh-CN.md)

OpenChinaCode 是基于 [opencode](https://github.com/anomalyco/opencode) 深度定制的 CLI/TUI 编程助手，重点面向 GLM、Kimi 和 DeepSeek 三类模型。

这个项目的出发点很直接：中国主力 LLM provider 在真实编程任务中的行为差异很大。OpenChinaCode 保留 opencode 的终端编程体验，但围绕中国模型重新调整了 provider 选择、模型参数、任务路由、上下文压缩、测试工具和可观测性。

## 致谢

OpenChinaCode 建立在 opencode 项目和其维护者工作的基础上。opencode 提供了核心的终端 coding-agent 架构、工具系统、会话模型和开发体验，这些都是本 fork 能成立的基础。

本仓库不是 opencode 官方项目，也不由 opencode 团队维护、背书或发布。通用 opencode 的使用、问题反馈和上游贡献，仍应以 opencode 官方仓库为准。

## 项目目标

- 只保留编程所需的 CLI/TUI 工作流。
- 使用 `openchinacode` 作为命令名，避免和系统里的 `opencode` 冲突。
- 重点优化三类 provider：
  - GLM / 智谱：`zhipuai-pay2go`
  - Kimi / Moonshot：`moonshotai-cn`
  - DeepSeek：`deepseek`
- 优先使用官方直连 API，不以代理 provider 为默认路径。
- 让模型路由、token 预算、上下文压缩、测试流程和费用显示都足够透明，方便调试。

## 主要变化

OpenChinaCode 不是只改了名字和主题的 fork。当前版本已经包含：

- 第一方 `openchinacode` CLI 命令和品牌化 TUI。
- 默认 provider 收敛为 GLM、Kimi、DeepSeek。
- 面向中国模型的请求转换：reasoning、采样参数、max tokens、tool calling 行为。
- 带 `/auto-maxtokens` 控制入口的滑动 max-token 策略。
- 人民币价格显示和按模型上下文窗口计算的 context 使用率。
- 按任务类型和复杂度进行 subagent 模型路由。
- 接入 task policy 的智能 compaction，包含活动任务精提取和调试输出。
- LSP 开关命令，用于代码诊断。
- 内置 Playwright MCP 启动器和测试命令。
- 截图、布局、视觉检查路由到 GLM-5V。

完整功能手册见 [readme.md](./readme.md)。

架构说明、维护入口、配置字段和测试命令见 [tech.md](./tech.md)。

## 从源码安装

当前仓库以源码构建为主。在仓库根目录执行：

```bash
bun install
bun run --cwd packages/opencode build --single
```

Linux 下生成的二进制通常位于：

```text
packages/opencode/dist/openchinacode-linux-x64/bin/openchinacode
```

安装到你的 `PATH` 中，例如：

```bash
install -m 755 packages/opencode/dist/openchinacode-linux-x64/bin/openchinacode ~/.local/bin/openchinacode
```

启动：

```bash
openchinacode
```

## 配置路径

OpenChinaCode 使用独立的配置和数据目录：

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

API key 应放在本地 auth/config 文件中，不要提交到仓库。

## 定制 Slash Commands

OpenChinaCode 定制命令会统一出现在 TUI command palette 的 `OpenChinaCode` 分类下。

| 命令                | 作用                                                        |
| ------------------- | ----------------------------------------------------------- |
| `/auto-maxtokens`   | 查看或修改自动输出 token 预算策略                           |
| `/compact`          | 执行智能压缩；`/compact keep N` 可额外保留最近 N 个原始轮次 |
| `/lsp`              | 查看或切换 LSP 诊断                                         |
| `/task-policy`      | 查看当前任务路由策略                                        |
| `/task-classify`    | 按路由策略分析任务描述                                      |
| `/test-mcp`         | 在 TUI 内配置内置 Playwright MCP                            |
| `/browser-check`    | 让 agent 执行浏览器层检查                                   |
| `/integration-test` | 让 agent 创建或执行集成测试计划                             |

具体用法见 [readme.md](./readme.md)。

## 模型路由

OpenChinaCode 会按任务类型和复杂度路由 subagent。示例：

| 任务类型       | Quick               | Medium              | Complex         |
| -------------- | ------------------- | ------------------- | --------------- |
| `plan`         | GLM-5.2 high        | GLM-5.2 high        | GLM-5.2 max     |
| `refactor`     | GLM-5.2 high        | GLM-5.2 high        | GLM-5.2 max     |
| `review`       | Kimi K2.7 highspeed | Kimi K2.7 highspeed | GLM-5.2 high    |
| `implement`    | Kimi K2.7 highspeed | Kimi K2.7 highspeed | GLM-5.2 high    |
| `debug`        | DeepSeek V4 Pro     | DeepSeek V4 Pro     | DeepSeek V4 Pro |
| `visual_check` | GLM-5V Turbo        | GLM-5V Turbo        | GLM-5V Turbo    |
| `compaction`   | GLM-5.2 high        | GLM-5.2 high        | GLM-5.2 high    |

这套路由策略是有明确取舍的默认值。需要时，用户可以通过配置覆盖。

## 开发

依赖：

- Bun 1.3+
- Git

常用命令：

```bash
bun install
bun run typecheck
bun test
bun run --cwd packages/opencode build --single
```

这个 fork 里最常用的局部检查：

```bash
bun test --cwd packages/opencode
bun test --cwd packages/llm
bun run --cwd packages/opencode typecheck
bun run --cwd packages/llm typecheck
```

## 状态

OpenChinaCode 是一个实验性、快速迭代的 fork。只要能让面向 GLM/Kimi/DeepSeek 的 CLI 更简单、更稳定、更容易调试，破坏式变更是可以接受的。

如果你需要通用 opencode 产品，请使用上游 opencode。如果你想要面向 GLM/Kimi/DeepSeek 的编程 agent 实验场，可以使用 OpenChinaCode。
