# Proposal

## Why

当前看板的大标题区、嵌套列容器和固定等高卡片削弱了工作区的整体感，标题与两行摘要也缺少清晰的阅读层级。用户已确认借鉴参考图中浅色、干净、紧凑但不拥挤的布局原则，并授权先独立规划看板视觉改造，以便与工作项创建／编辑统一分别评审和验收。

## What Changes

- 收紧看板主区域的 Project 上下文与 Board 工具栏；保持现有 Project 导航、Board tabs 和操作入口，释放画布空间。
- 将 Column 改为轻量浅色分组区域，统一标题、数量、操作与 Card 的对齐，弱化外层边框和阴影。
- Card 使用突出标题、可选一行描述摘要、底部责任人头像的阅读顺序；标题最多两行，允许由标题行数造成的有限高度差。摘要槽和责任人槽保持稳定，避免仅因分配／清空责任人造成高度变化。
- 依据被拖起 Card 的实际尺寸设置预览和唯一占位槽，保持现有精确插入、权威响应、失败回滚和 reduced-motion 行为。
- 使用已有浅色矿物中性色、深青色、Inter 与平台中文字体；不引入组件库、字体或全局设计系统重构。

本轮不改创建／编辑面板、草稿与保存规则，不增加快速创建、侧边详情、筛选、列表视图、任务编号、优先级、Column 状态配色配置、Agent 或审批能力。登录、侧栏结构、原生标题栏、Main／Preload、后端和持久化契约不在改造范围。

## Business Model Impact

采用具体场景映射与现有关系核对，结论为 **无业务模型变化**。参与者仍是当前 Project OWNER；受影响术语是 Project、Board、Column、Work Item、Card、Board Placement 和责任人。依据 `docs/business-model.md` 的 “Board Semantics” 与主规格 `project-boards`，Card 继续复用 `workItemId`，只是权威 Work Item 与当前 Board Placement 的投影；Column 不代表 Work Item 全局状态，拖拽不启动 Workflow 或 Agent。责任人继续是同 Project 的可空单人关联，未分配不展示伪造人员。

本轮只修订呈现约束，不改变身份、归属、基数、生命周期、权限／Workspace 隔离、version、历史或同步／异步边界。具体核对场景包括同一 Work Item 在多个 Board 的位置独立、责任人设置／清空后 Card 使用权威摘要、变高 Card 的列内／跨列插入，以及冲突时恢复权威位置。渲染截断仅影响预览，不能改写文本；迟到响应、错误和 pending 继续由现有状态 owner 处理，不得借样式改造绕过门禁。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-boards`：增加紧凑整体布局和不同 Card 高度下准确拖拽反馈的呈现要求；保持原有业务移动语义。
- `project-work-items`：修订“Desktop 以低噪声方式展示和编辑责任信息”中 Card 的固定等高、两行描述和右上角头像约束；保留该 requirement 的详情展示、责任人编辑与异常恢复规则。

## Impact

- Renderer：`apps/desktop/src/renderer/features/board/board-workspace.tsx`、`styles/board.css`，以及 `styles/detail.css` 中已有的 Board 响应式／reduced-motion 规则。若需新 board-local CSS 变量，限定在 `.board-surface` 下，不改变其他页面的全局 token。
- 验证：`apps/desktop/tests/renderer/features/board/project-board.test.tsx`、`apps/desktop/cypress/component/board.cy.tsx`；更新直接受影响的旧等高／头像位置断言并保留详情回归。
- 无 API、数据库、依赖、授权或跨项目架构变化；不需要数据迁移或独立发布机制，随 Desktop 正常版本交付。

## Documentation Impact

- Apply 中随对应切片更新 `apps/desktop/docs/design-foundation.md` 的看板布局与 Card recipe；规划期间本 Change 为 Proposed，实施和证据完成后才将相应描述标为 Current。
- `apps/desktop/docs/architecture.md`、`responsibilities.md` 与 `testing-strategy.md` 中固定高度／右上角头像的 Current 说明需要在实现切片内同步为受内容约束的 Card 与实际验证命令。
- `docs/business-model.md` 与 `docs/architecture.md` 的产品模型和跨项目契约不变；实施末尾需核对，若无偏移记录无更新理由。
- 本轮不新增、移动或更换工程文档 ownership，因此 `docs/README.md` 不需要修改。
- 规划和 Apply 期间不直接修改主规格；用户于 2026-11-11 明确授权 archive 和提交后，已将本 Change delta 同步到 `openspec/specs/`。最终文档反馈审计核对了上述 owner 与实际实现、测试的对应关系，见 [归档记录](test-plan.md#archive-and-documentation-audit)。
