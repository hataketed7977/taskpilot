# Test Plan

## Scope and Risk

受影响区域是 Core API 的生产模块元数据、测试/资源/fixture 物理布局、Gradle source set 与
任务图、测试依赖、ArchUnit fixture 装载、Detekt/Kover 接线、Boot JAR 构建契约，以及对应
Core API owner 文档。

风险等级为**中等工程风险、低业务风险**：没有业务规则、API 或数据迁移，但错误接线可能
造成测试未被发现、架构规则空通过、伪框架类污染测试 classpath、模块元数据丢失、真实
PostgreSQL 测试被静默跳过、覆盖率漏聚合或测试资源进入生产 JAR。逸出缺陷会削弱后续所有
Core API Change 的质量证据，因此必须执行一次完整门禁。

明确非目标：不测试或改变认证、Workspace、Project 的业务预期；不降低 80% 行/75% 分支
覆盖率；不使用 H2；不新增 UI、浏览器或跨服务系统测试；不修改归档 Change。

业务模型影响审计结果为无变化：身份、关系、生命周期、授权/租户、版本、异步、并发与恢复
规则均不受影响。因此相关既有业务测试用于证明“仍然执行”，不是为本 Change 重复定义业务
断言。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| 干净环境使用 Wrapper 编译并执行所选测试 | 构建 | `./gradlew :services:core-api:compileKotlin :services:core-api:compileTestKotlin`，再执行聚焦测试 | 最直接发现源码移动、依赖和编译接线错误 |
| 手写生产源码仅 Kotlin | 构建契约 + 负向扫描 | `verifyBuildContract` 断言 `src/main` 无 Java；`find services/core-api/src/main -type f -name '*.java'` 输出为空 | 防止以后重新引入只为模块元数据服务的 Java |
| Kotlin 模块元数据保持四模块图及 project→access 依赖 | 架构测试 | `CoreApiModularityTest`、`ModulithViolationFixtureTest` 和四个 `*ModuleTest` 类 | Spring Modulith 是识别模块声明与允许依赖的最低可靠层 |
| 基础应用启动与健康边界不变 | Spring 集成测试 | 选择 `CoreApiApplicationSmokeTest`、`CoreApiHealthHttpTest` | 发现 source set 合并导致的应用 wiring 或测试资源问题 |
| 聚焦单元/架构测试不启动 PostgreSQL | 标准测试任务 + 运行审查 | 用 `--tests` 精确选择 architecture/unit 类并确认无需容器即可通过 | 证明快速反馈来自选择器而非旧独立任务 |
| 标准 `test` 发现全部逻辑层 | Gradle 完整测试 | `./gradlew :services:core-api:test`；检查测试报告包含 unit、architecture、module/smoke、`*IntegrationTest` | 发现移动后未纳入 source set 或被过滤的测试 |
| 模块测试仍使用限定上下文 | 模块测试 | 聚焦执行 `ai.taskpilot.coreapi.*ModuleTest` 并保留四个现有类的上下文断言 | 目录合并不能把模块隔离降级为完整应用测试 |
| PostgreSQL 集成测试使用真实边界且可重复 | Testcontainers/PostgreSQL | 聚焦执行 `*IntegrationTest`，包括 PostgreSQL foundation、Flyway、persistence 和 HTTP 集成类 | 真实基础设施层才能发现 PostgreSQL 方言、锁和 migration 生命周期问题 |
| 容器不可用时不静默通过 | 配置/源码审查 + Testcontainers 行为 | 检查测试没有 `disabledWithoutDocker`、assumption 或 H2 fallback；在无容器环境仅记录预期明确失败，不为制造证据破坏可用环境 | 主要风险是静默 skip/fallback；源码与失败语义比人为关闭 Docker 更安全 |
| 所有测试资产位于 `src/test`，旧顶层目录消失 | 构建契约 + 负向扫描 | `verifyBuildContract`；对 `src/moduleTest`、`src/integrationTest`、`src/architectureFixtures` 做存在性扫描 | 文件系统契约应由确定性结构检查保护 |
| Modulith fixture 可被运行时包扫描且不空通过 | Modulith 自测试 | fixture 位于普通 `src/test/java`；`ModulithViolationFixtureTest` 的有效和无效场景都正向断言 `alpha`、`beta` 模块被发现 | `ApplicationModules.of(包名, ImportOption)` 显式允许测试输出并依赖测试运行时 classpath，模块发现断言可阻止空扫描伪通过 |
| ArchUnit fixture 不污染普通测试 classpath | 隔离编译 + 架构自测试 | 隔离 source set 不继承 `testImplementation`，由本地 stub 自包含编译；检查 test runtime 不含其 output；运行 `ArchitectureRuleSelfTest` | 同时证明伪 FQCN 不参与普通类加载且规则仍可显式导入其字节码 |
| 架构规则允许例通过、禁止例失败而非空通过 | 架构自测试 | `ArchitectureRuleSelfTest` 保持每个 rule/case 的可定位断言；`ModulithViolationFixtureTest` 先断言模块发现再断言违规结果 | 捕获 fixture 路径或 classpath 配置错误造成的零类导入、空扫描或假阳性 |
| 完整质量门禁仍包含所有保护 | 构建 + 静态分析 + 覆盖率 | `qualityCheck` 实际执行 compile、ktlint、Detekt、完整 `test`、构建契约、Kover 报告及阈值 | 任务图检查不能替代真实执行，完整门禁是跨边界证据 |
| Boot JAR 不包含测试、fixture 或集成探针且包含生产迁移/入口 | 产物契约 | `verifyBuildContract` 检查 `bootJar` 内容 | 发现资源移动导致的生产产物污染或迁移漏包 |
| 旧任务调用方和文档无残留 | 静态扫描 + 文档审查 | 全仓搜索 `moduleTest`、`integrationTest` 和旧目录，只允许迁移历史/OpenSpec 语境；审阅三个 owner 文档 Current 描述 | 防止本地/CI 继续调用已删除任务及文档漂移 |
| 无业务模型漂移 | 语义审查 | 将实现 diff 与 proposal 的 Business Model Impact、`docs/business-model.md` 对照 | 测试通过不能证明没有意外改动领域规则 |
| 迁移失败可回滚 | Git/构建恢复 | 变更无数据迁移；在提交前保留可整体回滚的源码移动、Gradle 和文档 diff | 恢复风险是仓库状态而非运行时状态，无需构造业务恢复测试 |

## Implementation and Verification Approach

### Slice 1: Kotlin 模块元数据

这是框架元数据迁移而非业务行为，不制造 Red-Green-TDD 证据。先执行或记录现有模块图测试
基线，再在 Kotlin marker 上添加等价注解，运行模块图聚焦测试，最后删除
`package-info.java` 并做生产 Java 负向扫描。若模块数量、名称或允许依赖改变，迁移失败，
不得通过修改既有模块期望来迁就实现。

### Slice 2: 架构 fixture 分类迁移

先将 Modulith fixture 按 package declaration 移到普通 `src/test/java`，使用显式 import option 允许测试输出，并在有效、无效场景
增加预期模块发现断言，证明运行时包扫描真实命中。再配置位于
`src/test/architecture-fixtures/java` 的 ArchUnit 隔离编译单元：不继承 `testImplementation`，
补齐 MVC/Security 本地最小 stub，通过声明的 classes 路径显式导入。依次验证隔离 fixture
自包含编译、普通 test runtime 不含其 output、允许 case 通过和每个禁止 case 被捕获。仅在
两类装载证据都成立后删除旧顶层 fixture 目录。

### Slice 3: 模块与集成测试归并

先枚举路径碰撞，然后移动 Kotlin 测试和 integration-only 资源。将 Testcontainers、Flyway
等依赖归入 test 配置并删除两个自定义 source set/Test 任务。先编译测试，再按架构、模块、
启动、PostgreSQL 集成的顺序聚焦执行，最后执行标准完整 `test`。不得删除断言、添加 skip
或改用 H2 来解决迁移失败。

### Slice 4: 质量接线和构建契约收敛

在所有测试可由 `test` 发现后，再更新 Detekt、Kover、`qualityCheck` 和
`verifyBuildContract`。删除对旧实现形状的检查，保留并实际执行生产产物、依赖、版本、覆盖率
和任务图保护。先运行单项 lint/contract/coverage，再运行一次 `qualityCheck`，避免用静态
任务依赖推断执行成功。

### Slice 5: 文档与语义漂移审计

实现稳定后更新三个 Core API owner 文档，精确区分 Current 与 Target，并以本 Change 的
spec delta 同步主 spec/归档。执行旧引用负向扫描，检查没有领域模型、API、数据或安全边界
变化。文档校验和 OpenSpec strict validation 是结构/一致性证据，不替代测试。

## Verification Commands

### Focused

- `./gradlew :services:core-api:compileKotlin :services:core-api:compileTestKotlin`：验证 Kotlin
  生产代码、统一测试源码与依赖可编译。
- `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.architecture.CoreApiModularityTest' --tests 'ai.taskpilot.coreapi.architecture.ModulithViolationFixtureTest'`：验证 Kotlin 模块元数据及违规 fixture。
- `./gradlew :services:core-api:compileArchitectureFixturesJava`：验证隔离 ArchUnit fixture 在不继承 `testImplementation` 时依靠本地最小 stub 自包含编译。
- `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.architecture.ArchitectureRuleSelfTest' --tests 'ai.taskpilot.coreapi.architecture.CoreApiArchitectureTest'`：验证 ArchUnit fixture 显式导入、普通 test runtime 隔离和生产规则。
- `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.*ModuleTest'`：验证 `AccessModuleTest`、`ProjectModuleTest`、`AutomationModuleTest` 和 `AgentModuleTest` 四个限定模块上下文。
- `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.CoreApiApplicationSmokeTest' --tests 'ai.taskpilot.coreapi.CoreApiHealthHttpTest'`：验证应用启动、安全 fallback 和健康面。
- `./gradlew :services:core-api:test --tests '*IntegrationTest'`：在容器可用时验证全部真实 PostgreSQL/Flyway/HTTP 集成测试。
- `./gradlew :services:core-api:verifyBuildContract`：验证生产语言、旧目录消失、依赖与 Boot JAR 边界。
- `./gradlew :services:core-api:detekt :services:core-api:ktlintCheck`：验证统一 Kotlin 源码树的静态分析与格式。
- `find services/core-api/src/main -type f -name '*.java' -print`：期望无输出。
- `for candidate in services/core-api/src/moduleTest services/core-api/src/integrationTest services/core-api/src/architectureFixtures; do test ! -e "$candidate" || printf 'unexpected: %s\n' "$candidate"; done`：期望无输出。

### Affected and Cross-Boundary

- `./gradlew :services:core-api:test`：必须实际发现并执行全部测试层；需要可用容器运行时。
- `./gradlew :services:core-api:koverXmlReport :services:core-api:koverHtmlReport :services:core-api:koverVerify`：验证单一测试入口的覆盖率聚合和 80%/75% 阈值。
- `./gradlew --no-daemon :services:core-api:qualityCheck`：最终一次完整 Core API 门禁；涵盖编译、格式、静态分析、全部测试、产物契约和覆盖率。
- `rg -n 'src/(moduleTest|integrationTest|architectureFixtures)|:services:core-api:(moduleTest|integrationTest)|tasks?\.(named|register).*"(moduleTest|integrationTest)"' --glob '!openspec/changes/archive/**' .`：审查旧布局/任务的非历史残留，预期只有本 Change 对旧状态的迁移说明。
- `openspec validate simplify-core-api-source-and-test-layout --strict`：验证 Change 产物结构；归档前再由 archive workflow 同步 delta spec。
- `git diff --check`：验证补丁没有空白错误。

## Manual Evidence and Automation Gaps

None。该变更的目录、编译、类路径、模块识别、测试发现、容器边界、产物和文档引用风险均可由
自动化命令或确定性源码审查覆盖，不需要浏览器或人工 UI 验收。若执行环境没有容器运行时，
实施者必须将 PostgreSQL 测试和完整 `qualityCheck` 记录为未验证并在具备容器的 CI/本机补跑，
不得以手工说明替代通过证据。
