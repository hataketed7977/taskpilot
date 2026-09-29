# Design

## Context

见 [`proposal.md`](proposal.md)。仓库当前没有 Gradle Wrapper、Kotlin 源码、数据库 migration 或可执行测试；Core API 文档批准的是 Kotlin/Spring Boot/Spring Modulith 模块化单体，四个初始能力为 `access`、`project`、`automation`、`agent`。本 Change 必须把这些 Target 约束变成最小可执行工程，但不能借脚手架提前实现业务模型、决定持久化映射方式，或触碰正在独立设计的 Desktop。

根架构指定 Gradle Kotlin DSL。初始化会写根 Gradle 入口，因此 apply 前必须重查并合并其他 session 新增的根构建文件或状态文档，不能覆盖并行工作。开始 apply 时对不属于本 Change 的 `apps/desktop/`、`apps/agent-runtime/` 以及已有根文档修改记录路径清单、内容哈希和 Git diff baseline；结束时比较 baseline。若受保护内容在执行期间变化，停止并与对应 session 对齐，而不是以‘最终 diff 为空’判断归属。

## Goals / Non-Goals

**Goals:**

- 建立可由 Wrapper 重复构建的根 Gradle 多项目骨架及 `services/core-api` 子工程。
- 建立最小 Spring Boot Core API、受限健康检查和四个 Spring Modulith 模块描述。
- 让 Spring Modulith Test 与 ArchUnit 从第一次提交起成为阻断性架构测试。
- 让快速测试、模块测试和 PostgreSQL 集成测试具有独立任务及清晰的反馈时间边界。
- 建立格式、静态分析和覆盖率基础门禁，并把实际命令写回 owning 文档。

**Non-Goals:**

- 不实现登录、Workspace、Project、Board、Work Item、Workflow、Agent Run 或任何业务 API。
- 不创建业务表或业务 migration，不决定 Spring Data JPA、Spring Data JDBC 或其他业务持久化映射方案。
- 不初始化 Gateway，不引入 Redis、外部 broker、服务发现或分布式事务。
- 不实现 Desktop/Agent Runtime 协议，不修改其源码或规划 artifacts。
- 不预建每个 capability 的 `application/model/infrastructure` 空目录、Repository、Command、Event 或 Aggregate。

## Decisions

### 1. 根 Gradle 多项目入口只初始化 Core API

仓库根新增 Gradle Wrapper、`settings.gradle.kts`、根 `build.gradle.kts` 和 version catalog，并只 include `:services:core-api`。Core API 保持独立子工程构建逻辑；未来 Gateway 可加入同一 Wrapper，但本 Change 不创建其工程。

版本在 apply 时依据 Spring Initializr 元数据、Spring Boot 与 Spring Modulith 官方兼容矩阵选择当时最新稳定兼容组合，并在 version catalog、Wrapper 和构建文件中固定。禁止动态版本、snapshot 和无上界范围。选定版本及来源记录在实施报告；不把随时间变化的版本号写成产品 spec。

选择根多项目入口而不是每个服务各带 Wrapper，是为了统一 JVM toolchain、依赖解析和 CI 缓存，同时不把 JavaScript/Desktop 纳入 Gradle。`./gradlew :services:core-api:<task>` 是 Core API 的规范执行入口。

### 2. 最小应用不依赖未实现的基础设施

应用根包使用单一稳定命名空间，应用入口位于根包，四个 capability 是其直接子包。应用初始只提供 Spring Boot、MVC、Validation、Security、Actuator 和 Modulith 所需配置；生产启动不要求 PostgreSQL、Redis、Gateway、Desktop 或 Runtime 存在。

只暴露 health/liveness/readiness 所需的 management endpoint，默认不暴露环境、配置、bean 或敏感详情。基础安全配置采用 fail-closed：除了明确的健康探针，没有占位业务路由或 permit-all API。

PostgreSQL driver、Flyway 和 Testcontainers 可先作为 `integrationTest` 基础依赖验证真实数据库测试通道；业务 datasource 自动配置、migration 和数据访问框架留给首个持久化纵向切片。若验证 Flyway 需要 probe migration，它只存在于 `integrationTest` resources 的独立 location，并由测试显式配置，`bootJar`/运行时 classpath 验证不得包含该资源。这样既验证 PostgreSQL/Flyway 工具链，又不让空脚手架因数据库缺失无法启动或产生伪生产 schema。

### 3. Spring Modulith 拥有业务能力模块图

应用根包下的 `access`、`project`、`automation`、`agent` 是四个初始 application module。每个模块通过包级 descriptor 显式声明并在初始状态不允许跨模块依赖；后续真实用例需要协作时，必须在对应 Change 中定义最窄公开契约和 allowed dependency。

跨模块公开契约放在 capability 根包；`application`、`model`、`infrastructure` 和 transport adapter 子包默认视为内部实现。只有出现多个有意义的公开面时才引入 `@NamedInterface`。不创建 `common` 或 `shared` 逃生包；真正跨模块且无明确 owner 的技术值对象必须先证明归属再添加。

快速架构测试使用 `ApplicationModules.of(...).verify()`，同时断言恰好发现四个初始 capability。`moduleTest` 为四个模块提供最小 `@ApplicationModuleTest` standalone 启动保护；模块获得真实组件后，在同一个业务 Change 中扩充其 module test，而不是另建重复的全应用测试。

### 4. ArchUnit 只保护 Modulith 之外的技术依赖

显式使用 ArchUnit JUnit 5，规则集中在专用 architecture test 中，至少保护：

- `model` 不依赖 Spring MVC、Spring Security、持久化 API、transport DTO 或 provider SDK；
- capability 的 `infrastructure` 与持久化类型不被其他 capability 引用；
- Desktop、public、managed-execution transport surface 不相互依赖；
- controller/transport adapter 不直接访问其他 capability 的内部实现或 repository；
- Core API 不依赖 Desktop、Agent Runtime 或 Gateway 实现包；
- 生产代码不引入禁用的通用 `common/shared` 边界绕过包。

模块循环、内部包访问和模块 allowed-dependency 由 Spring Modulith 负责，不在 ArchUnit 重复实现。每个 ArchUnit 规则类别配备独立的允许/禁止 fixture source set；规则元测试确认允许 fixture 通过、禁止 fixture 确实产生对应 violation。生产扫描排除 fixture，fixture 也不会进入运行时 artifact。

### 5. 三个测试入口优化反馈速度

测试遵循 [`services/core-api/docs/testing-strategy.md`](../../../services/core-api/docs/testing-strategy.md)：

- `test`：纯 JUnit/Kotlin 单元测试、`ApplicationModules.verify()` 和生产代码 ArchUnit 扫描；不启动容器，作为秒级默认反馈。
- `moduleTest`：独立 source set，运行 `@ApplicationModuleTest`、Spring slice 和 capability wiring；只启动被测模块及声明依赖。
- `integrationTest`：独立 source set，使用 Testcontainers PostgreSQL 验证真实连接、Flyway 生命周期和重复执行隔离；容器不可用时明确失败，不回退 H2。

Core API 子工程的 `:services:core-api:qualityCheck` 组合编译、格式检查、Detekt、`test`、`moduleTest`、`integrationTest`、Kover 报告与验证。根项目不创建含义模糊的全仓 `qualityCheck`；未来若需要根快捷入口，应使用明确的 `coreApiQualityCheck`，真正的全仓门禁只能在各子项目质量任务都存在后聚合。CI 可先运行快速门禁，再并行 module/integration，但发布合并信号必须覆盖完整 Core API 任务。测试报告和覆盖率报告使用 Gradle 标准目录，便于 CI 保存。

构建契约由稳定的 `:services:core-api:verifyBuildContract` 机器检查任务保护。该任务验证 source set/task 存在性与归属、`test` 不依赖容器任务或 Testcontainers、`qualityCheck` 的必需依赖、H2/未批准依赖缺失，以及测试/fixture/probe migration 不进入运行时产物。它替代依赖人工阅读 `--dry-run` 输出的模糊‘自检’。

本 Change 是工程与约束脚手架，产品行为 TDD 不适用；使用 `verifyBuildContract`、架构禁止 fixture、模块上下文、健康请求和真实 PostgreSQL fixture 作为自动化结构证据。编译、依赖下载或环境失败不算 Red。后续任何业务行为仍按 Red/Green/Refactor 落在最低可靠层。

### 6. 覆盖率只约束手写可执行生产代码

Kover 从初始化开始聚合 `test`、`moduleTest` 和 `integrationTest` 对同一生产 class 集的执行数据，并产生 XML/HTML 报告。因为本 Change 引入了 Core API 的全部手写可执行生产代码，首次 module-wide 80% line、75% branch 门禁与本 Change 的 changed-code 口径等价；这是仅适用于 bootstrap 的明确例外，同时报告值成为 whole-subproject 非回退 baseline。生成代码、package descriptor 和纯配置样板可显式排除，应用入口、安全配置、健康相关手写逻辑不得为达标而隐藏。

普通 Kover module threshold 不得在后续混合新增/既有代码的 Change 中冒充 diff-aware changed-code coverage。后续生产代码 Change 必须结合 Kover XML 与版本控制 diff 产生 changed executable line/branch 证据，并维持 whole-subproject baseline；该能力若尚未进入 CI，应在首个后续生产行为 Change 中补齐。未来引入关键授权、租户、并发或幂等逻辑时，同一业务 Change 还需增加根策略要求的更高关键分支门禁。本基础 Change 不创建虚假的 critical package、低覆盖率 fixture 或空 mutation-testing 配置。

### 7. 文档状态随实现证据局部更新

完成 apply 后，在 Core API 文档中新增或更新明确标注为 Current 的基础工程、命令和架构门禁小节；只要文档仍主要拥有尚未实现的业务架构，其文档级 `Status` 继续保持 Target。尚未实现的业务模块内容、数据库结构、协议和测试场景继续标为 Target，不把整个 Core API 文档一键改成 Current。

根 README/architecture 中“仓库完全没有 runnable application”的陈述需按实际状态做最小修正；若并行 Desktop Change 已修改同一段，必须合并事实而不是覆盖。文档列出 `test`、`moduleTest`、`integrationTest`、`:services:core-api:qualityCheck` 的准确 Gradle 命令。

## Risks / Trade-offs

- **[官方版本在实施时发生变化或组合不兼容]** → apply 时查询官方兼容元数据、固定版本，并由 clean build 与依赖解析验证；不根据记忆猜版本。
- **[空模块让 Modulith 测试看似通过却没有保护价值]** → 显式断言模块集合，并为每个模块运行 standalone context；首个真实组件必须同步扩充 module test。
- **[ArchUnit 规则空通过或扫描错包]** → 每类规则添加允许/禁止 fixture 元测试，并断言禁止示例产生目标 violation。
- **[架构规则与 Modulith 重复导致维护成本]** → 模块图只归 Spring Modulith，技术类型/框架依赖只归 ArchUnit。
- **[完整质量任务因 Testcontainers 变慢]** → `test` 保持无容器；module/integration 独立并可在 CI 并行，但不通过静默跳过换取绿色。
- **[过早引入 JDBC/JPA 固化业务模型]** → 生产代码暂不选择业务数据访问框架；PostgreSQL/Flyway 只证明集成测试通道。
- **[与并行 Desktop/Agent Runtime session 冲突]** → Core API 源码和文档为主要写集；apply 开始时记录受保护路径的状态、内容哈希和 diff baseline，修改共享根文件前重新读取并合并。baseline 发生变化时暂停对齐，不能用最终目录 diff 必须为空来判断归属。
- **[健康端点泄漏运行信息]** → 只暴露必要 probe，安全与响应内容通过集成测试验证。

## Migration Plan

1. 实施前重查工作区、活动 OpenSpec Change 与根构建文件，为并行 Desktop、Agent Runtime 和既有共享根文档修改生成状态、内容哈希与 diff baseline；后续变化必须暂停并对齐，禁止覆盖。
2. 依据官方兼容矩阵选择并固定 JDK、Kotlin、Spring Boot、Spring Modulith 和测试/质量插件版本，生成并验证 Gradle Wrapper。
3. 初始化 Core API 应用、受限健康配置和四个模块 descriptor。
4. 先建立会因缺失约束失败的 architecture/module/health/PostgreSQL tests，再完成最小配置使其通过；对纯构建接线使用 test-plan 中的结构化例外。
5. 配置 `test`、`moduleTest`、`integrationTest`、`:services:core-api:qualityCheck`、Detekt、ktlint 和 Kover，并从干净环境执行完整门禁。
6. 局部更新 Core API 与根状态文档，运行 OpenSpec strict validation、Markdown 链接检查和 diff review。

该 Change 不包含生产数据迁移或部署迁移。回滚可删除 Core API 源码和 Gradle 初始化文件并恢复状态文档；不存在业务数据回滚。
