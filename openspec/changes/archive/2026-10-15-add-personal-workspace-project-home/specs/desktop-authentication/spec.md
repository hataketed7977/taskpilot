# Spec Delta

## MODIFIED Requirements

### Requirement: 首次 GitHub 登录经显式确认后原子注册
当可信 External Identity 尚未关联 User 时，Core API SHALL 产生短期、一次性的 registration continuation。continuation 只可保存在 Desktop Main；Renderer 只接收 flow id、建议显示名称、可选头像和法律文档组合版本。注册 SHALL 在一个数据库事务中原子创建 `User`、`ExternalIdentity`、`TermsAcceptance`、唯一 `PERSONAL` Workspace、`WorkspaceMembership(OWNER)`、普通默认 Project 和 `ProjectMembership(OWNER)`，随后才可签发 ACTIVE session。Core API SHALL 只接受当前获批法律组合中受支持的精确 `(locale, legalBundleVersion, termsVersion, privacyVersion)` 四元组，并 SHALL 将该四元组中的 locale 与版本字段共同持久化为用户实际阅读文本的接受证据；单独版本字段不得被解释为跨 locale 唯一文本标识。

#### Scenario: 首次授权
- **WHEN** 有效 GitHub identity 尚未关联 User
- **THEN** Desktop 以当前选择的受支持语言显示首次注册页，允许修改显示名称、选择是否采用 GitHub 头像、查看同语言的用户协议和隐私政策，并提供返回登录方式的操作

#### Scenario: 确认注册
- **WHEN** 用户提交非空显示名称、头像选择及与服务端当前获批组合精确一致的 `(locale, legalBundleVersion, termsVersion, privacyVersion)` 四元组
- **THEN** Core API 原子提交完整身份、法律、个人 Workspace、默认 Project 及两级 OWNER 关系，返回 ACTIVE session 和新建 Project 上下文

#### Scenario: 注册过程中切换语言
- **WHEN** 用户已勾选同意后从一种受支持语言切换到另一种
- **THEN** Desktop 保留显示名称和头像选择，清除原同意，展示新语言的精确法律文档，并要求用户重新明确同意后才可注册

#### Scenario: 未接受或版本不匹配
- **WHEN** 用户未主动勾选接受、客户端提交的 locale 不受支持，或法律四元组不是服务端当前获批组合
- **THEN** Desktop 不提交注册，或 Core API 以 `LEGAL_BUNDLE_REJECTED` 拒绝注册，且不创建任何长期账号、Workspace 或 Project 事实

#### Scenario: 客户端缺少精确法律文档
- **WHEN** 服务端要求的组合或当前 locale 的用户协议/隐私政策未随客户端提供
- **THEN** Desktop fail closed，禁止同意与注册，显示可恢复说明且不静默展示另一语言作为接受依据

#### Scenario: 注册配置失败
- **WHEN** 个人 Workspace、默认 Project 或任一 OWNER Membership 创建失败
- **THEN** Core API 回滚同一事务中的 User、ExternalIdentity、TermsAcceptance 及全部配置事实，不签发 session

#### Scenario: 并发注册同一 External Identity
- **WHEN** 同一 provider identity 被并发确认注册
- **THEN** 唯一约束保证它最多关联一个 User 和一套个人 Workspace/默认 Project；后到请求解析为已创建的同一 ACTIVE User，而不是创建第二个账号或重复配置

### Requirement: 当前认证切片交接到 Project 首页
当前 runnable slice SHALL 在成功登录后复用稳定 `UserId` 进入个人 Workspace 的 Project 首页，并继续提供 logout 和 `zh-CN/en` 语言选择。Google/Lark SSO、账号绑定/合并、TEAM Workspace 行为、生产部署、签名安装包、服务端错误文案国际化与更多语言不属于本规格当前实现；外部 provider identity 或设备语言偏好不得成为 Workspace 或 Project 的业务身份。

#### Scenario: 认证成功
- **WHEN** Desktop 安全保存 refresh credential 并建立 authenticated session
- **THEN** Renderer 直接解析个人 Workspace 与 Project 落点，显示 Project 上下文、账号、语言选择和退出登录，而不是停留在账号视图或 Workspace onboarding

#### Scenario: Agent Runtime 不可用
- **WHEN** Agent Runtime 未启动或尚未实现
- **THEN** 双语 GitHub 登录、session 恢复、Project 首页、语言切换和 logout 仍可独立工作

## RENAMED Requirements

- FROM: `### Requirement: 当前认证切片结束于账号视图`
- TO: `### Requirement: 当前认证切片交接到 Project 首页`
