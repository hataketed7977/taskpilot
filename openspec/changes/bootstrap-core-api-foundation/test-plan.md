# Test Plan

## Scope and Risk

本 Change 影响根 Gradle Kotlin DSL/Wrapper 入口、`services/core-api` Spring Boot 应用、四个 Spring Modulith capability、ArchUnit 技术边界、三个测试 source set/task、PostgreSQL Testcontainers 通道以及 Detekt、ktlint、Kover 和 `:services:core-api:qualityCheck`。它属于**中高工程风险、低业务数据风险**：没有业务行为和生产数据迁移，但如果脚手架、模块扫描或质量门禁错误，后续业务代码可能在没有真实架构保护的情况下持续增长，且 CI 可能出现“绿色但未执行目标测试”的假阳性。

主要逃逸缺陷及影响：

- Wrapper、插件或版本组合不可复现，导致干净 checkout 或 CI 无法构建。
- Modulith 未发现预期模块或只对空包验证，导致循环、未声明依赖和内部实现访问无法被拒绝。
- ArchUnit 扫描路径、规则谓词或 fixture 配置错误，导致规则空通过或 fixture 被打入运行时产物。
- `test` 意外启动容器，或 `integrationTest` 静默回退 H2，破坏反馈速度或数据库语义可信度。
- `:services:core-api:qualityCheck` 漏接 lint、格式、架构、模块、集成或覆盖率任务，产生不完整合并信号。
- Actuator 暴露过多信息，或基础应用隐式依赖 Redis、消息中间件、Desktop、Agent Runtime 等未实现服务。
- 与并行 Desktop 工作共享根文件时覆盖他人改动。

显式非目标：登录、业务 API、业务表或生产 migration、JPA/JDBC 业务持久化选择、Gateway、Redis、消息中间件、Desktop/Agent Runtime 协议、业务状态机和 mutation testing。没有浏览器界面或外部 API 契约变化，因此不增加 Cypress/Playwright、OpenAPI compatibility 或跨进程系统测试。

覆盖率遵循根架构策略：Kover 聚合三个测试任务对同一生产 class 集的执行数据。本 Change 创建 Core API 的全部手写可执行生产代码，因此首次 module-wide 至少 80% line、75% branch 与本 Change 的 changed-code 口径等价，并建立 whole-subproject baseline；该 bootstrap 等价关系不得用于后续混合变更。仅生成代码、package descriptor 和经明确说明的纯配置样板可排除；应用入口、手写健康/安全配置和未来业务逻辑不得为了达标而隐藏。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Test Layer | Planned Automated Test | Why This Layer |
| --- | --- | --- | --- |
| 干净环境使用固定 Wrapper 完成快速构建 | build / clean-checkout | 从无预装 Gradle 假设出发执行 `./gradlew --no-daemon clean :services:core-api:test`，并检查 Wrapper 与 version catalog 均为固定版本 | 直接验证可复现入口和依赖解析，而不是依赖开发机全局 Gradle |
| 基础应用无外部业务服务即可启动 | module / application smoke | `CoreApiApplicationSmokeTest` 启动最小 Spring Boot 上下文，测试配置不提供 Redis、broker、Desktop 或 Runtime | 最小 Spring 上下文能发现装配和隐式外部依赖错误，又不需要数据库容器 |
| 健康检查只暴露必要 probe | module / HTTP | 使用 MockMvc 或 WebTestClient 请求配置的 liveness/readiness/health 路径，断言成功、响应字段白名单及非公开 Actuator 路径不可访问 | HTTP 层验证真实 management 配置和信息泄漏风险，单元测试不足以覆盖端点装配 |
| 发现且只发现四个初始 capability | fast architecture | `CoreApiModularityTest` 对生产根包构造 `ApplicationModules`，断言模块名集合恰为 `access`、`project`、`automation`、`agent` 并执行 `verify()` | 快速、无 Spring 上下文，直接保护模块发现和合法模块图 |
| Modulith 能拒绝跨模块内部访问 | architecture self-test fixture | `ModulithViolationFixtureTest` 对独立禁止 fixture 执行 `ApplicationModules.verify()`，断言失败且 violation 指向来源、目标与内部类型；合法 fixture 同时通过 | 正反 fixture 证明检查会命中目标违规，避免扫描错包或空通过 |
| 每个 capability 可在声明依赖内独立启动 | module | 四个 `@ApplicationModuleTest(verifyAutomatically = true)` standalone 测试，断言对应模块上下文启动，且不会用完整应用上下文代替 | Spring Modulith Test 是捕获隐式 wiring 和未声明模块依赖的最低可靠层 |
| 生产代码技术边界合法 | fast architecture | `CoreApiArchitectureTest` 扫描生产 artifact，执行 model/framework 隔离、persistence/provider 泄漏、API surface 隔离、controller 越界、反向项目依赖及禁止巨大 shared/common 的 ArchUnit 规则 | ArchUnit 负责 Modulith 模块图之外的类型与框架依赖规则，且可保持无容器快速反馈 |
| 每类 ArchUnit 规则确实接受合法结构并拒绝违规结构 | architecture self-test fixture | 按规则类别执行允许/禁止 fixture 元测试；允许集合无 violation，禁止集合断言指定 rule id、来源和目标 violation；生产扫描显式排除 fixture | 防止规则谓词写错、包命名不匹配或 `noClasses()` 空选择导致假绿 |
| 测试 fixture 与 probe migration 不进入运行时 artifact | build contract | `:services:core-api:verifyBuildContract` 检查 runtime JAR/classpath 中不存在 architecture fixture、测试类和 `integrationTest` 专用 Flyway location | source set 配置错误属于产物风险，运行时扫描无法替代制品检查 |
| `test` 快速且不启动 PostgreSQL | build contract + fast suite | `:services:core-api:verifyBuildContract` 断言 `test` 不依赖 `integrationTest` 或 Testcontainers，再运行 `:services:core-api:test` | 从任务依赖、classpath 和实际执行三侧证明快速反馈边界，不用脆弱的计时阈值 |
| `moduleTest` 只验证模块/限定 Spring 上下文 | module | 执行四个 module test 及应用 smoke/health 测试；模块用例断言 bootstrap mode 和已启动模块集合，不以单个 full-context 测试替代 | 捕获 Spring wiring 风险，同时保留模块隔离证据 |
| PostgreSQL/Flyway 集成通道真实可用且可重复 | infrastructure | `PostgreSqlFoundationIntegrationTest` 使用 Testcontainers PostgreSQL 和真实 datasource/Flyway，执行两次隔离上下文或 migration lifecycle，断言连接产品为 PostgreSQL、无 pending migration；若需表结构仅使用 test-only probe migration | 只有真实 PostgreSQL 能证明 driver、连接、Flyway 和清理生命周期；不引入生产业务 schema |
| 容器不可用时不回退 H2 | infrastructure / negative environment | 依赖 Testcontainers 的测试显式要求 Docker；配置/依赖检查断言无 H2，CI 的无容器探针或 Testcontainers 标准失败信息证明任务失败；调用方若跳过必须不调用 `integrationTest` | 防止“绿色但换了数据库”的误报，同时让环境前置条件清晰 |
| Core API 专属质量入口覆盖全部门禁 | build contract | `:services:core-api:verifyBuildContract` 机器断言 `:services:core-api:qualityCheck` 依赖 compile、format check、Detekt、`test`、`moduleTest`、`integrationTest`、Kover report/verify，且运行聚合任务时任一依赖失败会由 Gradle 传播 | 验证聚合任务不是空壳，又不把 Core API 门禁误称为全仓质量入口 |
| 覆盖率阈值、聚合范围和排除策略生效 | coverage / build contract | 执行 Kover XML/HTML report 与 verify，断言三个测试任务的生产覆盖数据被纳入、module-wide line ≥ 80%、branch ≥ 75%，并把结果保存为 bootstrap whole-subproject baseline | 首次全部生产代码均为新增，因此 module-wide 可作为本 Change changed-code 证据；review 防止后续误用或滥用排除 |
| 并行 Desktop/Agent Runtime Change 不被覆盖 | repository isolation | apply 开始时保存受保护路径的 Git 状态、内容哈希和 diff baseline，结束时重新计算并比较；若期间变化则暂停并对齐，不直接覆盖 | 共享 checkout 原本已有 diff，要求最终 diff 为空会误报；baseline 比较能发现执行期间变化 |

## TDD Slices

本 Change 没有产品业务行为，以下 Red/Green/Refactor 是针对**可观察工程约束**的测试驱动切片。纯 Wrapper/插件引导无法在测试框架存在前形成有效行为 Red，记录在“Exceptions and Manual Evidence”；不得用编译失败、依赖下载失败或 Docker 不可用冒充 Red。

### Slice 1: 生产模块图可发现且可拒绝越界

- **Red:** 在最小测试基础可运行后，先执行 `./gradlew :services:core-api:test --tests '*CoreApiModularityTest' --tests '*ModulithViolationFixtureTest'`；预期因模块 descriptor/公开面尚未建立而出现“缺少四个模块”断言，且禁止 fixture 若未被规则识别也必须因“预期 violation 未出现”而失败。
- **Green:** 添加四个 capability 根包和最小 Spring Modulith module metadata，使生产模块集合精确匹配且 `verify()` 通过；隔离的非法 fixture 因访问其他模块内部类型而产生预期 violation。
- **Refactor:** 去除重复模块名/包匹配代码并保持公开面最小，重跑两个 focused tests 和完整 `:services:core-api:test`；禁止用 `FreezingArchRule` 或扩大公开包消除失败。

### Slice 2: ArchUnit 技术边界不是空规则

- **Red:** 对每类规则先写允许/禁止 fixture 元测试，执行 `./gradlew :services:core-api:test --tests '*ArchitectureRuleSelfTest'`；预期禁止 fixture 在规则尚缺失时因“没有检测到指定 violation”失败，允许 fixture 不得因测试配置错误失败。
- **Green:** 实现最小、具名的 ArchUnit 规则，使允许 fixture 通过，禁止 fixture 分别命中 model/framework、persistence/provider、API surface、controller/模块内部、反向项目依赖和 shared/common 逃逸规则；生产扫描排除 fixture。
- **Refactor:** 抽取稳定 package predicate 和 violation 断言辅助函数，但不合并语义不同的规则；重跑 self-test、`CoreApiArchitectureTest` 和 runtime artifact 检查。

### Slice 3: 模块上下文与基础健康面可启动

- **Red:** 先添加四个 standalone `@ApplicationModuleTest`、应用 smoke 和健康 HTTP 测试，执行 `./gradlew :services:core-api:moduleTest`；预期因应用入口、模块 wiring 或受限 management 配置缺失而产生具体上下文/HTTP 断言失败，而不是编译或环境失败。
- **Green:** 添加最小 Spring Boot 入口、模块配置和 Actuator 暴露策略，使四个模块在声明依赖内启动，应用无需未实现外部服务即可启动，允许的 health probe 成功且其他 management 信息不可见。
- **Refactor:** 精简测试配置和重复的 module-test setup，确保模块用例仍使用 standalone 模式，重跑 `moduleTest` 和快速架构测试。

### Slice 4: PostgreSQL/Flyway 通道使用真实基础设施

- **Red:** 在 Docker 可用且 Testcontainers 测试基座可启动后，先执行 `./gradlew :services:core-api:integrationTest --tests '*PostgreSqlFoundationIntegrationTest'`；预期因 datasource/Flyway 尚未连接到容器而在“数据库产品必须为 PostgreSQL”或 migration lifecycle 断言失败。Docker 不可用不是有效 Red。
- **Green:** 将 integration source set 连接到 Testcontainers PostgreSQL，使用 Flyway 对空 schema 或 test-only probe migration 完成生命周期验证并保证重复执行隔离；不添加 H2 或生产业务 migration。
- **Refactor:** 收敛容器与 datasource fixture、明确复用/隔离策略，重跑 targeted integration test 两次及完整 `integrationTest`。

分层任务接线、统一质量入口和覆盖率阈值属于构建工具约束，不伪造行为 TDD Red；它们使用 `verifyBuildContract`、Kover 报告/阈值和完整质量任务作为结构化证据，详见“Exceptions and Manual Evidence”。

## Verification Commands

以下命令是本 Change 必须创建、记录并实际验证的可执行契约；当前尚无 Gradle 工程，因此命令在 apply 完成相应 scaffold task 后才存在。

### Focused

- `./gradlew --no-daemon :services:core-api:test`: 运行无容器的单元、生产 Modulith graph、ArchUnit 规则及正反 fixture 元测试。
- `./gradlew --no-daemon :services:core-api:test --tests '*CoreApiModularityTest' --tests '*ModulithViolationFixtureTest'`: 验证四模块集合、合法模块图和 Modulith 禁止 fixture。
- `./gradlew --no-daemon :services:core-api:test --tests '*CoreApiArchitectureTest' --tests '*ArchitectureRuleSelfTest'`: 验证生产技术边界及每类 ArchUnit 规则的允许/禁止样例。
- `./gradlew --no-daemon :services:core-api:moduleTest`: 运行四个 standalone module context、基础应用启动和受限健康 HTTP 测试。
- `./gradlew --no-daemon :services:core-api:integrationTest --tests '*PostgreSqlFoundationIntegrationTest'`: 在容器可用环境验证真实 PostgreSQL、Flyway 与重复执行隔离。
- `./gradlew --no-daemon :services:core-api:verifyBuildContract`: 机器验证 source set/task 归属、快速测试无容器、Core API 质量任务依赖、禁止依赖以及 runtime artifact 隔离。
- `./gradlew --no-daemon :services:core-api:koverXmlReport :services:core-api:koverHtmlReport :services:core-api:koverVerify`: 聚合三个测试任务的生产代码覆盖数据，生成 bootstrap whole-subproject baseline 并执行 80% line、75% branch 门禁。

### Affected and Cross-Boundary

- `./gradlew --no-daemon clean :services:core-api:test`: 从清理后的构建目录验证固定 Wrapper、编译和快速门禁；环境不得依赖预装 Gradle。
- `./gradlew --no-daemon :services:core-api:moduleTest :services:core-api:integrationTest`: 验证 Spring 模块与真实基础设施边界；需要可用容器运行时。
- `./gradlew --no-daemon :services:core-api:qualityCheck`: Core API 本地与 CI 的完整质量信号，必须组合 compile、format check、Detekt、三个测试层、`verifyBuildContract` 和 Kover report/verify，任一子门禁失败即失败；它不代表全仓质量门禁。
- `./gradlew --no-daemon :services:core-api:dependencies`: review 固定版本和依赖图，确认没有动态/SNAPSHOT 版本、H2、未批准 persistence starter 或与 Desktop/Runtime/Gateway 实现的依赖。
- `./gradlew --no-daemon :services:core-api:verifyBuildContract`: 稳定检查 runtime artifact 不包含 test/fixture 类型或 `integrationTest` 专用 Flyway probe migration，不依赖手工查找 JAR 文件名。
- `openspec validate bootstrap-core-api-foundation --strict --no-interactive`: 验证 Change artifacts 结构；它不替代实现、测试或源码 review。
- `git diff --check`: 检查 whitespace 错误。
- 仓库 Markdown 相对链接检查命令（若仓库已有则复用，否则在 apply 中记录实际可执行检查）：验证更新后的文档导航不产生断链。
- apply 开始和结束时分别执行 `git status --short -- apps/desktop apps/agent-runtime docs/architecture.md`、保存/比较这些路径的内容哈希与 `git diff --binary -- <paths>` baseline：发现执行期间变化时暂停并对齐；不要求原本已有的 diff 变为空。

## Exceptions and Manual Evidence

### 1. Gradle Wrapper、版本目录与插件接线的引导期

- **为什么行为 TDD 不适用：** 在 Wrapper、settings 和测试插件尚不存在时，无法先执行一个语义有效的 JUnit Red；“找不到 `gradlew`”、源码不能编译或依赖无法下载只是引导/环境失败，不证明目标行为缺失。
- **替代自动化证据：** 固定版本扫描、Wrapper checksum/配置 review、`./gradlew --version`、clean `:services:core-api:test`、依赖图、`:services:core-api:verifyBuildContract` 及完整 `:services:core-api:qualityCheck`。
- **手工验收：** review 官方 Spring Initializr 元数据和 Spring Boot/Spring Modulith 兼容矩阵的来源与选型记录；review version catalog 不含动态版本或 snapshot。
- **Owner：** Core API scaffold 实施者；reviewer 在 apply review 时复核。
- **Follow-up：** 工具链存在后，所有新增行为回到本计划的 Red/Green/Refactor 切片，不再沿用引导例外。

### 2. 文档状态和命令更新

- **为什么行为 TDD 不适用：** 文档措辞本身不是运行时行为，且不能用测试证明 Target/Current 判断的完整语义。
- **替代自动化证据：** Markdown 相对链接检查、命令逐条执行、OpenSpec strict validation 和 `git diff --check`。
- **手工验收：** 对照实际文件与测试结果，仅将已实现的 Core API 基础工程、命令和门禁局部标为 Current；业务模块、协议、数据库模型和未来测试场景继续保持 Target。
- **Owner：** Change 实施者与最终 reviewer。
- **Follow-up：** 后续业务 Change 在对应实现与测试落地时继续局部更新状态。

### 3. 容器运行时不可用环境

- **为什么不是测试豁免：** Docker/Testcontainers 不可用是执行环境限制，不是允许 integration test 变绿的理由，也不是有效 Red。
- **替代自动化证据：** 调用方可以明确只执行 `test`/`moduleTest`，但合并或发布信号必须在具备容器的环境执行 `integrationTest`/`:services:core-api:qualityCheck`；项目不得配置 H2 fallback 或自动 skip。
- **手工验收：** 无。环境错误必须保留明确诊断。
- **Owner：** CI/本地执行者负责提供容器环境，Core API 构建负责快速失败和清晰提示。
- **Follow-up：** CI 初始化时将 `:services:core-api:qualityCheck` 放到具有容器能力的 required job。

### 4. 构建接线与覆盖率门禁

- **为什么行为 TDD 不适用：** source set/task 依赖、Kover 聚合和阈值是构建工具配置，不是产品行为；故意制造低覆盖生产类或临时破坏任务来获得 Red 会污染实现或产生不可复核步骤。
- **替代自动化证据：** `:services:core-api:verifyBuildContract` 机器检查任务图、classpath 和 runtime artifact；Kover 聚合三个测试任务并生成 XML/HTML，`koverVerify` 执行 module-wide 80% line、75% branch。
- **手工验收：** review 覆盖率排除列表，并明确首次 module-wide 指标仅因全部生产代码均为本 Change 新增而等价于 changed-code；后续 Change 需使用 Kover XML 加版本控制 diff 的 changed executable coverage。
- **Owner：** Core API scaffold 实施者与最终 reviewer。
- **Follow-up：** 在首个后续生产行为 Change 或 CI 初始化中补齐 diff-aware changed-code 报告，同时维持本次 whole-subproject baseline。
