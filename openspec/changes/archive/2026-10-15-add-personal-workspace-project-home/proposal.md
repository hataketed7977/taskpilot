# Proposal

## Why

TaskPilot 当前完成认证后只进入账号页，新用户仍看不到可使用的产品上下文。现在需要把账号创建、个人空间、默认项目和项目首页连成一个最小但完整的业务闭环，让用户首次注册后立即进入可工作的项目环境，同时为未来团队空间复用同一套模型留下明确边界。

## What Changes

- 引入统一 `Workspace` 模型：本期实现每个 User 唯一且不可由用户创建、删除、转移的 `PERSONAL` Workspace；保留 `TEAM` 类型的模型扩展点，但不提供团队空间后端行为或 UI 入口。
- 引入统一 `Project` 与 `ProjectMembership` 模型：Project 必须属于一个 Workspace，创建者成为 `OWNER`；个人空间与未来团队空间共用此模型。
- 扩展首次注册事务：原子创建 `User`、`ExternalIdentity`、`TermsAcceptance`、个人 Workspace、Workspace Owner 关系、普通默认 Project 及 Project Owner 关系，任一步失败均整体回滚。
- 将默认 Project 作为普通 Project：按注册法律语言初始化为“我的项目”或 “My project”，描述为空；它可编辑、归档、恢复和永久删除，删除后不自动重建。
- 提供 Project 列表、打开、创建、编辑、归档、查看归档、恢复和永久删除能力；名称必填、描述可选，同一 Workspace 内允许重名。
- 将登录后首页改为 Project 上下文：首次注册直接进入新建默认 Project；再次登录优先恢复仍可访问的最近 Project，否则进入个人空间中的第一个可访问 Project，再无项目时展示创建 Project 的空状态。
- 永久删除放在 Project Settings 的 Danger Zone，要求输入当前 Project 的精确名称并由 Core API 重新校验 Workspace 范围和 Owner 权限；当前仅同步物理删除 Project 及其 Membership。
- 扩展 Desktop API 运行时 OpenAPI，准确记录 Workspace/Project 路径、安全声明、稳定 Problem Details 与状态码。
- 取消既有 Target 文档中“Organization-first、PERSONAL 后续再做”的方向，统一改为 `PERSONAL` 先落地、`TEAM` 仅预留。

## Business Model Impact

本 Change 通过关系图、具体场景映射、Project 状态机和删除威胁分析完成建模。参与者是认证 User；新增规范术语为 `Workspace`、`WorkspaceMembership`、`Project`、`ProjectMembership` 与 `OWNER`。Workspace 保留类型的规范词汇由 `ORGANIZATION` 改为 `TEAM`，与本期落地的 `PERSONAL` 共同组成统一类型模型；该改名不表示本期实现团队空间行为。User 与 PERSONAL Workspace 为一对一且 Workspace 身份稳定；Project 通过 `workspaceId` 且仅属于一个 Workspace，名称不是身份；User 通过 Membership 获得 Workspace/Project 权限。

`PERSONAL` Workspace 生命周期随账号创建建立，本期不可被用户创建、删除、转移或加成员。Project 状态为 `ACTIVE` 或 `ARCHIVED`，可双向转换；永久删除是不可恢复的终态操作。注册是唯一跨 Access/Workspace/Project 能力的同步原子边界，禁止半成品账号或缺失 Owner 关系。Project 写操作均以服务端可信 User、Workspace 范围和 Project Membership 重新授权；隐藏客户端控件不构成授权。并发注册必须仍满足每 User 唯一个人空间和单次初始化，重复请求、名称变化、跨 Workspace 访问及删除竞态必须以稳定冲突或授权错误拒绝。

本期不引入团队成员策略、其他 Project 角色、历史版本或异步清理。永久删除目前只覆盖 Project 元数据与 Membership；未来 Board、Work Item、Workflow Run、Agent Run 等子资源落地前，必须另行设计各自删除政策，未知依赖默认由外键 `RESTRICT` 阻止静默级联。

## Capabilities

### New Capabilities

- `workspace-access`: 个人 Workspace 的注册期原子配置、统一类型模型、唯一性、Owner 关系、读取上下文与服务端范围授权。
- `project-home`: 默认 Project、统一 Project/Project Membership、登录落点，以及 Project 的创建、读取、编辑、归档、恢复和永久删除及 Desktop Project 首页体验。

### Modified Capabilities

- `desktop-authentication`: 首次注册的原子结果从三项身份记录扩展为完整个人 Workspace/默认 Project 上下文，并将认证成功落点从账号页改为 Project 首页。
- `desktop-api-documentation`: 运行时 OpenAPI 从 Auth/current-user 契约扩展为已实现的 Workspace 与 Project 操作及其认证、授权、冲突和错误契约。

## Impact

- Core API：Access、Workspace 与 Project 能力边界、注册应用事务协调、Spring Modulith 依赖约束、PostgreSQL migration、Repository/Application/Controller、授权和运行时 OpenAPI。
- Desktop：Main 固定 API adapter、Preload typed capability、共享 transport/view contracts、Renderer 应用壳与 Project 首页、会话代际隔离、国际化和可访问性。
- 数据：新增 Workspace、Workspace Membership、Project、Project Membership 持久化约束与索引；不新增 Redis 业务事实或 Agent Runtime 依赖。
- 测试：Core 单元/应用/持久化/API/模块边界/Testcontainers，Desktop Renderer/Main/IPC/Cypress，以及 OpenAPI、并发原子性和人工原生视觉验证。

## Documentation Impact

- `docs/business-model.md`：将 Workspace 的 Target 规则从 Organization-first 改为 PERSONAL-first，将 Workspace 保留类型的规范词汇从 `ORGANIZATION` 对齐为 `TEAM`，并记录统一 Workspace/Project 关系、生命周期、Owner 权限与删除规则；只更新定义 Workspace 类型和相应成员关系的段落，不机械替换其他语境中的 organization 表达。
- `docs/architecture.md`：更新跨能力注册事务、Access/Workspace/Project 依赖方向和当前可运行切片；仅在实现证据就绪时把相应段落标为 Current。
- `services/core-api/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md`：记录事务协调者、能力公开契约、持久化/API 所有权及验证命令。
- `apps/desktop/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md`、`design-foundation.md`：将登录后账号页更新为 Project 上下文壳，补齐状态、交互、信任边界与视觉验收要求。
- 主规格 `desktop-authentication` 与 `desktop-api-documentation` 通过本 Change 的 delta spec 同步；新增主规格 `workspace-access` 与 `project-home`。
- `docs/README.md` 不新增、移动或重命名文档，预计无需更改；若实施中所有权清单发生变化，必须在同一切片同步更新。
