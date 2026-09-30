# Design

## Context

见 `proposal.md`。OpenSpec 1.13.2 的官方生成 apply Skill 已要求 “loop until done or blocked”，并通过 `tasks.md` checkbox 持久化进度；项目级 `taskpilot-sdd` schema 还会把 `apply.instruction` 注入所有支持 OpenSpec workflow 的 Agent。当前缺口不是任务状态存储，而是动态指令没有给出足够明确的跨 Agent 终止判定。

OpenSpec CLI 只提供确定性的上下文、状态和指令，不能控制不同 Agent 产品的上下文上限、运行超时、权限弹窗或进程生命周期。因此本设计强化仍在执行中的 Agent 行为和中断后的可恢复性，不把提示词描述成强制调度器。

## Goals / Non-Goals

**Goals:**

- 让 `taskpilot-sdd` 的动态 apply 指令成为跨 Agent 的连续执行契约。
- 明确区分过程进度、可恢复错误和真正需要暂停的 blocker。
- 在 Agent 声明完成前，以 CLI 返回的 `state` 和 `progress.remaining` 作为权威终态判定。
- 通过隔离 fixture 防止 schema 或 workflow refresh 丢失该契约。

**Non-Goals:**

- 不依赖 Codex `/goal`、Claude 专属 command、Cursor rule 或其他厂商专属机制。
- 不承诺突破 Agent 的上下文、超时、崩溃、权限或网络边界。
- 不建设自动重启不同 Agent 的外部 orchestrator。
- 不把每个 task 完成后的 CLI refresh 变成必需步骤；只有终态响应前必须刷新，恢复或状态不确定时可以额外刷新。
- 不修改官方生成 Skill 模板或当前 authentication Change。

## Decisions

### 1. `apply.instruction` 拥有跨 Agent 的核心终止协议

在 `openspec/schemas/taskpilot-sdd/schema.yaml` 的现有 TDD apply 指令后追加：

1. 一次 apply 的执行目标是整个选定 Change，而不是单个 task 或 task group。
2. 一个 task 的声明证据通过后，立即勾选 checkbox 并继续下一项。
3. 进度汇报、task group 完成或 focused check 通过均为非终态。
4. 发送终态响应前重新运行当前 Change 的 apply instructions：
   - `state=ready` 且 `progress.remaining>0` 时继续；
   - `state=all_done` 时才可声明 apply 完成；
   - 只有用户中断或需要用户输入、授权、不可用外部能力、规划变更的具体 blocker 才暂停。
5. 可诊断和安全修复的实现、编译或测试失败不能未经尝试就归类为 blocker。

选择 schema instruction 而不是 `AGENTS.md` 或厂商配置，是因为它随 `openspec instructions apply --json` 返回，并由各集成生成的 apply workflow 统一消费。

### 2. operation guidance 只做短提示，不重复完整协议

在 `openspec/config.yaml` 添加一条简短 guidance，强调 progress update 非终态和 `ready + remaining` 必须继续。它提高支持 operation guidance 的 Agent 的提示显著性，但官方定义其为 advisory，因此不承担唯一约束。

### 3. 使用三状态 fixture 固定 OpenSpec 可恢复语义

将 `tools/openspec/test-workflow.sh` fixture 改为两个 task，并验证：

```text
0/2 -> ready, remaining=2
1/2 -> ready, remaining=1
2/2 -> all_done, remaining=0
```

测试同时断言动态 apply instruction 包含整个 Change、非终态进度、刷新状态、`ready`/`all_done` 和具体 blocker 的关键语义，并断言 operation guidance 被返回。该测试验证 OpenSpec 输出契约，不声称能确定性测试任意 LLM 是否服从提示。

### 4. 生成 Skill 只通过官方 refresh 更新

修改 schema/config/test/docs 后运行 `tools/openspec/update-workflows.sh`，不直接编辑 `.agents/skills/`。生成 Skill 本身继续提供通用 loop，项目动态 instruction 提供 TaskPilot 的更强终止协议。

测试归属根级 workflow self-test。该变更是提示、配置和 fixture 调整，行为级产品 TDD 不适用；最低可靠层是 CLI 集成 fixture、schema validation 和生成版本检查。

## Risks / Trade-offs

- **[不同 Agent 仍可能违反提示]** → 明确该方案提供跨 Agent 契约和可恢复状态，而非运行时强制；fixture 防止契约缺失，无法替代厂商执行保证。
- **[指令过长反而降低遵循度]** → 核心协议保持短小、可判定；config guidance 只保留一句，不复制完整设计。
- **[真实 blocker 被错误吞掉]** → 明确保留用户输入、授权、不可用外部能力和规划变更等暂停条件，不使用“永不停止”。
- **[频繁刷新造成噪声]** → 只强制终态响应前刷新；task 完成后以 checkbox 立即持久化进度并继续。
- **[workflow refresh 覆盖本地变化]** → 所有持久规则放在项目 schema/config；测试在 refresh 后核对生成版本及动态输出。

## Migration Plan

1. 更新 schema、config、architecture 和 fixture。
2. 运行 isolated workflow self-test 和 schema validation。
3. 运行官方 workflow refresh，验证七个 Skill 的 `generatedBy` 与当前 OpenSpec 版本一致。
4. 重新运行 workflow self-test、strict validation 和 diff 检查。
5. 若需回滚，恢复上述四个 owner 文件并再次 refresh；现有 Change checkbox 不需要迁移。
