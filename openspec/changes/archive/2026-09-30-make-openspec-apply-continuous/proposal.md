# Proposal

## Why

当前 OpenSpec apply 虽然要求 Agent “loop until done or blocked”，但跨 Agent 的动态指令没有把阶段汇报明确排除为停止条件，也没有要求终止前根据 OpenSpec 权威状态判断是否仍有待办任务。部分 Agent 因而会在完成一个 task 或 task group 后结束响应，迫使用户反复发送“继续”，削弱了 apply 作为完整 Change 实施动作的可靠性。

## What Changes

- 在项目级 `taskpilot-sdd` schema 的 apply 指令中定义跨 Agent 的连续执行与终止协议：一次 apply 面向整个选定 Change，而不是单个 task 或 task group。
- 要求 Agent 在任务声明的自动化证据通过后立即勾选 checkbox，并在仍有待办任务时继续，不把进度汇报、阶段完成或 focused check 通过视为停止条件。
- 要求 Agent 在发送终态响应前刷新 apply 状态；只有 `all_done`、用户中断或需要用户输入的具体 blocker 才能终止或暂停。
- 在项目级 apply operation guidance 中加入同义的简短提示，作为所有支持该字段的 Agent 的附加建议。
- 扩展隔离 workflow fixture，验证 `0/2 → ready`、`1/2 → ready`、`2/2 → all_done` 以及连续执行指令未在 workflow 更新后丢失。
- 更新根架构文档对 OpenSpec apply 行为的简要说明，并刷新全部七个官方生成 Skills。

## Capabilities

### New Capabilities

无。本变更只调整工程工作流和跨 Agent 提示契约。

### Modified Capabilities

无。已通过 `skip_specs: true` 明确不产生产品能力 delta spec。

## Impact

- OpenSpec 项目配置：`openspec/config.yaml`
- OpenSpec 项目 schema：`openspec/schemas/taskpilot-sdd/schema.yaml`
- 跨项目 SDD 工作流说明：`docs/architecture.md`
- Workflow 回归测试：`tools/openspec/test-workflow.sh`
- 由 `tools/openspec/update-workflows.sh` 刷新的七个生成 Skill
- 不修改当前 `add-desktop-authentication-and-workspace-onboarding` Change 的规划、实现或 task 状态
