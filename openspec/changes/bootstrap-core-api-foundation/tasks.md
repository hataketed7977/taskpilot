# Tasks

## 1. 工作区保护与可复现构建引导

- [ ] 1.1 在实施前执行 `git status --short --branch`、`openspec list --json` 和 `find . -maxdepth 2 \( -name 'settings.gradle*' -o -name 'build.gradle*' -o -name 'gradlew' \) -print`；对 `apps/desktop/`、`apps/agent-runtime/` 和已有共享根文档修改保存 Git 状态、`git diff --binary -- <paths>` 及受版本控制/未忽略文件的内容哈希 baseline。后续发现 baseline 变化时暂停并对齐，不覆盖，也不要求原本已有 diff 为空。
- [ ] 1.2 查询 Spring Initializr metadata 与 Spring Boot/Spring Modulith 官方兼容矩阵，记录选用的最新稳定兼容 JDK、Kotlin、Spring Boot、Spring Modulith、ArchUnit、JUnit、Testcontainers、Detekt、ktlint 和 Kover 版本及来源；在 version catalog/插件配置中固定版本，自动证据为 `./gradlew --version` 与 `./gradlew :services:core-api:dependencies` 不包含动态版本或 `SNAPSHOT`。
- [ ] 1.3 创建根 Gradle Kotlin DSL 多项目入口、受版本控制的 Wrapper 和仅包含 `:services:core-api` 的 module 配置，并初始化最小 Core API build；执行 `./gradlew --no-daemon clean :services:core-api:test`，证明无需预装 Gradle 即可解析、编译并运行快速测试。
- [ ] 1.4 配置并验证 dependency/build 约束：生产依赖中不得出现 H2、未批准的 JPA/JDBC 业务 starter、Redis、消息中间件或 Desktop/Agent Runtime/Gateway 实现包；以 `./gradlew :services:core-api:dependencies`、版本固定扫描和后续 `:services:core-api:verifyBuildContract` 为自动证据。

## 2. Spring Modulith 模块图保护

- [ ] 2.1 Red: 先添加 `CoreApiModularityTest` 和隔离的 Modulith 合法/禁止 fixture 元测试，执行 `./gradlew :services:core-api:test --tests '*CoreApiModularityTest' --tests '*ModulithViolationFixtureTest'`；确认测试因生产模块集合尚非 `access`、`project`、`automation`、`agent`，或禁止 fixture 未产生预期内部访问 violation 而失败，而非编译/环境错误。
- [ ] 2.2 Green: 创建四个 capability 根包及最小模块 metadata/公开面，不预建空的 controller、service、repository、command、event 或 aggregate；使生产 `ApplicationModules.verify()` 通过、模块集合精确匹配，并让禁止 fixture 产生可定位的 violation，执行同一 focused 命令确认通过。
- [ ] 2.3 Refactor: 收敛模块名、fixture 和公开面声明的重复配置，确认没有通过扩大公开包、建立巨大 `common/shared` 或引入 `FreezingArchRule` 规避规则；重跑 `./gradlew :services:core-api:test`。

## 3. ArchUnit 技术边界保护

- [ ] 3.1 Red: 为每类 ArchUnit 规则添加独立允许/禁止 fixture 元测试，覆盖 model 对 MVC/Security/persistence/transport/provider 的隔离、persistence/provider 类型泄漏、三类 API surface 互引、controller 跨 capability 内部访问、Core API 反向依赖其他项目实现及 shared/common 逃逸；执行 `./gradlew :services:core-api:test --tests '*ArchitectureRuleSelfTest'`，确认禁止 fixture 因“预期 rule id violation 未出现”而失败，允许 fixture 不因配置错误失败。
- [ ] 3.2 Green: 实现具名 ArchUnit JUnit 5 规则和生产扫描测试，使允许 fixture/生产结构通过、每个禁止 fixture 精确命中来源和目标；执行 `./gradlew :services:core-api:test --tests '*CoreApiArchitectureTest' --tests '*ArchitectureRuleSelfTest'`。
- [ ] 3.3 Refactor: 抽取稳定 package predicate 和 violation 断言辅助代码，保持 Modulith 管模块图、ArchUnit 管技术类型依赖且不重复；配置 fixture source set 与生产扫描隔离，并执行 `./gradlew :services:core-api:test :services:core-api:verifyBuildContract`，确认测试/fixture 类型不进入 runtime JAR。

## 4. 模块上下文、应用启动与受限健康面

- [ ] 4.1 Red: 添加四个 standalone `@ApplicationModuleTest`、`CoreApiApplicationSmokeTest` 和健康 HTTP 测试，执行 `./gradlew :services:core-api:moduleTest`；确认它们分别因缺少应用入口/模块 wiring/受限 management 配置出现目标上下文或 HTTP 断言失败，而非编译或外部服务错误。
- [ ] 4.2 Green: 添加最小 Spring Boot 入口、Spring Modulith Test 配置、四模块 standalone 测试所需的最小 wiring 和 Actuator probe 白名单；不得引入业务 API 或外部服务依赖，执行 `./gradlew :services:core-api:moduleTest`，确认四模块仅在声明依赖内启动、允许的健康请求成功且非必要 management 信息不可访问。
- [ ] 4.3 Refactor: 合并重复的 module-test setup 并保持 standalone bootstrap 语义，不用单个完整应用上下文代替模块测试；重跑 `./gradlew :services:core-api:moduleTest :services:core-api:test`。

## 5. 测试 source set 与快速反馈边界

- [ ] 5.1 配置独立的 `test`、`moduleTest`、`integrationTest` source set/task 及标准报告目录，确保测试依赖/fixtures 不进入生产 classpath；执行 `./gradlew :services:core-api:tasks --all` 验证三个入口存在。
- [ ] 5.2 实现稳定的 `:services:core-api:verifyBuildContract` 机器检查任务，断言三个 source set/task 存在，`test` 只归属 unit、Modulith graph 和生产 ArchUnit，且其 task 依赖/classpath 不包含 `moduleTest`、`integrationTest` 或 Testcontainers；执行该任务及 `./gradlew :services:core-api:test` 确认无容器快速完成，`--dry-run` 只作诊断而非验收证据。
- [ ] 5.3 扩充 `verifyBuildContract`，断言 `moduleTest` 仅归属 capability wiring、应用 smoke 和健康 HTTP 用例，`integrationTest` 仅归属真实基础设施用例，并检查测试 source set 不进入生产 classpath/runtime artifact；执行 `./gradlew :services:core-api:verifyBuildContract :services:core-api:moduleTest`，避免同一风险在三层重复测试。

## 6. PostgreSQL 与 Flyway 真实基础设施通道

- [ ] 6.1 Red: 在确认 Docker/Testcontainers 可用后添加 `PostgreSqlFoundationIntegrationTest`，执行 `./gradlew :services:core-api:integrationTest --tests '*PostgreSqlFoundationIntegrationTest'`；确认因 datasource/Flyway 尚未连接容器而在“数据库产品为 PostgreSQL”或 migration lifecycle 断言失败，Docker 不可用不得记为有效 Red。
- [ ] 6.2 Green: 将 integration source set 连接 Testcontainers PostgreSQL 和 Flyway，使用空 schema 或位于 `src/integrationTest/resources` 独立 location、仅由测试显式启用的 probe migration，验证真实连接、无 pending migration 及隔离生命周期；不得增加 H2 或生产业务 migration，执行 focused integration test 两次，并用 `:services:core-api:verifyBuildContract` 确认 probe migration 不进入 runtime artifact。
- [ ] 6.3 Refactor: 收敛容器、datasource 和清理 fixture，明确容器复用与测试状态隔离策略；运行 `./gradlew :services:core-api:integrationTest`，并在无容器探针环境确认任务明确失败而非 skip/fallback（调用方若不具备容器只能显式不调用该任务）。

## 7. 静态质量、覆盖率与统一门禁

- [ ] 7.1 配置 ktlint、Detekt 和 Kotlin compile/format check，使用最小、可解释的规则配置且不以大范围 baseline 隐藏当前问题；执行对应插件生成的格式检查、Detekt 和 compile 任务并确认通过。
- [ ] 7.2 配置 Kover 聚合 `test`、`moduleTest` 和 `integrationTest` 对同一生产 class 集的执行数据，生成 XML/HTML，并以 module-wide 80% line、75% branch 作为本次“全部生产代码均为新增”的 bootstrap changed-code 等价门禁和 whole-subproject baseline；执行 `./gradlew :services:core-api:koverXmlReport :services:core-api:koverHtmlReport :services:core-api:koverVerify`，不得创建低覆盖 fixture 伪造 Red。
- [ ] 7.3 review 并最小化覆盖率排除项，仅允许生成代码、package descriptor 和明确的纯配置样板；补充最低可靠层测试覆盖真实分支并重跑 focused suites 与 Kover，不得降低阈值、写无意义断言或把生产逻辑移入测试代码。文档明确普通 module threshold 不能作为后续混合变更的 diff-aware changed-code 证据。
- [ ] 7.4 创建 `:services:core-api:qualityCheck`，组合 compile、format check、Detekt、`test`、`moduleTest`、`integrationTest`、`verifyBuildContract` 和 Kover report/verify；扩充 `verifyBuildContract` 机器断言这些依赖均已接入且 `test` 仍不依赖容器，然后执行 `./gradlew --no-daemon :services:core-api:qualityCheck`。不得创建含义模糊的根 `qualityCheck`；未来可选根别名只能命名为 `coreApiQualityCheck`。

## 8. 文档对齐与最终验证

- [ ] 8.1 根据实际源码和已通过命令，在 `services/core-api/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md` 中新增或更新明确标为 Current 的基础工程、模块保护和测试命令小节；文档级 `Status` 在其主要业务架构仍未实现时保持 Target，未来协议、持久化模型和场景也保持 Target。执行仓库现有 Markdown 链接检查或新增的等价相对链接检查。
- [ ] 8.2 最小修正根 README/architecture 中“仓库无 runnable application”等已过时事实；修改共享根文件前重新读取当前内容并合并并行 session 修改。重新计算第 1.1 步受保护路径的状态、内容哈希和 binary diff，与 baseline 比较；若 Desktop、Agent Runtime 或非本 Change 根文档内容在执行期间变化，暂停并对齐，禁止覆盖。
- [ ] 8.3 从 clean build 目录执行 `./gradlew --no-daemon clean :services:core-api:test :services:core-api:moduleTest :services:core-api:integrationTest :services:core-api:verifyBuildContract` 和 `./gradlew --no-daemon :services:core-api:qualityCheck`，核对 JUnit、Detekt、ktlint、Kover、architecture、module 和 PostgreSQL 报告均生成且无静默跳过。
- [ ] 8.4 执行 `openspec validate bootstrap-core-api-foundation --strict --no-interactive`、Markdown 相对链接检查、`git diff --check`、`git status --short` 和 `git diff --stat`；逐项对照本 Change spec/test-plan，确认无业务 API、业务 migration、持久化方案、Gateway、Redis、broker、Desktop/Runtime 协议或 speculative DDD 层越界内容。
