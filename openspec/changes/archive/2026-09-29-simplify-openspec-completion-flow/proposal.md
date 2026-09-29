# Proposal

## Why

当前把独立 `openspec-verify-change`、verification receipt 和 archive preflight 设为每个 Change 的强制完成门禁，导致文档和低风险工具变更也要等待额外 reviewer，并引入报告转换、指纹失效和协调成本。该流程已明显拖慢归档，且其主要质量价值可由 TDD、聚焦自动化检查、严格 OpenSpec 校验和 delta spec sync 更直接地覆盖。

## What Changes

- 将 OpenSpec 默认完成路径简化为：apply 完成 → 运行适用的自动化检查 → 同步 delta specs → archive。
- 将 `openspec-verify-change` 改为按风险或用户要求使用的可选 review 工具，不再是所有 Change 的强制门禁。
- 移除 verification policy、receipt、workspace fingerprint 和 archive preflight 的仓库级强制要求及专用工具。
- 保留 `test-plan.md`、Red/Green/Refactor 指导、聚焦测试、严格校验和归档前 spec sync。
- 调整 workflow regression test，只覆盖仍然有效的 TDD/schema/Skill 刷新约束。

## Capabilities

### New Capabilities

无。本变更仅简化工程工作流和工具。

### Modified Capabilities

无。已通过 `skip_specs: true` 明确不产生产品能力 delta spec。

## Impact

- 根工作规则：`AGENTS.md`
- 跨项目质量策略：`docs/architecture.md`
- OpenSpec schema guidance：`openspec/schemas/taskpilot-sdd/schema.yaml`
- OpenSpec 工具：`tools/openspec/`
- OpenSpec workflow regression test
- 不修改历史 archive 内容，不修改当前 `adopt-desktop-and-local-runtime-architecture` Change 的规划或实现内容
