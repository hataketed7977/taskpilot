# Design

## Context

见 `proposal.md - Why`。当前 Renderer 的全部文案集中硬编码在 `App.tsx`，法律资源只有 `zh-CN`，并通过全局 `CURRENT_LEGAL_BUNDLE` 解析；语言选择、格式化和测试没有统一边界。Desktop Main/Preload 不需要语言来完成认证，Core API 已接收并持久化 `locale`，但其 `currentLegalBundle` 目前只允许一个 locale，因此单纯增加英文 UI 会在首次注册时被服务端拒绝。

实现必须保持 Renderer sandbox、context isolation 和窄 Preload 能力不变。语言资源应随应用打包、离线可用，不应把本地展示偏好升级为账号属性。`apps/desktop/docs/testing-strategy.md` 继续拥有测试层次；本设计只明确本 Change 的 seam。

## Goals / Non-Goals

**Goals:**

- 用一个明确的 Renderer locale owner 管理启动解析、消息目录、格式化、即时切换和设备持久化。
- 让当前 Auth-only 产品表面在 `zh-CN/en` 下完整可用，并保持既有 Semi 风格视觉语言、焦点和状态。
- 让法律文档按 `(locale, legalBundleVersion, termsVersion, privacyVersion)` 精确解析，且 Core API 对两种获批 locale 执行相同的原子注册校验。
- 通过纯函数和注入式存储 seam，使语言解析、失败恢复和法律不变量可确定性测试。

**Non-Goals:**

- 不增加第三种语言、地区变体选择、翻译管理平台、远程语言包、按需网络加载或自动机器翻译。
- 不国际化 Core API Problem Details、日志、OpenAPI 文档或浏览器 callback 页；Renderer 继续按稳定错误 code 生成本地化用户说明。
- 不把 locale 同步到 User profile、PostgreSQL 偏好表、Redis session、Main credential 或跨设备账号设置。
- 不改变 OAuth/session 协议、HTTP DTO、数据库 schema、User/ExternalIdentity 模型、登录 provider 或应用导航。
- 不借机拆分整个 `App.tsx`、引入新组件库或重做登录视觉设计；只做国际化所需的最小组件边界。

## Business Model

本 Change 使用关系映射和 scenario/example mapping。语言偏好由“本设备上的 Desktop 安装”拥有，对 User 是零个或一个本地展示值，不参与身份、授权、租户、session 或账号合并。支持 locale 是有限集合，而不是用户可提交的任意字符串。

`TermsAcceptance` 沿用 `docs/business-model.md` 的现有关系：一个首次注册事务创建一个 User、一个 ExternalIdentity 和一条接受记录。本 Change 对版本标识语义作最小校准：在多语言法律文本下，由 `(locale, legalBundleVersion, termsVersion, privacyVersion)` 四元组共同标识用户实际接受的精确文本，服务端 `acceptedAt` 记录接受时间；单独的版本字段不承诺跨 locale 唯一定位文本。两个 locale 属于同一获批法律 bundle 的本地化版本；Core API 只接受配置白名单内的精确四元组。切换语言是法律展示上下文变化，因此注册草稿状态转换为“未同意”，但显示名称和头像选择不变。查看、切换或持久化 locale 本身都不产生接受事实。

没有新的异步业务边界。Renderer 语言切换同步完成；现有 OAuth 轮询和 session 生命周期不被重启。并发注册、ExternalIdentity 唯一性与事务原子性保持原规则。无效持久化值回退到系统解析；普通消息缺失回退英文；法律资源缺失或服务端组合不一致 fail closed。

## Decisions

### 1. Renderer 使用 `i18next` + `react-i18next`，资源静态打包

增加当前稳定依赖 `i18next` 与 `react-i18next`，建立按 namespace/locale 组织的类型安全消息目录。初始化时一次性注册 `zh-CN/en` 资源，不启用 HTTP backend、语言探测插件或运行时下载。React 组件通过 translation hook 读取文案，非组件格式化通过受控 i18n 实例完成。

选择该方案是因为它提供成熟的 React 更新、插值、复数和 fallback 语义，避免自建字典逐步演变为不完整框架。没有选择 FormatJS 是因为当前只需轻量消息查找，日期可继续使用原生 `Intl`；没有选择手写 Context 是因为 fallback、嵌套资源与 React 订阅都需要自行维护。

测试 seam：locale 纯函数和隔离 i18n factory 做单元测试；Renderer integration 验证 React 即时更新和状态保持；architecture test 禁止 remote backend 与危险 HTML 注入。

### 2. locale 解析和持久化留在 Renderer

定义 `SupportedLocale = 'zh-CN' | 'en'`、常量集合与纯函数：

1. 从固定 localStorage key 读取用户选择并严格校验；
2. 无有效选择时按 `navigator.languages` 的优先级顺序查找第一个受支持语言族：`zh` 及其合法 tag 映射为 `zh-CN`，`en` 及其合法 tag 映射为 `en`，其他语言跳过；列表中没有受支持语言族时默认 `en`；
3. localStorage 读取/写入因安全设置、配额或损坏失败时继续使用内存中的当前选择，不中断 UI；
4. 手动选择写入同一 key，并即时更新 i18n 与 `document.documentElement.lang`。

这是非敏感设备偏好，Renderer localStorage 足够且不会扩大 IPC。没有使用 OS credential store，因为语言不是秘密；没有新增 Main IPC，因为 Chromium 已提供系统语言信息，额外边界只会增加复杂度。未来若 locale 变成跨设备 User 偏好，应由独立 feature 迁移，不能复用本地 key 充当服务端真相。

测试 seam：注入最小 `Storage` 与语言数组，覆盖异常、损坏值、中文/英文 tag、`['fr-FR', 'zh-CN']` 的跳过后匹配、`['en-US', 'zh-CN']` 的优先级，以及全不支持时默认英文和重启恢复。

### 3. 语言选择是常驻、原生语义控件

在 Auth 布局和 AccountHome 的稳定位置复用小型 `LanguageSelector`，采用带显式可访问 label 的原生 `<select>`，选项自称 `简体中文` 与 `English`。控件不放入品牌文案内部，不依赖国旗或仅图标表达语言，也不改变认证流程状态。切换不重新读取 capability、不取消 attempt、不清空表单；仅在注册页清除法律同意。

选择原生 select 是为了最低的键盘、屏幕阅读器和跨平台行为风险；当前只有两个选项，不需要自定义菜单。视觉上复用现有 token 和 focus ring，不进行页面重设计。

### 4. 普通消息与法律资源使用不同回退策略

普通消息目录以 `en` 为最终 fallback。实现时要求 `zh-CN/en` key parity 测试，fallback 只作为运行时防护，不是允许长期漏译。稳定错误 code 仍由 Renderer 映射为消息 key；未知错误使用本地化通用说明。动态值通过插值传入并按文本渲染，不使用 `dangerouslySetInnerHTML` 或翻译内 React HTML。

法律目录改为 `locale -> LegalBundle`，每个 bundle 显式包含 bundle/terms/privacy version、locale、生效日期和结构化 sections。解析 API 要求以 `(locale, legalBundleVersion, termsVersion, privacyVersion)` 四元组定位精确文本，任一资源或字段不匹配即返回 unsupported；绝不回退到另一语言。法律标题、章节和正文属于版本化资源，不放入普通消息 fallback。

日期由 `Intl.DateTimeFormat(currentLocale, { dateStyle: 'long', timeZone: 'UTC' })` 格式化，保持现有 UTC 日期语义。产品名、GitHub、用户名称、ID 和机器值不经过翻译。

测试 seam：catalog parity、fallback、文本转义、法律精确解析、日期格式和缺失资源 fail-closed 均在纯单元/Renderer 层验证。

### 5. Core API 把单个法律 locale 改为有限白名单

`AuthenticationProperties` 将 `legalLocale` 改为规范且去重的 `legalLocales` 集合，本地环境配置 `zh-CN,en`。`LegalDocumentBundle` 的固定版本字段保持不变，注册校验改为：版本三元组必须等于当前获批集合，locale 必须属于受支持集合；二者共同构成服务端接受的精确四元组。`TermsAcceptance.locale` 继续写入提交的实际 locale，确保后续审计和文本解析不会脱离 locale 使用版本字段；数据库不迁移，HTTP DTO/OpenAPI schema 不改变。

配置为空、含空项、重复/非法 tag 或不含客户端支持 locale 时，认证 capability 应按现有 fail-closed 原则不可用或启动配置测试失败；具体采用现有配置验证风格实现，不接受请求时临时纠正。旧的单值环境变量在 0→1 开发基线中直接替换，不保留兼容别名。

没有为每种语言复制整个服务端 bundle 对象，因为当前两种翻译共享同一获批版本号集合，且精确文本标识被明确规定为包含 locale 的四元组。任何读取、审计或解析都不得脱离 locale 将版本字段解释为跨语言唯一文本 ID。若未来不同 locale 独立发布版本，必须由后续法律版本管理 feature 修改服务端契约，而不能在本 Change 猜测。

测试 seam：Core API application/service tests 覆盖两种 locale 成功、未知 locale 和版本不匹配拒绝、接受记录保存并按四元组回读实际文本身份；配置测试覆盖非法白名单。

### 6. 迁移采用完整提取而不是新旧文案混用

当前 `App.tsx`、法律页和账号页所有用户可见产品文案、aria label、状态与错误提示在一个 slice 中迁移；测试不允许生产 JSX 残留硬编码的中英文产品句子（稳定品牌/provider/用户内容除外）。现有 `translate="no"` 仅用于不应被浏览器自动翻译的稳定品牌/provider 内容，不代替产品国际化。

采用完整提取可避免同一页面半中文半英文。实现可按当前组件边界拆出小型 selector/provider/legal catalog，但不以本 Change 为由进行无关页面重构。

## Risks / Trade-offs

- [英文法律文本可能与中文法律含义不一致] → 两份文本作为同一获批 bundle 的版本化资源一起评审；catalog 测试冻结 locale/version，最终人工内容审阅负责法律语义，自动测试只证明展示和版本匹配。
- [普通消息 fallback 掩盖漏译] → key parity 测试要求两个目录一致，fallback 仅保护运行时；Renderer/Cypress 分别执行两种 locale 的关键流程。
- [localStorage 在受限环境抛错] → 所有读写通过捕获异常的适配器；单元测试模拟异常，UI 使用内存选择继续运行。
- [切换语言意外重置 OAuth/注册状态] → locale owner 与认证 state 分离；Renderer integration 断言 attempt flow、显示名称、头像选择保持，只有法律同意被清除。
- [服务端与客户端 locale 集合漂移] → Core API 配置测试、双 locale 注册集成测试与 Desktop legal catalog 测试共同保护；未知组合 fail closed。
- [英文文案导致布局溢出] → Cypress 在最小支持窗口跑双语关键态并做可达性断言，apply 阶段按 `frontend-design` 和 `web-design-guidelines` 检查，不以像素快照代替可用性。
- [新依赖增加 bundle 与维护面] → 只引入两个成熟、同生态包并静态加载两个小目录；构建产物和 lockfile review 检查未引入 backend/plugin。

## Migration Plan

1. 先引入 locale core、双语目录与纯测试，但保持当前 UI 可运行。
2. 将法律资源改为双 locale catalog，并先补齐 Core API 白名单与双语注册测试，确保英文注册不会落入拒绝状态。
3. 一次性迁移当前 Renderer 文案和语言选择，更新双语 Renderer/Cypress 测试。
4. 更新 `.env.local.example` 与本地开发配置，现有开发环境通过 `pnpm dev` 的配置加载使用新白名单；数据库无需重建或迁移。
5. 运行 focused/affected gates和两种语言的手工视觉/键盘 smoke，再同步主规格和 Current 文档。

若回滚，应用代码、依赖和配置一起回退到单一 `zh-CN`；已写入 `locale='en'` 的历史 `TermsAcceptance` 仍是合法不可变接受证据，不需要删除或改写。回滚版本不再创建英文接受记录，但既有 User/session 不受影响。
