# Design

## Context

当前仓库是 documentation-first 的 Target Architecture，没有应用源码、构建配置、migration 或 API specification。`apps/web/` 仅包含 Agent 指令和三份 Target 工程文档；业务模型由 `docs/business-model.md` 所有，客户端载体调整不改变 WorkItem、WorkflowRun、StepRun、AgentRun、ApprovalRequest 等业务语义。

本 change 只采用新的 Target Architecture 并迁移文档所有权，不定义或实现可验收的运行时行为，因此设置 `skip_specs: true`。登录、Desktop Shell 和 Agent Runtime 的行为合同、自动化测试及实现必须由后续独立 changes 承担。

## Goals / Non-Goals

**Goals:**

- 建立 Desktop 与独立 Agent Runtime 的 Target 边界和唯一文档 owner。
- 用一个共享产品代码库面向 Windows 与 macOS，把平台差异限制在窄适配层，并明确两个平台仍需分别验证和发布。
- 消除权威文档中的第一方 Web、Cookie/CSRF 和 browser-only 客户端假设，同时保留业务模型与云端控制面边界。
- 让根 `AGENTS.md` 和 `docs/README.md` 正确导航 Desktop、Runtime、Gateway 与 Core API 的后续变更。
- 以链接、metadata、所有权、残留引用、状态措辞和 Mermaid 实际渲染作为本次文档迁移的完成证据。

**Non-Goals:**

- 不创建 Electron、React、Node 或 Kotlin 源码、package/Gradle 文件、lockfile、API schema、migration、CI 或发布配置。
- 不定义或实现登录、Shell、Agent 执行、PTY、审批、Diff、通知、签名、安装或升级的行为合同。
- 不决定 Runtime execution grant 的完整协议，也不声称工作区路径检查等同于 OS 级沙箱。
- 不改变业务模型的关系、基数、生命周期、唯一标识或 MVP 规则。
- 不保留或并行维护与 Desktop 方向互斥的第一方 Web 客户端规划。
- 不把 Target Architecture 写成 Current，也不为尚不存在的应用声称测试或构建通过。

## Decisions

### 1. 这是一项无 delta specs 的文档型架构变更

`.openspec.yaml` 使用 `skip_specs: true`，proposal 的 Capabilities 明确为无新增、无修改。本 change 的 Apply 只迁移目录和文档；未来行为规格不得回填进本 change 以绕过独立实现规划。

替代方案是保留 Desktop 登录、Shell 和 Runtime 的行为 delta specs，但这会使实现验收合理地要求不存在的实现与场景测试，和本次 documentation-only 范围冲突，因此拒绝。

### 2. Target 系统采用 Electron Desktop + 独立 Agent Runtime

`Agent Runtime` 是职责名。当前唯一规划的 Runtime 运行在用户设备上，作为本地执行平面；本设计不引入、预留或暗示一个对称的 Cloud Agent Runtime 组件。部署位置由正文明确，不编码进目录名。

根架构把第一方入口改为 Electron Desktop。Desktop 通过 Gateway/Core API 使用云端业务状态，并通过未来定义的认证、版本化本机协议控制独立 Runtime。Renderer、Preload、Main、Runtime 与 Core API 是不同信任边界：Renderer 不直接访问 Node、文件、进程或凭据；Main 不承载 Agent 执行；Runtime 不直接写业务数据库。

选择 Electron 而不是 Tauri，是因为目标场景以 PTY、进程树、Git/Diff、文件监听、流式日志和 Agent CLI/SDK 为核心，统一 Chromium 与 Node 生态比安装体积更重要。这是 Target 技术决策，不表示依赖已初始化。

### 3. `apps/web/` 被 `apps/desktop/` 取代，而不是并存

后续 Apply 删除 documentation-only 的 `apps/web/`，在 `apps/desktop/` 建立新的 `AGENTS.md`、architecture、responsibilities 与 testing strategy。可复用的 React/UI 规则按语义迁移；Electron Renderer、Preload、Main、typed IPC、安全、打包和原生验证由 Desktop child docs 所有。

Electron 在 Windows 与 macOS 都使用其打包的 Chromium。React DOM、组件和可访问性测试仍可保留为 Target 层次；原 browser matrix 不能机械改名，而应改为 packaged Electron/Chromium journeys 加 Windows 与 macOS 原生验证。具体框架与版本留给未来初始化 change。

### 4. `apps/agent-runtime/` 成为本地执行边界的文档 owner

Runtime 作为本机应用放在 `apps/agent-runtime/`，并拥有以下 Target 文档：

- architecture：进程拓扑、本机协议、workspace guard、tool policy、process/PTY、journal 与平台 adapter；
- responsibilities：Agent adapter、工具策略、进程监督、Diff/Artifact 等关注点的放置；
- testing strategy：纯策略、协议、真实文件系统、进程树、PTY、恢复和双平台验证层。

这些文档必须明确：workspace guard 只能约束 TaskPilot 自有文件工具和受控执行策略；任意子进程仍以用户 OS 权限运行，可能访问授权根外的文件、环境变量、凭据或网络。除非未来另行设计并实现 OS 级隔离，不得使用“沙箱”暗示已经阻断这些访问。

### 5. 身份与执行授权只固定边界，不提前发明协议

Target 文档只固定以下跨项目方向：Desktop 的长期用户令牌保存在合适的 OS 凭据设施中，Renderer 不可直接读取；Agent Runtime 不持有该长期令牌；Runtime 启动受管理任务时使用面向执行的短期授权材料。

执行 grant 的 issuer、主体与 user/workspace/project/run/runtime-instance 绑定、有效期、刷新、撤销、重放防护和退出处理会改变可验收行为，必须由后续 implementation change 明确定义并测试。本 change 不以模糊的“安全 token”代替这些决策。

### 6. Gateway/Core API 保持云端控制面和业务真相 owner

Gateway child docs 把 First-party Web API 方向迁移为 First-party Desktop API，并仅记录 Desktop identity 与未来 Runtime grant 的边界责任；Core API 继续拥有 User、Workspace、WorkItem、WorkflowRun、StepRun、AgentRun 与 ApprovalRequest。公共 HTTP API 仍是独立产品边界。

`docs/business-model.md` 只做客户端载体中性化，并注明 Runtime 不是业务真相 owner；不得借本次迁移重写产品术语或关系图。

### 7. 文档结构与实际渲染是本 change 的验证边界

验证覆盖文档 map、每个子项目的 `AGENTS.md` 导航、Status/Owns/Read after/Mandatory before metadata、相对链接与 anchors、Markdown fences、旧第一方 Web owner 残留、Target/Current 措辞，以及 changed Mermaid 块的实际本地渲染。`openspec validate --strict` 只证明 artifacts 结构有效，不替代上述检查。

行为 TDD 不适用于本次纯文档迁移；后续实现 changes 必须在相应 child testing strategy 下定义 Red-Green-Refactor slices 和 Windows/macOS 验证责任。

## Risks / Trade-offs

- [机械替换 Web 破坏语义] → 按 owner 逐篇改写，保留真正通用的 React/UI 规则，对 Cookie、CSRF、SSE 和 browser-only 测试逐项语义审查。
- [架构描述被误认为能力承诺] → 使用 `skip_specs: true`，持续标注 Target 和“无 runnable app”，把行为合同留给后续 implementation changes。
- [工作区授权被误当作 OS 隔离] → 在根与 Runtime owner 文档中显式写明保护范围和任意子进程的剩余风险。
- [Runtime 复用长期用户令牌] → 在跨项目边界中禁止该做法；完整 execution grant 协议作为后续实现阻断决策。
- [根与 child 重复维护 Runtime 规则] → 根文档只写跨项目边界，Runtime child docs 独占内部细节；通过 map 与人工 owner 审查验证。
- [跨平台承诺缺少当前证据] → 只声明共享代码与分别验证的 Target gate，不声称 Windows/macOS 构建已通过。
- [Mermaid fence 正确但图无法使用] → 实际渲染所有 changed Mermaid 块，并人工检查关键边界是否可读。

## Migration Plan

1. 确认 `apps/web/` 仍为 documentation-only，仓库没有 runnable app，且不存在另一个有效的、方向互斥的第一方 Web change；若任一条件不成立则停止并重新规划。
2. 删除 `apps/web/`，创建 `apps/desktop/` 的 Agent 导航和三份 Target 工程文档，不保留第二个第一方 UI owner。
3. 创建 `apps/agent-runtime/AGENTS.md` 与三份 Target 工程文档。
4. 更新根 `AGENTS.md`、`README.md`、`docs/README.md`、`docs/architecture.md` 和必要的 `docs/business-model.md` 载体表述，再同步 Gateway/Core API child docs。
5. 运行 OpenSpec strict validation、Git whitespace/范围检查、文档结构与残留引用检查，并实际渲染所有 changed Mermaid 块。
6. Apply 在已声明的结构、文档与自动化检查全部通过后完成；由于 `skip_specs: true`，无需同步 delta specs，随后按仓库当前流程正式归档。仅在用户明确要求或风险评估需要时追加独立 review。
7. 回滚只恢复目录和文档内容；本 change 不创建运行态、凭据、数据或安装产物，因此没有数据迁移。
