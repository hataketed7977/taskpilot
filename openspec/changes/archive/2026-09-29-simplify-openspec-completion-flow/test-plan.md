# Test Plan

## Scope and Risk

- **影响区域：** 根 OpenSpec 工作规则、跨项目质量流程、`taskpilot-sdd` apply guidance、OpenSpec Shell 工具与隔离 workflow self-test。
- **风险等级：** 低到中。错误可能导致活动文档引用不存在的脚本、self-test 漏掉 TDD/schema 回归，或 archive 流程仍被旧门禁阻塞。
- **非目标：** 不验证 Desktop、Agent Runtime、Gateway 或 Core API 业务行为；不修改历史 archive；不验证独立 reviewer 的报告质量，因为该门禁将被移除。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Test Layer | Planned Automated Test | Why This Layer |
| --- | --- | --- | --- |
| workflow self-test 保留默认 schema 与 `test-plan` DAG | 隔离脚本集成 | `tools/openspec/test-workflow.sh` | 捕获 schema/template/instruction 联动回归 |
| tasks/apply 仍要求 TDD、允许合理非行为例外，且 apply 不再强制 verify handoff | 隔离脚本集成 | workflow fixture 对生成指令做断言 | 直接验证 Agent 实际消费的指导文本 |
| 删除 attestation 工具后无活动文档残留引用 | 静态文档检查 | 本地 Markdown 链接检查 + `rg` 定向检索 | 捕获死链接和陈旧强制规则 |
| Shell 工具修改后语法有效 | Shell 静态检查 | `bash -n tools/openspec/*.sh` | 最低成本捕获语法错误 |
| OpenSpec 结构与所有活动 Change 仍有效 | CLI 集成 | schema validate、doctor、strict validate all | 验证项目级 schema 和 Change 图完整性 |
| 当前其他活动 Change 未被修改 | Git/哈希检查 | 实施前后限定路径 diff 审查 | 防止越界编辑架构 Change |

## TDD Slices

### Slice 1: 移除强制 attestation 门禁

- **Red:** 现有 `tools/openspec/test-workflow.sh` 明确要求 policy、receipt、fingerprint 和 preflight；目标流程下这些断言属于失败的旧契约。
- **Green:** 删除 attestation 专属工具与断言，根规则只要求适用自动化检查、delta spec sync 和 archive；verify 为可选。
- **Refactor:** 合并重复的 fixture helper，保留 schema、DAG、TDD guidance 和 strict validation 主线后运行完整 workflow self-test。

### Slice 2: 清理活动文档契约

- **Red:** 定向检索可在 `AGENTS.md` 和 `docs/architecture.md` 找到强制 receipt/preflight 文案与将 verify 列为必经步骤的描述。
- **Green:** 活动文档不再要求 receipt/preflight，archive 前仍明确要求测试结果与 spec sync。
- **Refactor:** 避免在根规则与架构文档重复详细步骤；根规则负责路由，架构文档负责质量原则。

## Verification Commands

### Focused

- `bash -n tools/openspec/*.sh`：验证保留脚本语法。
- `tools/openspec/test-workflow.sh`：验证 schema、artifact graph、TDD guidance 和严格校验。
- `rg -n "record-verification|archive-preflight|workspace-fingerprint|verification-policy|mandatory completion sequence|mandatory.*verify" AGENTS.md docs tools/openspec`：确认活动路径无旧门禁残留。

### Affected and Cross-Boundary

- `openspec schema validate taskpilot-sdd --verbose`：验证项目 schema。
- `openspec doctor`：验证 OpenSpec 安装和项目状态。
- `openspec validate --all --strict --no-interactive`：验证所有活动 Change 和主 spec。
- `git diff --check`：验证补丁格式。
- 本地 Markdown 链接检查：验证删除脚本后无死链接。

## Exceptions and Manual Evidence

- **行为级 TDD 不适用：** 本变更不新增产品运行时行为，只修改治理文档和工具链。替代证据为隔离 workflow self-test、Shell syntax、OpenSpec strict validation 和文档链接检查。负责人为本 Change 实施者，无后续手工验收依赖。
