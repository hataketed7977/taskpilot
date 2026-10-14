# Tasks

## 1. Workspace / Project Schema and Capability Boundaries

- [x] 1.1 重写 0→1 `V1__initialize_taskpilot.sql`，新增 `workspace.workspaces`、`workspace.workspace_memberships`、`project.projects`、`project.project_memberships` 及已批准的 PK/FK/check/唯一/列表索引和最小删除规则；以 Testcontainers migration/constraint tests 和 FK 元数据审计证明 PERSONAL 唯一、同名 Project 合法、Membership 唯一、未知依赖默认 `RESTRICT`。
- [x] 1.2 新增仅协调首次注册的 `onboarding` Modulith capability，定义 Access、Workspace 与 Project provisioning 的窄公开契约，配置 `workspace -> access`、`project -> access,workspace`、`onboarding -> access,workspace,project`、Access 无 capability 依赖；以模块/ArchUnit 测试证明依赖方向、不引入 shared/common 逃逸包且 Onboarding 无自有表。
- [x] 1.3 同步 `docs/business-model.md`、`docs/architecture.md` 与 Core API `architecture.md`/`responsibilities.md` 中统一 Workspace/Project、PERSONAL-first、Workspace 保留类型规范词汇 `ORGANIZATION → TEAM`、TEAM extension point、能力所有权和事务方向；只清理与 Workspace 类型及相应成员关系有关的旧术语，不机械替换其他语境中的 organization 表达。未有执行证据的段落保持 Target，并运行 Markdown 链接及受影响 Mermaid 渲染检查。

## 2. Atomic Registration Provisioning

- [x] 2.1 **Red:** 在 Core application/PostgreSQL 测试中先固定完整注册成功、每一配置步骤失败全回滚、同 External Identity 并发只产生一个完整账号，以及 PostgreSQL 提交后 session issue 失败可重新登录的行为；失败必须来自尚未实现的 provisioning，而非环境或编译错误。
- [x] 2.2 **Green:** 实现 Onboarding 事务协调者、PERSONAL Workspace/Workspace OWNER、按法律 locale 命名的普通默认 Project/Project OWNER，并把安全首页 bootstrap 接入现有联合注册响应；数据库提交前禁止签发 Redis session。
- [x] 2.3 **Refactor:** 收窄注册 port/DTO 与事务边界，移除 Access 直接拥有 Project 写入的可能；运行定向 Onboarding/registration tests 与模块测试，并同步 Core API testing strategy 和 `desktop-authentication` 所有权说明为已证实状态。

## 3. Workspace and Project Read/Create/Edit API

- [x] 3.1 **Red:** 新增应用层测试覆盖个人 Workspace 读取、跨 Workspace not-found、Workspace OWNER 可在无预存 Project Membership 时创建、已有 Project 写入要求 Project OWNER、Project 确定性列表/detail、同名创建、Project OWNER 原子建立、request id 同载荷重放/改载荷冲突/并发重放，以及 edit 乐观版本冲突。
- [x] 3.2 **Green:** 实现 Workspace/Project persistence 与 application use cases，以及 list/detail/create/edit Desktop controller；创建基于 Access 建立的可信 ACTIVE actor 重新校验 Workspace OWNER，已有 Project 操作重新校验 Workspace 范围与 Project Membership，不让路径 ID 或客户端 capability 代替授权。
- [x] 3.3 **Refactor:** 集中 scope、cursor、idempotency fingerprint、version 与 Problem Details 映射但不建立通用框架；用 focused Core tests 证明 `400/401/404/409/503`、稳定错误码、确定性排序与无权不泄露。
- [x] 3.4 更新 Core API architecture/responsibilities/testing strategy 中已实现的 API、持久化访问路径和授权边界；对应行为有测试与代码证据后才标记 Current。

## 4. Project Archive, Restore, and Permanent Deletion

- [x] 4.1 **Red:** 新增状态策略和真实 PostgreSQL 应用测试，覆盖 `ACTIVE ↔ ARCHIVED`、实际转换版本冲突、响应丢失后携带转换前旧版本重复目标状态仍返回当前 view 且不写入、列表隔离、删除名称不匹配、改名/版本竞态、非 Owner、ACTIVE/ARCHIVED 删除、最后 Project 删除及受保护依赖阻止删除。
- [x] 4.2 **Green:** 实现归档、恢复和 Danger Zone permanent-deletion use cases/controller；删除事务锁定并复核 Workspace、OWNER、版本和当前精确名称，只删除该 Project 及其 Membership，保留个人 Workspace且不补建默认 Project。
- [x] 4.3 **Refactor:** 审计所有 Project FK 和删除 SQL，确保没有未批准通配级联；运行定向 lifecycle/deletion/API tests，并把物理删除及未来子资源 `RESTRICT` 规则同步到 business model 与 Core API owning docs。

## 5. Runtime OpenAPI Contract

- [x] 5.1 扩展 transport schema 和运行时 OpenAPI，记录 Workspace/Project 完整路径、access bearer、Workspace scope、request id、expected version、confirmation name，以及创建 `201 + ProjectView`、列表/详情 `200`、编辑/归档/恢复 `200 + ProjectView`、永久删除无响应体 `204` 和共享 Problem Details；不得描述 TEAM/成员管理/Board/Agent 等未实现路径。
- [x] 5.2 更新 OpenAPI 精确路径、安全/schema/error/secret-hygiene contract tests，运行 focused contract tests 并确认 `/v3/api-docs` 与实际 Controller 一致；同步 `desktop-api-documentation` 的 Core 文档说明，并在 Workspace/Project API 成为 Current 时把主规格过时的 Auth-only Purpose 更新为当前准确范围。

## 6. Desktop Main / Preload Project Capabilities

- [x] 6.1 **Red:** 扩展 Main 测试覆盖固定 HTTP allowlist、Workspace/Project typed contracts、首次 bootstrap、最近 Project 按 environment+User 分区、有效/无效/归档/删除 fallback、存储损坏退化、401 清 session，以及 logout/换账号后的迟到响应隔离。
- [x] 6.2 **Green:** 实现 Main Workspace/Project clients、最近 Project preference owner、session-generation-aware coordinator，以及窄 `workspaces`/`projects` Preload API；Renderer 不得获得 bearer、fetch、URL 或 generic IPC。
- [x] 6.3 **Refactor:** 收紧 IPC sender/origin/schema/generation 校验、错误 DTO 和 response-key fencing；运行 `test:main` 与 `test:architecture`，同步 Desktop architecture/responsibilities/testing strategy 中 Current 的网络、偏好和信任边界。

## 7. Renderer Project Home and Settings

- [x] 7.1 按 Desktop Skill 顺序先使用 `frontend-design`，基于 Quiet control desk/Context Spine 定稿应用壳、Project 列表/切换、创建/编辑、归档列表、Settings/Danger Zone 以及 loading/empty/error/session-expired 状态；明确不展示 TEAM、邀请、成员、Board、Agent 或指标占位，并更新 `design-foundation.md` 的行为 wireframe。
- [x] 7.2 **Red:** 在 Renderer tests 中固定首次直达、最近/fallback/空态、创建编辑、归档恢复删除后选择、可重试错误、logout、双语文案、无虚假数据和旧 generation 响应丢弃；缺失生产行为应是唯一失败原因。
- [x] 7.3 **Green:** 使用 `vercel-react-best-practices` 实现 Project shell 与分层状态，不引入不必要依赖；保持账号、语言、logout 可达，表单精简，Danger Zone 要求精确当前名称。
- [x] 7.4 **Refactor:** 用 Cypress 在 `960×640` 覆盖 zh-CN/en、长名称/描述折行、键盘、焦点返回、错误关联、reduced-motion 和主动作可见；执行 `web-design-guidelines` review，修复 material findings 后运行 `test:renderer`、`test:e2e`、typecheck、lint 和 build。
- [x] 7.5 同步 Desktop architecture/responsibilities/testing strategy/design foundation 的 Current/Target，确保文档不把未实现 TEAM 或后续 Project 内容说成 Current。

## 8. Integrated Journey and Model / Documentation Reconciliation

- [x] 8.1 扩展 system journey，以 provider/browser doubles 串联首次注册直达默认 Project、logout、再次登录最近/fallback、删除最后 Project 空态、session issue 恢复和 Agent Runtime 零调用；为现有 `tests/system` 补齐可执行 `test:system` script 并在受控 Core API base URL 下实际运行，不把仅被 TypeScript 编译误报为 journey 已验证。
- [x] 8.2 运行 `./gradlew :services:core-api:qualityCheck`、Desktop `qualityCheck`/`test:e2e`/`test:system`、`pnpm dev:test` 与根 `pnpm check`；在最终验收阶段运行当前主机 `test:packaged-native`，逐项记录实际执行结果，未执行平台不得称为已验证。
- [x] 8.3 对照已批准模型审计实现代码、V1 migration、API/OpenAPI、测试和运行证据，解决或记录每项物质漂移；特别检查 PERSONAL 唯一、普通默认 Project、OWNER 授权、直接物理删除、未知依赖 RESTRICT 和 TEAM 非暴露。
- [x] 8.4 将稳定结论反馈到 `docs/business-model.md`、根/子 architecture、responsibilities、testing strategy 与 design foundation，协调所有 Current/Target 状态；若 `docs/README.md` 所有权清单未变化，记录无需修改的证据。
- [x] 8.5 运行 `openspec validate add-personal-workspace-project-home --strict --no-interactive`、`openspec validate --all --strict --no-interactive` 与 `git diff --check`，确认四份 delta spec 与实现证据一致并已具备后续人工 review、明确 sync/archive 的条件；本任务不得自行 sync 或 archive。

## 9. Workspace Capability Boundary Correction

- [x] 9.1 修订 migration/architecture tests，固定独立 `workspace` schema、schema-qualified FK、Workspace 持久化不读取 Access 私表，以及 `workspace -> access`、`project -> access,workspace`、`onboarding -> access,workspace,project` 的 Modulith 依赖方向。
- [x] 9.2 将 Workspace 模型、读取/授权公开契约、Controller 与 JDBC 持久化移动到独立 `workspace` capability；Access 只保留可信 actor 与身份/认证职责，Project 只通过 Workspace 公共契约授权。
- [x] 9.3 重写 0→1 V1 为 `access`、`workspace`、`project` 三个 owner schema，拆分 Access/Workspace provisioning，并保持首次注册在同一 PostgreSQL ambient transaction 中原子创建全部事实。
- [x] 9.4 同步根与 Core API owning docs 的 capability/schema 所有权，运行 focused migration、onboarding、Workspace/Project、HTTP/OpenAPI、Modulith/ArchUnit tests 与 `:services:core-api:qualityCheck`。

## 10. Acceptance Regression and Final Reconciliation

- [x] 10.1 为 Desktop 创建成功响应补充回归测试，并将服务端返回的 `projectId` 绑定到 response key，避免 Renderer fencing 丢弃成功结果。
- [x] 10.2 运行受影响的 Desktop Main/Renderer/architecture/system 检查，确认创建后关闭表单、刷新列表并选择新 Project，且既有 session-generation 防串线仍有效。
- [x] 10.3 重新执行 model-drift/documentation-feedback audit、OpenSpec strict validation 与 `git diff --check`，只记录本轮实际证据；不得自行 sync、archive 或 commit。
