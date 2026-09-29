# Tasks

## 1. 简化活动工作流契约

- [x] 1.1 更新根 `AGENTS.md`，将 verify/review 调整为按风险或用户要求使用的可选步骤，删除 verification policy、receipt、fingerprint 和 archive preflight 的强制说明，并保留 apply 后自动化检查、delta spec sync 和 archive 路径；以定向 `rg` 检索和 Markdown 链接检查作为完成证据。
- [x] 1.2 更新 `docs/architecture.md` 的 SDD 流程图和质量规则，保留 TDD、聚焦/受影响测试、严格校验和 spec sync，删除 attestation 子系统描述；以定向 `rg` 检索和 Markdown 链接检查作为完成证据。

## 2. 删除 attestation 工具并收敛回归测试

- [x] 2.1 更新 `openspec/schemas/taskpilot-sdd/schema.yaml` 的描述和 apply guidance，移除完成后强制 independent verify 的指令，改为通过适用自动化检查后进入 spec sync/archive，并由 `tools/openspec/test-workflow.sh` 断言新指导。
- [x] 2.2 简化 `tools/openspec/test-workflow.sh`，删除 policy eligibility、report parsing、receipt、scoped fingerprint 和 archive preflight fixture/断言，同时保留 default schema、`test-plan` DAG、tasks/apply TDD guidance、严格校验和 fixture 清理断言；运行 `tools/openspec/test-workflow.sh`。
- [x] 2.3 删除 `tools/openspec/record-verification.sh`、`tools/openspec/workspace-fingerprint.sh` 和 `tools/openspec/archive-preflight.sh`，确认活动文档与保留脚本无引用；运行 `bash -n tools/openspec/*.sh` 和定向 `rg` 检索。
- [x] 2.4 保留七个官方生成 Skills 及 `tools/openspec/update-workflows.sh` 的版本一致性检查，不手工修改生成 Skill；验证每个 `generatedBy` 等于 `openspec --version`。

## 3. 验证并收尾

- [x] 3.1 运行 `openspec schema validate taskpilot-sdd --verbose`、`openspec doctor`、`openspec validate --all --strict --no-interactive`、`git diff --check` 和本地 Markdown 链接检查。
- [x] 3.2 检查 diff 只包含本 Change、活动工作流规则与 `tools/openspec` 简化，确认未修改 `adopt-desktop-and-local-runtime-architecture` 内容或历史 archive 证据。
- [x] 3.3 对本 Change 执行 archive sync 评估；因 `skip_specs: true` 应报告无 delta specs，然后通过官方 archive 流程归档，不运行独立 verify、receipt 或 archive preflight。
