# Spec Delta

## Purpose

为 TaskPilot Desktop 提供一个不按前端和后端割裂的端到端邮箱认证能力：用户在端内完成注册、密码登录、邮箱验证码登录和密码重置，Desktop 安全调用 Core API，Core API 持久化账户和会话，并以可信 `CurrentUserView` 交接 Workspace onboarding。

## ADDED Requirements

### Requirement: 登录和注册具有独立且明确的入口
未认证 Desktop SHALL 默认显示独立登录页，并通过清晰的“创建账户”链接进入独立注册流程。登录页 MUST NOT 使用“登录或注册”“使用邮箱继续”或根据服务端账号存在性自动分流的统一入口；注册页 SHALL 提供返回登录的明确入口。

#### Scenario: 打开未认证 Desktop
- **WHEN** 用户首次打开未认证 Desktop，或会话失效后返回认证边界
- **THEN** 系统显示登录页，默认方式为邮箱和密码，并显示“忘记密码”“使用邮箱验证码登录”以及“还没有账户？创建账户”

#### Scenario: 从登录进入注册
- **WHEN** 用户选择“创建账户”
- **THEN** 系统进入独立注册流程，标题、说明、步骤和主按钮均表达创建账户，不继续显示登录提交动作

#### Scenario: 在认证流程之间切换
- **WHEN** 用户从注册、验证码登录或密码重置返回登录，或从登录进入其他流程
- **THEN** Desktop 可以保留用户明确输入的邮箱，但 MUST 清除密码、确认密码、验证码和任何一次性 continuation secret

### Requirement: 密码登录是默认方式
登录页 SHALL 默认采集邮箱和密码，并以“登录”为唯一主动作。Core API SHALL 以规范化邮箱解析账户并验证密码；邮箱不存在、密码错误、账户不可使用或其他 credential 拒绝 MUST 对外产生不可枚举的统一失败语义。

#### Scenario: 使用正确邮箱和密码登录
- **WHEN** 用户提交已注册邮箱和正确密码
- **THEN** Core API 验证凭据、创建新的可撤销 session，并向 Main 返回完整 session result；Main 安全保存所需 credential 后，Renderer 才收到 authenticated 状态和 `CurrentUserView`

#### Scenario: 使用错误凭据登录
- **WHEN** 用户提交不存在的邮箱、错误密码或不可使用账户的凭据
- **THEN** 系统返回相同的稳定 `INVALID_CREDENTIALS` 类别和通用文案，不通过状态码、字段、耗时、控件状态或日志暴露具体原因

#### Scenario: 重复提交登录
- **WHEN** 登录请求仍在处理中且用户再次触发提交
- **THEN** Desktop 保持按钮宽度稳定并显示 pending 状态，拒绝本地重复提交；Core API 的限流和 session 创建仍不依赖客户端锁保证安全

### Requirement: 邮箱验证码登录是显式替代方式
用户 SHALL 能从登录页显式进入独立的邮箱验证码登录流程。该流程 SHALL 先请求 `LOGIN_EMAIL_OTP` 验证码，再验证验证码并建立 session；不得显示注册文案，也不得接受注册或密码重置 purpose 的验证码。

#### Scenario: 请求登录验证码
- **WHEN** 用户在验证码登录流程提交邮箱
- **THEN** Core API 以不枚举账号的统一 accepted 响应处理请求，仅在符合条件时发送 `LOGIN_EMAIL_OTP`，Desktop 显示服务端控制的重发冷却状态

#### Scenario: 验证登录验证码
- **WHEN** 用户提交有效且未消费的 `LOGIN_EMAIL_OTP`
- **THEN** Core API 原子消费验证码、解析既有 User、创建 session，并向 Main 返回完整 session result；Main 安全保存所需 credential 后才发布 authenticated 状态

#### Scenario: 使用错误 purpose 的验证码
- **WHEN** 用户提交内容相同但属于注册或密码重置 purpose 的验证码
- **THEN** Core API 将其作为无效验证码拒绝，不消费其他 purpose 的 challenge，也不建立 session

#### Scenario: 返回密码登录
- **WHEN** 用户从验证码登录选择“返回密码登录”
- **THEN** Desktop 返回默认密码登录页，可保留邮箱，但清除验证码和验证码流程的本地状态

### Requirement: 注册按邮箱验证和账户资料分步完成
注册 SHALL 依次执行“输入邮箱”“验证邮箱”“设置账户资料”三个步骤。第三步 SHALL 采集姓名、密码、确认密码和明确的条款同意；账户只可由服务端签发且仍有效的一次性注册 continuation 创建。

#### Scenario: 请求注册验证码
- **WHEN** 用户在注册第一步提交有效格式的邮箱
- **THEN** Core API 以不枚举账号的统一 accepted 响应处理请求并受服务端冷却和限流约束；对于可注册邮箱发送 `REGISTER_EMAIL_VERIFY` 验证码

#### Scenario: 验证注册邮箱
- **WHEN** 用户提交有效且未消费的 `REGISTER_EMAIL_VERIFY` 验证码
- **THEN** Core API 原子消费验证码并向 Main 签发短期、一次性、绑定规范化邮箱和注册 purpose 的 continuation；Renderer 只看到“邮箱已验证”和下一步，不获得 continuation secret

#### Scenario: 创建账户
- **WHEN** 用户在有效注册 continuation 下提交姓名、满足策略的密码和当前有效条款版本
- **THEN** Core API 在一个数据库成功边界内创建 User、已验证 EmailIdentity、PasswordCredential、TermsAcceptance 和 session，并返回完整 session result；Main 安全持久化 refresh credential 后才发布 `CurrentUserView` 和 authenticated 状态

#### Scenario: 确认密码不一致
- **WHEN** 用户输入的密码和确认密码不一致
- **THEN** Desktop 在本地阻止提交并聚焦确认密码字段；Core API contract 不接收 `confirmPassword`

#### Scenario: 创建账户响应结果未知
- **WHEN** Desktop 已提交创建账户请求但因连接中断无法确认服务端是否已提交事务
- **THEN** Desktop MUST NOT 自动或盲目重试创建请求；它清除密码和 registration continuation，明确提示账户可能已创建，并引导用户回到登录页使用刚设置的邮箱和密码确认结果

#### Scenario: 已验证邮箱发生并发注册
- **WHEN** 两个请求尝试使用同一规范化邮箱完成注册
- **THEN** 数据库唯一约束保证至多创建一个 User；失败请求不得留下孤立 credential、terms acceptance 或 session

#### Scenario: 已证明邮箱已经注册
- **WHEN** 用户拥有有效注册 continuation，但该规范化邮箱已绑定现有 User
- **THEN** Core API 不创建或合并账户，返回可引导至登录的稳定 `EMAIL_ALREADY_REGISTERED` 类别，并消费或失效该 continuation

#### Scenario: 注册上下文过期或退出
- **WHEN** 验证码、continuation 过期，或用户离开注册流程
- **THEN** 系统不创建账户；Desktop 清除密码和验证码，可保留邮箱并引导重新发码或返回登录

### Requirement: 忘记密码使用独立验证和重置流程
密码重置 SHALL 使用独立的 `PASSWORD_RESET` challenge 和短期一次性 reset continuation。它不得复用注册或登录验证码，也不得根据请求响应暴露邮箱是否存在。成功重置后 SHALL 撤销该 User 的既有 session，并要求使用新密码重新登录。

#### Scenario: 请求密码重置验证码
- **WHEN** 用户提交邮箱请求重置密码
- **THEN** Core API 返回统一 accepted 响应，并仅在符合条件时发送 `PASSWORD_RESET` 验证码；Desktop 显示统一反馈和服务端控制的冷却状态

#### Scenario: 验证密码重置验证码
- **WHEN** 用户提交有效且未消费的 `PASSWORD_RESET` 验证码
- **THEN** Core API 原子消费验证码并向 Main 签发短期、一次性、绑定 User 和 reset purpose 的 continuation；Renderer 只进入设置新密码步骤

#### Scenario: 设置新密码
- **WHEN** 用户在有效 reset continuation 下提交满足策略的新密码
- **THEN** Core API 更新 PasswordCredential、使 continuation 失效、撤销该 User 的全部既有 session，并返回成功；Desktop 清除秘密并返回登录页

#### Scenario: 重置失败
- **WHEN** reset continuation 无效、过期、已消费，或新密码不满足策略
- **THEN** Core API 不改变 password credential 或 session；Desktop 显示稳定字段或流程错误，并提供重新验证或返回登录的明确动作

### Requirement: OTP challenge 按 purpose 隔离并抵抗滥用
Core API SHALL 为 `REGISTER_EMAIL_VERIFY`、`LOGIN_EMAIL_OTP` 和 `PASSWORD_RESET` 分别创建 challenge。验证码 MUST 使用密码学安全随机源、只以不可逆摘要存储、具有短 TTL、最大尝试次数、单次消费、重发冷却和服务端限流；同一 challenge 的并发成功消费最多一次。客户端刷新、返回或更换窗口不得重置服务端限制。

#### Scenario: 验证码过期
- **WHEN** 用户提交超过 TTL 的验证码
- **THEN** Core API 返回统一的无效或过期类别，不执行注册、登录或密码重置，并允许按当前限流状态重新发码

#### Scenario: 尝试次数耗尽
- **WHEN** challenge 达到最大失败尝试次数
- **THEN** Core API 使其不可继续验证，返回稳定错误和适用的下一次可操作时间，不允许客户端重新加载绕过限制

#### Scenario: 并发消费同一验证码
- **WHEN** 两个请求并发提交同一有效 challenge 和验证码
- **THEN** 至多一个请求原子消费成功，另一个请求失败且不能产生第二个 continuation、session 或账户变更

#### Scenario: 请求或验证被限流
- **WHEN** 邮箱、来源网络、设备信号或等效防滥用维度达到限制
- **THEN** Core API 返回稳定 `RATE_LIMITED` 类别和可用的 `retryAfter`，不泄露邮箱是否存在，Desktop 在期限到达前禁用对应动作

#### Scenario: 邮件服务暂时不可用
- **WHEN** 邮件发送基础设施发生明确的全局或请求级暂时故障
- **THEN** Core API 返回不暴露账户存在性的暂不可用语义，记录不含邮箱、验证码或正文的可关联运维事件，并允许安全重试

### Requirement: 密码策略和存储由 Core API 统一负责
Core API SHALL 使用 Argon2id 对密码进行带独立随机 salt 的自适应哈希，并把算法参数和升级版本与摘要一起保存。密码策略 SHALL 允许密码管理器、空格和 Unicode，不施加任意字符种类组合；服务端 SHALL 强制长度/资源上限并拒绝批准的常见或已泄露密码集合。密码和摘要 MUST NOT 出现在 API 响应、领域事件、审计 payload、日志、遥测、异常或测试快照中。

#### Scenario: 创建满足策略的密码
- **WHEN** 注册或重置提交满足当前服务端策略的密码
- **THEN** Core API 只持久化 Argon2id 摘要、salt/参数元数据和更新时间，不持久化或再次返回明文

#### Scenario: 密码不满足策略
- **WHEN** 注册或重置提交过短、超过资源上限或命中禁止密码集合的密码
- **THEN** Core API 返回稳定 `PASSWORD_POLICY_VIOLATION` 和安全规则标识，不回显密码；Desktop 将错误映射到密码字段

#### Scenario: 验证旧参数摘要
- **WHEN** 用户使用正确密码登录且现有摘要参数低于当前批准基线
- **THEN** Core API 在成功认证后安全重新哈希并原子替换摘要，不影响本次登录结果

#### Scenario: 不存在邮箱参与密码验证
- **WHEN** 密码登录使用不存在的规范化邮箱
- **THEN** Core API 执行等效的有界 dummy Argon2id 工作并返回统一失败，以降低可观测的账号枚举差异

### Requirement: 用户身份以稳定 UserId 和唯一验证邮箱建立
Core API SHALL 为每个账户创建稳定且不可回收的 `UserId`，并以批准规则生成的规范化邮箱作为首期 EmailIdentity 唯一键。展示邮箱与规范化唯一键 SHALL 分开保存；不得使用 display name、密码摘要或 session 标识作为 User 身份。首期不要求创建外部 IdP identity，但模型 MUST 允许后续通过显式绑定增加第三方身份且保持同一 UserId。

#### Scenario: 邮箱大小写或域名表示不同
- **WHEN** 两个注册输入按批准规范化规则得到同一邮箱键
- **THEN** Core API 将其视为同一 EmailIdentity，唯一约束阻止创建第二个账户

#### Scenario: Provider 特有邮箱别名
- **WHEN** 两个邮箱只因点号、省略或 plus addressing 等 Provider 特有规则可能指向同一邮箱
- **THEN** Core API 不进行 Provider 特有折叠，除非未来独立规则明确批准

#### Scenario: 未来绑定第三方身份
- **WHEN** 后续能力将外部身份绑定到现有 User
- **THEN** 绑定必须经过显式且可审计的验证流程；相同 email 本身不得自动合并账户或替换 UserId

### Requirement: Session 可轮换、可撤销且支持确定性 refresh 恢复
认证成功 SHALL 创建服务端可撤销的 session family。注册、密码登录、验证码登录的成功响应，以及 refresh 的首次成功与确定性恢复响应，MUST 向 Main 返回完整 session result：`{ accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, currentUser }`；expiry 由服务端权威给出，`currentUser` 为安全 `CurrentUserView`，不得返回部分 token 结果。服务端的 token 主记录只持久化带 pepper 的摘要。每次 refresh SHALL 使用不可预测的 `refreshRequestId` 原子轮换 refresh token，并为响应丢失提供短期、持久、加密的确定性恢复结果。Renderer、Preload 返回值和 Agent Runtime MUST NOT 接收 access token、refresh token、session secret、`refreshRequestId` 或 credential handle。

#### Scenario: 认证成功
- **WHEN** 注册、密码登录或验证码登录成功
- **THEN** Core API 返回完整 session result；Main 将 access token 仅保存在内存，将 refresh token 保存至当前 environment/account 的 OS credential namespace，并只在所需 credential 安全写入后向 Renderer 发布 authenticated 状态、expiry 派生状态和 `CurrentUserView`

#### Scenario: 正常刷新 session
- **WHEN** Main 准备使用当前 refresh token 刷新
- **THEN** Main 先在同一 OS credential entry 原子保存“旧 refresh token + pending `refreshRequestId`”，再发送 refresh；Core API 原子轮换并返回包含新 access token、rotated refresh token、两者权威 expiry 和 `CurrentUserView` 的完整 session result，同时记录该 request id 的短期加密恢复结果；Main 安全写入新 refresh token 后才切换 access/session generation 并清除 pending request id

#### Scenario: refresh 成功响应丢失或进程崩溃
- **WHEN** Core API 已完成轮换但响应丢失，或 Main 在保存新 credential 前退出，随后以同一旧 token 和同一 pending `refreshRequestId` 重试
- **THEN** Core API 在恢复窗口内返回与首次成功相同的轮换结果，不将其视为重放攻击；Main 完成安全保存后清除 pending request id

#### Scenario: OS credential 写入新 refresh token 失败
- **WHEN** Main 收到成功刷新结果但无法原子写入新的 OS credential
- **THEN** Main 不发布新的 authenticated success、不切换 access token 或 session generation，保留旧 credential 和 pending `refreshRequestId` 以便安全恢复，且不得降级写入普通文件或 Renderer storage

#### Scenario: 初次认证时 OS credential 写入失败
- **WHEN** 注册、密码登录或验证码登录已返回完整 session result，但 Main 无法安全保存其中的 refresh token，且本地没有可回退的旧 credential
- **THEN** Main 不向 Renderer 发布 authenticated success，不进入受保护 UI，不将秘密写入普通文件或 Renderer storage；它清除新 session result、尽力撤销刚创建的服务端 session，并显示安全存储不可用，待设施恢复后要求重新登录

#### Scenario: 非法重用旧 refresh token
- **WHEN** 已轮换 token 携带不同 `refreshRequestId`、在恢复窗口外出现，或已撤销/消费的 token 无合法恢复记录
- **THEN** Core API 撤销对应 session family 并返回需要重新认证的稳定错误，不签发任何新 token

#### Scenario: 获取当前用户
- **WHEN** Main 使用有效 access token 调用当前用户接口
- **THEN** Core API 返回与 session 绑定的 `CurrentUserView`，不返回 password、credential、OTP、token 摘要或内部 session 数据

#### Scenario: 用户登出
- **WHEN** 用户选择登出
- **THEN** Main 先失效本地 session generation、停止新请求和 refresh、删除 OS credential，并清空 Renderer 认证、Workspace list、活动 Workspace 和 Workspace-scoped cache，再尽力请求 Core API 幂等撤销当前 session family

#### Scenario: 登出请求失败或迟到刷新返回
- **WHEN** 网络导致服务端撤销失败或旧 generation 的 refresh 在登出后返回
- **THEN** Desktop 保持本机已退出，不保存迟到凭据、不恢复旧状态，并以不阻断退出的方式提示远端撤销状态未知

### Requirement: Protected API 401 使用 single-flight 恢复并隔离迟到结果
Main SHALL 为每个 session generation 协调 protected Desktop API 请求。遇到 `401 AUTHENTICATION_REQUIRED` 时，同一 generation 最多启动一个 single-flight refresh；等待该 refresh 的业务请求在成功后各自最多重试一次。终止性认证失败 MUST 失效 generation、删除 credential 和所有受保护客户端状态；暂态 refresh 失败 MUST 保留仍可能有效的 credential，但不得继续展示可能过期的受保护数据。

#### Scenario: 多个请求同时收到 401
- **WHEN** 同一 session generation 的多个 protected 请求同时返回 `401 AUTHENTICATION_REQUIRED`
- **THEN** Main 只执行一次 refresh；成功后每个原业务请求最多重试一次，并拒绝旧 generation 的迟到响应

#### Scenario: refresh 发生终止性认证失败
- **WHEN** refresh credential 已过期、被撤销、被判定非法重用，或服务端要求重新认证
- **THEN** Main 失效 generation、删除 OS credential、清除 `CurrentUserView`、Workspace list、活动 Workspace 和 Workspace-scoped cache，拒绝旧 generation 迟到结果并返回登录页

#### Scenario: refresh 暂时不可用
- **WHEN** refresh 因网络或服务端暂态故障无法完成，但没有终止性认证结论
- **THEN** Main 保留 credential 和 pending recovery state，进入 `temporarily-unavailable`，停止展示陈旧受保护数据并允许安全恢复，而不误删 credential 或立即要求重新登录

### Requirement: Desktop 进程边界保护认证输入和会话
认证表单 SHALL 在 sandboxed Renderer 内完成，不得打开系统浏览器或在特权窗口加载远程登录页。Renderer MUST NOT 直接调用认证 HTTP endpoint，而 SHALL 通过窄的 typed Preload capability 请求 Main 调用固定 Core API origin。密码、验证码和 continuation secret MUST NOT 进入 URL、Renderer storage、查询缓存、日志、遥测、崩溃报告、命令行、环境变量或恢复快照。

#### Scenario: Renderer 提交认证动作
- **WHEN** Renderer 提交登录、发码、验码、注册、密码重置或 logout 动作，或 Main 的 session coordinator 需要 refresh
- **THEN** Preload 只接受对应强类型 capability；Main 校验 sender、frame、origin、schema、请求大小和允许的 flow transition 后调用固定 HTTPS endpoint

#### Scenario: 调用通用或越权能力
- **WHEN** Renderer 尝试使用任意 HTTP、任意 URL/header、token getter、原始 IPC 或跳过流程的陈旧 operation
- **THEN** Main 拒绝请求且不泄露凭据、continuation 或原始服务端响应

#### Scenario: 操作结束
- **WHEN** 请求成功、失败后不再需要秘密、用户取消、切换流程、流程超时或窗口销毁
- **THEN** Renderer 与 Main 清除不再需要的明文密码和验证码；Main 清除已消费或过期 continuation

#### Scenario: OS credential facility 不可用
- **WHEN** Main 无法使用受支持的 macOS Keychain 或 Windows Credential Manager
- **THEN** Desktop 不降级写入普通文件或 Renderer storage，也不发布新的 authenticated success；若当前没有已安全保存的可恢复 credential，则清除新 session result、尽力撤销对应服务端 session，并要求在设施恢复后重新登录；已有 refresh 恢复则遵循保留旧 credential 与 pending request 的规则

### Requirement: 认证流程提供完整且可访问的恢复状态
Desktop SHALL 为密码登录、验证码登录、注册和密码重置提供初始、编辑、校验、提交中、成功、失败、离线、限流、冷却、过期、暂不可用和需要重新认证状态。客户端校验只改善可用性；Core API 仍是邮箱规范化、密码策略、OTP、限流、条款版本和认证结果的权威。

#### Scenario: 字段错误
- **WHEN** 客户端发现明显无效输入，或 Core API 返回稳定字段 path 和 error code
- **THEN** Desktop 将焦点移动到第一个无效字段，显示与字段关联的可访问错误，不解析 human-readable message 进行程序分支

#### Scenario: 离线或暂时不可用
- **WHEN** Desktop 已知离线或认证服务暂时不可用
- **THEN** 系统保留邮箱和姓名等非秘密输入，清楚说明当前不能完成的动作，并在恢复后允许用户主动重试而不自动重复提交

#### Scenario: 键盘和辅助技术
- **WHEN** 用户仅使用键盘、屏幕阅读器或 reduced-motion 设置完成任一认证流程
- **THEN** 页面保持逻辑焦点顺序、可见 focus、状态与错误公告、无纯颜色信息，并移除非必要空间动效

#### Scenario: Agent Runtime 不可用
- **WHEN** Agent Runtime 未安装、未启动或不可连接
- **THEN** 登录、注册、邮箱验证码登录、密码重置和 session 恢复仍可完成

### Requirement: 认证错误使用稳定且不枚举账户的契约
Core API SHALL 使用共享 Problem Details、correlation identifier、稳定 `code`、可选字段 `path` 和适用的 `retryAfter` 表达认证失败。Desktop SHALL 只按这些机器字段映射状态，不依赖自然语言 message。匿名流程不得通过不同状态、字段或响应形状暴露邮箱是否存在。

#### Scenario: 输入校验失败
- **WHEN** 请求 schema 或字段不符合要求
- **THEN** Core API 返回 `VALIDATION_FAILED` 和安全字段 path；不得回显密码、验证码、token 或 continuation

#### Scenario: 凭据或验证码失败
- **WHEN** 密码认证失败，或验证码无效、过期、purpose 不匹配或已消费
- **THEN** Core API 分别返回不枚举的 `INVALID_CREDENTIALS` 或 `INVALID_OR_EXPIRED_CODE` 类别，不透露更细内部原因

#### Scenario: 流程上下文失效
- **WHEN** 注册或密码重置 continuation 无效、过期或已消费
- **THEN** Core API 返回 `REGISTRATION_CONTEXT_EXPIRED` 或 `PASSWORD_RESET_CONTEXT_EXPIRED`，Desktop 引导重新验证邮箱

#### Scenario: 服务暂不可用
- **WHEN** 数据库、邮件或认证依赖无法安全完成当前动作
- **THEN** Core API 返回 `AUTHENTICATION_TEMPORARILY_UNAVAILABLE`，保持 fail closed，并记录不含秘密的 correlation 信息

### Requirement: 认证完成后交接 Workspace onboarding
成功注册或登录后，Desktop SHALL 将安全 `CurrentUserView` 和 authenticated session 状态交给 Workspace onboarding 边界。认证 capability MUST NOT 查询、选择或创建 Personal/Organization Workspace，也不得依赖 Agent Runtime；Workspace listing 及后续状态由 `workspace-onboarding` capability 拥有。

#### Scenario: 认证成功交接
- **WHEN** Main 已安全保存 session 且取得 `CurrentUserView`
- **THEN** Desktop 进入 Workspace onboarding 边界，认证模块不自行发起 Workspace 列表或创建请求

#### Scenario: 当前用户读取失败
- **WHEN** session 已建立但安全当前用户视图无法取得
- **THEN** Desktop 不伪造 User 或进入 Workspace，按认证错误契约刷新一次或进入可恢复的重新认证/暂不可用状态
