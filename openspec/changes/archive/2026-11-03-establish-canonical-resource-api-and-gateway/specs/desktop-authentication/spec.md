# Spec Delta

## MODIFIED Requirements

### Requirement: Session 使用 Redis opaque credential 并执行轮换与撤销
Core API SHALL 在 Redis 中保存有 TTL 的 session family、access digest 和 refresh digest，不在 PostgreSQL 中创建 session、delivery 或 refresh recovery 表。成功登录或注册 SHALL 直接签发 ACTIVE access/refresh credential。access token 用于 bearer-protected API；refresh token 每次成功使用 SHALL 同时轮换 access 和 refresh token。Desktop Main SHALL 只通过 Gateway 的 canonical user resource API 访问认证和 session operation，Gateway 不可用时 MUST NOT 直连 Core API。

#### Scenario: 获取当前用户
- **WHEN** `GET /v1/me` 经 Gateway 携带有效 ACTIVE access bearer
- **THEN** Core API 返回 `userId`、`displayName` 和可选 `avatarUrl`；无效、过期或撤销 token 返回 `AUTHENTICATION_REQUIRED`

#### Scenario: 正常刷新
- **WHEN** Desktop 通过 `POST /v1/session:refresh` 提交当前有效 refresh token
- **THEN** Redis 原子消费旧 token、签发新 access/refresh token，并保持同一 session family 的绝对过期上限

#### Scenario: 旧 refresh token 重放
- **WHEN** 已轮换的旧 refresh token 再次出现
- **THEN** Core API 视为重放并撤销整个 session family，后续 access 与 refresh 都失败关闭

#### Scenario: refresh 响应不确定
- **WHEN** refresh 已在服务端完成但响应丢失，Desktop 只能重试旧 refresh token
- **THEN** session family 可能因重放保护被撤销，Desktop 清除本地 credential 并要求重新登录；系统不提供 request-id recovery 协议

#### Scenario: 登出
- **WHEN** Desktop 通过 `POST /v1/session:logout` 使用当前 access bearer 调用 logout
- **THEN** Core API 立即撤销该 session，Desktop 清除按 environment 和 User 隔离的本地 credential；迟到的 refresh 或登录结果不得恢复已退出 UI

#### Scenario: Redis 不可用
- **WHEN** OAuth、限流、session 读取、刷新或撤销所需的 Redis 不可用
- **THEN** 认证链路 fail closed，并以 `AUTHENTICATION_TEMPORARILY_UNAVAILABLE` 或认证失败状态返回，不降级到进程内或 PostgreSQL session

#### Scenario: Gateway 不可用
- **WHEN** Desktop 无法安全访问 Gateway
- **THEN** Desktop 显示可恢复的暂时不可用状态，不改用内部 Core API origin、不清除仍可能有效的 credential，也不伪造 authenticated success
