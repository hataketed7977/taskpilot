# Tasks

## 1. TDD-Not-Applicable 连续执行契约

- [x] 1.1 在 `tools/openspec/test-workflow.sh` 先增加 apply 动态指令与 `operationGuidance` 的 contract assertions，运行脚本并确认因 `taskpilot-sdd` schema/config 尚未提供连续执行契约而按预期失败；记录失败 token。
- [x] 1.2 在 `openspec/schemas/taskpilot-sdd/schema.yaml` 添加面向整个 Change 的连续执行与终止协议，在 `openspec/config.yaml` 添加简短非终态 progress guidance；运行 `tools/openspec/test-workflow.sh` 和 `openspec schema validate taskpilot-sdd --verbose`，确认 contract assertions 通过。
- [x] 1.3 收敛 schema 与 config guidance 的重复：schema 保留完整可判定协议，config 只保留一句 advisory 提示；重新运行 focused workflow self-test。

## 2. TDD-Not-Applicable 部分进度回归

- [x] 2.1 将 isolated workflow fixture 扩展为两个 checkbox，先增加 `0/2 -> ready` 与只完成第一个后的 `1/2 -> ready` 精确断言，运行测试并确认当前单 task fixture 不能满足该结构证据。
- [x] 2.2 增加完成第二个 task 后 `2/2 -> all_done` 的精确断言，保留测试前后 `openspec list --json` 一致性检查；运行 `tools/openspec/test-workflow.sh`。
- [x] 2.3 重构重复的 fixture 状态读取或 checkbox 更新代码，确保失败位置仍清晰；重新运行 `tools/openspec/test-workflow.sh`。

## 3. 文档、生成 workflow 与最终检查

- [x] 3.1 在 `docs/architecture.md` 的 SDD Delivery and Review Workflow 中补充简短跨 Agent 原则：apply 面向整个 Change、阶段进度非终态、终态前检查权威状态、真实 blocker 例外；不复制 schema 全文。运行本地 Markdown 链接检查。
- [x] 3.2 运行 `tools/openspec/update-workflows.sh` 刷新七个官方生成 Skills，不手工编辑生成文件；确认所有 `generatedBy` 等于 `openspec --version`，然后重新运行 `tools/openspec/test-workflow.sh`。
- [x] 3.3 运行 `openspec doctor`、`openspec validate --all --strict --no-interactive`、`git diff --check`、本地 Markdown 链接检查和定向 diff 审查；确认未修改 `openspec/changes/add-desktop-authentication-and-workspace-onboarding/` 的规划、实现或 checkbox。
