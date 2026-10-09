# Steer（插队）功能设计

日期：2026-10-09
状态：已获用户批准（方案 A + C 附属，交互选"先回车排队、再 Ctrl+S 催生"）

## 背景与目标

用户在 agent 运行中发送的补充/纠正消息，目前只能等当前 turn 的 step 边界被循环自然认领。当模型处于长时间纯文本/思考流中时，排队消息要等整段流吐完才生效，浪费时间与 token。

目标：用户回车排队消息后，可按 Ctrl+S 主动"催生"——在最近的**安全截断点**掐断当前 LLM 流，让下一次模型请求立刻带上排队消息。

铁律（与 Codex/OpenClaw 一致）：**绝不打断正在执行的工具**。只允许在"无工具在飞"的点位截断。

## 交互设计

- **回车**：行为不变。消息立即落库，TUI 显示 `QUEUED` 角标。
- **Ctrl+S**（新键位 `session_steer`）：把已排队消息尽快生效。
  - 有排队消息且 session 忙 → 调 `POST /session/:id/steer`，排队消息角标变为 `STEER`（表示"已催，将在最近可打断点生效"）。
  - 无排队消息或 session 空闲 → toast 提示，不发请求。
- 支持先排多条、一次性 Ctrl+S 全部催生；可先用 `<leader>q` 撤回某条再 steer 剩余。

## Server 设计

### API

新增端点 `POST /session/:sessionID/steer`，无请求体，返回 204。处理器只做一件事：`SessionSteer.publish(sessionID)`。属公开 HttpApi 变更，实现后须运行根目录 `script/generate.ts` 重新生成 SDK（不手改 `packages/sdk/js/src/v2/gen`）。

### SessionSteer 服务

新增轻量服务（per-instance PubSub，按 sessionID 投递）。无订阅者时 publish 自然空转——session 空闲时 steer 退化为无操作，排队消息走原有边界认领路径。

### runLoop 接线

`packages/opencode/src/session/prompt.ts` 的 `runLoop` 每个 step 创建 processor 后，fork 一个 step 作用域的 watcher：收到该 session 的 steer 信号 → 调 `processor.handle.steer()`。只在普通 LLM step 订阅；compaction、subtask、标题生成期间不订阅（消息按普通排队处理）。信号幂等：连续多次 Ctrl+S 效果等同一次。

### Processor 掐流点

`packages/opencode/src/session/processor.ts`：

- `ProcessorContext` 新增 `needsSteer: boolean`（初值 false）；`Handle` 新增 `steer()` 方法，仅置位。
- 在 `process()` 的流管道中、`Stream.tap(handleEvent)` **之前**插入：

  ```ts
  Stream.takeUntil(() => ctx.needsSteer && Object.keys(ctx.toolcalls).length === 0)
  ```

  谓词语义：
  - 纯文本/思考流（toolcalls 恒空）→ 立即截断。
  - 工具执行中或工具输入 JSON 流了一半（toolcalls 非空）→ 不截，等 settle。
  - 工具之间（上一工具已 settle、下一 tool-input 事件刚到）→ 因 takeUntil 在 tap 之前判定，tool part 尚未落库即被截断，干净切在工具边界，不产生半截 tool_use。

### 截断后收尾（复用现有机制）

- 走现有 `cleanup()`：当前文本 part 封口保留（方案 A：残段进入后续上下文）、reasoning part 封口、未 settle 工具 part 标 `interrupted`（被 `isOrphanedInterruptedTool` 自动过滤出后续上下文）、`time.completed` 落库。
- assistant 消息**不打 error 标记**，与 ESC 的 abort 区分；`metadata.steered = true`；`finish` 保持未收到 finish 事件时的原状（不伪造）。
- `process()` 返回 `"continue"`：runLoop 下一轮重读消息，发现排队 user 消息 → 不退出 → 下一次请求同时带上"assistant 残段 + 用户新消息"。循环主逻辑零改动。
- reasoning 残段保留在 DB 供 TUI 展示，但不进后续模型上下文（半截 thinking 发给 provider 会 400；模型上下文只含文本 part）。

### 待验证点（实现期第一项）

`Stream.takeUntil` 结束消费时，`llm.stream` 上游 finalizer 是否会级联中止 provider 的 HTTP 请求。若不会，在 `process()` 内为每次流加显式 AbortController，截断时主动 abort。

## TUI 设计

- `packages/tui/src/config/keybind.ts` 新增 `session_steer: keybind("ctrl+s", "Steer: deliver queued messages now")`。
- `packages/tui/src/component/prompt/index.tsx`（或会话路由的键绑定处）：
  - 判定条件：session 忙（pending 非空）且存在 queued 消息（复用现有 `message.id > pending` 判定）。
  - 满足 → `sdk.client.session.steer({ sessionID })`；被催生的消息角标由 `QUEUED` 切换为 `STEER`，直到下一条 assistant 消息完成。
  - 不满足 → toast 提示，不发请求。
- `QUEUED` 角标补一句提示文案（hover/title 或状态栏），说明排队消息将在当前 step 边界生效（方案 C 附属）。

## 错误处理

| 场景 | 行为 |
| --- | --- |
| steer 时无活跃 run | publish 空转，消息按普通排队处理 |
| steer 时处于工具执行中 | 等待工具边界截断 |
| steer 时处于 compaction/subtask/title | 不订阅，按普通排队处理 |
| 连续多次 Ctrl+S | 幂等 |
| 掐流后 provider 请求未取消 | 显式 AbortController 兜底（见待验证点） |
| 半截 tool_use | takeUntil 在 tap 前判定，不产生；极端残留按 orphan-interrupted 过滤 |

## 测试

1. **processor 单测**：假流（连续 text-delta），中途置 `needsSteer` → 断言流截断、文本保留、无 error 标记、返回 "continue"。
2. **工具边界单测**：假流含工具执行，工具执行中置 `needsSteer` → 断言工具完成后才截断、无半截 tool part、已完成工具结果保留。
3. **session 集成测试**：假 provider 长流 + 排队消息 + steer 信号 → 断言下一次 LLM 请求包含该用户消息与保留的 assistant 残段；未 steer 的对照组维持现状行为。
4. **TUI 手动冒烟** + 出测试二进制（带独立 DB 参数）实测。

## 非目标（YAGNI）

- 不改回车语义（不做"Enter = steer"配置项）。
- 不做 collect/debounce 等排队模式。
- 不做 mid-stream 注入 provider 级协议（如 Anthropic 原生中断续写）。
