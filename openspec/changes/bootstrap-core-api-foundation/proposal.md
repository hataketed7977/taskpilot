# Proposal

## Why

TaskPilot 的 Core API 已有获批的 Kotlin/Spring Modulith 目标架构和分层测试策略，但仓库尚无可构建工程，模块边界也没有可执行保护。现在需要先建立最小、可启动、可测试的后端基础，使后续业务纵向切片从第一天就在 Spring Modulith、ArchUnit 和分层测试门禁下演进。

## What Changes

- 初始化 Gradle Kotlin DSL 后端构建和 `services/core-api` Kotlin/Spring Boot 应用，并固定经官方兼容性元数据确认的一组稳定版本。
- 建立 `access`、`project`、`automation`、`agent` 四个粗粒度 Spring Modulith 模块及明确的模块公开面；不为尚未实现的业务预建战术 DDD 类型或空层级。
- 引入 Spring Modulith Test，以全局模块结构验证和最小模块启动测试保护模块发现、非循环依赖、公开接口及允许依赖。
- 显式引入 ArchUnit JUnit 5，保护 Spring Modulith 不负责的技术依赖规则，包括模型对 Web/持久化/安全框架的隔离、API surface 隔离、持久化和 provider 类型不跨边界泄漏。
- 建立快速测试、模块测试和基础设施集成测试的 Gradle source set/task 分层，使用真实 PostgreSQL Testcontainers 验证未来持久化边界，不使用 H2 模拟 PostgreSQL。
- 配置 Kotlin 编译、格式、静态检查和覆盖率基础门禁，并将可执行命令回写到 Core API 工程文档。
- 提供最小应用启动、Actuator 健康检查和测试配置，但不实现产品业务 API、认证流程、数据库业务表或 Agent 调度。

## Capabilities

### New Capabilities

- `core-api-foundation`: 定义 Core API 基础工程的可构建、可启动、模块边界验证、架构约束和分层测试能力。

### Modified Capabilities

无。

## Impact

- 根 Gradle Kotlin DSL 构建入口、Wrapper 和后端共享版本/插件配置。
- `services/core-api` 的应用源码、测试源码、资源与构建配置。
- `services/core-api/docs/architecture.md`、`services/core-api/docs/responsibilities.md` 和 `services/core-api/docs/testing-strategy.md` 中由 Target 转为 Current 的具体工程约束与命令。
- 新增并固定兼容的 Kotlin、Spring Boot、Spring Modulith、ArchUnit、JUnit、Testcontainers、Detekt、ktlint 和 Kover 依赖/插件。
- 不影响 Desktop session；不初始化 Gateway；不新增业务 API、业务 migration、Redis、消息中间件或跨服务协议。
