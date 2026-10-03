# Tasks

## 1. 生产模块元数据 Kotlin 化

- [x] 1.1 在 `AccessModule`、`ProjectModule`、`AutomationModule`、`AgentModule` Kotlin
  marker 上声明与现有 `package-info.java` 等价的 `@PackageInfo`、display name 和
  allowed dependencies；完成证据为源码 diff 保持四个模块名称及仅 `project -> access` 的
 允许依赖不变。
- [x] 1.2 删除四个生产 `package-info.java` 和空 `src/main/java` 目录，并在
  `verifyBuildContract` 增加 `src/main` 无 Java 的负向保护；完成证据为
  `find services/core-api/src/main -type f -name '*.java' -print` 无输出。
- [x] 1.3 运行
  `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.architecture.CoreApiModularityTest' --tests 'ai.taskpilot.coreapi.architecture.ModulithViolationFixtureTest'`
  以及 `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.*ModuleTest'`，确认模块发现、
  违规拒绝和四个限定上下文仍通过。
- [x] 1.4 同步 `services/core-api/docs/architecture.md` 的 Current production language 与
  Spring Modulith 元数据说明；完成证据为文档明确生产代码仅 Kotlin 且不改变模块边界。

## 2. 架构 fixture 归入 src/test 并按装载机制分流

- [x] 2.1 将 Spring Modulith fixture 按 package declaration 从旧目录移到普通
  `src/test/java/ai/taskpilot/architecturefixtures/modulith/**`，由标准 test source set 编译并保留
  在 test runtime classpath；自测试使用显式 `ImportOption` 允许默认被排除的测试输出。完成证据为
  `ApplicationModules.of(...)` 能扫描到对应 fixture。
- [x] 2.2 更新 `ModulithViolationFixtureTest`，在有效和无效场景中都先正向断言预期的 `alpha`、
  `beta` 模块已被发现，再分别断言无违规和预期内部访问违规；完成证据为测试不能在空扫描时
  通过，且聚焦执行该测试成功。
- [x] 2.3 将冲突敏感的 ArchUnit fixture 移到 `src/test/architecture-fixtures/java`，保留只产出
  fixture 字节码、不注册 Test 任务的内部 `architectureFixtures` source set；取消其对整个
  `testImplementation` 的继承，并补充 MVC `DispatcherServlet`、Security
  `SecurityFilterChain` 本地最小 stub。完成证据为 `compileArchitectureFixturesJava` 在该隔离
  配置下自包含编译成功，且旧 `src/architectureFixtures` 不存在。
- [x] 2.4 让标准 `test` 在 ArchUnit 自测试前构建隔离 fixture，通过声明的 task input/系统属性
  传递一个或多个 classes output 路径，并用 `ClassFileImporter.importPaths(...)` 显式导入；禁止把该 output
  加入普通 test runtime classpath。运行 `ArchitectureRuleSelfTest` 与
  `CoreApiArchitectureTest`，确认允许 case、每个禁止 case、生产扫描和违规定位均有效而非空
  通过，并通过 task/classpath 审查证明隔离成立。
- [x] 2.5 同步 `services/core-api/docs/testing-strategy.md` 与
  `services/core-api/docs/responsibilities.md` 的 fixture 放置及装载责任；完成证据为文档明确
  “所有资产物理归入 `src/test`、Modulith fixture 运行时可见、仅 ArchUnit fixture 内部隔离
  编译、两者都不是额外测试入口”。

## 3. 测试与资源统一到标准 test source set

- [x] 3.1 枚举 `src/moduleTest`、`src/integrationTest` 与目标 `src/test` 的相对路径，确认无覆盖
  冲突后，把 Kotlin 测试移到 `src/test/kotlin`、integration-only 资源移到
  `src/test/resources`；完成证据为文件清单一致且旧两个目录不存在。
- [x] 3.2 将 Testcontainers、PostgreSQL 和 Flyway 测试依赖归入标准 test 配置，删除
  `moduleTest`/`integrationTest` source set 与 Test 任务，不新增替代性的 JUnit tag/task；
  完成证据为 `./gradlew :services:core-api:compileTestKotlin` 通过且 Gradle task 列表不再包含
  两个旧任务。
- [x] 3.3 依次运行 `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.*ModuleTest'`、
  `CoreApiApplicationSmokeTest`、`CoreApiHealthHttpTest` 和
  `./gradlew :services:core-api:test --tests '*IntegrationTest'`，确认
  模块上下文、启动/健康以及真实 PostgreSQL/Flyway/HTTP 测试均由标准任务发现并通过；不得
  添加 Docker skip 或 H2 fallback。
- [x] 3.4 运行 `./gradlew :services:core-api:test` 并检查 JUnit 报告覆盖 unit、architecture、
  module/smoke 与所有现有 `*IntegrationTest`；完成证据为标准任务完整通过且报告无测试层
  漏失。
- [x] 3.5 同步 `services/core-api/docs/testing-strategy.md` 的 Current 目录、标准完整入口和
  `--tests` 聚焦示例，并更新 `services/core-api/docs/responsibilities.md` 的测试放置责任；完成
  证据为不再把旧 source set/任务描述成 Current。

## 4. 质量门禁和构建契约收敛

- [x] 4.1 将 Detekt 源目录收敛到 `src/main/kotlin` 与 `src/test/kotlin`；运行
  `./gradlew :services:core-api:detekt :services:core-api:ktlintCheck` 证明统一 Kotlin 树仍受检查。
- [x] 4.2 将 Kover 改为聚合标准 `test` 执行并保持 main-only 覆盖范围、80% 行和 75% 分支
  阈值；运行 `koverXmlReport`、`koverHtmlReport` 和 `koverVerify`，确认报告生成且阈值没有
  降低。
- [x] 4.3 更新 `qualityCheck` 只依赖现存的 compile、ktlint、Detekt、标准 `test`、
  `verifyBuildContract` 和 Kover 门禁；完成证据为任务依赖审查没有旧任务并保留全部保护。
- [x] 4.4 精简 `verifyBuildContract`：删除 source-set/任务名/测试文件名和三任务聚合等旧实现
  形状检查，保留 Boot JAR 入口、生产 migration、测试/fixture/探针排除、生产依赖、固定版本
  与质量任务检查，并增加旧三个顶层测试目录不存在的保护；运行
  `./gradlew :services:core-api:verifyBuildContract` 验证产物和结构。
- [x] 4.5 全仓迁移非历史脚本/CI/文档中的旧任务调用，并执行
  `rg -n 'src/(moduleTest|integrationTest|architectureFixtures)|:services:core-api:(moduleTest|integrationTest)|tasks?\.(named|register).*"(moduleTest|integrationTest)"' --glob '!openspec/changes/archive/**' .`；
  完成证据为除本 Change 迁移说明外无残留调用。
- [x] 4.6 同步 `services/core-api/docs/architecture.md` 和
  `services/core-api/docs/testing-strategy.md` 的 Current 质量任务、Detekt、Kover 和构建契约
  描述；完成证据为 owner 文档与实际 Gradle task graph 一致。

## 5. Model and Documentation Reconciliation

- [x] 5.1 将实现 diff、测试报告、Boot JAR、Gradle 任务图与 proposal/spec/design 对照，确认
  没有改变业务模型、API、migration、授权/租户、生命周期、并发、恢复或模块边界；任何材料
  漂移必须修复或在 Change 中明确记录，不得用测试通过代替语义审查。
- [x] 5.2 审核 `services/core-api/docs/architecture.md`、`testing-strategy.md`、
  `responsibilities.md` 的 Current/Target 状态和交叉引用；确认 `docs/business-model.md` 无新增
  领域事实、`docs/README.md` 无文档清单/所有权变化，并确认 `core-api-foundation` delta spec
  已准备同步。
- [x] 5.3 执行生产 Java 与旧顶层目录负向扫描、`git diff --check` 和
  `openspec validate simplify-core-api-source-and-test-layout --strict`，确认结构、文档和 Change
  产物无残留问题。
- [x] 5.4 在容器可用环境执行最终
  `./gradlew --no-daemon :services:core-api:qualityCheck`，记录编译、格式、静态分析、完整测试、
  构建契约和覆盖率全部通过；若容器不可用则保持任务未完成并在可用环境补跑，不得静默跳过。
- [x] 5.5 按 archive workflow 同步 `core-api-foundation` delta spec 并归档本 Change；完成证据
  为主 spec 反映标准 `src/test`/`test` 契约、严格校验通过且工作树不含未处理的本 Change
  实现或文档漂移。
