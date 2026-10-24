# Question 编辑态生命周期修复设计

## 背景

TesserActorWeb 的 question 选择界面再次出现键盘失效。SIGUSR2 转储显示 `mode=question`，但只剩全局按键，且没有聚焦编辑器。日志同时出现 `EditBuffer is destroyed`。

已确认的真实触发路径：

1. 在最后一题进入自定义答案编辑态。
2. 用鼠标点击普通选项。
3. `pick()` 自动进入 Confirm，但没有清除 `editing`。
4. Confirm 卸载答题区和 textarea，局部变量仍保存已销毁的 textarea 引用。
5. 再点击任意问题页签时，`selectTab()` 看到残留的 `editing=true`，调用 `commitEdit()` 读取旧 textarea，触发 `EditBuffer is destroyed`。

进入 Confirm 后，编辑键层和普通键层也同时失效，因此只剩鼠标和全局键。

## 目标

- 阻止上述状态组合产生，而不是仅吞掉异常。
- 保留上次已完成的“编辑中直接点击 Confirm 会先提交自定义答案”的行为。
- 用离线 UI 回归测试覆盖这条真实鼠标路径。
- 不调用 LLM，不读取或修改生产数据库。

## 方案

在 `pick()` 完成普通答案或已提交自定义答案的选择时，同时退出编辑态。这样进入 Confirm 或其他题时，`editing` 不会残留，后续的 `selectTab()` 也不会读取已经卸载的 textarea。

保留现有 `selectTab()` 中的 `commitEdit()`：它负责用户仍在编辑时直接点击页签的情况。

不采用仅检查 `textarea.isDestroyed` 的防御方案，因为那只能避免异常，不能修正答案状态和按键层失效。

本阶段不建设通用长 session 事件回放或随机压力测试框架；先用确定性测试覆盖已经定位的两条路径，再决定是否需要更大的测试设施。

## 测试

扩展 `packages/tui/test/routes/question-prompt.test.tsx`，复用现有 `testRender`、临时 KV、内存 SDK fetch、`mockInput` 和 `mockMouse`：

1. 渲染两道题并切到最后一题。
2. 进入自定义答案编辑态并输入草稿。
3. 点击该题普通选项，确认进入 Confirm 且旧 textarea 已销毁。
4. 再点击一个问题页签。
5. 验证没有 `stdin-parser-error` / `EditBuffer is destroyed`，答案状态正确，页签和键盘操作仍然有效。

先确认新测试在当前实现上按预期失败，再做最小修复并验证测试转绿。随后运行相关 question/keymap/data 测试、TUI typecheck，并重建正式二进制。

## 非目标

- 不改变问题内容、答案协议或服务端 question 生命周期。
- 不重构 OpenTUI 或 keymap。
- 不处理与这条路径无关的长 session 性能问题。
