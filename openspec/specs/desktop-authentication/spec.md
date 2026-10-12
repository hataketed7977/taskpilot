# Desktop Authentication Specification

## Purpose

为 TaskPilot Desktop 提供当前可运行的 GitHub 联合认证能力：GitHub 证明外部身份，TaskPilot 以稳定 `UserId` 承载账号与业务身份，PostgreSQL 保存长期身份事实，Redis 保存短期登录和 opaque session 状态，Desktop Main 负责系统浏览器、loopback 回调和操作系统凭据存储。

## Requirements

### Requirement: Desktop 仅在服务端启用时提供 GitHub 登录
Core API SHALL 通过匿名 capability 返回 GitHub 登录是否可用。只有 GitHub OAuth client、精确 callback、federated HMAC key 和独立 AEAD key 全部有效时 capability 才可启用。Desktop SHALL 以该 capability 为唯一依据显示登录入口，且 MUST NOT 恢复邮箱、密码、验证码或找回密码入口。

#### Scenario: GitHub 配置完整
- **WHEN** 未认证 Desktop 读取到 GitHub capability 已启用
- **THEN** 登录页显示“使用 GitHub 登录”，并说明授权将在系统浏览器中完成

#### Scenario: GitHub 配置缺失或无效
- **WHEN** 任一 GitHub 或 federated security 配置缺失、无效或两类 key 被复用
- **THEN** Core API 保持健康但 capability 返回 disabled，Desktop 显示可恢复的开发配置不可用状态且不能发起登录

### Requirement: GitHub 登录使用系统浏览器和同机 loopback proof
Desktop Main SHALL 先在 `127.0.0.1` 随机高端口建立一次性 receiver，再把带随机 nonce 的精确 completion URI 提交给 Core API。Core API SHALL 为 attempt 生成单次 OAuth `state`、PKCE S256、poll secret 和 browser completion proof，并 SHALL 仅接受批准的 loopback URI 形状。GitHub client secret MUST NOT 进入 Desktop、Renderer、loopback URI、浏览器 URL、日志或 API 响应。

#### Scenario: 发起登录
- **WHEN** 用户选择 GitHub 登录且当前窗口没有活动 attempt
- **THEN** Main 先建立 loopback receiver，安全保存恢复材料，创建 attempt，再用系统默认浏览器打开服务端返回的 GitHub authorization URL

#### Scenario: completion URI 不安全
- **WHEN** completion URI 不是 `http://127.0.0.1:<49152-65535>/taskpilot/oauth/complete/<nonce>` 的精确安全形状，或带有 userinfo、query、fragment 或路径穿越
- **THEN** Core API 以 `VALIDATION_FAILED` 拒绝 attempt，且不解析远程主机、不跟随重定向、不主动请求该 URI

#### Scenario: state、code 或 PKCE 无效
- **WHEN** callback state 缺失、错误、已消费或过期，或 authorization code 不能与保存的 PKCE verifier 和精确 callback 共同完成交换
- **THEN** Core API 不解析身份、不产生 completion proof、不创建 User 或 session，并返回不枚举账号的稳定失败

#### Scenario: proof 未在发起设备汇合
- **WHEN** authorization URL 在另一设备完成，或 poll 只有 poll secret 而没有正确的同机 completion proof
- **THEN** Core API 不交付身份结果、registration continuation 或 session

### Requirement: Core API 以 provider-scoped durable identity 解析 User
Core API SHALL 只以 `(provider, authority, subject)` 查找 `ExternalIdentity`。GitHub 的 `subject` SHALL 使用 durable numeric user ID 的字符串形式。GitHub login、email、显示名称和头像 MUST NOT 用作身份键或自动账号合并依据。

#### Scenario: External Identity 已关联
- **WHEN** GitHub durable identity 已绑定一个 ACTIVE User，且 poll secret 与 completion proof 均有效
- **THEN** Core API 更新最近认证时间，为同一 `UserId` 签发 ACTIVE opaque session，并返回当前用户视图

#### Scenario: 换一种未绑定的登录身份
- **WHEN** 未来的其他 provider identity 或另一个 GitHub identity 尚未绑定，即使其资料与现有 User 相似
- **THEN** 系统将其视为新的账号候选，不按 email、名称或头像自动合并；账号绑定由后续独立能力处理

#### Scenario: GitHub durable identity 无效
- **WHEN** Provider 响应缺少合法 durable user ID 或身份响应不符合受信契约
- **THEN** Core API 终止 attempt，且不持久化 User、ExternalIdentity 或 GitHub token

### Requirement: 首次 GitHub 登录经显式确认后原子注册
当可信 External Identity 尚未关联 User 时，Core API SHALL 产生短期、一次性的 registration continuation。continuation 只可保存在 Desktop Main；Renderer 只接收 flow id、建议显示名称、可选头像和法律文档组合版本。注册 SHALL 原子创建 `User`、`ExternalIdentity` 和 `TermsAcceptance`，随后签发 ACTIVE session。Core API SHALL 只接受当前获批法律组合中受支持的精确 `(locale, legalBundleVersion, termsVersion, privacyVersion)` 四元组，并 SHALL 将该四元组中的 locale 与版本字段共同持久化为用户实际阅读文本的接受证据；单独版本字段不得被解释为跨 locale 唯一文本标识。

#### Scenario: 首次授权
- **WHEN** 有效 GitHub identity 尚未关联 User
- **THEN** Desktop 以当前选择的受支持语言显示首次注册页，允许修改显示名称、选择是否采用 GitHub 头像、查看同语言的用户协议和隐私政策，并提供返回登录方式的操作

#### Scenario: 确认注册
- **WHEN** 用户提交非空显示名称、头像选择及与服务端当前获批组合精确一致的 `(locale, legalBundleVersion, termsVersion, privacyVersion)` 四元组
- **THEN** Core API 在一个数据库事务中创建长期身份事实和包含实际阅读法律四元组的接受记录，并返回 ACTIVE session

#### Scenario: 注册过程中切换语言
- **WHEN** 用户已勾选同意后从一种受支持语言切换到另一种
- **THEN** Desktop 保留显示名称和头像选择，清除原同意，展示新语言的精确法律文档，并要求用户重新明确同意后才可注册

#### Scenario: 未接受或版本不匹配
- **WHEN** 用户未主动勾选接受、客户端提交的 locale 不受支持，或法律四元组不是服务端当前获批组合
- **THEN** Desktop 不提交注册，或 Core API 以 `LEGAL_BUNDLE_REJECTED` 拒绝注册，且不创建任何长期账号事实

#### Scenario: 客户端缺少精确法律文档
- **WHEN** 服务端要求的组合或当前 locale 的用户协议/隐私政策未随客户端提供
- **THEN** Desktop fail closed，禁止同意与注册，显示可恢复说明且不静默展示另一语言作为接受依据

#### Scenario: 并发注册同一 External Identity
- **WHEN** 同一 provider identity 被并发确认注册
- **THEN** 唯一约束保证它最多关联一个 User；后到请求解析为已创建的同一 ACTIVE User，而不是创建第二个账号

### Requirement: 登录 attempt 可轮询、取消和在 Desktop 重启后恢复
OAuth attempt、state、proof 和 registration continuation SHALL 作为有时限状态保存在 Redis。Desktop Main SHALL 把恢复所需的 attempt secret、loopback 信息和 continuation 放入按 environment 隔离的操作系统凭据存储，Renderer MUST NOT 接收这些秘密。

#### Scenario: callback 尚未完成
- **WHEN** Desktop 以正确 poll secret 轮询仍处于 pending 的 attempt
- **THEN** Core API 返回 `WAITING`，Desktop 保持可见等待状态且不创建并发 attempt

#### Scenario: callback 已到但 proof 尚未到
- **WHEN** Core API 已处理 callback 而 Desktop Main 尚未收到正确 loopback proof
- **THEN** poll 返回 `COMPLETION_REQUIRED`，不会返回身份、continuation 或 session

#### Scenario: 首次身份和既有身份
- **WHEN** poll secret 与 completion proof 汇合
- **THEN** 未知 identity 返回 `REGISTRATION_REQUIRED` 和 Main 私有 continuation，已知 identity 返回 `AUTHENTICATED` 和 ACTIVE session

#### Scenario: 成功响应丢失
- **WHEN** 已完成 attempt 的 poll 或 registration 成功响应在客户端接收前丢失
- **THEN** Desktop 可继续轮询同一 attempt，Core API 从有时限的完成结果返回同一注册预览或 session，而不创建第二个 User 或 session

#### Scenario: 用户取消
- **WHEN** 用户在等待页或首次注册页选择取消或返回登录方式
- **THEN** Desktop 请求取消 attempt、关闭 receiver、清除恢复材料并直接回到登录页，不要求用户再点击“重新开始”

#### Scenario: Desktop 重启
- **WHEN** 未过期 attempt 的恢复材料仍在操作系统凭据存储中
- **THEN** Main 恢复 receiver 和轮询；已过期材料被清理，用户回到登录页

### Requirement: 浏览器完成页安全回到 Desktop
Core API callback 页 SHALL 使用 no-store、no-referrer、nosniff 和限制性 CSP，只向 attempt 预绑定的 loopback origin POST completion proof。proof 成功送达后 SHALL 尝试激活 Desktop 并 best-effort 关闭浏览器页；浏览器限制关闭时 SHALL 显示可以手动关闭的明确状态。

#### Scenario: proof 成功送达
- **WHEN** loopback receiver 接收并验证 completion proof
- **THEN** Desktop 窗口被恢复和聚焦，浏览器页显示完成并调用 `window.close()`

#### Scenario: 自动关闭被浏览器阻止
- **WHEN** proof 已送达但浏览器不允许脚本关闭当前页
- **THEN** 页面保留“授权已完成，可以关闭此页面”的安全 fallback，不要求用户再次操作 Desktop 登录流程

#### Scenario: loopback 交付失败
- **WHEN** Desktop 已关闭、receiver 不可达或返回非成功状态
- **THEN** callback 页不宣称已返回客户端，而是显示可重试动作且不把 proof 放入 URL

### Requirement: Session 使用 Redis opaque credential 并执行轮换与撤销
Core API SHALL 在 Redis 中保存有 TTL 的 session family、access digest 和 refresh digest，不在 PostgreSQL 中创建 session、delivery 或 refresh recovery 表。成功登录或注册 SHALL 直接签发 ACTIVE access/refresh credential。access token 用于 bearer-protected API；refresh token 每次成功使用 SHALL 同时轮换 access 和 refresh token。

#### Scenario: 获取当前用户
- **WHEN** `GET /desktop/v1/me` 携带有效 ACTIVE access bearer
- **THEN** Core API 返回 `userId`、`displayName` 和可选 `avatarUrl`；无效、过期或撤销 token 返回 `AUTHENTICATION_REQUIRED`

#### Scenario: 正常刷新
- **WHEN** Desktop 提交当前有效 refresh token
- **THEN** Redis 原子消费旧 token、签发新 access/refresh token，并保持同一 session family 的绝对过期上限

#### Scenario: 旧 refresh token 重放
- **WHEN** 已轮换的旧 refresh token 再次出现
- **THEN** Core API 视为重放并撤销整个 session family，后续 access 与 refresh 都失败关闭

#### Scenario: refresh 响应不确定
- **WHEN** refresh 已在服务端完成但响应丢失，Desktop 只能重试旧 refresh token
- **THEN** session family 可能因重放保护被撤销，Desktop 清除本地 credential 并要求重新登录；系统不提供 request-id recovery 协议

#### Scenario: 登出
- **WHEN** Desktop 使用当前 access bearer 调用 logout
- **THEN** Core API 立即撤销该 session，Desktop 清除按 environment 和 User 隔离的本地 credential；迟到的 refresh 或登录结果不得恢复已退出 UI

#### Scenario: Redis 不可用
- **WHEN** OAuth、限流、session 读取、刷新或撤销所需的 Redis 不可用
- **THEN** 认证链路 fail closed，并以 `AUTHENTICATION_TEMPORARILY_UNAVAILABLE` 或认证失败状态返回，不降级到进程内或 PostgreSQL session

### Requirement: Desktop 进程边界保护认证秘密
Renderer SHALL 只通过 context-isolated Preload 调用窄且强类型的 GitHub 登录、注册、session 和 logout capability。Renderer MUST NOT 接收 poll secret、completion proof、OAuth state、PKCE verifier、registration continuation、GitHub token、TaskPilot access/refresh token、credential handle、任意网络能力或 GitHub client secret。Main SHALL 校验 IPC sender、frame、origin、schema、流程状态和请求大小。

#### Scenario: Renderer 发起认证动作
- **WHEN** Renderer 调用登录、继续、注册、取消或 logout
- **THEN** Main 只执行对应白名单能力，秘密仍停留在 Main、OS credential store 或服务端

#### Scenario: OS credential facility 不可用
- **WHEN** Main 无法安全保存新 session credential
- **THEN** Desktop 不写入普通文件或 Renderer storage，不发布 authenticated success，并 best-effort 撤销刚签发的 session

#### Scenario: 窗口销毁
- **WHEN** Desktop 窗口或应用退出
- **THEN** Main fence 迟到操作、关闭 loopback listener，并按明确退出语义取消与清理当前 attempt，不让迟到结果改变后续页面

### Requirement: 认证 UI 提供可访问的等待、失败和返回状态
Desktop SHALL 为 capability loading、浏览器等待、取消、首次注册、协议查看、离线、过期、失败、session 恢复和退出提供可见状态。异步状态 SHALL 可被辅助技术感知，表单错误 SHALL 聚焦相关控件，协议页返回 SHALL 恢复到原链接，动画 SHALL 尊重 reduced-motion。

#### Scenario: GitHub 拒绝授权
- **WHEN** GitHub callback 返回 access denied
- **THEN** Desktop 显示未授权状态并允许重新开始，不创建 User 或 session

#### Scenario: 用户查看法律文档
- **WHEN** 用户从注册页打开用户协议或隐私政策再返回
- **THEN** 已填写资料和勾选状态保持不变，焦点回到原查看链接，查看文档本身不会自动接受

#### Scenario: 长名称或头像失败
- **WHEN** GitHub 建议名称很长、为空回退后被编辑，或头像加载失败
- **THEN** 布局不溢出，头像回退为稳定缩写，用户仍可完成注册

### Requirement: 认证错误稳定且不枚举账号
Core API SHALL 使用共享 Problem Details 和稳定 code 区分校验失败、限流、上下文失效、过期、法律版本冲突、认证失败和暂时不可用。错误 MUST NOT 暴露某个 GitHub identity 是否已注册，也 MUST NOT 回显 OAuth 或 session secret。

#### Scenario: 输入校验失败
- **WHEN** provider、installation id、completion URI 或 display name 不合法
- **THEN** 返回 `VALIDATION_FAILED` 和安全字段 `path`，Desktop 在相关位置显示可修复提示

#### Scenario: attempt 上下文失效或过期
- **WHEN** attempt secret、proof、continuation 或状态组合不合法
- **THEN** 返回 `FEDERATED_LOGIN_CONTEXT_INVALID` 或 `FEDERATED_LOGIN_EXPIRED`，不区分内部记录存在性

#### Scenario: 触发登录限流
- **WHEN** 同一来源网络或 installation 在窗口内超过 attempt 限额
- **THEN** 返回 `AUTHENTICATION_RATE_LIMITED` 和适用的 `retryAfterSeconds`

### Requirement: 当前认证切片结束于账号视图
当前 runnable slice SHALL 在成功登录后显示可信 `CurrentUserView`、logout 和 `zh-CN/en` 语言选择。Workspace、Project、Google/Lark SSO、账号绑定/合并、生产部署、签名安装包、服务端错误文案国际化与更多语言不属于本规格当前实现；后续 capability SHALL 复用稳定 `UserId`，不得让外部 provider identity 或设备语言偏好进入业务记录。

#### Scenario: 认证成功
- **WHEN** Desktop 安全保存 refresh credential 并建立 authenticated session
- **THEN** Renderer 以当前语言显示账号名称、头像或回退缩写、语言选择以及退出登录，不调用尚未实现的 Workspace 或 Project API

#### Scenario: Agent Runtime 不可用
- **WHEN** Agent Runtime 未启动或尚未实现
- **THEN** 双语 GitHub 登录、session 恢复、账号视图、语言切换和 logout 仍可独立工作
