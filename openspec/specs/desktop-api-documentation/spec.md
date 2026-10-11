# Desktop API Documentation Specification

## Purpose

为当前可运行的 GitHub Auth-only Desktop HTTP API 提供与代码同步的运行时 OpenAPI 和本地 Swagger UI，明确匿名、refresh credential 与 access bearer 边界，同时避免在文档、示例或日志中持久化秘密。

## Requirements

### Requirement: 当前 Desktop API 具有准确的运行时文档
Core API SHALL 从当前 Controller 和 transport model 生成运行时 OpenAPI，并 SHALL 只把已实现的 Auth、session 和 current-user 路径描述为当前 Desktop API。文档 SHALL 描述请求/响应 schema、成功状态、共享 Problem Details、稳定错误 `code`、字段 `path`、适用的 `retryAfterSeconds` 和每个操作的认证方式。

#### Scenario: 读取当前 OpenAPI
- **WHEN** 开发者或自动化读取 `/v3/api-docs`
- **THEN** Desktop 路径集合精确包含 `GET /desktop/v1/auth/capabilities`、`POST /desktop/v1/auth/federated/attempts`、`GET /desktop/v1/auth/federated/github/callback`、`POST /desktop/v1/auth/federated/attempts/{attemptId}/poll`、`POST /desktop/v1/auth/federated/attempts/{attemptId}/cancel`、`POST /desktop/v1/auth/federated/registrations`、`POST /desktop/v1/auth/session/refresh`、`POST /desktop/v1/auth/session/logout` 和 `GET /desktop/v1/me`

#### Scenario: 未实现或退役路径
- **WHEN** 自动化检查 Desktop 路径集合
- **THEN** 邮箱发码、验码、密码登录、邮箱注册、密码重置、session delivery、refresh recovery、Workspace 和 Project 路径不出现在当前运行时文档中

#### Scenario: API 形状漂移
- **WHEN** Controller、transport model、安全声明、状态码或稳定错误 code 改变但文档契约测试未同步
- **THEN** 自动化检查失败并指出缺失、多余或不一致的路径、schema、安全声明或响应

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
- **WHEN** 构建和验证当前 GitHub Auth、session 与 current-user 路径
- **THEN** 无需维护第二份 OpenAPI 文件或生成 client，但运行时契约测试必须覆盖完整路径集合、安全声明、schema、错误响应和退役路径
