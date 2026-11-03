# Spec Delta

## MODIFIED Requirements

### Requirement: 模块质量门必须由暂存区决定
仓库管理的 `pre-commit` 门禁 SHALL 使用 Git index 中本次提交的新增、修改、删除、重命名、复制和类型变化路径选择质量门，而不得使用最近一次提交或未暂存 diff 决定模块。路径解析 MUST 正确处理空格、换行和跨模块 rename/copy；rename MUST 影响源与目标模块，copy MUST 只影响目标模块，除非源文件另有独立的暂存修改；同一质量门 MUST 每次提交至多运行一次。Git 将 copy 表示为 `C` 或普通目标新增 `A` 时 MUST 选择相同质量门，不得因 copy detection heuristic 运行未改动的源模块。

#### Scenario: 只改 Desktop
- **WHEN** 暂存区只包含 Desktop 的可执行代码、测试或构建配置
- **THEN** 门禁 MUST 只运行 `pnpm --filter @taskpilot/desktop qualityCheck`
- **AND** MUST NOT 运行 Core API、Gateway 或开发工具质量门

#### Scenario: 只改 Core API
- **WHEN** 暂存区只包含 Core API 的可执行代码、测试、资源或构建配置
- **THEN** 门禁 MUST 只运行 `:services:core-api:qualityCheck`
- **AND** MUST NOT 运行 Desktop、Gateway、canonical contract 或开发工具质量门

#### Scenario: 修改 canonical contract
- **WHEN** 暂存区影响 `contracts/canonical-api/**`
- **THEN** 门禁 MUST 各运行一次 canonical contract、Core API 与 Gateway quality gate
- **AND** MUST 在执行前说明该 contract 同时拥有 Core HTTP adapter 与 Gateway route manifest

#### Scenario: 只改 Gateway
- **WHEN** 暂存区只包含 Gateway 的可执行代码、测试、资源或构建配置
- **THEN** 门禁 MUST 只运行 `:services:gateway:qualityCheck`
- **AND** MUST NOT 运行 Desktop、Core API 或开发工具质量门

#### Scenario: 同时改多个模块
- **WHEN** 暂存区同时影响 Desktop、Core API、Gateway 和开发工具
- **THEN** 门禁 MUST 各运行一次对应质量门
- **AND** 输出 MUST 在执行前列出每个质量门及其触发路径

#### Scenario: 跨模块重命名
- **WHEN** 一个暂存 rename 的源路径与目标路径属于不同模块
- **THEN** 源模块与目标模块的质量门 MUST 都被选择

#### Scenario: 跨模块复制
- **WHEN** 一个暂存 copy 的源路径与目标路径属于不同模块，且源文件本身没有其他暂存修改
- **THEN** 只有目标模块的质量门 MUST 被选择
- **AND** 无论 Git 把该操作报告为 `C` 还是目标路径的 `A`，结果 MUST 相同

#### Scenario: 文件名包含特殊字符
- **WHEN** 暂存文件名包含空格或换行
- **THEN** 门禁 MUST 完整保留路径边界并选择正确模块
- **AND** 诊断 MUST NOT 把一个文件拆成多个路径

### Requirement: 模块映射必须显式且 fail-closed
门禁 SHALL 维护显式的路径分类与质量命令映射。纯文档、OpenSpec artifacts、Agent 指令和仓库元数据路径 MUST 明确分类为免测；根 pnpm/工作区/锁文件 MUST 影响 Desktop、开发工具与门禁工具门；根 Gradle settings/build、wrapper 和 version catalog MUST 同时影响 canonical contract、Core API 与 Gateway；开发启动、环境与 Compose 配置 MUST 影响开发工具门；门禁自身 MUST 影响门禁测试。任何不属于已知模块、共享配置或显式免测路径的暂存路径 MUST 拒绝提交，而不是静默跳过。

#### Scenario: 纯文档提交免运行业务测试
- **WHEN** 暂存区仅包含 Markdown 文档、OpenSpec artifacts、Agent 指令或已显式声明的仓库元数据
- **THEN** `pre-commit` MUST 成功且不运行 Desktop、canonical contract、Core API、Gateway 或开发工具质量门
- **AND** 输出 MUST 清楚说明本次只有免测路径

#### Scenario: 共享 pnpm 配置影响 JavaScript 模块
- **WHEN** 暂存区包含根 `package.json`、`pnpm-workspace.yaml` 或 `pnpm-lock.yaml`
- **THEN** Desktop、开发工具与门禁工具质量门 MUST 被选择

#### Scenario: 共享 Gradle 配置影响 canonical contract
- **WHEN** 暂存区包含根 Gradle build/settings、Gradle wrapper 或 version catalog
- **THEN** canonical contract 质量门 MUST 被选择

#### Scenario: 共享 Gradle 配置影响 Core API
- **WHEN** 暂存区包含根 Gradle build/settings、Gradle wrapper 或 version catalog
- **THEN** Core API 质量门 MUST 被选择

#### Scenario: 共享 Gradle 配置同时影响 Gateway
- **WHEN** 暂存区包含根 Gradle build/settings、Gradle wrapper 或 version catalog
- **THEN** Gateway 质量门 MUST 被选择

#### Scenario: 未映射可执行路径被拒绝
- **WHEN** 暂存区出现未被显式分类的新可执行模块或工具路径
- **THEN** 门禁 MUST 在执行质量命令前拒绝提交
- **AND** 输出 MUST 列出未映射路径并提示维护模块映射和测试命令
