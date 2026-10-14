# Spec Delta

## Purpose

定义认证用户的统一 Workspace 边界，使每个账号从注册起即拥有唯一个人空间和明确 Owner 关系，同时让未来团队空间能够复用相同身份、成员与授权模型而不改变现有数据所有权。

## ADDED Requirements

### Requirement: 每个 User 原子获得唯一个人 Workspace
Core API SHALL 在新 User 注册事务中创建且仅创建一个类型为 `PERSONAL` 的 Workspace，并 SHALL 在同一事务中创建该 User 的 `WorkspaceMembership(OWNER)`。User、ExternalIdentity、TermsAcceptance、个人 Workspace、Workspace Membership、默认 Project 与 Project Membership MUST 全部成功后才可提交；任一失败 MUST 回滚全部长期事实且不得签发 session。

#### Scenario: 首次注册成功
- **WHEN** 尚未关联 User 的可信 External Identity 完成有效注册确认
- **THEN** 系统提交一个 User、一个 PERSONAL Workspace、该 User 的 Workspace OWNER 关系以及同事务中的身份、法律和默认 Project 事实

#### Scenario: 配置中途失败
- **WHEN** 创建个人 Workspace、任一 Membership 或默认 Project 的任何一步失败
- **THEN** 数据库事务整体回滚，不留下 User、ExternalIdentity、TermsAcceptance、Workspace、Project 或残缺所有权关系，且不签发 session

#### Scenario: 并发确认同一 External Identity
- **WHEN** 同一未绑定 External Identity 被并发确认注册
- **THEN** 最多创建一个 User 及其一套个人 Workspace 和默认 Project，后到请求解析为同一已注册 User 而不重复配置

### Requirement: Workspace 使用统一类型模型并限制个人空间生命周期
Workspace SHALL 具有稳定 `workspaceId` 和 `PERSONAL | TEAM` 类型。当前能力 SHALL 只创建和返回 `PERSONAL` Workspace；每个 User MUST 恰有一个个人 Workspace。用户 MUST NOT 创建、删除、转移个人 Workspace，也不能向其中邀请或添加成员。`TEAM` 只作为模型保留值，当前 API 和 Desktop MUST NOT 暴露团队空间创建、邀请或管理入口。

#### Scenario: 读取个人 Workspace
- **WHEN** 已认证 User 读取其可访问 Workspace
- **THEN** 系统返回其唯一 PERSONAL Workspace 及 OWNER 关系，不依赖外部 provider identity 或设备语言确定 Workspace 身份

#### Scenario: 尝试创建或管理个人 Workspace
- **WHEN** 客户端尝试创建第二个个人 Workspace、删除或转移个人 Workspace、或添加个人空间成员
- **THEN** 当前 Desktop API 不提供该操作，Core API 也不通过其他当前路径接受该状态变更

#### Scenario: TEAM 尚未实现
- **WHEN** 客户端构造 TEAM Workspace 的创建或成员管理请求
- **THEN** 系统拒绝或不存在该操作，且 Desktop 不显示不可用的团队空间占位入口

### Requirement: Workspace 范围由 Core API 重新授权
任何 Workspace-scoped 操作 SHALL 从 ACTIVE session 建立可信 User，并由 Core API 根据 Workspace Membership 重新校验范围；Renderer、Main 提交的 `workspaceId` 或隐藏控件 MUST NOT 构成授权。对不属于当前 User 的 Workspace，响应 MUST 避免泄露其存在性。

#### Scenario: 访问自己的个人 Workspace
- **WHEN** ACTIVE User 以其个人 `workspaceId` 请求受支持的 Workspace 或 Project 操作
- **THEN** Core API 以 Workspace Membership 授权并继续执行该操作

#### Scenario: 跨 Workspace 猜测标识
- **WHEN** User 使用其他用户的或不存在的 `workspaceId`
- **THEN** Core API 以稳定 not-found 语义拒绝且不返回该 Workspace、成员或 Project 信息

#### Scenario: session 已失效
- **WHEN** 请求携带过期、撤销或无效的 access bearer
- **THEN** Core API 在读取 Workspace 事实前返回 `AUTHENTICATION_REQUIRED`
