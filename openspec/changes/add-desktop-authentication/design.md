# Design

## Context

参见 [`proposal.md`](proposal.md) 的动机，以及 [`desktop-authentication`](specs/desktop-authentication/spec.md) 和 [`desktop-api-documentation`](specs/desktop-api-documentation/spec.md) 的行为契约。

当前 Core API foundation 已有 Spring Security fail-closed、`access` Modulith 能力、PostgreSQL/Testcontainers 测试层和独立 Desktop API surface 规则，但没有 User 持久化、JWT resource server 或真实 HTTP 业务接口。Desktop 仍只有 Target 文档；Gateway 也是尚未初始化的 Target 服务。另一个活动 Change 正在规划 Organization-first Workspace onboarding，并明确从“已认证用户”开始。

首期产品决定使用邮箱验证码降低登录注册门槛，但由身份提供方托管 Email OTP，而不是由 TaskPilot 自建验证码系统。当前只有一个 Desktop 客户端和一个 Core API，尚无多后端、多外部 API surface 或集中流量治理需求，因此本 Change 不为认证单独初始化 Gateway；Core API 直接承担 Resource Server 边界。实现开始时仍须重新检查 Desktop 是否已被并行 Change 初始化，不能覆盖并行工作。

## Goals / Non-Goals

**Goals:**

- 用身份提供方托管的 Passwordless Email OTP 和标准 OIDC Authorization Code + PKCE 建立统一登录注册入口。
- 在 Main、Core API 和 PostgreSQL 之间保持可解释、可重复验证的信任链。
- 以稳定 `UserId` 隔离外部身份，以显式 session bootstrap 为 Workspace onboarding 提供前置状态。
- 用最低可靠测试层覆盖回调伪造、token 失败、并发首次登录、凭据恢复/清理和文档暴露。
- 提供 Local/Test 可视化 Desktop API 文档而不扩大 Production 默认攻击面。

**Non-Goals:**

- 不自建密码或 Email OTP 的生成、发送、频控、校验和邮件投递系统。
- 不实现邮箱变更、MFA、企业 SSO、社交登录、账号绑定/合并或用户管理后台。
- 不实现 Workspace 查询/创建/选择或 Project 行为，不创建 Personal Workspace，不修改 Agent Runtime。
- 不初始化 Gateway，不把网络位置或普通身份 header 作为 Core API 的信任依据。
- 不在本 Change 建立 public API、版本化 OpenAPI 文件、生成客户端或 breaking-change gate。
- 不承诺任意 OIDC Provider 零配置兼容；首期只配置一个符合约束的 issuer 和托管 Email OTP connection，但代码与领域模型不使用供应商命名。

## Decisions

### 1. 身份提供方拥有 Email OTP，TaskPilot 使用单一浏览器入口

Desktop 使用 OIDC discovery、Authorization Code + PKCE（S256）和系统默认浏览器。首期配置一个 issuer、Desktop public client ID、允许的 audience/scopes、loopback redirect 和托管 Passwordless Email OTP connection；Desktop 不持有 client secret。

TaskPilot 登录页只提供“使用邮箱继续”的主动作。邮箱输入、验证码发送、重发冷却、错误次数、过期、校验以及首次 Provider 账号创建都发生在身份提供方页面。已有身份完成登录，新邮箱首次验证后由 Provider 创建身份并完成相同授权流程；TaskPilot 不通过“邮箱是否已注册”等差异暴露账号存在性。除非目标 Provider 对批准参数有明确支持，Desktop 不设计第二套注册 endpoint 或依赖非标准 signup hint。

相比自建邮箱密码或验证码，此方案避免 TaskPilot 直接承担密码哈希、OTP 存储/消费、防刷、邮件信誉、恢复和 Token 签发。相比内嵌 WebView，系统浏览器保留清晰 origin；相比 Device Authorization Grant，loopback 回调交互更直接。未来受管设备无法使用 loopback时，再以独立 Change 评估 device flow 或自定义 URI scheme。

### 2. Main 使用一次性授权尝试与注册兼容的 loopback redirect

每次登录由 Main 创建内存态 `AuthAttempt`：随机 attempt ID、`state`、`nonce`、PKCE verifier/challenge、创建/过期时间、预期 issuer/client/redirect 和状态。Main 在打开浏览器前只绑定数值 loopback host `127.0.0.1` 或 `[::1]`，由操作系统分配临时端口，并使用 Provider 批准或注册的固定 callback path。随机 path 不是安全前提；若目标 Provider 不支持 RFC 8252 风格动态 loopback 端口，apply 必须停止并修订方案，而不是静默改用弱回调。

只允许一个活动尝试，重复点击聚焦当前等待状态而不是并发打开浏览器。状态机为：

```text
Idle -> AwaitingBrowser -> ExchangingCode -> Authenticated
                  |               |
                  +-> Cancelled   +-> Failed
                  +-> Expired     +-> Failed
```

Main 在 callback 阶段先验证 request method、绑定 host/port/path、参数形状、一次性 `state` 和 TTL，再消费 attempt 并交换 code；`nonce` 不从 callback query 获取，而是在 token validation 阶段与 ID Token claim 比较。Main 同时校验 ID Token 签名、精确 issuer、audience、适用的 `azp`、允许算法和时间约束。任何失败都销毁 verifier/code/nonce。回调 HTTP 响应只显示固定的“可返回 TaskPilot”页面，不回显参数或内部错误。

可注入的随机源、clock、browser opener、loopback listener 和 OIDC client 是 Main integration test seam；生产默认保持真实边界。

### 3. Main 拥有 token 与凭据生命周期，Renderer 只看到会话视图

Main 的 cloud client 是唯一可添加 bearer token、刷新和登出的 Desktop 组件。内存中只保留当前会话所需 token；跨重启保存的 refresh token及 Provider 明确要求的最小 metadata 通过平台 credential adapter 写入 OS credential facility。credential key 至少按 issuer、client ID 和本地 account handle 分区，值不出现在配置、命令行、URL、日志、遥测或崩溃字段中。

Preload 只暴露 `beginAuthentication`、`cancelAuthentication`、`getSessionView`、`subscribeSessionView`、`logout`；返回值为 `signed-out | awaiting-browser | authenticated | reauthentication-required | temporarily-unavailable` 及安全用户视图，不返回 OTP、token、code、verifier 或 Provider SDK object。IPC 校验 sender frame、origin、schema 和允许状态转换。

如果 OS credential facility 不可用，生产实现 fail closed，不回退到普通文件；允许当前进程维持受限内存会话或要求重新登录。具体平台 adapter 在 apply 时依据实际 Desktop toolchain 选取稳定版本。

### 4. Core API 是当前唯一应用层 Resource Server

首期 Desktop API 使用 issuer 签发的短期 JWT access token。Core API resource server 校验受信配置中的精确 issuer、JWKS、允许算法、签名、audience、时间约束和稳定 subject，并在 adapter 层构造只包含 issuer、subject 和批准 profile claims 的 `AuthenticatedExternalPrincipal`。`none`、非配置算法、不匹配 key、缺少必要 claim 或无法验证的 token 全部 fail closed。

部署入口只负责 TLS、基础请求大小/速率限制、网络暴露和可观测性，不产生可信业务身份。Core API 不接受 email、display name、role、Workspace header 或网络位置作为身份依据。JWT decoder、claim validator 与 clock 可替换为测试实现；security integration 使用测试私钥签发的真实 JWT，不 mock filter chain。

当前不初始化 Gateway，是因为尚无足以证明独立服务成本的多 surface 或多后端需求。未来 Gateway 落地时可以做边缘 token 验证、header sanitization 和 route policy，但 Core API 仍须独立验证 bearer token；若改用内部断言，必须通过独立 Change 设计签名、audience、TTL、服务身份和防重放，不能信任普通 header。

### 5. User 与 External Identity 分离，并显式 bootstrap

Access 模块增加两个持久概念：

```text
User
- user_id: opaque stable identity
- display_name/email/avatar_url: nullable approved profile projection
- created_at/updated_at

ExternalIdentity
- external_identity_id
- user_id -> User
- issuer
- subject
- created_at/last_seen_at
- unique (issuer, subject)
```

`issuer` 使用通过验证且与受信配置精确匹配的 `iss` 值，`subject` 作为 issuer 内不透明值处理；不得大小写折叠、截断或从 email 推导。表允许未来一个 User 关联多个 ExternalIdentity，但本 Change 没有绑定入口，任何新 `(issuer, subject)` 都创建新的 User。Email 只有在 Provider 声明已验证且符合批准的 claim policy 时才可写入展示投影；资料更新不改变 `UserId` 或 identity ownership。

`POST /desktop/v1/session/bootstrap` 是幂等 command，成功统一返回 `200 OK` 与 `CurrentUserView`，无论本次创建还是已存在。唯一约束与事务性 upsert/冲突恢复保证并发首次调用收敛到同一 User。`GET /desktop/v1/me` 是无副作用 query；映射不存在时返回 `409 USER_BOOTSTRAP_REQUIRED`，不会借读取隐藏写入。

首期 `CurrentUserView` 为：

```json
{
  "userId": "opaque-id",
  "displayName": "nullable string",
  "email": "nullable verified string",
  "avatarUrl": "nullable https URL"
}
```

不返回 issuer、subject、token、Provider roles 或 Workspace 权限。错误使用 `application/problem+json`，至少含标准字段、稳定 `code` 和 correlation identifier：未认证为 `401 AUTHENTICATION_REQUIRED`，映射缺失为 `409 USER_BOOTSTRAP_REQUIRED`，验证材料无法使用为 `503 AUTHENTICATION_TEMPORARILY_UNAVAILABLE`。

### 6. 刷新至多一次重试，登出先失效会话再尽力撤销

Main 在过期前刷新，或在一个请求首次收到可恢复 `401` 时执行 single-flight refresh；同一云端请求最多重试一次。Provider 返回 refresh token rotation 时，credential adapter 先安全写入新值，再原子切换当前引用；失败不得继续无限使用旧 token。`invalid_grant`、重放指示或不可恢复拒绝清理本地凭据并进入 `reauthentication-required`。

登出首先递增 session epoch，使当前 generation 失效，停止新 credentialed 请求与 refresh，并把待撤销凭据从活动会话隔离。然后清空活动内存 token、删除 OS credential、清理 Renderer 认证缓存。Main 仅可在受限内存中保留短生命周期撤销副本，用于限时调用标准 revocation/end-session 能力；成功、失败或超时后都立即销毁。远端失败不回滚本地退出，旧 generation 的迟到请求或 refresh 不得重新写回凭据或恢复 UI。

### 7. 登录 UI 延续现有 Desktop design foundation

登录页采用已批准的 quiet control desk 方向：一个聚焦面板、明确产品身份、单一“使用邮箱继续”动作。等待回调时在同一页面显示进度、取消、过期与重试；离线、Provider unavailable、callback rejected、credential store unavailable 和 reauthentication-required 是可区分状态，但 Provider 的 OTP 失败、过期、频控或账号存在性细节只映射为稳定安全类别，不展示原始错误或敏感参数。

实现时先用 `frontend-design` 将契约映射到完整交互状态，再以 `vercel-react-best-practices` 实现 Renderer，最后用 `web-design-guidelines` 做 UI/UX/accessibility review。Renderer integration 采用 Cypress 验证可见行为和可访问性；它不冒充 Main、credential store 或真实 Electron 打包证据。

### 8. springdoc 只提供运行时 Desktop API 文档

Core API 引入与 Spring Boot 4 兼容的稳定 springdoc starter，通过明确的 `local`/`test` 配置开启 `/v3/api-docs` 和 Swagger UI，Production 默认关闭 endpoints/static resources。只扫描 Desktop API controller/package，并定义 bearer JWT security scheme、`CurrentUserView` 和共享 Problem Details。

Swagger 页面可以手工输入临时 bearer token，但明确禁用 `persistAuthorization`；token 最多保留在当前页面会话内，不进入生成文档、浏览器持久存储、仓库或服务端日志。Swagger 不托管 OIDC client secret，也不代替系统浏览器 Email OTP 登录。

契约测试读取实际应用生成的 OpenAPI JSON，断言路径、方法、operation、schema、security requirement 和稳定错误响应，而不是维护第二份手写 YAML。第一阶段不生成 Desktop TypeScript client；Main cloud client 使用显式窄 adapter。等多个 API surface 需要跨版本发布承诺时，再决定 source-first 或 code-first contract 及 compatibility gate。

### 9. 认证完成只交接 onboarding，不拥有 Workspace 行为

认证纵切结束于 `authenticated session + CurrentUserView`。Renderer auth boundary 将结果交给 Workspace onboarding capability，但本 Change 不实现或调用 Workspace list/create/select API，也不根据 Workspace 数量决定页面。这样避免与 `add-organization-workspace-onboarding` 重复拥有同一行为和测试。

### 10. 测试按风险归属分层，而不是重复覆盖

测试遵循 root、Desktop 和 Core API testing strategy：

- pure unit：PKCE/state/nonce、attempt/session 状态机、claim/profile mapping、错误分类、single-flight refresh 策略；
- Renderer integration（Cypress）：用户可见登录、等待、取消、过期、离线、重试、登出与无 secret 泄漏的 Preload view；
- Main/Preload contract + Main integration：loopback 回调、IPC allowlist、fake OIDC server、credential adapter、refresh/logout race；
- Core API module/API：真实签名 JWT、Resource Server filter、Problem Details、bootstrap/me 契约；
- PostgreSQL integration：migration、唯一约束、并发 bootstrap 和 rollback；
- packaged/native：真实系统浏览器 handoff、回调进入打包应用、macOS/Windows credential store、重启恢复与登出清理；
- OpenAPI contract：Local/Test 文档完整性、授权不持久化与 Production endpoint 不可见。

常规自动化使用可控 fake OIDC/JWKS server 模拟 Email OTP 完成后的标准授权结果；不自动化第三方页面内部实现。真实 Provider 只做隔离测试租户 smoke，避免外部不稳定和真实账号/secret 进入普通 CI。

纯文档、生成文件和无行为配置搬运不适用 TDD；安全策略、状态机、持久化、API、IPC 与 UI 行为均先写失败测试再实现。生成 OpenAPI 的格式细节不追求逐行覆盖，但手写 customizer/security 配置必须纳入覆盖率。

## Risks / Trade-offs

- **[Provider Email OTP 配置形成供应商依赖]** → 领域模型只信任 OIDC `(issuer, subject)`，不使用 Provider 专有身份 ID；常规测试只依赖标准协议 fake，Provider 配置与 smoke 独立。
- **[邮箱枚举、验证码防刷或邮件送达问题]** → Provider 拥有相同外观响应、频控、OTP 生命周期和投递；TaskPilot 不解析原始细节控制账号流程，只显示安全类别。
- **[loopback 端口被抢占或回调伪造]** → 先绑定数值 loopback listener 再打开浏览器，使用注册兼容的 fixed path、state + nonce + PKCE、一次性 attempt 和短 TTL；测试覆盖 host/port/path/state/nonce/重复回调。
- **[Core API 被绕过安全入口]** → Core API 自身是 Resource Server，不信任网络位置或普通身份 header；部署入口不产生 principal。
- **[JWKS/issuer 暂时不可用]** → 只在缓存仍符合验证策略时使用；无法验证时返回明确临时不可用并 fail closed，使用可控 clock/JWKS server 测试轮换与故障。
- **[并发首次登录产生重复 User]** → PostgreSQL `unique(issuer, subject)`、单事务和冲突后读取；使用真实数据库并发测试。
- **[refresh/logout 竞态复活旧会话]** → session epoch 先失效，撤销副本与活动会话隔离；迟到结果不能覆盖新 generation。
- **[OS credential adapter mock 通过但真实平台失败]** → mock 验证编排，macOS/Windows 原生 job 验证写入、重启恢复、删除和不可用行为。
- **[相同 email 错误合并或未验证 email 被信任]** → 唯一键只用 `(issuer, subject)`；未验证 email 不投影；模块与数据库测试覆盖。
- **[Swagger 在生产暴露或持久化 token]** → Production 启动测试断言文档不可达，配置断言 `persistAuthorization=false`，生成文档 secret scan。
- **[认证与 onboarding 重复拥有 Workspace 行为]** → auth 仅交接安全 session/User view；Workspace 请求和状态测试只属于 onboarding Change。
- **[Gateway 推迟后未来迁移成本]** → 保留 Target 路由边界；出现多 surface、多后端或集中策略需求时以独立 foundation Change 初始化，Core API 最终验证不被隐式削弱。

## Migration Plan

1. **基线与 Provider 确认：** 检查当前分支、活动 Change、Desktop 初始化状态和 Core API foundation；锁定测试 issuer 的 discovery、JWT access token、Authorization Code + PKCE S256、nonce、动态 loopback port、注册 path、Email OTP connection、refresh/revocation 支持。能力不满足时先更新 Change。
2. **Target 文档对齐：** 更新实际受影响的 business model、root/Core API/Desktop 文档，并把 Gateway 当前不初始化及未来触发条件写入 owning 架构；若并行 session 修改同一文件，先协调或延后。
3. **Core API 安全与数据：** 以失败测试建立 JWT 验证、ExternalIdentity/User migration、bootstrap/me API 和 Problem Details；部署时先应用向后兼容 schema。
4. **API 文档：** 增加 springdoc 和环境配置，以 contract test 固定 Desktop API 文档、Swagger 授权不持久化与 Production 默认关闭；不生成独立 YAML/client。
5. **Desktop Main/Preload：** 先实现可测试 OIDC attempt、loopback、credential、cloud-client 和窄 IPC，再接 Renderer。Provider/Email OTP 配置通过环境注入。
6. **Renderer：** 按 Desktop Skill 顺序实现“使用邮箱继续”及恢复状态；成功 bootstrap 后只交接 Workspace onboarding boundary，不实现 Workspace 行为。
7. **分层验证：** 先跑子项目 focused checks，再运行受影响 quality gates；在 macOS 与 Windows 分别完成 credential store 和打包回调证据。真实 Provider smoke 使用隔离租户和短期 secret。
8. **发布：** 先部署兼容 Core API，再发布 Desktop。配置缺失或 Provider unavailable 时保持可恢复的 signed-out/temporarily-unavailable，旧客户端不受新增端点影响。
9. **回滚：** Desktop 可回滚并删除本地 credential entry；Core API 可关闭新 endpoint，但保留已创建的 User/ExternalIdentity 表和记录，不做破坏性回滚。若怀疑凭据泄漏，撤销 Provider session/refresh token 并轮换 client 配置。
