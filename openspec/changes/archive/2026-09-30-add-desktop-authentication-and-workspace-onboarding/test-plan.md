# Test Plan

## Scope and Risk

本 Change 端到端影响 Desktop Main/Preload/Renderer、Core API `access` 与 `project` capability、PostgreSQL identity/credential/challenge/session/Workspace/Workspace Membership/Project/Project Membership 数据、邮件 adapter、运行时 API 文档以及 macOS/Windows credential facility。认证、Workspace onboarding 和只读 Project list 是一条连续首次使用链路，由三个行为 capability 分别拥有并通过窄契约交接；测试既要证明每段安全边界，也要证明真实交接。

风险级别为 **High**：缺陷可能导致账号枚举、认证绕过、密码/OTP/session 泄漏、验证码跨 purpose 消费、并发重复账户、注册提交结果未知、refresh 响应丢失误判或重放、protected API 401 风暴、credential 写入失败后产生幽灵登录、Workspace/Membership 部分提交、幂等失效、越权创建、Project 越权读取、跨 Workspace 关联或缓存污染、cursor 跨 scope 复用，或首次用户无法进入产品。

测试按最低可靠层分配：纯策略用 unit；Spring Security、HTTP、mail port 和应用授权用 module/API integration；唯一约束、原子消费、事务、关系一致性和并发用 PostgreSQL Testcontainers；HTTP/credential/IPC 编排用 Main integration；可见状态与 query scope 用 Renderer integration；OS credential 和打包进程由当前执行平台的 packaged/native 自动化证明；完整 journey 使用真实 Main/Preload、Core API/PostgreSQL 与 fake mail。不得用 Renderer test 替代 Main/IPC/credential 证据，也不得用 mock repository 或 H2 替代 PostgreSQL 并发及关系约束证据。Windows/macOS 各自的安装、系统凭据集成与最终视觉 smoke 是对应平台发布证据，不是本 Change 在单一开发主机上的完成前提。

显式非目标：Personal Workspace 实现、Project 创建及其他 Project mutation、Project detail、Project Member 管理、Project-scoped navigation、Board、Agent Runtime、Gateway、Public API、成员邀请、计费、MFA、第三方 IdP、账号绑定/合并和管理员用户管理。测试不得为了“未来兼容”实现这些功能。

覆盖目标沿用仓库门禁：Core API whole-project Kover 不低于 line 80% / branch 75%；Desktop 建立等价 changed-line/branch 门禁并由 `qualityCheck` 聚合。密码/OTP/session、purpose 隔离、并发消费、注册唯一性与未知结果恢复、refresh request-id 恢复/reuse、credential 写入失败、401 generation、IPC credential 隔离、Workspace 原子创建/幂等/授权、active Workspace scope、Project 双重 Membership 授权、Project pagination/scope validation 和 Production 文档关闭均为 critical branches。

## Scenario-to-Test Mapping

| Requirement / Risk | Test Layer | Planned Evidence |
| --- | --- | --- |
| 登录、验证码登录、注册、忘记密码入口明确分离 | Renderer integration | 默认密码登录、显式导航、禁止统一入口和邮箱存在性自动探测 |
| 密码登录不枚举账号 | Core API unit/API + Renderer | 未知邮箱执行 dummy hash；失败 status/body/shape 一致；UI 只映射稳定 code |
| 三种 OTP purpose 隔离 | Unit + PostgreSQL concurrency | TTL、尝试次数、冷却、过期、跨 purpose 拒绝、并发仅一次消费 |
| 三步注册、同邮箱并发与提交结果未知 | API + PostgreSQL barrier + Main | continuation 仅 Main 持有；User/Identity/Password/Terms/Session 原子创建；唯一 normalized email；提交结果未知时不盲重放 secret-bearing 请求，清除秘密后回登录确认账户结果 |
| 密码重置 | API + PostgreSQL | 更新密码和撤销全部 session 原子提交；旧 session 401；失败无部分写入 |
| Argon2id 与密码策略 | Unit + integration | 参数/salt、长度与 UTF-8 bounds、common/breached、旧参数登录后 rehash、秘密不落日志 |
| Session/current user/refresh/logout | API + PostgreSQL + Main race | opaque digest、expiry、`CurrentUserView`、完整 refresh success DTO、pending `refreshRequestId`、同 request id 恢复、不同 request id reuse detection、single-flight、generation-first logout |
| Renderer/Main secret boundary | Main/Preload architecture + secret scan | generic HTTP/token getter 不可达；秘密不在 DOM/storage/URL/log/snapshot/env/argv |
| OS credential 生命周期及写入失败 | Main contract + current-host packaged native | 共享 adapter contract 覆盖写入失败与无明文降级；当前主机原生 credential 后端自动验证写入、跨进程恢复、轮换、删除。对应平台发布前分别 smoke macOS Keychain 与 Windows Credential Manager |
| 重启恢复及账号/环境隔离 | Main/Renderer restart integration | OS credential 恢复后调用 current-user；scope 至少含 environment/UserId；无效 credential 全清；账号或 environment 切换不复用受保护状态 |
| Protected business API 401 恢复 | Main race + API | Workspace 与 Project 请求共享同 generation single-flight；成功后原业务请求最多重试一次；终止失败全清；暂态失败保留 credential 但隐藏未经确认的陈旧数据 |
| 已有 Workspace 的首次进入 | Renderer integration + API | authenticated handoff 后列出 Workspace、选择稳定 `WorkspaceId`、建立活动上下文并请求真实 Project list |
| 无 Workspace 且可/不可创建 | Renderer integration | `canCreateWorkspace` / `createWorkspaceReasonCode` 驱动创建入口或解释状态，不依据角色名/类型推断 |
| 窄 Workspace 创建请求 | Core API API contract + Main | Preload 仅 `name`/`creationRequestId`；body 仅 `name`；header 为 `Idempotency-Key`；禁止 actor/type/role/capability/未知字段 |
| Workspace 名称规则 | Unit + API | trim、1–80 Unicode code point、控制字符拒绝、合法同名允许、字段错误映射 |
| Workspace、Membership 与幂等结果原子性 | Application + PostgreSQL | 三者同时提交或完全回滚；成功后创建者通过权威 Workspace list 立即看到并可选择该 Workspace，不新增 item-level capability |
| Workspace 幂等、冲突与并发 | PostgreSQL barrier + API | 相同 actor/key/payload 返回相同结果；payload mismatch 冲突；同 key 并发最多一次提交；失败不缓存为成功 |
| Workspace 最终授权与伪造身份 | API/security | 缺失/无效 token、伪造 header、创建不被允许或列表中的 `canCreateWorkspace` 已过期均无写入；列表上下文 capability 只用于展示 |
| 创建后上下文和未知结果恢复 | Renderer/Main integration | 建立活动 `WorkspaceId`、刷新列表并加载 Project list；网络未知保留名称和原 key，恢复后安全重试 |
| Workspace 启动恢复与 scope 隔离 | Renderer/Main deferred-response | environment/UserId namespace；0/1/N 分支；最近 ID 验证；授权撤销/切换/登出清理；迟到结果不污染当前 Workspace |
| Workspace list HTTP contract | API/OpenAPI/Main contract | `GET /desktop/v1/workspaces`、严格 `{ items, capabilities }`、item `{ workspaceId, name, type }`、bearer、稳定错误与未知字段策略一致 |
| Project list HTTP contract | API/OpenAPI/Main contract | `GET /desktop/v1/workspaces/{workspaceId}/projects`；可选 opaque `cursor`；`limit` 默认 50 且 1–100；严格 item `{ projectId, workspaceId, name }`；`nextCursor` 仅有下一页时出现 |
| Project 双重 Membership 授权 | Application + PostgreSQL + API | 先验证有效 Workspace Membership，再只返回同 User/Workspace 下有效 Project Membership 对应 Project；全局 ProjectId 不能绕过父 scope |
| Project 不存在与不可访问防枚举 | API/security | Workspace 不存在和无 Workspace Membership 都返回相同 `404 WORKSPACE_NOT_FOUND` shape；不泄漏 Project 数据或存在性差异 |
| Project 跨 Workspace 关系一致性 | PostgreSQL + application integration | 数据库约束拒绝可约束关系；受控异常 fixture 被查询层排除并产生脱敏完整性信号，绝不返回跨 Workspace item |
| Project cursor 与分页 | API + Main/Renderer integration | 未知 query、非法 cursor/limit 返回 `400 VALIDATION_FAILED`；cursor opaque 且不可跨 Workspace；分页追加不重复、不污染其他 scope |
| Project query scope 与迟到响应 | Main/Renderer deferred-response | key 至少含 environment/UserId/WorkspaceId；切换 Workspace/account/environment 后取消或隔离旧请求、items、cursor、empty/error state |
| Project item scope mismatch | Main contract | 任一 item 的 `workspaceId` 不匹配请求 scope 时整页拒绝，不发布部分数据，并记录脱敏 contract violation |
| Project loading/empty/error/recovery | Renderer integration | 稳定 loading；真实空 items 显示只读空状态；503/网络错误可重试且不伪造空；404 清 active Workspace 和 Project cache 后重走 Workspace 恢复 |
| Personal 未来兼容 | Desktop Main transport fixture | parser 可接受 `type: PERSONAL` fixture；Core API 首期不创建、不自动配置也不为测试伪造 Personal Workspace；Renderer 无类型选择或专属 UI |
| Project mutation 负空间 | API/IPC/UI architecture scan | 不存在 Project create endpoint/use case、`canCreateProject`、Create Project CTA、Project detail/member/navigation capability |
| Runtime 独立 | Main/architecture + end-to-end | Runtime launcher 零调用，完整认证、Workspace onboarding 和 Project list 仍完成 |
| Runtime OpenAPI/Swagger | Core API contract/startup | auth/workspace/project-list 实际路径、schema、security、错误一致；Local/Test 可用；Production 默认关闭；无 secret 示例 |
| 完整首次使用 journey | Cross-boundary integration | 注册/登录 → `CurrentUserView` → Workspace list → create/select Organization Workspace → active `WorkspaceId` → 真实 Project list → 有数据或真实空状态 |
| 可访问性和恢复状态 | Renderer + axe/keyboard | pending、重复提交、字段错误、live region、焦点、200% zoom、reduced-motion、offline、cooldown/expiry、Project loading/empty/error/pagination |

## TDD Slices

### Slice 1: 契约、安全配置与文档基线
- **Red:** Contract/startup tests 固定 auth/workspace/project-list endpoint、security、Problem Details、Production Swagger 和秘密扫描。
- **Green:** 增加最小依赖与配置 seam，更新 owning Target 文档和 runtime OpenAPI 基线。
- **Refactor:** 集中错误、redaction、clock/random 和环境策略；运行 strict validation 与文档检查。

### Slice 2: User、EmailIdentity 与密码
- **Red:** 覆盖邮箱规范化、唯一性、Argon2id、dummy hash、密码策略和并发注册。
- **Green:** 实现最小 model/migration/repository/use-case seam。
- **Refactor:** 收敛 policy，不把 persistence entity 泄露到应用层。

### Slice 3: OTP、continuation、限流与邮件
- **Red:** 覆盖三 purpose、TTL/attempt/cooldown、单次消费、枚举防护和投递失败/未知。
- **Green:** 实现 challenge、continuation、持久限流和 mail port/adapters。
- **Refactor:** 统一 purpose policy、模板 command 和 secret-safe logging。

### Slice 4: 注册、登录、重置和 session HTTP
- **Red:** API/PostgreSQL tests 覆盖四条认证流、注册未知结果、原子成功边界、完整 refresh success DTO、request-id rotation/recovery/reuse、logout 和 current user。
- **Green:** 实现固定 `/desktop/v1/auth/**` 与 `/desktop/v1/me` adapter。
- **Refactor:** Controller 只做 transport mapping，事务与安全规则留在 owning use case。

### Slice 5: Desktop foundation、Main auth 与 OS credential
- **Red:** Main/Preload tests 固定 origin/allowlist、flow handle、schema/error、pending refresh recovery、401 single-flight、session generation、重启恢复和 credential lifecycle/写入失败。
- **Green:** 实现 Electron foundation、Main auth client、flow/session coordinator 与平台 credential adapter。
- **Refactor:** 分离 transport/flow/session/redaction，确保 generic HTTP、token 和 Runtime 不可达。

### Slice 6: Renderer 认证体验
- **Red:** 覆盖四条流程、切换时 secret 清理、pending/error/offline/a11y 和成功 handoff。
- **Green:** 按 `frontend-design` 和 React best practices 实现最小 auth boundary。
- **Refactor:** 集中文案、字段映射、焦点、倒计时与 cache reset，运行 UI review。

### Slice 7: Workspace 模型、授权与创建输入
- **Red:** 覆盖名称 policy、可信 actor、固定 `ORGANIZATION`、严格 body、列表上下文 `canCreateWorkspace` 和禁止字段。
- **Green:** 实现统一 Workspace/Membership 模型、应用授权与 Desktop DTO/error mapping。
- **Refactor:** 保持单一 `WorkspaceId` ownership，不增加 tactical-DDD 样板或 `organizationId`。

### Slice 8: Workspace 原子事务和持久幂等
- **Red:** PostgreSQL tests 覆盖 Workspace/Membership rollback、相同 key 重放/并发、payload mismatch 和不同 key 同名。
- **Green:** 实现单事务创建与持久幂等唯一约束。
- **Refactor:** 提取可控 ID/时钟和冲突重读，不用进程内锁替代数据库约束。

### Slice 9: Workspace list/create HTTP 与 Main/Preload
- **Red:** API/security 和 Main contract tests 固定 Workspace method/path/status、bearer、`{ items: [{ workspaceId, name, type }], capabilities: { canCreateWorkspace, createWorkspaceReasonCode? } }`、严格 `{ name }`、`Idempotency-Key`、稳定错误与 IPC sender/origin/schema。
- **Green:** 实现 authenticated Workspace API、Main cloud client 和窄 Preload capability。
- **Refactor:** 集中 transport adapter、channel ownership 和 session cleanup。

### Slice 10: Organization-first Renderer 与 Workspace scope
- **Red:** 覆盖已有/无 Workspace、有/无创建能力、0/1/N 启动恢复、最近授权撤销、跨 environment/account、创建/错误/离线/未知结果和迟到响应。
- **Green:** 实现 Workspace entry/switcher/create、活动 `WorkspaceId` 与 scope key，并把有效上下文交给 Project list。
- **Refactor:** 集中 query-key factory 与展示 policy，避免 Workspace UI 推断 Project 数据或权限。

### Slice 11: Project/Project Membership 模型与授权
- **Red:** PostgreSQL/application tests 覆盖最小只读 Project/Project Membership、Workspace Membership 前提、同 User/Workspace 对齐、跨 Workspace 关系和受控异常 fixture。
- **Green:** 在 `project` capability 实现只读查询；通过 `access` 的窄同步授权事实获取 Workspace Membership，不读取其私表。
- **Refactor:** 保持 Project Work ownership，不引入 create use case、Repository 样板或反向模块依赖。

### Slice 12: Project list HTTP、OpenAPI 与 Main/Preload
- **Red:** API/security/Main tests 固定 path/query/DTO、400/401/404/503、cursor scope、bearer、item scope validation、IPC sender/origin/schema 和 protected 401 recovery。
- **Green:** 实现 Project list controller/query、runtime OpenAPI、Main adapter 和 typed `listProjects` capability。
- **Refactor:** 集中 pagination/error mapping，保持 cursor opaque，禁止 generic HTTP 或 Project mutation 泄露到 Renderer。

### Slice 13: Project list Renderer 与三维 scope
- **Red:** 覆盖 loading/data/empty/error/pagination、Workspace 404 恢复、environment/UserId/WorkspaceId key、Workspace 切换迟到响应、item mismatch、无创建 CTA 和 Runtime 零调用。
- **Green:** 实现只读 Project list surface，真实呈现结果并隔离全部陈旧状态。
- **Refactor:** 复用查询与状态原语，按 React/UI Skills 完成可访问性和视觉审查。

### Slice 14: 完整 journey、当前平台打包与发布矩阵
- **Red:** 建立注册/登录至真实 Project list 的可执行 packaged journey；环境或打包故障不算行为 Red。
- **Green:** 串联真实 Main/Preload、Core API/PostgreSQL、fake mail 和当前平台 native credential 边界，修复真实跨进程、credential 与打包差异；窄窗口、键盘、关键错误和 reduced-motion 使用无 GUI Renderer/Cypress 自动断言。
- **Refactor:** 共享测试和脚本保持 Windows/macOS 可执行入口，但本 Change 只要求当前执行平台的自动化结果；不以单平台证据宣称另一平台已发布验证。

## Verification Commands

Core API：

- `./gradlew :services:core-api:test`
- `./gradlew :services:core-api:moduleTest`
- `./gradlew :services:core-api:integrationTest`
- `./gradlew :services:core-api:koverVerify`
- `./gradlew :services:core-api:qualityCheck`

Desktop scaffold 必须提供并自验证：

- `pnpm --filter @taskpilot/desktop test:main`
- `pnpm --filter @taskpilot/desktop test:renderer`
- `pnpm --filter @taskpilot/desktop test:architecture`
- `pnpm --filter @taskpilot/desktop test:coverage`
- `pnpm --filter @taskpilot/desktop typecheck`
- `pnpm --filter @taskpilot/desktop lint`
- `pnpm --filter @taskpilot/desktop build`
- `pnpm --filter @taskpilot/desktop qualityCheck`
- `pnpm --filter @taskpilot/desktop test:packaged-native`

Planning/final checks：

- `openspec validate add-desktop-authentication-and-workspace-onboarding --strict --no-interactive`
- `git diff --check -- openspec/changes/add-desktop-authentication-and-workspace-onboarding`
- Runtime OpenAPI contract 覆盖 auth/workspace/project-list schema、安全声明、禁止字段、稳定错误和 secret hygiene。
- Negative scan 确认没有首期 Provider OIDC、自动 Personal、独立 Organization/`organizationId`、Gateway runtime、onboarding Runtime 依赖、Project create endpoint/use case、Create Project CTA 或 `canCreateProject`。
- 文档若修改 Mermaid，使用仓库规定的本地 renderer 实际渲染受影响图。

若 apply 基线已有不同但等价的受文档管理命令，应先同步本 test plan 与 owning testing strategy，不并存两套别名。

## Release / Manual Evidence

- macOS arm64 发布前：安装/启动、Keychain 集成、签名/公证路径和最终视觉 smoke。
- Windows x64 发布前：安装/启动、Credential Manager 集成、签名安装包路径和最终视觉 smoke；不得由 macOS 结果替代。
- 上述平台 smoke 不阻塞本 Change 在单一开发主机完成，但未取得对应平台证据时不得宣称该平台 release-ready。
- 本地开发栈 smoke：Docker Compose 的真实 PostgreSQL + Mailpit、Core API `local` profile 与固定本地 Desktop origin；从 Mailpit API 读取实际 SMTP 邮件，分别完成注册、登录 OTP 和 password reset，自动化输出不得包含验证码、密码、token 或本地随机 secret。
- 部署/发布 mail smoke：真实外部 Provider、发件域名、TLS 和公网投递分别验证注册、登录 OTP 和 reset；secret 仅从 CI/runtime secret store 注入。该检查不阻塞本 Change或普通 CI，但未执行时不得宣称对应邮件部署 release-ready。
- 生产前确认：pepper/key、rate-limit 共享状态、mail sender/domain、TLS、migration/backup、幂等与 cursor 保留策略和告警。
- `web-design-guidelines` 最终 review 的 material finding 必须修复或形成明确后续决策；纯视觉判断不伪装成自动化结果。

## Exceptions

- 文档和 OpenSpec artifact 不适用行为 TDD；证据为 strict validation、链接/diagram 检查和 diff check。
- 第三方 mail provider 的送达、bounce 和信誉不作为普通 CI acceptance；challenge、adapter contract 和失败语义仍须自动化。
- 原生 credential 提示、安装、签名与最终视觉观感分别保留 macOS/Windows 发布证据；少量人工 smoke 不替代自动 credential 生命周期、Renderer 键盘/窄窗口/a11y 与错误状态断言。
- 第一阶段只维护运行时 OpenAPI；版本化 schema、生成客户端和 breaking-change gate 留给后续独立 Change。
