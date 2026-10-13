# Proposal

## Why

仓库目前依赖人工遵守提交信息惯例并手动选择 pnpm 或 Gradle 检查，容易产生格式不一致、漏跑受影响模块测试，或为无关模块重复运行耗时质量门的问题。需要把现有提交历史和模块测试边界固化为本地 Git 提交门禁，并在拒绝提交时给出可操作的具体原因。

## What Changes

- 增加仓库管理的 `commit-msg` 门禁，按现有历史采用 Conventional Commits 风格校验提交主题，支持约定的 type、可选 scope 与 breaking-change 标记。
- 增加仓库管理的 `pre-commit` 门禁，只依据 Git 暂存区文件选择 Desktop、Core API、开发工具或门禁自身的质量命令，并去重执行。
- 将纯文档/规格路径显式标为免测；对未知且未映射的可执行路径 fail-closed，避免新模块静默绕过测试。
- 当受影响模块存在未暂存或未跟踪文件时 fail-closed，避免在混合工作区中把当前文件系统的测试结果误认为待提交快照的结果。
- 为提交信息解析、NUL 安全的暂存文件解析、rename 源/目标与 copy 目标映射、命令选择、失败诊断、hook 安装冲突和多 worktree 隔离增加自动化测试。
- 通过官方 `pnpm bootstrap` 自动为当前 checkout 写入 worktree-specific 的仓库 hook 路径，并提供显式安装、检查和测试命令；不覆盖已有的不兼容 `core.hooksPath`，也不改变同一仓库其他 worktree 的有效 hook 路径。
- 更新根架构和开发文档，记录模块映射、各模块命令、免测边界、原生 `--no-verify` 限制和故障排查方式。

## Non-Goals

- 不在每次提交时运行完整 `pnpm check`，也不运行未受暂存改动影响的模块。
- 不启动 Docker、数据库、真实 GitHub OAuth、Cypress、打包或原生凭据 smoke；提交门禁复用各模块现有本地质量门范围。
- 不自动修改提交信息、暂存文件或工作区，不自动 stash/restore，也不替用户提交。
- 不做到单个测试文件或代码行级别的增量推断；选择粒度止于拥有独立质量命令的模块。
- 不新增 pre-push 或 CI 门禁；Git 原生 `--no-verify` 仍可绕过本地 hook，因此该能力不是安全边界。

## Business Model Impact

无产品业务模型变化。本 Change 只实现仓库开发者提交生命周期中的工程质量门，不改变 TaskPilot 的用户、Workspace、Project、身份、授权、数据、API 或业务状态。建模采用轻量决策树与具体示例，确认的工程不变量是：提交信息必须符合仓库格式；有可执行改动的每个受影响模块必须由其拥有的质量门验证；纯文档免测与未知路径拒绝必须可解释；失败不得改变暂存区或工作区。

## Capabilities

### New Capabilities

- `repository-commit-quality-gates`: 定义仓库管理的提交信息校验、暂存区驱动的模块质量门、清晰诊断和 checkout 安装行为。

### Modified Capabilities

无。

## Impact

- 新增仓库级 `.githooks/` 入口和 `tools/git-hooks/` 实现、映射及测试。
- 根 `package.json` 增加安装、手动检查和门禁测试脚本；`tools/dev/bootstrap.mjs` 接入 worktree-specific hook 安装。
- Desktop 继续使用 `pnpm --filter @taskpilot/desktop qualityCheck`；Core API 继续使用 `:services:core-api:qualityCheck`；开发工具和 hook 自身使用 Node 测试命令。
- 不新增第三方运行时或开发依赖，不改变产品 API、持久化、部署或运行时行为。

## Documentation Impact

- 更新 `docs/architecture.md`，把该能力记录为 Current 的跨项目本地质量策略，并维护 pnpm/Gradle 模块到质量命令的所有权映射。
- 更新 `README.md` 的 bootstrap、提交与故障排查说明；文档仍由现有 `docs/README.md` 导航体系拥有，不新增工程文档，因此文档地图无需新增条目。
- `docs/business-model.md` 无需修改，因为没有产品词汇、关系、生命周期或业务不变量变化。
- Desktop 与 Core API 子项目测试策略无需重定义：门禁只调用它们已拥有的质量命令；若实现发现现有命令所有权不实，必须先更新本 Change 再修改子项目文档。
- 归档时将新 capability 同步到主 specs；没有其他主 spec 修改。
