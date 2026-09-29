# Proposal

## Why

TaskPilot 已确定以兼容 Windows 与 macOS 的桌面客户端作为第一方入口，让用户控制 Agent 在明确选择的本地项目中执行任务。当前仓库仍以浏览器 Web 为 Target Architecture，且尚无可运行代码；现在先完成目录、文档所有权和跨项目边界迁移，可以避免后续从错误的客户端与本地执行边界开始实现。

## What Changes

- **BREAKING**：把第一方客户端的 Target Architecture 从浏览器 Web 调整为 Windows/macOS Desktop App；首版不规划浏览器 Web UI。
- 记录 Electron + React + TypeScript + Vite 的 Target 技术方向，以及 Renderer、Preload、Main Process 的信任边界；这不初始化依赖或运行时代码。
- 记录独立 Agent Runtime 的 Target 边界：Desktop 负责交互与系统集成，Runtime 负责受控的本地执行能力，Gateway/Core API 继续作为云端控制面与业务真相 owner。
- 组件与目录使用职责名 `Agent Runtime` / `apps/agent-runtime/`；它当前只作为运行在用户设备上的本地执行平面，不暗示或规划一个对称的 Cloud Agent Runtime。
- 记录 Windows 与 macOS 共享产品代码和协议、仅在凭据、进程树、路径、通知、签名、安装与升级等窄平台层分别适配和验证的方向。
- 在后续 Apply 中删除 documentation-only 的 `apps/web/`，新增 `apps/desktop/` 与 `apps/agent-runtime/` 文档边界，并同步根文档、Gateway/Core API 文档和文档地图。
- 删除已撤销且与 Desktop 方向互斥的旧 Web change；本 change 不依赖或验证该旧 change 的任务状态。
- 本 change 只更新 Target Architecture、目录和文档，不实现登录、Desktop Shell、Agent Runtime、Agent 工具、PTY、API、数据库、构建或发布能力，也不把规划组件标为 Current。

## Capabilities

### New Capabilities

无。本 change 不建立可验收的运行时行为合同；Desktop 登录、应用 Shell 和本地 Agent 执行能力将在独立 implementation changes 中定义并实现。

### Modified Capabilities

无。本 change 只迁移文档所有权并采用新的 Target Architecture，因此通过 `.openspec.yaml` 的 `skip_specs: true` 明确跳过 delta specs。

## Impact

- 文档与目录：后续 Apply 将移除 `apps/web/`，新增 `apps/desktop/` 和 `apps/agent-runtime/`，并为每个真实子项目提供 `AGENTS.md` 与 child engineering docs。
- 系统边界：权威文档将改为 Desktop、Agent Runtime、Gateway、Core API、身份提供方、OS 凭据库和本地工作区之间的 Target 关系。
- 安全表述：工作区授权只约束 TaskPilot 自有文件工具和受控执行策略，不被描述为操作系统级沙箱；任意子进程仍继承用户的 OS 权限，除非未来另行设计并实现隔离机制。
- 身份边界：文档只固定“Runtime 不持有 Desktop 的长期用户令牌”这一方向；执行 grant 的签发、绑定、过期、刷新、撤销、重放与退出处理由后续实现 change 定义。
- API 与测试：只记录未来 Desktop/Runtime 的目标边界和验证责任；本 change 不创建 API specification、测试工具链或跨平台构建产物。
- 状态纪律：所有新增或迁移的工程文档保持 Target；仓库仍是 documentation-first，不能把任何规划能力描述为已实现。
