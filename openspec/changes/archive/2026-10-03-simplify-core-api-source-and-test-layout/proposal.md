# Proposal

## Why

Core API 当前把测试拆到 `src/test`、`src/moduleTest`、`src/integrationTest` 和
`src/architectureFixtures` 四个顶层源码目录，并通过自定义 Gradle source set、任务和
构建契约维持这套布局。对于当前单体 Core API，这种物理分层增加了查找、移动和执行测试
的成本，也使新增测试必须先判断目录和任务，而测试类型本可由测试内容与执行选择表达。

同时，生产模块元数据仍由少量 `package-info.java` 承载，导致一个以 Kotlin 为生产语言的
工程保留 Java 生产源码。Spring Modulith 已支持在模块根包的 Kotlin 类型上声明模块元数据，
因此没有继续保留这些 Java 文件的必要。

本 Change 在不改变业务行为、模块边界、数据库证据强度或覆盖率阈值的前提下，收敛到
标准、直观的 Kotlin/Gradle 工程布局，并减少仅为目录分层服务的构建配置。

## What Changes

- Core API 的手写生产源码统一位于 `src/main/kotlin`；将四个模块的 Spring Modulith 元数据
  迁移到现有 Kotlin 模块标记类型，并删除 `src/main/java` 下的 `package-info.java`。
- 所有测试与测试资源在文件系统中统一归入 `src/test`；单元、架构、模块上下文、启动、
  Flyway 和 PostgreSQL 集成测试不再使用顶层 `src/moduleTest` 或 `src/integrationTest`。
- 删除 `moduleTest`、`integrationTest` 自定义测试 source set 和同名任务，标准 `test` 任务
  成为完整测试套件入口；开发者通过 `--tests` 选择快速或聚焦测试，而不是依赖物理目录分类。
- 架构 fixture 全部移入 `src/test` 之下，并按装载机制分为两类：Spring Modulith fixture
  放在普通 `src/test/java`，保持对标准测试运行时可见以支持包扫描；仅可能与真实依赖发生
  FQCN 冲突的 ArchUnit fixture 放在 `src/test/architecture-fixtures/java` 并保留隔离编译与显式导入。
- 简化 Detekt、Kover 和 `verifyBuildContract` 的接线：质量门禁继续覆盖完整测试、静态分析、
  架构规则、模块验证、真实 PostgreSQL 集成测试以及既有 80% 行覆盖率和 75% 分支覆盖率；
  删除只用于强制旧 source set、任务名或测试文件名的脚手架检查。

## Business Model Impact

无业务模型影响。本 Change 不改变 Actor、业务术语、标识、所有权与关系、生命周期、
权限或租户范围、版本历史、异步边界及失败恢复语义；它只改变同一批 Core API 生产模块
元数据和自动化测试的源码布局与执行接线。因此无需修改 `docs/business-model.md`，也不把
Event Storming 产物机械映射为代码类型或模块。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `core-api-foundation`: 将“独立快速/模块/基础设施测试任务”的要求改为标准 `src/test` 与
  单一完整 `test` 入口下的逻辑分层和聚焦选择，同时保留模块上下文隔离、真实 PostgreSQL
  证据、容器失败可见性以及单一完整质量门禁。

## Impact

- 代码与资源：`services/core-api/src/main`、`services/core-api/src/test`，以及现有
  `src/moduleTest`、`src/integrationTest`、`src/architectureFixtures` 内容的迁移。
- 构建：`services/core-api/build.gradle.kts` 中 source set、测试依赖、Test/Kover/Detekt、
  `qualityCheck` 和 `verifyBuildContract` 接线。
- 测试调用方：本地与 CI 应改用 `:services:core-api:test`、`--tests` 和
  `:services:core-api:qualityCheck`，不再调用被删除的自定义测试任务。
- 运行时、API、数据库 schema、依赖技术选型和跨项目边界均不改变。

## Documentation Impact

实施时同步更新：

- `services/core-api/docs/architecture.md`：把 Current foundation 的生产语言、源码布局、
  测试入口和质量接线更新为实现后的状态；Target 业务架构不变。
- `services/core-api/docs/testing-strategy.md`：以标准 `src/test`、逻辑测试层级、聚焦命令和
  完整门禁替换自定义 source set/任务说明，并记录 Modulith 运行时扫描与 ArchUnit 内部编译隔离。
- `services/core-api/docs/responsibilities.md`：更新 Core API 工程结构与测试放置责任，不改变
  能力所有权。
- `openspec/specs/core-api-foundation/spec.md`：归档同步本 Change 对测试分层与门禁要求的修改。

`docs/business-model.md` 无需修改，因为没有新增领域事实；`docs/architecture.md` 的跨项目
边界和仓库级质量原则不变。没有新增、移动、重命名、删除工程文档或改变文档所有权，
所以 `docs/README.md` 的文档清单无需更新。
