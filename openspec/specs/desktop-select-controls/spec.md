# Desktop Select Controls Specification

## Purpose

为 TaskPilot Desktop 的有限集合选择提供一致、可访问且不依赖操作系统原生展开菜单视觉的共享交互基线。

## Requirements

### Requirement: Desktop 选择控件使用一致且完整的交互协议
Desktop 当前需要从有限选项集合中选择单值的字段 SHALL 使用一致的选择控件呈现 trigger、当前值、展开菜单、选项、选中标记、禁用状态和可见焦点。控件 SHALL 支持指针、键盘与辅助技术；打开、浏览、确认或取消 MUST NOT 提交未被用户明确确认的值，关闭后焦点 SHALL 回到其 trigger。

#### Scenario: 指针选择一个选项
- **WHEN** 用户打开选择控件并用指针选择一个可用选项
- **THEN** 菜单关闭、trigger 显示新值、焦点回到 trigger，并且既有字段变更逻辑只收到该选项的稳定 value

#### Scenario: 键盘完成选择
- **WHEN** 用户聚焦 trigger 后使用标准选择控件按键打开菜单、浏览选项并确认
- **THEN** 当前浏览项和已选项可被感知，确认后只提交一次新值且焦点回到 trigger

#### Scenario: 取消选择
- **WHEN** 用户打开菜单后按 Escape 或执行菜单外关闭而未确认新选项
- **THEN** 菜单关闭、原值保持不变且焦点回到 trigger

#### Scenario: Dialog 内分层处理 Escape
- **WHEN** 用户在 Dialog 内打开选择菜单后按一次 Escape
- **THEN** 只有选择菜单关闭，Dialog 保持打开、原值不变且焦点回到 trigger；菜单关闭后再次按 Escape MAY 沿用所属 Dialog 的既有关闭协议

#### Scenario: 禁用选择控件
- **WHEN** 所属操作处于不可编辑或提交中状态
- **THEN** trigger 以可感知的禁用状态呈现，不能打开菜单或改变值

### Requirement: 选择菜单适应窗口、内容和主题
选择菜单 SHALL 使用 TaskPilot 的颜色、排版、圆角、边框和焦点 token，不依赖操作系统原生展开菜单表达选中状态。菜单 SHALL 相对 trigger 定位并避让可视窗口边缘，选项过多时在菜单内部滚动；当前值、长选项和中英文文案 MUST NOT 相互覆盖、突破菜单边界或遮挡表单主要操作。选中、聚焦和禁用状态 MUST NOT 只靠颜色区分。

#### Scenario: 最小窗口内打开菜单
- **WHEN** 用户在最小支持窗口或靠近窗口边缘的字段打开选择菜单
- **THEN** 菜单保持在可视区域内，当前选项和可操作内容可达，页面不会因此产生非预期横向滚动

#### Scenario: 长选项名称
- **WHEN** 当前值或某个选项使用允许范围内的长名称
- **THEN** trigger 与菜单保持稳定布局，文本按控件规则截断或换行且完整名称仍可被辅助技术理解

#### Scenario: 辨识选中项
- **WHEN** 菜单打开并包含当前选中项
- **THEN** 用户能通过选中标记和语义状态识别当前项，而不必只依赖背景颜色

### Requirement: 选择控件尊重动效与弹层边界
选择菜单 SHALL 在当前 Renderer 内呈现，不加载远程资源、不扩大 Preload、IPC 或网络能力。菜单弹层 SHALL 位于所属 Dialog 和应用内容之上，关闭时不破坏 Dialog 的焦点与退出协议；任何装饰性打开或关闭动效 SHALL 尊重 `prefers-reduced-motion`，且控件状态不能依赖动画才能理解。

#### Scenario: Dialog 中选择 Column
- **WHEN** 用户在 Work Item 编辑 Dialog 中打开 Column 选择
- **THEN** 菜单不被 Dialog 容器裁切，选择后仍回到该字段，Dialog 保持打开并沿用既有保存与取消语义

#### Scenario: Work Item 提交期间禁用 Column 选择
- **WHEN** Work Item 编辑请求已经提交且仍在等待结果
- **THEN** Column trigger 以可感知的禁用状态呈现，不能重新打开菜单或改变本次请求的 `targetColumnId`

#### Scenario: reduced-motion
- **WHEN** 操作系统偏好减少动态效果
- **THEN** 菜单移除非必要位移或缩放动画，同时保留焦点、选中标记、边界和打开状态反馈

#### Scenario: 离线使用选择控件
- **WHEN** Desktop 无法访问网络
- **THEN** 已打包界面中的语言和 Column 选择仍可打开与操作，不发起额外资源请求
