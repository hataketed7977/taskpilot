# Spec Delta

## MODIFIED Requirements

### Requirement: Session 使用 Redis opaque credential 并执行轮换与撤销
Core API SHALL 在 Redis 中保存有 TTL 的 session family、access digest 和 refresh digest，不在 PostgreSQL 中创建 session、delivery 或 refresh recovery 表。成功登录或注册 SHALL 直接签发 ACTIVE access/refresh credential。access token 用于 bearer-protected API；refresh token 每次成功使用 SHALL 同时轮换 access 和 refresh token。Desktop Main SHALL 只通过 Gateway 的 canonical user resource API 访问认证和 session operation，Gateway 不可用时 MUST NOT 直连 Core API。Core API SHALL 接受凭据持有者使用自身 refresh credential 原子撤销其 session，即使 access 已过期或同一 session 先发生 rotation；Desktop Main SHALL 优先使用已持有 refresh credential 退出且不为退出额外 refresh，旧客户端 bearer 方式 SHALL 保留。

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
- **WHEN** Desktop 通过 `POST /v1/session:logout` 提交自身已持有的 refresh credential，或旧客户端使用当前有效 access bearer 调用 logout
- **THEN** Core API 原子撤销凭据对应的 session；Desktop 先使旧 generation 和本地认证 UI 失效，再清除按 environment 和 User 隔离的本地 credential 并 best-effort 请求撤销；迟到的读取、refresh 或登录结果不得恢复已退出 UI

#### Scenario: Redis 不可用
- **WHEN** OAuth、限流、session 读取、刷新或撤销所需的 Redis 不可用
- **THEN** 认证链路 fail closed，并按既有端点映射返回安全的认证失败或暂时不可用 Problem Details，不降级到进程内或 PostgreSQL session；本次 logout 保留 `503 TEMPORARILY_UNAVAILABLE`，不改变其他端点的既有错误映射

#### Scenario: Gateway 不可用
- **WHEN** Desktop 无法安全访问 Gateway
- **THEN** 在非用户主动退出的恢复/请求失败场景中，Desktop 显示可恢复的暂时不可用状态，不改用内部 Core API origin、不清除仍可能有效的 credential，也不伪造 authenticated success；用户主动退出仍按登出规则清理本地credential，不因Gateway不可用恢复认证

#### Scenario: access 已过期而 refresh 仍有效
- **WHEN** access 索引已过期，Desktop 仍持有有效 refresh credential 并退出
- **THEN** Main 直接使用 refresh credential 请求撤销而不先 refresh；Core API 不依赖过期 access 索引，退出后该 session 的 refresh 不能再签发凭据

#### Scenario: logout 与 rotation 竞争
- **WHEN** 同一 session 的 logout 与 refresh 以任意顺序原子执行，logout 使用当前 refresh 或已轮换但尚在绝对过期上限内的 used refresh marker
- **THEN** logout 撤销 marker 对应 session 的当前 access、refresh 和 session 记录；即使 rotation 先执行，其新凭据也失效，不影响其他 session，且不延长任何 TTL

#### Scenario: 离线退出与凭据存储故障
- **WHEN** 退出时 Gateway/网络不可用，或 OS credential facility 的读取/删除失败
- **THEN** Main 保持旧 generation 已失效且本地 signedOut，不因迟到结果恢复认证；网络撤销为 best-effort，存储失败由仍挂载的 App 在 signedOut 登录页显示不含秘密的可访问提示，明确本地凭据未能确认清除且重启可能恢复会话，不声称已清除；系统不承诺离线即时服务端撤销，也不增加持久撤销队列


#### Scenario: 两个退出入口的迟到存储错误
- **WHEN** 用户从账号菜单或 Project 加载失败页退出，Main 的 signedOut 事件已使原页面卸载，随后 logout 返回 CREDENTIAL_STORAGE_UNAVAILABLE
- **THEN** App 捕获失败并在登录页保留 zh-CN/en 安全错误提示，无 unhandled rejection、不恢复认证；同次退出的 signedOut 事件不会丢弃该提示，子组件卸载不会丢失反馈

#### Scenario: 新登录意图或账号状态抢先于退出错误
- **WHEN** 退出尚未完成时用户开始新的登录意图、收到新的 authenticated 状态（包括同一 User 再登录），或 App 已卸载/切换 api，随后旧 logout 返回失败
- **THEN** 旧操作不能修改新登录/账号的提示、pending 或 session 状态；新的登录意图/认证状态清除旧退出提示，App 卸载后的 completion 不写状态

## ADDED Requirements

### Requirement: Desktop 显式重试 Main session 恢复
Desktop SHALL 提供无参数的窄 `auth.retrySessionRestore()` capability，供暂时不可用页面重试 Main-owned session 恢复而非重新加载 Renderer。`getSessionView()` SHALL 保持只读。启动恢复、显式恢复重试与受保护调用的 refresh SHALL 在同一 generation 内共享 single-flight；每次异步读取凭据前 SHALL 捕获 generation，并 fence 迟到读取、写入、成功和错误。凭据及原始 transport 能力 MUST NOT 暴露给 Renderer。

#### Scenario: 暂时故障后显式重试
- **WHEN** 启动恢复因临时网络/Gateway/Core 故障进入 temporarilyUnavailable，之后用户点击 Retry
- **THEN** Main 重新尝试恢复，UI 呈现 restoring/pending，不重载窗口；安全保存新凭据后转为 authenticated，临时故障仍保留可能有效的 refresh credential 并回到 temporarilyUnavailable

#### Scenario: 并发恢复与刷新
- **WHEN** 启动 restore、重复 Retry 或 protected-call refresh 在同一 generation 的凭据消费尚未完成时重叠
- **THEN** 各调用加入同一进行中的凭据消费操作，不重复使用 refresh token；Retry pending 期间按钮不可重复触发并具有可访问的状态说明

#### Scenario: 只读视图与非恢复状态
- **WHEN** Renderer 调用 getSessionView，或在 authenticated/signedOut 状态调用 retrySessionRestore
- **THEN** 只返回当前安全 SessionView，不读取秘密、不调用 refresh，也不启动隐藏登录；restoring 状态的 Retry 只加入当前恢复操作

#### Scenario: 退出或账号替换抢先完成
- **WHEN** restore/refresh 正等待凭据读取、HTTP 返回、保存或失败处理，用户退出或建立新的账号 session
- **THEN** 旧操作不得消费迟到读取的凭据、覆盖新凭据、清除新账号数据或发布旧 authenticated/error 状态；已签发但被 supersede 的旧 session 仅执行 best-effort 撤销，不阻止新 generation 的恢复

#### Scenario: terminal 认证失败与保存失败
- **WHEN** 当前 generation 的恢复返回 terminal 401，或轮换后凭据无法安全保存
- **THEN** Main 不发布 authenticated；401 清理旧凭据并进入 signedOut，清理失败显式报告存储不可用；保存失败 best-effort 撤销新凭据并清理本地旧凭据，清理成功进入 signedOut，清理失败进入 temporarilyUnavailable，Renderer 处理失败而不产生 unhandled rejection

#### Scenario: refresh 响应丢失后重试
- **WHEN** 上次 refresh 的结果不确定，用户后来显式重试恢复
- **THEN** 系统不自动重放 refresh、不增加 recovery 协议；显式重试仍遵守原有 used-token replay fail-closed 规则，若返回 401 则要求重新登录
