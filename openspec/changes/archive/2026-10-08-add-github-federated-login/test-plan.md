# Test Plan

## Scope and Risk

本 Change 影响 Core API `access` 业务模型与 PostgreSQL schema、外部 GitHub OAuth HTTP 边界、匿名/attempt/session Desktop API、运行时 OpenAPI、Electron Main/Preload/Renderer、OS credential 交接以及 local dev 编排。它替换当前全部邮箱认证入口并改写无存量数据的开发 migration 基线。

风险等级为 **High**：身份解析或唯一性错误可能造成账号接管/重复账号；state、PKCE、poll/completion/continuation secret 重放或秘密越界可能泄露 session；authorization URL 转发、callback 与 polling 的并发错误可能把错误身份交给发起方；交付响应丢失、ACK 竞争或错误激活可能产生不可恢复或未授权 session；User 禁用与 refresh recovery 竞争可能重新放出 credential；旧 generation 恢复可能污染新账号；配置或 dev 脚本错误会让首个用户无法登录。由于 GitHub 是外部系统，还存在自动化无法证明的 OAuth App 控制台配置和真实系统浏览器交互。

逃逸缺陷的主要影响包括：错误 UserId、转发授权导致账号接管、ACK 前可用或孤立的 ACTIVE session、禁用 User 恢复出新 credential、跨账号状态泄露、secret/token 日志泄露、不可恢复的首次注册、匿名写放大、local/dev 无法启动或邮箱链路残留。

明确非目标：Google/Lark/GitHub Enterprise、账号绑定/合并、仓库 scope、生产部署、安装包/签名/更新、Windows/macOS 发布认证、线上迁移和旧邮箱客户端兼容。测试不得把这些能力作为验收条件，也不得使用真实 GitHub 凭据进入常规自动化。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| capability 仅在 GitHub 配置、federated HMAC key 与 AEAD key 全部完整有效时启用，且无邮箱 fallback | Core API configuration + HTTP integration；Desktop Renderer integration | 各配置分别缺失/无效、完整配置、capability 响应、按钮/不可用状态与旧入口负断言 | 同时冻结服务端权威配置、密钥分离与用户可见行为 |
| attempt 创建只接受 GitHub，生成互相独立的 state、PKCE S256、poll secret，并绑定已启动的精确 loopback completion URI | application unit + HTTP contract + Main integration | 固定 clock/random 下检查用途域分离、challenge、TTL；拒绝 hostname/非 loopback/低端口/userinfo/query/fragment/路径穿越；receiver bind/start 早于 attempt 与 `openExternal` | 不依赖真实 Provider即可精确覆盖协议构造和本机监听竞争 |
| 匿名 attempt 的限流、总量与 TTL 清理，不泄露记录存在性 | PostgreSQL + HTTP integration | 来源/installation 阈值、429/retryAfter、过期清理和等形错误 | 真实约束和并发数据库行为不能只靠 mock |
| callback 缺少/错误/已消费 state，或 code/PKCE 失败 | application + fake GitHub HTTP adapter + HTTP integration | 断言不交换或只交换一次、不读取身份、不创建 User/session、稳定错误 | 覆盖 OAuth 注入和重放的关键安全路径 |
| GitHub 用户拒绝、限流、超时、非 2xx、畸形响应、缺失/无效 durable id | adapter contract + attempt integration | fake server 的确定响应与状态转换、浏览器通用结束页、无原始 body 泄露 | Provider 映射应在窄边界验证，不污染业务测试 |
| authenticated-user 请求使用最小 scope，token 读取后不持久化/不输出 | adapter + persistence/log/OpenAPI inspection | 请求断言；数据库列/对象/日志捕获/快照负扫描；无 `repo`/`user`/`user:email` | 直接检测权限扩大和秘密残留 |
| 已有 `(github, https://github.com, subject)` 解析为同一 UserId | PostgreSQL/application integration | GitHub login/email/name/avatar 变化后仍是同一 User；仅更新时间并创建 session | 身份唯一性和事务依赖真实 schema |
| 两个不同 subject 具有相同 email 时不自动合并 | PostgreSQL/application integration | 创建/登录结果拥有不同 UserId；email 不入 identity key | 防止 email-based account takeover |
| GitHub 不返回 email 仍可登录/注册 | adapter + application integration | durable id 与建议资料足够完成流程 | 明确 email 不再是隐式必需字段 |
| identity 关联 disabled User，或 User 在 delivery ACK、protected access、普通 refresh、refresh recovery 前后被禁用 | application + PostgreSQL concurrency + HTTP integration | 各入口均拒绝、对应 session family 撤销；refresh 已轮换但 recovery 前禁用时不返回加密新 credential | 内部账号状态必须覆盖 Provider 成功和所有 session 恢复竞争 |
| 未知 identity 只产生 Main 私有 registration continuation，不静默建 User | PostgreSQL/application + Main/Preload contract | callback 后 User/identity/session 计数均未变化；Main 得到 continuation 与安全预览；Renderer IPC 只得到 opaque flow id/view | 真实事务和进程边界共同证明首次确认与秘密所有权 |
| 首次注册校验 display name、头像选择、当前条款和 continuation | application/API + Renderer integration | 字段 path、过期条款、未勾选条款、无头像、恶意头像、可访问错误与焦点 | 服务端权威校验与 UI 恢复各有不同风险 |
| User + ExternalIdentity + TermsAcceptance + `PENDING_DELIVERY` session 原子创建 | PostgreSQL integration | 成功完整提交但 ACK 前 session 不可用；每个受控故障点回滚无孤立记录 | 事务原子性和不可用初态只能由真实数据库证明 |
| 同一外部身份并发注册最多一个成功 | PostgreSQL concurrency integration | 并发事务一个成功，其余稳定冲突/失效且无多余 User/session | 验证唯一约束和竞争收敛，而非顺序 mock |
| attempt 的合法状态转换、取消/过期不可逆、callback/cancel 竞争 | pure state tests + PostgreSQL concurrency integration | transition table 全分支；条件更新/锁竞争只有一个赢家 | 将纯规则与真实竞争分别放在最低可靠层 |
| poll secret/completion proof 缺失、错误、跨 attempt 混用，或 attempt 不存在/过期的响应不可枚举 | HTTP integration | 安全等待状态只依赖 poll secret；身份结果领取要求双重 proof；错误输入返回等形稳定错误且不返回资料、continuation、session 或 secret | 需要完整安全链与序列化证据 |
| poll/registration 交付响应丢失或 Main 在结果前后崩溃时，相同 `deliveryRequestId` 确定性恢复；不同 request id 不创建第二个 session | PostgreSQL/API + Main restart integration | 并发 poll、callback replay、registration replay、响应丢失、进程重启和 request-id mismatch；相同请求返回同一加密结果且 session 数不增加 | 验证可恢复幂等交付而非脆弱的一次性响应 |
| callback claim 后崩溃/超时的恢复 | application + PostgreSQL integration | 模拟 lease/TTL 到期，最终 FAILED/EXPIRED，绝不二次交换 code | 覆盖外部副作用结果不确定路径 |
| session 先为 `PENDING_DELIVERY`，OS credential 原子写入后幂等 ACK 才激活；ACK 丢包/重启恢复、abandon 与 delivery TTL 均收敛 | Core API PostgreSQL/API + Desktop Main restart integration | ACK 前 access/current-user/refresh/recovery 全拒绝；ACK 重试只激活一次；写入失败 abandon；abandon 丢包或 TTL 后 session family 撤销 | 交付状态横跨数据库、网络和 OS credential，必须验证两阶段恢复 |
| `CurrentUserView` 不再要求 email | API/OpenAPI + Desktop Main schema | `{userId, displayName, avatarUrl?}` 接受无 email；旧 email 必填负断言 | 防止跨语言 contract 残留 |
| Renderer 不接触 poll/state/verifier/completion proof/loopback URI 或 nonce/continuation/delivery/ACK/token/raw callback | Main/Preload contract + architecture tests | IPC schema、sender/frame/origin/size/stale op、序列化快照和 forbidden import/channel 扫描；registration 只暴露 opaque flow id 与安全 view | Electron 信任边界由对应进程测试拥有 |
| Main 先启动受限 loopback listener，再创建 attempt，且只对 allowlisted URL 调用 `shell.openExternal` | Main integration | mock listener/shell/timer/client，覆盖 bind 失败、attempt 后 listener 失效、打开浏览器失败、恶意 URL、错误 method/path/nonce/body/size、重复点击、取消和窗口销毁 | 不启动真实浏览器即可验证 native effect policy 与竞态清理 |
| credential 写入失败不发布成功、不降级普通存储，并请求 abandon；abandon 丢包时等待 TTL 撤销 | Main + Core API integration | fake credential store、abandon client 和 delivery clock；authenticated state 保持 false，session 始终 `PENDING_DELIVERY`/`REVOKED` 而非 `ACTIVE` | 这是 Main 与服务端两阶段交付的共同恢复责任 |
| 401 single-flight、旧 generation 迟到响应、logout/重新登录竞争 | Main integration | 并发请求、一次 refresh、retry once、旧结果丢弃、scoped cache 清理 | 覆盖跨账号状态污染和 refresh loop |
| 登录/注册的等待、拒绝、取消、离线、过期、恢复交付、交付已撤销和需要重新认证 UI | Renderer integration + Cypress component | Preload fake 驱动每种可观察状态；键盘、live region、focus、reduced motion | 用户可见交互与辅助技术需要浏览器层证据 |
| 系统浏览器而非 WebView/BrowserWindow/iframe | architecture/source + Main tests | forbidden `<webview>`/授权 BrowserWindow 路径，唯一 effect 为 allowlisted `openExternal` | 静态边界加 effect 测试能阻断错误实现 |
| OpenAPI 包含 attempt completion URI、poll proof/request id、Main-owned continuation、delivery ACK/abandon 和 `PENDING_DELIVERY` 安全声明，并移除全部邮箱路径 | Core API OpenAPI integration | 精确路径、请求 schema、安全方案、Problem Details；completion/proof/delivery/ACK/nonce/continuation/token 示例与日志负扫描；旧路径负断言 | 运行时契约的权威证据 |
| 新 Flyway 基线从空 PostgreSQL 建立约束且无邮箱/OTP/password 表 | migration integration | fresh database 检查表、FK、unique/check/index 和旧表不存在 | 直接验证最终 0→1 schema |
| dev stack 不再依赖 Mailpit/SMTP，且 GitHub、federated HMAC key、AEAD key 任一缺失时健康启动但 capability disabled | `tools/dev` Node tests + local smoke | env/schema/doctor/compose/进程断言，分别覆盖缺项、两类 key 误复用/无效和完整占位配置；`pnpm dev:smoke` 不访问真实 GitHub | 脚本层最能发现开发编排与安全配置回归 |
| Workspace onboarding/Project list 继续按 UserId 授权 | 现有 Core API/Desktop affected suites | GitHub session 进入既有 Workspace flow；跨 Workspace 与 Project scope 测试保持通过 | 防止 auth 重构破坏相邻已实现旅程 |
| model/docs 与实现最终一致 | semantic source review + OpenSpec strict validation | 对照代码、migration、API、测试、业务模型和 owning docs 的 drift 清单；strict validation | 测试通过不能证明术语、状态和文档所有权一致 |

## Implementation and Verification Approach

### Slice 1: 确定性安全基础设施与 fake GitHub

先建立 clock、secure token、digest/AEAD 和窄 Provider port 的测试 seam，并用本地 fake HTTP server 实现 GitHub adapter contract 测试。对 state/PKCE/token 解析、Provider 错误和脱敏使用 Red-Green-Refactor，因为输入输出和拒绝边界明确；配置、依赖和 fixture 则直接实现后运行单元/adapter 检查，不制造流程性 Red。

### Slice 2: ExternalIdentity、attempt 与最终开发 schema

对身份三元组、状态转换、过期、completion proof 单次使用、可恢复 delivery、条款和并发注册先写业务/持久化失败用例，再用真实 PostgreSQL migration 和事务实现通过。每个并发/原子性风险与生产代码在同一任务组完成，不把数据库测试推迟到结尾。migration 重写用 fresh-database schema assertions、旧表负断言和 dev reset 文档验证，不伪造 TDD。

### Slice 3: Core API GitHub 认证 API 与 session 交接

按 capability → attempt → callback/loopback completion → poll/cancel → registration → delivery ACK/abandon 的顺序，以 HTTP integration test 驱动稳定 contract、安全链和状态机；复用 session 时先保持现有 session tests 通过，再补 `PENDING_DELIVERY`、确定性 result recovery、disabled User 全入口检查和 ACK/TTL 收敛。OpenAPI contract 与 controller 同切片更新，避免实现和运行时文档漂移。

### Slice 4: 删除邮箱认证和 dev 邮件链路

删除旧 API、模型、配置、依赖、测试与 Mailpit/SMTP 编排，并以编译、source/API/schema 负断言、Node dev tests 和 smoke 证明不存在 fallback。该切片是删除/配置工作，不把“先让旧测试失败”当作 TDD；真正行为证据由新 GitHub tests 和旧路径负断言提供。

### Slice 5: Desktop Main/Preload 联合登录协调

先用 Main/Preload tests 定义窄 IPC、fixed API client、loopback listener、URL allowlist、single attempt、poll/cancel、Main-only continuation、预持久化 recovery state、credential handoff、ACK/abandon 与 generation fencing，再实现。Renderer 永远只消费安全 view/opaque flow id。系统浏览器、listener、进程重启和 timer 通过 test double 验证，不在自动化中打开真实浏览器。

### Slice 6: Renderer GitHub 登录与首次注册体验

实现前按 `apps/desktop/AGENTS.md` 使用 `frontend-design` 收敛现有视觉语言下的状态与交互；React 实现期间应用 `vercel-react-best-practices`。Renderer integration 与 Cypress component 使用 Preload fake 覆盖主路径、字段/条款错误、拒绝/取消/离线/过期/恢复和无障碍；完成后用 `web-design-guidelines` 做实现审查并修复实质问题。

### Slice 7: 受影响验证与语义反馈

先执行 focused suites，再执行 Core API、Desktop、Cypress、dev tooling 与 smoke 的 affected gates。最后对实现、schema、API、测试和运行证据执行 model-drift/documentation-feedback audit，更新业务模型、根/子项目架构与测试文档、delta/main specs 的稳定结论。OpenSpec strict validation 只证明 artifacts 结构，不代替行为验证。

## Verification Commands

### Focused

以下 selector 名称在实现时与新增测试类保持一致；若类名调整，tasks 中记录实际等价 selector，不降低覆盖范围。

- `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.access.FederatedLoginSecurityTest' --tests 'ai.taskpilot.coreapi.access.GitHubIdentityProviderTest'`：state/PKCE、用途分离的 HMAC digest/AEAD、completion/delivery secret、GitHub HTTP、最小 scope、错误映射和脱敏。
- `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.FederatedIdentityPersistenceIntegrationTest' --tests 'ai.taskpilot.coreapi.FederatedLoginAttemptIntegrationTest'`：ExternalIdentity 唯一性、attempt/delivery 状态机、TTL、callback/poll/registration/ACK/abandon 并发、确定性恢复与原子性。
- `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.AuthenticationHttpIntegrationTest' --tests 'ai.taskpilot.coreapi.SessionUseCasesIntegrationTest'`：loopback completion、新 HTTP contract、`PENDING_DELIVERY`/ACK/abandon、disabled User access/refresh/recovery、session/logout 和旧邮箱路径移除。
- `./gradlew :services:core-api:test --tests 'ai.taskpilot.coreapi.AccessIdentityMigrationIntegrationTest' --tests 'ai.taskpilot.coreapi.OpenApiIntegrationTest' --tests 'ai.taskpilot.coreapi.ProductionOpenApiIntegrationTest'`：最终 Flyway schema、运行时 OpenAPI、安全声明和 secret 示例负扫描。
- `pnpm --filter @taskpilot/desktop test:main`：auth client、loopback listener、Main coordinator、Preload/IPC、URL allowlist、polling、delivery recovery/ACK/abandon、credential 和 generation 行为。
- `pnpm --filter @taskpilot/desktop test:renderer`：GitHub 登录/注册状态、错误恢复和可访问交互。
- `pnpm --filter @taskpilot/desktop test:architecture`：Renderer/Preload/Main 秘密与依赖边界。
- `pnpm --filter @taskpilot/desktop test:e2e`：headless Cypress component 首次登录/注册关键旅程和键盘/状态公告。
- `pnpm dev:test`：local env、doctor/compose/controller 与 Mailpit/SMTP 移除的脚本回归。

### Affected and Cross-Boundary

- `./gradlew :services:core-api:qualityCheck`：完整 Core API 编译、格式、静态分析、标准 test、build contract 与覆盖率门禁。
- `pnpm --filter @taskpilot/desktop qualityCheck`：完整 Desktop typecheck、lint、Main/Renderer/architecture/coverage 与 build 门禁。
- `pnpm --filter @taskpilot/desktop test:e2e`：完整受影响 browser component gate；不代表 native 或发布平台证据。
- `pnpm dev:smoke`：在无真实 GitHub 网络调用的配置下验证开发栈健康、数据库基线和 auth capability 安全状态。
- `openspec schema validate taskpilot-sdd --verbose`：项目 schema 仍有效。
- `openspec validate add-github-federated-login --strict --no-interactive`：本 Change artifact 结构与 delta spec 规则。
- `openspec validate --all --strict --no-interactive`：全部 active Change 与主 specs 的结构回归。

本 Change 不要求 `test:packaged-native`、安装器、签名或另一操作系统矩阵通过，因此不得据此声明 macOS/Windows 发布可用。若实现意外改变 packaged/native credential adapter，而不只是使用其既有 contract，需在 apply 时提升验证范围并更新本 test plan 后再继续。

## Manual Evidence and Automation Gaps

- **真实 GitHub OAuth App 开发 smoke**：实现者在 Git-ignored `.env.local` 中配置专用开发 OAuth App、独立 federated HMAC key 与 AEAD key，通过 `pnpm dev` 启动，使用系统浏览器完成一次既有身份登录、一次新身份注册确认、一次 GitHub 拒绝和一次 Desktop 取消；确认 callback 精确匹配、loopback completion 成功、浏览器结束页无 token、ACK 后 Desktop 完成 Workspace onboarding。原因：fake server 无法证明 GitHub 控制台配置、真实 consent 页面和系统浏览器联动。Owner：本 Change 实现者。证据只记录日期、平台、GitHub 测试账号别名和结果，不记录 client secret、code、state、token、email 或截图中的个人信息。
- 该手工证据只证明当前 local/dev 环境，不证明生产域名、安装包、Windows/macOS 发布矩阵或 GitHub SLA。生产/发布能力由未来 deployment/release Change 负责自动化或补齐平台证据。

## Completion Follow-up Verification

- Core API HTTP integration tests增加 callback 完成页断言：nonce CSP、`no-store`/`no-referrer`、simple-request proof POST、成功后 query 清理/关闭尝试、失败重试与页面/响应不含 OAuth code、state、poll secret。
- Desktop Main coordinator tests 通过 loopback double 证明只有有效 proof resolve 才调用一次窗口激活回调，取消、轮询等待和 receiver 失败不会抢焦；Main production wiring 由 architecture test 冻结 restore/show/focus 行为。
- Renderer integration 与 Cypress component tests 覆盖无日期接受文案、两个可键盘访问链接、查看文档不自动勾选、返回后资料保留、文档关键边界、未知 bundle fail closed 与正常注册仍提交服务端版本。
- 继续执行既有 focused 和 affected commands；callback 自动关闭只能以生成 HTML/脚本契约和真实系统浏览器 smoke 共同作为证据，自动测试不得宣称浏览器一定允许关闭。
