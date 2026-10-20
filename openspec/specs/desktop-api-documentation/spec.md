# Desktop API Documentation Specification

## Purpose

为当前可运行的 GitHub Auth、session、current-user、PERSONAL Workspace 与 Project Desktop HTTP API 提供与代码同步的运行时 OpenAPI 和本地 Swagger UI，明确匿名、refresh credential 与 access bearer 边界，同时避免在文档、示例或日志中持久化秘密。

## Requirements

### Requirement: 当前 Desktop API 具有准确的运行时文档
Core API SHALL 从当前 Controller 和 transport model 生成运行时 OpenAPI，并 SHALL 只把已实现的 Auth、session、current-user、Workspace、Project、Board、Column、Work Item 和 Placement 路径描述为当前 Desktop API。文档 SHALL 描述请求/响应 schema、成功状态、共享 Problem Details、稳定错误 `code`、字段 `path`、适用的 `retryAfterSeconds` 和每个操作的认证方式。

#### Scenario: 读取当前 OpenAPI
- **WHEN** 开发者或自动化读取 `/v3/api-docs`
- **THEN** Desktop 路径集合精确包含现有 Auth/session/current-user、Workspace 与 Project 路径，以及 Project 下 `GET|POST /boards`、`GET|PATCH /boards/{boardId}`、`POST /boards/{boardId}/columns`、`PATCH|DELETE /boards/{boardId}/columns/{columnId}`、`PUT /boards/{boardId}/column-order`、`POST /boards/{boardId}/work-items`、`GET|PATCH /work-items/{workItemId}` 和 `POST /boards/{boardId}/placements/{workItemId}/move`

#### Scenario: 未实现或退役路径
- **WHEN** 自动化检查 Desktop 路径集合
- **THEN** 邮箱认证、session delivery、refresh recovery、TEAM Workspace 创建/成员管理、Project 成员管理、独立 Board/Work Item 删除、Workflow、Agent、Gateway 和 public API 路径均不存在

#### Scenario: API 形状漂移
- **WHEN** Controller 路径、transport model、安全声明或响应状态变化而 OpenAPI 契约断言未同步
- **THEN** Core API 验证失败，而不是继续发布过期文档

### Requirement: 联合登录契约区分浏览器与 Desktop Main 的秘密
OpenAPI SHALL 把 capability、attempt 创建、GitHub callback、poll、cancel 和 registration 描述为非 TaskPilot bearer 操作，同时明确 poll secret、completion proof 和 registration continuation 只属于 Desktop Main。秘密 SHALL 位于请求 body 或服务端状态，不得进入 URL path、query 示例或 Renderer contract。

#### Scenario: 检查 attempt 创建
- **WHEN** 自动化读取 attempt create schema
- **THEN** 请求只包含 `provider`、`installationId` 和受限 loopback `completionUri`，响应包含 `attemptId`、`pollSecret`、GitHub `authorizationUrl` 与 `expiresAt`，并记录 `201/400/429/503`

#### Scenario: 检查 callback
- **WHEN** 自动化读取 GitHub callback
- **THEN** callback 只接受 GitHub 的 `code`、`state` 或 denial error，返回安全 HTML，且不错误声明 access bearer

#### Scenario: 检查 poll 与 cancel
- **WHEN** 自动化读取 attempt poll/cancel
- **THEN** poll body 包含 `pollSecret` 和可选 `completionProof`，响应状态只通过 `FederatedPollResponse` 表达等待、proof required、注册或 authenticated session；cancel body 只包含 `pollSecret`，两者均不把秘密放进 URL

#### Scenario: 检查首次注册
- **WHEN** 自动化读取 registration schema
- **THEN** 请求包含 Main 私有的 continuation id/secret、显示名称、头像选择及完整法律文档组合，成功 `201` 返回 `FederatedPollResponse` 中的 ACTIVE session，并记录校验、上下文、法律版本和暂时不可用错误

### Requirement: Session 与 current-user 契约准确声明认证方式
OpenAPI SHALL 用 `x-taskpilot-authentication` 和标准 security 描述区分 refresh credential body 与 access bearer。成功 refresh SHALL 返回一组轮换后的 access/refresh token 与当前用户；logout 和 `GET /me` SHALL 要求 access bearer。

#### Scenario: 检查 refresh
- **WHEN** 自动化读取 `POST /desktop/v1/auth/session/refresh`
- **THEN** 操作声明 `refresh-credential-body`，请求只有 `refreshToken`，成功 `200` 返回 `SessionResponse`，且不要求或描述 request id recovery

#### Scenario: 检查 logout
- **WHEN** 自动化读取 `POST /desktop/v1/auth/session/logout`
- **THEN** 操作声明 `access-bearer` 和 `accessBearer` security，成功状态为 `204`，无效 bearer 返回 `401`

#### Scenario: 检查当前用户
- **WHEN** 自动化读取 `GET /desktop/v1/me`
- **THEN** 操作声明 `access-bearer`，成功 schema 只包含 `userId`、`displayName` 和可选 `avatarUrl`，无效 bearer 返回 `401`

### Requirement: 文档使用共享 Problem Details
所有记录失败响应的 Desktop 操作 SHALL 引用统一 `TaskPilotProblemDetails` schema；schema SHALL 可表达 `type`、`title`、HTTP `status`、`detail`、`instance`、稳定 `code`、`correlationId`、可选字段 `path` 和可选 `retryAfterSeconds`。

#### Scenario: 校验失败和限流
- **WHEN** 文档描述 `400` 或 `429` 响应
- **THEN** 响应 media type 为 `application/problem+json`，并可通过 `path` 指向安全字段、通过 `retryAfterSeconds` 指示重试窗口

#### Scenario: 认证或暂时不可用
- **WHEN** 文档描述 `401`、`409`、`410` 或 `503`
- **THEN** 响应复用同一 Problem Details schema，而不是为每个 Controller 创建不一致的错误 body

### Requirement: API 文档按环境安全暴露
OpenAPI JSON 和 Swagger UI SHALL 在 Local/Test 环境默认启用，并在 Production 默认禁用。Production MUST NOT 仅依赖隐藏链接保护文档 endpoint；未来若要启用生产文档，需要独立访问控制决策。

#### Scenario: Local 或 Test
- **WHEN** Core API 使用批准的 Local 或 Test 配置启动
- **THEN** OpenAPI JSON 和 Swagger UI 可用于开发与自动化验证，且不放宽业务接口认证、限流或秘密处理

#### Scenario: Production 默认配置
- **WHEN** Core API 使用 Production 默认配置启动
- **THEN** OpenAPI JSON、Swagger UI 及相关静态资源不可访问，Desktop API 仍保持原安全策略

### Requirement: 文档和 Swagger 不持久化秘密
OpenAPI 描述、schema example、Swagger UI 和文档相关日志 MUST NOT 嵌入真实 OAuth code/state、PKCE verifier、poll secret、completion proof、loopback nonce、registration continuation、GitHub token/client secret、TaskPilot access/refresh token、OS credential handle 或真实用户资料。Swagger UI SHALL 配置 `persistAuthorization=false`。

#### Scenario: 检查生成文档
- **WHEN** 自动化读取 OpenAPI JSON 及其序列化文本
- **THEN** secret-bearing 字段没有 example/default，文档不包含测试注入的 sentinel 或环境真实值

#### Scenario: 使用 Swagger Try it out
- **WHEN** 开发者在允许环境临时输入 bearer、attempt 或 continuation credential
- **THEN** Swagger 不把授权材料写入持久化浏览器存储，刷新或关闭页面后不保留

### Requirement: 当前阶段只维护运行时契约
当前阶段 SHALL 以运行时 OpenAPI、契约测试和本地 Swagger UI 为 Desktop API 文档 source。它不要求第二份手写版本化 OpenAPI 文件、生成 Desktop client 或 breaking-change compatibility gate；未来需要跨版本兼容承诺时 SHALL 通过独立设计确定 source-of-truth 与迁移策略。

#### Scenario: 构建当前 Auth-only API
- **WHEN** 构建和验证当前 GitHub Auth、session、current-user、Workspace、Project、Board、Column、Work Item 与 Placement 路径
- **THEN** 无需维护第二份 OpenAPI 文件或生成 client，但运行时契约测试必须覆盖完整路径集合、安全声明、schema、错误响应和退役路径

### Requirement: Workspace 与 Project 契约准确声明范围和并发控制
所有 Workspace/Project 操作 SHALL 要求 access bearer，并在路径中显式携带 `workspaceId`。Project schema SHALL 表达稳定 ID、Workspace 归属、名称、描述、状态、版本和审计时间；创建 SHALL 记录 request id 幂等契约，编辑、归档、恢复和永久删除 SHALL 记录版本冲突，永久删除 SHALL 记录当前名称确认以及成功删除已批准的 Board、Column、Placement 与 Work Item 子资源。成功响应 SHALL 固定为：创建 `201 + ProjectView`，列表和详情 `200`，编辑 `200 + ProjectView`，归档和恢复 `200 + ProjectView`，永久删除无响应体 `204`。

#### Scenario: 检查 Workspace 列表
- **WHEN** 自动化读取 `GET /desktop/v1/workspaces`
- **THEN** 操作声明 `access-bearer`，成功返回当前 User 可访问 Workspace 及角色，当前实现只返回 PERSONAL Workspace

#### Scenario: 检查 Project 创建与读取
- **WHEN** 自动化读取 Project list/detail/create schema
- **THEN** 文档声明 ACTIVE/ARCHIVED 筛选、确定性排序、必填名称、可选描述、actor+Workspace scoped request id 幂等和 duplicate-name 允许语义

#### Scenario: 检查 Project 写操作
- **WHEN** 自动化读取 edit/archive/restore/permanent-deletion 操作
- **THEN** 文档区分创建所需 Workspace OWNER 与已有 Project 写操作所需 Project OWNER，声明 access bearer、Workspace/Project scope、expected version、上述精确成功响应、共享 Problem Details 以及适用的 `400/401/404/409/503` 响应

#### Scenario: 检查永久删除
- **WHEN** 自动化读取 permanent-deletion 请求
- **THEN** 请求只包含 expected version 和 confirmation name，不把 Project 名称放进 URL，并记录不可恢复、名称不匹配、并发冲突和受保护依赖冲突

#### Scenario: 检查 Project Work 永久删除说明
- **WHEN** 自动化读取 Project permanent-deletion 操作
- **THEN** 文档说明成功删除会在同一事务内删除该 Project 已批准的 Board、Column、Placement 与 Work Item，未知受保护依赖仍返回冲突

### Requirement: Project Work API 准确声明范围、幂等与并发控制
Board、Column、Work Item 和 Placement 操作 SHALL 要求 access bearer，并在路径中显式携带 `workspaceId` 与 `projectId`；Board 范围操作 SHALL 进一步携带 `boardId`。Core API SHALL 以 not-found 语义拒绝跨 Workspace、Project 或 Board 的组合 ID。Board 与 Work Item 创建 SHALL 文档化 request id 幂等契约；所有可变资源和 Board 布局写入 SHALL 文档化 expected version、稳定冲突和权威重载路径。所有操作 SHALL 使用共享 Problem Details，并记录适用的 `400/401/404/409/503` 响应。

#### Scenario: 检查 Board 与 Column 契约
- **WHEN** 自动化读取 Board list/create/detail/edit 与 Column create/edit/reorder/delete 操作
- **THEN** 文档声明 Project OWNER 授权、Board 创建 `201`、Board 列表按 `createdAt` 与 `boardId` 确定性排序、普通读取和修改 `200`、Column 删除 `204` 且客户端随后重读布局、初始 Column 原子创建、最后或非空 Column 删除冲突以及 Board 布局版本

#### Scenario: 检查 Work Item 与 Placement 契约
- **WHEN** 自动化读取 Board 内 Work Item create、Work Item detail/edit 和 Placement move 操作
- **THEN** 文档声明创建 `201`、普通读取和修改 `200`、Card 复用 `workItemId`、创建请求携带 expected Board version、Work Item 与 Placement 原子提交并递增 Board version、过期创建不留下记录、移动返回 `200` 权威 Board 布局，且移动不修改 Work Item 生命周期

#### Scenario: 检查 Project Work 创建幂等
- **WHEN** 自动化读取 Board、Column 或 Board 内 Work Item 创建请求
- **THEN** schema 包含 UUID request id，文档声明 actor 与所属 Project 范围、规范化 payload 重试和不同 payload 复用的幂等冲突；Work Item 创建 payload 还包含 expected Board version，同键同载荷成功重试返回原结果

#### Scenario: 检查跨范围组合 ID
- **WHEN** 自动化构造其他 Workspace、Project 或 Board 的 Board、Column、Work Item 或 Placement ID 组合
- **THEN** 契约记录 not-found 与共享 Problem Details，不泄露资源真实归属
