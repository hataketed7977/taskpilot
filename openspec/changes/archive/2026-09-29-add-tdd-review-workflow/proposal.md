# Proposal

## Why

当前 OpenSpec 默认模板能描述需求、设计和任务，但没有强制把风险映射到测试层，也没有约束实现按 Red → Green → Refactor 推进；现有 `archive` 前也缺少一个明确、独立、只读的实现 review 门禁。仅依赖任务中笼统的“补测试”容易产生先写实现、后补测试，以及结构校验通过但实现与规格不一致的问题。

## What Changes

- 从 OpenSpec 内置 `spec-driven` schema 派生 TaskPilot 项目级 schema，保留 proposal、specs、design、tasks 的标准结构。
- 在规划链中加入 `test-plan` 产物，要求把需求场景和高风险分支映射到最合适的单元、模块集成、契约、真实基础设施或端到端测试层，并明确自动化验证命令。
- 调整 design 和 tasks 模板，使每个行为切片按 Red → Green → Refactor 排序，测试与其负责的生产行为同组交付，不把测试集中到末尾补写。
- 调整 apply 指令，要求先运行目标测试并确认其因缺失行为而失败，再写最小实现，最后在保持测试通过的前提下重构；无法合理执行 Red 的例外必须记录具体原因和替代证据。
- 启用 OpenSpec 官方 `openspec-verify-change` workflow，并在仓库规则中将其定义为 apply 后、archive 前的独立只读 review 门禁。
- 明确 review 的闭环：阻断问题回到 apply 修复并重新 review；未验证项不能被当作通过；OpenSpec 结构校验不能替代源码、测试和架构一致性检查。
- 为 verify 增加与当前 Change 及其声明影响路径绑定的持久化 verification receipt，并在 archive 前通过仓库脚本拒绝缺失、过期或仍含阻断项的证据；独立 review 是默认门禁，但低风险或自举型流程 Change 可通过受版本控制的 policy 和显式 owner acceptance 收口，且不能借此接受失败命令或阻断项。
- 统一 Verify 与 receipt 的机器接口：recorder 接受纯 JSON 报告，也接受 Markdown 中唯一的 `verification-report` JSON fenced block，避免人工重写 review 结论。
- 将一次性 schema smoke check 固化为在临时目录运行的可重复回归脚本，并加强 workflow Skill 刷新后的完整性和版本检查。
- 更新仓库级架构与 Agent 路由，使上述流程成为后续受 OpenSpec 管理变更的默认质量流程。

## Non-Goals

- 不改变 TaskPilot 的产品行为、业务模型、API 或数据结构。
- 不在本变更中初始化 Web、Gateway 或 Core API 工程，也不实现登录功能。
- 不强制机械追求 100% 覆盖率，不用低价值测试替代风险与行为覆盖。
- 不要求纯文档、生成文件刷新或无法体现行为变化的脚手架任务伪造失败测试。
- 不把 review 发现的问题自动修改；review 阶段保持只读，修复必须显式返回 apply 阶段。
- 不允许 owner acceptance 冒充独立 review，也不允许它绕过失败命令、CRITICAL、未接受 WARNING 或适用的 `Not verified`。

## Capabilities

### New Capabilities

无。本变更只调整工程流程和本地 OpenSpec 工具配置。

### Modified Capabilities

无。

## Impact

- OpenSpec 配置、项目级 schema、artifact templates、生成的 Codex workflow Skills，以及仓库级 workflow/evidence/preflight 工具。
- 根 `AGENTS.md` 中的 SDD 路由，以及 `docs/architecture.md` 中的跨项目质量门禁。
- 后续 OpenSpec change 的规划结构和实施顺序；不会修改既有产品契约或运行时代码。
