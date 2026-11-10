# Spec Delta

## MODIFIED Requirements

### Requirement: Session 与 current-user OpenAPI 准确声明认证方式
OpenAPI SHALL 使用 `x-taskpilot-authentication` 和标准 security declaration 区分 refresh credential body、access bearer 和 logout 双模式。成功 refresh SHALL 返回一组轮换后的 access/refresh token 与当前用户；logout SHALL 接受二选一的 refresh credential body 或 legacy access bearer，`GET /v1/me` SHALL 仍只接受 access bearer。logout SHALL 保持原 method/path/operationId，不能接受客户端提供的 UserId/sessionId/scope 选择撤销目标。

#### Scenario: 检查 refresh
- **WHEN** 自动化读取 `POST /v1/session:refresh`
- **THEN** operation 声明 `refresh-credential-body`，请求只有 `refreshToken`，成功 `200` 返回 `SessionResponse`，且不要求或描述 request id recovery

#### Scenario: 检查 logout
- **WHEN** 自动化读取 `POST /v1/session:logout`
- **THEN** operation 声明 `access-bearer-or-refresh-credential-body`、可选 LogoutRequest 与标准 security OR（`accessBearer` 或空 security requirement）；description 明确空 requirement 仅表示 refresh body 可替代 bearer，并非允许无凭据撤销；成功状态为 `204`，缺少或 malformed legacy bearer 返回 `401`

#### Scenario: 检查当前用户
- **WHEN** 自动化读取 `GET /v1/me`
- **THEN** operation 声明 `access-bearer`，成功 schema 只包含 `userId`、`displayName` 和可选 `avatarUrl`，无效 bearer 返回 `401`

#### Scenario: refresh logout 请求校验
- **WHEN** logout 请求带有 refreshToken，或请求体无法满足 LogoutRequest 的形状、类型和界限
- **THEN** refresh 模式要求非空且不超过 512 Unicode code points 的字符串、不附带 Authorization，额外属性、显式 null、错误类型、空/超长 refreshToken 或双凭据以 `400 VALIDATION_FAILED` 在副作用前拒绝；缺少 body 或空对象使用 legacy bearer 模式

#### Scenario: 幂等 logout 与不可用服务
- **WHEN** logout 收到形状合法但不存在、已撤销或已过期的凭据，或撤销所需的 Redis 不可用
- **THEN** 未命中的合法凭据返回 `204`，不泄漏 session 是否存在；Redis 不可用保留当前通用映射 `503 TEMPORARILY_UNAVAILABLE` 而非成功撤销，响应使用共享 Problem Details；不新增 logout 专用错误映射或修改其他端点错误码


## ADDED Requirements

### Requirement: 产品文本写入使用独立且有界的传输预算
Desktop IPC 和 Core HTTP request guard SHALL 使用 128 KiB（131072 字节）的 body 预算，按实际序列化的 UTF-8 字节计算，精确边界接受而超出一字节拒绝。产品字段 SHALL 继续遵守既有 trim、Unicode NFC、code-point 上限、sparse edit 与历史响应兼容规则；传输预算 MUST NOT 替代字段校验或承诺接收任意编码/空白膨胀。Gateway 默认 1 MiB 预算 SHALL 保持不变，承载该能力的部署请求预算 MUST 能容纳 Core 的 128 KiB body。

#### Scenario: 产品上限内的非 ASCII 文本
- **WHEN** Work Item create/edit 提交规范化后 5000 code points 的描述及合法标题、scope/version/patch 元数据，body 在 128 KiB 内
- **THEN** 正常 UTF-8、JSON surrogate escapes 和 NFC 前可能膨胀的组合字符不因原 16 KiB 传输预算被拒绝；其他授权、版本与业务校验仍独立执行

#### Scenario: 精确与超出字节边界
- **WHEN** 合法形状请求的 UTF-8 body 恰好 131072 字节或为 131073 字节
- **THEN** guard 对前者放行，对后者在业务副作用前拒绝；Core 返回 `413 REQUEST_TOO_LARGE`，IPC 保持既有 `VALIDATION_FAILED` 错误映射

#### Scenario: 无长度及 chunked 请求
- **WHEN** Core 收到未知 Content-Length 或真实 chunked body
- **THEN** guard 限量读取最多预算加一字节，超限拒绝且不执行业务处理，合法 body 被缓存供下游正常解析；不能仅信任 Content-Length

#### Scenario: 规范化与历史兼容不放宽
- **WHEN** body 未超限但字段规范化后超出产品上限，或对历史超长记录执行未涉及该字段的 sparse edit
- **THEN** 前者整体拒绝且不截断，后者保持原有可读和局部编辑兼容；原始 body 超出预算时即使规范化后字段较短也可拒绝
