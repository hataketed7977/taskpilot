# Desktop API Documentation Specification

## Purpose

为本 Change 引入的认证、Workspace onboarding 与 Project list Desktop HTTP API 提供与运行时代码一致、可交互查看且不扩大生产攻击面的 OpenAPI 文档。该 capability 只拥有文档生成和暴露规则；认证行为由 `desktop-authentication` 拥有，Workspace 行为由 `workspace-onboarding` 拥有，Project 列表行为由 `project-list` 拥有。

## Requirements

### Requirement: Desktop 首次使用 API 具有可视化运行时文档
Core API SHALL 为已实现的 Desktop HTTP API 生成运行时 OpenAPI 描述和 Swagger UI。文档 SHALL 区分匿名认证 endpoint、refresh credential endpoint 与 bearer-protected endpoint，准确描述请求/响应 schema、成功状态、共享 Problem Details、稳定错误 `code`、字段 `path` 和适用的 `retryAfterSeconds`。

#### Scenario: 查看首次使用 API
- **WHEN** 开发者在允许文档的环境打开 Swagger UI
- **THEN** 页面展示注册发码/验码/创建账户、密码登录、登录验证码发码/验码、密码重置发码/验码/完成、session refresh/logout、当前用户、Workspace list/create 和 Workspace-scoped Project list 接口，以及各自认证要求与响应模型

#### Scenario: 检查匿名、refresh 与 bearer-protected 接口
- **WHEN** 自动化读取生成的 OpenAPI
- **THEN** 发码、验码、注册和登录接口不错误声明 bearer 前置要求但记录限流语义；refresh 描述 refresh credential 与 `refreshRequestId`；`GET /desktop/v1/me`、`GET /desktop/v1/workspaces`、`POST /desktop/v1/workspaces` 和 `GET /desktop/v1/workspaces/{workspaceId}/projects` 明确声明 access bearer；logout 按实现声明当前 session credential

#### Scenario: 检查 Workspace list/create 契约
- **WHEN** 自动化检查 Workspace OpenAPI
- **THEN** list 固定为 `GET /desktop/v1/workspaces` 与 `200 { items: [{ workspaceId, name, type }], capabilities: { canCreateWorkspace, createWorkspaceReasonCode? } }`；create 固定为 `POST /desktop/v1/workspaces`、必需 `Idempotency-Key`、仅 `{ name }` body、首次 `201` 和确定性重放 `200` 均返回 `{ workspaceId, name, type }`，并记录 `401/400/403/409/503` 及稳定 Workspace error code

#### Scenario: 检查 Project list 契约
- **WHEN** 自动化检查 Project list OpenAPI
- **THEN** 路径固定为 bearer-protected `GET /desktop/v1/workspaces/{workspaceId}/projects`，只接受可选 opaque `cursor` 和整数 `limit`（默认 50、范围 1–100），并描述 `200 { items: [{ projectId, workspaceId, name }], nextCursor? }`、`400 VALIDATION_FAILED`、`401 AUTHENTICATION_REQUIRED`、`404 WORKSPACE_NOT_FOUND` 与 `503 PROJECTS_TEMPORARILY_UNAVAILABLE`

#### Scenario: API 形状发生漂移
- **WHEN** Controller、transport model、安全声明或稳定错误 code 改变但文档契约测试未同步满足预期
- **THEN** 自动化检查失败并指出缺失或不一致的路径、schema、安全声明或错误响应

### Requirement: API 文档按环境安全暴露
OpenAPI JSON 和 Swagger UI SHALL 在 Local/Test 环境默认启用，并在 Production 环境默认禁用。生产部署 MUST NOT 仅依赖隐藏链接保护文档 endpoint；显式启用生产文档需要后续独立安全决策和访问控制。

#### Scenario: Local 或 Test 环境
- **WHEN** Core API 使用批准的 Local 或 Test 配置启动
- **THEN** OpenAPI JSON 和 Swagger UI 可用于开发与自动化验证，且不放宽业务接口的认证、限流或秘密处理要求

#### Scenario: Production 默认配置
- **WHEN** Core API 使用 Production 默认配置启动
- **THEN** OpenAPI JSON、Swagger UI 及其静态资源不可访问，Desktop API 仍保持正常安全策略

### Requirement: 文档和交互请求不得持久化秘密
OpenAPI 描述、Swagger UI、示例值和文档相关日志 MUST NOT 嵌入真实密码、OTP、access token、refresh token、`refreshRequestId`、registration/reset continuation、credential handle 或真实用户数据。Swagger UI SHALL 禁用持久化授权；Local/Test 中临时输入的 bearer token 最多存在于当前页面会话内。

#### Scenario: 检查生成文档
- **WHEN** 自动化测试读取生成的 OpenAPI JSON 和示例
- **THEN** 文档只包含显式测试占位值，不包含真实或环境注入的密码、验证码、token、request id、continuation 或个人邮箱

#### Scenario: 通过 Swagger 发起请求
- **WHEN** 开发者在允许环境临时输入认证材料使用 Try it out
- **THEN** 材料不得进入浏览器持久存储、仓库、生成报告或服务端应用日志，刷新或关闭页面后不保留

### Requirement: 第一阶段保持运行时文档范围
第一阶段 SHALL 以运行时 OpenAPI、契约测试和 Swagger UI 作为 Desktop API 可视化能力；认证、Workspace onboarding 及紧随其后的 Project list 不要求提交独立版本化 OpenAPI 文件、生成 Desktop 客户端或执行 breaking-change compatibility gate。后续需要跨版本兼容承诺或客户端生成时 MUST 通过独立 Change 评估 source-of-truth、迁移和 drift 策略。

#### Scenario: 构建首个 Desktop API
- **WHEN** 本 Change 实现和验证认证、Workspace onboarding 与 Project list 接口
- **THEN** 构建无需维护第二份手写 OpenAPI 文件或生成客户端即可通过，但运行时文档契约测试仍须覆盖全部 auth、Workspace onboarding 和 Project list 路径

#### Scenario: 请求扩大契约治理范围
- **WHEN** 后续工作需要版本化 schema、自动生成客户端或兼容性门禁
- **THEN** 团队先建立独立设计和迁移方案，而不是在本 Change 中隐式扩展
