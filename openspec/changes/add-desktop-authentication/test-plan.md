# Test Plan

## Scope and Risk

本 Change 影响 Desktop Main/Preload/Renderer、Core API `access` 模块、PostgreSQL identity 数据、Spring Security Resource Server 和 Desktop API 文档。身份提供方托管 Email OTP；TaskPilot 只测试标准 OIDC 边界和 Provider 错误的安全映射，不复制第三方 OTP 实现。Gateway 不在本 Change 初始化或测试。

风险级别为 **High**：缺陷可能导致账号串联、认证绕过、token/OTP 泄漏、登出后会话复活、首次登录重复 User、未验证 email 被信任或生产 Swagger 暴露。

测试按“最低能证明真实边界的层”分配：纯策略用 unit；Spring Security 与 HTTP contract 用 module/API integration；唯一约束与并发用 PostgreSQL Testcontainers；OIDC callback 与 credential 编排用 Main integration；可见状态用 Renderer Cypress；系统浏览器、打包进程和 OS credential facility 用 macOS/Windows native evidence。不得用 Renderer test 代替 Main/IPC/credential 证据，不得用 mock repository 或 H2 代替 PostgreSQL 唯一性证据，也不得用真实 Provider 作为常规 CI 依赖。

显式非目标：不测试 TaskPilot 自建密码、OTP 生成/发送/校验、邮件投递、防刷或 Provider 页面像素，因为这些能力不属于 TaskPilot；不测试 Workspace 列表/创建、Project、Agent Runtime、Gateway、Public API、邮箱变更、账号绑定或多 issuer 合并。

覆盖目标沿用仓库策略：所有新增或修改的手写生产逻辑进入项目覆盖率；claim validation、callback、credential、refresh/logout、外部身份唯一性和 Production 文档关闭属于 critical branches，目标 100% branch coverage，任何未覆盖分支必须在 review 中逐项说明且不能是认证绕过路径。Core API whole-project Kover 门禁不得低于已有 line 80% / branch 75%。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Test Layer | Planned Automated Test | Why This Layer |
| --- | --- | --- | --- |
| 单一“使用邮箱继续”入口打开系统浏览器 | Main integration + Renderer integration | `SystemBrowserAuthenticationTest`；Cypress `email-auth-entry.cy.tsx` | 分别证明协议发起与用户可见入口 |
| Provider 完成已有/首次 Email OTP 后返回标准授权结果 | Main integration + fake OIDC server | 两种 fixture 均覆盖 authorize URL、PKCE S256、openid scope 和成功交换 | 不自动化第三方 OTP 内部实现，但证明其标准输出被正确处理 |
| OTP 错误/过期/频控、取消或 Provider error 不枚举账号 | Main error-mapping unit + Renderer integration | 参数化安全类别；Cypress 恢复状态 | 固定不泄露原始 Provider 信息的用户行为 |
| Runtime 不可用不阻断登录 | Main integration + architecture | Runtime launcher spy 零调用；Desktop boundary rule | 捕获认证误依赖本地执行面 |
| 回调绑定数值 loopback、动态端口、注册 path 和 state | Main integration + fake OIDC server | `LoopbackCallbackTest.acceptsBoundFirstCallback` | 证明注册兼容 redirect 与一次性状态组合 |
| state 错误、超时、重复、错误 host/port/path | Main integration with deterministic clock/random | 参数化 `LoopbackCallbackRejectionTest` | 证明攻击和恢复分支 fail closed |
| ID Token nonce、issuer、audience/azp、算法和时间约束 | Main protocol integration | signed token matrix including missing/wrong nonce and disallowed algorithm | nonce 必须在 token exchange 后校验，而非 callback query |
| OTP/code/verifier/token 不进入 Renderer、IPC、URL、日志 | Main/Preload contract + architecture + secret scan | forbidden-field/import fixtures、captured-log assertions | 跨进程负空间不能由 UI test 单独证明 |
| OS credential 恢复、不可用时不降级明文 | Main integration + native OS validation | fake adapter orchestration；macOS Keychain/Windows credential round trip | mock 证明编排，native job 证明真实平台 |
| Core API 有效 JWT 建立可信 principal | Core API module/API | 测试私钥签发 JWT 穿过真实 filter chain | 不 mock security filter chain |
| 缺失/过期/nbf/坏签名/none/非允许算法/错误 issuer/audience/subject | Core API parameterized security integration | `DesktopTokenRejectionTest` | 关键负向路径必须在业务处理前拒绝 |
| 伪造身份/email/tenant/role header | Core API API test | forged headers 不影响 principal 或授权 | 证明不信任网络位置和普通 header |
| JWKS 不可用 fail closed，可信缓存按策略工作 | Security integration with controllable JWKS server/clock | `JwksAvailabilityTest` | decoder unit 无法证明缓存与 HTTP 故障 |
| 首次 bootstrap 创建 User + ExternalIdentity | Core API module/API + PostgreSQL | `SessionBootstrapApiTest`、repository integration | 同时证明 HTTP、use case 和持久事实 |
| 重复/并发 bootstrap 收敛到同一 User | PostgreSQL Testcontainers concurrency | barrier 并断言唯一行与一致 UserId | 真实唯一约束和事务冲突无法由 mock 证明 |
| 同 email 不同 subject 不合并；未验证 email 不投影 | Access unit/module + PostgreSQL | `ExternalIdentityMappingTest` | 保护最危险的身份合并和资料信任规则 |
| `GET /me` 无副作用；缺映射返回 `409 USER_BOOTSTRAP_REQUIRED` | Core API API + DB row-count | `CurrentUserApiTest` | 验证状态码、Problem Details 和无隐式写入 |
| 未认证 API 返回 `401 AUTHENTICATION_REQUIRED` | Core API security API | 两端点统一错误且 repository 无调用 | 拒绝发生在副作用前 |
| 验证材料不可用返回 `503 AUTHENTICATION_TEMPORARILY_UNAVAILABLE` | Core API security integration | JWKS outage 无可信缓存 | 稳定区分认证缺失与基础设施暂不可用 |
| refresh single-flight、至多重试一次、rotation | Main cloud-client integration | 并发和 token rotation 场景 | 证明网络与 credential replacement 顺序 |
| logout 先失效 generation；撤销失败/迟到 refresh 不复活 | Main controlled concurrency + Renderer integration | `SessionEpochRaceTest`；Cypress cache reset | 竞态需可控调度，UI 需可见清理 |
| bootstrap 后仅交接 onboarding boundary | Renderer/Main contract with onboarding stub | 只发出 handoff，不调用 Workspace list/create 或 Runtime | 保护 Change 所有权边界 |
| OpenAPI 含端点、JWT scheme、schemas 和稳定错误 | Core API OpenAPI contract | `DesktopOpenApiContractTest` 读取运行时 JSON | 捕获代码与文档漂移 |
| Local/Test 开启、Production 默认关闭 | Core API profile integration | 分 profile 断言 endpoint/static resource | 配置单测不能证明实际暴露 |
| Swagger 不持久化授权且文档/log 无 secret | Config contract + artifact/log scan | `persistAuthorization=false`、canary assertions | 防止 token/OTP 进入持久存储或产物 |
| 打包应用浏览器回调、重启恢复、登出 | Packaged Electron + native OS jobs | fake OIDC critical journey；双平台 credential lifecycle | 真实进程与 OS 证明最后一公里 |

## TDD Slices

### Slice 1: Core API 可信 principal 与安全拒绝

- **Red:** 使用真实测试签名 JWT 写有效、缺失、过期、nbf、坏签名、`none`、非允许算法、错误 issuer/audience/subject、forged-header 和 JWKS outage 用例；确认成功场景因 Resource Server 缺失失败，负向场景不能因未到目标 filter 而假绿。
- **Green:** 增加最小 JWT Resource Server、claim validator、Desktop API matcher 和稳定 `401`/`503` Problem Details。
- **Refactor:** 收敛 principal adapter、clock/JWKS seam 与 secret-safe 错误；运行 unit、module、architecture 和覆盖率验证。

### Slice 2: ExternalIdentity/User 与 session bootstrap

- **Red:** Access unit/application 与 PostgreSQL tests 覆盖首次、重复、相同 email 不同 subject、未验证 email、profile 变化、并发唯一性及 rollback。
- **Green:** 增加最小 User/ExternalIdentity、typed IDs、repository port/adapter、migration 和事务性 bootstrap。
- **Refactor:** Provider claims 映射限制在 adapter，模型不依赖 Spring Security/JDBC；运行 ArchUnit、Modulith、integration 与 Kover。

### Slice 3: bootstrap/me HTTP 契约

- **Red:** 两端点的 `200`、`401 AUTHENTICATION_REQUIRED`、`409 USER_BOOTSTRAP_REQUIRED`、适用 `503`、无 Provider/token 泄漏和 GET 无副作用测试。
- **Green:** 实现最小 Desktop controller/transport、application calls 和 Problem Details。
- **Refactor:** 集中 DTO/error mapping，保持 controller 不访问 repository/internal type。

### Slice 4: Main OIDC + 托管 Email OTP 边界

- **Red:** fake Provider 表示首次/既有邮箱验证完成以及 OTP 错误/过期/频控；验证单一入口、authorize URL、PKCE、数值 loopback、动态端口、固定注册 path、state、token nonce、算法/claim、取消、超时、重复和 Runtime 零调用。
- **Green:** 实现 attempt 状态机、先绑定 listener、system browser、code exchange 和安全 Provider error mapping；不实现 OTP API。
- **Refactor:** 分离纯状态机、OIDC protocol 与 OS I/O，确保 secret-safe logging。

### Slice 5: Credential、refresh 与 logout

- **Red:** credential unavailable、restart restore、single-flight、rotation、invalid_grant、一次重试、session epoch、撤销超时/失败和 logout-vs-refresh race。
- **Green:** 实现 Main-owned coordinator、credential adapter、cloud client、generation-first logout 和隔离撤销副本。
- **Refactor:** 集中 credential key、redaction、generation guard 与撤销副本销毁。

### Slice 6: 窄 Preload 与登录 Renderer

- **Red:** IPC sender/schema/allowlist tests；Cypress 覆盖“使用邮箱继续”、等待、取消、超时、offline、Provider 安全错误类别、成功 handoff、reauthentication、logout、键盘/焦点/a11y。
- **Green:** 只暴露认证状态与动作的 typed capability，按 design foundation 实现最小体验；不暴露 OTP/token/HTTP/Runtime，不调用 Workspace API。
- **Refactor:** 按 Skill routing 完成 React 性能和 UI/UX/accessibility review。

### Slice 7: 运行时 OpenAPI 与 Swagger 环境门禁

- **Red:** OpenAPI paths/schemas/security/stable errors、Local/Test enabled、Production disabled、`persistAuthorization=false` 和 canary secret scan。
- **Green:** 引入兼容 springdoc、Desktop group、JWT scheme 和 profile properties。
- **Refactor:** 删除重复 annotations/customizer，确保文档配置不绕过业务 security。

### Slice 8: 打包和原生验收

- **Red:** packaged journey 在缺失 auth wiring 或 OS credential adapter 时从目标边界失败，而非安装错误。
- **Green:** 连接真实 Main/Preload/Renderer、fake OIDC 与平台 credential，完成登录、重启恢复和登出。
- **Refactor:** 稳定临时 credential namespace 和清理；macOS arm64 与 Windows x64 分别运行。

## Verification Commands

Desktop 命令是 scaffold task MUST 创建并自验证的稳定 gate；若 apply 时已有等价命令，应更新本计划使用既有命令，不创建重复别名。

### Focused

- `./gradlew --no-daemon :services:core-api:test`
- `./gradlew --no-daemon :services:core-api:moduleTest --tests '*DesktopAuthentication*' --tests '*SessionBootstrap*' --tests '*CurrentUser*'`
- `./gradlew --no-daemon :services:core-api:integrationTest --tests '*ExternalIdentity*'`
- `pnpm --filter @taskpilot/desktop test:main -- --runInBand`；若 runner 不支持该参数，scaffold 记录等价确定性串行命令。
- `pnpm --filter @taskpilot/desktop test:renderer`
- `pnpm --filter @taskpilot/desktop test:architecture`

### Affected and Cross-Boundary

- `./gradlew --no-daemon :services:core-api:test :services:core-api:moduleTest :services:core-api:integrationTest :services:core-api:koverVerify :services:core-api:verifyBuildContract`
- `./gradlew --no-daemon :services:core-api:qualityCheck`
- `pnpm --filter @taskpilot/desktop typecheck`
- `pnpm --filter @taskpilot/desktop lint`
- `pnpm --filter @taskpilot/desktop build`
- `pnpm --filter @taskpilot/desktop qualityCheck`
- `pnpm --filter @taskpilot/desktop test:packaged -- --auth`
- `openspec validate add-desktop-authentication --strict --no-interactive`
- `git diff --check -- openspec/changes/add-desktop-authentication`

### Release / Native Evidence

- macOS arm64：系统浏览器 handoff、loopback callback、Keychain 写入/重启恢复/删除、登出和打包签名后的关键路径。
- Windows x64：系统浏览器 handoff、loopback callback、Credential Manager 写入/重启恢复/删除、登出和打包安装后的关键路径。
- 隔离测试租户 smoke：Provider 托管 Email OTP 登录、bootstrap/me/logout 一次；secret 只由 CI secret store 注入，失败截图和日志脱敏。

## Exceptions and Manual Evidence

- **文档和 OpenSpec artifact：** 行为 TDD 不适用；替代证据为 strict validation、链接检查和 `git diff --check`。
- **依赖版本选择与生成文件：** 行为 TDD 不适用；依据官方来源确认兼容稳定版本，以 resolution、lockfile、编译、启动 smoke 和 drift check 证明。
- **Provider Email OTP 页面：** TaskPilot 不拥有第三方页面、OTP 生成或邮件投递，常规自动化只验证 authorize request、标准回调和安全错误映射；发布负责人在隔离租户确认邮箱流程可达，不把第三方像素作为 acceptance。
- **OS 凭据提示与安装/签名：** native job 自动验证生命周期，发布负责人在每个平台保留一次版本级人工观察；手工结果不替代自动清理断言。
