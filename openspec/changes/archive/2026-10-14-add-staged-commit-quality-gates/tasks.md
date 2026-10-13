# Tasks

## 1. 提交信息门禁

- [x] 1.1 在 `tools/git-hooks/` 实现无副作用的 commit subject 解析与结构化错误，type 严格采用 spec 穷举列表，并覆盖可选 scope/`!`、description 和多行 message 边界；以 `pnpm hooks:test` 的表驱动用例证明合法历史主题及 `revert(scope): ...` 通过，Git 默认 `Revert "..."` 与其他非法主题返回具体 rule、原主题和仓库格式示例。
- [x] 1.2 增加 message-file CLI 与 `.githooks/commit-msg` 薄入口，保留 Git 参数和退出码且不修改消息文件；以临时 Git 仓库的真实合法/非法 `git commit` 用例及 `pnpm hooks:commit-msg -- <message-file>` 证明阻断和手动复现行为。

## 2. 暂存区解析与模块映射

- [x] 2.1 实现 NUL 安全的 staged name-status adapter，正确消费新增、复制、修改、重命名、删除、类型和未合并状态的路径数量；rename 以源和目标分类，copy 保留源用于诊断但只以目标分类，且源文件的独立修改仍单独生效。以 parser fixture 和临时 Git 仓库验证跨模块 rename、`C`/目标 `A` copy 等价、空格、换行文件名及只读 index 行为。
- [x] 2.2 实现声明式 gate/exempt/unknown 映射以及固定 gate 顺序和去重，覆盖 Desktop、Core API、dev tooling、hook tooling、pnpm/Gradle 共享配置和显式免测文档路径；以 `pnpm hooks:test` 路径矩阵及当前仓库结构检查证明未改模块不选、共享配置选全、纯文档免测、未知可执行路径 fail-closed。
- [x] 2.3 实现受影响 gate 边界的 tracked unstaged 与 untracked 污染检查，禁止自动 stash/清理且忽略无关模块污染；以临时仓库的部分暂存、受影响未跟踪和无关模块 dirty 三类用例证明 fail-closed 边界。

## 3. 质量门执行与诊断

- [x] 3.1 实现固定逻辑命令的跨平台 gate registry 和可注入 runner，命令为 hook tests、`pnpm dev:test`、Desktop `qualityCheck` 与 Core API Gradle `qualityCheck`；POSIX 直接使用 argv，Windows 的 `.cmd`/`.bat` 使用受控且逐项转义的 `cmd.exe` adapter；以 fake runner 测试证明平台分支、顺序、去重、`stdio` 透传和不拼入用户输入。
- [x] 3.2 实现 `pre-commit` CLI 与 `.githooks/pre-commit` 薄入口，在运行前打印 gate/命令/触发路径，区分 spawn 失败、非零退出和 signal，失败后标明已通过/失败/未运行；以 `pnpm hooks:test` 覆盖免测、unknown、成功、fail-fast 和诊断完整性。
- [x] 3.3 在隔离临时仓库中执行真实 pre-commit smoke，证明仅受影响 fake gate 被调用、失败拒绝提交、无关 gate 未运行且 index/worktree 未被 hook 修改；不得用真实业务全套测试替代该隔离场景。

## 4. 安装、bootstrap 与开发者入口

- [x] 4.1 实现 worktree-specific hook installer：先检查当前有效值，无值或相同期望值时确保 `extensions.worktreeConfig` 已启用并写当前 worktree 的 `.githooks`，worktree 期望值时幂等，任一配置层产生不同有效值时拒绝且不覆盖。以普通仓库和双 linked-worktree 临时仓库检查 worktree/local/global config、来源/当前值/期望值诊断、可移动相对路径及仅安装当前 worktree 的隔离性。
- [x] 4.2 在根 `package.json` 增加 `hooks:install`、`hooks:test`、`hooks:pre-commit`、`hooks:commit-msg` 稳定入口，并让 `pnpm bootstrap` 复用 installer；更新 `tools/dev` 测试，以 `pnpm dev:test` 证明安装步骤、幂等和冲突失败传播且不破坏既有 bootstrap 行为。
- [x] 4.3 更新 `docs/architecture.md` 为 Current 的跨项目提交质量策略，更新 `README.md` 的 bootstrap、模块映射、手动复现、部分暂存、冲突处理与 `--no-verify` 限制，并明确 Git 默认 `Revert "..."` 会被拒绝及如何编辑成 `revert(scope): ...`；通过 source review 对照真实 package scripts、Gradle task 与映射实现，并运行 `git diff --check`。

## 5. Model and Documentation Reconciliation

- [x] 5.1 对照 proposal、delta spec 和 design 审查实现代码、Git 配置副作用、命令 argv、测试及真实 hook smoke；确认未引入产品模型、API、持久化或授权变化，并解决或记录每个实质漂移。
- [x] 5.2 将稳定结论反馈到 `docs/architecture.md`、`README.md` 和新 capability；核对 Desktop/Core API testing strategy 仍拥有其质量门且无需重复修改，核对 `docs/business-model.md` 和 `docs/README.md` 无变更的证据理由，并确认 Current/Target 表述准确。
- [x] 5.3 依次运行 `pnpm hooks:test`、`pnpm dev:test`、由实际实施路径触发的 Desktop/Core API 现有质量门、临时 Git hook smoke、`git diff --check`、`openspec validate add-staged-commit-quality-gates --strict --no-interactive` 与 `openspec validate --all --strict --no-interactive`；记录 Windows 仍未真实验收的风险并确认 delta-spec sync readiness，停在独立 code review 和人工验收门前。
