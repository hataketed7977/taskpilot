# Tasks

## 1. 基线、边界与依赖确认

- [ ] 1.1 基线核对（行为 TDD 不适用）：重新读取 root 与 Core API/Desktop 的 AGENTS、architecture、responsibilities、testing strategy 和活动 Change；确认 foundation、Desktop scaffold、onboarding/design foundation 的实际状态及不得覆盖文件。记录 `git status --short`、`openspec list --json`、项目与影响清单；material 冲突先更新 Change。
- [ ] 1.2 Provider 协议确认（行为 TDD 不适用）：依据官方资料确认目标 issuer 支持 discovery、Authorization Code + PKCE S256、native public client、数值 loopback 动态端口与注册 path、JWT access token、nonce、托管 Passwordless Email OTP 及适用 refresh/revocation；记录配置键和 fail-closed 规则，不提交 secret。若不满足则停止并修订方案。
- [ ] 1.3 依赖选择（行为 TDD 不适用）：依据实际 Spring Boot 4 和 Electron/Node toolchain 选择兼容稳定 OIDC/JWT、springdoc 与 credential 组件；完成 dependency resolution、lockfile、编译和 startup smoke，不为方便降级 foundation。
- [ ] 1.4 Target 文档对齐（行为 TDD 不适用）：更新 business model 的 ExternalIdentity/User 关系与 email 投影规则，以及实际受影响的 root/Core API/Desktop 文档；明确托管 Email OTP、Core API Resource Server、Main credential ownership、bootstrap/me、Swagger、onboarding handoff 和 Gateway 延后条件。按需运行链接检查、Mermaid renderer、strict validate 与 diff check。

## 2. Core API 可信 principal 与 Security 边界

- [ ] 2.1 Red: `moduleTest` 使用测试签名 JWT 覆盖有效请求，以及缺失、过期、nbf、坏签名、`none`、非允许算法、错误 issuer/audience、缺 subject、伪造 identity/email/tenant/role header 和 JWKS outage；成功路径应因 Resource Server 缺失失败，负向路径断言未进入 use case。
- [ ] 2.2 Green: 增加最小 JWT Resource Server、精确 issuer/audience/time/subject/algorithm validator、Desktop matcher、principal adapter 和 `401 AUTHENTICATION_REQUIRED`/`503 AUTHENTICATION_TEMPORARILY_UNAVAILABLE` Problem Details；保留 actuator 策略及其余路由 fail closed。
- [ ] 2.3 Refactor: 将 Spring Security/JWT 类型限制在 adapter，使用可控 clock/JWKS seam，集中 secret-safe error mapping；扩展 ArchUnit fixture 并运行 Core API test/moduleTest/Kover/build-contract。

## 3. User 与 External Identity 持久化

- [ ] 3.1 Red: 写 Access unit/application 与 PostgreSQL integration tests，覆盖首次/重复映射、相同 email 不同 subject 不合并、未验证 email 不投影、profile 变化不换 UserId、issuer/subject 边界、rollback 和 barrier 并发 bootstrap。
- [ ] 3.2 Green: 增加 typed UserId/ExternalIdentityId、framework-free model/application port、migration、`unique(issuer, subject)`、repository adapter 和事务 bootstrap/upsert 冲突恢复，保证并发同一 UserId。
- [ ] 3.3 Refactor: 收敛精确 issuer、opaque subject 和批准 profile projection，确保持久化类型不泄漏；运行 test/moduleTest/integrationTest、Modulith 和 ArchUnit。

## 4. Desktop session bootstrap 与当前用户 API

- [ ] 4.1 Red: API/module tests 覆盖 `POST /desktop/v1/session/bootstrap` 首次/重复 `200` 同一 CurrentUserView、`GET /desktop/v1/me` 只读成功、`409 USER_BOOTSTRAP_REQUIRED` 且 row count 不变、`401 AUTHENTICATION_REQUIRED`、适用 `503`，以及无 issuer/subject/token/Provider role 泄漏。
- [ ] 4.2 Green: 实现最小 Desktop controller、strict transport、application calls 和 Problem Details；POST 幂等，GET 不写库，错误含 correlation identifier。
- [ ] 4.3 Refactor: 集中 DTO/profile/error mapping，controller 不直达 repository/internal type；运行 focused tests 与 qualityCheck。

## 5. 运行时 OpenAPI 与 Swagger UI

- [ ] 5.1 Red: 写 runtime OpenAPI contract 和 profile tests，覆盖两端点、JWT scheme、CurrentUserView、稳定 `401/409/503`、Local/Test enabled、Production endpoint/static resource disabled、`persistAuthorization=false` 及 canary secret scan。
- [ ] 5.2 Green: 引入兼容 springdoc starter，配置独立 Desktop group、security scheme、Problem Details schema 和 profile properties；不生成 YAML/client，不放宽业务 API security。
- [ ] 5.3 Refactor: 删除重复 annotations/customizer，确认 Swagger 临时 token 不持久化，运行 focused、Production startup 与 Core API qualityCheck。

## 6. Desktop scaffold 与认证测试基座

- [ ] 6.1 Scaffold（行为 TDD 不适用）：若 Desktop 尚未初始化，按 Electron/React/strict TypeScript/Vite/pnpm Target 建立 Main/Preload/Renderer/shared-ipc、production build、Cypress Renderer integration、Main runner 和 architecture fixtures；已有 scaffold 则增量复用。验证 lockfile、typecheck、lint、build 和 runner self-tests。
- [ ] 6.2 Gate contract（行为 TDD 不适用）：建立或确认 `test:main`、`test:renderer`、`test:architecture`、`typecheck`、`lint`、`build`、`qualityCheck` 和可选择 `--auth` 的 `test:packaged`；qualityCheck 不包含必须分 OS 执行的 native matrix。

## 7. Main OIDC 与托管 Email OTP 边界

- [ ] 7.1 Red: 使用 deterministic random/clock、browser opener、loopback listener 和 fake OIDC server，覆盖单一“使用邮箱继续”入口、已有/首次 Email OTP 后的标准成功结果、Provider OTP 错误/过期/频控安全映射、PKCE、先监听后开浏览器、数值 loopback 动态端口、注册 fixed path、state、token nonce、issuer/audience/azp/算法/时间、超时、重复、取消、固定安全回调页和 Runtime 零调用。
- [ ] 7.2 Green: 实现单活动 AuthAttempt、注册兼容 loopback、system browser、code exchange、ID Token validation 和一次性秘密销毁；不实现或暴露 OTP API，重复点击只聚焦等待状态。
- [ ] 7.3 Refactor: 分离状态机、OIDC protocol 与 OS I/O，统一 Provider 安全错误类别和 redaction；运行 Desktop Main/architecture/typecheck/lint。

## 8. Main credential、refresh 与 logout 生命周期

- [ ] 8.1 Red: 覆盖 credential restore/unavailable、无明文降级、single-flight、rotation、invalid_grant/重放、单请求最多一次重试，以及 generation-first logout、隔离撤销副本销毁、撤销超时/失败和迟到 refresh 竞态。
- [ ] 8.2 Green: 实现 Main-owned coordinator、按 issuer/client/account 分区的 credential adapter、cloud client、session epoch 与本机优先 logout；Renderer/URL/log/env/command line 均无 credential。
- [ ] 8.3 Refactor: 集中 credential key、redaction、retry/generation guard，确保迟到结果不能复活；运行 Main/architecture/typecheck/lint 和当前平台 credential smoke。

## 9. 窄 Preload 认证能力

- [ ] 9.1 Red: Main/Preload contract 覆盖 `beginAuthentication`、`cancelAuthentication`、`getSessionView`、`subscribeSessionView`、`logout` 的 schema、sender frame/origin/session、非法/陈旧调用，以及 OTP/token/code/verifier/Provider object/通用 HTTP 不可达。
- [ ] 9.2 Green: 实现显式 channel owner、validated handler 和 typed capability，只传递 session view、安全用户视图与稳定 error union。
- [ ] 9.3 Refactor: 收敛 schema、allowlist、订阅释放和窗口生命周期，不增加 generic bridge；运行 Main/architecture/qualityCheck。

## 10. Renderer 登录体验

- [ ] 10.1 Design preparation（行为 TDD 不适用）：按 Desktop Skill routing 使用 `frontend-design`，把 design foundation 与认证 spec 映射为单一“使用邮箱继续”、awaiting、cancelled、expired、offline、temporarily-unavailable、authenticated、reauthentication-required 状态，确认键盘、焦点、reduced-motion 和安全文案。
- [ ] 10.2 Red: 在 Preload fake 边界用 Cypress 覆盖初始入口、等待、阻止重复提交、取消、超时、离线、Provider 安全错误类别、成功 bootstrap/handoff、重新认证、登出/缓存清理、键盘/focus/a11y；DOM/state 不含 OTP、token 或原始 Provider error。
- [ ] 10.3 Green: 使用 `vercel-react-best-practices` 实现最小 auth boundary、session adapter 与 quiet control desk 登录页；成功后只交接 Workspace onboarding capability，不调用 Workspace list/create，不启动 Runtime。
- [ ] 10.4 Refactor: 集中状态文案、焦点恢复、取消/重试和 cache reset；使用 `web-design-guidelines` review 并修复 material findings，运行 Renderer/Main/architecture/qualityCheck。

## 11. 跨边界与原生收口

- [ ] 11.1 Automated journey: 以 fake OIDC/JWKS 和真实 Core API/PostgreSQL 运行浏览器协议到 bootstrap/me，断言 Core API 验证 token、User 幂等创建、响应无凭据、Workspace API 与 Runtime 均未调用；运行 focused suites 和 qualityCheck。
- [ ] 11.2 Failure/recovery: 覆盖 Provider/JWKS 暂不可用、OTP Provider error 安全映射、callback replay、网络结果未知、refresh 拒绝、logout/迟到响应、重启恢复和 Production Swagger 不可达；均 fail closed 且可恢复。
- [ ] 11.3 Packaged/native evidence: 用 fake OIDC 运行 `test:packaged -- --auth`，并在 macOS arm64 与 Windows x64 分别验证浏览器 handoff、loopback callback、credential 写入/恢复/删除和登出；平台结果不互相替代。
- [ ] 11.4 Provider smoke: 在隔离测试租户人工或受控自动完成一次托管 Email OTP 登录、bootstrap/me/logout；secret 只来自 CI secret store，截图/日志脱敏，不将真实 Provider 作为常规 CI 依赖。
- [ ] 11.5 Final gates: 运行 Core API clean qualityCheck、Desktop qualityCheck、适用 packaged/native gates、strict OpenSpec validation 和 scoped diff check；确认 Core API line ≥ 80%、branch ≥ 75%，认证 critical branches 100% 或逐项批准且无绕过路径。
- [ ] 11.6 Source review: 审查 OTP/secret handling、日志/遥测/错误、API/IPC、Core API token validation、数据库唯一性/事务、Swagger production/authorization persistence、Gateway 未被意外初始化、依赖许可证/漏洞及 Current/Target 表述；material findings 回对应 TDD slice。
