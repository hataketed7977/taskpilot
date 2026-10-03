# Core API Foundation Specification

## Purpose

为 TaskPilot Core API 提供可复现、可启动、可自动验证的工程基础，使后续业务能力在明确的模块边界、技术依赖规则和分层测试门禁下安全演进。

## Requirements

### Requirement: Core API 工程可复现构建与启动
仓库 SHALL 提供受版本控制的构建入口和 Core API 子工程，使受支持的本地与 CI 环境能够使用同一 Wrapper 完成编译、测试和应用启动。Core API 的手写生产源码 SHALL 使用 Kotlin，模块元数据 MUST NOT 要求保留 Java 生产源码。Core API SHALL 暴露最小健康状态，且启动不得依赖尚未实现的业务数据、Redis、消息中间件、Desktop 或 Agent Runtime 进程。

#### Scenario: 干净环境执行快速构建
- **WHEN** 开发者在具有受支持 JDK、但没有预装 Gradle 的干净 checkout 中执行版本控制的快速构建命令
- **THEN** Wrapper SHALL 解析固定且兼容的工具链和依赖，编译 Core API 并完成所选择的测试

#### Scenario: 生产源码保持 Kotlin 单一语言
- **WHEN** 构建检查 Core API 的手写生产源码和模块元数据
- **THEN** 所有生产类型 SHALL 从 Kotlin 源码编译，且 `src/main` SHALL NOT 包含为声明模块元数据而保留的 Java 源码

#### Scenario: 基础应用启动
- **WHEN** Core API 使用基础配置启动且没有尚未实现的外部业务服务
- **THEN** 应用 SHALL 完成 Spring 上下文启动并通过受限的健康检查报告存活状态

### Requirement: 粗粒度能力模块受到可执行验证
Core API SHALL 以 `access`、`project`、`automation`、`agent` 四个粗粒度能力作为初始模块，并通过自动化模块验证拒绝循环依赖、未声明依赖和对其他模块内部实现的访问。初始化不得将每个业务名词机械拆成模块，也不得通过通用共享包绕过模块边界。

#### Scenario: 合法的初始模块图
- **WHEN** 架构测试分析初始 Core API 应用
- **THEN** 它 SHALL 发现四个预期能力模块，并确认模块图无循环且符合声明的公开面和允许依赖

#### Scenario: 模块越界依赖
- **WHEN** 架构规则 fixture 引入对另一能力内部实现的依赖
- **THEN** 模块验证 SHALL 以可定位到违规依赖的失败结果拒绝该结构

#### Scenario: 模块独立启动保护
- **WHEN** 一个能力获得首个 Spring 用例或集成组件
- **THEN** 该能力 SHALL 具有仅在声明依赖范围内启动的模块测试，缺失 wiring 或隐式依赖 SHALL 导致测试失败

### Requirement: 技术架构规则受到独立保护
Core API SHALL 使用独立于模块图验证的架构规则，防止业务模型依赖 Web、Spring Security、持久化或 provider SDK 类型，防止持久化与 provider 类型跨能力或 HTTP 边界泄漏，并保持 Desktop、public、managed-execution API surface 相互隔离。每类规则 SHALL 具有允许与禁止示例，证明规则会匹配并拒绝目标违规，而不是空通过。

#### Scenario: 合法依赖示例
- **WHEN** 架构规则分析只依赖允许契约的示例和生产类
- **THEN** 所有技术架构规则 SHALL 通过

#### Scenario: 禁止依赖示例
- **WHEN** 架构规则分析模型依赖 Web/持久化框架、API surface 互相引用或跨模块访问 infrastructure 的禁止示例
- **THEN** 对应规则 SHALL 失败并指出违规来源和目标

### Requirement: 测试按反馈速度和真实边界分层
Core API 的测试、测试资源和测试 fixture SHALL 在文件系统中统一归入标准 `src/test` 树，并由标准 `test` 任务提供完整测试套件入口。测试 SHALL 按反馈速度和真实边界保持逻辑分层，并允许调用方通过测试选择器执行不需要容器的聚焦测试，而不是依赖独立的顶层测试源码目录或分层测试任务。模块测试 SHALL 验证限定 Spring 模块上下文；基础设施集成测试 SHALL 使用真实 PostgreSQL 兼容边界。H2 或同类内存数据库 MUST NOT 被用作 PostgreSQL 行为的替代证据。

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
- **WHEN** 构建契约检查 Core API 的测试源码、测试资源和架构规则 fixture
- **THEN** 它们 SHALL 位于 `src/test` 树下，且 SHALL NOT 依赖顶层 `src/moduleTest`、`src/integrationTest` 或 `src/architectureFixtures` 目录

### Requirement: 工程质量门禁具有单一可执行入口
Core API SHALL 提供可由本地和 CI 调用的质量任务，组合编译、格式、静态分析、标准完整测试套件、覆盖率验证和构建产物边界检查。完整测试套件 SHALL 包含适用的架构、模块上下文及基础设施集成测试。生成代码和明确批准的配置样板可按版本控制规则排除，但手写生产逻辑 MUST NOT 为通过门禁而被隐藏、跳过或移入测试代码。

#### Scenario: 完整质量检查通过
- **WHEN** 所有源码、架构规则和测试满足已批准约束且所需基础设施可用
- **THEN** 单一质量任务 SHALL 成功并生成可供 CI 保存的测试与覆盖率报告

#### Scenario: 任一保护失败
- **WHEN** 编译、格式、静态分析、架构、模块上下文、覆盖率、构建产物边界或适用集成测试中的任一门禁失败
- **THEN** 完整质量任务 SHALL 返回失败且保留具体失败报告
