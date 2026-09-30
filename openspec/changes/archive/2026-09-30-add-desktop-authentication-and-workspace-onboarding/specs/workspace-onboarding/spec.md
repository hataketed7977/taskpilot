# Spec Delta

## Purpose

定义 TaskPilot 首期以组织型 Workspace 为入口的首次使用、创建、恢复和上下文切换行为，并以统一的 Workspace 作用域与服务端能力契约保证未来可增加 Personal Workspace，而无需改写 Project、Board 或授权模型。本 capability 的完成边界是建立活动 `WorkspaceId` 并把上下文交给只读 `project-list` capability；Project 创建不在本 Change 中。

## ADDED Requirements

### Requirement: Organization-first 首次进入
系统 SHALL 在已认证用户完成登录后列出其可访问的 Workspace，并在列表为空时提供明确的组织型 Workspace 创建入口，而不是自动配置 `PERSONAL` Workspace。

#### Scenario: 用户已有可访问 Workspace
- **WHEN** 已认证用户至少拥有一个可访问 Workspace
- **THEN** 系统显示可访问 Workspace，并允许用户选择一个 Workspace 建立活动上下文后进入该 Workspace 的 Project list surface

#### Scenario: 用户没有可访问 Workspace
- **WHEN** 已认证用户的可访问 Workspace 列表为空且用户具有创建 Workspace 的能力
- **THEN** 系统显示创建 Organization Workspace 的首要入口，不展示 Project 创建入口或 Personal 类型选择；Project list 仅在 Workspace 创建并成为活动上下文后加载

#### Scenario: 无 Workspace 且不能创建
- **WHEN** 已认证用户的可访问 Workspace 列表为空且用户不具有创建 Workspace 的能力
- **THEN** 系统显示不可继续的明确原因和可执行恢复指引，而不是展示无效的创建操作

#### Scenario: 未认证访问
- **WHEN** 未认证用户尝试查询或创建 Workspace
- **THEN** 系统返回 `401` 和 `AUTHENTICATION_REQUIRED`，且不创建 Workspace 或成员关系

### Requirement: Workspace 列表 HTTP 契约
Core API SHALL 以 bearer-protected `GET /desktop/v1/workspaces` 返回当前 User 可访问的 Workspace 集合和列表上下文能力。成功响应 MUST 为 `200`，形状为 `{ items, capabilities }`；`capabilities` 必须包含布尔值 `canCreateWorkspace`，并可在不可创建时包含稳定且可安全展示的 `createWorkspaceReasonCode`。每个 item MUST 恰好使用本 Change 冻结的 `{ workspaceId, name, type }` 客户端表示；本 Change 不定义 item-level action capability，也不得暴露内部角色、额外授权字段或持久化实体。

#### Scenario: 成功列出 Workspace
- **WHEN** 有效 access bearer 调用 Workspace 列表接口
- **THEN** Core API 返回 `200`、仅包含该 User 可访问的 `{ workspaceId, name, type }` items，以及服务端计算的 `canCreateWorkspace` 和适用的 `createWorkspaceReasonCode`

#### Scenario: 缺失或无效 bearer
- **WHEN** Workspace 列表请求没有有效 access bearer
- **THEN** Core API 返回 `401` 和 `AUTHENTICATION_REQUIRED`，不返回任何 Workspace 数据

#### Scenario: Workspace 列表暂不可用
- **WHEN** Core API 无法安全读取 Workspace 列表
- **THEN** Core API 返回 `503` 和 `WORKSPACE_TEMPORARILY_UNAVAILABLE`，可在适用时提供 `retryAfterSeconds`

### Requirement: 创建组织型 Workspace 的 HTTP 契约
首期创建 SHALL 使用 bearer-protected `POST /desktop/v1/workspaces`、必填 `Idempotency-Key` 和仅含 `{ name }` 的 JSON body。服务端固定创建 `ORGANIZATION`；首次成功返回 `201`，已确定完成的同 key 同 payload 重放可返回 `200`，两者 MUST 返回同一个已创建 Workspace 的 `{ workspaceId, name, type }` representation，Main MUST 接受二者。请求中的 `type`、actor、role、capability、成员或未知字段 MUST 被拒绝。

#### Scenario: 成功创建 Workspace
- **WHEN** 具有创建能力的已认证用户提交合法名称和新的 `Idempotency-Key`
- **THEN** 系统返回 `201`，创建具有稳定 `WorkspaceId` 的 `ORGANIZATION` Workspace，并返回该 Workspace 的 `{ workspaceId, name, type }` 客户端表示

#### Scenario: 确定性重放已完成创建
- **WHEN** 同一 User 以相同 key 和相同 payload 重放已成功的创建请求
- **THEN** 系统返回 `200` 和第一次创建的同一 `{ workspaceId, name, type }` representation，而不是创建第二个 Workspace

#### Scenario: 客户端提交禁止字段
- **WHEN** 客户端提交 `PERSONAL`、其他类型、actor、role、capability、成员或未知字段
- **THEN** 系统返回 `400` 和 `VALIDATION_FAILED`，且不创建 Workspace 或成员关系

#### Scenario: Workspace 名称非法
- **WHEN** 名称经首尾空白裁剪后为空、超过 80 个 Unicode code point 或包含控制字符
- **THEN** 系统返回 `400`、`VALIDATION_FAILED` 和 `name` 字段 path，且不创建 Workspace 或成员关系

#### Scenario: 创建策略拒绝
- **WHEN** 已认证用户不具有创建能力，或服务端配额或策略不允许创建 Workspace
- **THEN** 系统返回 `403` 和 `WORKSPACE_CREATION_NOT_ALLOWED`，且不创建 Workspace 或成员关系

#### Scenario: Workspace 允许同名
- **WHEN** 用户提交与已有 Workspace 显示名相同但幂等 key 不同的合法请求
- **THEN** 系统将其作为新的创建意图处理，不以显示名作为 Workspace 身份或唯一性约束

### Requirement: 创建者 Membership 与原子成功
系统 SHALL 在创建 Workspace 的同一数据库成功边界内为创建者建立初始 Membership；Workspace、创建者 Membership 和幂等成功结果 MUST 原子提交。系统 MUST NOT 留下没有该 Membership 的 Workspace、指向不存在 Workspace 的孤立 Membership，或缺少对应 Workspace/Membership 的成功幂等结果。本 Change 不定义或授予 item-level Workspace 管理 capability。

#### Scenario: Workspace 与 Membership 同时成功
- **WHEN** Workspace 创建操作成功提交
- **THEN** 创建者立即能在列表中看到并选择该 Workspace，后续授权仍由创建者 Membership 和服务端检查决定

#### Scenario: Membership 创建失败
- **WHEN** Workspace 数据已准备创建但初始 Membership 无法建立
- **THEN** 整个创建操作失败，且 Workspace 与 Membership 均不对用户可见

#### Scenario: Workspace 创建失败
- **WHEN** Workspace 无法创建
- **THEN** 系统不保留对应的初始 Membership

### Requirement: 创建幂等、并发与稳定错误
Renderer/Preload SHALL 以 `creationRequestId` 表达创建意图，Main MUST 将其映射为 `Idempotency-Key`。持久幂等作用域 SHALL 包含可信 User、操作和 key；相同 key 不同 payload 必须拒绝，相同 key 并发最多提交一次。稳定错误至少 SHALL 包含 `AUTHENTICATION_REQUIRED`、`WORKSPACE_CREATION_NOT_ALLOWED`、`VALIDATION_FAILED`、`IDEMPOTENCY_IN_PROGRESS`、`IDEMPOTENCY_KEY_REUSED` 和 `WORKSPACE_TEMPORARILY_UNAVAILABLE`，并分别映射到合适的 `401`、`403`、`400`、`409` 或 `503`；可重试错误可携带 `retryAfterSeconds`。

#### Scenario: 相同创建请求并发提交
- **WHEN** 同一 User 以相同 key 和 payload 并发提交多个创建请求
- **THEN** 系统至多提交一个 Workspace/Membership；其余请求返回同一结果或 `409 IDEMPOTENCY_IN_PROGRESS`，并可携带 `retryAfterSeconds`

#### Scenario: 相同 key 对应不同 payload
- **WHEN** 同一幂等作用域以已使用 key 提交不同名称
- **THEN** 系统返回 `409 IDEMPOTENCY_KEY_REUSED`，且不复用旧结果或创建新 Workspace

#### Scenario: 创建服务暂不可用
- **WHEN** 创建操作无法安全完成且没有可确定的成功结果
- **THEN** 系统返回 `503 WORKSPACE_TEMPORARILY_UNAVAILABLE`，保持事务完整并在适用时提供 `retryAfterSeconds`

#### Scenario: 创建响应丢失
- **WHEN** Workspace 已成功创建但 Desktop 未收到响应
- **THEN** Desktop 保留非秘密输入和原 `creationRequestId`，以同一 key 安全重放并在恢复后重新获取 Workspace 列表

### Requirement: 活动 Workspace 上下文与启动恢复
Desktop SHALL 按 environment + `UserId` 隔离保存最近活动 `WorkspaceId`。启动恢复顺序 MUST 为：Main 确定 environment，读取该 environment 的 current-account pointer，从对应 OS credential namespace 恢复 session，获取 `CurrentUserView`，获取 Workspace 列表，再验证最近 Workspace 是否仍可访问。只有验证成功后才可建立活动 Workspace，并在该作用域内加载 Project list。

#### Scenario: 一个可访问 Workspace
- **WHEN** 恢复后列表只有一个 Workspace
- **THEN** Desktop 自动将其设为活动 Workspace 并加载该 Workspace 的 Project list

#### Scenario: 多个 Workspace 且最近项仍可访问
- **WHEN** 列表包含多个 Workspace，且同 environment + User 的最近 `WorkspaceId` 仍在列表中
- **THEN** Desktop 恢复该 Workspace；若不存在有效最近项则显示选择器

#### Scenario: 最近 Workspace 授权已撤销
- **WHEN** 已保存的最近 `WorkspaceId` 不再出现在权威列表中
- **THEN** Desktop 清除旧活动 ID 和对应 Workspace-scoped cache，不展示旧数据，并安全回退到唯一 Workspace、选择器或无 Workspace 状态

#### Scenario: environment 或账号改变
- **WHEN** 当前 environment 或 `UserId` 与保存活动 Workspace 时不同
- **THEN** Desktop 不恢复另一 environment 或账号的 Workspace 上下文

#### Scenario: 创建或选择成功
- **WHEN** 用户创建或选择一个 Workspace
- **THEN** Desktop 以返回的稳定 `WorkspaceId` 建立活动上下文、更新列表和 scope，并交给 `project-list` capability 加载真实 Project 数据；在响应完成前展示 Project loading state

### Requirement: 能力驱动的客户端授权表示
Workspace 列表上下文 SHALL 暴露本 Change 实际支持且语义稳定的 `canCreateWorkspace`，并可附 `createWorkspaceReasonCode`。Desktop MUST 据此决定创建操作的可见性或可用性，不得依据 Workspace 类型、角色名称或实体字段推断授权；该 capability 仅辅助展示，创建 mutation 仍须由 Core API 重新授权。本 Change 没有 item-level mutation，因此不预定义空泛的 item capability；后续能力只能按真实操作增加稳定字段。

#### Scenario: 创建 Workspace 能力不可用
- **WHEN** 列表上下文的 `canCreateWorkspace` 为 false
- **THEN** Desktop 不提供可提交的创建入口，并在存在安全 reason code 时展示对应解释

#### Scenario: 内部角色名称变化
- **WHEN** 服务端调整内部角色名称但 `canCreateWorkspace` 结果不变
- **THEN** Desktop 行为保持不变

#### Scenario: capability 与提交时授权发生竞态
- **WHEN** capability 曾允许操作但提交时服务端不再授权
- **THEN** Core API 拒绝 mutation，Desktop 使用稳定错误刷新权威状态而不依赖旧 capability 放行

### Requirement: 统一 Workspace 所有权边界
Project、Board 及其他 Workspace 下层资源 SHALL 仅通过 `WorkspaceId` 表达所属 Workspace；系统 MUST NOT 为 Organization Workspace 增加独立 `Organization` 实体、`organizationId` 所有权字段或第二套组织专属授权链路。本 Change 仅实现按该不变量读取 Project list，不实现 Project create/detail/update。

#### Scenario: 后续实现 Workspace 下层资源
- **WHEN** 本 Change 读取 Project list 或后续 Change 实现 Project mutation/Board
- **THEN** 其所属边界使用统一 `WorkspaceId` 和 Membership/authorization，而不要求组织专用标识

### Requirement: Personal Workspace 向后兼容边界
系统 SHALL 保留 `PERSONAL` Workspace 作为未来可支持的类型，但首期 MUST NOT 自动配置、开放创建或提供 Personal 专属 UI；未来启用时 SHALL 复用稳定 `WorkspaceId`、下层资源所属、Membership、capability 和客户端 Workspace 契约。

#### Scenario: 首期客户端创建 Workspace
- **WHEN** 用户在首期 Desktop 创建 Workspace
- **THEN** 系统只创建 `ORGANIZATION` Workspace，且不显示类型选择

#### Scenario: 未来列表返回 Personal Workspace
- **WHEN** 后续版本通过相同列表契约返回 `PERSONAL` Workspace
- **THEN** Desktop 以相同选择、capability 和 `WorkspaceId` 作用域处理它，不要求 Project 或 Board 增加新的所有权字段

### Requirement: Onboarding 独立于 Agent Runtime
Workspace list/create、上下文选择、恢复和 Project list surface MUST NOT 依赖本地 Agent Runtime 是否安装、启动、在线或已完成配置。

#### Scenario: Agent Runtime 不可用
- **WHEN** Desktop 已认证但 Agent Runtime 未安装、未启动或不可连接
- **THEN** 用户仍可列出、创建、选择 Workspace 并加载其 Project list surface
