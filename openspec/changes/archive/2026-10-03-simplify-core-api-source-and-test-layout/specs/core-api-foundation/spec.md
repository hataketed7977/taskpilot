# Core API Foundation Spec Delta

## MODIFIED Requirements

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
