# Tasks

## 1. Locale Core 与静态消息基础

- [x] 1.1 **Red：**新增 locale resolver、偏好存储、消息 key parity/fallback 和 Storage 异常测试，至少覆盖 `['fr-FR', 'zh-CN']` 跳过后匹配中文、`['en-US', 'zh-CN']` 保持优先英文和 `['fr-FR']` 默认英文；执行 `pnpm --filter @taskpilot/desktop exec vitest run --config vitest.config.ts tests/renderer/internationalization.test.tsx`，确认失败只来自尚未实现的语言解析与目录行为。
- [x] 1.2 **Green：**引入并锁定 `i18next`、`react-i18next`，实现 `SupportedLocale`、静态 `zh-CN/en` 消息目录、隔离 i18n factory、系统语言解析、安全 localStorage adapter 与 `html lang` 同步，使 1.1 测试通过且不增加 remote backend 或 Main/Preload IPC。
- [x] 1.3 **Refactor：**整理消息 namespace、类型与格式化 helper，增加 architecture guard 以禁止远程语言包、危险 HTML 和非法跨进程依赖；执行 `pnpm --filter @taskpilot/desktop test:architecture` 与 `pnpm --filter @taskpilot/desktop typecheck`。
- [x] 1.4 更新 `apps/desktop/docs/architecture.md` 和 `responsibilities.md` 中 locale owner、持久化、静态资源、fallback 与信任边界的 Current/Target 描述，证据为文档与 1.2 实现一致且链接/所有权未漂移。

## 2. 双语法律组合与服务端白名单

- [x] 2.1 **Red：**参数化 Core API 注册测试覆盖 `zh-CN/en` 精确四元组成功、未知 locale/错误版本拒绝无长期写入、完整 `(locale, legalBundleVersion, termsVersion, privacyVersion)` 持久化/回读及非法配置；执行 test plan 中 focused Gradle 命令，确认英文成功场景因当前单 locale 行为失败，而既有安全断言仍通过。
- [x] 2.2 **Green：**将 Core API 单一 `legalLocale` 调整为规范、去重、有限的 `legalLocales` 白名单，以 locale 与共享版本三元组共同校验精确四元组，保持 HTTP DTO、数据库 schema 与原子注册不变；同步 `application-local.yml`、`.env.local.example` 和开发配置解析，使 2.1 通过。
- [x] 2.3 **Red：**增加 Desktop legal catalog 测试，覆盖两种 locale 的精确法律四元组解析、UTC 日期格式、缺失/未知组合 fail closed，以及注册页切换语言保留资料但清除同意；确认失败来自英文法律资源和切换规则缺失。
- [x] 2.4 **Green：**将法律资源重构为 `locale -> versioned bundle` catalog，增加经审阅的英文用户协议与隐私政策，注册提交实际展示的 locale/version，并在切换语言时只失效法律同意，使 2.3 通过且不允许法律文本跨语言 fallback。
- [x] 2.5 **Refactor：**复用法律解析/格式化 helper，执行 `FederatedAuthenticationServiceTest`、`FederatedIdentityPersistenceIntegrationTest`、`AuthenticationHttpIntegrationTest`、`OpenApiIntegrationTest` 和 `AccessIdentityMigrationIntegrationTest`，确认双语法律四元组接受证据正确且 API/schema 无漂移。
- [x] 2.6 更新 `docs/business-model.md`、`docs/architecture.md`、`services/core-api/docs/architecture.md`、`responsibilities.md` 和 `testing-strategy.md`，把精确文本标识校准为 `(locale, legalBundleVersion, termsVersion, privacyVersion)` 四元组，并记录多 locale 法律组合白名单、接受证据与校验责任；不把 locale 描述为 User 属性或服务端通用 i18n。

## 3. 当前 Auth/Account 界面完整国际化

- [x] 3.1 按 `frontend-design` 对当前既有视觉语言做轻量设计检查，确定登录/等待/注册/协议/账号页共用 selector 的位置、最小窗口、最长英文、focus、error、reduced-motion 和非目标；不重做页面或引入组件库。
- [x] 3.2 **Red：**扩展 Renderer integration 测试，覆盖未登录与已登录 selector、即时切换、`html lang`、键盘/focus、状态公告、离线切换无网络调用，以及 auth flow/session/表单保持；确认失败来自尚未迁移的硬编码 UI。
- [x] 3.3 **Green：**遵循 `vercel-react-best-practices` 添加共用 `LanguageSelector` 和 locale provider，将当前 Renderer 中所有产品文案、aria 文案、错误与状态迁入目录，使 3.2 通过；稳定品牌/provider、用户内容和机器值保持原样。
- [x] 3.4 **Refactor：**在不扩大页面架构的前提下抽取最小组件/translation helper，删除遗留的可翻译硬编码和过期单例法律引用；运行 focused Renderer tests、lint 与 typecheck。
- [x] 3.5 扩展 Cypress 双语旅程，在最小和标准 viewport 验证 login/registration/error/legal/account、键盘操作、最长英文可达性和 reduced-motion；执行 `pnpm --filter @taskpilot/desktop test:e2e`。
- [x] 3.6 按 `web-design-guidelines` 审查已实现界面的可访问性与交互并修复 material finding；更新 `apps/desktop/docs/testing-strategy.md` 和 `design-foundation.md`，把双语/最长文案/切换验收从 TODO 收口为 Current 规则。

## 4. Model and Documentation Reconciliation

- [x] 4.1 对照 proposal、delta specs 和 design 检查代码、依赖、配置、API、数据库、测试及运行证据，确认 User/ExternalIdentity/session 模型未变、`TermsAcceptance` 的法律四元组完整记录实际阅读文本、任何审计/解析均未脱离 locale 解释版本字段、无远程资源或通用 IPC，并解决或记录所有 material drift。
- [x] 4.2 将稳定结论反馈到 owning business-model、root/child architecture、responsibilities、testing/design 文档；移除已完成的 Desktop i18n TODO，校准 Current/Target 状态，并确认 `desktop-api-documentation` 因 API 形状未变无需 delta。
- [x] 4.3 运行 `pnpm --filter @taskpilot/desktop qualityCheck`、`./gradlew --no-daemon :services:core-api:qualityCheck`、`pnpm dev:test`、`pnpm dev:smoke` 和 `pnpm check`，保留各门禁真实结果，不以局部测试代替失败的全量检查。
- [x] 4.4 运行 `openspec schema validate taskpilot-sdd --verbose`、`openspec validate add-desktop-internationalization --strict --no-interactive`、`openspec validate --all --strict --no-interactive` 与 `git diff --check`，确认 artifacts、全体 specs 和补丁有效并达到 delta-spec sync/archive readiness。
