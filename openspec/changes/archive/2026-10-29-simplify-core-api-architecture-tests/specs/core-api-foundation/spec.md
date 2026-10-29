## MODIFIED Requirements

### Requirement: 粗粒度能力模块受到可执行验证
Core API SHALL 以 `access`、`workspace`、`project`、`onboarding`、`automation`、`agent` 六个粗粒度能力作为当前模块，并通过对编译后生产代码执行的自动化模块验证拒绝循环依赖、未声明依赖和对其他模块内部实现的访问。模块验证 SHALL 明确断言预期模块集合，MUST NOT 以人工合法/违规模块 fixture 或空扫描作为通过证据。Core API 不得将每个业务名词机械拆成模块，也不得通过通用共享包绕过模块边界。

#### Scenario: 合法的初始模块图
- **WHEN** 架构测试分析编译后的 Core API 生产代码
- **THEN** 它 SHALL 发现且仅发现 `access`、`workspace`、`project`、`onboarding`、`automation`、`agent` 六个能力模块，并确认模块图无循环且符合声明的公开面和允许依赖

#### Scenario: 模块越界依赖
- **WHEN** Core API 生产代码引入循环、未声明的能力依赖或对另一能力内部实现的访问
- **THEN** 模块验证 SHALL 失败并提供可定位到相关模块或违规依赖的结果

#### Scenario: 模块独立启动保护
- **WHEN** 一个能力获得首个 Spring 用例或集成组件
- **THEN** 该能力 SHALL 具有仅在声明依赖范围内启动的模块测试，缺失 wiring 或隐式依赖 SHALL 导致测试失败

### Requirement: 技术架构规则受到独立保护
Core API SHALL 使用独立于模块图验证的架构规则分析编译后的生产代码，防止业务模型依赖 Web、Spring Security、持久化或 provider SDK 类型，防止持久化与 provider 类型跨能力或 HTTP 边界泄漏，并保持 Desktop、public、managed-execution API surface 相互隔离。架构测试 SHALL 证明生产代码扫描范围非空并执行全部已批准规则，MUST NOT 依赖人工允许/禁止 fixture、伪造的框架类型或独立 fixture source set 作为通过证据。

#### Scenario: 合法依赖示例
- **WHEN** 架构测试导入 Core API 编译后的生产代码
- **THEN** 它 SHALL 发现 Core API 架构根及生产类型，并 SHALL 对同一生产类集合执行全部已批准技术架构规则

#### Scenario: 禁止依赖示例
- **WHEN** Core API 生产代码引入被已批准技术架构规则禁止的依赖或包结构
- **THEN** 对应架构规则 SHALL 失败并指出违规规则以及可定位的来源和目标

### Requirement: 测试按反馈速度和真实边界分层
Core API 的手写测试源码 SHALL 使用 Kotlin 并统一位于标准 `src/test/kotlin`，测试资源 SHALL 位于标准 `src/test/resources`，标准 `test` 任务 SHALL 提供完整测试套件入口。测试 SHALL 按反馈速度和真实边界保持逻辑分层，并允许调用方通过测试选择器执行不需要容器的聚焦测试，而不是依赖独立的顶层测试源码目录、分层测试任务或人工架构 fixture source set。模块测试 SHALL 验证限定 Spring 模块上下文；基础设施集成测试 SHALL 使用真实 PostgreSQL 兼容边界。H2 或同类内存数据库 MUST NOT 被用作 PostgreSQL 行为的替代证据。

#### Scenario: 快速测试不启动容器
- **WHEN** 开发者通过标准测试任务的测试选择器只选择单元测试或架构测试
- **THEN** 所选测试 SHALL 完成且 SHALL NOT 启动 PostgreSQL 容器或完整基础设施环境

#### Scenario: 标准任务运行完整测试套件
- **WHEN** 开发者执行 Core API 标准 `test` 任务且容器运行时可用
- **THEN** 单元、架构、模块上下文、启动和 PostgreSQL 集成测试 SHALL 被发现并执行

#### Scenario: 模块测试限定上下文
- **WHEN** 开发者通过标准测试任务选择模块上下文测试或执行完整测试套件
- **THEN** 对应测试 SHALL 仅启动被测模块及其声明依赖，而不是以完整应用启动替代模块边界验证

#### Scenario: PostgreSQL 集成基础可用
- **WHEN** 开发者通过标准测试任务选择基础设施集成测试或执行完整测试套件且容器运行时可用
- **THEN** 测试 SHALL 启动受支持的 PostgreSQL 容器、建立真实连接并验证集成测试生命周期可重复执行

#### Scenario: 容器运行时不可用
- **WHEN** 标准测试任务被要求执行 PostgreSQL 集成测试但环境没有可用容器运行时
- **THEN** 任务 SHALL 明确失败，MUST NOT 静默跳过或改用内存数据库并报告通过

#### Scenario: 测试源码布局保持统一
- **WHEN** 构建契约检查 Core API 的手写测试源码和测试资产布局
- **THEN** `src/test` SHALL NOT 包含 Java 源码或人工架构 fixture 目录，且 SHALL NOT 依赖顶层 `src/moduleTest`、`src/integrationTest` 或 `src/architectureFixtures` 目录
