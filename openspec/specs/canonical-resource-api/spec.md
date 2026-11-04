# Canonical Resource Api Specification

## Purpose

为 TaskPilot 提供一套按业务资源与稳定身份建模的 canonical user resource API，使 Desktop、未来 Web/Mobile/CLI 以及协议 adapter 共享同一业务语义、授权和 application use case，而不按客户端复制 API。

## Requirements

### Requirement: 当前 HTTP 能力使用唯一 canonical `/v1` surface
Core API SHALL 只通过 `/v1/**` 暴露当前 user resource API；路径 MUST 以业务资源、资源关系或明确 custom method 命名，MUST NOT 包含 `desktop`、`web`、`mobile`、`cli`、`mcp` 或其他客户端名称。当前 `/desktop/v1/**` SHALL 一次性退役，不提供兼容路由、重定向或代理别名；第一方客户端 MUST 共享同一 path、request/response schema、错误语义和 application use case。

#### Scenario: 不同第一方客户端使用同一资源
- **WHEN** Desktop 或未来 Web、Mobile、CLI 读取同一 Project
- **THEN** 它们使用同一个 `/v1/projects/{projectId}` contract，而不是客户端专属路径、Controller 或业务 schema

#### Scenario: 旧 Desktop path 被请求
- **WHEN** 调用方请求任意 `/desktop/v1/**`
- **THEN** Gateway 与 Core API 均不匹配旧业务路由，且 MUST NOT 重定向或静默转发到 `/v1/**`

#### Scenario: 新客户端接入
- **WHEN** 新增第一方客户端且所需业务语义已由 canonical API 提供
- **THEN** 新客户端复用既有 operation，不为客户端身份复制 DTO、Controller 或 application use case

### Requirement: canonical path 以资源身份和关系组织
集合创建与列表 SHALL 位于拥有关系下，稳定 ID 可唯一定位的单资源读取与修改 SHALL 使用短资源路径；Core API MUST 从权威持久化归属重新校验 scope，不得因短路径省略父级而放宽授权。非 CRUD 生命周期转换 SHALL 使用 `:customMethod`，不得伪装成客户端专属 endpoint 或通用 status PATCH。

当前 canonical path 集合 SHALL 精确包含：

```text
GET  /v1/authentication-capabilities
POST /v1/federated-login-attempts
GET  /v1/provider-callbacks/github/oauth
POST /v1/federated-login-attempts/{attemptId}:poll
POST /v1/federated-login-attempts/{attemptId}:cancel
POST /v1/federated-registrations
POST /v1/session:refresh
POST /v1/session:logout
GET  /v1/me

GET  /v1/workspaces
GET  /v1/workspaces/{workspaceId}/projects
POST /v1/workspaces/{workspaceId}/projects
GET  /v1/projects/{projectId}
PATCH /v1/projects/{projectId}
POST /v1/projects/{projectId}:archive
POST /v1/projects/{projectId}:restore
POST /v1/projects/{projectId}:permanentlyDelete
GET  /v1/projects/{projectId}/members

GET  /v1/projects/{projectId}/boards
POST /v1/projects/{projectId}/boards
GET  /v1/boards/{boardId}
PATCH /v1/boards/{boardId}
POST /v1/boards/{boardId}:permanentlyDelete
POST /v1/boards/{boardId}/columns
PATCH /v1/columns/{columnId}
DELETE /v1/columns/{columnId}
PUT  /v1/boards/{boardId}/column-order
POST /v1/boards/{boardId}/work-items
GET  /v1/work-items/{workItemId}
PATCH /v1/work-items/{workItemId}
POST /v1/boards/{boardId}/placements/{workItemId}:move
```

#### Scenario: 列出或创建拥有资源
- **WHEN** User 列出或创建 Workspace 下的 Project，或 Project 下的 Board
- **THEN** operation 使用对应 owner collection path，并由 Core API 以真实 Membership 和归属授权

#### Scenario: 读取稳定 ID 资源
- **WHEN** User 通过 `/v1/projects/{projectId}`、`/v1/boards/{boardId}`、`/v1/columns/{columnId}` 或 `/v1/work-items/{workItemId}` 操作单资源
- **THEN** Core API 解析该资源真实 Workspace/Project/Board 归属并执行既有授权与 not-found 防泄漏语义

#### Scenario: 执行生命周期动作
- **WHEN** Project OWNER 归档 Project 或永久删除经确认的 Project/Board
- **THEN** operation 使用已声明的 custom method，并继续执行既有 expected version、精确名称、权限、事务和冲突规则

#### Scenario: 组合资源身份不一致
- **WHEN** move Placement 的 `boardId` 与 `workItemId` 不属于同一合法 Board/Project 组合
- **THEN** Core API 以既有 not-found 语义拒绝且不泄露资源真实归属

#### Scenario: 查询 Project Member 候选集合
- **WHEN** User 查询当前 Project 的可选责任人成员
- **THEN** operation 使用 `GET /v1/projects/{projectId}/members`，由 Core API 从 Project 持久化归属解析 Workspace scope、执行 OWNER 授权，并只返回该 Project 的 eligible members

### Requirement: canonical contract 保留当前业务和安全语义
路径迁移 SHALL 保留当前 request/response schema、HTTP success status、共享 Problem Details、稳定错误 code、幂等 key、expected version、排序、分页、事务回滚、认证方式和 secret hygiene；除路径及 surface 命名外，本 Change MUST NOT 改变业务结果。Core API SHALL 继续拥有最终认证与 Workspace/Project/Object 授权，Gateway 或客户端传入的 resource scope/header MUST NOT 替代权威校验。

#### Scenario: path 迁移后的成功操作
- **WHEN** 当前有效的 Project、Board、Column、Work Item 或 Placement 请求改用对应 canonical path
- **THEN** 它返回与迁移前相同的 schema、success status 和权威业务结果

#### Scenario: path 迁移后的错误操作
- **WHEN** 请求触发 validation、authentication、not-found、authorization、idempotency、version 或 protected-dependency 失败
- **THEN** 它继续返回现有共享 Problem Details 与稳定 code，而不是由 Gateway 改写成业务成功或新的客户端专属错误

#### Scenario: 伪造 scope metadata
- **WHEN** 调用方伪造 Workspace、Project、User 或角色相关 header，或请求属于其他 User 的稳定资源 ID
- **THEN** Core API 忽略不受信 scope 并根据 ACTIVE session 与持久化事实重新授权

### Requirement: checked-in OpenAPI 是 canonical HTTP contract source
仓库 SHALL 在 `contracts/canonical-api/openapi.yaml` 维护唯一 canonical HTTP contract；该 artifact SHALL 完整拥有 method/path、稳定且唯一的 `operationId`、parameters、HTTP wire request/response schema、success/error status、标准 security、共享 Problem Details、description/tag 以及每个 operation 的显式 `x-taskpilot-ingress`。Controller 注解、Core 手工映射、测试期望表、Gateway 配置或客户端代码 MUST NOT 形成独立的 method/path 或 wire-schema source。`/desktop/v1/**`、未实现 capability、Gateway management endpoint、managed-execution、future public API 和 future MCP tools MUST NOT 混入该 contract。

#### Scenario: 校验 canonical artifact
- **WHEN** 开发者或 CI 校验 `contracts/canonical-api/openapi.yaml`
- **THEN** path 集合精确等于当前 canonical user resource API，每个 operation 都有唯一 `operationId`、完整安全/Schema/状态/错误声明和受支持的显式 ingress 值

#### Scenario: 检查退役或其他 surface
- **WHEN** 自动化检查 canonical artifact
- **THEN** `/desktop/v1/**`、Gateway management、managed-execution、public API、MCP 和未实现业务 path 均不存在

#### Scenario: contract 或实现漂移
- **WHEN** canonical artifact、生成产物、Core HTTP adapter、served OpenAPI 或 Gateway route manifest 的 operation 集合及语义不一致
- **THEN** 对应 validation/build/contract gate 失败，而不是继续发布或暴露不一致的 API

#### Scenario: 文档处理秘密
- **WHEN** 校验 canonical artifact、生成文档或通过 Swagger 调用认证 operation
- **THEN** artifact 与文档不包含真实 token、poll secret、completion proof、continuation、OAuth code/state 或 provider credential，且 Swagger 不得持久化 Try-it-out credential

### Requirement: canonical contract 在构建期生成 Core HTTP adapter 边界
构建 SHALL 从 canonical OpenAPI 生成 Core Spring HTTP interfaces、HTTP wire models 与适用的 validation metadata；生成代码 SHALL 只属于 HTTP adapter 边界，MUST NOT 生成或替代 domain model、application use case、业务授权、repository、persistence entity 或 migration。手写 Core adapter SHALL 实现生成接口，并显式映射到既有 application/domain types；生成产物 MUST 可从干净 checkout 确定性重建且 MUST NOT 提交到 Git。

#### Scenario: 从干净 checkout 构建 Core
- **WHEN** 在没有既有 build 输出的 checkout 编译 Core API
- **THEN** Gradle 先验证 canonical OpenAPI、生成 interfaces/wire models，再编译手写 HTTP adapter，且不要求人工复制生成文件

#### Scenario: HTTP contract 改变但 adapter 未实现
- **WHEN** canonical OpenAPI 新增、删除或修改 operation、参数或 wire schema，而手写 Core adapter 尚未匹配
- **THEN** compile 或 contract verification 失败并定位到 HTTP adapter 边界

#### Scenario: 检查生成边界
- **WHEN** 架构或 build-contract gate 检查生成源码及生产依赖
- **THEN** 生成类型只存在于批准的 HTTP adapter package/build output，application/domain/persistence 不依赖生成 transport 类型

#### Scenario: 生成结果可复现
- **WHEN** 使用固定工具版本对同一 canonical OpenAPI 连续执行生成
- **THEN** operation、接口和 wire model 结果确定一致，且仓库没有 tracked generated source

### Requirement: Local/Test 文档确定性展示 canonical contract
Contract build SHALL 将已校验的 canonical OpenAPI 作为只读资源打包给 Core API；Core API SHALL 在 Local/Test 的 `/v3/api-docs` 直接解析并序列化该 packaged artifact 的 JSON 表示，Swagger UI SHALL 只消费该 endpoint，而不是通过运行时 mapping discovery、生成接口或 Controller 注解重新推导第二份契约。Production 默认 MUST 关闭 OpenAPI/Swagger 入口，Gateway/public origin MUST NOT 暴露该文档。served document MAY 包含 YAML/JSON 格式和键顺序等非语义序列化差异，但 paths、operations、components、security、responses、descriptions、tags 与 TaskPilot extensions 必须和 canonical artifact 语义一致。

#### Scenario: 读取 Local/Test OpenAPI
- **WHEN** 自动化在 Local/Test 读取 `/v3/api-docs`
- **THEN** 文档与 `openapi.yaml` 在规范化后的 paths、operations、components、security、responses 和 TaskPilot extensions 上完全一致

#### Scenario: Controller 不能反向扩展契约
- **WHEN** 手写 Controller/adapter 增加未在 canonical OpenAPI 声明的映射
- **THEN** contract gate 失败，且该 route 不因 runtime annotation scanning 自动成为 canonical operation 或 Gateway route

#### Scenario: Production 或 Gateway 文档入口
- **WHEN** 调用方在 Production Core 或任意 Gateway 环境请求 OpenAPI/Swagger
- **THEN** 文档入口不可达，且 Gateway 不把请求转发到 Core 文档 endpoint

### Requirement: 联合登录 OpenAPI 区分浏览器与第一方客户端秘密
OpenAPI SHALL 把 authentication capability、federated login attempt 创建、GitHub callback、poll、cancel 和 registration 描述为不使用 TaskPilot access bearer 的 operation，并明确 poll secret、completion proof 和 registration continuation 只属于受信第一方客户端 transport。秘密 SHALL 位于请求 body 或服务端状态，不得进入 URL path、query example 或 Renderer contract。

#### Scenario: 检查 attempt 创建
- **WHEN** 自动化读取 `POST /v1/federated-login-attempts` 的 schema
- **THEN** 请求只包含 `provider`、`installationId` 和受限 loopback `completionUri`，响应包含 `attemptId`、`pollSecret`、GitHub `authorizationUrl` 与 `expiresAt`，并记录 `201/400/429/503`

#### Scenario: 检查 callback
- **WHEN** 自动化读取 `GET /v1/provider-callbacks/github/oauth`
- **THEN** callback 只接受 GitHub 的 `code`、`state` 或 denial error，返回安全 HTML，且不声明或要求 TaskPilot access bearer

#### Scenario: 检查 poll 与 cancel
- **WHEN** 自动化读取 federated login attempt 的 `:poll` 与 `:cancel` operation
- **THEN** poll body 包含 `pollSecret` 和可选 `completionProof`，响应状态只通过 `FederatedPollResponse` 表达等待、proof required、注册或 authenticated session；cancel body 只包含 `pollSecret`，两者均不把秘密放进 URL

#### Scenario: 检查首次注册
- **WHEN** 自动化读取 `POST /v1/federated-registrations`
- **THEN** 请求包含客户端私有的 continuation id/secret、显示名称、头像选择及完整法律文档组合，成功 `201` 返回 `FederatedPollResponse` 中的 ACTIVE session，并记录校验、上下文、法律版本和暂时不可用错误

### Requirement: Session 与 current-user OpenAPI 准确声明认证方式
OpenAPI SHALL 使用 `x-taskpilot-authentication` 和标准 security declaration 区分 refresh credential body 与 access bearer。成功 refresh SHALL 返回一组轮换后的 access/refresh token 与当前用户；logout 和 `GET /v1/me` SHALL 要求 access bearer。

#### Scenario: 检查 refresh
- **WHEN** 自动化读取 `POST /v1/session:refresh`
- **THEN** operation 声明 `refresh-credential-body`，请求只有 `refreshToken`，成功 `200` 返回 `SessionResponse`，且不要求或描述 request id recovery

#### Scenario: 检查 logout
- **WHEN** 自动化读取 `POST /v1/session:logout`
- **THEN** operation 声明 `access-bearer` 和 `accessBearer` security，成功状态为 `204`，无效 bearer 返回 `401`

#### Scenario: 检查当前用户
- **WHEN** 自动化读取 `GET /v1/me`
- **THEN** operation 声明 `access-bearer`，成功 schema 只包含 `userId`、`displayName` 和可选 `avatarUrl`，无效 bearer 返回 `401`

### Requirement: canonical OpenAPI 使用共享 Problem Details
所有记录失败响应的 canonical operation SHALL 引用统一 `TaskPilotProblemDetails` schema；schema SHALL 可表达 `type`、`title`、HTTP `status`、`detail`、`instance`、稳定 `code`、`correlationId`、可选字段 `path` 和可选 `retryAfterSeconds`。

#### Scenario: 校验失败和限流
- **WHEN** 文档描述 `400` 或 `429` 响应
- **THEN** 响应 media type 为 `application/problem+json`，并可通过 `path` 指向安全字段、通过 `retryAfterSeconds` 指示重试窗口

#### Scenario: 认证、冲突、过期或暂时不可用
- **WHEN** 文档描述 `401`、`409`、`410` 或 `503`
- **THEN** 响应复用同一 `TaskPilotProblemDetails` schema，而不是为每个 Controller 创建不一致的错误 body

### Requirement: canonical API 文档按环境安全暴露
OpenAPI JSON 和 Swagger UI SHALL 在 Local/Test 环境默认启用，并在 Production 默认禁用。Production MUST NOT 仅依赖隐藏链接保护文档 endpoint；未来若要启用生产文档，需要独立访问控制决策。

#### Scenario: Local 或 Test
- **WHEN** Core API 使用批准的 Local 或 Test 配置启动
- **THEN** OpenAPI JSON 和 Swagger UI 可用于开发与自动化验证，且不放宽业务接口认证、限流或秘密处理

#### Scenario: Production 默认配置
- **WHEN** Core API 使用 Production 默认配置启动
- **THEN** OpenAPI JSON、Swagger UI 及相关静态资源不可访问，canonical user resource API 仍保持原安全策略

### Requirement: canonical OpenAPI 和 Swagger 不持久化秘密
OpenAPI description、schema example、Swagger UI 和文档相关日志 MUST NOT 嵌入真实 OAuth code/state、PKCE verifier、poll secret、completion proof、loopback nonce、registration continuation、GitHub token/client secret、TaskPilot access/refresh token、OS credential handle 或真实用户资料。Swagger UI SHALL 配置 `persistAuthorization=false`。

#### Scenario: 检查生成文档
- **WHEN** 自动化读取 OpenAPI JSON 及其序列化文本
- **THEN** secret-bearing 字段没有 example/default，文档不包含测试注入的 sentinel 或环境真实值

#### Scenario: 使用 Swagger Try it out
- **WHEN** 开发者在允许环境临时输入 bearer、attempt 或 continuation credential
- **THEN** Swagger 不把授权材料写入持久化浏览器存储，刷新或关闭页面后不保留

### Requirement: Workspace 与 Project OpenAPI 准确声明范围和并发控制
Workspace 列表和 Workspace 下 Project 集合 operation SHALL 在 path 中携带 `workspaceId`（`GET /v1/workspaces` 除外）；稳定 Project ID 的单资源 operation SHALL 使用 `/v1/projects/{projectId}` 及其 custom method，并由 Core API 从持久化事实解析 Workspace scope。所有 operation SHALL 要求 access bearer。Project schema SHALL 表达稳定 ID、Workspace 归属、名称、描述、状态、版本和审计时间；创建 SHALL 记录 request id 幂等契约，编辑、归档、恢复和永久删除 SHALL 记录 expected version 冲突，永久删除 SHALL 记录当前名称确认以及成功删除已批准的 Board、Column、Placement 与 Work Item 子资源。成功响应 SHALL 固定为：创建 `201 + ProjectView`，列表和详情 `200`，编辑 `200 + ProjectView`，归档和恢复 `200 + ProjectView`，永久删除无响应体 `204`。

#### Scenario: 检查 Workspace 列表
- **WHEN** 自动化读取 `GET /v1/workspaces`
- **THEN** operation 声明 `access-bearer`，成功返回当前 User 可访问 Workspace 及角色，当前实现只返回 PERSONAL Workspace

#### Scenario: 检查 Project 创建与读取
- **WHEN** 自动化读取 Project list/detail/create schema
- **THEN** 文档声明 ACTIVE/ARCHIVED 筛选、确定性排序、必填名称、可选描述、actor+Workspace scoped request id 幂等和 duplicate-name 允许语义

#### Scenario: 检查 Project 写操作
- **WHEN** 自动化读取 edit/archive/restore/permanent-deletion operation
- **THEN** 文档区分创建所需 Workspace OWNER 与已有 Project 写操作所需 Project OWNER，声明 access bearer、权威解析的 Workspace/Project scope、expected version、上述精确成功响应、共享 Problem Details 以及适用的 `400/401/404/409/503` 响应

#### Scenario: 检查永久删除
- **WHEN** 自动化读取 Project permanent-deletion 请求
- **THEN** 请求只包含 expected version 和 confirmation name，不把 Project 名称放进 URL，并记录不可恢复、名称不匹配、并发冲突和受保护依赖冲突

#### Scenario: 检查 Project Work 永久删除说明
- **WHEN** 自动化读取 Project permanent-deletion operation
- **THEN** 文档说明成功删除会在同一事务内删除该 Project 已批准的 Board、Column、Placement 与 Work Item，未知受保护依赖仍返回冲突

### Requirement: Project Work OpenAPI 准确声明范围、幂等与并发控制
Board 集合 operation SHALL 位于 `/v1/projects/{projectId}/boards`，Board 下 Column 与 Work Item 创建及布局写入 SHALL 位于对应 `/v1/boards/{boardId}` owner path；稳定 Board、Column 和 Work Item ID 的单资源 operation SHALL 使用短资源 path，并由 Core API 从持久化事实重新解析 Workspace、Project 与 Board scope。所有 operation SHALL 要求 access bearer，并以 not-found 语义拒绝跨 Workspace、Project 或 Board 的组合 ID。Board 与 Work Item 创建 SHALL 文档化 request id 幂等契约；所有可变资源和 Board 布局写入 SHALL 文档化 expected version、稳定冲突和权威重载路径。Work Item 与 Card response schema SHALL 包含各自当前权威内容、版本和位置所需字段，并 MUST NOT 包含尚未形成当前能力的 `lifecycle`、`status` 或固定 `OPEN` 占位字段。所有 operation SHALL 使用共享 Problem Details，并记录适用的 `400/401/404/409/503` 响应。

#### Scenario: 检查 Board 与 Column 契约
- **WHEN** 自动化读取 Board list/create/detail/edit/permanent-deletion 与 Column create/edit/reorder/delete operation
- **THEN** 文档声明 Project OWNER 授权、Board 创建 `201`、Board 列表按 `createdAt` 与 `boardId` 确定性排序、普通读取和修改 `200`、空 Board permanent-deletion `204`、Column 删除 `204` 且客户端随后重读布局、初始 Column 原子创建、最后或非空 Column 删除冲突以及 Board 布局版本

#### Scenario: 检查 Work Item 与 Placement 契约
- **WHEN** 自动化读取 Board 内 Work Item create、Work Item detail/edit 和 Placement move operation
- **THEN** 文档声明创建 `201`、普通读取和修改 `200`、Card 复用 `workItemId`、创建请求携带 expected Board version、Work Item 与 Placement 原子提交并递增 Board version、过期创建不留下记录、移动返回 `200` 权威 Board 布局，且 Work Item 与 Card schema 不含 lifecycle 或 status

#### Scenario: 检查 Project Work 创建幂等
- **WHEN** 自动化读取 Board、Column 或 Board 内 Work Item 创建请求
- **THEN** schema 包含 UUID request id，文档声明 actor 与所属 Project scope、规范化 payload 重试和不同 payload 复用的幂等冲突；Work Item 创建 payload 还包含 expected Board version，同键同载荷成功重试返回原结果

#### Scenario: 检查跨范围组合 ID
- **WHEN** 自动化构造其他 Workspace、Project 或 Board 的 Board、Column、Work Item 或 Placement ID 组合
- **THEN** contract 记录 not-found 与共享 Problem Details，不泄露资源真实归属

### Requirement: protocol adapter 复用同一 application use case
未来 Public Developer API、managed-execution、provider callback 与 MCP/tool surface MAY 因 credential、信任边界或协议不同拥有独立 adapter，但 MUST 复用 canonical resource semantics 和既有 application use case，MUST NOT 为 Desktop、Web、Mobile、CLI 或 MCP 创建平行的业务真相。仅当独立产品契约确有不同的兼容周期、字段暴露、调用模型或安全策略时，MAY 增加薄 adapter；差异必须显式记录且不得复制业务不变量。

#### Scenario: 增加 MCP tool
- **WHEN** 未来新增 `create_work_item` 或 `archive_project` tool
- **THEN** tool adapter 调用既有 application use case，并继承同一授权、幂等、并发和业务失败语义，而不是要求 MCP 专属业务 Controller

#### Scenario: 增加 public developer surface
- **WHEN** 未来开放某个既有资源 operation
- **THEN** 默认通过 credential scope、route allowlist、quota、字段暴露与发布文档形成边界，并复用相同资源语义和 use case

#### Scenario: 信任边界不同
- **WHEN** provider callback 或 managed execution 使用不同 credential 与重放模型
- **THEN** 它使用独立安全 adapter，但不能绕过 Core API 最终业务授权或直接写业务数据库

### Requirement: canonical contract 描述人员摘要和责任人契约
Checked-in canonical OpenAPI SHALL 描述 `PersonSummary`、Project Member 列表、Work Item `createdBy`、Work Item/Card `assignee` 目标和责任人 mutation 契约。`assignee` SHALL 可为 `null`，当前唯一支持目标类型为 `PROJECT_MEMBER`，且请求中选择的 membership 必须属于目标 Work Item 所在 Project。OpenAPI SHALL 描述责任人相关成功响应、稳定 validation 错误、not-found/authorization 语义、Work Item version conflict、暂时错误和共享 Problem Details。文档和示例 MUST NOT 包含真实用户资料、真实头像 URL 中的秘密参数、access/refresh token 或未来 Agent 选择的未实现路径。

#### Scenario: OpenAPI 展示 Work Item 责任人字段
- **WHEN** 开发者查看 canonical OpenAPI 中的 Work Item detail、create/edit response 或 Card schema
- **THEN** schema 描述 `createdBy`、可为空 `assignee`、`PROJECT_MEMBER` 目标摘要和禁止 lifecycle/status 占位字段的当前契约

#### Scenario: OpenAPI 展示 Project Member 列表
- **WHEN** 开发者查看 `GET /v1/projects/{projectId}/members`
- **THEN** 文档说明该 API 要求 access bearer、使用 Project path scope，并返回可用于责任人选择的 Project Member 摘要

#### Scenario: OpenAPI 记录责任人错误
- **WHEN** 责任人 mutation 因非项目成员、未知 membership、inactive 用户、unsupported target type 或过期 Work Item version 失败
- **THEN** 文档描述对应 Problem Details `code`、HTTP 状态和客户端应重新读取权威 Work Item/Board 的路径

#### Scenario: 文档不暴露未来 Agent 假能力
- **WHEN** 当前 OpenAPI 描述责任人目标类型
- **THEN** 文档可以说明目标模型可扩展，但不得把 Agent picker、Project Agent Binding 选择或 Agent assignment endpoint 描述为当前已实现能力
