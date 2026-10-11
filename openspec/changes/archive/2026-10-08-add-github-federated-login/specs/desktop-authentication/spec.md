# Desktop Authentication Delta

## ADDED Requirements

### Requirement: Desktop 仅在服务端启用时提供 GitHub 登录
Core API SHALL 通过匿名认证 capability 返回 GitHub 登录是否可用；只有 GitHub client 配置、精确 callback、federated HMAC key 与独立 AEAD key 全部有效时 capability 才可启用。Desktop SHALL 仅在该 capability 已启用时显示“使用 GitHub 登录”主动作，不得从本地是否存在 client id 或其他环境变量推断可用性。GitHub 未配置时，邮箱、密码、验证码或找回密码入口 MUST NOT 作为降级方式重新出现。

#### Scenario: GitHub 已配置
- **WHEN** 未认证 Desktop 读取到 GitHub 登录 capability 已启用
- **THEN** 登录页显示单一“使用 GitHub 登录”主动作，并说明将使用系统浏览器继续

#### Scenario: GitHub 未配置
- **WHEN** Core API 未配置完整有效的 GitHub client id/client secret、精确 callback、federated HMAC key 或结果 AEAD key，或 HMAC/AEAD key 未保持独立
- **THEN** capability 返回 GitHub 登录不可用，Desktop 不显示可触发的 GitHub 登录按钮，并显示可恢复的开发配置不可用状态

#### Scenario: 本地配置与服务端能力不一致
- **WHEN** Desktop 本地存在任意 GitHub 配置但 Core API capability 未启用
- **THEN** Desktop 仍将 GitHub 登录视为不可用，且不尝试自行构造 GitHub authorization URL

### Requirement: GitHub 登录通过系统浏览器、服务端 callback 和同机 loopback proof 完成
Desktop Main SHALL 在创建联合登录尝试前启动只监听 `127.0.0.1` 随机高端口的一次性 HTTP receiver，并将包含随机 nonce 的精确 completion URI 绑定到该 attempt；Core API SHALL 只接受该受限 loopback URI 形状，为 attempt 生成不可预测且单次使用的 OAuth `state`、PKCE S256 与 browser completion proof，并使用系统默认浏览器和预配置 GitHub endpoint 完成授权。GitHub client secret MUST NOT 进入 Desktop、Renderer、loopback URI、浏览器 URL、日志或 API 响应。Core API 验证 GitHub callback 后 SHALL 只把 completion proof 通过安全结束页 POST 到已绑定 receiver；只有 poll secret 与该 proof 同时匹配，Desktop 才能领取身份结果。

#### Scenario: 启动 GitHub 登录
- **WHEN** 用户选择“使用 GitHub 登录”且没有同一窗口的活动尝试
- **THEN** Main 先绑定 loopback receiver并安全持久化 attempt recovery input，再创建绑定精确 completion URI 的 attempt、仅在 Main 内持有 poll secret，最后使用系统浏览器打开服务端返回的 authorization URL

#### Scenario: completion URI 不安全
- **WHEN** attempt 请求提交非 `127.0.0.1`、非随机高端口、非固定路径前缀，或包含 userinfo、query、fragment、路径穿越的 completion URI
- **THEN** Core API 拒绝创建 attempt，不解析 hostname、不跟随重定向，也不从服务端主动请求该 URI

#### Scenario: authorization URL 被转发
- **WHEN** 发起方把 authorization URL 转发给另一设备且另一设备的用户完成 GitHub 授权
- **THEN** completion proof 只尝试发送到 attempt 预绑定的发起设备 loopback receiver；另一设备不获得 proof，发起方仅有 poll secret也不能领取身份结果或 session

#### Scenario: completion proof 缺失或错误
- **WHEN** poll 只有正确 poll secret 但没有正确 completion proof，或 proof 已过期、已使用、属于其他 attempt
- **THEN** Core API 不返回外部身份、注册预览、continuation 或 session，并以不可枚举的稳定状态保持或终止流程

#### Scenario: 重复启动登录
- **WHEN** 同一窗口仍有未终止的 GitHub 登录尝试且用户再次触发登录
- **THEN** Desktop 不创建第二个并发尝试，并保持可见的等待、取消和重试状态

#### Scenario: callback state 不匹配
- **WHEN** callback 缺少正确 `state`、state 已消费、已过期或不属于该登录尝试
- **THEN** Core API 拒绝 callback，不交换 authorization code、不生成 completion proof、不创建 User 或 session

#### Scenario: authorization code 注入或 PKCE 不匹配
- **WHEN** authorization code 无法与该尝试保存的 PKCE verifier 和精确 callback 共同完成交换
- **THEN** Core API 将尝试终止为安全失败，不读取外部身份、不生成 proof、不创建 User 或 session

#### Scenario: loopback listener 被抢占或启动失败
- **WHEN** Main 无法绑定所选 loopback 地址，或 receiver 在 attempt 创建到浏览器打开前失效
- **THEN** Main 不打开 authorization URL，并取消已创建的 attempt；不得改用 LAN 地址、普通文件、Renderer server 或宽泛监听地址

#### Scenario: 使用嵌入式浏览器
- **WHEN** Renderer 或 Main 尝试在 Electron WebView、BrowserWindow 内嵌页面或 Renderer iframe 中承载 GitHub 授权
- **THEN** Desktop 拒绝该路径并仅允许系统外部浏览器

### Requirement: Core API 以 GitHub durable user ID 解析外部身份
Core API SHALL 在成功交换临时 GitHub authorization code 后调用受信任的 GitHub authenticated-user endpoint，并把 durable numeric user ID 的十进制字符串映射为 `(provider=github, authority=https://github.com, subject)`。GitHub login、name、email、avatar 和 OAuth token MUST NOT 作为外部身份唯一键；相同 email MUST NOT 自动关联、合并或替换任何 TaskPilot User。

#### Scenario: 已有关联的 GitHub 身份
- **WHEN** GitHub 返回的 durable user ID 匹配既有 `(github, https://github.com, subject)` ExternalIdentity 且其 User 可用
- **THEN** Core API 更新该身份的最近认证时间，并只在 poll secret 与 completion proof 汇合后为同一稳定 `UserId` 创建不可用的 `PENDING_DELIVERY` session

#### Scenario: GitHub 用户名或邮箱变化
- **WHEN** 同一 durable user ID 的 login、name、email 或 avatar 与上次授权不同
- **THEN** 系统仍解析为同一 ExternalIdentity 和 UserId，且不得据此创建、转移或合并账号

#### Scenario: durable user ID 缺失或无效
- **WHEN** GitHub 响应没有可接受的 durable numeric user ID，或 authenticated-user 响应无法可信验证
- **THEN** Core API 终止登录尝试，不使用 login、email 或其他字段代替 subject

#### Scenario: User 不可用
- **WHEN** ExternalIdentity 存在但关联 User 当前不可用于登录
- **THEN** GitHub 验证成功仍不得创建或激活 session；若禁用在交付或既有 session 生命周期中被发现，Core API 撤销对应 session family，Desktop 只收到稳定且不过度披露内部状态的认证拒绝

### Requirement: 首次 GitHub 登录经显式确认后原子注册
当可信 GitHub 身份尚未关联 User 且 poll secret 与同机 completion proof 已汇合时，Core API SHALL 产生短期、一次性且绑定该 ExternalIdentity 候选和登录尝试的注册 continuation。continuation 只可交付并保存在 Desktop Main；Renderer 只接收非秘密的建议昵称、可选头像、当前条款版本和 opaque registration flow id。用户 SHALL 明确确认可编辑昵称和条款后才能注册；Core API SHALL 在一个事务中创建 User、ExternalIdentity、TermsAcceptance 和不可使用的 `PENDING_DELIVERY` session，且不得要求 email 或 TaskPilot 密码。

#### Scenario: 首次授权进入注册确认
- **WHEN** callback 验证到尚未关联的可信 GitHub subject
- **THEN** Main polling 得到 Main 私有 continuation 与 `REGISTRATION_REQUIRED` 安全 view；Renderer 只展示建议昵称、可选头像与当前条款确认，不接收 continuation，也不提前留下 User 或 ExternalIdentity

#### Scenario: 确认首次注册
- **WHEN** 用户通过 Renderer 提交有效昵称、当前条款版本和 opaque registration flow id，且 Main 为该 flow 组合有效未消费 continuation 与预持久化 `deliveryRequestId`
- **THEN** Core API 原子创建 User、唯一 ExternalIdentity、条款接受、`PENDING_DELIVERY` session 与可恢复交付结果；Main 安全保存 refresh token 与 pending ACK state，并完成 ACK 后才发布 authenticated 状态

#### Scenario: 用户未接受条款
- **WHEN** 用户未明确接受当前条款或提交过期条款版本
- **THEN** Core API 不创建 User、ExternalIdentity 或 session，并返回稳定的条款拒绝或需要刷新状态

#### Scenario: continuation 已过期或已消费
- **WHEN** 首次注册使用过期、错误、已消费或不匹配该身份候选的 continuation
- **THEN** Core API 拒绝注册且不创建部分记录，Desktop 引导重新开始 GitHub 登录

#### Scenario: 并发确认同一 GitHub 身份
- **WHEN** 两个有效流程并发尝试为同一 `(provider, authority, subject)` 首次注册
- **THEN** 唯一性与事务边界保证最多一个 User 注册成功，失败流程不得留下孤立 User、重复 ExternalIdentity 或额外 session

### Requirement: Desktop 以双重 proof 轮询并确定性恢复身份结果
每个联合登录尝试 SHALL 具有彼此分离的高熵 poll secret 与 browser completion proof。Desktop Main SHALL 在打开浏览器前安全持久化 attempt recovery state 和不可预测的 `deliveryRequestId`；Core API 只有同时验证正确 poll secret、completion proof 与 attempt 状态后才可返回注册 continuation或创建 session delivery。Core API SHALL 在 registration preview 与 session delivery 中返回各自恢复阶段的权威 `expiresAt`，Main SHALL 用该值替换先前 attempt deadline，而不得用初始 attempt TTL 提前截断后续阶段。相同 attempt、秘密与 `deliveryRequestId` 在恢复窗口内 SHALL 确定性返回相同加密结果且不得创建额外 session；不同 request id、错误 proof 或已终止上下文 MUST fail closed。TaskPilot token、注册 continuation、proof、poll secret 与 request id MUST NOT 出现在 GitHub callback URL、远程页面、Renderer、日志或遥测中。

#### Scenario: callback 尚未完成
- **WHEN** Main 使用正确 poll secret 在 GitHub callback 或 completion proof 尚未完成时轮询
- **THEN** Core API 返回 `PENDING` 和受服务端控制的下一次轮询间隔，不返回身份候选、continuation 或 session

#### Scenario: 已有身份首次交付
- **WHEN** callback 已验证既有身份，且 Main 使用正确 poll secret、completion proof 与新的 `deliveryRequestId` 轮询
- **THEN** Core API 原子创建一个 `PENDING_DELIVERY` session 和加密交付结果，返回完整 session result 与 delivery ACK context，但该 session 尚不可用于任何 protected access 或 refresh

#### Scenario: 首次身份等待资料确认
- **WHEN** callback 已确认新 ExternalIdentity 候选，且 Main 提交正确双重 proof 与 `deliveryRequestId`
- **THEN** Core API 向 Main 返回 registration continuation 和安全资料预览；Main 只向 Renderer 发布不含 continuation 的 registration view

#### Scenario: poll 成功响应丢失
- **WHEN** Core API 已创建交付结果但 HTTP 响应丢失，或 Main 在收到结果前退出后使用同一 attempt secrets 与同一 `deliveryRequestId` 重试
- **THEN** Core API 在恢复窗口内返回与首次相同的 session result 或 registration result，不创建第二个 session、User 或 continuation

#### Scenario: 使用不同 request id 重试已开始的交付
- **WHEN** 同一 attempt/continuation 已绑定一个 delivery request，却使用不同 `deliveryRequestId` 重试
- **THEN** Core API 拒绝请求，不返回既有交付结果，也不创建新 session

#### Scenario: poll secret 或 completion proof 错误
- **WHEN** 请求缺失、错误或混用其他 attempt 的 poll secret/completion proof
- **THEN** Core API 以不可用于枚举 attempt 的稳定错误拒绝，不返回状态细节、资料、continuation 或 session

#### Scenario: 尝试过期或被取消
- **WHEN** 尝试超过服务端 TTL，或用户在 Desktop 主动取消
- **THEN** 尝试进入不可逆终态，后续 callback、completion 和 polling 不再产生身份、continuation 或 session，Desktop 可以显式重新开始

#### Scenario: 重复 callback 或并发 poll
- **WHEN** GitHub 重复调用同一 callback，或同一 delivery request 被并发轮询
- **THEN** Core API 不重复交换 code、不重复创建 User/session，并只产生一个可恢复交付结果

### Requirement: GitHub 登录最小化权限和 Provider 数据
GitHub 登录 SHALL 只请求识别用户所需的最小授权，不申请仓库、组织管理或邮件读取权限。GitHub access/refresh token MUST NOT 持久化到 TaskPilot 数据库、Desktop credential storage、日志、异常、遥测或测试快照，并须在读取可信身份后丢弃。外部 profile 字段只可用于本次注册预填；用户确认后形成 TaskPilot 自有资料，后续登录 MUST NOT 自动覆盖。

#### Scenario: 检查登录授权范围
- **WHEN** Core API 生成 GitHub authorization request
- **THEN** 请求不包含 `repo`、`user`、`user:email` 或其他非登录必要 scope

#### Scenario: 身份读取完成
- **WHEN** Core API 已使用临时 GitHub token 取得可信 durable user ID
- **THEN** token 不进入任何持久存储或 TaskPilot session，并在当前认证处理结束后不再保留

#### Scenario: 用户修改 TaskPilot 昵称
- **WHEN** 已注册用户的 GitHub name 或 login 后续变化
- **THEN** 登录不得覆盖其 TaskPilot display name 或其他已经确认的 TaskPilot profile

#### Scenario: 未来请求仓库访问
- **WHEN** 产品后续需要读取或操作 GitHub 仓库
- **THEN** 该权限必须通过独立 Integration capability 和独立授权/token 生命周期设计，不得复用本登录 token

### Requirement: Disabled User 的全部 session 路径一致失效
Core API SHALL 只允许 `ACTIVE` User 建立、ACK、使用、刷新或恢复 session。任何登录、delivery ACK、protected access、普通 refresh 或 refresh recovery 在发现 User 为 `DISABLED` 时 MUST 拒绝结果并撤销对应 session family；未来若提供显式 disable command，它 MUST 在写入状态的同一业务事务中撤销该 User 全部 session family。本 Change 不增加管理 UI 或 disable API。

#### Scenario: 已有 access token 的 User 被禁用
- **WHEN** ACTIVE session 关联 User 已变为 `DISABLED`，随后 access token 调用 current-user 或任意 protected API
- **THEN** Core API 返回 `401 AUTHENTICATION_REQUIRED`，撤销对应 session family且不返回受保护数据

#### Scenario: refresh 轮换后 User 被禁用再恢复
- **WHEN** refresh 已轮换并保存 recovery result，随后 User 在客户端以旧 token 和同一 `refreshRequestId` 恢复前被禁用
- **THEN** Core API 不返回已加密的新 credential，撤销 session family并要求重新认证

#### Scenario: delivery ACK 前 User 被禁用
- **WHEN** session 已处于 `PENDING_DELIVERY` 但 User 在 ACK 前变为 `DISABLED`
- **THEN** ACK 失败并撤销 session family；Main 删除本地 pending credential且不发布 authenticated 状态


### Requirement: 浏览器完成页安全收尾并唤回 Desktop
Core API SHALL 在成功验证 GitHub callback 后返回不缓存、无 referrer、受 nonce CSP 约束的安全完成页。页面 MUST 只向该 attempt 预绑定的 loopback completion URI 发送 completion proof；只有 loopback 返回成功状态后，页面才可声明授权已经交付、清理当前地址栏中的 OAuth query/fragment 并尝试关闭自身。若浏览器阻止关闭，页面 SHALL 显示不含 code、state、proof 或 token 的手动关闭提示；若 proof 未交付，页面 SHALL 显示失败和重试动作而不得伪报成功。Desktop Main 收到有效 proof 后 SHALL 恢复、显示并聚焦现有主窗口，但该动作本身 MUST NOT 建立 session 或绕过后续 poll/delivery/ACK。

#### Scenario: proof 成功交付且浏览器允许关闭
- **WHEN** callback 完成页把一次性 proof POST 到预绑定 loopback receiver 并收到成功响应
- **THEN** 页面清理 OAuth 查询参数、显示完成状态、尝试关闭当前页面，Desktop 主窗口被恢复并聚焦，认证仍按既有 poll/delivery 状态机继续

#### Scenario: 浏览器禁止脚本关闭
- **WHEN** proof 已成功交付但系统浏览器保留当前页面
- **THEN** 页面不重复暴露 proof，显示“授权已完成，可以关闭此页面”的 fallback，Desktop 仍被唤回且流程不要求用户再次点击继续

#### Scenario: loopback 交付失败
- **WHEN** callback 页面无法连接或未从预绑定 receiver 获得成功响应
- **THEN** 页面清理地址栏中的 OAuth 查询参数、显示无法自动返回 TaskPilot 的状态与显式重试动作，且不得显示授权已完成

### Requirement: 首次注册展示并记录当前法律文档组合
首次注册页 SHALL 要求用户主动确认当前 consent bundle，且默认不勾选。可见文案 SHALL 为“我已阅读并同意《用户协议》，并确认已阅读《隐私政策》”或等价明确表达，不得显示内部 `termsVersion` 或日期；《用户协议》和《隐私政策》均 SHALL 是可键盘访问的查看链接，打开链接不得改变勾选状态。内置文档 SHALL 显示其生效日期、开源许可证与托管服务边界、第三方登录、自动化风险、数据处理和实际运营者/自部署者责任。客户端只可提交与内置不可变文档组合版本精确匹配的服务端 `termsVersion`；未知版本 MUST fail closed。成功注册仍 SHALL 在原子事务中保存 `UserId + termsVersion + acceptedAt`，不退化为 User 上的永久布尔字段。

#### Scenario: 用户查看文档后主动接受
- **WHEN** 新用户分别打开用户协议或隐私政策并返回首次注册页
- **THEN** 页面保留未提交的资料，不自动勾选接受框；用户主动勾选并提交后，服务端按当前 bundle id 和服务端时间记录接受事件

#### Scenario: 注册页不暴露内部日期版本
- **WHEN** 服务端返回当前 `termsVersion`
- **THEN** 接受文案只显示可理解的文档名称和链接，日期仅出现在文档正文，不出现在复选框旁

#### Scenario: 客户端没有服务端要求的文档版本
- **WHEN** 服务端 `termsVersion` 与客户端内置 consent bundle id 不一致
- **THEN** 客户端明确提示需要更新，禁用接受和注册提交，不允许用户对未展示的正文表示同意

## MODIFIED Requirements

### Requirement: Session 可轮换、可撤销且支持确定性 refresh 恢复
Core API SHALL 先把 GitHub 登录或注册产生的 session 建为 `PENDING_DELIVERY`，该状态的 access/refresh token MUST NOT 通过 bearer、current-user、refresh 或 refresh recovery。交付结果 SHALL 绑定 delivery id、`deliveryRequestId` 与独立 ACK secret并短期加密保存。Main SHALL 将 refresh token 和 pending ACK context 原子写入当前 environment/account 的 OS credential namespace，再幂等 ACK；Core API 在 ACK 时重新验证 User 为 `ACTIVE` 后才将 session 转为 `ACTIVE`。Main 可在写入失败时 abandon，未 ACK delivery 到期 SHALL 自动撤销。ACTIVE session 继续使用现有 access/refresh token digest、family/generation、rotation、revocation与 `refreshRequestId` 确定性 refresh recovery；Renderer、Preload 返回值和 Agent Runtime MUST NOT 接收任何 credential、delivery/request id、ACK secret 或 handle。

#### Scenario: 认证成功
- **WHEN** GitHub 既有身份登录或首次注册产生完整 session delivery result，且 Main 已将 refresh token 与 pending ACK context 原子写入 OS credential 并成功 ACK
- **THEN** Core API 的 session 已为 `ACTIVE`；Main 将 access token 仅保存在内存，并只在 ACK 成功后向 Renderer 发布 authenticated 状态、expiry 派生状态和安全 `CurrentUserView`

#### Scenario: session delivery ACK 成功
- **WHEN** Main 已原子保存 refresh token 与 pending ACK context，并以正确 ACK secret 确认仍为 ACTIVE User 的 delivery
- **THEN** Core API 幂等激活 session；Main 清除 pending ACK 后才发布 authenticated 状态和安全 `CurrentUserView`

#### Scenario: ACK 响应丢失或 Main 崩溃
- **WHEN** Core API 已激活 session 但 ACK 响应丢失，Main 在保存 pending ACK 后退出，或本地记录的 delivery deadline 已过但 ACK 结果仍未知
- **THEN** Main 从 OS credential 恢复同一 ACK context并优先重试，不得仅按本地时间删除 pending credential；Core API 权威判定该 delivery 已激活或已过期，并对相同的成功 ACK 返回同一已激活结果，不创建或轮换 session

#### Scenario: delivery 被放弃或超时
- **WHEN** Main 明确 abandon，或 delivery 在 TTL 内未 ACK
- **THEN** Core API 撤销对应 session family、删除加密交付结果，之后的 access、refresh、ACK 与 recovery 全部失败

#### Scenario: ACK 前使用 session token
- **WHEN** `PENDING_DELIVERY` session 的 access 或 refresh token 被用于任意 protected、current-user、refresh 或 recovery endpoint
- **THEN** Core API 返回 `AUTHENTICATION_REQUIRED`，不激活、轮换或泄露 session 状态

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
- **WHEN** GitHub 登录或注册已返回完整 session result，但 Main 无法安全保存其中的 refresh token，且本地没有可回退的旧 credential
- **THEN** Main 不向 Renderer 发布 authenticated success，不进入受保护 UI，不将秘密写入普通文件或 Renderer storage；对应 session 保持不可用的 `PENDING_DELIVERY`，Main 使用 delivery context 请求 abandon 并清除本地结果；即使 abandon 请求未送达，该 session 也不得变为 `ACTIVE`，并由 delivery TTL 自动撤销，界面显示安全存储不可用且待设施恢复后要求重新登录

#### Scenario: 非法重用旧 refresh token
- **WHEN** 已轮换 token 携带不同 `refreshRequestId`、在恢复窗口外出现，或已撤销/消费的 token 无合法恢复记录
- **THEN** Core API 撤销对应 session family 并返回需要重新认证的稳定错误，不签发任何新 token

#### Scenario: 获取当前用户
- **WHEN** Main 使用有效 access token 调用当前用户接口
- **THEN** Core API 返回与 session 绑定的 `CurrentUserView`，至少包含 `userId` 和 display name，可包含 TaskPilot avatar，但不要求或伪造 email，且不返回 credential 或内部授权记录

#### Scenario: 用户登出
- **WHEN** 用户请求登出
- **THEN** Main 请求 Core API 撤销当前 session family，随后无论网络结果如何都删除本地 credential、清空内存 access token、切换 generation，并向 Renderer 发布 unauthenticated；服务端继续按 TTL、重用检测和后续撤销完成防护

#### Scenario: Desktop 重启恢复
- **WHEN** Main 启动时发现当前 environment/account 的 OS credential
- **THEN** Main 不把 refresh token 发给 Renderer，而是按 pending request 恢复规则 refresh 并只在成功后发布 authenticated；终止失败时删除 credential 并要求重新认证，暂时性失败时进入可重试但不伪造成功的恢复状态

#### Scenario: 登出请求失败或迟到刷新返回
- **WHEN** logout 请求因网络失败未确认到达服务端，或旧 generation 的 refresh/session 响应在本地登出后迟到
- **THEN** Main 仍删除本地 credential、清空受保护状态并保持 unauthenticated，迟到结果不得重新写入 credential 或恢复旧 session；服务端 session 由 TTL、重用检测和后续撤销收敛

#### Scenario: 账号切换隔离
- **WHEN** 用户登出后以另一个 GitHub 身份登录，或环境/账号上下文变化
- **THEN** Main 使用独立 credential namespace 和新的 session generation，不复用前一 User 的 access token、refresh token、请求队列、Workspace 选择或缓存

### Requirement: Protected API 401 使用 single-flight 恢复并隔离迟到结果
Main SHALL 为每个 session generation 协调 protected Desktop API 请求。遇到 `401 AUTHENTICATION_REQUIRED` 时，同一 generation 最多启动一个 single-flight refresh；等待该 refresh 的业务请求在成功后各自最多重试一次。终止性认证失败 MUST 失效 generation、删除 credential 和所有 User/Workspace-scoped client state，并发布 unauthenticated；网络、服务暂不可用或可安全恢复的本地存储失败 SHALL 保留可恢复 credential 并进入明确重试状态。旧 generation 的 refresh、重试和迟到响应 MUST NOT 覆盖 GitHub 重新登录、logout 或账号切换后的状态。

#### Scenario: 多个请求同时收到 401
- **WHEN** 同一 generation 的多个 protected 请求并发收到 `401 AUTHENTICATION_REQUIRED`
- **THEN** Main 只执行一次 refresh，成功后每个等待请求使用新 access token 独立重试最多一次，且原业务请求不会在 refresh 内部被隐式重复多次

#### Scenario: 请求在 refresh 中途到达
- **WHEN** 同一 generation 已有 refresh 进行中且新的 protected 请求到达
- **THEN** 新请求等待同一 refresh 结果；成功后再发送，终止失败时不发送，暂时失败时保持可恢复且不把 User 标记为已登出

#### Scenario: refresh 发生终止性认证失败
- **WHEN** 请求在成功 refresh 后重试仍收到 `401 AUTHENTICATION_REQUIRED`
- **THEN** Main 不形成 refresh loop，失效当前 generation、删除 credential 和 scoped state，并要求重新通过 GitHub 认证

#### Scenario: logout 或 GitHub 重登录发生在 refresh 期间
- **WHEN** refresh 尚未完成时用户 logout、取消恢复或开始新的 GitHub 登录并建立新 generation
- **THEN** 旧 refresh 和等待请求的后续成功或失败均被丢弃，不重新写入 credential、不恢复旧 authenticated 状态，也不污染新 User 的 Workspace/Project 状态

#### Scenario: 非认证 401/403/404
- **WHEN** 响应不是明确的 `401 AUTHENTICATION_REQUIRED`，而是业务 `403`、防枚举 `404` 或其他错误
- **THEN** Main 不触发 refresh，按对应稳定错误交给 owning capability 处理

#### Scenario: refresh 暂时不可用
- **WHEN** refresh 因离线、超时或 `AUTHENTICATION_TEMPORARILY_UNAVAILABLE` 失败且没有终止性凭据证据
- **THEN** Main 保留可恢复 credential 和当前 generation 的安全状态，停止自动重放并提供用户主动重试；Renderer 不获得 token 或伪造成功

### Requirement: Desktop 进程边界保护认证输入和会话
Renderer SHALL 只通过 context-isolated Preload 调用窄且强类型的 GitHub 登录、首次注册确认、session、logout 与订阅 capability。Renderer MUST NOT 接收 poll secret、browser completion proof、loopback receiver nonce/URI、OAuth state、PKCE verifier、registration continuation、delivery id/request id/ACK secret、GitHub token、TaskPilot access/refresh token、`refreshRequestId`、credential handle、任意网络能力、GitHub client secret 或原始 callback。Main SHALL 校验 IPC sender、frame、origin、schema、流程状态和请求大小；Main 自己不得作为 GitHub client secret 的持有者；loopback receiver MUST 仅存在于 Main、只监听 `127.0.0.1`、限制 method/path/body/size 并在单次有效 completion 或终态后关闭。

#### Scenario: Renderer 提交认证动作
- **WHEN** Renderer 请求开始或取消 GitHub 登录、提交首次注册确认、logout，或 Main 的 session coordinator 需要 refresh
- **THEN** Preload 只接受对应强类型 capability；Main 校验 sender、frame、origin、schema、请求大小和允许的 flow transition 后调用固定 Core API endpoint

#### Scenario: 调用通用或越权能力
- **WHEN** Renderer 尝试使用任意 HTTP、任意 URL/header、系统浏览器任意 URL、token getter、原始 IPC、callback 注入或跳过流程的陈旧 operation
- **THEN** Main 拒绝请求且不泄露 poll secret、OAuth/PKCE 上下文、registration continuation、TaskPilot credential 或原始服务端响应

#### Scenario: 操作结束
- **WHEN** 登录成功、失败、被确认取消、超时、窗口销毁，或注册 continuation 已消费/过期
- **THEN** Renderer 与 Main 清除不再需要的非持久流程状态；窗口销毁只关闭 listener 并 fence 当前操作，若已保存 pending delivery 则保留 recovery 与 credential 供重启后幂等 ACK；显式取消也只有在 abandon 被 Core API 明确确认后才删除该 recovery，否则保留以避免遗留已激活但本地丢失的 session；Core API 按终态和 TTL 清理临时秘密并撤销未 ACK session

#### Scenario: OS credential facility 不可用
- **WHEN** Main 无法使用受支持的 macOS Keychain 或 Windows Credential Manager
- **THEN** Desktop 不降级写入普通文件或 Renderer storage，也不发布新的 authenticated success；若当前没有已安全保存的可恢复 credential，则清除新 session result并 abandon 对应 delivery；即使 abandon 未送达，未 ACK session 仍不可用并按 TTL 撤销，并要求在设施恢复后重新登录；已有 refresh 恢复则遵循保留旧 credential 与 pending request 的规则

### Requirement: 认证流程提供完整且可访问的恢复状态
Desktop SHALL 为 GitHub 登录与首次注册确认提供初始、启动浏览器、等待 callback、等待本机 completion、等待用户授权、需要注册确认、恢复交付、等待 ACK、提交中、成功、取消、拒绝、离线、超时、暂不可用、交付已撤销和需要重新认证状态。客户端校验只改善可用性；Core API 仍是 capability、登录尝试、ExternalIdentity 唯一性、当前条款版本和认证结果的权威。

#### Scenario: 字段错误
- **WHEN** 客户端发现明显无效的 display name，或 Core API 返回稳定字段 path 和 error code
- **THEN** Desktop 将焦点移动到第一个无效字段，显示与字段关联的可访问错误，不解析 human-readable message 进行程序分支

#### Scenario: 用户取消或 GitHub 拒绝授权
- **WHEN** 用户在 Desktop 取消当前尝试，或 GitHub callback 表明用户拒绝授权
- **THEN** Desktop 结束等待、清理该流程的本地状态，并允许用户主动重新开始，不显示为 TaskPilot 账号或密码错误

#### Scenario: 离线或暂时不可用
- **WHEN** Desktop 已知离线、GitHub/Core API 暂时不可用或 polling 失败但尝试尚未被服务端判定终止
- **THEN** 系统清楚说明当前不能完成的动作，并允许用户主动重试状态读取或重新登录，不自动创建并发尝试

#### Scenario: 键盘和辅助技术
- **WHEN** 用户仅使用键盘、屏幕阅读器或 reduced-motion 设置完成登录或首次注册确认
- **THEN** 页面保持逻辑焦点顺序、可见 focus、状态与错误公告、无纯颜色信息，并移除非必要空间动效

#### Scenario: Agent Runtime 不可用
- **WHEN** Agent Runtime 未安装、未启动或不可连接
- **THEN** GitHub 登录、首次注册确认和 session 恢复仍可完成

### Requirement: 认证错误使用稳定且不枚举账户的契约
Core API SHALL 使用共享 Problem Details、correlation identifier、稳定 `code`、可选字段 `path` 和适用的 `retryAfterSeconds` 表达联合认证失败。Desktop SHALL 只按机器字段或 poll 状态映射界面，不依赖自然语言 message。匿名 endpoint MUST NOT 泄露 ExternalIdentity、User、attempt 是否存在，也不得回显 OAuth code、state、PKCE verifier、poll secret、completion proof、registration continuation、delivery request/ACK secret、GitHub token 或 TaskPilot token。

#### Scenario: 输入校验失败
- **WHEN** 请求 schema 或字段不符合要求
- **THEN** Core API 返回 `VALIDATION_FAILED` 和安全字段 path，不回显秘密或 Provider 原始响应

#### Scenario: 凭据或验证码失败
- **WHEN** callback 收到用户拒绝或 GitHub 返回可安全分类的授权错误
- **THEN** 对应 attempt 进入稳定拒绝状态，浏览器显示不含秘密的结束页，Desktop polling 获得可重新开始的拒绝语义

#### Scenario: 流程上下文失效
- **WHEN** attempt、poll/completion proof、registration continuation 或 delivery context 无效、过期、已消费或状态不允许当前操作
- **THEN** Core API 返回不支持枚举内部记录的稳定 `FEDERATED_LOGIN_CONTEXT_INVALID`、`FEDERATED_LOGIN_EXPIRED`、`SESSION_DELIVERY_INVALID` 或 `SESSION_DELIVERY_EXPIRED` 类别，Desktop 清理旧状态并按类别重试或重新开始

#### Scenario: 服务暂不可用
- **WHEN** 数据库、GitHub或认证依赖无法安全完成当前动作
- **THEN** Core API 返回 `AUTHENTICATION_TEMPORARILY_UNAVAILABLE` 或对应可轮询暂时状态，保持 fail closed，并记录不含秘密和 Provider token 的 correlation 信息

### Requirement: 认证完成后交接 Workspace onboarding
成功 GitHub 登录或首次注册后，Desktop SHALL 将安全 `CurrentUserView` 和 authenticated session 状态交给 Workspace onboarding 边界。认证 capability MUST NOT 查询、选择或创建 Personal/Organization Workspace，也不得依赖 Agent Runtime；Workspace listing 及后续状态由 `workspace-onboarding` capability 拥有。

#### Scenario: 认证成功交接
- **WHEN** Main 已安全保存 credential、完成 session delivery ACK 且取得不要求 email 的 `CurrentUserView`
- **THEN** Desktop 进入 Workspace onboarding 边界，认证模块不自行发起 Workspace 列表或创建请求

#### Scenario: 当前用户读取失败
- **WHEN** session 已建立但安全当前用户视图无法取得
- **THEN** Desktop 不伪造 User 或进入 Workspace，按认证错误契约刷新一次或进入可恢复的重新认证/暂不可用状态

## REMOVED Requirements

### Requirement: 登录和注册具有独立且明确的入口
**Reason**: GitHub 联合登录同时承担既有身份登录和首次身份注册，邮箱登录与独立邮箱注册入口被移除。

**Migration**: 无存量用户迁移；重置开发数据库后统一从 GitHub 登录入口开始。

### Requirement: 密码登录是默认方式
**Reason**: TaskPilot 不再持有最终用户密码，认证由 GitHub 外部身份证明替代。

**Migration**: 不保留密码登录兼容路径，开发环境重新使用 GitHub 注册。

### Requirement: 邮箱验证码登录是显式替代方式
**Reason**: 邮箱验证码登录及邮件投递链路退出产品范围。

**Migration**: 不提供替代邮箱入口，统一使用 GitHub 登录。

### Requirement: 注册按邮箱验证和账户资料分步完成
**Reason**: 首次注册改为 GitHub 身份验证后确认昵称和条款，不再验证邮箱或设置密码。

**Migration**: 不迁移未完成注册 continuation，重置开发数据库与临时流程数据。

### Requirement: 忘记密码使用独立验证和重置流程
**Reason**: TaskPilot 不再持有密码，因此不存在 TaskPilot 密码重置。

**Migration**: 用户在 GitHub 侧恢复账号控制权；TaskPilot 不提供邮箱找回兼容入口。

### Requirement: OTP challenge 按 purpose 隔离并抵抗滥用
**Reason**: 所有邮箱 OTP purpose、challenge 和发送能力被删除；联合登录使用独立 attempt/state/PKCE/poll-secret 安全模型。

**Migration**: 不迁移或保留 OTP challenge，开发数据库重置时删除。

### Requirement: 密码策略和存储由 Core API 统一负责
**Reason**: Core API 不再接收、哈希或存储 TaskPilot 最终用户密码。

**Migration**: 不迁移 password credential；开发数据库重置后不再创建该数据。

### Requirement: 用户身份以稳定 UserId 和唯一验证邮箱建立
**Reason**: 外部身份唯一键替换 EmailIdentity，UserId 仍保持为 TaskPilot 稳定业务身份。

**Migration**: 无账号合并或邮箱映射；开发数据库重置后由首次 GitHub 注册创建 `(provider, authority, subject) → UserId` 映射。
