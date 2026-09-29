# Spec Delta

## Purpose

为首个真实 Desktop HTTP API 提供与运行时代码一致、可交互查看且不扩大生产攻击面的 OpenAPI 文档，使开发和测试能够发现接口、认证要求与稳定错误契约。

## ADDED Requirements

### Requirement: Desktop API 具有可视化运行时文档
Core API SHALL 为已实现的 Desktop HTTP API 生成运行时 OpenAPI 描述和 Swagger UI。文档 SHALL 区分 Desktop API surface，准确描述路径、方法、请求和响应 schema、bearer security requirement、成功状态以及共享 Problem Details 的稳定错误 `code`。

#### Scenario: 查看认证 API
- **WHEN** 开发者在允许文档的环境打开 Swagger UI
- **THEN** 页面展示 `POST /desktop/v1/session/bootstrap` 与 `GET /desktop/v1/me`、其 bearer 认证要求、响应模型以及 `401 AUTHENTICATION_REQUIRED`、`409 USER_BOOTSTRAP_REQUIRED` 和适用的 `503 AUTHENTICATION_TEMPORARILY_UNAVAILABLE`

#### Scenario: API 形状发生漂移
- **WHEN** Controller、transport model 或安全声明改变但文档契约测试未同步满足预期
- **THEN** 自动化检查失败并指出缺失或不一致的路径、schema 或 security declaration

### Requirement: API 文档按环境安全暴露
OpenAPI JSON 和 Swagger UI SHALL 在 Local/Test 环境默认启用，并在 Production 环境默认禁用。生产部署 MUST NOT 仅依赖隐藏链接保护文档端点；显式启用生产文档需要后续独立安全决策和访问控制。

#### Scenario: Local 或 Test 环境
- **WHEN** Core API 使用批准的 Local 或 Test 配置启动
- **THEN** OpenAPI JSON 和 Swagger UI 可用于开发与自动化验证，且不放宽其他业务接口的认证要求

#### Scenario: Production 默认配置
- **WHEN** Core API 使用 Production 默认配置启动
- **THEN** OpenAPI JSON、Swagger UI 及其静态资源不可访问，受保护 Desktop API 仍保持正常认证

### Requirement: 文档与交互授权不得持久化秘密
OpenAPI 描述、Swagger UI、示例值和文档相关日志 MUST NOT 嵌入真实 access token、refresh token、authorization code、PKCE verifier、OTP、client secret 或真实用户外部身份。Swagger UI SHALL 禁用持久化授权；Local/Test 中临时输入的 bearer token 最多存在于当前页面会话内，不得写入浏览器持久存储、仓库、生成报告或服务端日志。

#### Scenario: 检查生成文档
- **WHEN** 自动化测试读取生成的 OpenAPI JSON
- **THEN** 文档只包含占位示例和 bearer security scheme，不包含任何真实或环境注入的秘密

#### Scenario: 通过 Swagger 发起认证请求
- **WHEN** 开发者在允许环境临时输入 bearer token 使用 Try it out
- **THEN** token 可在当前页面会话的内存中用于请求，但刷新或关闭页面后不保留，且不进入生成 artifact、持久存储、仓库或服务端应用日志

### Requirement: 第一阶段保持运行时文档范围
第一阶段 SHALL 以运行时生成的 OpenAPI 和 Swagger UI 作为开发可视化能力，不要求提交独立版本化 OpenAPI 文件、生成 Desktop 客户端或执行 breaking-change compatibility gate。后续引入 public/managed API 或跨版本兼容承诺时 MUST 通过独立 Change 评估契约化方案。

#### Scenario: 构建首个 Desktop API
- **WHEN** 本 Change 实现和验证认证接口
- **THEN** 构建无需维护第二份手写 OpenAPI 文件或生成客户端即可通过，但运行时文档契约测试仍须通过

#### Scenario: 请求扩大契约治理范围
- **WHEN** 后续工作需要版本化 schema、自动生成客户端或兼容性门禁
- **THEN** 团队先建立独立设计与迁移方案，而不是在本 Change 中隐式扩展
