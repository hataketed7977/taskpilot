# Tasks

## 1. 真实生产架构门禁

- [x] 1.1 在 `CoreApiArchitectureTest` 中加入对稳定 Core API 架构根和非空生产类集合的显式断言，并确认全部 `CoreApiArchitectureRules` 对同一导入集合执行；以聚焦测试成功和代码审查确认未改变规则语义为完成证据。
- [x] 1.2 复核 `CoreApiModularityTest` 对 `access`、`workspace`、`project`、`onboarding`、`automation`、`agent` 六个生产模块执行精确集合断言与完整 `verify()`；仅在实现与 delta 不一致时作最小修正，并以聚焦测试成功为完成证据。
- [x] 1.3 串行运行 `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.architecture.CoreApiArchitectureTest' --tests 'ai.taskpilot.coreapi.architecture.CoreApiModularityTest' --no-parallel`，记录删除人工 fixture 前真实生产门禁可执行的基线。

## 2. 删除人工架构正反例并收敛构建

- [x] 2.1 删除 `ArchitectureRuleSelfTest.kt`、`ModulithViolationFixtureTest.kt`、`src/test/java/**` 和 `src/test/architecture-fixtures/**`；以目录不存在、`src/test` 下无 `.java` 文件且无其他调用方引用为完成证据。
- [x] 2.2 从 `services/core-api/build.gradle.kts` 删除 `architectureFixtures` source set、fixture 编译依赖、输入/系统属性传递和 fixture output classpath 防泄漏检查，同时保持标准 `test`、Kover、Detekt 和运行时 JAR 边界不变；以 Gradle 配置成功及任务图不再出现相关 fixture 任务为完成证据。
- [x] 2.3 将 `verifyBuildContract` 收敛为直接拒绝 Core API 手写测试 Java 源码、人工架构 fixture 目录和已删除的顶层自定义测试 source set，不通过排除测试或放宽运行时 JAR 检查实现；以 `./gradlew :services:core-api:verifyBuildContract --no-parallel` 成功为完成证据。
- [x] 2.4 更新 `services/core-api/docs/architecture.md` 的 Current Foundation 与架构验证描述，并更新 `services/core-api/docs/testing-strategy.md` 中新边界必须更新 fixture 的旧表述；文档 SHALL 改为真实生产结构门禁和 Kotlin-only 测试源码，且不重新定义业务模型。
- [x] 2.5 运行 `./gradlew :services:core-api:compileTestKotlin --no-parallel` 及两项生产架构聚焦测试，证明标准 Kotlin 测试编译和快速无容器架构门禁在删除接线后仍通过。

## 3. Model and Documentation Reconciliation

- [x] 3.1 对照 proposal、delta spec、实际代码、测试、Gradle 任务和验证结果完成模型漂移审计；确认没有业务模型、迁移、API、授权、数据、并发或运行时变化，并检查本 Change 未触碰并行 Desktop 工作区改动。
- [x] 3.2 执行失效引用与布局负向扫描，确认 `services/core-api` 不再包含 `architectureFixtures`、`architecture-fixtures`、两个 fixture 消费测试、`architecturefixtures` 包或 Java 测试源码；同步复核 `docs/business-model.md`、根 `docs/architecture.md` 和 `docs/README.md` 无需更新的证据，并使 Core API owner 文档 Current/Target 状态与实现一致。
- [x] 3.3 串行运行 `./gradlew --no-daemon :services:core-api:qualityCheck --no-parallel`，验证完整标准测试、模块上下文、PostgreSQL 集成、格式、静态分析、覆盖率和构建边界；若容器运行时不可用则明确报告失败，不得静默跳过或改用 H2。
- [x] 3.4 运行 `openspec schema validate taskpilot-sdd --verbose`、`openspec validate --all --strict --no-interactive`、定向 `git diff --check` 和范围审查；确认实现与 delta spec 一致、所有任务证据完整并具备 delta-spec sync readiness，但不执行 sync、archive、暂存或提交。
