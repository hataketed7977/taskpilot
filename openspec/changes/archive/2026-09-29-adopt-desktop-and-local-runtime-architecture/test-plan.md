# Test Plan

## Scope and Risk

本 change 仅迁移 Target Architecture 的目录、导航、所有权和工程文档，并通过 `skip_specs: true` 明确不包含行为 delta specs。主要风险是文档地图断链、第一方 Web 与 Desktop owner 并存、根/child 重复规则、浏览器专属假设残留、业务模型被越界修改、Target 被描述成 Current、安全边界被过度承诺，以及 Mermaid 无法实际渲染。

行为 TDD、代码覆盖率、应用构建、真实 Windows/macOS 测试、OIDC、execution grant、PTY 和 Agent 执行测试不适用于本次变更，也不得作为已完成证据。它们由未来 implementation changes 规划。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Test Layer | Planned Automated Test | Why This Layer |
| --- | --- | --- | --- |
| `apps/web/` 被移除且 `apps/desktop/` 成为唯一第一方 UI owner | 文件结构 | `test ! -e apps/web`、Desktop 文件清单和 scoped `rg` | 捕获双 owner、漏迁移与旧路径 |
| Agent Runtime 有完整 child 文档 owner | 文件结构 | `find apps/agent-runtime -type f` 加必需文件断言 | 证明新边界具有导航和三类工程文档 |
| 根、Desktop、Runtime、Gateway 与 Core API 链接/anchors 有效 | Markdown 结构 | 一次性只读链接、heading anchor 与 fence checker | 捕获目录迁移后的结构回归 |
| 每份工程文档声明状态与所有权 | Metadata | 对 Status/Owns/Read after/Mandatory before 的只读检查 | 防止 Target/Current 与 owner 混淆 |
| 第一方 Web、Cookie/CSRF 和 browser-only 假设不再作为当前方向 | 语义审计 | scoped `rg` 并对合法外部 Web/历史语境建立人工 allowlist | 机械链接检查无法识别语义残留 |
| workspace guard 未被描述为 OS 级沙箱，Runtime 不持有长期用户令牌 | 安全边界审计 | scoped `rg` 加根/Runtime/Gateway 文档 diff review | 捕获对本地执行隔离与令牌边界的过度承诺 |
| 业务关系、基数、唯一标识和生命周期未变化 | Diff review | `git diff -- docs/business-model.md` | 该文档只允许载体中性化和 owner 边界调整 |
| Mermaid 图可解析 | Renderer | 提取 changed Mermaid blocks 并用本地 `mmdc` 逐个渲染 | fence 平衡不能证明 Mermaid 语法正确 |
| OpenSpec 明确跳过行为规格且 artifacts 一致 | OpenSpec | `openspec status` 和 strict validation | 捕获 specs 残留、任务与范围矛盾 |
| 没有实现代码或无关文件混入 | Git/worktree | `git diff --check`、`git status --short` 和 changed-file inventory | 证明此次 Apply 保持文档范围 |

## TDD Slices

行为 TDD 不适用：本 change 没有行为 delta specs，也不创建生产代码或测试工具链。迁移前的 `find`/`rg` 输出只作为结构基线，不冒充缺失行为的 Red test。

Apply 按以下可回滚文档切片执行，并在每个切片后运行对应结构检查：

1. Desktop 目录与文档 owner 迁移；
2. Agent Runtime 文档 owner 建立；
3. 根文档、业务模型载体表述及 Gateway/Core API 边界同步；
4. 全仓结构、语义、状态、OpenSpec 与 Mermaid 渲染验证。

## Verification Commands

### Focused

- `find apps/desktop apps/agent-runtime -type f | sort`：确认两个 child 文档边界的文件清单。
- `test ! -e apps/web`：确认旧第一方 Web owner 已删除。
- `rg -n -i 'apps/web|React Web|First-party Web API|Cookie|CSRF|Cypress|browser matrix|to the Web' AGENTS.md README.md docs apps services --glob '*.md'`：审计旧方向；命中项必须删除或被人工确认为外部 Web/历史语境。
- `rg -n -i 'OS-level sandbox|OS 级沙箱|long-lived.*token|长期.*令牌|execution grant|执行授权' AGENTS.md README.md docs apps services --glob '*.md'`：核对工作区保护与令牌边界措辞。
- `git diff -- docs/business-model.md`：确认业务模型只做载体中性化和 Runtime 非 owner 说明。
- `openspec status --change adopt-desktop-and-local-runtime-architecture --json`：确认 `specs` artifact 为 `skipped`。
- `openspec validate adopt-desktop-and-local-runtime-architecture --strict --no-interactive`：验证 planning artifacts 结构。

### Affected and Cross-Boundary

- 使用一次性只读 Markdown checker 扫描 changed Markdown：验证相对链接、heading anchors、fence 平衡、Status/Owns/Read after/Mandatory before metadata、documentation map inventory 和 child `AGENTS.md` 导航；checker 及输出保存在临时目录，不提交工具代码。
- 提取 changed Markdown 的全部 Mermaid blocks，使用 `/Users/bytedance/.local/bin/node/bin/mmdc` 与本机 Chrome 渲染到临时目录；提取数必须等于成功渲染数且所有进程退出码为 0。
- `git diff --check`：检查空白和 patch 格式。
- `git status --short` 与 changed-file inventory：人工确认只包含本 change 的文档迁移，并区分用户已有的并发改动。

## Exceptions and Manual Evidence

- **行为 TDD/自动化应用测试：**不适用，因为没有 runtime behavior、源码或工具链。替代证据是 OpenSpec、文件结构、链接、metadata、残留引用和 Mermaid 渲染检查。Owner：Apply agent。Follow-up：未来 Desktop auth/shell 与 Runtime implementation changes。
- **文档语义和图表可读性：**纯机械检查不能证明 owner 划分、安全警示和图中信任边界清晰。在 Markdown 与 Mermaid 自动化检查后，通过 self-review 和人工检查逐篇确认 Target/Current 状态、根/child 分工、OS 隔离限制、令牌边界和架构图。仓库当前流程不要求独立 verification receipt；仅在用户明确要求或风险评估需要时追加独立 review。Owner：Apply agent。
