# Proposal

## Why

TaskPilot Desktop 当前 3 个选择控件直接使用原生 `<select>`，收起状态可以局部着色，但展开菜单由 Chromium 与操作系统绘制，导致登录、账号和 Work Item 编辑中的视觉、焦点与交互表现不一致。现在统一这一小组高复用控件，可以在不建设完整 Design System 的前提下建立可靠的选择交互基线，并避免后续每增加一个选择字段就复制样式和可访问性逻辑。

## What Changes

- 新增一个 Renderer 共享 Select 控件，统一 trigger、菜单、选中项、焦点、禁用、长文本、滚动、窗口边缘避让和 reduced-motion 表现。
- 共享控件基于无样式且负责键盘、焦点、ARIA 与弹层基础行为的 headless primitive 实现；TaskPilot 继续自行拥有视觉语言，不引入整套 UI 视觉框架。
- 将登录页语言选择、已登录账号区语言选择和 Work Item 编辑中的 Column 选择迁移到共享 Select。
- 合并两套语言选择实现，使其复用同一 locale 选项与切换逻辑，同时允许登录页和账号区保留必要的布局变体。
- 保持现有 locale、Column 选择、表单提交和 IPC/API 语义不变。

## Business Model Impact

这是现有行为的呈现与交互一致性改造，没有业务模型变化。Actor 仍是 Desktop 用户；`locale`、`Column`、Work Item 与 Placement 的身份、归属、基数、生命周期、授权、版本和持久化规则均不变。选择项的稳定 value 继续作为既有 UI 输入，不产生新的业务实体或历史记录；语言切换继续只改变本地偏好和当前文案，Column 选择继续在保存 Work Item 时走现有原子编辑路径。

以具体场景检查了打开、键盘浏览、确认、取消、失焦、禁用、长列表/长文本、最小窗口和 reduced-motion。控件故障不得提交未明确选择的值；菜单关闭后恢复到 trigger，表单仍由既有校验和提交错误路径负责恢复。不存在新的异步服务边界、并发规则、租户范围或滥用面。

## Capabilities

### New Capabilities

- `desktop-select-controls`: 定义 Desktop 当前选择字段的一致视觉、键盘、辅助技术、焦点和响应式行为，以及语言选择复用规则。

### Modified Capabilities

- `desktop-internationalization`: 明确未登录与已登录语言选择复用统一 Select 交互，同时保持即时切换和本地偏好语义。

## Impact

- 主要代码：`apps/desktop/src/renderer/` 下新增共享控件，并调整 `App.tsx`、`project-home.tsx`、`board-workspace.tsx` 与相关样式。
- 测试：Renderer/Vitest 与 Cypress component 覆盖键盘、焦点、选择、关闭、长文本、最小窗口和 reduced-motion；既有语言与 Work Item 编辑测试继续证明业务值没有漂移。
- 依赖：预计新增一个小型无样式 Select primitive；不引入完整 UI 组件库，不把第三方视觉主题带入 TaskPilot。
- API、IPC、数据库、Core API、认证秘密和持久化模型均不改变。
- 与在途 `add-project-boards-and-work-items` Change 存在 `board-workspace.tsx` 的实现重叠；apply 时必须基于当时工作树集成，不能清理或覆盖该 Change。

## Documentation Impact

- `docs/business-model.md`：不更新；本 Change 不改变任何产品术语、关系、生命周期或不变量。
- `docs/architecture.md`：不更新；没有跨项目边界、依赖方向或信任边界变化。
- `apps/desktop/docs/design-foundation.md`：实施时补充 Current 的 Select 视觉与交互基线，且只描述已验证落地的状态。
- `apps/desktop/docs/responsibilities.md`：实施时在共享 Renderer primitive 确实存在后记录其局部责任边界，避免页面重新实现 Select 协议。
- `apps/desktop/docs/architecture.md` 与 `testing-strategy.md`：预计不更新；既有 Renderer 组件与测试分层足以拥有该改造。若 apply 证明新增依赖或测试责任形成稳定新约束，再同步最小必要事实。
- Main OpenSpec：新增 `desktop-select-controls`，并通过 `desktop-internationalization` delta 固化语言选择的一致交互；只有用户明确要求 sync/archive 时才进入 main specs。
