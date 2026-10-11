# Desktop API Documentation Delta

## MODIFIED Requirements

### Requirement: Desktop 首次使用 API 具有可视化运行时文档
Core API SHALL 为已实现的 Desktop HTTP API 生成运行时 OpenAPI 描述和 Swagger UI。文档 SHALL 区分匿名认证 capability/attempt/callback/poll/registration/delivery endpoint、refresh credential endpoint 与 bearer-protected endpoint，准确描述请求/响应 schema、成功状态、共享 Problem Details、稳定错误 `code`、字段 `path` 和适用的 `retryAfterSeconds`，且 MUST NOT 把浏览器 callback、`PENDING_DELIVERY` session 或 delivery ACK/abandon 建模为 TaskPilot bearer-authenticated 入口。

#### Scenario: 查看首次使用 API
- **WHEN** 开发者在允许文档的环境打开 Swagger UI
- **THEN** 页面展示认证 capability、GitHub 登录尝试创建、GitHub callback、attempt polling/cancel、首次注册确认、delivery ACK/abandon、session refresh/logout、当前用户、Workspace list/create 和 Workspace-scoped Project list 接口，以及各自认证要求与响应模型；不再展示邮箱发码、验码、密码登录、邮箱注册或密码重置接口

#### Scenario: 检查 attempt 创建与 completion URI 契约
- **WHEN** 自动化读取登录尝试创建的 OpenAPI schema
- **THEN** 匿名 `POST /desktop/v1/auth/federated/attempts` 只接受受控 `provider=github`、bounded installation identifier 和精确 `http://127.0.0.1:<ephemeral-port>/taskpilot/oauth/complete/<nonce>` completion URI，并描述不允许 hostname、非 loopback 地址、默认或特权端口、userinfo、query、fragment、路径穿越或客户端自定义 Provider endpoint

#### Scenario: 检查 poll 与首次注册交付契约
- **WHEN** 自动化读取 poll 和 registration schema
- **THEN** `POST /desktop/v1/auth/federated/attempts/{attemptId}/poll` 明确把 poll secret、可选于安全状态读取但领取身份结果时必需的 browser completion proof、以及预先持久化的 `deliveryRequestId` 放在请求 body；`POST /desktop/v1/auth/federated/registrations` 明确要求 Main 私有的 registration continuation、同一 `deliveryRequestId`、display name、头像选择和当前条款版本；两者描述相同 request id 在恢复窗口内确定性返回同一注册预览或加密 session delivery，且不同 request id 不创建第二个 session；registration preview 与 session delivery 响应分别包含该阶段由 Core API 决定的 `expiresAt`

#### Scenario: 检查 delivery ACK 与 abandon 契约
- **WHEN** 自动化读取 session delivery 路径和安全声明
- **THEN** `POST /desktop/v1/auth/federated/deliveries/{deliveryId}/ack` 与 `POST /desktop/v1/auth/federated/deliveries/{deliveryId}/abandon` 明确把独立 delivery secret 放在 body、声明幂等语义且不要求 bearer；ACK 前的 `PENDING_DELIVERY` access/refresh credential 不得被描述为可调用 current-user、protected、refresh 或 recovery endpoint，只有 ACK 后的 `ACTIVE` session 才进入正常 bearer/refresh 契约

#### Scenario: 检查匿名、refresh 与 bearer-protected 接口
- **WHEN** 自动化读取生成的 OpenAPI
- **THEN** capability、登录尝试创建和 GitHub callback 不错误声明 TaskPilot bearer；poll/cancel 明确声明 attempt id 与 poll secret 语义且不把 secret 放在 URL；首次注册确认声明 Main 私有 continuation；refresh 描述 ACTIVE session refresh credential 与 `refreshRequestId`；`GET /desktop/v1/me`、`GET /desktop/v1/workspaces`、`POST /desktop/v1/workspaces` 和 `GET /desktop/v1/workspaces/{workspaceId}/projects` 明确声明 access bearer；logout 按实现声明 ACTIVE session credential

#### Scenario: 检查 Workspace list/create 契约
- **WHEN** 自动化检查 Workspace OpenAPI
- **THEN** list 固定为 `GET /desktop/v1/workspaces` 与 `200 { items: [{ workspaceId, name, type }], capabilities: { canCreateWorkspace, createWorkspaceReasonCode? } }`；create 固定为 `POST /desktop/v1/workspaces`、必需 `Idempotency-Key`、仅 `{ name }` body、首次 `201` 和确定性重放 `200` 均返回 `{ workspaceId, name, type }`，并记录 `401/400/403/409/503` 及稳定 Workspace error code

#### Scenario: 检查 Project list 契约
- **WHEN** 自动化检查 Project list OpenAPI
- **THEN** 路径固定为 bearer-protected `GET /desktop/v1/workspaces/{workspaceId}/projects`，只接受可选 opaque `cursor` 和整数 `limit`（默认 50、范围 1–100），并描述 `200 { items: [{ projectId, workspaceId, name }], nextCursor? }`、`400 VALIDATION_FAILED`、`401 AUTHENTICATION_REQUIRED`、`404 WORKSPACE_NOT_FOUND` 与 `503 PROJECTS_TEMPORARILY_UNAVAILABLE`

#### Scenario: API 形状发生漂移
- **WHEN** Controller、transport model、安全声明或稳定错误 code 改变但文档契约测试未同步满足预期
- **THEN** 自动化检查失败并指出缺失、不应继续存在或不一致的路径、schema、安全声明或错误响应

### Requirement: 文档和交互请求不得持久化秘密
OpenAPI 描述、Swagger UI、示例值和文档相关日志 MUST NOT 嵌入真实 OAuth code/state、PKCE verifier、poll secret、browser completion proof、loopback nonce、registration continuation、delivery id、`deliveryRequestId`、delivery ACK/abandon secret、GitHub token/client secret、TaskPilot access/refresh token、`refreshRequestId`、credential handle 或真实用户数据。Swagger UI SHALL 禁用持久化授权；Local/Test 中临时输入的 bearer、attempt 或 delivery credential 最多存在于当前页面会话内。

#### Scenario: 检查生成文档
- **WHEN** 自动化测试读取生成的 OpenAPI JSON 和示例
- **THEN** 文档只包含显式测试占位值，不包含真实或环境注入的 OAuth、GitHub、attempt、completion、continuation、delivery、TaskPilot token、request id 或个人资料秘密，也不生成看似可复用的秘密示例

#### Scenario: 通过 Swagger 发起请求
- **WHEN** 开发者在允许环境临时输入认证材料使用 Try it out
- **THEN** 材料不得进入浏览器持久存储、仓库、生成报告或服务端应用日志，刷新或关闭页面后不保留

### Requirement: 第一阶段保持运行时文档范围
第一阶段 SHALL 以运行时 OpenAPI、契约测试和 Swagger UI 作为 Desktop API 可视化能力；GitHub 联合认证、Workspace onboarding 及紧随其后的 Project list 不要求提交独立版本化 OpenAPI 文件、生成 Desktop 客户端或执行 breaking-change compatibility gate。后续需要跨版本兼容承诺或客户端生成时 MUST 通过独立 Change 评估 source-of-truth、迁移和 drift 策略。

#### Scenario: 构建首个 Desktop API
- **WHEN** 本 Change 实现和验证 GitHub 认证、Workspace onboarding 与 Project list 接口
- **THEN** 构建无需维护第二份手写 OpenAPI 文件或生成客户端即可通过，但运行时文档契约测试仍须覆盖全部现存 auth、Workspace onboarding 和 Project list 路径并确认邮箱认证路径已移除

#### Scenario: 请求扩大契约治理范围
- **WHEN** 后续工作需要版本化 schema、自动生成客户端或兼容性门禁
- **THEN** 团队先建立独立设计和迁移方案，而不是在本 Change 中隐式扩展
