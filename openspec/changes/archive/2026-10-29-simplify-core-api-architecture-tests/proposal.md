# Proposal

## Why

Core API 当前为架构规则维护两套人工正反例：普通测试运行时中的 Spring Modulith Java fixture，以及独立编译、显式路径导入的 ArchUnit Java fixture。它们主要重复验证第三方框架或预设字符串规则能否识别人工违规，却引入 47 个 Java 文件、额外 source set、伪造框架 FQCN、系统属性和 classpath 防泄漏接线；这与应用仓库应优先验证真实生产结构的目标不相称，也使测试源码无必要地同时使用 Kotlin 与 Java。

## What Changes

- 删除 `src/test/java` 下的 Spring Modulith 人工合法/违规模块 fixture，以及只消费它们的正反例测试。
- 删除 `src/test/architecture-fixtures/java` 下的隔离 ArchUnit 人工正反例、伪框架/provider 类型，以及只消费它们的规则自测试。
- 删除 `architectureFixtures` source set、显式 fixture 输出传递和 classpath 防泄漏构建接线。
- 保留并强化直接分析真实 Core API 生产代码的 Spring Modulith 模块图验证与 ArchUnit 技术边界验证，防止因扫描范围为空或预期模块缺失而假通过。
- 将 Core API 手写测试源码统一为 Kotlin；标准 `test` 任务仍是完整测试套件入口，`qualityCheck` 仍保留架构、模块、静态分析、覆盖率和构建边界门禁。
- 同步修订 Core API Foundation 主规格中对人工正反例 fixture 的强制要求，并在涉及同一模块图场景时将已实现的六个能力模块作为当前验证基线。

## Business Model Impact

无业务模型变化。通过“当前代码—主规格—测试策略”的具体场景对照确认，本 Change 不改变 Actor、Board、Work Item、Workspace、Project、Agent 等规范术语，也不改变稳定身份、关系与基数、生命周期、业务不变量、授权或租户范围、版本与历史、异步边界，以及失败、恢复、并发或滥用语义。它仅简化工程测试实现，并继续执行 `docs/business-model.md` 所定义的既有业务规则；生产代码和业务数据均不迁移。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `core-api-foundation`：以真实生产类和真实模块图作为架构门禁对象，取消每类规则必须维护人工允许/禁止 fixture 的要求，并将 Core API 手写测试源码约束为 Kotlin。

## Impact

- `services/core-api/src/test/java/**` 将被删除。
- `services/core-api/src/test/architecture-fixtures/**` 将被删除。
- `ArchitectureRuleSelfTest` 与 `ModulithViolationFixtureTest` 将被删除。
- `services/core-api/build.gradle.kts` 中仅服务于隔离 fixture 的 source set、任务依赖、系统属性和构建契约检查将被删除或收敛。
- `CoreApiArchitectureTest`、`CoreApiArchitectureRules`、`CoreApiModularityTest` 及能力模块测试继续保留；不改变 Core API 运行时依赖、公开 API、持久化、认证、部署或业务行为。
- 不触碰并行进行的 Desktop 源码结构 Change，也不执行 spec sync、archive、暂存或提交。

## Documentation Impact

- `docs/business-model.md`：不更新；本 Change 经模型影响检查确认不改变其拥有的产品术语、关系、生命周期或业务不变量。
- `docs/architecture.md`：预计不更新；根文档只拥有 Core API 使用 Kotlin、Spring Boot 与 Spring Modulith 的跨项目技术边界，没有描述两套 fixture 的局部实现。
- `services/core-api/docs/architecture.md`：更新 Current Foundation，删除两类人工 fixture、独立 source set 和规则案例矩阵的现状描述，改为真实生产结构门禁及 Kotlin-only 测试源码现状。
- `services/core-api/docs/testing-strategy.md`：如实现审计确认现有文字不足以表达架构门禁边界，则补充真实生产结构验证与聚焦命令；不复制完整规则矩阵。
- `openspec/specs/core-api-foundation/spec.md`：在后续 sync/archive 阶段应用本 Change 的 delta；从人工正反例合同转为真实生产结构合同，并对触及的模块集合现状消除文档漂移。
- `docs/README.md`：不更新；没有新增、移动、重命名或改变工程文档所有权。
