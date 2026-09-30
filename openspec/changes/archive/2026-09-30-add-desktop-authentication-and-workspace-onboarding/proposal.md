# Proposal

## Why

TaskPilot Desktop 的首次使用是一条连续链路：用户必须先在端内完成认证，再基于可信 `CurrentUserView` 查询、选择或创建 Workspace，并建立活动 `WorkspaceId` 后加载该 Workspace 的真实 Project list。将认证和 Workspace onboarding 拆成两个 active Change，会重复定义 Desktop/Core API 边界、让交接契约分散，并增加前后端或阶段之间不一致的风险，因此合并为一个端到端 Change。

## What Changes

- 建立完整的 Desktop 首次使用链路：端内注册或登录 → authenticated session + `CurrentUserView` → Workspace onboarding → 选择或创建 Organization Workspace → 建立活动 `WorkspaceId` → 加载该 Workspace 中当前用户可访问的 Project list → 进入 Project list surface。
- 建立一个由 `desktop-authentication` 统一拥有的端到端认证契约，覆盖 Renderer 表单、Preload capability、Electron Main、Core API、PostgreSQL、邮件验证码、session 和 `CurrentUserView` 交接，不再按前端和后端拆成两套 Spec。
- 未认证 Desktop 默认显示邮箱 + 密码登录；邮箱验证码是显式替代登录方式，注册和忘记密码是独立流程，不使用统一“登录或注册”入口或邮箱存在性自动分流。
- 注册按“输入邮箱 → 验证注册验证码 → 设置姓名、密码并同意条款”完成；登录、注册和密码重置验证码按 purpose 隔离；账户创建结果未知时不盲目重试，而是清除秘密并引导回登录恢复。
- TaskPilot Core API 自有密码、OTP、opaque session、refresh rotation/reuse detection 和安全错误语义；refresh 使用持久 `refreshRequestId` 恢复响应丢失和进程崩溃，不把合法恢复误判为 token 重放。
- 为已认证用户实现 Organization-first Workspace onboarding：列出可访问 Workspace；无 Workspace 时按服务端能力显示创建入口；创建成功时原子建立 Workspace 与创建者 Membership，并自动建立活动 Workspace 上下文。
- 冻结受保护的 Workspace list/create 与 Workspace-scoped Project list HTTP、错误、幂等、分页和授权契约；Renderer 不依据 Workspace/Project 类型或角色名推断权限。
- **BREAKING（相对于先前 Target 文档）**：首期不自动配置或开放 `PERSONAL` Workspace；保留统一 Workspace 类型、稳定 `WorkspaceId` 和未来兼容，但不实现 Personal 创建或专属 UI。
- Main 通过固定 Core API origin 执行认证、Workspace 与 Project list 请求并持有 session；Renderer 只使用窄 typed Preload capability，长期 refresh credential 与 pending refresh recovery state 只进入 macOS Keychain 或 Windows Credential Manager。
- 定义启动恢复、protected API `401` 的 single-flight refresh、session generation 失效和跨账号/环境 Workspace 状态隔离。
- 为本 Change 的认证、Workspace 和 Project list HTTP API 提供运行时 OpenAPI/Swagger；Local/Test 可见、Production 默认关闭，并执行 secret hygiene。
- 提供可重复启动的本地开发栈：Docker Compose 承载真实 PostgreSQL 与本地 SMTP sink，Core API 使用显式 `local` profile，Desktop 连接固定本地 origin；开发者无需外部邮件 Provider 凭据即可完成三类邮件流程。

## Capabilities

### New Capabilities

- `desktop-authentication`: 定义 TaskPilot Desktop 端内邮箱认证的完整可观察行为、安全边界和跨进程/服务契约，包括注册、密码登录、邮箱验证码登录、密码重置、session、refresh 恢复、当前用户以及向 onboarding 的交接。
- `workspace-onboarding`: 定义 Organization-first 的 Workspace 列表、无 Workspace 首次进入、创建组织型 Workspace、创建者 Membership、能力驱动客户端、活动 Workspace 恢复、作用域隔离和后续 Personal Workspace 兼容要求。
- `project-list`: 定义活动 Workspace 下的只读 Project 列表、Project Membership 授权、分页、空状态、错误与跨 Workspace 隔离；不包含 Project 创建。
- `desktop-api-documentation`: 定义本 Change 引入的认证、Workspace 与 Project list Desktop HTTP API 如何生成、暴露和保护运行时 OpenAPI/Swagger。它是横切文档治理能力，不是第二套后端行为 Spec。

### Modified Capabilities

无；当前主规格目录尚无已归档的对应 capability。

## Impact

- `apps/desktop/`：Electron + React foundation、端内登录/注册/恢复、Workspace entry/switcher/create、Project list surface、typed Preload capability、Main-owned cloud client、session coordinator、query scope 与 OS credential adapter。
- `services/core-api/`：`access` capability 的 User、EmailIdentity、PasswordCredential、OTP/continuation/session、refresh recovery、Workspace、Workspace Membership、capability、幂等记录和 Workspace 授权，以及 `project` capability 的 Project/Project Membership 最小只读模型、列表查询和 Project 授权；PostgreSQL migration；邮件发送 port；Desktop auth/current-user/workspace/project-list API。
- API：新增 TaskPilot 自有注册、密码登录、验证码登录、密码重置、refresh、logout、current-user、Workspace list/create 与 Workspace-scoped Project list contract；请求、错误、幂等、安全声明与运行时 OpenAPI 在一个 Change 中闭环。
- 数据与安全：密码使用 Argon2id；OTP purpose 隔离、哈希存储、短期、单次消费并限流；refresh credential 轮换、短期加密恢复结果与重用检测；Workspace 与初始 Membership 原子创建；下层资源继续只使用 `WorkspaceId`。
- `services/gateway/` 与 `apps/agent-runtime/`：不创建运行时代码；Core API 保持最终认证/授权边界，登录和 Workspace onboarding 不依赖 Runtime。
- 后续兼容：企业 SSO、社交登录、MFA、identity binding、Personal Workspace，以及 Project create/detail/update 均通过后续 Change 扩展，不得改变既有 `UserId`、`WorkspaceId` 或复制授权链路。
- 非目标：Personal Workspace 实现、Project create/detail/update 或 Project 创建 CTA、成员邀请、计费/套餐、独立 Organization 实体、Agent 执行、Gateway 初始化、Public API 和版本化 OpenAPI/client generation。
