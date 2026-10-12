# Proposal

## Why

当前 Desktop 的登录、首次注册、协议和账号页文案全部硬编码为简体中文，协议组合也只支持 `zh-CN`；这会让非中文系统用户无法以可理解的语言完成首次使用，也会使后续新增登录方式继续放大文案与法律版本耦合。现在认证切片刚稳定、业务页面尚未扩展，是建立轻量国际化基础并控制迁移成本的合适时点。

## What Changes

- 为 Desktop Renderer 建立 `zh-CN` 与 `en` 两种受支持语言的统一消息目录，覆盖当前登录、GitHub 授权等待/取消/失败、首次注册、协议查看、会话恢复、账号页、退出以及可访问性文案。
- 首次启动按操作系统/Chromium 提供的语言优先级列表依次匹配：中文语言族映射为 `zh-CN`、英文语言族映射为 `en`、不支持的语言跳过，全部未匹配时默认 `en`；用户手动选择后按设备持久化，并优先于系统语言。
- 在登录和已登录界面提供可键盘操作的语言选择；切换立即生效，更新文档语言、日期格式和根元素 `lang`，不要求重启或重新登录。
- 定义稳定回退：普通界面消息缺失时回退到 `en`，无效持久化值被忽略；法律文档不得静默跨语言回退，缺少当前语言的精确版本时必须阻止同意与注册。
- 为 `zh-CN` 和 `en` 分别提供版本化用户协议与隐私政策。注册提交用户实际看到的 `(locale, legalBundleVersion, termsVersion, privacyVersion)` 精确四元组；注册过程中切换语言保留非法律资料，但清除已有同意。
- 将 Core API 当前单一法律 locale 配置调整为受控的 locale 白名单，使共享版本号集合下的 `zh-CN/en` 分别形成可审计的精确法律文本四元组；不改变 HTTP API 形状，也不国际化服务端 Problem Details。
- 增加语言解析、持久化、回退、即时切换、法律同意失效、双语布局和可访问性自动化测试。

## Business Model Impact

本 Change 使用关系/不变量检查与具体场景映射。它不新增业务身份、账号关系或授权概念：`UserId`、`ExternalIdentity`、session 和 Workspace/Project 边界均不变；设备语言偏好只是 Desktop 展示状态，不成为 User 属性或服务端业务真相。

现有 `TermsAcceptance` 已同时保存法律版本字段与用户实际阅读的 `locale`。本 Change 明确调整其版本标识语义：在多语言法律文本下，由 `(locale, legalBundleVersion, termsVersion, privacyVersion)` 四元组共同标识用户实际看到的精确文本；单独的版本字段不再被描述为跨 locale 唯一定位文本。Core API 只接受白名单中的精确四元组；查看协议不等于同意；切换到另一语言后旧同意不能沿用；`acceptedAt` 仍由服务端生成。该语义调整不改变数据库字段、HTTP DTO、身份关系、异步流程、跨租户引用、账号合并或并发写入语义。

主要失败/恢复场景为无效或已下线的本地偏好、消息键缺失、法律文档缺失、注册期间切换语言，以及服务端法律白名单与已安装客户端不一致。普通文案安全回退，法律组合 fail closed，并允许用户切回可用语言或升级客户端。

## Capabilities

### New Capabilities

- `desktop-internationalization`: 定义 Desktop 语言发现、用户选择与持久化、消息回退、即时切换、格式化和本地化法律文档行为。

### Modified Capabilities

- `desktop-authentication`: 将当前 Auth-only 体验从单一中文扩展为双语，并明确首次注册的多 locale 法律组合校验及切换语言后的同意失效规则。

## Impact

- 主要影响 `apps/desktop/src/renderer` 的应用入口、认证/账号界面、法律文档资源和样式，以及对应 Renderer/Cypress/architecture 测试。
- 预计增加 `i18next` 与 `react-i18next` 作为 Renderer 运行时依赖；不引入远程语言包、翻译服务或新的进程级通用 IPC。
- Core API 仅调整法律组合配置模型和注册校验，从单个 locale 变为受支持 locale 集合；HTTP 请求/响应字段、数据库表和 `TermsAcceptance.locale` 不变。
- `.env.local.example`、本地配置及相关配置测试需同步法律 locale 白名单；不新增秘密或外部基础设施。

## Documentation Impact

- `docs/business-model.md`：实现后把 `TermsAcceptance` 的精确文本标识从独立版本字段校准为包含 locale 的四元组，同时确认两个 locale 均是“实际阅读版本”的证据，并保持 Current/Target 表述与代码一致。
- `docs/architecture.md`：若跨项目法律组合配置契约成为已实现事实，更新 Current 技术约束；不改变系统拓扑。
- `apps/desktop/docs/architecture.md`：把“Next feature TODO”收口为 Current 双语架构，记录语言所有权、回退和法律资源规则。
- `apps/desktop/docs/responsibilities.md`：明确 Renderer locale provider/message/legal catalog 的所有权，不新增 Main/Preload 通用能力。
- `apps/desktop/docs/testing-strategy.md` 与 `design-foundation.md`：补充双语、最长文案、切换和法律同意的当前测试/视觉验收要求。
- `services/core-api/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md`：记录最小法律 locale 白名单与校验责任。
- 主规格 `desktop-internationalization` 与 `desktop-authentication` 在实现验收后同步；`desktop-api-documentation` 无 API 形状变化，不需要 delta。
