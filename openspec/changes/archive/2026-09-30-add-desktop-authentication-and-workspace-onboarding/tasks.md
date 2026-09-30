# Tasks

## 1. 冻结完整首次使用契约并对齐 owning 文档

- [x] 1.1 Baseline（TDD 不适用）：记录当前 source、migration、API、测试命令和并行工作；确认没有需要迁移的 Personal Workspace 生产数据。若假设不成立，先更新本 Change，不覆盖其他工作。
- [x] 1.2 Contract review（TDD 不适用）：确认 `desktop-authentication`、`workspace-onboarding`、`project-list` 和 `desktop-api-documentation` 的 ownership；冻结 auth → session + `CurrentUserView` → Workspace list/create → active `WorkspaceId` → 真实 Project list surface 的交接及 endpoint/error/capability/idempotency/pagination fixtures；Project 创建及后续操作留给后续 Change。
- [x] 1.4 Target docs（TDD 不适用）：一次性更新 business model、root/Core API/Desktop architecture、responsibilities、testing strategy、design foundation 和 documentation map；移除首期 Provider OIDC 与自动 Personal 主方案，保持 Gateway/Runtime 未初始化。
- [x] 1.5 Visual preparation（TDD 不适用）：按 Desktop Skill routing 使用 `frontend-design`，在同一视觉方向中确认四条认证流程、Workspace entry/switcher/create、启动恢复、Project list loading/empty/error/pagination 和离线状态；不把人工视觉判断伪装成自动化通过。

## 2. Core API User、EmailIdentity 与 PasswordCredential

- [x] 2.1 Red: unit/PostgreSQL tests 覆盖邮箱规范化、IDNA/Unicode/case fixtures、Provider 特有别名不折叠、唯一 normalized email、稳定 UserId、并发同邮箱注册和任一步失败无部分写入。
- [x] 2.2 Red: password tests 覆盖 Argon2id salt/参数、长度与 UTF-8 resource bounds、Unicode/space、common/breached rejection、未知邮箱 dummy hash、旧参数登录后 rehash，以及 password/digest 不进入响应、事件、日志或快照。
- [x] 2.3 Green: 增加最小 User、EmailIdentity、PasswordCredential、TermsAcceptance model/migration/repository/application seam；框架和 persistence entity 不越过 adapter。
- [x] 2.4 Refactor: 收敛 normalization/password policy/clock/random/redaction 配置，运行 Core API test/moduleTest/integration/Kover/build-contract。

## 3. OTP challenge、continuation、限流与邮件 adapter

- [x] 3.1 Red: 覆盖 `REGISTER_EMAIL_VERIFY`、`LOGIN_EMAIL_OTP`、`PASSWORD_RESET` 隔离，CSPRNG/摘要、TTL、最大尝试、冷却、重发、过期、错误 purpose 和并发单次消费。
- [x] 3.2 Red: 覆盖存在/不存在账户的统一 accepted shape、email/network/device 等价限流、`retryAfter`、客户端刷新不可绕过，以及 mail success/明确失败/结果未知/timeout 的安全语义。
- [x] 3.3 Green: 实现 VerificationChallenge、AuthContinuation、共享持久限流边界、原子 consume 和 mail port/fake/production adapter 配置；continuation secret 只交给 Main，服务端只存摘要。
- [x] 3.4 Refactor: 统一三种 purpose policy 和模板 command，日志只含 correlation、模板类别、provider safe id、结果与耗时；运行 focused tests 和 migration validation。

## 4. 注册、密码登录、验证码登录和密码重置

- [x] 4.1 Red: API/PostgreSQL tests 覆盖注册发码/验码/continuation/原子建 User+EmailIdentity+Password+Terms+Session、并发冲突、已证明邮箱已注册、条款版本错误，以及创建账户响应未知时不得盲目重试、必须清秘密并回登录恢复。
- [x] 4.2 Red: 覆盖密码登录成功、`INVALID_CREDENTIALS` 不枚举、验证码登录发码/原子消费/建 session，以及三 purpose 不能互用。
- [x] 4.3 Red: 覆盖 reset 发码/验码/continuation、更新 password + 撤销全部 session 的原子性、成功返回登录，以及无效/过期 proof 不产生部分变更。
- [x] 4.4 Green: 实现对应 application services 和固定 `/desktop/v1/auth/**` adapters；匿名 endpoint 仍执行 schema、大小、timeout、限流和审计；删除旧 bootstrap/OIDC/JWKS/UserInfo 假设。
- [x] 4.5 Refactor: controller 仅做 transport mapping，事务和安全规则留在 owning use case；运行 Core API focused gates。

## 5. Opaque session、refresh、logout 和 current user

- [x] 5.1 Red: PostgreSQL/API tests 覆盖 access/refresh 主记录只存摘要、`GET /desktop/v1/me`、注册/密码登录/验证码登录/refresh 的完整 `{ accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, currentUser }` success DTO、`refreshRequestId` 正常 rotation、成功响应丢失/崩溃后的同 request id 恢复、不同 request id 或窗口外重用撤销 family、恢复结果过期/加密、logout 幂等和撤销后 401。
- [x] 5.2 Green: 实现 UserSession、opaque token issuer/digest、refresh recovery record、refresh/logout/current-user endpoints 和稳定 `CurrentUserView`；恢复结果短期加密保存，access 默认短期，refresh 同时受 inactivity/absolute expiry。
- [x] 5.3 Refactor: 集中 token pepper、recovery encryption key、session clock、恢复窗口、family revoke、secret-safe Problem Details 和审计；保证 response/log/OpenAPI 不暴露持久摘要、恢复密文或内部 session 数据。

## 6. Runtime OpenAPI 与 Swagger 门禁

- [x] 6.1 Red: contract tests 覆盖全部注册/登录/reset/session/me、Workspace list/create 与 Project list 路径、请求/响应 schema、匿名/refresh/bearer security、`refreshRequestId`、Workspace 精确 method/path/status/header/body/error/capability、Project list path/query/page/error、`retryAfterSeconds`，以及文档无真实 password/OTP/token/request id/continuation/email。
- [x] 6.2 Green: 配置 springdoc runtime OpenAPI/Swagger，Local/Test 默认可见、Production 默认不可达，`persistAuthorization=false`，不生成第二份 YAML/client。
- [x] 6.3 Refactor: 收敛 tag、Problem Details component 和环境配置；运行 clean Core API qualityCheck 与 Production startup test。

## 7. Desktop foundation 与 Main auth client

- [x] 7.1 Foundation（行为 TDD 不适用）：若 `apps/desktop` 尚未初始化，按 owning architecture 创建最小 Electron + React + TypeScript foundation、确定性 package scripts、测试 source sets、dependency policy 和双平台 packaging seam；为认证、Workspace onboarding 与 Project list 提供共同基础，但不实现 Runtime。
- [x] 7.2 Red: Main tests 覆盖固定 Core API origin/endpoint allowlist、schema/size/flow/operation 校验、timeout/cancel、创建账户结果未知的保守恢复、请求去重、稳定错误映射，以及 password/OTP/continuation/token 不进入 URL/log/telemetry/persistence。
- [x] 7.3 Green: 实现 Main-owned auth client 和 flow coordinator；registration/reset continuation 只在 Main，Renderer 仅使用非秘密 flow handle；无 generic HTTP、任意 header/URL、token getter 或 Runtime 依赖。
- [x] 7.4 Refactor: 分离 transport、flow、session、error mapping 和 redaction；运行 Main/architecture/typecheck/lint。

## 8. Main credential、refresh 和 logout 生命周期

- [x] 8.1 Red: 覆盖 access 仅内存、在发送前原子保存旧 refresh + pending `refreshRequestId`、响应丢失/崩溃重启恢复、refresh credential 写入失败不发布成功且保留旧 credential/pending recovery、初次认证写入失败不进入受保护 UI并清理结果/尽力撤销服务端 session、无明文降级、per-generation single-flight、protected API 401 业务请求最多重试一次、终止/暂态 refresh 分流、generation-first logout、账号/environment 切换和迟到响应。
- [x] 8.2 Green: 实现 Main session coordinator、按 environment/账号分区的 macOS Keychain/Windows Credential Manager entry 与 current-account pointer、pending refresh recovery、401 coordinator、session generation 和本机优先 logout；终止失败清除全部受保护状态，暂态失败保留 credential 但隐藏陈旧受保护数据。
- [x] 8.3 Refactor: 集中 credential namespace、startup restore 顺序、retry/generation guard 和 cache reset；运行 Main/architecture checks 与当前平台 credential smoke。

## 9. 窄 Preload 认证能力

- [x] 9.1 Red: Main/Preload contract 覆盖 `signInWithPassword`、登录验证码、注册、密码重置、`getSessionView`、`subscribeSessionView`、`logout` 的 schema、sender/frame/origin/session、非法/陈旧 flow，以及 token/continuation/generic HTTP 不可达。
- [x] 9.2 Green: 实现显式 channel owner、validated handler 和 typed capability，只传递动作必要输入、安全 flow/session/user view 与稳定 error union；请求结束清除 password/OTP 引用。
- [x] 9.3 Refactor: 收敛 schema、allowlist、订阅释放和窗口生命周期；运行 Main/architecture/qualityCheck。

## 10. Renderer 端内认证体验

- [x] 10.1 Design preparation（行为 TDD 不适用）：按 Desktop Skill routing 使用 `frontend-design`，将 design foundation 映射为默认密码登录、独立验证码登录、三步注册和独立忘记密码，确认文案、视觉层级、键盘、焦点、200% zoom 和 reduced-motion。
- [x] 10.2 Red: Cypress 覆盖登录/注册明确分流、邮箱跨流程保留但秘密清除、pending/重复提交、冷却/限流、字段错误、非枚举错误、offline/expiry、成功 handoff、reauth/logout，以及 keyboard/screen-reader/a11y；DOM/storage/URL/log/snapshot 无秘密。
- [x] 10.3 Green: 使用 React best practices 实现最小 auth boundary、四条 flow 和 session adapter；Renderer 不调用 HTTP，不持有 continuation/token，认证页面不调用 Workspace list/create，全部首次使用页面都不调用 Runtime。
- [x] 10.4 Refactor: 集中状态文案、字段映射、焦点恢复、倒计时、取消/重试和 cache reset；用 UI guidelines review 并修复 material findings，运行 Renderer/Main/architecture/qualityCheck。

## 11. Core API 窄创建输入与 Organization 默认

- [x] 11.1 Red: 新增 `WorkspaceNamePolicyTest`、`CreateOrganizationWorkspaceTest` 和 `WorkspaceDesktopApiContractTest` 的最小失败用例，覆盖显示名裁剪、1–80 Unicode code point、控制字符拒绝、合法同名、可信 actor、固定 `ORGANIZATION`、stable ID/type，以及拒绝 `type`、actor、role、capability 和未知字段；运行 `./gradlew :services:core-api:test --tests '*Workspace*'`，确认只因对应行为尚未实现而失败。
- [x] 11.2 Green: 在 Core API Access 能力中实现明确的显示名 policy、窄创建输入和固定组织型 Workspace 的用例/DTO/error mapping；不得暴露持久化实体、内部角色或 Personal 创建入口。运行 `./gradlew :services:core-api:test --tests '*Workspace*'` 和相关既有 security tests 至通过。
- [x] 11.3 Refactor: 收敛 Access-owned policy、transport mapper 与列表上下文 `canCreateWorkspace` value，保持实际 coarse module graph 且不新增 tactical-DDD 样板；运行 `./gradlew :services:core-api:test` 和 `./gradlew :services:core-api:verifyBuildContract`。

## 12. Workspace 与初始 Membership 原子提交

- [x] 12.1 Red: 新增应用和真实 PostgreSQL 失败测试，覆盖 Workspace、创建者 Membership 与成功幂等结果同时提交，创建者随后能通过权威 Workspace list 看到并选择该 Workspace，以及 Workspace、Membership 或幂等结果任一步失败时全部回滚；运行 `./gradlew :services:core-api:test --tests '*Workspace*'` 和 `./gradlew :services:core-api:integrationTest --tests '*Workspace*'`，确认因缺少原子行为或权威列表可见性而失败。
- [x] 12.2 Green: 增加最小 Flyway schema、约束和 Access-owned 单事务创建编排，以稳定 `WorkspaceId` 原子建立 Workspace、创建者 Membership 与成功幂等结果；创建成功后由权威 Workspace list 返回既有 `{ workspaceId, name, type }` item，后续操作继续按 Membership 服务端授权，不新增 item-level capability、角色 DTO 或其他授权抽象。运行上述 focused unit/application/PostgreSQL tests 至通过。
- [x] 12.3 Refactor: 清理 transaction/persistence adapter，确保同步原子用例不被拆为异步事件链，且 Project/Board ownership 无 `organizationId`；运行 `./gradlew :services:core-api:moduleTest --tests '*Workspace*'`、focused integration tests 和架构边界检查。

## 13. 持久化幂等、冲突与并发

- [x] 13.1 Red: 新增相同 actor/key/payload 重放、相同 key 不同 payload、相同 key 并发、不同 key 同名和失败不缓存为成功的测试；运行 `./gradlew :services:core-api:test --tests '*Workspace*'` 与 `./gradlew :services:core-api:integrationTest --tests '*Workspace*'`，确认出现预期重复创建、错误复用或竞态失败。
- [x] 13.2 Green: 以“可信 actor + 创建操作 + `Idempotency-Key`”定界持久幂等记录和数据库唯一约束，实现相同输入返回同一 `WorkspaceId`、payload mismatch 稳定冲突、同 key 并发至多一次提交且 Workspace 名称不作为身份。运行 focused tests 至通过。
- [x] 13.3 Refactor: 提取可控 ID/时钟、规范化 payload 与冲突重读逻辑，不使用进程内锁替代数据库约束；运行全部 Workspace application/PostgreSQL tests 和 `./gradlew :services:core-api:qualityCheck`。

## 14. Workspace 列表、capability 与 Desktop API 契约

- [x] 14.1 Red: 新增 API/security/schema 失败测试，覆盖 `GET /desktop/v1/workspaces` 的 `200 { items, capabilities }`、`POST /desktop/v1/workspaces` 的 bearer/`Idempotency-Key`/严格 `{ name }`/`201|200`、列表级 `canCreateWorkspace`/`createWorkspaceReasonCode`、item `{ workspaceId, name, type }`、稳定 `401/400/403/409/503` errors、创建时重新授权、角色/实体负空间；Core API 测试不得为未来兼容伪造 Personal Workspace；运行 focused Core API test/moduleTest 命令并确认预期失败。
- [x] 14.2 Green: 实现可访问 Workspace 列表、规范化 Workspace/capability 表示和 Problem Details-compatible 错误；capability 只辅助展示，每次 mutation 仍由 Core API 最终授权。运行 `./gradlew :services:core-api:test --tests '*Workspace*'` 与 `./gradlew :services:core-api:moduleTest --tests '*Workspace*'` 至通过。
- [x] 14.3 Refactor: 以 Core API 运行时 OpenAPI JSON 和契约测试固定 Desktop Workspace API 的 request body 禁止字段、`Idempotency-Key`、item ID/name/type、列表 capability 和 error category；本阶段不提交独立版本化 schema、不生成 TypeScript client，也不建立 breaking-compatibility 或 generated-drift gate。运行 runtime OpenAPI contract、Core API focused tests 和 `./gradlew :services:core-api:qualityCheck`。

## 15. Project 与 Project Membership 最小只读持久模型

- [x] 15.1 Red: 在 Project Work capability 新增 application/PostgreSQL 失败测试，使用受控 fixture 建立 Project 和 Project Membership，覆盖 Workspace Membership 前置、Project Membership 子集、同一 User/Workspace 对齐、跨 Workspace 关联拒绝或排除、无 Project 的真实空集合；不得为测试增加产品 Project create API。
- [x] 15.2 Green: 实现 Project list 所需的最小 Project/Project Membership 持久事实、migration、fixture helper 和 Access 提供的窄 Workspace authorization contract；Project Work 拥有查询与 Project 授权，禁止跨 capability 私表读取。运行 Project focused unit/module/integration tests 至通过。
- [x] 15.3 Refactor: 用约束、索引和显式 Workspace predicate 收口父作用域一致性，完整性信号不得泄露跨 Workspace 标识；运行 Spring Modulith/ArchUnit 与 Core API `qualityCheck`。

## 16. Workspace-scoped Project list HTTP 与 OpenAPI 契约

- [x] 16.1 Red: API/security/contract tests 固定 bearer-protected `GET /desktop/v1/workspaces/{workspaceId}/projects`、可选 opaque `cursor`、`limit` 默认 50 且范围 1–100、未知 query 拒绝、稳定服务端排序和 `200 { items: [{ projectId, workspaceId, name }], nextCursor? }`；覆盖 `400 VALIDATION_FAILED`、`401 AUTHENTICATION_REQUIRED`、不可访问与不存在统一 `404 WORKSPACE_NOT_FOUND`、`503 PROJECTS_TEMPORARILY_UNAVAILABLE`。
- [x] 16.2 Green: 在 Project Work capability 实现 Workspace-scoped list query 和 Desktop adapter；只返回当前 User 同时具有有效 Workspace Membership 与 Project Membership 的 Project，每个 item 恰好包含冻结字段，cursor 不跨 Workspace 复用。
- [x] 16.3 Refactor: 将 Project path/query/schema/security/errors 纳入 runtime OpenAPI 与 Main-consumer fixtures；确认没有 `POST Project`、Project mutation use case、`canCreateProject` 或创建 capability。运行 Project API/module/integration/OpenAPI tests 与 Core API `qualityCheck`。

## 17. MVP ingress 边界确认

- [x] 17.1 边界确认（TDD 不适用）：以 source/tree negative scan 和 owning architecture 证明当前认证、Workspace onboarding 与 Project list 请求由 Desktop Main 经 Edge/TLS 直接访问 Core API，Core API 验证 bearer token 并执行最终授权；确认本 Change 没有初始化、修改或依赖 Gateway。未来若出现多后端、多 API surface 或集中边缘策略需求，使用独立 Change 引入 Gateway，且不得削弱 Core API 最终认证和授权。

## 18. Desktop Main/Preload Workspace capability

- [x] 18.1 Red: 新增 Main cloud-client 和 Preload contract 失败测试，覆盖列出/创建 Workspace 的窄 API、IPC sender/origin/schema 拒绝、`creationRequestId` 到 HTTP `Idempotency-Key` 的映射且 body 仅含 `name`、serializable error union、认证失效/暂态错误映射，以及 token、通用 HTTP、Electron 对象不进入 Renderer；运行 `pnpm --filter @taskpilot/desktop test:main` 和 `test:architecture`，确认因目标能力缺失而失败。
- [x] 18.2 Green: 实现 Main-owned authenticated Workspace client、session cleanup、IPC handler 和 typed Preload capability；Main 验证输入但 Core API 保持最终授权。运行 `pnpm --filter @taskpilot/desktop test:main`、`test:architecture` 和 `typecheck` 至通过。
- [x] 18.3 Refactor: 集中 channel ownership、schema/error mapping 和生命周期清理，不增加 generic `send`/`invoke`/HTTP bridge；运行 `pnpm --filter @taskpilot/desktop qualityCheck`。

## 19. Organization-first Renderer 进入与创建体验

- [x] 19.1 Red: 在 Preload fake 边界新增 Renderer 失败测试，覆盖已有 Workspace、无 Workspace有/无创建能力、创建成功切换、非法输入、未认证、权限/策略拒绝、冲突、离线和网络结果未知时保留输入与同一 `creationRequestId`；运行 `pnpm --filter @taskpilot/desktop test:renderer`，确认因页面/交互行为缺失而失败。
- [x] 19.2 Green: 在实现前读取 `frontend-design`，按已批准 Target 视觉方向实现 Workspace entry/switcher、创建表单、启动恢复和提交/错误/离线状态；不显示类型选择、不解析角色名，capability 决定操作可用性。成功选择或创建后建立活动 `WorkspaceId` 并交接给 Project list loading state。
- [x] 19.3 Refactor: 按 `vercel-react-best-practices` 整理页面组成、query adapter、纯展示 policy、渲染和 bundle 边界，补齐键盘、焦点恢复、错误摘要、中英文、最小窗口和 reduced-motion 自动断言；运行 Renderer tests、architecture checks 和 `qualityCheck`。

## 20. Desktop Project list capability 与只读 surface

- [x] 20.1 Red: Main/Preload contract tests 覆盖窄 `listProjects({ workspaceId, cursor?, limit? })`、固定 endpoint/query allowlist、opaque cursor 原样传递、sender/frame/session generation、401 single-flight、serializable page/error union、item `workspaceId` mismatch 整页拒绝，以及 token/角色/通用 HTTP 不可达。
- [x] 20.2 Red: Renderer tests 覆盖 Project loading、有数据、真实空状态、分页、`400/404/503` 恢复、重复 load-more 防护、Workspace 切换迟到响应、账号/environment 隔离；空状态仅提供刷新或切换 Workspace，不显示 Create Project、`canCreateProject` 或不可操作承诺。
- [x] 20.3 Green: 实现 Main-owned Project list adapter、typed Preload capability 和 Renderer Project list surface。query key 至少包含 environment、`UserId`、`WorkspaceId`；切换 scope 时取消或隔离旧请求和 cursor；`404 WORKSPACE_NOT_FOUND` 清理无效活动 Workspace 并重新加载权威 Workspace list。
- [x] 20.4 Refactor: 集中 Project page schema、query-key factory、分页 reducer、scope guard 与错误 presentation；按 React/UI Skills 完成实现和最终可访问性 review，运行 Main/Renderer/architecture/quality checks。

## 21. 活动 Workspace 隔离、启动恢复与 Runtime 独立

- [x] 21.1 Red: 使用可控 deferred response 新增旧 Workspace/Project page 迟到响应、0/1/N Workspace 启动恢复、最近 Workspace 授权撤销、跨 environment/account 不恢复、Project item scope mismatch，并在不注册 Runtime fake 时新增完整 onboarding/list 与“不启动 Runtime supervisor”测试。
- [x] 21.2 Green: 创建/切换时更新或失效 Workspace list，所有 Project state/query key 使用 environment + `UserId` + `WorkspaceId`，登出/换账号/换 environment 或授权撤销时清理 scope；确保认证、onboarding 和 Project list 不启动、不探测也不等待 Runtime。
- [x] 21.3 Refactor: 集中活动 Workspace 恢复、session cleanup 和 Project scope guard，不以 Workspace 名称定位上下文；运行 `test:renderer`、`test:main`、`test:architecture` 和 `qualityCheck`。

## 22. 完整首次使用链路与发布收口

- [x] 22.1 Authentication journey: 以真实 Main/Preload、真实 Core API/PostgreSQL 和 fake mail adapter 完成注册、密码登录、验证码登录、reset 后新密码登录、refresh 和 logout。
- [x] 22.2 First-use journey: 在同一集成环境完成注册/登录 → `CurrentUserView` → Workspace list → 创建/选择 Organization Workspace → 初始 Workspace Membership → 建立活动 `WorkspaceId` → `GET Project list` → 有数据或真实空状态；使用受控 DB fixture 建立 Project/Project Membership，断言相同 `creationRequestId` 安全重试且 Runtime 零调用。
- [x] 22.3 Security/recovery: 覆盖枚举、暴力尝试、purpose replay、创建账户未知结果、并发 consume/register/refresh/create、refresh 响应丢失/崩溃恢复、401 single-flight、mail/DB 暂不可用、session revoke、Workspace/Project 迟到响应、双重 Membership 授权、跨 Workspace 关联、cursor 隔离和 Production Swagger；全部 fail closed 且可恢复。
- [x] 22.4 Contract integration: 用 runtime OpenAPI 与 Main adapter fixtures 验证全部 auth/workspace/project-list schema、安全声明、稳定错误、`refreshRequestId`、Workspace 创建幂等、Project path/query/page/cursor/404，并仅在 Main transport fixture 验证 `type: PERSONAL` 可解析；不生成客户端或 compatibility gate。
- [x] 22.5 Negative scope: 自动扫描和源审查确认没有 Project create endpoint/use case/CTA、`canCreateProject`、Project detail/edit/delete/member-management UI/API、Gateway runtime 或 onboarding/list Runtime 依赖。
- [x] 22.6 Packaged/native evidence: 运行 portable Main/Renderer/Cypress checks 与当前执行平台的 packaged/native 自动化，验证 credential 写入/跨进程恢复/轮换/删除及完整首次使用 journey；最小窗口、键盘、关键错误和 reduced-motion 由无 GUI 自动断言覆盖。macOS/Windows 安装、系统 credential 集成、签名和最终视觉观感保留为对应平台发布前 smoke，不阻塞本 Change，也不得以单平台结果宣称另一平台 release-ready。
- [x] 22.7 Local development stack and mail smoke: 提供一条清晰命令启动 Docker Compose 真实 PostgreSQL + Mailpit、Core API `local` profile 和连接固定本地 origin 的 Desktop；本地随机 secret 不提交仓库，Production SMTP TLS fail-closed 不放松。自动从 Mailpit 读取实际邮件并完成注册、登录 OTP 和 password reset；真实外部 Provider smoke 移为不阻塞本 Change 的部署/发布门禁。
- [x] 22.8 Final gates: 运行 Core API clean `qualityCheck`、Desktop `qualityCheck`、headless Cypress、当前平台 packaged/native gate、`openspec validate add-desktop-authentication-and-workspace-onboarding --strict --no-interactive`、scoped `git diff --check`、Gateway/Runtime/旧方案 negative scan，并确认覆盖率 critical branches 无绕过路径。对应平台发布 smoke 与本 Change 完成状态分离。
- [x] 22.9 Source/UI review: 审查密码/OTP/token/continuation、API/IPC、限流、数据库唯一性/事务/幂等、session、Workspace/Project scope、OpenAPI、依赖和 Current/Target 表述；按 `web-design-guidelines` 修复 material UI findings，问题回到对应 TDD slice。
