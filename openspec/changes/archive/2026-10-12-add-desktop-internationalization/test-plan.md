# Test Plan

## Scope and Risk

范围覆盖 Desktop Renderer locale 解析/持久化、双语消息目录、即时切换、当前 Auth/Account UI、版本化法律资源、最小窗口布局，以及 Core API 法律 locale 白名单、注册校验和本地配置。主要风险为：用户看到混合或错误语言；切换语言破坏 OAuth/注册状态；旧语言的同意被错误复用；英文法律组合无法注册或错误写入接受证据；缺失资源静默回退成另一语言法律文本；新依赖扩大 Renderer 信任边界。

逃逸缺陷可导致首次注册被阻断、法律接受证据与实际阅读文本不一致、认证流程丢失或不可访问，因此法律组合和状态保持是高风险，普通消息/布局是中风险。本 Change 不验证第三种语言、服务端错误文案翻译、远程语言包、跨设备偏好、Google/Lark、发布签名或完整 Windows/macOS 发布矩阵。

业务身份、授权、租户和并发注册不变量不变；只需用已有测试确保多 locale 校验没有绕过原子注册与 ExternalIdentity 唯一性。没有新的重试或异步流程；恢复风险集中在损坏本地偏好和运行时切换不应重建当前 auth flow。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| 系统语言优先级映射、持久化优先、无效值与 Storage 异常 | Pure unit | locale resolver/store tests 注入 `['fr-FR', 'zh-CN']`、`['en-US', 'zh-CN']`、`['fr-FR']`、有效/损坏值及抛错 Storage | 纯决策无需 React 或 Electron，可穷举跳过、顺序和默认边界且确定性最高 |
| `zh-CN/en` 消息 key parity、`en` fallback、插值保持文本 | Pure unit / architecture | catalog parity 与 fallback tests；源规则拒绝 remote backend、危险 HTML 和残留产品硬编码 | 防止漏译被长期掩盖及扩大资源信任边界 |
| 登录/等待/失败/账号页即时切换且不重新请求 capability、不改变 flow/session | Renderer integration | 在各代表状态切换 selector，断言文案/`html lang` 改变、API 调用次数和 flow/user 保持 | React subscription 与组件状态耦合只能在 Renderer 层可靠证明 |
| 键盘、可访问 label、焦点保持和状态公告本地化 | Renderer integration / Cypress | user-event 与 Cypress 键盘操作，检查 select 名称/值、focus、role status/alert | 浏览器语义和焦点行为需要 DOM/Chromium 证据 |
| 注册页切换 locale 保留资料但清除同意 | Renderer integration | 填写显示名称/头像、勾选、切换、断言草稿保留、checkbox 清空、submit 受阻 | 直接保护法律状态转换和用户数据不丢失 |
| 法律 catalog 精确四元组、缺失资源 fail closed、日期格式 | Pure unit / Renderer integration | legal resolver 双 locale、未知 bundle/locale、UTC date formatter 和 disabled registration tests | 将版本算法与 UI 阻断分别放在最低可靠层 |
| 两种 locale 注册成功并保存精确法律四元组 | Core API application/infrastructure integration | 参数化 `zh-CN/en` 注册，查询 PostgreSQL acceptance 并以 `(locale, legalBundleVersion, termsVersion, privacyVersion)` 回读证据；断言同一 User/ExternalIdentity 事务结果 | 必须跨服务校验与真实持久化证明接受证据正确且版本字段未脱离 locale 解释 |
| 未知 locale/错误版本拒绝且无长期事实 | Core API application/infrastructure integration | 提交 `fr`、错 bundle/terms/privacy，断言 `LEGAL_BUNDLE_REJECTED` 且无 User/identity/acceptance | 保护 fail-closed 与原子性，不用 UI 测试替代服务端权威 |
| locale 白名单配置有效性与 capability fail closed | Core API configuration/module | 合法双值、空/非法/重复配置的 focused tests | 配置绑定和启动条件属于 Spring 配置边界 |
| HTTP/OpenAPI 与数据库 schema 不改变 | Core API contract / migration regression | Authentication/OpenAPI/AccessIdentityMigration integration tests | 捕获意外 DTO、path、schema 或 migration 扩张 |
| 英文最长文案与双语最小窗口可达 | Cypress component + visual review | 代表性 login/registration/error/legal/account 状态在最小与标准 viewport，断言无横向丢失且主操作可达 | CSS 布局风险需真实 Chromium；自动断言不足部分由人工截图审阅补充 |
| 离线切换不发网络请求 | Renderer integration | capability 已失败或离线状态下切换，断言没有新增 auth/API 调用 | 防止引入远程加载或错误副作用 |
| reduced-motion 与现有安全边界不退化 | CSS/architecture regression | 既有 architecture tests、Cypress reduced-motion fixture、完整 Desktop quality gate | 复用现有安全和可访问性门禁而非重复所有断言 |

## Implementation and Verification Approach

### Slice 1: Locale core、静态消息和持久化

对语言解析、存储异常、消息 parity/fallback 使用 Red-Green-Refactor：先增加会失败的纯测试，再引入依赖、i18n factory、typed locale 与 storage adapter，最后抽取重复逻辑。依赖/lockfile 和 architecture guard 属于配置与边界变更，直接实现并用安装、lint、build 和源码规则验证，不制造 TDD 过程。

### Slice 2: 法律 catalog 与 Core API locale 白名单

法律同意是清晰且高风险的业务行为，采用 Red-Green-Refactor：先参数化服务端测试证明 `en` 当前被拒绝并锁定未知 locale/错误版本无写入，再将单 locale 配置重构为白名单；同时先写 Desktop legal resolver/切换同意测试，再增加英文版本资源与精确解析。生产行为和测试在同一 slice 落地，不先开放服务端任意 locale。

### Slice 3: 当前 Renderer 全量文案迁移与语言选择

先以 Renderer integration 锁定即时切换、auth flow/session 保持、`html lang`、焦点和注册草稿行为，再迁移当前 UI 全部产品文案并添加 selector。Cypress 只覆盖 distinct browser/viewport/keyboard 风险，不在每个测试层重复所有状态。使用 `frontend-design` 确认 selector 的稳定位置与双语布局，实施时遵循 `vercel-react-best-practices`，完成后用 `web-design-guidelines` 审查。

### Slice 4: 文档、配置和跨边界收口

直接更新 `.env.local.example`、本地配置和 owning docs；通过配置 tests、全量门禁、OpenSpec strict validation 和 model-drift audit 验证。代码证据确认后再把 Desktop i18n TODO 从 Target 更新为 Current，并准备 delta-spec sync；测试通过不替代该语义核对。

## Verification Commands

### Focused

- `pnpm --filter @taskpilot/desktop exec vitest run --config vitest.config.ts tests/renderer/internationalization.test.tsx tests/renderer/auth-experience.test.tsx`：语言解析后的 React 更新、Auth/Account 状态保持、法律切换与可访问交互。
- `pnpm --filter @taskpilot/desktop test:architecture`：静态资源、Renderer/Main 边界、remote backend/危险 API 和生产文案迁移约束。
- `pnpm --filter @taskpilot/desktop test:e2e`：双语关键旅程、键盘行为与最小窗口布局；该套件规模较小且由 Desktop testing strategy 指定为 browser gate。
- `./gradlew --no-daemon :services:core-api:test --tests 'ai.taskpilot.coreapi.access.FederatedAuthenticationServiceTest' --tests 'ai.taskpilot.coreapi.FederatedIdentityPersistenceIntegrationTest' --tests 'ai.taskpilot.coreapi.AuthenticationHttpIntegrationTest'`：双 locale 注册、实际 locale 持久化、拒绝无副作用及 HTTP 错误映射。
- `./gradlew --no-daemon :services:core-api:test --tests 'ai.taskpilot.coreapi.OpenApiIntegrationTest' --tests 'ai.taskpilot.coreapi.AccessIdentityMigrationIntegrationTest'`：确认 API/schema 未被意外改变。

### Affected and Cross-Boundary

- `pnpm --filter @taskpilot/desktop qualityCheck`：Desktop typecheck、lint、Main/Renderer/architecture/coverage 和 build 完整门禁。
- `./gradlew --no-daemon :services:core-api:qualityCheck`：Core API 编译、格式、静态分析、完整测试、覆盖率和构建边界。
- `pnpm dev:test`：`.env.local`、配置解析和开发控制脚本回归（若法律 locale 环境键由脚本读取）。
- `pnpm dev:smoke`：隔离本地栈 capability 与配置启动 smoke，不调用真实 GitHub。
- `pnpm check`：最终受影响仓库门禁，覆盖 Launcher、Desktop 和 Core API。
- `openspec schema validate taskpilot-sdd --verbose`：项目 schema 保持有效。
- `openspec validate add-desktop-internationalization --strict --no-interactive` 与 `openspec validate --all --strict --no-interactive`：Change 和全体 specs/artifacts 严格结构验证。
- `git diff --check`：空白和补丁格式检查。

## Manual Evidence and Automation Gaps

实现者在当前 macOS 开发环境运行一次本地 Desktop smoke，分别以 `zh-CN/en` 查看登录、等待、首次注册、两份法律文档、错误和账号页；在最小与标准窗口确认 selector 位置、长英文换行、焦点、缩放和视觉层级，并用键盘切换语言。随后使用真实 GitHub 开发 OAuth 账号完成一次英文首次注册，确认服务端接受且账号页保持英文。

原因：自动测试可证明 DOM、版本和请求，但不能充分证明真实系统字体、Electron 原生 select、系统浏览器 OAuth 联动及法律英文文本的人类可读性。Owner 为本 Change 实现者；记录日期、平台、locale 和结果，不记录 OAuth code/token、个人资料或敏感截图。该证据不宣称 Windows、签名安装包或生产 OAuth 配置已验证；对应发布 feature 仍需独立平台证据。
