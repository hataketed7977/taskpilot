# Design

## Context

参见 [`proposal.md`](proposal.md#why)。当前 `test` 在执行真实生产结构验证之前，还会编译或加载两套人工架构样例：

- Spring Modulith 样例位于普通 `src/test/java`，依赖测试 classpath 扫描；
- ArchUnit 样例位于 `src/test/architecture-fixtures/java`，因伪造 Spring、Jakarta、jOOQ 和 provider FQCN 而必须隔离编译，再通过系统属性传递输出路径。

现有真实门禁已经分别由生产模块图验证和生产代码 ArchUnit 验证承担。聚焦基线测试已确认这四部分当前均可执行，但人工样例还迫使构建维护额外 source set、任务依赖和 classpath 防泄漏检查。最近的官方 ArchUnit 指南与应用示例以导入应用生产类并执行规则为常规用法，并未把独立正反例 source set 作为应用项目基线；ArchUnit 自身仓库中的密集规则自测属于框架实现测试，不等同于应用仓库要求。

## Goals / Non-Goals

**Goals:**

- 使 Core API 架构门禁只分析真实编译生产结构，而不是维护一套影子架构。
- 删除隔离 fixture 的编译与传递机制，并使手写测试源码只使用 Kotlin。
- 保持标准 `test` 和 `qualityCheck` 的生产模块图、技术边界及构建边界保护。
- 让空扫描、模块漏发现和 Java 测试源码回归具有直接、低成本的失败信号。

**Non-Goals:**

- 不改变任何业务、API、持久化、认证、授权或运行时契约。
- 不修改已批准 ArchUnit 规则的边界语义，也不借机引入新的分层或共享包策略。
- 不替换 Spring Modulith 或 ArchUnit，不新增测试框架、插件或依赖。
- 不处理 Core API 以外项目的源码布局，也不触碰并行 Desktop Change。

## Business Model

采用“当前代码—主规格—拥有文档”的具体场景对照，而非新增领域模型。结论是本 Change 不引入或修改 `docs/business-model.md` 中的身份、关系、基数、所有权、生命周期、状态转换、不变量、授权/租户、历史版本或异步边界；也没有新的拒绝、恢复、并发或滥用语义。测试结构的删除不会改变业务状态或持久化数据，因此无需 Event Storming、状态机、关系图或数据迁移。

## Decisions

### 1. 同时删除两类人工正反例，而不是只删除隔离 ArchUnit fixture

两类 fixture 的目的相同：在应用仓库内构造合法/违规影子代码，以证明第三方分析器或自定义匹配可以触发。保留 Spring Modulith Java fixture 会继续造成测试双语言，并重复验证 `ApplicationModules.detectViolations()`；保留 ArchUnit fixture 则继续要求伪 FQCN 与隔离编译。因此两者一起删除：

- 删除普通 `src/test/java` 下的 Modulith `valid/invalid` 样例；
- 删除 `src/test/architecture-fixtures/java` 下的 ArchUnit `allowed/forbidden` 样例；
- 删除两个仅消费样例的 Kotlin 测试。

**替代方案：** 把 Java fixture 翻译为 Kotlin。它可以消除双语言，但保留影子架构、案例维护和 ArchUnit FQCN 隔离问题，没有解决主要复杂度。

**替代方案：** 只删 ArchUnit 隔离 fixture，保留 Modulith fixture。改动更小，但用户确认的目标是清除全部人工架构正反例并统一测试语言，且真实模块图测试已拥有生产边界。

### 2. 保留真实生产结构门禁，并显式防止整体扫描空通过

生产模块图测试继续对 `ai.taskpilot.coreapi` 执行 Spring Modulith 验证，并断言当前六个能力模块的精确集合。生产 ArchUnit 测试继续导入 `ai.taskpilot.coreapi` 的非测试 class 文件，对同一个 `JavaClasses` 集合执行全部规则；测试增加对稳定架构根类型及非空生产类集合的断言，然后才执行规则。

不为每条“禁止出现某依赖”的规则强制要求命中候选违规：合规系统中禁止依赖本来就应为零，强行要求违规候选会重新引入影子代码。规则定义发生语义调整时，由该 Change 的代码审查、聚焦架构测试和受影响生产结构承担验证；若未来规则演化为复杂算法且真实结构不足以验证，可在届时基于具体风险决定最小单元测试，而不是恢复全局 fixture 政策。

**替代方案：** 保留每条规则的正反 mutation 样例。它能证明预设案例触发，但不能证明包名约定与真实生产结构一致，且正是本 Change 要移除的维护负担。

### 3. 彻底移除 fixture 构建模型，并用简单构建契约固定 Kotlin-only 测试布局

Gradle 删除 `architectureFixtures` source set、编译任务依赖、输入声明、系统属性和 fixture output 泄漏检查。`verifyBuildContract` 保留已有旧顶层 source set、生产 Java、运行时 JAR 污染等检查，并新增/收敛为直接拒绝 `src/test` 下 Java 源码及人工架构 fixture 目录。标准 JVM/Kotlin `test` source set 和 `test` 任务无需额外接线。

这是一项构建和测试治理变更，不适用业务行为 TDD；实施按“小步删除—聚焦编译/架构验证—完整质量门禁”执行，不制造临时失败 fixture 来模拟 Red/Green。

**替代方案：** 仅删除文件而保留 source set。会留下无效构建抽象，不满足简化目标。

### 4. 同步修订拥有该策略的规格和局部文档

`core-api-foundation` delta 修改三项合同：生产模块图验证、生产技术架构验证、Kotlin-only 测试布局。局部 architecture 文档从“两个 fixture 类别的加载机制”转为真实生产结构门禁；testing strategy 把“新边界更新 verification fixtures”修正为“新边界更新拥有文档与生产结构验证”。根业务模型与根架构不重复局部细节。

## Risks / Trade-offs

- **[自定义 ArchUnit 条件被错误修改时，不再有人工反例立即证明条件能触发]** → 保留真实生产代码执行、非空/架构根断言和规则列表执行；规则语义变更必须进行聚焦代码审查与架构测试，复杂度真正上升时再增加针对该规则的最小测试，而非预设全量 fixture。
- **[删除 Modulith 反例后，不再在本仓库重复证明第三方库能识别内部访问]** → 由 Spring Modulith 自身测试保证分析器能力；本仓库精确断言六模块并对真实生产图执行 `verify()`，实际越界会在生产门禁失败。
- **[删除 Gradle 接线时误伤标准测试或质量门禁]** → 先运行 Kotlin 测试编译与两项生产架构测试，再运行 `verifyBuildContract` 和完整 `qualityCheck`；检查任务图不再包含 `architectureFixtures` 相关任务。
- **[文档仍声称存在 fixture 或四模块初始图]** → 对活动规格、Core API owner 文档和构建脚本执行负向引用扫描；archive 前完成 model/documentation drift audit。
- **[并行 Desktop 工作区改动被误纳入验证或交付]** → 只编辑 Core API 与本 Change 路径，显式检查 diff；不暂存、不提交、不清理其他会话文件。

## Migration Plan

1. 记录当前聚焦架构测试通过基线，并确认仅两项 fixture 消费测试依赖待删除目录。
2. 先强化真实生产扫描的非空/架构根断言，保持生产模块图精确集合验证。
3. 删除两项 fixture 消费测试和全部 Java fixture 目录。
4. 删除隔离 source set、任务接线和无效泄漏检查；加入 Kotlin-only 测试源码构建契约。
5. 更新 Core API owner 文档，执行负向引用扫描、聚焦检查、完整 `qualityCheck` 与 OpenSpec 严格验证。
6. 若验证失败，优先恢复本 Change 删除的 fixture 文件和 Gradle 接线；本 Change 没有运行时部署或数据迁移，回滚不涉及业务数据。
