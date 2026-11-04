# Proposal

## Why

当前 Card 只能表达标题、描述和位置，无法直接说明谁负责推进；创建人虽然已经写入持久化表，但没有进入 canonical API 和详情界面，导致责任归属与来源信息都不清晰。用户需要在看板卡片和详情中以专业、低噪声的方式看到并维护责任人，同时必须保证责任人只能来自当前 Project 成员，并为未来选择 Project Agent 预留模型空间。

## What Changes

- Work Item 新增可为空的单一 `assignee`，当前只允许选择当前 Project 的 `ProjectMember`；创建 Work Item 默认未分配，不自动把创建人设为责任人。
- `assignee` 使用可扩展目标模型，当前支持 `PROJECT_MEMBER`，命名和 API shape 预留未来 `PROJECT_AGENT_BINDING`，但本 Change 不实现 Agent 选择或 Agent assignment 行为。
- Core API 在创建、读取、编辑 Work Item 和 Board Card 投影时返回责任人摘要；Card 仍没有独立身份，责任人属于 Work Item，而不是 Board Placement。
- Core API 暴露 Work Item `createdBy` 人员摘要；创建人不可编辑，并与责任人分开展示。
- 新增当前 Project 成员选择能力，返回可被设为责任人的成员摘要（头像、姓名、角色等），并在服务端强制校验不能选择 Project 外用户或非 active 成员。
- Desktop Card 使用固定高度与有界标题/描述区域，责任人以固定在右上角且不参与内容流的轻量头像展示，未分配时不增加主要视觉噪声且不改变卡片几何；Work Item 详情以稳定属性区展示可编辑责任人，在底部 audit footer 同行展示不可编辑创建人和创建/更新时间，并提供可搜索的责任人选择器和清空为未分配入口。
- Work Item 标题、描述和责任人编辑继续使用乐观版本控制；责任人修改成功递增 Work Item version 和 `updatedAt`，并用权威响应调和 Board Card 与详情。
- Checked-in canonical OpenAPI、Gateway route manifest 投影、Core runtime OpenAPI 展示，以及 Desktop Main/Renderer shared contracts 更新为包含人员摘要、责任人目标和 Project Member 列表 API 的当前契约。
- 本 Change 明确不引入历史版本、Activity timeline、字段级 diff、按时间点回溯、恢复历史版本或整板时间旅行；历史版本能力将作为未来独立 Change 设计。

## Business Model Impact

本 Change 使用关系图、具体场景、决策树、轻量状态/权限检查和 UI 信息层级对责任归属进行建模：

- **参与者与目标：** 当前可执行者仍是 `ProjectMembership(OWNER)` 对应的 User；目标是为 Work Item 指定当前责任主体，并在卡片和详情中清楚区分“谁创建”和“谁负责”。
- **Canonical terms：** 受影响术语为 `Project Member`、`Work Item`、`Assignment`、`Card` 与未来 `Project Agent Binding`。责任人采用 Assignment 语义，但当前只实现 Work Item 的一个可为空责任目标，不实现多 Assignment、slot override 或 workflow execution。
- **身份、关系与基数：** Work Item 继续以 `workItemId` 作为稳定身份并属于一个 Project；Card 继续复用 `workItemId`，不产生 `CardId`。每个 Work Item 当前最多一个 active assignee，目标要么为空，要么引用当前 Project 的一个 Project Member；未来可扩展为 Project Agent Binding，但不得把 Agent 当成 User 或 Project Member。
- **生命周期与不变量：** Work Item lifecycle/status 仍未实现；分配责任不会启动 Workflow、AgentRun 或审批。创建人是不可编辑审计引用；责任人可被设置、替换或清空。责任人修改是 Work Item mutation，成功后递增 Work Item version 并更新 `updatedAt`。
- **授权与租户范围：** 当前 mutation 权限保持 OWNER-only；成员候选和 assignee 校验都在 Workspace/Project 范围内执行。错误 Workspace、Project、Work Item、member 组合继续使用 not-found 或稳定验证语义，不泄露其他 Project 成员存在性。
- **版本/历史语义：** 本 Change 只维护当前状态、Work Item version 和审计时间，不提供 durable revision history。历史版本、字段 diff、按时间点查询和 Card move activity 作为未来独立能力，不在本 Change 内被伪造或以 UI-only 日志实现。
- **失败、并发与滥用场景：** 选择非项目成员、停用用户、跨 Project member id、过期 Work Item version、迟到响应、重复提交和暂时错误都不得产生部分更新或错误责任人；Desktop 必须保留可恢复状态并使用权威响应调和。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-work-items`: Work Item 当前契约新增创建人展示和可为空、可扩展目标模型的责任人字段；编辑责任人遵守 Project 范围、成员资格和 Work Item optimistic version。
- `project-boards`: Card 作为 Work Item + Board Placement 投影时包含 Work Item 责任人摘要，并在 Board UI 中低噪声展示责任人头像，不把责任人复制成 Card-owned 字段。
- `project-home`: Project 成员当前可作为责任人候选被查询；成员候选受 Workspace/Project 范围和 active membership 限制，但不新增成员管理 UI。
- `canonical-resource-api`: canonical `/v1` contract 新增 Project Member 列表 operation，并描述人员摘要、责任人目标、Work Item/Card response 字段、相关错误和 Gateway 可接纳的 ingress metadata。

## Impact

- Core API persistence：新增 Work Item 当前 assignee 持久化字段或等价表结构，复用已有 `created_by_user_id` 并暴露创建人摘要；迁移/基线与 PostgreSQL 约束需保证 member 属于同 Project。
- Canonical API contract：更新 `contracts/canonical-api/openapi.yaml`、schema、operation、ingress metadata 和 Gateway route manifest 投影；不新增 Desktop 专属 API 或手写 Gateway route。
- Core API project module：更新 Work Item create/detail/edit、Board read/Card projection、Project Member 列表 use case、DTO、validation、Problem Details、OpenAPI。
- Desktop Main/Preload/shared contracts：更新 Project Work transport、Zod/strict parsers、IPC capability types和 fixtures，保持 Renderer 不接触 bearer credential。
- Desktop Renderer：更新 Board Card、Work Item 详情元数据区、责任人选择器、loading/empty/error/focus/keyboard/reduced-motion 状态和 i18n 文案。
- Tests：新增/更新 canonical contract/manifest 测试、Core API migration/application/HTTP/OpenAPI 测试、Desktop Main contract 测试、Renderer/Cypress UI 测试和 affected quality gates。
- Dependencies：不引入新的第三方运行时依赖；UI 使用现有 React、TanStack Query、Semi/既有视觉系统与本仓库 shared controls。

## Documentation Impact

- `docs/business-model.md`：实现当前 Work Item 单责任人切片，更新 Current/Target 表述，明确创建人已展示、当前 responsibility 只支持 Project Member，Agent assignment 仍为未来 Target。
- `docs/architecture.md`：如 API/ownership 边界文字涉及 Project Membership、Work Item 当前契约、canonical OpenAPI 或 Gateway manifest，需要更新 Current 契约；不改变跨项目技术边界。
- `apps/desktop/docs/architecture.md`、`apps/desktop/docs/responsibilities.md`、`apps/desktop/docs/testing-strategy.md`：更新 Renderer/contract/UI owner、责任人选择器与卡片展示测试职责。
- `services/core-api/docs/architecture.md`、`services/core-api/docs/responsibilities.md`、`services/core-api/docs/testing-strategy.md`：更新 Project Work persistence/API/use-case 与测试策略中关于创建人、责任人和成员候选的 Current 说明。
- Main specs：归档同步时更新 `project-work-items`、`project-boards`、`project-home` 和 `canonical-resource-api`；历史版本能力保持未实现，不写入 Current。
