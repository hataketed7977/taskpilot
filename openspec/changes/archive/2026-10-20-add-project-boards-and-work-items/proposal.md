# Proposal

## Why

当前用户进入 Project 后只能看到稳定上下文，不能在 Project 内创建和组织真实工作。下一步需要交付可持久化、可操作且不是演示数据的多 Board 与卡片闭环，同时保持 Work Item 是业务真相、Card 只是 Board 投影。

## What Changes

- 一个 Project 可拥有多个普通 Board，不设置产品数量上限，也不引入特殊 `isDefault` Board。
- 创建 Project 时自动创建一个普通初始 Board；用户还可创建其他 Board，每个 Board 具有名称和可选描述。
- 每个新 Board 自动创建一个初始 Column；用户可新增、改名、排序和删除空 Column，但不能删除最后一个 Column。
- 用户可在当前 Board 创建、查看和编辑最小基础 Work Item（标题、可选描述），其在 Board 中显示为 Card；本切片不实现 Work Item Type 与自定义字段。
- Board Placement 持久化同一 Work Item 在特定 Board 内的 Column 和顺序；Card 无独立身份或业务副本。
- 用户可通过拖拽或等价键盘操作在当前 Board 内移动、排序 Card；移动只改变当前 Board Placement，不改变其他 Board。
- Project 首页直接解析最近访问且仍可访问的 Board；无有效偏好时进入最早创建的 Board，新建 Board 后进入该 Board。
- Desktop 的 Board、Column、Card、错误、空状态和可访问名称全部支持 `zh-CN` 与 `en`，并覆盖最小支持窗口的长英文布局。
- Board/Work Item/Column/Placement API 纳入运行时 OpenAPI、共享 Problem Details、bearer 安全声明和契约测试。

## Business Model Impact

本 Change 使用关系图、状态/不变量分析、具体场景和并发威胁检查细化现有 Project Work 模型：

- **参与者与目标：** 当前唯一可操作角色是 `ProjectMembership(OWNER)` 对应的 User；目标是在其有权访问的 Project 内组织工作。
- **身份与关系：** `Project 1:N Board`、`Board 1:N Column`、`Project 1:N WorkItem`。基础 Work Item 不要求绑定尚未实现的 Work Item Type Version；未来使用类型化自定义字段的 Work Item 才 SHALL 固定不可变类型版本，后续 Change 必须设计既有基础 Work Item 的显式选择或迁移。`BoardPlacement` 以 `(boardId, workItemId)` 唯一引用一个 Work Item、一个同 Board 的 Column 和一个排序值；同一 Work Item 的 Placement 可分属多个 Board。Card 复用 `WorkItemId`，不存在 `CardId`。
- **所有权与租户范围：** Board、Column、Work Item 和 Placement 均属于 Project Work，并持久化在 `project` schema。所有引用必须落在同一 Workspace 与 Project；API 路径显式携带 `workspaceId` 与 `projectId`，服务端重新授权 Project OWNER。
- **生命周期与不变量：** 本切片不提供独立删除 Board 或 Work Item，也不实现 Work Item Type、自定义字段、Assignment、Comment 或生命周期动作；每个 Board 始终至少有一个 Column，只有空 Column 可删除。经 Danger Zone 精确名称与版本确认的 Project 永久删除 SHALL 在一个事务内显式删除该 Project 拥有的 Placement、Column、Board、Work Item、Membership 与 Project；任何未获批准的受保护依赖仍 SHALL 阻止整次删除。当前基础 Work Item 只创建为 `OPEN`，本切片不批准其他 lifecycle 值，也不暴露完成、取消或重开动作；后续生命周期设计必须继续与 Workflow/执行状态分离。
- **视图语义：** 本 Change 明确调整 Target 规则：Board 不复制 Work Item 内容或业务生命周期，但允许持久化视图级 Placement。移动 Card 是当前 Board 的布局动作，不是 Workflow 动作，也不直接修改 Work Item 总体生命周期。
- **历史与并发：** Board、Column、Work Item 与 Placement 使用乐观版本；包括创建 Placement 在内的 Board 布局写入携带预期 Board 版本，过期编辑、列变更、Work Item 创建或移动请求稳定冲突并返回权威重载路径。创建 Project、Board、Column 和 Work Item 使用 actor 与所属范围内的 request id 保证不确定重试不重复创建；Desktop 以每个 Board 的单调请求代次阻止同一 Board 的迟到读取覆盖已成功的修改。
- **失败与滥用：** 拒绝跨 Workspace/Project 引用、把 Placement 指向其他 Board 的 Column、删除非空或最后一个 Column、越权访问、过期写入和伪造排序。Card 移动失败时客户端恢复服务端权威布局，而不是保留只存在于 UI 的状态。
- **异步边界：** 本切片不启动 Workflow 或 Agent，不引入后台任务；所有变更在 Core API PostgreSQL 事务内完成。

## Capabilities

### New Capabilities

- `project-boards`: 多 Board、Column 配置、Board Placement、Card 查询与移动语义。
- `project-work-items`: Project 内最小 Work Item 的创建、读取和编辑语义，以及 Card 投影所需的稳定身份。

### Modified Capabilities

- `project-home`: Project 登录落点从静态首页扩展为解析并打开当前 Board，Project 创建事务增加普通初始 Board。
- `desktop-internationalization`: 当前双语界面范围扩展至 Board、Column、Card 和相关错误/空状态。
- `desktop-api-documentation`: 当前运行时 Desktop API 文档范围扩展至 Board、Column、Work Item 和 Placement。

## Impact

- Core API Project Work 模块、`project` PostgreSQL schema 与 Flyway migration。
- Core API Desktop Controller、授权、校验、幂等、乐观并发和运行时 OpenAPI。
- Desktop Main/Preload 窄能力接口、session generation 与陈旧响应防护。
- Renderer Project 首页、Board 导航、Column/Card 交互、拖拽与键盘等价操作、双语消息目录。
- Core API 单元/模块集成/数据库迁移/契约测试，以及 Desktop Renderer/Cypress/system journey。
- 不新增第三方状态管理、拖拽或国际化框架；仅在实现证据证明原生交互不足时另行决策依赖。

## Documentation Impact

- `docs/business-model.md`：把 Board Placement 纳入关系与不变量，修订 Board/Workflow 语义及 Rule 12，明确当前无 Workflow 映射时 Card move 是经过授权、范围与并发校验的布局动作；未来引入 Workflow 时由后续 Change 决定哪些移动仍是布局排序、哪些映射为 Workflow 业务动作，不预设所有移动都会启动或推进 Workflow。并把“所有 Work Item 必须固定类型版本”收敛为仅适用于使用类型化字段的 Work Item；对应内容随实现从 Target 更新为 Current。
- `docs/architecture.md`：更新当前可运行切片和高风险测试范围，不把 Workflow/Agent Target 描述为已实现。
- `services/core-api/docs/{architecture,responsibilities,testing-strategy}.md`：同步 Project Work 的 Placement 持久化、事务、授权和验证命令。
- `apps/desktop/docs/{architecture,responsibilities,testing-strategy,design-foundation}.md`：同步 Board 页面、Main/Preload 能力、双语与交互验收。
- 主规格 `project-boards`、`project-work-items`、`project-home`、`desktop-internationalization` 与 `desktop-api-documentation` 在实现验证后通过 delta sync 更新；本 Change 不提前把实现状态写为 Current。
