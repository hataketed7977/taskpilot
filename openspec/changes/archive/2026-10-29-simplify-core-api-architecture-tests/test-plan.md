# Test Plan

## Scope and Risk

本 Change 影响 Core API 测试源码布局、Spring Modulith/ArchUnit 架构测试以及 Gradle 构建接线，属于中等工程可靠性风险、无产品行为风险。主要逃逸缺陷是：生产模块图或技术边界未被实际扫描、标准 `test`/`qualityCheck` 漏掉架构测试、删除 source set 后测试编译或构建契约失效，以及 Java fixture 或旧引用残留。最坏影响是后续违规依赖进入主干而未被架构门禁发现，或 Core API CI 因无效构建配置失败。

无业务不变量、生命周期、授权/租户、并发、重试或恢复行为受到修改；业务 API、数据库、运行时、Desktop 和 Agent Runtime 均为非目标。人工 fixture 自身的失败不再是验收证据，验收对象是编译后的真实生产结构及标准构建入口。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| 当前生产模块图合法且精确发现六个能力 | 架构测试 | `CoreApiModularityTest` 对生产包断言精确模块集合并执行模块验证 | Spring Modulith 的真实生产图是模块循环、未声明依赖和内部访问的最低可靠边界 |
| 生产模块发生越界依赖时门禁失败 | 架构测试与源审查 | 保留 `modules.verify()`，代码审查确认未删除或弱化违规检查；完整 Core API 门禁执行该测试 | 不制造违规生产代码；真实模块验证和审查共同证明拒绝路径仍接入门禁 |
| 模块独立启动保护保持不变 | 模块测试 | 标准 `test`/`qualityCheck` 继续发现并执行现有 `CapabilityModuleTests` | 本 Change 不改模块上下文，完整受影响套件用于检测 Gradle 接线误伤 |
| 真实生产代码满足技术边界且扫描非空 | 架构测试 | `CoreApiArchitectureTest` 断言稳定架构根和非空生产类型后，对同一集合执行全部规则 | 直接消除整体导入为空造成的假通过，不需要影子正例 |
| 真实生产代码违反技术边界时规则失败 | 架构测试与源审查 | 保留每条规则的失败事件、规则 id、来源和目标信息；审查规则集合仍全部执行 | 自定义规则语义未改变，应用级证据应来自真实生产代码与规则实现，而非伪 FQCN fixture |
| 快速架构测试不启动 PostgreSQL | 聚焦测试 | 仅选择 `CoreApiArchitectureTest` 与 `CoreApiModularityTest` 执行并成功 | 证明删除 fixture 接线后快速反馈边界未退化 |
| 标准 `test` 仍发现完整测试套件 | 受影响套件 | `qualityCheck` 依赖标准 `test`，检查测试报告及任务成功 | 捕获 source set 删除导致的测试发现或任务图回归 |
| 手写测试源码只使用 Kotlin且无人工架构 fixture | 构建契约与负向扫描 | `verifyBuildContract` 拒绝 `src/test/**/*.java`、两类 fixture 目录和旧 `architectureFixtures` 接线；独立 `find`/`rg` 负向扫描 | 文件布局属于构建契约，不应以运行时行为测试替代 |
| PostgreSQL 边界、容器失败语义和模块上下文未被误伤 | 完整 Core API 门禁 | `:services:core-api:qualityCheck` | 虽无业务变化，Gradle `test` 接线改变可能影响完整套件发现，需一次受影响门禁验证 |
| Delta spec 与实现/文档一致 | Schema、结构验证与语义审查 | OpenSpec schema/strict validation；逐项对照 proposal、delta、design、tasks、代码和 owner 文档 | 结构通过不能证明语义一致，因此保留最终 model/documentation drift audit |
| 并行 Desktop 改动不被纳入 | Git diff 审查 | 检查本 Change 仅修改 `services/core-api/**` 和自己的 Change artifacts | 防止共享 checkout 中跨会话污染交付范围 |

## Implementation and Verification Approach

### Slice 1: 强化真实生产架构验证

这是测试治理变更，不使用 Red-Green-Refactor。直接在现有生产 ArchUnit 测试中增加稳定架构根/非空类集合断言，确认全部规则仍对同一生产类集合执行；复核生产 Spring Modulith 测试已精确断言六模块并执行完整验证。先运行两项聚焦架构测试，建立删除 fixture 前后的等价生产门禁证据。

### Slice 2: 删除影子架构与构建接线

删除两个 fixture 消费测试、47 个 Java fixture 和隔离 source set 接线；随后将构建契约收敛为 Kotlin-only 测试源码与无人工架构 fixture 的直接检查。依次执行测试编译、聚焦架构测试和构建契约，便于将失败定位到源码发现、规则执行或 Gradle 接线。

### Slice 3: 文档反馈与完整门禁

更新 Core API architecture/testing owner 文档，执行旧 fixture/source set 引用负向扫描。随后串行运行 Core API `qualityCheck`，避免并发 Gradle 测试任务争用结果目录；最后运行 OpenSpec schema 与全量严格验证，并进行模型/文档漂移审查。测试通过不替代对 delta spec、实际代码和文档的语义比较。

## Verification Commands

### Focused

- `./gradlew :services:core-api:compileTestKotlin --no-parallel`：证明删除 Java fixture 和额外 source set 后标准 Kotlin 测试源码可编译。
- `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.architecture.CoreApiArchitectureTest' --tests 'ai.taskpilot.coreapi.architecture.CoreApiModularityTest' --no-parallel`：证明真实生产 ArchUnit 与 Spring Modulith 门禁仍执行且不需要容器。
- `./gradlew :services:core-api:verifyBuildContract --no-parallel`：验证 Kotlin-only 测试布局、旧 source set 消失、运行时 JAR 与构建边界未受污染。
- `test ! -d services/core-api/src/test/java && test ! -d services/core-api/src/test/architecture-fixtures && ! find services/core-api/src/test -name '*.java' -print -quit | grep -q .`：确认两类 fixture 和全部 Java 测试源码消失。
- `! rg -n 'architectureFixtures|architecture-fixtures|ArchitectureRuleSelfTest|ModulithViolationFixtureTest|architecturefixtures' services/core-api --glob '!docs/architecture.md'`：确认代码、构建脚本和非 owner 文档不存在失效引用；另行人工审查 `services/core-api/docs/architecture.md` 中用于说明已删除现状的历史术语。

### Affected and Cross-Boundary

- `./gradlew --no-daemon :services:core-api:qualityCheck --no-parallel`：串行执行 Core API 编译、格式、静态分析、完整标准测试、覆盖率和构建契约门禁；需要本机容器运行时支持适用的 PostgreSQL 测试。
- `openspec schema validate taskpilot-sdd --verbose`：验证仓库 OpenSpec schema 仍有效。
- `openspec validate --all --strict --no-interactive`：验证活动 Changes 与主规格结构，包括本 Change 的完整 delta。
- `git diff --check -- services/core-api openspec/changes/simplify-core-api-architecture-tests`：检查本 Change 范围内的补丁格式问题。
- `git status --short` 与定向 `git diff`：确认没有修改、清理或纳入并行 Desktop Change。

## Manual Evidence and Automation Gaps

无。该 Change 不产生 UI、原生应用、外部服务或人工业务旅程；源码布局、架构扫描、构建接线和文档一致性均可由自动化命令与代码审查验证。仍需独立代码审查，但不需要单独的手工验收步骤。
