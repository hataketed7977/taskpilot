# Repository Commit Quality Gates Specification

## Purpose

为 TaskPilot 仓库提供可复现、可解释的本地提交门禁，使提交信息遵循统一历史格式，并且只验证暂存改动实际影响且已有质量命令的模块。

## Requirements

### Requirement: 提交信息必须遵循仓库格式

仓库管理的 `commit-msg` 门禁 SHALL 校验提交主题符合 `<type>[可选 scope][可选 !]: <description>`。允许的 type MUST 为 `feat`、`fix`、`refactor`、`docs`、`test`、`build`、`ci`、`perf`、`chore`、`revert`；scope 如存在 MUST 只包含小写字母、数字和连字符；description MUST 非空、以小写字母或数字开头且不以句号结束。正文和 footer 不受该格式限制，但 merge、revert、fixup 或 squash 提交不得获得隐式豁免。

#### Scenario: 接受带 scope 的历史风格主题

- **WHEN** 开发者以 `feat(auth): add GitHub sign-in` 作为提交主题
- **THEN** `commit-msg` 门禁 MUST 通过

#### Scenario: 接受 breaking-change 标记

- **WHEN** 开发者以 `feat(core-api)!: replace session contract` 作为提交主题
- **THEN** `commit-msg` 门禁 MUST 通过

#### Scenario: 接受仓库格式的 Revert 主题

- **WHEN** 开发者以 `revert(core-api): restore previous session behavior` 作为提交主题
- **THEN** `commit-msg` 门禁 MUST 通过

#### Scenario: 拒绝 Git 默认 Revert 主题

- **WHEN** Git 自动生成的主题仍为 `Revert "feat(core-api): replace session contract"`
- **THEN** 门禁 MUST 拒绝提交
- **AND** 输出 MUST 提示开发者将主题改为仓库格式并给出 `revert(scope): description` 示例

#### Scenario: 拒绝未知 type

- **WHEN** 开发者以 `feature(auth): add GitHub sign-in` 作为提交主题
- **THEN** 门禁 MUST 拒绝提交
- **AND** 输出 MUST 指明 `feature` 不是允许的 type 并列出允许值

#### Scenario: 拒绝格式错误的 scope 或描述

- **WHEN** scope 含大写字母、下划线或空格，或者 description 为空、以大写字母开头或以句号结束
- **THEN** 门禁 MUST 拒绝提交
- **AND** 输出 MUST 指明具体违反的规则、收到的主题和至少一个正确示例

### Requirement: 模块质量门必须由暂存区决定

仓库管理的 `pre-commit` 门禁 SHALL 使用 Git index 中本次提交的新增、修改、删除、重命名、复制和类型变化路径选择质量门，而不得使用最近一次提交或未暂存 diff 决定模块。路径解析 MUST 正确处理空格、换行和跨模块 rename/copy；rename MUST 影响源与目标模块，copy MUST 只影响目标模块，除非源文件另有独立的暂存修改；同一质量门 MUST 每次提交至多运行一次。Git 将 copy 表示为 `C` 或普通目标新增 `A` 时 MUST 选择相同质量门，不得因 copy detection heuristic 运行未改动的源模块。

#### Scenario: 只改 Desktop

- **WHEN** 暂存区只包含 Desktop 的可执行代码、测试或构建配置
- **THEN** 门禁 MUST 只运行 `pnpm --filter @taskpilot/desktop qualityCheck`
- **AND** MUST NOT 运行 Core API 或开发工具质量门

#### Scenario: 只改 Core API

- **WHEN** 暂存区只包含 Core API 的可执行代码、测试、资源或构建配置
- **THEN** 门禁 MUST 只运行 `:services:core-api:qualityCheck`
- **AND** MUST NOT 运行 Desktop 或开发工具质量门

#### Scenario: 同时改多个模块

- **WHEN** 暂存区同时影响 Desktop、Core API 和开发工具
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

门禁 SHALL 维护显式的路径分类与质量命令映射。纯文档、OpenSpec artifacts、Agent 指令和仓库元数据路径 MUST 明确分类为免测；根 pnpm/工作区/锁文件 MUST 影响 Desktop、开发工具与门禁工具门；根 Gradle settings/build、wrapper 和 version catalog MUST 影响 Core API；开发启动、环境与 Compose 配置 MUST 影响开发工具门；门禁自身 MUST 影响门禁测试。任何不属于已知模块、共享配置或显式免测路径的暂存路径 MUST 拒绝提交，而不是静默跳过。

#### Scenario: 纯文档提交免运行业务测试

- **WHEN** 暂存区仅包含 Markdown 文档、OpenSpec artifacts、Agent 指令或已显式声明的仓库元数据
- **THEN** `pre-commit` MUST 成功且不运行 Desktop、Core API 或开发工具质量门
- **AND** 输出 MUST 清楚说明本次只有免测路径

#### Scenario: 共享 pnpm 配置影响 JavaScript 模块

- **WHEN** 暂存区包含根 `package.json`、`pnpm-workspace.yaml` 或 `pnpm-lock.yaml`
- **THEN** Desktop、开发工具与门禁工具质量门 MUST 被选择

#### Scenario: 共享 Gradle 配置影响 Core API

- **WHEN** 暂存区包含根 Gradle build/settings、Gradle wrapper 或 version catalog
- **THEN** Core API 质量门 MUST 被选择

#### Scenario: 未映射可执行路径被拒绝

- **WHEN** 暂存区出现未被显式分类的新可执行模块或工具路径
- **THEN** 门禁 MUST 在执行质量命令前拒绝提交
- **AND** 输出 MUST 列出未映射路径并提示维护模块映射和测试命令

### Requirement: 质量门必须验证未被其他工作区改动污染的快照

在执行受影响模块的质量命令前，门禁 SHALL 检查这些模块及其触发的共享配置是否存在未暂存或未跟踪改动。若存在，门禁 MUST fail-closed，而不得自动 stash、修改 index、清理文件或宣称待提交快照已通过。与受影响模块无关且已映射的其他模块工作区改动 MUST NOT 触发额外质量门或阻止提交。

#### Scenario: 受影响模块存在部分暂存

- **WHEN** Desktop 被本次暂存改动影响且 Desktop 路径另有未暂存修改
- **THEN** 门禁 MUST 在运行测试前拒绝提交
- **AND** 输出 MUST 列出污染路径并说明需要先暂存、还原或移走这些改动

#### Scenario: 受影响模块存在未跟踪文件

- **WHEN** Core API 被本次暂存改动影响且 Core API 下存在未跟踪文件
- **THEN** 门禁 MUST 拒绝提交并列出未跟踪路径

#### Scenario: 无关模块存在未暂存修改

- **WHEN** 本次只暂存 Desktop 改动而 Core API 有未暂存修改
- **THEN** 门禁 MUST 只验证 Desktop
- **AND** Core API 的未暂存修改 MUST NOT 阻止本次提交

### Requirement: 拒绝诊断必须明确且可复现

每项门禁 SHALL 以非零状态拒绝失败提交，并 MUST 输出门禁名称、失败规则或质量门、具体原因、相关路径、实际命令（如适用）和开发者可手动复现或修复的下一步。质量命令的 stdout/stderr MUST 对开发者可见；一个质量门失败后门禁 MUST 停止，不得把后续门宣称为已通过。

#### Scenario: 模块质量命令失败

- **WHEN** Desktop 质量命令返回非零状态
- **THEN** 提交 MUST 被拒绝
- **AND** 输出 MUST 标识 `pre-commit / desktop quality gate`、退出码、命令和触发路径
- **AND** 后续未执行门 MUST 标为未运行而非失败或通过

#### Scenario: 命令无法启动

- **WHEN** `pnpm`、Node 或 Gradle wrapper 不存在或无法启动
- **THEN** 提交 MUST 被拒绝
- **AND** 输出 MUST 区分“无法启动命令”和“命令执行后测试失败”

#### Scenario: 提交信息失败

- **WHEN** `commit-msg` 校验失败
- **THEN** 输出 MUST 标识 `commit-msg`、违反的规则、收到的主题和正确示例

### Requirement: Hook 安装必须属于 checkout 且不得覆盖冲突配置

仓库 SHALL 提供显式安装命令，并由 `pnpm bootstrap` 调用，通过 Git worktree-specific config 为当前 checkout 设置相对仓库的 hook 路径。安装 MUST 检查当前 worktree 的有效 `core.hooksPath` 及其配置来源：当 worktree 值已是仓库期望值时成功且不产生额外变化；当相同期望值只来自 local、global 或 system 等共享配置层时 MUST 写入当前 worktree 值以固定本 checkout；当任何有效值为其他路径时 MUST 拒绝并解释冲突，不得静默覆盖用户配置。安装器 MAY 在无 hook 冲突时启用仓库级 `extensions.worktreeConfig` 作为 Git per-worktree config 的必要前置条件，但 MUST NOT 改变其他 worktree 的有效 `core.hooksPath` 或其 worktree 配置。Hook 入口 MUST 在仓库支持的 macOS、Windows Git 环境中调用同一 Node 实现。

#### Scenario: 首次 bootstrap 安装 hook

- **WHEN** checkout 尚未设置 `core.hooksPath` 且 `pnpm bootstrap` 成功执行安装步骤
- **THEN** 当前 checkout MUST 配置为使用仓库管理的 hooks

#### Scenario: 重复安装

- **WHEN** 当前 checkout 的 worktree 配置已使用期望的仓库 hook 路径
- **THEN** 再次运行安装或 bootstrap MUST 成功

#### Scenario: 已有自定义 hook 路径

- **WHEN** 当前 checkout 的有效配置（包括 worktree、local、global 或 system 来源）为不同的 `core.hooksPath`
- **THEN** 安装和 bootstrap MUST 拒绝
- **AND** 输出 MUST 展示当前值、配置来源、期望值以及由开发者决定如何处理的下一步

#### Scenario: linked worktree 安装隔离

- **WHEN** 同一 Git 仓库存在两个 worktree，且开发者只在其中一个执行安装
- **THEN** 安装 MUST 只为当前 worktree 设置期望的 `core.hooksPath`
- **AND** 另一个 worktree 的有效 `core.hooksPath` 和 worktree 配置 MUST 保持不变

#### Scenario: 手动复现门禁

- **WHEN** 开发者需要排查 hook 失败
- **THEN** 仓库 MUST 提供稳定的 package scripts 分别运行提交信息检查、暂存模块检查和门禁自动化测试
