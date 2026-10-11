# Tasks

## 1. 联合身份安全基础设施与 GitHub Adapter

- [x] 1.1 **Red**：为用途域分离的 state/poll/completion/continuation/ACK digest、PKCE S256、AEAD 身份候选与可恢复 delivery result，以及 GitHub authorization/token/user 映射新增 `FederatedLoginSecurityTest` 与 `GitHubIdentityProviderTest`；覆盖 HMAC/AEAD key 缺失、无效或误复用时 capability disabled，并运行 `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.access.FederatedLoginSecurityTest' --tests 'ai.taskpilot.coreapi.access.GitHubIdentityProviderTest'`，确认失败只源于待实现行为。
- [x] 1.2 **Green**：在 Core API `access` 增加可注入 Clock、secure token generator、使用独立 runtime key 的 purpose-separated HMAC digester/AEAD 与窄 `FederatedIdentityProvider` 端口，实现代码内固定 GitHub adapter 和本地 fake HTTP server 测试 seam；以同一 focused 命令通过且捕获日志/异常不含 code、state、verifier、completion proof、delivery/ACK secret、client secret 或 GitHub token 为证据。
- [x] 1.3 **Refactor**：收紧 Provider 端口只返回规范化 identity、建议资料与稳定错误类别，禁止 SDK/raw JSON/token 类型穿透；运行 `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.access.GitHubIdentityProviderTest' --tests '*Architecture*'` 证明 adapter 与 capability 边界。

## 2. ExternalIdentity、登录尝试与最终开发 Schema

- [x] 2.1 **Red**：新增 `FederatedIdentityPersistenceIntegrationTest` 和 `FederatedLoginAttemptIntegrationTest`，覆盖 `(provider, authority, subject)` 唯一性、允许同 User 多身份、不按 email 合并、attempt transition/TTL、completion proof 单次使用、callback/cancel/poll 竞争、并发首次注册、`PENDING_DELIVERY`、相同 `deliveryRequestId` 确定性恢复、不同 request id 拒绝、ACK/abandon 幂等和 delivery TTL；运行对应 Testcontainers selector，确认失败由旧 schema/缺失行为导致。
- [x] 2.2 **Green**：重写未发布的 Flyway `V1`–`V3` 开发基线，建立 User/Profile、ExternalIdentity、TermsAcceptance、FederatedLoginAttempt、Main-only registration continuation、`PENDING_DELIVERY` session 与 delivery/recovery 最终 schema，保留 `V4`/`V5` 对 `app_users` 的关系；实现显式状态转换、条件更新/锁、短租约、delivery TTL 撤销和事务 store，以 `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.FederatedIdentityPersistenceIntegrationTest' --tests 'ai.taskpilot.coreapi.FederatedLoginAttemptIntegrationTest' --tests 'ai.taskpilot.coreapi.AccessIdentityMigrationIntegrationTest'` 通过为证据。
- [x] 2.3 **Refactor**：移除 EmailIdentity/PasswordCredential/verification 表和持久化类型，确认不存在 `(user_id, provider, authority)` 唯一约束、旧邮箱/OTP/password 表或孤立记录路径；运行 migration/persistence focused tests 和 `rg -n 'email_identities|password_credentials|verification_challenges|auth_continuations|verification_rate_limits' services/core-api/src/main/resources/db/migration`，预期无匹配。
- [x] 2.4 更新 `docs/business-model.md` 的规范术语、User–ExternalIdentity 基数、身份唯一性、首次注册与 attempt 生命周期，并在 `services/core-api/docs/architecture.md`/`responsibilities.md` 记录 `access` 对联合身份与临时流程的所有权；通过人工逐项对照本 Change design/spec 和 Markdown link 检查证明未把 Target 描述为 Current。

## 3. Core API Capability、Attempt、Callback 与 Polling

- [x] 3.1 **Red**：扩展 `AuthenticationHttpIntegrationTest`，覆盖 capability 完整/缺项配置、精确 loopback completion URI 校验、固定 GitHub callback、state/PKCE 失败、用户拒绝、authorization URL 转发、wrong/missing/cross-attempt completion proof、取消/过期、duplicate callback、并发 poll、相同 `deliveryRequestId` result recovery、不同 request id 拒绝、delivery ACK/abandon、匿名限流与不可枚举错误；运行该 selector，确认失败来自新 API 尚未实现。
- [x] 3.2 **Green**：实现固定 `/desktop/v1/auth/capabilities`、federated attempt/callback/poll/cancel、registration 和 delivery ACK/abandon controller/use case，严格校验 completion URI，生成只向绑定 loopback receiver POST proof 的安全 browser completion page，并实现安全链 allowlist、完整配置校验、来源/installation 限流；callback 外部调用不持有长数据库事务，状态竞争和确定性交付按 design 收敛；运行 `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.AuthenticationHttpIntegrationTest' --tests 'ai.taskpilot.coreapi.FederatedLoginAttemptIntegrationTest'`。
- [x] 3.3 **Refactor**：统一 Problem Details 与稳定联合认证 error code，过滤 Provider 原始 body 和 OAuth/poll/completion/continuation/delivery/ACK/TaskPilot 全部秘密，确认这些值不进入 URL；使用 HTTP 测试、日志捕获和 `git diff --check` 证明 contract 与脱敏规则。
- [x] 3.4 更新 `docs/architecture.md` 与 `services/core-api/docs/{architecture,responsibilities,testing-strategy}.md` 中的身份信任边界、外部浏览器 callback、attempt API、测试 seam 和 Current/Target 状态；核对文档不把 GitHub 登录扩展成仓库 Integration、Gateway 认证或生产部署。

## 4. 首次注册、TaskPilot Session 与当前用户投影

- [x] 4.1 **Red**：为未知 identity 不静默建 User、Main-only registration preview/continuation、无 email、昵称/头像选择、条款 mismatch、continuation 过期/重放、原子创建、`PENDING_DELIVERY`、poll/registration response loss、ACK 响应丢失、abandon/TTL、disabled User 在 login/ACK/protected access/普通 refresh/refresh recovery 各阶段的拒绝与 family 撤销、相同 email 不合并新增 use-case/API/PostgreSQL 测试；特别覆盖 refresh 已轮换但 recovery 前 User 被禁用时不返回新 credential。运行 `AuthenticationUseCasesIntegrationTest`、`FederatedIdentityPersistenceIntegrationTest` 与 `SessionUseCasesIntegrationTest` 的 focused selector，确认待实现断言失败。
- [x] 4.2 **Green**：实现 `REGISTRATION_REQUIRED` Main 私有 continuation、资料/当前条款确认和单事务 User + ExternalIdentity + TermsAcceptance + `PENDING_DELIVERY` session；相同 `deliveryRequestId` 确定性返回同一加密结果，Main ACK 前 session 不可访问/刷新/恢复，ACK 时重新检查 User 为 `ACTIVE` 后才激活，abandon 或 TTL 撤销；既有 identity 登录只更新 `lastAuthenticatedAt`，GitHub token 随 callback 调用结束丢弃；focused use-case、HTTP、并发和 session tests 全部通过。
- [x] 4.3 **Green**：将安全 `CurrentUserView` 改为 `{ userId, displayName, avatarUrl? }`，移除必填 email，并保证 Workspace onboarding/Project list 继续只引用 UserId；运行 `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.AuthenticationHttpIntegrationTest' --tests 'ai.taskpilot.coreapi.SessionUseCasesIntegrationTest' --tests 'ai.taskpilot.coreapi.ProjectListIntegrationTest'`。
- [x] 4.4 **Refactor**：复核注册/session 事务边界、`PENDING_DELIVERY → ACTIVE/REVOKED` 状态机、ACK/abandon 幂等、response-loss recovery、delivery TTL，以及 disabled User 在 login/ACK/protected access/普通 refresh/refresh recovery 的统一检查与 family 撤销；删除 callback 静默注册、profile 自动覆盖或 ACK 前授权旁路，以真实 PostgreSQL 计数/唯一约束/状态断言和完整 focused selectors 为证据。

## 5. 运行时 OpenAPI 与邮箱认证清理

- [x] 5.1 更新运行时 OpenAPI/controller contract tests，精确冻结 capability、attempt completion URI、callback、poll body 的 completion proof/`deliveryRequestId`、cancel、Main-owned registration continuation、delivery ACK/abandon、`PENDING_DELIVERY` 非 bearer 语义、ACTIVE session 路径、安全声明、Problem Details 和无 email `CurrentUserView`；负扫描 completion proof、loopback nonce、continuation、delivery request/ACK secret 与 token 的真实/可复用示例，并断言邮箱发码、验码、密码登录、邮箱注册和密码重置路径全部不存在；运行 `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.OpenApiIntegrationTest' --tests 'ai.taskpilot.coreapi.ProductionOpenApiIntegrationTest'`。
- [x] 5.2 删除邮箱/password/OTP/reset controller、application/model、mail adapter、SMTP/Mailpit 配置和仅为这些能力存在的依赖/测试，不保留隐藏 fallback；以 Core API 编译、focused auth tests、OpenAPI 旧路径负断言和 `rg -n -i 'mailpit|smtp|password reset|email otp' services/core-api/src/main services/core-api/build.gradle.kts` 的人工分类检查为证据，任何保留匹配必须属于无关历史/说明且记录原因。
- [x] 5.3 更新 `openspec` owning API 文档对应的实现 fixture，并同步 `services/core-api/docs` 对邮箱链路、Mailpit/SMTP、运行时 OpenAPI 和当前 runnable slice 的描述；通过 Markdown link 检查与 OpenAPI tests 证明文档未暴露真实 OAuth/attempt/session secret。

## 6. Desktop Main、Preload 与 Session Coordinator

- [x] 6.1 **Red**：更新 `auth-client`、loopback receiver、`ipc-contract`、`ipc-validation`、`preload-api`、`session-coordinator` 和 credential tests，覆盖 capability、listener bind/start 早于 attempt/`openExternal`、unsafe completion URI、错误 method/path/nonce/body/size、authorization URL 转发、single attempt、poll/cancel、Main-only continuation、预持久化 `deliveryRequestId`/attempt recovery、poll/registration response loss、result 前后进程退出、credential 原子写入、ACK 丢包/幂等恢复、abandon/TTL、Renderer secret 隔离、窗口销毁、401 single-flight 与旧 generation 迟到响应；运行 `pnpm --filter @taskpilot/desktop test:main`，确认失败只来自新 contract 未实现。
- [x] 6.2 **Green**：实现 Main-owned fixed auth client、仅监听 `127.0.0.1` 随机高端口的一次性 loopback receiver、attempt coordinator、timer/cancel/window cleanup、可恢复 delivery coordinator、OS credential 原子 handoff、ACK/abandon 和窄 typed Preload capability；Main 组合其私有 poll/completion/continuation/delivery secrets 并恢复预持久化 request state，Renderer 只获得安全 registration view/opaque flow id，不获得任意 URL/HTTP 或 token getter；运行 `pnpm --filter @taskpilot/desktop test:main`。
- [x] 6.3 **Refactor**：删除 Desktop 邮箱/password/OTP/reset contract 与 coordinator 分支，收紧 loopback method/path/nonce/body/size、IPC sender/frame/origin/schema/size 和 external URL allowlist，确认 listener 在有效 completion、取消、失败、过期或窗口销毁后关闭，并保留 Workspace/Project generation fencing；运行 `pnpm --filter @taskpilot/desktop test:main && pnpm --filter @taskpilot/desktop test:architecture`。
- [x] 6.4 更新 `apps/desktop/docs/{architecture,responsibilities,testing-strategy}.md` 中系统浏览器、Main 私有 secret、Preload capability、session 与测试所有权，明确本 Change 不提供 deep link、内嵌 WebView 或发布平台证据；通过文档与 production source 对照复核 Current/Target。

## 7. Renderer GitHub 登录与首次注册体验

- [x] 7.1 在修改 UI 前使用 `frontend-design`，基于现有 `apps/desktop/docs/design-foundation.md` 收敛单一 GitHub 登录入口、首次昵称/头像/条款确认以及 loading、等待浏览器、拒绝、取消、离线、过期、恢复交付、交付已撤销、disabled 和需要重新认证状态；将稳定设计结论更新到该 owning 文档，并确认不增加营销页、Provider 选择器或邮箱 fallback。
- [x] 7.2 **Red**：更新 Renderer integration 与 Cypress component tests，覆盖 capability unavailable、已有身份登录、新身份注册、条款/字段错误、无头像、重复点击、取消/拒绝/离线/过期/恢复、键盘、focus、live region 和 reduced motion；运行 `pnpm --filter @taskpilot/desktop test:renderer` 与 `pnpm --filter @taskpilot/desktop test:e2e`，确认缺失行为导致失败。
- [x] 7.3 **Green**：使用 `vercel-react-best-practices` 实现 Renderer 页面/state mapping 和安全 view model，删除 email/password/OTP/reset UI 与副本；运行 Renderer 和 Cypress focused gates，确认组件不解析 human-readable message 分支且不接触 secret。
- [x] 7.4 **Refactor**：清理旧 auth 状态、请求和样式，保持现有视觉语言、单一主动作和可恢复状态；运行 `pnpm --filter @taskpilot/desktop test:renderer && pnpm --filter @taskpilot/desktop test:architecture && pnpm --filter @taskpilot/desktop test:e2e`。
- [x] 7.5 使用 `web-design-guidelines` 对已实现登录/注册界面执行最终 UI/UX/无障碍审查，修复 material finding 并重跑受影响 Renderer/Cypress tests；记录任何有证据的 intentional exception，不把未执行的 packaged/native/另一平台检查声明为通过。

## 8. Local Dev 基线与配置

- [x] 8.1 更新 Compose、`.env` 示例、bootstrap/dev/doctor/status/logs/smoke controller，移除 Mailpit/SMTP 服务和端口，增加 Git-ignored GitHub OAuth App、独立 federated HMAC key 与 AEAD key 配置校验；任一配置缺失、无效或两类 key 未正确分离时 Core API 健康但 capability disabled，任何 secret 不写入仓库、命令行或日志。
- [x] 8.2 增补 `tools/dev` Node tests，覆盖无配置、GitHub/HMAC/AEAD 各自缺失或无效、两类 key 误复用、完整占位配置、旧开发数据库基线提示、显式 reset 指引和无 Mailpit 依赖；运行 `pnpm dev:test`。
- [x] 8.3 从空 checkout-scoped PostgreSQL 开发数据库运行最终 migration 与 `pnpm dev:smoke`，证明基础设施/Core API 健康、GitHub 未配置时 fail closed、smoke 不访问真实 GitHub；不执行 Flyway repair 或自动数据删除。
- [x] 8.4 更新根 README/开发文档及 `docs/README.md` 可达条目（仅在文件增加、移动、重命名或 ownership 改变时）说明新的 local/dev 配置、显式数据库重建和手工真实 Provider smoke 边界；确认示例只有占位值且真实凭据保持 Git-ignored。

## 9. Model and Documentation Reconciliation

- [x] 9.1 对照批准的 User–ExternalIdentity 模型、loopback completion、attempt/delivery/session 状态机、身份唯一性、Main-only continuation、`PENDING_DELIVERY`/ACK/abandon/TTL、disabled User 全入口检查、授权/秘密边界与实现代码、Flyway、API、测试和 local operational evidence，逐项解决或记录所有 material drift；若实现暴露会改变行为、数据所有权、安全或测试顺序的假设，先更新并重新批准本 Change artifacts，不把决定隐藏在代码中。
- [x] 9.2 将稳定结论反馈到 `docs/business-model.md`、`docs/architecture.md`、Core API/Desktop child docs 和适用主 specs，核对 Current/Target 状态与文档地图；若某 owner 不变，记录基于实现证据的原因，并确认两个 delta specs 已具备 sync readiness。
- [x] 9.3 依次运行 focused/affected gates：`./gradlew :services:core-api:qualityCheck`、`pnpm --filter @taskpilot/desktop qualityCheck`、`pnpm --filter @taskpilot/desktop test:e2e`、`pnpm dev:test` 和 `pnpm dev:smoke`；如某 gate 因环境不可执行，保留失败/未验证事实而不宣称通过。
- [x] 9.4 运行 `openspec schema validate taskpilot-sdd --verbose`、`openspec validate add-github-federated-login --strict --no-interactive` 与 `openspec validate --all --strict --no-interactive`，并检查 scoped Git 状态与 `git diff --check`；确认本阶段只完成 apply 和 delta-spec sync 准备，不跳过后续正式 sync/archive 流程。

## 10. 浏览器完成页与 Desktop 回焦收尾

- [x] 10.1 **Red/Green**：扩展 `AuthenticationHttpIntegrationTest`，先证明当前 callback 页缺少 CSP、URL 清理、成功/失败状态、重试和关闭 fallback，再实现仅在 loopback 204 后声明完成并尝试关闭的安全 HTML；运行 `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.AuthenticationHttpIntegrationTest'`。
- [x] 10.2 **Red/Green/Refactor**：为 `FederatedAuthCoordinator` 增加有效 proof 到达时的一次性 Desktop 激活测试和窄注入回调，在 Electron Main 中恢复/显示/聚焦现有窗口，取消/失败/普通 poll 不触发；更新 Desktop owning docs 并运行 `pnpm --filter @taskpilot/desktop test:main && pnpm --filter @taskpilot/desktop test:architecture`。

## 11. 首次注册法律文档组合

- [x] 11.1 **Red**：扩展 Renderer integration 与 Cypress component tests，覆盖接受文案不含日期、用户协议/隐私政策链接、查看不自动勾选、返回保留资料、文档关键边界和未知 bundle fail closed；先运行 focused tests 确认失败来自缺失行为。
- [x] 11.2 **Green/Refactor**：按既有视觉语言实现内置只读《用户协议》和《隐私政策》、返回注册交互及当前 bundle 精确匹配，保留现有事务接受记录而不扩表；同步业务模型、Desktop design/architecture/testing docs，使用 `vercel-react-best-practices` 实现并以 `web-design-guidelines` 做最终 UI/无障碍审查，运行 `pnpm --filter @taskpilot/desktop test:renderer && pnpm --filter @taskpilot/desktop test:e2e`。

## 12. 补充切片语义与交付闭环

- [x] 12.1 对照 callback/proof/session 状态机和 `TermsAcceptance` bundle 语义执行 model-drift/documentation-feedback audit；运行 Core API/Desktop affected gates、OpenSpec strict validation 和 `git diff --check`，记录真实 GitHub 浏览器自动关闭/回焦仍需当前平台手工 smoke 的证据边界，并确认 delta-spec sync readiness。
