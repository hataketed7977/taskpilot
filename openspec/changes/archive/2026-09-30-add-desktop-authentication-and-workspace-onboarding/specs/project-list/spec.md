# Spec Delta

## Purpose

定义活动 Workspace 下首期只读 Project list 的端到端行为，使 Desktop 在完成认证和 Workspace onboarding 后展示来自真实 Core API/PostgreSQL 的可访问 Project 集合。该 capability 只提供 Project 发现与选择前的列表表面；Project 创建、详情、编辑、删除、成员管理和 Project-scoped navigation 不在本 Change 中。

## ADDED Requirements

### Requirement: Project list 使用 Workspace-scoped HTTP 契约
Core API SHALL 通过 bearer-protected `GET /desktop/v1/workspaces/{workspaceId}/projects` 返回当前 User 在指定 Workspace 中可访问的 Project。可选 query 为 opaque `cursor` 和整数 `limit`；`limit` 默认 50、范围 1–100，未知 query 或非法 cursor/limit MUST 返回 `400 VALIDATION_FAILED`。成功响应 MUST 为 `200 { items, nextCursor? }`，每个 item MUST 恰好为 `{ projectId, workspaceId, name }`；`nextCursor` 仅在仍有下一页时出现。排序和 cursor SHALL 由服务端稳定拥有，客户端不得解析 cursor 或按名称重建分页。

#### Scenario: 成功列出一页 Project
- **WHEN** 有效 access bearer 对可访问 Workspace 请求 Project list
- **THEN** Core API 返回 `200`、仅包含当前 User 在该 Workspace 中可发现的 `{ projectId, workspaceId, name }` items，并在适用时返回 opaque `nextCursor`

#### Scenario: 缺失或无效 bearer
- **WHEN** Project list 请求未携带有效 access bearer
- **THEN** Core API 返回 `401 AUTHENTICATION_REQUIRED`，不执行或返回任何 Project 数据

#### Scenario: Project list 为空
- **WHEN** 当前 User 在可访问 Workspace 中没有可发现 Project
- **THEN** Core API 返回 `200 { items: [] }`，Desktop 展示真实空状态且不显示 Project 创建操作

#### Scenario: 继续加载下一页
- **WHEN** 响应包含 `nextCursor` 且 Desktop 请求下一页
- **THEN** Main 原样回传同一 `workspaceId`、opaque cursor 和批准范围内的 limit，结果追加到当前 Workspace 的 Project query，不解析或跨 Workspace 复用 cursor

### Requirement: Project list 同时执行 Workspace 与 Project 授权
Core API SHALL 先确认当前 User 具有指定 Workspace 的有效 Workspace Membership，再只返回该 Workspace 中当前 User 具有有效 Project Membership 的 Project。Project Membership 必须属于同一 User 和同一 Workspace；Project ID 全局唯一也不得绕过父 Workspace scope。Workspace 不存在与不可访问 MUST 对外使用相同的 `404 WORKSPACE_NOT_FOUND`，不得泄露 Workspace 或 Project 是否存在。

#### Scenario: 有效 Workspace 与 Project Membership
- **WHEN** 当前 User 同时具有目标 Workspace Membership，以及其中部分 Project 的有效 Project Membership
- **THEN** 列表仅返回这些可访问 Project，不返回同 Workspace 的其他 Project

#### Scenario: Workspace 不存在或不可访问
- **WHEN** `workspaceId` 不存在，或当前 User 没有有效 Workspace Membership
- **THEN** Core API 返回 `404 WORKSPACE_NOT_FOUND`，不返回 Project 数据，也不暴露两种情况的差异

#### Scenario: 跨 Workspace Project 被错误关联
- **WHEN** 查询或持久数据试图把另一 Workspace 的 Project/Project Membership 纳入当前列表
- **THEN** Core API 拒绝该关系或排除该记录并产生安全可观测的完整性信号，绝不向客户端返回跨 Workspace Project

#### Scenario: Project list 暂不可用
- **WHEN** Core API 无法安全读取或授权 Project list
- **THEN** Core API 返回 `503 PROJECTS_TEMPORARILY_UNAVAILABLE`，可在适用时提供 `retryAfterSeconds`

### Requirement: Desktop 只通过窄 Project list capability 读取数据
Renderer MUST NOT 直接调用 Project HTTP endpoint。Main SHALL 固定 Core API origin、method、path template 和 query allowlist，Preload 只暴露 typed `listProjects` capability，并校验 sender、frame、active session generation、`workspaceId`、cursor 和 limit。access token、内部角色、持久化实体和通用 HTTP 能力 MUST NOT 穿过 Preload。

#### Scenario: Renderer 请求当前 Workspace 的 Project
- **WHEN** Renderer 为活动 `workspaceId` 调用 typed Project list capability
- **THEN** Main 使用当前 session 调用固定 endpoint，并只向 Renderer 返回安全 Project page 或稳定错误 union

#### Scenario: 非活动或陈旧 Workspace 请求
- **WHEN** 请求的 `workspaceId` 不等于当前活动 Workspace，或请求属于旧 session generation
- **THEN** Main 拒绝或丢弃请求/结果，不向 Renderer 发布 Project 数据

#### Scenario: Project API 返回 401
- **WHEN** Project list 请求返回 `401`
- **THEN** Main 使用统一的 per-generation single-flight refresh 规则；成功后原请求最多重试一次，终止失败清除全部受保护状态，暂态失败隐藏 Project 数据并进入可恢复的 temporarily-unavailable 状态

### Requirement: Project list 与 Workspace 和账号作用域隔离
Project query key SHALL 至少包含 environment、`UserId` 和 `WorkspaceId`。选择或恢复活动 Workspace 后才可加载 Project；切换 Workspace、账号或 environment，登出，Workspace 授权撤销，或 session generation 失效时，Desktop MUST 取消或隔离旧请求并清理不再授权的 Project state。每个返回 item 的 `workspaceId` MUST 与请求 scope 相同，否则整页失败并记录脱敏 contract violation。

#### Scenario: Workspace 切换时旧响应迟到
- **WHEN** Workspace A 的 Project 响应在用户切换到 Workspace B 后到达
- **THEN** Desktop 不把 A 的 items、empty state、error 或 cursor 发布到 B 的界面或缓存

#### Scenario: 账号或 environment 改变
- **WHEN** Desktop 切换 User 或 environment
- **THEN** 它不复用前一 namespace 的 Project items、cursor、选中状态或错误状态

#### Scenario: 响应包含错误 WorkspaceId
- **WHEN** 任一 Project item 的 `workspaceId` 与请求的活动 Workspace 不同
- **THEN** Main 将整页视为 contract violation，不返回部分数据，并避免在日志中记录敏感业务内容

### Requirement: Project list 提供真实 loading、empty、error 和分页状态
进入活动 Workspace 后，Renderer SHALL 展示 Project list 的结构稳定 loading state；真实 `items: []` SHALL 展示无 Project 空状态；`404 WORKSPACE_NOT_FOUND` SHALL 清除活动 Workspace 和对应 scoped state 后回到安全 Workspace 恢复流程；`503 PROJECTS_TEMPORARILY_UNAVAILABLE` 或网络失败 SHALL 显示可重试错误且不得伪造空列表。Project 创建不在本 Change 中，因此任何状态都 MUST NOT 显示 Create Project CTA、disabled 创建承诺或 `canCreateProject`。

#### Scenario: 真实空 Project list
- **WHEN** 首次 Project list 请求成功返回空 items
- **THEN** Renderer 显示“此 Workspace 中还没有你可访问的 Project”类空状态和刷新操作，不显示创建 Project 操作

#### Scenario: 暂时无法读取 Project
- **WHEN** 网络失败或服务端返回暂不可用
- **THEN** Renderer 区分错误与空状态、隐藏未经确认或已失去授权的陈旧数据，并提供安全重试

#### Scenario: Workspace 授权已撤销
- **WHEN** Project list 返回 `WORKSPACE_NOT_FOUND`
- **THEN** Desktop 清除活动 `WorkspaceId` 和对应 Project cache，重新加载 Workspace list 并按 0/1/N 规则恢复

### Requirement: Project list 独立于 Project 创建和 Agent Runtime
Project list 的 Core API 查询、Main/Preload capability、Renderer surface 和测试 MUST NOT 调用 Project create endpoint、展示创建 CTA、启动或探测 Agent Runtime。Project create/detail/update、Project Members 管理、Board 和 Project-scoped navigation 需要后续独立 Change。

#### Scenario: Project list 正常或为空
- **WHEN** Desktop 展示任意 Project list 状态
- **THEN** 不存在 Project mutation、`canCreateProject`、Runtime 调用或硬编码 Project 数据
