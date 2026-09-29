# Proposal

## Why

现有 Workspace onboarding 从“已认证用户”开始，但仓库当前只有 Core API 的 fail-closed Security 基础，没有可执行的 Desktop 登录、账号创建、凭据保管、可信身份映射或当前用户契约。首期用户需要低门槛的邮箱入口，因此应先建立一条由身份提供方托管邮箱验证码、符合原生应用安全实践且可独立测试的认证纵切，使后续 Workspace onboarding 有真实身份前提，同时避免 TaskPilot 自建密码和验证码系统。

## What Changes

- 首期使用身份提供方托管的 Passwordless Email OTP；Desktop 通过系统浏览器发起 OIDC Authorization Code + PKCE，用户在同一 Provider 页面完成邮箱输入、验证码发送/校验以及首次账号创建或既有账号登录。
- TaskPilot 不提供自有登录、注册、验证码发送或验证码校验接口，不存储密码或 OTP；登录与注册在产品入口统一表达为“使用邮箱继续”。
- Electron Main 负责发起授权、接收仅绑定数值 loopback 地址的回调、交换和刷新 token，并将长期凭据保存在操作系统凭据设施；Renderer 和 Agent Runtime 不得接触 OTP、authorization code、PKCE verifier 或 token。
- 当前阶段由 Core API 作为唯一应用层 Resource Server，直接验证短期 bearer access token，并只从已验证的 `(issuer, subject)` 建立可信 principal；部署入口只负责 TLS、基础网络保护和请求限制。本 Change 不初始化独立 Gateway。
- Core API `access` 能力以 `(issuer, subject)` 幂等建立或解析稳定的 TaskPilot `UserId`，并提供受保护的 Desktop 当前用户 bootstrap/read API；只有符合批准验证策略的 email 才可作为展示投影，email、显示名和头像不得成为身份键。
- 登出先使本地 session generation 失效并隔离凭据，再清理本机状态且尽力调用提供方撤销能力；无论远端撤销是否可用，本机都必须立即退出且不得继续自动刷新。
- 为首个真实 Desktop API 引入运行时 OpenAPI 与 Swagger UI：Local/Test 默认可见，Production 默认关闭；暂不引入版本化 OpenAPI 文件、客户端生成或 breaking-change gate。
- 认证成功与 User bootstrap 完成后只交接到 `add-organization-workspace-onboarding` 所拥有的 Workspace 流程；本 Change 不查询、选择或创建 Workspace。
- **非目标**：TaskPilot 自建邮箱密码、OTP 生成/发送/校验、验证码频控与邮件投递体系、邮箱变更、MFA、企业 SSO、社交登录、账号合并/绑定、管理员用户管理、Agent Runtime 执行授权、Gateway 初始化、Public API 认证、版本化 OpenAPI contract 或 SDK 生成。

## Capabilities

### New Capabilities

- `desktop-authentication`: 定义 Desktop 的系统浏览器 OIDC + PKCE 与托管 Email OTP 流程、凭据边界、Core API 可信身份映射、内部 User bootstrap、当前用户读取、刷新与登出语义。
- `desktop-api-documentation`: 定义 Desktop API 运行时 OpenAPI 与 Swagger UI 的环境暴露、安全边界和最小可验证能力。

### Modified Capabilities

无。现有 `core-api-foundation` 的工程与测试门禁保持不变；本 Change 在其扩展点上增加真实认证行为。Gateway 继续是 Target 架构，不在本 Change 落地。

## Impact

- `apps/desktop/`：Main-owned OIDC client、loopback callback、OS credential store、typed Preload 认证状态与登录界面；实现 UI 时须按 child `AGENTS.md` 依次使用指定的设计、React 和界面审查 Skills。
- `services/core-api/`：`access` 模块的 User/External Identity 模型、PostgreSQL migration、Desktop API adapter、Spring Security resource server、OpenAPI/Swagger 配置与分层测试。
- `services/gateway/`：不创建运行时代码；仅在 apply 时按需澄清 Target 文档中的延后条件及未来 Gateway 不得削弱 Core API 最终验证的约束。
- API：标准 OIDC/Email OTP 端点由身份提供方拥有；TaskPilot 只新增受保护的 Desktop 用户 bootstrap/read API，不新增自定义 `/login`、`/register`、`/send-code`、`/verify-code` 或 `/token` 协议。
- 依赖：选择兼容的 OIDC/JWT、系统凭据设施和 springdoc 稳定版本；具体身份提供方与邮件投递配置由 Provider/环境拥有，不写入仓库。
- 后续 Change：`add-organization-workspace-onboarding` 依赖本 Change 产出的已认证 User 和当前用户契约，但 Workspace 查询与 onboarding 行为仍完全由后续 Change 实现。
