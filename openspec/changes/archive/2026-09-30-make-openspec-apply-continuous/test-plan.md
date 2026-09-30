# Test Plan

## Scope and Risk

本变更影响项目级 OpenSpec schema、config、生成 workflow 的动态输入、根架构说明和隔离 self-test。风险等级为中：失败不会改变产品运行时数据，但会使不同 Agent 对 apply 终止条件产生漂移，继续要求用户人工发送“继续”，或反向吞掉真实 blocker。

主要风险包括：连续执行指令未进入 CLI 输出、operation guidance 未返回、部分进度被误判为 `all_done`、生成 Skill refresh 覆盖工作流、测试污染现有 active Change。明确不测试任意 LLM 的概率性服从，也不测试厂商运行时的上下文、超时或自动重启能力。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Test Layer | Planned Automated Test | Why This Layer |
| --- | --- | --- | --- |
| 初始两个 task 均未完成时保持 `ready` | CLI integration fixture | `tools/openspec/test-workflow.sh` 断言 `progress={total:2,complete:0,remaining:2}` | 直接固定 OpenSpec checkbox 状态解析 |
| 完成一个 task 后仍为 `ready`，不能视为 Change 完成 | CLI integration fixture | 修改第一个 checkbox 后重新获取 apply JSON，断言 `complete=1`、`remaining=1`、`state=ready` | 覆盖当前缺失的 partial-progress 回归 |
| 两个 task 均完成后才为 `all_done` | CLI integration fixture | 修改第二个 checkbox 后断言 `complete=2`、`remaining=0`、`state=all_done` | 固定唯一正常完成终态 |
| 动态 apply instruction 包含跨 Agent 连续执行与 blocker 契约 | CLI contract assertion | 对 apply JSON 的 `instruction` 检查 entire Change、non-terminal progress、refresh、`ready`、`all_done` 和 concrete blocker 语义 | 检测 schema 指令被删除、覆盖或未生效 |
| 项目 operation guidance 被 apply 返回 | CLI contract assertion | 断言 `operationGuidance` 包含非终态进度与继续待办的简短提示 | 验证 config 接线，不把 guidance 当成强制门禁 |
| workflow refresh 后七个生成 Skill 仍与安装版本一致 | Tooling integration | `tools/openspec/update-workflows.sh` | 覆盖官方生成路径，防止手改 Skill |
| fixture 不修改现有 active Change | Isolation check | 比较测试前后 `openspec list --json` | 防止当前 authentication Change 被测试污染 |
| schema、活动 Change 和 Markdown 结构保持有效 | CLI/static | schema validate、strict validate、`git diff --check`、本地链接检查 | 捕获 YAML、OpenSpec 结构、补丁和文档引用错误 |

## TDD Slices

### Slice 1: 连续执行动态契约

- **Red:** 先扩展 `tools/openspec/test-workflow.sh` 对当前 apply JSON 断言连续执行和 blocker 关键语义，并断言 config guidance；运行测试，预期因 schema/config 尚未提供这些字段而失败。
- **Green:** 在 `taskpilot-sdd` 的 `apply.instruction` 添加最小终止协议，在 `openspec/config.yaml` 添加一条简短 guidance，使 contract assertions 通过。
- **Refactor:** 去除 schema 与 guidance 间不必要的重复，保留 schema 为唯一完整 owner；运行 workflow self-test 和 schema validation。

### Slice 2: 部分进度状态机 fixture

- **Red:** 将 fixture 定义为两个 task，并在只勾选第一个后断言 `ready`、`1/2`；当前只支持单 task 的测试结构不能提供该证据。
- **Green:** 增加 0/2、1/2、2/2 三次 apply state 读取和精确 progress 断言。
- **Refactor:** 用小型 Python helper 或清晰的顺序断言避免重复，同时保留人可读失败位置；运行完整 workflow self-test。

### Slice 3: 文档和生成 workflow 对齐

- **Red:** 定向检索确认当前 `docs/architecture.md` 未描述 apply 的非终态进度与跨 Agent 终止边界，且生成 Skill 尚未经过本次 schema/config 变更后的 refresh 验证。
- **Green:** 在 SDD Delivery and Review Workflow 中加入简短原则，并运行官方 refresh。
- **Refactor:** 保持架构文档只描述质量原则、不复制完整 schema 指令；重新运行 self-test、strict validation 和链接检查。

## Verification Commands

### Focused

- `tools/openspec/test-workflow.sh`：验证连续执行 instruction、operation guidance、三阶段 progress 和 fixture 隔离。
- `openspec schema validate taskpilot-sdd --verbose`：验证修改后的项目 schema。
- `tools/openspec/update-workflows.sh`：刷新并核对七个官方生成 Skill 的 OpenSpec 版本。

### Affected and Cross-Boundary

- `openspec doctor`：验证 OpenSpec root、关系和项目配置健康。
- `openspec validate --all --strict --no-interactive`：验证所有活动 Change 和主 specs。
- `git diff --check`：验证补丁格式。
- 本地 Markdown 链接检查：验证架构说明和 Change artifacts 没有引入死链接。
- 定向 `git diff` 与路径检查：确认未修改 `openspec/changes/add-desktop-authentication-and-workspace-onboarding/`。

## Exceptions and Manual Evidence

- **行为级产品 TDD 不适用：** 本变更不新增产品运行时行为，只调整 OpenSpec 提示契约、配置、文档和测试 fixture。替代自动化证据为 CLI integration self-test、schema validation、workflow refresh/version check、strict validation 和静态检查。
- **任意 Agent 的实际服从率不可由仓库单测确定：** 提示词是跨 Agent 的契约而非强制 runtime。无需把人工试跑设为 task checkbox；上线后若仍有具体 Agent 提前结束，可收集可复现 transcript 并另行评估 vendor adapter 或 orchestrator。负责人为 workflow 维护者。
