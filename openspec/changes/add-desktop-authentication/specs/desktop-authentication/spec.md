# Spec Delta

## Purpose

为 TaskPilot Desktop 提供由身份提供方托管邮箱验证码、凭据不进入 Renderer、且由 Core API 独立验证的登录注册入口，为 Workspace onboarding 建立可信的 User 前提。

## ADDED Requirements

### Requirement: 托管邮箱验证码承载统一登录注册
Desktop SHALL 通过系统默认浏览器启动符合 OIDC Authorization Code + PKCE 的认证流程。首期登录方式 SHALL 为身份提供方托管的 Passwordless Email OTP，邮箱采集、验证码生成、发送、频控、过期、校验以及首次 Provider 账号创建 SHALL 由身份提供方拥有。TaskPilot MUST NOT 在 Renderer、Main 或 Core API 中采集 OTP、存储用户密码，或提供自有验证码接口。

#### Scenario: 已有邮箱账号登录
- **WHEN** 用户从 Desktop 选择“使用邮箱继续”并在身份提供方页面完成邮箱验证码
- **THEN** Desktop 通过标准授权回调建立已认证状态，而不接收或校验 OTP

#### Scenario: 首次邮箱账号创建
- **WHEN** 用户首次通过同一入口完成身份提供方托管的邮箱验证
- **THEN** 身份提供方创建其身份并通过同一标准授权回调登录，TaskPilot 不暴露独立自建注册协议

#### Scenario: 用户取消、验证码失败或发送受限
- **WHEN** 用户取消浏览器流程，或身份提供方返回 OTP 错误、过期、发送受限或其他协议错误
- **THEN** Desktop 将结果映射为不泄露账号是否存在的稳定可恢复类别，回到可重试未认证状态，且不保留半完成登录或长期凭据

#### Scenario: Agent Runtime 不可用
- **WHEN** Agent Runtime 未安装、未启动或不可连接
- **THEN** 登录和账号创建流程仍可完成

### Requirement: 授权回调具有完整性和时效保护
每次认证尝试 SHALL 使用高熵且一次性的 `state`、`nonce`、PKCE verifier/challenge 和受限有效期。Main SHALL 在打开浏览器前绑定 `127.0.0.1` 或 `[::1]` 数值 loopback 地址，由操作系统分配端口，并使用身份提供方批准或注册的固定 callback path；不得以无法注册的随机 path 作为安全前提。认证 code MUST 仅由 Main 交换，Renderer MUST NOT 接收 code、verifier 或 token。

#### Scenario: 合法回调
- **WHEN** Main 在有效期内收到与当前 loopback redirect URI 和 `state` 匹配的首次授权回调
- **THEN** Main 使用原 PKCE verifier 交换 code，使该尝试不可再次消费，并在 token validation 阶段校验 ID Token 中的 `nonce`、issuer、audience、授权方及时间约束

#### Scenario: state 不匹配
- **WHEN** loopback listener 收到缺失、未知或不匹配的 `state`
- **THEN** Desktop 拒绝回调，不交换 code，不改变当前认证状态，并记录不含敏感值的安全事件

#### Scenario: token nonce 不匹配
- **WHEN** code exchange 返回的 ID Token 不含当前尝试的 `nonce` 或其值不匹配
- **THEN** Desktop 拒绝 token 集合、销毁该尝试的一次性秘密且不建立会话

#### Scenario: 回调超时或重复
- **WHEN** 回调在尝试过期后到达或同一尝试被再次回调
- **THEN** Desktop 拒绝该回调且不复用 verifier

#### Scenario: 非预期监听入口
- **WHEN** 请求不匹配当前尝试绑定的 loopback host、端口或已注册 callback path
- **THEN** Desktop 不将其视为认证成功，也不向请求方泄露 verifier、token 或内部诊断信息

### Requirement: 长期凭据受 Main 和操作系统边界保护
Access token、refresh token 及其他可用于续期的敏感凭据 SHALL 仅由 Electron Main 的认证/云端客户端持有；需要跨重启保存的凭据 MUST 通过受支持的操作系统凭据设施保护。Renderer、Preload 返回值、Agent Runtime、日志、遥测、错误和 URL MUST NOT 包含 OTP、authorization code、PKCE verifier 或 token。

#### Scenario: 应用重启后恢复
- **WHEN** 操作系统凭据设施中存在仍可用的登录凭据且用户启动 Desktop
- **THEN** Main 在不向 Renderer 暴露凭据的情况下恢复或刷新会话，并只向 Renderer返回最小认证状态和用户视图

#### Scenario: 操作系统凭据设施不可用
- **WHEN** 当前平台无法安全保护需要持久化的长期凭据
- **THEN** Desktop SHALL NOT 将明文或弱保护凭据降级写入普通配置，并要求用户重新登录或仅保持受限的内存会话

#### Scenario: Renderer 请求原始凭据
- **WHEN** Renderer 或任意 Preload 调用尝试获取 OTP、access token、refresh token、authorization code 或 PKCE verifier
- **THEN** 暴露的能力契约不提供该数据且 Main 拒绝非预期 IPC 请求

### Requirement: Core API 直接验证可信身份
Desktop 对受保护接口的请求 SHALL 使用短生命周期 bearer JWT access token。当前阶段 Core API SHALL 作为唯一应用层 Resource Server，验证精确匹配的受信 issuer、允许算法、签名、audience、时间约束和稳定 subject，并只从已验证声明建立 principal。Core API MUST NOT 把 email、客户端身份头或网络位置当作认证证据；无法验证时 MUST fail closed。本 Change MUST NOT 为认证目的初始化独立 Gateway。

#### Scenario: 有效 access token
- **WHEN** Desktop 使用满足配置 issuer、算法、签名、audience、有效期和必要声明约束的 access token 请求 Desktop API
- **THEN** Core API 接受可信外部主体并允许请求进入后续业务授权

#### Scenario: 无效或过期 token
- **WHEN** token 缺失、过期、尚未生效、签名无效、使用 `none` 或非允许算法、issuer 或 audience 不匹配，或缺少稳定 subject
- **THEN** 请求在业务处理前以 `401 AUTHENTICATION_REQUIRED` Problem Details 失败，且不得创建或解析 User

#### Scenario: 客户端伪造身份信息
- **WHEN** 外部请求携带声称是内部 User、Workspace、角色、已认证主体或 email 的头或字段
- **THEN** Core API 不以这些值授予身份或权限

#### Scenario: 身份提供方验证材料暂不可用
- **WHEN** 刷新或获取验证密钥失败且本地没有仍有效的可信缓存可验证 token
- **THEN** 系统以 `503 AUTHENTICATION_TEMPORARILY_UNAVAILABLE` 失败，MUST NOT 跳过签名或声明验证

### Requirement: 外部身份幂等映射为 TaskPilot User
Core API `access` 能力 SHALL 以 token 中精确验证的 `(issuer, subject)` 作为外部身份唯一键，并将其映射到稳定且不可回收的 `UserId`。首次 bootstrap SHALL 在数据库成功边界内幂等创建映射和 User；email、显示名、头像或身份提供方用户名 MUST NOT 用作身份唯一键或自动账号合并依据。Email 只有在身份提供方声明已验证且满足批准的 claim policy 时才可成为展示投影。

#### Scenario: 首次可信身份 bootstrap
- **WHEN** 通过验证的 `(issuer, subject)` 首次调用 Desktop session bootstrap API
- **THEN** Core API 创建一个稳定 User 和对应外部身份映射，并返回不含原始身份凭据的当前用户视图

#### Scenario: 重复 bootstrap
- **WHEN** 同一 `(issuer, subject)` 再次或并发调用 bootstrap
- **THEN** Core API 返回同一 `UserId`，且数据库中至多存在一个对应 User 和一个外部身份映射

#### Scenario: 相同 email 的不同外部主体
- **WHEN** 两个不同 `(issuer, subject)` 声明相同 email 且没有显式账号绑定能力
- **THEN** 系统不基于 email 自动合并身份，并为它们保持不同的 User

#### Scenario: 未验证或变化的邮箱声明
- **WHEN** email 未满足批准的验证策略，或已映射身份的 email、显示名或头像声明发生变化
- **THEN** 未验证 email 不进入展示投影，`UserId` 保持不变，批准资料更新不得改变身份归属

### Requirement: Desktop 当前用户契约窄且可恢复
Core API SHALL 提供受保护且独立于 Workspace 的 Desktop session bootstrap 与当前用户读取能力。成功响应 SHALL 只包含稳定 `UserId` 和允许展示的用户资料；不得返回 provider subject、token 或内部授权实现。错误 SHALL 使用共享 Problem Details 约定、correlation identifier 和稳定 `code`。

#### Scenario: bootstrap 成功
- **WHEN** 已认证 Desktop 调用 `POST /desktop/v1/session/bootstrap`
- **THEN** 系统幂等建立或解析当前 User，并始终以 `200 OK` 返回当前用户视图

#### Scenario: 读取当前用户
- **WHEN** 已完成 bootstrap 的 Desktop 调用 `GET /desktop/v1/me`
- **THEN** 系统返回与认证主体绑定的同一 `UserId` 和当前允许展示的资料

#### Scenario: 尚未 bootstrap 时读取
- **WHEN** 有效外部身份尚无 TaskPilot User 映射并调用 `GET /desktop/v1/me`
- **THEN** 系统返回 `409 USER_BOOTSTRAP_REQUIRED`，且读取操作不隐式创建 User

#### Scenario: 未认证访问
- **WHEN** 请求在没有有效认证凭据时调用任一 Desktop 用户接口
- **THEN** 系统返回 `401 AUTHENTICATION_REQUIRED`，且不泄露 User 是否存在

### Requirement: 刷新和登出保持本机安全状态
Main SHALL 在 access token 到期前或收到可恢复的未认证结果时，通过身份提供方标准 token endpoint 使用 refresh token 恢复一次请求；同一请求不得无限刷新重试。登出 SHALL 先使当前 session generation 失效、停止新凭据请求和自动刷新，并把待撤销凭据从活动会话隔离；Main 可仅在受限内存中保留短生命周期撤销副本，完成或超时后必须销毁。无论远端撤销结果如何，本机凭据、认证缓存和旧 generation 都不得恢复。

#### Scenario: refresh 成功并轮换凭据
- **WHEN** 会话可刷新且身份提供方返回新的 token 集合
- **THEN** Main 安全替换持久化凭据、使旧 refresh token 不再用于后续请求，并至多重试原云端请求一次

#### Scenario: refresh 被拒绝
- **WHEN** refresh token 过期、被撤销、发生重放或身份提供方拒绝刷新
- **THEN** Desktop 清除本地凭据、停止自动刷新并进入要求重新认证的状态

#### Scenario: 用户登出
- **WHEN** 用户确认登出
- **THEN** Main 立即失效本地 session generation、删除 OS credential、清空 Renderer 认证及 Workspace/Project 作用域缓存，并在受限时限内尽力撤销隔离的长期凭据

#### Scenario: 远端撤销失败或迟到 refresh 完成
- **WHEN** 身份提供方撤销失败、超时，或旧 generation 的 refresh 在登出后返回
- **THEN** Desktop 保持本机已退出状态，销毁撤销副本且不保存任何迟到凭据，并提供不泄密的非阻断提示

### Requirement: 认证完成后交接 Workspace onboarding
认证完成和 User bootstrap 成功后，Desktop SHALL 将安全 `CurrentUserView` 和 authenticated session 状态交给 Workspace onboarding 边界。认证流程 MUST NOT 查询、选择、创建 Personal 或 Organization Workspace，也不得依赖 Agent Runtime；Workspace listing 及其后续状态由 `add-organization-workspace-onboarding` 拥有。

#### Scenario: bootstrap 完成交接
- **WHEN** 登录与 bootstrap 成功
- **THEN** Desktop 进入 Workspace onboarding 边界，认证模块不自行发起 Workspace 列表或创建请求
