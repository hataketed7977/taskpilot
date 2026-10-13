# Design

## Context

仓库当前有一个 pnpm Desktop 模块、一个 Gradle Core API 模块和一组根级 Node 开发工具。完整 `pnpm check` 串行覆盖全部模块，适合作为整体质量门，但不适合每次提交；现有 Git hooks 未启用，`pnpm bootstrap` 是 checkout 初始化的统一入口。参见 `proposal.md` 的动机和 `specs/repository-commit-quality-gates/spec.md` 的行为契约。

Git hook 执行质量命令时读取的是工作树，而模块选择来自 index。为保证检查对象与待提交内容一致，只选择暂存路径还不够：受影响模块若存在未暂存或未跟踪文件，质量命令会看到混合快照。本设计选择拒绝这种污染，而不是自动 stash 或构造临时 worktree。

## Goals / Non-Goals

**Goals:**

- 用少量无第三方依赖的 Node 工具提供跨 macOS 和 Windows Git 的一致行为；Windows 的 `.cmd`/`.bat` 通过受控 `cmd.exe` adapter 执行。
- 以声明式路径映射选择最粗但可靠的“拥有独立质量门的模块”。
- 保证所有跳过、拒绝、执行和失败都能从输出中解释并手动复现。
- 让 hook 的安装、规则和映射本身可在临时 Git 仓库中确定性测试。

**Non-Goals:**

- 不把本地 hook 当成不可绕过的安全边界；`git commit --no-verify` 是 Git 原生逃生口。
- 不缓存测试结果，不根据文件内容或测试覆盖图选择单个测试。
- 不创建隔离 worktree、修改 index、自动 stash 或运行需要基础设施的 smoke/E2E。
- 不引入 commitlint、Husky、lint-staged 或新的包管理依赖。

## Business Model

采用决策树和具体示例映射。该 Change 没有产品业务模型变化，涉及的角色只有提交者，工程对象只有待提交 index、工作树和模块质量门：

- 一个暂存路径可映射零个（显式免测）、一个或多个质量门；一个质量门在一次提交中只执行一次。
- Git 实际依次运行 `pre-commit` 与 `commit-msg`：前者执行 `分析暂存区 → 检查映射完整性 → 检查受影响边界的工作树纯净度 → 顺序执行质量门`，后者校验提交信息。任一步失败都会拒绝本次提交，但不改变 index 或工作树。
- index 是模块选择的唯一事实来源；工作树只用于判断执行质量命令是否会污染验证对象。
- 质量门是开发者本地反馈机制，不是授权、发布或供应链安全边界，也不改变 `docs/business-model.md` 中任何产品术语或不变量。

## Decisions

### 1. 使用受版本控制的 shell 入口和共享 Node 实现

`.githooks/pre-commit` 与 `.githooks/commit-msg` 只负责定位仓库根并 `exec node` 到 `tools/git-hooks/`。解析、映射、执行与诊断全部由 Node ESM 实现，复用现有 Node 前置条件并避免跨平台 shell 逻辑分叉。

备选方案：Husky/Commitlint/Lint-staged 能减少部分样板，但会新增依赖、生命周期脚本和工具特有配置；纯 shell 难以可靠解析 NUL 分隔路径及在 Windows 上保持一致。因此均不采用。

### 2. 用声明式规则将路径分类为 gate、exempt 或 unknown

映射按具体优先级匹配，并返回 gate 集合与用于诊断/纯净度检查的边界：

| 路径类别 | 选择 |
| --- | --- |
| `apps/desktop/**` 中代码、测试、资源和构建配置 | Desktop：`pnpm --filter @taskpilot/desktop qualityCheck` |
| `services/core-api/**` 中源码、测试、资源和构建配置 | Core API：平台对应 wrapper 的 `:services:core-api:qualityCheck` |
| `tools/dev/**`、`compose.yaml`、`.env.local.example` | Dev tooling：`pnpm dev:test` |
| `.githooks/**`、`tools/git-hooks/**` | Hook tooling：`pnpm hooks:test` |
| 根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml` | Desktop + Dev tooling + Hook tooling |
| 根 `build.gradle.kts`、`settings.gradle.kts`、`gradlew*`、`gradle/**` | Core API |
| `**/*.md`、`openspec/**`、`.agents/**`、`AGENTS.md` 及显式仓库元数据 | exempt |
| 其他路径 | unknown，提交前拒绝并要求补映射 |

子项目文档和 AGENTS 文件由通用 exempt 规则处理，必须在模块通配规则之前匹配，避免文档改动触发业务测试。删除路径仍按 index 中记录的名称分类。rename 同时分类源路径和目标路径，因为它会删除源并新增目标；copy 只以目标路径选择 gate，因为源文件没有被 copy 动作修改。若源文件另有暂存修改，它由自己的 `M` 等记录独立触发源 gate。

备选方案：默认免测会让未来模块静默绕过；默认全量测试违背用户的增量目标。显式 exempt + unknown fail-closed 在可维护性和反馈速度之间更安全。

### 3. 使用 NUL 分隔的 Git plumbing 输出

预提交分析读取 `git diff --cached --name-status -z --find-renames --find-copies --diff-filter=ACMRDTUXB`，按状态消费对应数量的路径；`R` 记录的源和目标都参与分类，`C` 记录保留源路径用于诊断但只分类目标。Git 将未识别为 `C` 的普通复制报告为目标路径的 `A`，两种表示必须得到相同的 gate 集合，不得依赖 copy similarity heuristic 扩大源模块测试。工作树污染检查分别读取 tracked unstaged diff 与 `git ls-files --others --exclude-standard -z`。内部始终保存原始路径字符串，展示时使用安全转义，避免空格、换行或控制字符破坏诊断。

不解析面向人的换行文本，也不依赖 shell word splitting。

### 4. 在受影响边界内要求工作树与 index 一致

每个 gate 声明自己的 owned 路径和触发它的共享路径。执行前，如果这些边界中出现未暂存或未跟踪文件，则整体拒绝并列出路径。无关 gate 的工作树状态不参与本次提交。

这比临时 stash 更保守：stash 会改变用户状态且在冲突、进程中断和并发 session 下有恢复风险；临时 worktree 需要安装依赖并显著增加复杂度。本地门禁优先给出明确操作建议，让开发者自己决定暂存、还原或移走文件。

### 5. 顺序、去重并 fail-fast 执行质量门

Gate 使用固定顺序 `hook-tooling → dev-tooling → desktop → core-api`，保证自身与轻量工具测试先反馈，昂贵模块门靠后。每个 gate 执行前打印名称、完整逻辑命令和触发路径，子进程继承 stdout/stderr。无法 spawn 与非零退出分别诊断；失败后停止，汇总已通过、失败和未运行门，绝不将未运行标为通过。

Desktop 和 Core API 复用子项目已有完整本地质量门，不在新工具里复制其内部测试矩阵。开发工具复用 `pnpm dev:test`；hook 自身新增 `pnpm hooks:test`。POSIX 直接以 argv 数组执行；Windows 因 Node 不能直接启动 `.cmd`/`.bat`，仅这两类固定命令通过显式 `cmd.exe /d /s /c` adapter 执行，并转义命令路径和每个参数、启用 `windowsVerbatimArguments`。不得把暂存路径、提交信息或其他用户输入拼入命令。

### 6. 提交主题使用小型确定性解析器

`commit-msg` 读取 Git 提供的消息文件，只校验首行主题。解析器使用锚定格式验证 type、可选 scope、可选 `!`、冒号空格和 description，并为各字段返回结构化 rule id 与原因。正文/footer 不解析。merge、revert、fixup、squash 不设隐式 bypass；如需提交，主题也必须改成仓库格式。

type 只允许 spec 穷举的 `feat`、`fix`、`refactor`、`docs`、`test`、`build`、`ci`、`perf`、`chore`、`revert`；新增 type 必须先同步更新 spec、解析器测试和开发文档。scope 保持自由但限制字符集，避免维护易过期的 scope 白名单。`revert` 是合法 type，但不是绕过校验的标记：Git 默认生成的 `Revert "..."` 主题不符合格式，开发者必须编辑为例如 `revert(core-api): restore previous session behavior`。

### 7. 通过 worktree-specific Git config 安装且保护已有配置

`pnpm hooks:install` 先读取当前 worktree 的有效 `core.hooksPath` 及来源：任何有效的其他路径都直接失败，并显示当前值、来源和期望值；没有有效值或有效值已规范化为 `.githooks` 时，确保仓库启用 `extensions.worktreeConfig`，再以 `git config --worktree core.hooksPath .githooks` 固定当前 worktree。当前 worktree 已有期望值时幂等成功；期望值只来自 local、global 或 system 等共享层时，也写入相同 worktree 值。`pnpm bootstrap` 在工具前置条件通过后调用同一安装实现，不直接复制逻辑。

启用 `extensions.worktreeConfig` 是 Git 提供 per-worktree config 的仓库级前置条件；安装器只在当前有效 hook 路径无冲突时启用它，并不得改写或清除其他 worktree 的 `config.worktree`。相对 `.githooks` 由各 worktree 自己解析，因此 checkout 可移动，且一个 linked worktree 安装 hook 不会让尚未包含 hook 文件的另一个 worktree 改变有效 `core.hooksPath`。实现测试必须在临时普通仓库和含两个 linked worktree 的仓库中验证首次安装、重复安装、相同期望值继承、任一来源冲突及 worktree 隔离。

### 8. 测试边界

该变更是工程工具，不制造业务 TDD。最低可靠层如下：

- 纯函数测试：commit subject、路径分类、rename 源/目标与 copy 目标 record、gate 去重和诊断转义。
- 临时 Git 仓库集成测试：真实 index、部分暂存、未跟踪文件、特殊文件名、hook 安装冲突、双 worktree 隔离和 hook 退出状态。
- 命令执行测试：注入可控子进程 runner，验证 argv、顺序、fail-fast 和 spawn/exit 诊断，不在单元测试中真的运行 Desktop/Core API 全套门。
- 实施验收：运行 `pnpm hooks:test`、`pnpm dev:test`，并因根 package/lock 受影响运行 Desktop `qualityCheck`；只有实际修改 Gradle/Core API 路径时才运行 Core API `qualityCheck`，随后在临时仓库进行真实 hook smoke。

详细覆盖见 `test-plan.md`；根 `docs/architecture.md` 和各子项目 testing strategy 继续拥有质量命令边界。

## Risks / Trade-offs

- [提交门可能较慢，尤其 Desktop 覆盖率与 Core API 全套门] → 只运行受影响模块、去重且轻量门优先；不削弱已有模块质量门。
- [模块映射随仓库增长而过期] → unknown 路径 fail-closed，并用映射 fixture 覆盖当前顶层可执行路径。
- [部分暂存降低常见工作流便利性] → 仅检查受影响边界并给出精确污染路径；不承担自动 stash 的状态破坏风险。
- [本地 hook 可被 `--no-verify` 绕过] → 文档明确其是反馈门而非安全边界；本 Change 不虚构 CI 强制性。
- [Git rename/copy 与特殊路径解析易错] → 使用 `-z` plumbing 输出和真实临时仓库测试；rename 分类源与目标，copy 只分类目标，并证明 `C` 与普通 `A` 表示选择相同 gate。
- [bootstrap 遇到现有 hook 管理器会失败] → 不覆盖用户配置，明确显示冲突与手动处理路径；该行为由集成测试固定。
- [Git 的 per-worktree config 需要仓库级扩展开关] → 仅在当前有效 hook 路径无冲突时启用 `extensions.worktreeConfig`，hook 值只写当前 worktree，并用双 worktree 测试证明另一个 checkout 的有效路径不变。
- [质量命令可能读取模块外共享文件] → 映射显式把已知共享配置加入 gate 边界；发现新的共享依赖时必须同步扩展映射与测试。

## Migration Plan

1. 合入 hook 入口、工具实现、自动化测试、package scripts 和文档。
2. 每个现有 checkout 分别运行 `pnpm bootstrap` 或 `pnpm hooks:install` 后启用；新 checkout 在自己的标准 bootstrap 中自动启用，不从同仓库其他 worktree 隐式继承该 hook 路径。
3. 安装不修改历史提交、暂存区或工作区。遇到当前 worktree 从任一配置层得到不同的有效 `core.hooksPath` 时停止并报告来源，由开发者决定保留、迁移或组合现有 hook。
4. 回滚时在对应 checkout 执行 `git config --worktree --unset core.hooksPath`（或恢复其原 worktree 值），再回退仓库文件；不得删除其他 worktree 的配置。仓库级 `extensions.worktreeConfig` 可安全保留，因为它本身不指定 hook；安装器不自动关闭可能由其他配置使用的扩展。
