# Design

## Context

参见 [`proposal.md`](proposal.md) 的动机，以及 [`desktop-authentication`](specs/desktop-authentication/spec.md)、[`workspace-onboarding`](specs/workspace-onboarding/spec.md)、[`project-list`](specs/project-list/spec.md) 和 [`desktop-api-documentation`](specs/desktop-api-documentation/spec.md) 的行为契约。

当前 Core API foundation 已有 fail-closed Spring Security、`access` capability、PostgreSQL/Testcontainers 测试层和独立 Desktop API surface 规则，但尚无 User、凭据、OTP、session、Workspace/Membership、Project/Project Membership 或真实首次使用 HTTP API；`project` module 仅有 capability marker，没有业务实现。Desktop 仍只有 Target 文档；Gateway 与 Agent Runtime 尚未初始化。当前业务 Target 同时缺少可执行认证，以及“已认证但没有可访问 Workspace”的可恢复路径。

此前规划先后把前后端认证、认证与 Workspace onboarding 分成可独立变化的 active Change。这会让同一首次使用链路出现多套 Main/Core API、session、OpenAPI、Desktop foundation 和发布门禁。本设计将其合并为一个 Change，但保留清晰 capability 边界：`desktop-authentication` 拥有认证行为，`workspace-onboarding` 拥有认证后的 Workspace 行为，`project-list` 拥有只读 Project 发现行为，`desktop-api-documentation` 横切管理运行时文档。

## Goals / Non-Goals

**Goals:**

- 在 TaskPilot Desktop 端内完成独立的注册、密码登录、邮箱验证码登录和密码重置流程。
- 让 Core API 成为邮箱身份、密码/OTP 验证、session、Workspace/Project Membership 与业务授权的唯一服务端 owner。
- 让 Main 成为 Desktop HTTP 和 session credential owner，Renderer 只看到窄 capability 与安全状态。
- 从 authenticated `CurrentUserView` 连续进入 Workspace onboarding；有 Workspace 时选择进入，无 Workspace 时按能力创建组织型 Workspace。
- 让 Workspace 与创建者初始 Membership 原子、幂等、可重试且可并发验证，并用稳定 `WorkspaceId` 隔离所有下层查询。
- 建立 Workspace-scoped 只读 Project list，从真实 PostgreSQL 按 Workspace Membership 与 Project Membership 双重授权加载有数据或真实空状态。
- 以稳定 `UserId`、统一 Workspace 模型和可扩展 identity 关系支持未来 IdP/企业 SSO与 Personal Workspace，而不提前实现它们。
- 用最低可靠测试层证明密码/OTP/session 安全、数据库唯一性、Workspace 事务/幂等、Project 查询授权与分页、跨进程秘密边界和双平台 credential 生命周期。
- 提供 Local/Test runtime OpenAPI/Swagger，同时保持 Production 默认关闭。

**Non-Goals:**

- 不实现第三方 IdP、OIDC、系统浏览器登录、PKCE、loopback callback、MFA、社交登录或企业 SSO。
- 不实现邮箱变更、账号绑定/合并、管理员用户管理或找回被彻底锁死的账户。
- 不实现 Personal Workspace 创建/自动配置/专属 UI、Project 创建/详情/编辑/删除、Project 成员管理、Project-scoped navigation、成员邀请、计费/配额或独立 `Organization` 实体。
- 不初始化 Gateway 或 Agent Runtime；首次使用链路不得依赖 Runtime。
- 不建立 public API、版本化 OpenAPI 文件、生成客户端或兼容性门禁。
- 不把邮件投递做成新的独立服务；Core API 通过 port 调用可替换 adapter。
- 不在 planning 阶段预设 Core API foundation 最终不存在的类名、包名或 migration 序号；apply 首步按当前可执行基线确认落点。

## Decisions

### 1. 一个 capability 拥有完整认证行为

`desktop-authentication` 从用户动作一直拥有到服务端成功边界：Renderer 表单 → typed Preload → Main auth client → Core API → PostgreSQL/邮件 adapter → session → `CurrentUserView`。Spec 不分“前端认证”和“后端认证”；否则任一侧都可能在结构校验通过时与另一侧不可实现。

实现责任仍保持清晰：Renderer 拥有交互和短暂表单状态；Preload 只暴露业务 capability；Main 拥有固定 HTTP client、flow coordinator、session generation 和 OS credential；Core API `access` capability 拥有认证规则、User/credential/challenge/session 持久事实；PostgreSQL 保证唯一性和原子消费；邮件 adapter 只投递已生成内容，不决定认证结果。

### 2. 端内流程明确区分登录、注册和恢复

默认 `/login` 为邮箱 + 密码。“使用邮箱验证码登录”进入 `/login/code`，“忘记密码”进入 `/forgot-password`，“创建账户”进入 `/register`。不得通过预查邮箱存在性自动选择流程。

注册是邮箱、注册验证码、账户资料三步。验证码登录和密码重置各有独立上下文。切换流程可显式传递邮箱，但必须清除密码、确认密码、验证码和 continuation。成功注册或登录只交接安全用户视图和 authenticated 状态，不在认证页承载 Workspace 行为。

### 3. Core API 提供 TaskPilot 自有的窄认证 HTTP contract

首期 Desktop HTTP surface 固定为：

| Operation | Method and path | Authentication |
| --- | --- | --- |
| 请求注册验证码 | `POST /desktop/v1/auth/registration/code` | Anonymous, rate limited |
| 验证注册验证码 | `POST /desktop/v1/auth/registration/code/verify` | Anonymous challenge context |
| 创建账户 | `POST /desktop/v1/auth/registration` | Main-held registration continuation |
| 密码登录 | `POST /desktop/v1/auth/login/password` | Anonymous, rate limited |
| 请求登录验证码 | `POST /desktop/v1/auth/login/code` | Anonymous, rate limited |
| 验证登录验证码 | `POST /desktop/v1/auth/login/code/verify` | Anonymous challenge context |
| 请求密码重置验证码 | `POST /desktop/v1/auth/password-reset/code` | Anonymous, rate limited |
| 验证密码重置验证码 | `POST /desktop/v1/auth/password-reset/code/verify` | Anonymous challenge context |
| 完成密码重置 | `POST /desktop/v1/auth/password-reset` | Main-held reset continuation |
| 刷新 session | `POST /desktop/v1/auth/session/refresh` | Refresh credential |
| 登出并撤销 session | `POST /desktop/v1/auth/session/logout` | Current session credential |
| 获取当前用户 | `GET /desktop/v1/me` | Access token |

Endpoint 使用 JSON over HTTPS 和共享 `application/problem+json`。匿名不等于无保护：请求大小、schema、超时、速率、尝试次数和审计都在 Core API 生效。Desktop Main 只调用此固定 allowlist，不暴露通用 HTTP 给 Renderer。

旧的 `POST /desktop/v1/session/bootstrap` 被删除：自有注册在创建 User 时已经建立身份，登录直接解析现有 User，认证成功响应即可携带 `CurrentUserView`。`GET /desktop/v1/me` 保留为 session 恢复和刷新后的权威读取。

### 4. 邮箱身份、密码凭据和未来外部身份分离

`access` capability 的首期持久模型包含：

- `User(UserId, displayName, status, createdAt, ...)`
- `EmailIdentity(EmailIdentityId, UserId, normalizedEmail, displayEmail, verifiedAt, ...)`
- `PasswordCredential(UserId, argon2idDigestAndParameters, changedAt, ...)`
- `VerificationChallenge(ChallengeId, purpose, normalizedEmail, codeDigest, expiresAt, attemptsRemaining, consumedAt, resend/rate metadata, ...)`
- `AuthContinuation(ContinuationId, purpose, normalizedEmail/UserId, secretDigest, expiresAt, consumedAt, ...)`
- `UserSession(SessionId, UserId, familyId, accessDigest/expiry, refreshDigest/expiry, generation/status, ...)`
- `TermsAcceptance(UserId, termsVersion, acceptedAt, ...)`

这些是责任和不变量，不要求机械建立一类一个 repository。`normalizedEmail` 具有数据库唯一约束；显示邮箱独立保存。批准的首期规范化规则是：去除外围空白、严格解析地址、域名按 IDNA ASCII 和小写处理、local part 采用产品批准的 Unicode case-fold key；不做 Gmail 等 Provider 特有的点号或 plus-address 折叠。实现前用跨语言 fixtures 固定规则，避免 Desktop 和 Core API 各自规范化；Desktop 只做格式提示，唯一权威在 Core API。

未来可增加 `ExternalIdentity(issuer, subject, UserId)` 或等价 binding，但不在首期建空表或 OIDC adapter。外部身份绑定必须是独立、显式、可审计流程；相同 email 不自动合并 User。

### 5. 密码使用 Argon2id，并允许策略升级

密码不做 Unicode normalization 或静默变换；Core API 按用户提交的 UTF-8 序列验证。首期策略允许空格、Unicode 和密码管理器，不要求大小写/数字/符号组合；默认最少 12 个 Unicode code point，最多 128 个 code point 且最多 512 UTF-8 bytes，并拒绝批准的常见/泄露密码集合。具体基线为配置和测试 fixture，降低不得绕过变更评审。

使用 Argon2id、每条 credential 独立随机 salt，并保存算法版本、memory/time/parallelism 参数。参数由版本化配置和自动化测试固定；验证成功发现旧参数时 opportunistic rehash。未知邮箱执行同参数等级的 dummy hash，以降低枚举时序差异。明文密码只存在于当前请求，绝不进入持久化、日志、事件、审计或响应。

### 6. OTP challenge 和 continuation 是两级一次性证明

三种 purpose 固定为 `REGISTER_EMAIL_VERIFY`、`LOGIN_EMAIL_OTP`、`PASSWORD_RESET`。验证码由 CSPRNG 生成，默认六位十进制、10 分钟 TTL、最多 5 次验证尝试和 60 秒重发冷却；这些是可收紧配置，任何放宽必须经过安全评审。验证码只保存带服务端 pepper 的摘要，日志和邮件 adapter 之外不暴露明文。

发码 endpoint 对账号存在性返回统一 accepted 形状；不存在或不适用时也消耗相近的限流/处理路径，但不发送可用于认证的 code。速率至少覆盖规范化邮箱、来源网络和设备/安装信号的组合，并以服务端 `retryAfter` 驱动 UI。分布式部署前，限流和 challenge 原子性必须使用共享持久边界，不能只靠单进程内存。

验证成功在事务中原子消费 challenge。注册和密码重置随后签发高熵、短期、单次 continuation；continuation secret 只交给 Main，服务端仅存摘要，Renderer 只得到安全 flow 状态。登录验证码验证成功直接创建 session，不额外暴露 continuation。purpose、邮箱/User、challenge、continuation 必须精确绑定，不能跨流程重放。

### 7. 注册和密码重置使用原子数据库成功边界

创建账户必须在一个事务中写入 User、EmailIdentity、PasswordCredential、TermsAcceptance 和首个 UserSession。`unique(normalized_email)` 处理并发；冲突时不留下部分记录。条款 acceptance 使用服务端认可的当前版本，客户端仅提交用户明确勾选的版本，过期版本返回稳定错误。创建账户本身不自动重试：若提交结果未知，Desktop 清除密码和 continuation，提示“账户可能已创建”，并回到登录页用同一邮箱密码确认。已消费 continuation 或已注册邮箱不能继续重复创建。

密码重置先消费 reset continuation，再原子更新 credential version 并撤销该 User 的所有 session family。成功后不自动登录，Desktop 返回密码登录页。这降低被遗留终端继续使用和 reset flow 自动建立 session 的风险。事务失败时 continuation、密码和 session 撤销必须保持一致，不出现“密码已改但 session 未撤销”的部分成功。

### 8. 使用可撤销 opaque session 和 refresh rotation

单一 Core API 的 MVP 不需要外部 JWKS 或自包含 JWT。认证成功签发短期高熵 opaque access token 和长期高熵 opaque refresh token；服务端只存带 pepper 的 token digest。access token 默认 15 分钟；refresh session 默认 30 天 inactivity、90 天 absolute lifetime，均由服务端返回权威 expiry。

每次 refresh 使用 Main 生成的不可预测 `refreshRequestId` 在事务中轮换。发送前，Main 在同一 OS credential entry 原子保存“旧 refresh token + pending request id”；Core API 按 session family/current refresh token/request id 保存短期、加密的可恢复结果。相同旧 token + 相同 request id 在恢复窗口内返回相同轮换结果；相同已轮换 token + 不同 request id、超出窗口或没有合法恢复记录才视为重放并撤销 family。token 主记录仍只保存摘要；恢复结果加密、短期过期且不得进入日志。

Main 安全写入新 refresh token 后才切换内存 access token/session generation 并清除 pending request id。refresh 写入失败时不切换 generation，保留旧 token + pending id 以便重启恢复，不降级到文件、Renderer storage、环境变量或命令行。初次注册/登录若无法安全保存 refresh credential，则不发布 authenticated success、不进入受保护 UI，清除新 session result 并尽力撤销刚创建的服务端 session，待 credential facility 恢复后要求重新登录。Main 对同一 generation 只允许 single-flight refresh，同一业务请求最多重试一次。Core API logout 撤销当前 family 且幂等；Desktop 始终先完成本地 generation-first logout，因此网络失败不能让旧 session 在本机复活。

任一 protected API 返回 `401` 时，Main 仅对同 generation 发起一次共享 refresh。终止性失败会删除 credential、`CurrentUserView`、Workspace list、活动 Workspace 与 Workspace-scoped cache，并拒绝旧 generation 的迟到结果；暂态失败保留 credential/pending recovery state，进入 `temporarily-unavailable` 且不展示陈旧受保护数据。Renderer 只看 `signed-out | authenticating | authenticated | reauthentication-required | temporarily-unavailable` 和安全用户视图。

### 9. Renderer、Preload 和 Main 使用 capability 边界

Renderer 采集邮箱、姓名、密码、验证码和条款确认；密码使用 `current-password`/`new-password`，验证码使用 `one-time-code`。这些值不得进入 URL、持久化 store、query cache、遥测、崩溃报告或快照。

Preload 暴露 `signInWithPassword`、登录验证码、注册、密码重置、`getSessionView`、`subscribeSessionView` 和 `logout` 等显式业务动作，不暴露 `fetch`、任意 endpoint/header、token getter 或 credential handle。Main 校验 sender frame/origin、schema、大小、flow handle、operation id 和允许状态转换；flow coordinator 将 Renderer 的非秘密 client handle 映射到 Main-held challenge/continuation。

Main 的 auth client 固定 Core API HTTPS origin、endpoint allowlist、timeout、重试和 redaction。瞬时 password/OTP 在请求完成、取消、切换、超时或窗口销毁后清除。对非幂等认证动作不做盲目自动重试；网络结果未知时回到服务端可安全确认或重新开始的状态。

### 10. 错误契约稳定且避免账号枚举

错误使用 Problem Details，至少包含 `code`、correlation identifier，可选 `errors[].path/code` 和 `retryAfterSeconds`。首期稳定类别包括：`VALIDATION_FAILED`、`INVALID_CREDENTIALS`、`INVALID_OR_EXPIRED_CODE`、`TOO_MANY_ATTEMPTS`、`RATE_LIMITED`、`PASSWORD_POLICY_VIOLATION`、`REGISTRATION_CONTEXT_EXPIRED`、`PASSWORD_RESET_CONTEXT_EXPIRED`、`EMAIL_ALREADY_REGISTERED`（仅在邮箱 possession 已证明后）、`TERMS_ACCEPTANCE_REQUIRED`、`AUTHENTICATION_REQUIRED` 和 `AUTHENTICATION_TEMPORARILY_UNAVAILABLE`。

Renderer 只按 code/path/retryAfter 分支，不解析 message。服务端对未知账号执行 dummy password hash，对发码请求统一 accepted shape，对 rate-limit key 无论账号存在均创建等价桶；测试比较响应 shape、状态和有界时序分布，但不承诺不现实的逐纳秒恒定时间。

### 11. 邮件 adapter 不拥有认证事实

Core API 在建立 challenge 后调用邮件发送 port；adapter 接收 purpose、目标邮箱、明文 code 和到期时间，只负责模板和投递，不读取数据库、不验证 code、不签发 continuation/session。生产配置从 secret store 注入并强制 STARTTLS 或 implicit TLS；普通自动测试使用 fake/capture adapter。显式 `local` profile 则只允许向 loopback Mailpit 发送明文 SMTP，以便在本机通过真实 SMTP 协议和邮件接收 UI 调试，不得在其他 profile 或远端 host 上启用。日志只记录 correlation、模板类别、provider message identifier 的安全形式、结果和耗时，不记录邮箱、code 或正文。

若投递在同步确认前失败，Core API 使对应 challenge 不可用并返回统一暂不可用；若第三方接收后结果未知，challenge 保持服务端有效但响应仍不得泄露账户存在，用户可在冷却后重发。详细 bounce/投诉和邮件信誉治理留给后续运维能力，不改变认证成功条件。

### 12. 认证与 onboarding 通过最小交接契约衔接

登录或注册响应携带 `CurrentUserView`：

```json
{
  "userId": "opaque-id",
  "displayName": "string",
  "email": "verified@example.com",
  "avatarUrl": null
}
```

它不包含密码状态、EmailIdentityId、OTP、token、session id、内部角色或 Workspace 权限。Main 安全保存 session 后把该 view 交给 Renderer；Renderer 进入 Workspace onboarding boundary。认证模块不调用 Workspace API，也不创建 Personal/Organization Workspace；session coordinator 完成交接后，由同一 Change 中独立的 `workspace-onboarding` capability 发起 Workspace 查询。两者共享 Main cloud boundary 和 session 生命周期，但保持行为所有权分离，并且都不启动 Runtime。

### 13. Runtime OpenAPI 是横切能力，不是第二套行为 Spec

`desktop-api-documentation` 只定义 runtime OpenAPI/Swagger 的生成、环境暴露和 secret hygiene；认证 endpoint 行为以 `desktop-authentication` 为 owner，Workspace endpoint 行为以 `workspace-onboarding` 为 owner，Project list endpoint 行为以 `project-list` 为 owner。Local/Test 默认启用，Production 默认关闭；Swagger `persistAuthorization=false`，示例不得包含真实邮箱、密码、OTP、token 或 continuation。Contract tests 保证 Controller、schema、安全声明和稳定错误不漂移。

### 14. 测试按风险归属分层

- pure unit：邮箱规范化、密码策略、Argon2 参数升级判断、OTP purpose/expiry/attempt、错误归一、session rotation 状态机；
- Core API module/API：真实 Spring Security filter、HTTP schema、匿名/受保护 endpoint、Problem Details、限流、mail port 编排；
- PostgreSQL Testcontainers：邮箱唯一性、challenge/continuation 单次并发消费、注册事务、密码重置与 session 撤销、refresh rotation/reuse；
- Main/Preload：capability allowlist、fixed origin、flow handle、secret redaction、session generation、credential 和 refresh/logout race；
- Renderer Cypress：四条流程、状态、错误、焦点、键盘、a11y、offline/reduced-motion；
- packaged/native：当前执行平台自动验证 OS credential、重启恢复、登出清理和打包应用关键路径；共享 Main/Renderer contract 保持跨平台，Windows/macOS 安装、系统凭据集成与最终视觉观感分别作为对应平台发布前 smoke；
- Workspace unit/API/PostgreSQL：名称 policy、可信 actor、列表上下文 `canCreateWorkspace`、Workspace/Membership/幂等结果原子性、幂等和并发；
- Workspace Main/Renderer：窄 capability、创建结果未知重试、活动 `WorkspaceId`、查询隔离、迟到响应和无 Workspace 分支；
- Project unit/API/PostgreSQL：Workspace + Project Membership 双重授权、父 Workspace 一致性、稳定排序/cursor、404 防枚举和跨 Workspace 数据排除；
- Project Main/Renderer：窄 `listProjects` capability、environment/User/Workspace query scope、分页、loading/empty/error、Workspace 切换迟到响应和 item scope mismatch；
- end-to-end：Desktop → Main/Preload → 真实 Core API → PostgreSQL + fake mail adapter，完成认证、Workspace onboarding 和真实 Project list，全程不经过 Agent Runtime。

本 Change 交付可重复的本地开发栈：Docker Compose 启动真实 PostgreSQL 与 Mailpit，Core API `local` profile 从被 Git 忽略的本地环境文件读取数据库密码和密码学材料、自动执行 Flyway，并通过 loopback SMTP 向 Mailpit 投递；未打包 Desktop 固定连接本地 Core API。根级命令负责生成仅限本机的随机配置、启动/停止基础设施、启动 Core API + Desktop，以及执行三类邮件流程 smoke。该 smoke 必须从 Mailpit API 读取实际邮件并完成注册、登录 OTP 和 password reset，不能退回 capture adapter 或人工截图。

真实外部邮件 provider、发件域名、供应商账号、TLS 链路和公网投递只做部署/发布环境 smoke，不成为本 Change 或普通 CI 的阻塞依赖；没有对应证据时不得宣称邮件部署 release-ready。

### 15. 以单一 Workspace 模型承载组织型和未来 Personal 类型

`Workspace` 保留稳定 `WorkspaceId` 和类型判别值，首期创建用例只产生 `ORGANIZATION`。Project、Board 及后续 Workspace 下层资源只引用 `WorkspaceId`；Membership 和授权也只围绕 Workspace 建模。类型可以作为规范化展示数据返回，但不是客户端权限判断输入。

选择这一方案是因为组织型与 Personal 的差异首先是配置和能力策略，而不是下层资源所有权差异。这样未来开放 `PERSONAL` 时，只需增加服务端配置策略和入口，不需要迁移 Project/Board 所有权或复制授权链路。

**备选方案：** 新增 `Organization` 实体并让 Project 同时保存 `organizationId`。该方案会产生双重租户边界、容易导致授权分叉，且当前没有独立组织生命周期、计费或法务边界来证明其必要性，因此拒绝。

### 16. Access 与 Project Work 保持业务所有权边界

Core API Access capability 负责：解析可信 actor、判断是否允许创建 Workspace、校验输入、固定 `ORGANIZATION` 类型、原子创建 Workspace 与初始 Workspace Membership、计算列表上下文的 `canCreateWorkspace` / `createWorkspaceReasonCode`，并提供按 `UserId + WorkspaceId` 判断有效 Workspace Membership 的窄同步授权事实。创建成功后，创建者通过 Membership 立即出现在权威 Workspace 列表中；后续操作仍由 Core API 按 Membership 做服务端授权。本 Change 不定义 item-level Workspace 管理 capability，也不要求将内部角色表示映射到未冻结的 DTO 字段。

Project Work capability 拥有 Project、Project Membership、Project list query 和 Project 级授权。它消费 Access 的可信 Workspace Membership 结果，然后在自己的数据边界内只返回同一 Workspace 中当前 User 具有有效 Project Membership 的 Project。Access 不拥有 Project 表或列表 DTO，Project Work 不读取 Access 私表，也不把全局唯一 `ProjectId` 当作绕过父 Workspace scope 的依据。

当前由 Core API Resource Server 直接验证 Desktop bearer token，并在应用用例中完成最终授权；部署入口只施加 TLS、请求大小/频率等基础网络策略，不能通过普通 header 产生 principal。未来 Gateway 若被独立 Change 引入，只能执行技术边缘策略，不得创建 Membership、读取 Project 数据或替 Core API 做最终授权。

**备选方案：** 把 Project list 放进 Access。该方案会让身份/Workspace owner 侵入 Project 业务数据，弱化现有 capability 边界，因此拒绝。

**测试接缝：** Access 用例以窄接口提供可信 Workspace 授权事实；Project Work 的查询测试覆盖 Project Membership 过滤和父 Workspace 对齐；模块/架构测试禁止跨 capability 私表访问。真实事务、约束和跨 Workspace fixtures 由 PostgreSQL 集成测试验证。本 Change 不创建 Gateway 测试。

### 17. 创建请求采用窄输入和严格传输契约

Renderer 调用 Preload 创建 capability 时只传入：

- `name`：用户输入的 Workspace 显示名；
- `creationRequestId`：Renderer 为一次用户意图生成、在结果未知时保持不变的不可预测标识。

Main cloud client 将 `creationRequestId` 映射为 Desktop API 的 `Idempotency-Key` 请求头；HTTP request body 只包含 `name`。请求不包含 `type`、角色、capability、成员标识或 actor 标识。创建接口对此 request body 使用严格 schema；出现 `type` 等未知/禁止字段时返回输入契约错误，防止 mass assignment。身份只来自 Core API 对受信 bearer token 验证后构造的可信 principal；普通请求 header 和部署入口网络位置不构成身份。

服务端对 Workspace 显示名执行一致的最小规范：裁剪首尾空白后必须包含 1–80 个 Unicode code point，且不得包含控制字符；服务端保存并返回裁剪后的名称。不同 Workspace 可以同名，名称不参与身份、幂等定界或数据库唯一约束。

Workspace 列表固定为 bearer-protected `GET /desktop/v1/workspaces`，成功返回 `200 { items, capabilities }`；列表上下文的 `capabilities.canCreateWorkspace` 为必需布尔值，可附安全 reason code。创建固定为 bearer-protected `POST /desktop/v1/workspaces`，body 仅 `{ name }`，`creationRequestId` 映射到 `Idempotency-Key`；首次成功返回 `201`，已完成的确定性重放可返回 `200`，Main 接受二者并获得同一个已创建 Workspace 的 `{ workspaceId, name, type }` representation。

Workspace item 表示在本 Change 中固定且仅含稳定 `workspaceId`、`name` 和 `type`；本 Change 唯一冻结的 Workspace capability 是列表上下文的 `canCreateWorkspace`，可附 `createWorkspaceReasonCode`。它不得暴露持久化实体，也不得要求 Desktop 读取内部角色名。本 Change 没有 item-level mutation，因此不加入含义不明的 item capability。Project list DTO 不返回 capability；本 Change 不定义、传输或消费 `canCreateProject`。稳定错误固定为 `AUTHENTICATION_REQUIRED`、`WORKSPACE_CREATION_NOT_ALLOWED`、`VALIDATION_FAILED`、`IDEMPOTENCY_IN_PROGRESS`、`IDEMPOTENCY_KEY_REUSED` 和 `WORKSPACE_TEMPORARILY_UNAVAILABLE`，按契约映射 `401/403/400/409/503`，适用时携带 `retryAfterSeconds`。运行时 OpenAPI 固化这些字段；Desktop Main 维护仅覆盖当前消费面的窄 transport types。

**备选方案：** 让客户端提交 `type=ORGANIZATION`。这会把首期产品政策泄漏为可篡改输入，并使旧客户端可能提前请求 `PERSONAL`，因此拒绝。

**备选方案：** 只返回 Membership role，由 Renderer 映射按钮。内部角色演进会成为客户端破坏性变更，也可能造成越权式 UI 推断，因此拒绝。

**测试接缝：** Desktop API contract 测试固定请求允许字段、Workspace stable ID/type、capability 和 Problem Details-compatible error category；增加“提交 `PERSONAL`/未知字段被拒绝”的负向测试。Core API 运行时 OpenAPI contract 与 Main adapter fixtures 共同检测形状漂移；本阶段不生成客户端，也不建立 generation、compatibility 或 generated-drift gate。

### 18. Workspace、初始 Membership 和幂等结果在一个数据库成功边界内提交

一次创建用例在一个 Core API 数据库事务中写入 Workspace、创建者初始 Membership，以及完成幂等重放所需的结果关联。创建成功后，创建者能立即在权威 Workspace 列表中看到并选择该 Workspace；后续操作由 Core API 依据 Membership 执行服务端授权。本 Change 不定义内部角色的外部表示或 item-level Workspace capability。Project 可见性仍要求独立的有效 Project Membership；创建 Workspace 不自动创建 Project 或 Project Membership。任何一步失败都回滚整个事务。

幂等键至少按“可信 actor + Workspace 创建操作 + `Idempotency-Key`”定界，并由数据库唯一约束收口。`creationRequestId` 只是同一标识在 Renderer/Preload capability 中的名称，不是第二套幂等键：

- 相同 key 和相同规范化输入在完成后返回同一 `WorkspaceId`；
- 相同 key 携带不同规范化输入返回稳定的幂等冲突，不复用旧结果也不创建新 Workspace；
- 同 key 并发时至多有一个事务创建 Workspace/Membership，其他请求读取已提交结果，或得到可安全以同 key 重试的暂态结果；
- 不同 key 可以创建同名 Workspace，因为名称不是身份或本变更定义的唯一键。

幂等记录不得把失败校验或失败授权永久缓存成成功结果。具体等待、冲突重读或短暂进行中策略在 apply 时依据既有数据库访问方式选择，但必须保持上述外部语义。

**备选方案：** 仅在 Desktop 提交期间禁用按钮。它无法覆盖超时重试、多窗口、进程重启或并发请求，因此只能作为 UX 防抖，不能替代服务端幂等。

**备选方案：** 先创建 Workspace，再异步创建 Membership。该方案会暴露无可管理成员的 Workspace，并使补偿与授权恢复复杂化，因此拒绝。

**测试接缝：** 纯输入/策略分支在应用层测试；rollback、唯一约束、同 key 并发、不同 payload 冲突和重放结果在真实 PostgreSQL 集成层测试。不得用仅 mock repository 的测试声称事务正确。

### 19. Project Work 提供最小只读模型和冻结列表契约

本 Change 在 Project Work capability 中增加支持真实列表所需的最小持久事实：`Project(ProjectId, WorkspaceId, name, ...)` 与 `ProjectMembership(ProjectId, WorkspaceId, UserId, active, ...)`。具体物理列和索引在 apply 时结合当前 persistence style 冻结，但数据库与应用层必须保证 Project Membership 的 User、Project 与 Workspace 对齐；跨 Workspace 关系必须被约束拒绝，或在读取时排除并产生脱敏完整性信号。该最小模型只服务 read path，不新增 Project create application use case 或 HTTP endpoint。集成测试通过受控 PostgreSQL fixture/migration helper 建立 Project 数据，而不是为测试偷建产品创建 API。

Desktop contract 固定为 bearer-protected `GET /desktop/v1/workspaces/{workspaceId}/projects`，仅接受可选 opaque `cursor` 与整数 `limit`（默认 50，范围 1–100）。成功为 `200 { items: [{ projectId, workspaceId, name }], nextCursor? }`；每个 item 恰好包含这三个字段，`nextCursor` 只在有下一页时出现。客户端不得解析 cursor、按名称重建排序或跨 Workspace 复用 cursor。item 重复返回 `workspaceId`，使 Main/Renderer 能拒绝迟到响应或 scope mismatch。

错误固定为：非法/未知 query 返回 `400 VALIDATION_FAILED`，无有效 bearer 返回 `401 AUTHENTICATION_REQUIRED`，Workspace 不存在与无访问权统一返回 `404 WORKSPACE_NOT_FOUND`，安全读取暂不可用返回 `503 PROJECTS_TEMPORARILY_UNAVAILABLE` 并可携 `retryAfterSeconds`。Project list 不返回 capability，不存在 `canCreateProject`。

**测试接缝：** query/application tests 覆盖 Workspace Membership 前置与 Project Membership 子集；PostgreSQL tests 覆盖跨 Workspace 约束、稳定分页和 controlled fixtures；API/OpenAPI tests 固定 path/query/schema/errors；Main adapter tests 固定 allowlist、cursor opaque 和 item scope validation。

### 20. Desktop 通过 Main-owned cloud client 和窄 Preload capability 完成 onboarding

Renderer 不直接调用 Core API 或未来 Gateway，也不持有凭据。Main 的 typed cloud client 经部署 Edge/TLS 调用 Core API Desktop API；Preload 暴露与用户意图对齐的窄 capability，例如“列出可访问 Workspace”和“创建 Workspace”，而不是通用 HTTP 或通用 IPC。Main/IPC 边界验证发送方、生命周期和 schema；Core API 再做最终授权。

Renderer 将 Workspace 列表、列表上下文的 `canCreateWorkspace`、创建 mutation 和活动 `WorkspaceId` 组织在 Workspace 模块中。创建或选择成功后按以下顺序处理：

1. 将返回项写入或失效 Workspace 列表查询；
2. 把活动上下文设置为返回的稳定 `WorkspaceId`；
3. 取消或隔离旧 Workspace 的在途请求；
4. 以至少包含 environment、`UserId`、`WorkspaceId` 的 query key 调用窄 `listProjects` capability；
5. 进入真实 Project list surface，呈现 loading、有数据、真实空状态、分页或可恢复错误；始终不展示 Project 创建 CTA。

启动恢复顺序固定为：Main 确定 environment → 读取该 environment 的 current-account pointer → 从对应 OS credential namespace 读取 refresh token 与 pending `refreshRequestId` → refresh/recover → 安全保存新 credential → `GET /desktop/v1/me` → `GET /desktop/v1/workspaces` → 按 environment + `UserId` 读取并验证最近 `WorkspaceId` → `GET /desktop/v1/workspaces/{workspaceId}/projects`。列表为零时进入 Organization onboarding；只有一个时自动进入；多个时优先恢复仍可访问的最近项，否则显示选择器。活动 Workspace 不以名称定位；已撤销授权、登出、换账号或换 environment 时清理旧 ID 和对应缓存，绝不展示跨账号/环境的旧数据。

已知离线时，创建按钮不可提交并解释原因。网络失败或响应结果未知时保留表单输入和原 `creationRequestId`；只有用户修改为新的创建意图、明确取消后重开或收到确定的业务拒绝后，才生成新标识。UI 可防止同一窗口重复点击，但不承担幂等正确性。

**备选方案：** Renderer 直接使用 HTTP client。它会把凭据和认证逻辑暴露到不可信 Renderer 并绕过既有 Desktop trust boundary，因此拒绝。

**测试接缝：** Renderer 在 Preload capability adapter 处使用确定性 fake，测试有/无 Workspace、能力显示、创建成功切换、Project loading/empty/error/pagination、旧作用域隔离、item scope mismatch、输入/权限/冲突/网络失败、离线与重试。Main/Preload contract 测试验证 schema、错误归一化和凭据不进入 Renderer。端到端仅保留跨进程与打包后才能发现的关键路径，不在每层复制业务矩阵。

### 21. 错误以稳定类别跨边界传递，文案留在客户端

Core API 使用既有 Problem Details-compatible 模式返回稳定、可机器判断的类别，至少区分：未认证、无能力/策略拒绝、输入无效、幂等或其他冲突、可重试暂态失败。错误可携带允许展示的字段问题或不可用原因，但不得泄露内部角色、表名、约束名或堆栈。

Main cloud client 将传输失败、认证失效和业务 Problem 映射为 serializable 的 Desktop error union；Renderer 根据类别保留或重置表单、聚焦首个错误字段、提供重试或引导重新登录。Renderer 不解析任意服务端 message 来决定控制流。

**备选方案：** 仅显示 HTTP status/message。该方案无法稳定区分安全重试、修正输入和重新认证，也会让文案或基础设施细节成为客户端逻辑，因此拒绝。

### 22. 视觉流程扩展现有 Desktop 方向，不另起一套应用壳

apply 时在已批准的 Desktop 视觉方向中补齐 Workspace switcher 展开态、无 Workspace onboarding、创建表单、提交/错误/离线状态，以及建立活动 Workspace 后的 Project list loading/empty/error/pagination surface。本 Change 增加只读 Project list surface；Project 创建/详情/编辑/删除、成员管理与 Project-scoped navigation 留给后续 Change。表单作为当前任务上下文中的聚焦流程呈现，不新增独立“组织管理后台”。中文和英文文案都使用 Workspace 产品词汇；内部 `ORGANIZATION`/`PERSONAL` 枚举不作为选择项。

创建或实质调整该体验时，按 Desktop `AGENTS.md` 依次使用 `frontend-design`、`vercel-react-best-practices` 和最终 `web-design-guidelines`。键盘、焦点恢复、最小窗口、reduced motion、错误摘要和侧栏/对话框关闭恢复属于实现验收，而非视觉润色。

### 23. Onboarding 与 Agent Runtime 完全解耦

Workspace 的查询、创建、选择以及随后的只读 Project list surface 只经过 Desktop cloud boundary；认证、onboarding 和 Project list 的 Main/Preload/Renderer 路径都不启动、不探测也不等待 Agent Runtime。Runtime 健康状态不得加入 Workspace/Project query key、route guard 或 capability。Runtime 缺失只影响未来 `LOCAL_DESKTOP` Agent 能力。

**测试接缝：** Desktop 测试环境不提供 Runtime mock 也必须完成 onboarding；若 Main 初始化中存在 Runtime supervisor，则以“不启动 Runtime”的断言保护该边界。

## Risks / Trade-offs

- **[自建认证扩大安全责任]** → 只实现邮箱密码/OTP 的窄范围，采用 Argon2id、共享限流、一次性 proof、opaque 可撤销 session、secret-safe logging 和独立安全 review；不顺手扩展 SSO/MFA。
- **[账号枚举]** → 发码统一 accepted、密码 dummy hash、统一错误/shape、存在与不存在账号共享限流逻辑；只有证明邮箱 possession 后才允许提示已注册。
- **[OTP 暴力破解或跨 purpose 重放]** → CSPRNG、短 TTL、最大尝试、purpose/subject 绑定、摘要存储、原子单次消费和多维限流。
- **[数据库竞态产生重复账户或双重 session]** → unique normalized email、短事务、原子 consume/update 和 Testcontainers barrier tests。
- **[refresh 成功但响应丢失被误判为重放]** → pending `refreshRequestId` 先持久化、服务端短期加密恢复结果、同 request id 确定性重放；不同 request id 或窗口外才 family revoke。
- **[401 风暴或 logout 后复活]** → per-generation single-flight、业务请求最多重试一次、generation-first logout 和迟到结果 guard；暂态失败不误删 credential，终止失败清空全部受保护状态。
- **[OS credential adapter mock 通过但平台失败]** → macOS/Windows 分别运行 native packaged lifecycle；不可用时不做明文降级。
- **[邮件 provider 不稳定]** → port/adapter 隔离、短 timeout、统一暂不可用、可替换 provider 和隔离 smoke；认证事实仍由 Core API 持有。
- **[未来 IdP 接入导致身份迁移]** → UserId 与 credential/identity 分离，后续显式 binding；不预建未经使用的 OIDC 复杂度，也不按 email 自动合并。
- **[认证与 onboarding 边界重叠]** → auth 只产出 session + `CurrentUserView`；`workspace-onboarding` 只消费 authenticated session 并拥有 Workspace 行为；共享技术设施不合并行为 owner。
- **[Capability 字段随功能增长而膨胀]** → 只暴露稳定的用户操作能力，不返回通用 ACL 或让客户端组合角色；首期由运行时 OpenAPI contract test 与 Main adapter tests 发现形状漂移，生成客户端和跨版本 compatibility gate 留给后续独立 Change。
- **[同 key 并发实现错误导致重复 Workspace]** → 以数据库唯一约束而非进程内锁收口，并用真实 PostgreSQL 并发测试和事务 rollback 测试验证。
- **[网络超时后用户误开新意图造成语义重复]** → Desktop 在结果未知时保留原 key 和输入，恢复后先重放/刷新列表；UI 明确“正在确认”或“重试”，不暗中生成新 key。
- **[缓存中的旧 Workspace 数据污染新上下文]** → Project query key 至少包含 environment、`UserId` 和 `WorkspaceId`，切换时取消或隔离旧请求；Renderer adapter 测试覆盖迟到响应和 item `workspaceId` mismatch。
- **[Project 越权或跨 Workspace 关联泄漏]** → Workspace Membership 是前置、Project Membership 是结果过滤条件；父 Workspace 一致性由数据库约束、查询 predicate、API 404 防枚举和负向 PostgreSQL fixtures 共同验证。
- **[Cursor 被解析或跨 Workspace 复用]** → cursor 由服务端拥有并保持 opaque；Main 只允许同一 Workspace 原样回传，切换 scope 时丢弃 cursor 与在途页面。
- **[服务端 capability 与提交时授权发生竞态]** → capability 只用于展示，所有 mutation 在 Core API 重新授权；负向应用/API 测试覆盖 capability 过期后的拒绝。
- **[未知字段严格拒绝与通用 JSON 配置不一致]** → 在 Desktop API schema/adapter 边界实施并做 contract 测试，不依赖全局反序列化默认值。
- **[Personal 兼容被过度实现]** → 只保留类型、稳定 ID、统一 ownership 和 capability 契约；不建立 Personal factory、路由或 UI。仅用 Desktop Main transport fixture 证明未知于首期业务路径的 `PERSONAL` type 值不会破坏读取解析；Core API 不创建、不自动配置，也不需要为测试伪造可访问的 Personal Workspace。
- **[并行 Core API foundation 改变实际落点]** → apply 第一项重新读取当前代码、测试和已归档 Change；若数据库/API 基线与本设计冲突，先更新 planning，不覆盖并行工作。
- **[文档 Target 与代码 Current 被混淆]** → 先修正 owning Target 文档，再实施；README/状态只在可执行证据存在后描述 Current。文档本身不适用 TDD，以链接、OpenSpec strict validation 和 Mermaid renderer（如图有变化）验证。

## Migration Plan

1. **基线核对：** apply 开始时检查当前 Core API/Desktop 代码、migration、API、测试门禁和并行工作状态；若已有 Personal 数据或与本设计冲突的生产契约，先更新本 Change，不静默覆盖。
2. **Target 对齐：** 一次性更新 business model、root/Core API/Desktop architecture、responsibilities、testing strategy、design foundation 和 documentation map，清除旧 Provider OIDC 主方案与首期自动 Personal 规则。
3. **认证服务端：** 以失败测试建立 User/EmailIdentity/PasswordCredential、challenge/continuation/session、Argon2id、限流、mail port、注册/登录/重置/current-user HTTP 与 runtime OpenAPI。
4. **Desktop 认证：** 初始化或复用 Desktop foundation，实现 Main auth client、OS credential/session coordinator、typed Preload 和四条 Renderer 认证流程。
5. **Workspace 服务端：** 以失败测试建立统一 Workspace/Membership、窄 list/create contract、列表上下文 `canCreateWorkspace`、Workspace/Membership/幂等结果原子事务和持久幂等，不引入 item-level Workspace capability、`Organization` 或 `organizationId`。
6. **Project 只读服务端：** 在 Project Work capability 中建立最小 Project/Project Membership 持久事实、Workspace-scoped list query、双重 Membership 授权、分页、Desktop HTTP 与 runtime OpenAPI；测试数据通过受控数据库 fixture 建立，不增加 Project create API。
7. **Desktop onboarding 与列表：** 在同一 session/cloud boundary 上实现 Workspace entry/switcher/create、启动恢复、活动 `WorkspaceId`、`listProjects` Main/Preload capability 和 Project list loading/empty/error/pagination surface；不展示 Project 创建入口，不启动 Runtime。
8. **完整链路验证：** 使用真实 Main/Preload、真实 Core API/PostgreSQL 和 fake mail adapter 完成注册/登录 → current user → Workspace list → create/select → Workspace Membership → 建立活动 Workspace → 真实 Project list，并运行 security、并发、OpenAPI、refresh recovery、双重授权和 scope checks。
9. **打包与发布：** 本 Change 以 portable automated checks 和当前执行平台的 packaged/native 自动化收口；发布某一 Desktop 平台前，再在该原生平台验证安装、系统 credential、签名/公证或签名安装包以及最终视觉 smoke。先部署向后兼容 Core API schema/API，再发布 Desktop。
10. **回滚：** Desktop 可回滚并清理本机 credential；Core API 可关闭新入口但保留已创建 User、credential、session、Workspace、Membership、Project 与 Project Membership 数据，不做破坏性 schema 回滚。

当前仓库证据未证明已有 Personal Workspace 生产数据。若 apply 基线发现该假设不成立，数据迁移、兼容窗口和回滚方案属于 material scope change，必须先更新本 Change 的全部 planning artifacts。
