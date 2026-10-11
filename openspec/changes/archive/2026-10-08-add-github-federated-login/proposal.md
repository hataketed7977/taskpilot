# Proposal

## Why

TaskPilot 当前仍处于 0→1 开发阶段，自建邮箱、密码、验证码、找回密码和邮件投递增加了与核心产品无关的维护与安全负担。项目计划开源，因此首个稳定认证入口改为 GitHub 联合登录，同时保留 TaskPilot 自己稳定的 `UserId`、业务授权与 session 生命周期。

## What Changes

- **BREAKING**：GitHub 登录替换邮箱密码、邮箱验证码、邮箱注册和密码重置；开发数据库需要重置，不提供存量账号迁移、兼容或回滚路径。
- 未认证 Desktop 只在 Core API 声明 GitHub 已配置时显示“使用 GitHub 登录”，使用系统浏览器完成授权；不使用嵌入式 WebView，也不把 GitHub client secret 放入 Desktop。
- Core API 新增短期联合登录尝试：生成并校验 OAuth `state` 与 PKCE S256，接收固定 GitHub callback；Desktop Main 同时持有独立 poll secret，并通过仅监听 loopback 的一次性回调接收 browser completion proof，二者缺一不得领取身份结果。
- GitHub 既有身份在同机 completion proof 校验后进入可恢复的 TaskPilot session 交付；首次授权先返回 Main 私有的注册 continuation，用户确认昵称和当前条款后再原子创建 User、ExternalIdentity、TermsAcceptance 和待交付 session。session 在 Main 安全保存 credential 并确认 ACK 前不可用于 access/refresh，响应丢失时可按同一 delivery request 确定性恢复，abandon 或超时则撤销。
- 新增通用 `ExternalIdentity` 映射，以 `(provider, authority, subject)` 唯一定位外部身份并关联稳定 `UserId`；GitHub 使用 durable numeric user ID 的字符串表示作为 `subject`。
- 删除认证链路对 email、password、OTP 和 SMTP 的要求；`CurrentUserView` 不再要求 email，GitHub 返回的 email、login 和头像不得作为身份键或自动账号合并依据。
- GitHub token 只用于本次身份读取，使用后丢弃且不写日志；登录不申请仓库权限，未来 GitHub 仓库连接作为独立 Integration capability 处理。
- 保留现有 TaskPilot access/refresh session、轮换、撤销、OS credential storage、Workspace onboarding 与业务授权边界。
- 清理仅服务于邮箱认证的 API、持久化、邮件配置、Mailpit 和开发脚本依赖；本 Change 只承诺 local/dev 可用。

## Business Model Impact

本 Change 使用关系图、登录尝试状态机、具体场景映射和 OAuth 信任边界威胁分析完成建模。受影响 actor 为匿名 Desktop 用户、已注册 User、Desktop Main、Core API 与 GitHub；新增规范术语 `ExternalIdentity` 和 `FederatedLoginAttempt`，`User` 仍表示能够在 TaskPilot 中行动的内部主体。

- 稳定身份：`UserId` 是 TaskPilot 唯一业务身份；`(provider, authority, subject)` 是外部身份唯一键。GitHub email、login、头像仅是授权时资料，不是身份键，也不触发自动合并。
- 关系与基数：一个 User 可以关联多个 ExternalIdentity，一个 ExternalIdentity 必须且只能属于一个 User；本 Change 只创建一个 GitHub identity，不提供绑定、解绑、转移或合并入口。
- 生命周期：登录尝试为短期状态机并绑定 Desktop poll secret、OAuth state、PKCE verifier、固定 loopback completion 地址和一次性 completion proof；只有 poll secret 与同机 proof 汇合后才进入注册或 session 交付。session 先处于不可使用的 `PENDING_DELIVERY`，Main 安全保存后 ACK 才转为 `ACTIVE`；abandon、TTL 或 User 禁用使其撤销。ExternalIdentity 随 User 创建并保持稳定，成功认证仅更新 `lastAuthenticatedAt`。
- 不变量：首次注册的 User、ExternalIdentity 与条款接受原子提交，所创建 session 在 ACK 前不授予权限；同一 GitHub identity 的并发首次注册最多成功一次；User 不可用时即使 GitHub 验证成功也不得建立、激活、访问、刷新或恢复 session，已有 session family 在检测到禁用时撤销。
- 授权边界：GitHub 只证明外部账号控制权，不授予 Workspace、Project 或其他业务权限；Core API 仍依据内部 User 和 Membership 权威授权。
- 异步边界与失败恢复：GitHub 只回调 Core API，Core API 返回的安全结束页再把一次性 completion proof POST 到该 attempt 预先绑定的 `127.0.0.1` listener；转发 authorization URL 的另一台 Desktop 因收不到 proof 而不能领取身份结果。浏览器 URL 不携带 TaskPilot token。session 交付使用 Main 预持久化的 `deliveryRequestId`、加密确定性恢复结果和幂等 ACK/abandon，响应丢失或 Main 重启不产生不可撤销的活跃孤立 session。

## Capabilities

### New Capabilities

无。本 Change 扩展现有 Desktop 认证 capability，而不创建相邻或重复的认证 capability。

### Modified Capabilities

- `desktop-authentication`：以 GitHub 联合登录及首次资料确认替换邮箱凭据认证，并定义 ExternalIdentity、服务端 callback、同机 loopback completion proof、Desktop polling、可恢复 session 交接和 User 禁用行为。
- `desktop-api-documentation`：运行时 OpenAPI 改为描述 GitHub capability、登录尝试、callback、polling、首次注册和 session delivery ACK/abandon 接口，并移除邮箱认证路径。

## Impact

- Core API `access` 模型、认证 use case、HTTP adapter、session current-user 投影、持久化 schema、配置和自动化测试。
- Desktop Renderer 登录体验、Main/Preload 强类型 capability、系统浏览器打开与 polling 协调、session coordinator 和自动化测试。
- Local dev Compose、启动/doctor/smoke 脚本与示例环境变量；删除 SMTP/Mailpit 认证依赖，增加可选 GitHub OAuth App 配置。
- GitHub 是新增的外部运行时依赖；Google、Lark、GitHub Enterprise、动态 Provider 插件框架、仓库权限、Provider token 持久化和 production 发布均不在范围内。

## Documentation Impact

- `docs/business-model.md`：在 Access 业务区补充 ExternalIdentity、稳定身份和禁止按 email 自动合并的 Current 规则。
- `docs/architecture.md`：把 Current 的邮箱认证边界改为系统浏览器 + Core API GitHub callback + Desktop polling，并保留 Core API session/授权权威。
- `services/core-api/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md`：把 Current access slice、Provider adapter、持久化和验证责任更新为 GitHub 联合登录。
- `apps/desktop/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md`、`design-foundation.md`：把 Current 首次认证体验和 Main/Preload/Renderer 边界更新为 GitHub 登录及首次资料确认。
- `openspec/specs/desktop-authentication/spec.md` 与 `openspec/specs/desktop-api-documentation/spec.md`：实现完成后同步本 Change 的行为 delta；Workspace 与 Project 主规格不改变，因为它们继续只依赖内部 `UserId` 和现有 session。

## Confirmed Completion Follow-up

本 Change 在真实浏览器验收后补充两个不扩大身份范围的收尾行为：

- OAuth callback 安全结束页在成功把 completion proof 交给同机 loopback receiver 后清理地址栏中的 OAuth 查询参数、尝试关闭当前授权页；浏览器禁止脚本关闭时显示明确的完成与手动关闭提示。Desktop 收到 proof 后恢复并聚焦已有主窗口，不增加 deep link、自定义协议或第二个窗口。
- 首次注册不再向用户展示内部日期形态的条款版本，改为主动勾选“已阅读并同意《用户协议》，并确认已阅读《隐私政策》”；两个名称可在应用内查看与当前 `termsVersion` 绑定的静态法律文档。现有 `TermsAcceptance(userId, termsVersion, acceptedAt)` 继续把 `termsVersion` 视为该用户协议与隐私政策组合的不可变 consent bundle id，不新增 Consent Service、IP/User-Agent 接受证据或法律文档后台。
