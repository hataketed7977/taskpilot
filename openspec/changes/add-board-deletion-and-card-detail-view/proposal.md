# Proposal

## Why

当前普通 Board 创建后无法独立删除，Card 详情的显式操作与字段卡片式视觉也让高频编辑过重。实现与验收进一步暴露出两类问题：当前实现曾预置但未形成能力的单值 `OPEN lifecycle` 会被误解为与 Column 并存的第二套状态；首轮 Focused Work Sheet 实现又让只读态与编辑态采用不同尺寸和结构，点击字段时 Dialog 重排闪动，保存后标签消失。需要在保留已批准 Board 删除、隐式保存及恢复语义和 Target 状态机的同时，端到端移除过早占位模型，并把详情修正为几何稳定、标签连续且可专业使用的聚焦工作面。

## What Changes

- Project OWNER 可永久删除没有任何 Board Placement 的普通 Board；操作要求当前 Board version 与精确当前名称确认，成功后显式删除其 Columns 与 Board，但不删除任何 Work Item。
- 允许删除 Project 的最后一个 Board；删除当前 Board 后确定性进入剩余的首个可访问 Board，没有剩余 Board 时显示既有“暂无看板”与创建入口，并使已删除 Board 的本机最近访问偏好失效。
- 非空、名称不匹配、版本过期、受保护依赖、越权或错误范围的删除请求稳定失败且不产生部分删除；没有权威响应时 Desktop 不自动重发永久删除，而是通过权威 Board 列表调和已删除、仍存在或结果未知。
- Card 点击先读取权威 Work Item 详情；详情只为标题与描述提供单字段原位编辑和字段类型驱动的隐式保存，正常路径不显示常驻保存、取消或三按钮脏草稿门禁，也不展示或编辑 Placement/Column 属性。Card 的 Board 内位置继续由画布表达，移动仍通过 Board 拖拽完成。
- 详情以实际 Work Item 标题作为唯一 Dialog heading，不再重复“工作项详情”和第二份“标题”字段；标题占满关闭按钮左侧的可用宽度，描述成为使用完整内容宽度的多行主要正文，创建/更新时间降级为审计 footer。
- 详情采用 content-adaptive、viewport-bounded 的稳定面板：普通短内容不以固定高度制造大块留白，关闭按钮和审计 footer 在字段从只读到编辑、saving、成功或失败时不闪动或重新居中；标题文本原点保持一致，“描述”标签在所有状态常驻。
- 描述预览与编辑器共享受控占位，一行内容不会在点击后突然膨胀成多行输入区；长内容只在明确的内部区域滚动。保存反馈占用既有字段标签/身份行的固定位置，不新增行或推移正文。
- **BREAKING**：当前 Work Item 不具有 `lifecycle` 或 `status`。从 PostgreSQL 基线、Core API `WorkItemView`/`CardView` 与 OpenAPI、Desktop transport/shared contract、Renderer、双语文案、fixtures 和测试中完整删除固定 `OPEN` 字段，不保留 `null`、deprecated 或兼容占位字段。
- Column 仍只表示一个 `BoardPlacement` 在特定 Board 内的位置，MUST NOT 被命名或解释为 Work Item 全局状态；同一 Work Item 在多个 Board 上可以位于不同 Column。
- 在首次发布前、仅有 disposable 本地数据的约束下直接修正 `V1__initialize_taskpilot.sql` 基线；已有 checkout 本地数据库通过受控重建采用新基线，不新增先创建再删除该错误字段的 `V2`。
- 补充中英文、最小窗口、无障碍、PostgreSQL catalog、OpenAPI、Main/Preload strict contract、Renderer 和浏览器级验证。

## Business Model Impact

本 Change 使用关系图、状态能力反证、Board 删除状态转换、详情交互状态机、具体场景和信任边界检查完成比例化建模：

- **参与者与目标：** 当前可执行者仍是 `ProjectMembership(OWNER)` 对应的 User；目标是安全清理空 Board、查看并编辑权威 Work Item，同时不把尚未实现的 Target 状态能力伪装成当前可用功能。
- **身份、关系与所有权：** `Board`、`Column`、`WorkItem`、`BoardPlacement` 的稳定身份与关联不变；Card 继续复用 `WorkItemId`，没有独立身份。Board 拥有 Columns 与 Placements，但不拥有 Project-owned Work Items。Column 由 Board 拥有，Placement 引用它；Column 名称或位置不属于 Work Item。
- **生命周期与不变量：** Board 新增不可逆永久删除转换，只有 Placement 数量为零的 Board 可删除，Project 可有零个 Board。Work Item 当前实现没有业务状态或生命周期字段，当前 API 也不提供完成、取消、重开等转换；移除单值 `OPEN` 是纠正过早实现，不是新增状态转换，也不撤销业务模型已批准的 Target `Open`、`Completed`、`Cancelled` 与 reopen 转换。详情的 read-only/editing/saving/conflict 只是客户端交互状态。
- **多 Board 语义：** 同一 Work Item MAY 在多个 Board 中具有不同 Placement 和 Column。移动 Card 只改变当前 Board 的 Placement，MUST NOT 推导、创建或同步 Work Item 状态。
- **授权与范围：** 删除、读取详情与编辑继续由 Core API 按 Workspace、Project、Board 和资源身份重新校验 OWNER；错误范围使用既有 not-found 语义。移除 lifecycle 不改变授权边界。
- **版本与并发：** Board 删除继续使用 Board version；字段保存继续使用 Work Item version，跨 Column 时还使用 Board 与 Placement version。删除 lifecycle 不改变乐观版本或审计时间。
- **失败、恢复与异步边界：** Board 删除和字段保存继续同步事务化；迟到响应、结果未知、保存失败、冲突和 portal 焦点按既有批准规则恢复。保存中继续显示并保留当前 editor/draft，只有权威成功响应才切回等占位只读面；几何稳定是客户端呈现约束，不新增业务状态、任务、事件或后台处理。数据库基线修正只面向首次发布前的 disposable 数据，不声称具备生产升级或回滚能力。
- **本轮模型结论：** 几何稳定、标签连续、内部滚动和状态反馈位置只修正已批准详情交互的可观察呈现，不改变 WorkItem/Placement 身份、所有权、基数、授权、持久化、版本或业务生命周期；继续实现上述已批准规则，而非引入新的领域概念。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-boards`: 增加空 Board 永久删除及删除后的导航/围栏规则；明确 Card/Placement/Column 只表达 Board 内位置，不复制或暗示 Work Item 状态；详情不再作为移动入口，Card 移动继续由 Board 拖拽承担。
- `project-work-items`: 规定 Work Item 当前没有 lifecycle/status，API 不返回固定 `OPEN`；保留权威详情及标题、描述的隐式保存，移除详情内 Placement/Column 属性行，并要求详情在读、编辑、保存与恢复全流程保持稳定几何、常驻描述标签和可访问反馈。
- `desktop-api-documentation`: 修正 Project Work 的运行时 OpenAPI 响应 schema，移除 Work Item/Card 的 lifecycle/status，并继续准确声明范围、版本和 Placement 语义。

## Impact

- Core API：`project.work_items` V1 基线、Project Work use case/view、SQL、HTTP/OpenAPI schema、迁移 catalog 与集成测试；Work Item/Card response shape 是 breaking correction。
- Desktop Main/Preload：严格 transport parser、共享 contract、fixtures 与跨边界测试同步删除 lifecycle。
- Desktop Renderer：详情 content-adaptive 稳定 shell、heading、标题与全宽多行描述表面、无 Placement/Column 属性行、固定关闭按钮与审计 footer、保存/错误反馈、双语文案、样式及 Renderer/Cypress 几何与交互测试。
- 本地开发：旧 checkout 数据库与修改后的 V1 checksum 不兼容，按现有 checkout-owned disposable-data recovery 重建 PostgreSQL/Redis 数据；不运行 Flyway repair。
- 不新增依赖，不改变 capability boundary、资源身份、授权、乐观并发或 Work Item/Placement 原子写入。

## Documentation Impact

- `docs/business-model.md`：将 Current Work Item 从“保存 OPEN lifecycle”修正为“当前实现没有状态/生命周期能力”，删除与其相关的 Current 不变量，并明确 Column 只属于 Board Placement；保留已批准的 Target `Open`、`Completed`、`Cancelled` 状态机及 reopen 转换。本 Change 不重新决定该 Target 的状态集合或合法转换。
- `docs/architecture.md`：跨项目边界不变；最终审计记录 breaking transport correction 仍由 Core API contract 与 Desktop strict parser共同拥有，若无新的跨项目机制则不重复局部字段清单。
- `services/core-api/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md`：更新 V1 基线、Project Work response/persistence 责任、首次发布前重建策略与 catalog/OpenAPI 验证。
- `apps/desktop/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md`、`design-foundation.md`：实现切片继续更新无 lifecycle contract、实际标题 heading、content-adaptive 稳定 shell、全宽多行描述、无 Placement/Column 详情行、内部滚动、Board 拖拽位置语义、自动保存及完整状态序列的视觉/几何验收要求；在重新 Apply 前不得把本轮设计描述为 Current。
- 主规格 `project-boards`、`project-work-items` 与 `desktop-api-documentation`：在实现完成并获明确 sync/archive 授权后同步本 Change 的行为增量；已归档 Change 作为历史记录不改写。
