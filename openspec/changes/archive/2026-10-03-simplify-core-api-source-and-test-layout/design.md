# Design

## Context

动机见 [`proposal.md`](proposal.md#why)。当前 Core API 将测试分散在四个顶层目录，
`build.gradle.kts` 为模块测试和集成测试创建独立 source set/Test 任务，再让 Detekt、Kover、
`qualityCheck` 和 `verifyBuildContract` 显式枚举这些层。生产模块边界则由 Kotlin marker object
与 Java `package-info.java` 两套文件共同表达。

架构 fixture 有两种不同的装载约束。Spring Modulith fixture 由
`ApplicationModules.of(包名)` 从测试运行时 classpath 扫描，必须作为普通测试源码编译并在
运行时可见；ArchUnit fixture 则包含有意声明的 `jakarta.persistence.EntityManager`、
`org.springframework.data.repository.Repository`、`org.springframework.jdbc.core.JdbcTemplate`、
`org.jooq.DSLContext` 等伪框架全限定名，若与真实依赖处于同一编译或运行 classpath，可能发生
重复类或遮蔽。因此“物理位置统一到 `src/test`”不等于“所有 fixture 使用同一编译和装载策略”。

本设计受修改后的
[`core-api-foundation` delta spec](specs/core-api-foundation/spec.md) 和
[`services/core-api/docs/testing-strategy.md`](../../../services/core-api/docs/testing-strategy.md)
约束。

## Goals / Non-Goals

**Goals:**

- 让开发者只需在 `src/main` 与 `src/test` 两棵标准目录中查找 Core API 源码和测试资产。
- 保持测试类型的语义分层，同时用标准 `test` 入口和 `--tests` 做完整或聚焦执行。
- 让生产源码仅使用 Kotlin，并继续由 Spring Modulith 验证原有四个模块及允许依赖。
- 用最小且有业务意义的构建契约保护可执行 JAR、迁移、依赖和质量门禁。
- 保持真实 PostgreSQL、覆盖率阈值及现有测试行为不降级。

**Non-Goals:**

- 不改变认证、Workspace、Project、API、数据库 schema 或任何领域行为。
- 不调整四个能力模块的边界、公开面或依赖方向。
- 不把测试分类改造成新的标签框架、测试插件或共享测试模块。
- 不为追求 Kotlin 数量归零而把 Java 字节码 fixture 翻译成 Kotlin；“生产代码仅 Kotlin”不等于
  “测试夹具禁止 Java”。
- 不修改已归档的 authentication/workspace Change。

## Business Model

采用轻量影响面检查，而不启动新的 Event Storming：逐项检查 Actor 与术语、稳定标识、
所有权/引用/基数、生命周期与不变量、授权/租户范围、版本历史、异步边界，以及失败、恢复、
并发和滥用场景。结论是这些维度均不受影响；测试目录、编译单元和执行任务没有业务身份或
状态，也不改变 [`docs/business-model.md`](../../../docs/business-model.md) 中的任何规则。

成功边界是原测试在新入口下仍提供相同证据；拒绝边界是架构违规、模块 wiring 错误、迁移
错误、PostgreSQL 不可用或覆盖率不足仍使对应命令失败。恢复仅涉及构建迁移回滚，不涉及
运行时数据。没有新增授权、租户、异步或并发语义。

## Decisions

### 1. 生产模块元数据迁移到 Kotlin 类型

将四个现有模块根包中的 marker 改为无状态 Kotlin class，并同时标注 `@PackageInfo` 与
`@ApplicationModule`。保留 `AccessModule`、`ProjectModule`、`AutomationModule`、
`AgentModule` 名称和现有 display name/allowed dependencies，其中仅 `project` 允许依赖
`access`。删除四个 `package-info.java`，最终 `src/main` 不含 Java 文件。

选择 class 而不是 package-level Kotlin annotation，是因为 Spring Modulith 明确支持
`@PackageInfo` 类型作为 Java package-info 的替代，且同仓库参考工程已采用该模式。没有选择
保留 Java，是因为它不再提供 Kotlin 类型无法表达的能力；也不新建统一 `ModuleInfo` 名称，
避免无收益重命名现有公开 marker。

验证边界是现有 Spring Modulith 模块图测试和构建契约的生产 Java 负向扫描。

### 2. 业务测试统一进入标准 test source set

将：

- `src/moduleTest/kotlin/**` 移到 `src/test/kotlin/**`；
- `src/integrationTest/kotlin/**` 移到 `src/test/kotlin/**`；
- `src/integrationTest/resources/**` 移到 `src/test/resources/**`。

删除 `moduleTest` 与 `integrationTest` source set 和 Test 任务；其依赖转为
`testImplementation`/`testRuntimeOnly`。不增加 JUnit tag 作为新的强制分类机制。标准
`:services:core-api:test` 发现完整套件，聚焦开发通过类名/模式选择，例如：

```bash
./gradlew :services:core-api:test --tests '*Architecture*'
./gradlew :services:core-api:test --tests '*ModuleTest'
./gradlew :services:core-api:test --tests '*IntegrationTest'
```

具体类名以迁移后的现有测试为准，文档不得把示例模式写成不存在的强制命名约定。选择
`--tests` 而不是保留分层任务，是因为当前规模下执行选择已足够，而且不会再次把文件布局、
依赖配置和质量聚合绑定到测试类别。代价是完整 `test` 需要容器环境；这是明确行为，不允许
无 Docker 时静默跳过 PostgreSQL 测试。日常快速反馈由显式选择不依赖容器的类提供。

模块上下文测试仍使用原 Spring Modulith 测试边界，合并目录不意味着改成完整应用测试。
PostgreSQL/Flyway 测试继续使用真实 Testcontainers PostgreSQL，测试资源不会进入 Boot JAR。

### 3. 架构 fixture 物理归入 src/test，并按装载机制分流

所有 fixture 资产都归入 `src/test`，但分为两个明确类别：

```text
src/test/
├── java/
│   └── ai/taskpilot/architecturefixtures/modulith/**
└── architecture-fixtures/
    └── java/
        ├── ai/taskpilot/architecturefixtures/archunit/**
        ├── ai/taskpilot/{desktop,gateway,agentruntime}/**
        ├── com/vendor/**
        ├── jakarta/**
        └── org/**
```

Spring Modulith fixture 移到普通 `src/test/java`，路径与其
`ai.taskpilot.architecturefixtures.modulith.*` package declaration 对齐。它们由标准 test source
set 编译，使用标准测试依赖，并保留在测试运行时 classpath 中，因为
`ApplicationModules.of(包名, ImportOption)` 依赖运行时包扫描，并以显式 import option 允许默认会被排除的测试输出。`ModulithViolationFixtureTest` 的有效和无效
fixture 场景都必须先正向断言预期的 `alpha`、`beta` 模块确实被发现，再断言无违规或存在预期
违规，避免有效场景在扫描不到任何类时空通过。

只有存在 FQCN 冲突风险、供 `ClassFileImporter.importPaths(...)` 使用的 ArchUnit fixture
保留内部 `architectureFixtures` source set。其物理源目录改为
`src/test/architecture-fixtures/java`；该 source set 只产生 fixture 字节码，不注册 Test 任务，
不继承整个 `testImplementation`，output 也不加入普通 test runtime classpath。现有 JPA、
Spring Data、JDBC、JOOQ 和 provider 伪类型继续作为本地最小 stub，并补充 MVC
`org.springframework.web.servlet.DispatcherServlet` 与 Security
`org.springframework.security.web.SecurityFilterChain` 的本地最小 stub，使隔离编译单元无需
真实框架依赖即可自包含编译。

标准 `test` 在 ArchUnit 自测试前构建隔离 fixture，并通过声明的 task input/系统属性传入
fixture 的一个或多个 classes output 路径；测试使用 `ClassFileImporter.importPaths(...)` 显式导入，不能硬编码
`build/` 路径。这样 ArchUnit 正反例仍可执行，而伪框架类不会参与普通测试类加载。

备选方案及拒绝原因：

- **全部 fixture 直接放入普通 `src/test/java`：** 满足 Modulith 包扫描，但 ArchUnit 的伪外部
  FQCN 会与真实依赖处于同一编译和运行 classpath，存在重复类或遮蔽风险。
- **全部 fixture 保持隔离编译：** 可隔离 ArchUnit 伪类型，但 Spring Modulith 的公开包扫描
  API 只能扫描测试运行时 classpath，无法可靠发现不在该 classpath 上的 fixture。
- **隔离 source set 继承 `testImplementation`：** 编译简单，但把不需要的完整测试依赖重新
  引入隔离单元，弱化冲突防护；少量本地最小 stub 更符合现有 fixture 策略。
- **保留顶层 `src/architectureFixtures`：** 编译隔离清晰，但不满足所有测试资产物理归入
  `src/test` 的目标。
- **运行时生成字节码：** 隔离最强但复杂度过高，不符合当前项目规模。

### 4. 简化质量与构建契约，不降低门禁

- Detekt 只需扫描 `src/main/kotlin` 与 `src/test/kotlin`。
- Kover 以标准 `test` 执行为测试数据来源，继续只覆盖 `main` 生产类，阈值保持 80% 行、
  75% 分支；迁移测试不得造成已执行层缺失。
- `qualityCheck` 继续依赖编译、ktlint、Detekt、`test`、`verifyBuildContract`、Kover 报告和
  Kover 阈值验证，但不再依赖已删除任务。
- `verifyBuildContract` 删除“必须存在某 source set/任务/测试文件名”及“三个测试任务必须被
  Kover 聚合”等自我实现式检查，保留有风险意义的契约：Boot JAR 包含入口和生产迁移，
  不包含测试/fixture/集成探针；禁止的生产依赖仍不存在；版本仍固定；质量门禁仍包含必要
  任务。新增负向检查确保 `src/main` 无 Java，旧三个顶层测试目录不存在。
- `check`/CI 如直接依赖旧任务，实施时全仓扫描并改到 `test` 或 `qualityCheck`；不创建兼容
  空壳任务，因为这会掩盖调用方未迁移。

选择保留精简后的 `verifyBuildContract`，而非全部删除，是因为可执行 JAR 污染、生产迁移
漏打包和生产依赖越界无法由普通单元测试可靠覆盖。选择删除文件名检查，是因为它们验证的
是当前脚手架形状而非能力，重命名一个等价测试不应破坏构建。

## Risks / Trade-offs

- **[完整 `test` 比原快速任务慢且要求容器]** → 文档提供 `--tests` 聚焦入口；CI 和
  `qualityCheck` 明确准备容器并执行完整套件；标准 test 集成边界检测该回归。
- **[迁移后测试重名或包名冲突]** → 移动前枚举目标相对路径，冲突时保持语义包名并做最小
  重命名；先执行编译和按层聚焦测试。
- **[伪框架 ArchUnit fixture 污染普通测试 classpath]** → 仅该类 fixture 使用自包含的独立
  source set，显式路径导入且禁止 output 加入 test runtime；增加 classpath 检查和架构自测试。
- **[Modulith fixture 移出运行时 classpath 后扫描为空]** → 将其放入普通 `src/test/java`，并在
  有效、无效两个场景中正向断言预期模块均被发现后再检查违规结果。
- **[模块元数据迁移导致 Spring Modulith 少识别模块或丢失 allowed dependency]** → 先迁移
  Kotlin annotation，再运行模块图和四个模块上下文测试，最后删除 Java 元数据。
- **[Kover 在单任务接线后漏掉测试执行或阈值失真]** → 检查报告任务依赖和报告内容，并让
  `qualityCheck` 实际运行完整套件与既有阈值验证。
- **[CI、脚本或文档仍调用旧任务]** → 全仓正向扫描旧目录/任务引用，逐一迁移；完成后负向
  扫描为零，归档前由 owner 文档审计兜底。
- **[测试资源进入生产 JAR]** → 保留 Boot JAR 内容断言，专门验证集成探针和 fixture 不被
  打包。

## Migration Plan

1. 记录当前测试文件、资源、fixture 和 Gradle 调用方清单，先确认目标路径无碰撞。
2. 在 Kotlin marker 上声明四个模块元数据并运行模块图聚焦测试；确认等价后删除 Java
   package metadata，并验证 `src/main` 无 Java。
3. 将 Modulith fixture 移到普通 `src/test/java` 并增加模块发现断言；再为
   `src/test/architecture-fixtures/java` 建立不继承 `testImplementation` 的自包含隔离编译，
   补齐 MVC/Security 最小 stub，并显式导入 ArchUnit fixture output。用两类自测试分别证明
   包扫描有效以及 ArchUnit 正反例不空通过、不污染普通 test runtime。
4. 移动模块和集成测试/资源到标准 test source set，合并依赖，删除两个自定义测试任务，
   先运行各层聚焦测试，再运行完整 `test`。
5. 简化 Detekt、Kover、`verifyBuildContract`、`qualityCheck` 及所有脚本/CI 调用方；运行完整
   `qualityCheck`。
6. 同步三个 Core API owner 文档及 delta spec，执行旧目录/旧任务引用负向扫描和 OpenSpec
   验证后归档。

该变更没有数据或部署迁移，可以原子提交。若迁移期间失败，回滚本 Change 的源码移动和
Gradle/文档修改即可；不得通过跳过 PostgreSQL、降低覆盖率或恢复伪通过任务来完成回滚。
