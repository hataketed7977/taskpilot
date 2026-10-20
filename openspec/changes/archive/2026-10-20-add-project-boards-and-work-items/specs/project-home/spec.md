# Spec Delta

## MODIFIED Requirements

### Requirement: 注册创建普通默认 Project 及 Owner 关系
新 User 的注册事务 SHALL 在其个人 Workspace 中创建一个普通 `ACTIVE` Project、`ProjectMembership(OWNER)`、普通初始 Board 和其初始 Column。Project 初始名称 SHALL 按注册时已接受的法律 locale 选择：`zh-CN` 为“我的项目”，`en` 为“My project”；Board 初始名称 SHALL 分别为“工作看板”与“Board”，Column 初始名称 SHALL 分别为“待处理”与“To do”；初始描述均 SHALL 为空。默认 Project、初始 Board 和初始 Column MUST NOT 具有 `isDefault`、特殊类型或删除后自动重建语义。

#### Scenario: 中文注册
- **WHEN** User 使用 `zh-CN` 法律组合完成首次注册
- **THEN** 其个人 Workspace 获得名为“我的项目”的 ACTIVE Project、名为“工作看板”的普通 Board 和名为“待处理”的普通 Column，且该 User 为 Project OWNER

#### Scenario: 英文注册
- **WHEN** User 使用 `en` 法律组合完成首次注册
- **THEN** 其个人 Workspace 获得名为“My project”的 ACTIVE Project、名为“Board”的普通 Board 和名为“To do”的普通 Column，且该 User 为 Project OWNER

#### Scenario: 默认 Project 后续变更
- **WHEN** Owner 编辑、归档、恢复或永久删除注册时创建的 Project
- **THEN** 系统按普通 Project 规则处理，不阻止变更，也不创建替代 Project

### Requirement: 登录后直接解析 Project 首页
Desktop SHALL 在认证成功或 session 恢复后直接解析 Project 上下文而不显示 Workspace onboarding。首次注册 SHALL 打开刚创建的默认 Project 及其初始 Board；再次登录 SHALL 优先打开当前 environment 与 User 下记住且仍可访问的 ACTIVE Project，再按 Board 解析规则打开该 Project 的 Board；无有效 Project 偏好时 SHALL 打开个人 Workspace 中按 `createdAt`、`projectId` 升序的第一个可访问 ACTIVE Project；仍无项目时 SHALL 显示创建 Project 空状态。

#### Scenario: 首次注册完成
- **WHEN** Desktop 已安全保存新 session 且注册响应包含新建默认 Project 上下文
- **THEN** Renderer 直接进入该 Project 的初始 Board，不要求用户选择 Workspace、Project 或 Board

#### Scenario: 最近 Project 仍有效
- **WHEN** 再次登录时本机记住的 Project 仍属于当前 User 的个人 Workspace且为 ACTIVE
- **THEN** Desktop 打开该 Project，再解析并打开其最近可访问 Board

#### Scenario: 最近 Project 已归档、删除或不可访问
- **WHEN** 记住的 Project 不能再作为 ACTIVE Project 访问
- **THEN** Desktop 清除该选择并打开排序后的第一个可访问 ACTIVE Project；若不存在则显示创建 Project 空状态

#### Scenario: 迟到响应来自旧 session
- **WHEN** logout、重新登录、User 或 environment 切换后收到旧 session generation 的 Workspace 或 Project 响应
- **THEN** Desktop 丢弃该响应，不恢复旧项目、旧错误或旧选择

### Requirement: Workspace Owner 可创建 Project，Project Owner 可编辑 Project
当前实现 SHALL 只授予 `WorkspaceMembership(OWNER)` 与 `ProjectMembership(OWNER)` 角色。创建 Project SHALL 以目标 Workspace 的 `WorkspaceMembership(OWNER)` 授权；Project 创建成功前不得要求尚不存在的 Project Membership。创建者 SHALL 在同一事务中成为 Project OWNER。修改已有 Project 的名称和描述 SHALL 同时校验 Workspace 范围与该 Project 的 `ProjectMembership(OWNER)`。名称 SHALL 先去除首尾空白，规范化结果 MUST 为 1 至 200 个 Unicode code point；描述 SHALL 去除首尾空白并限制为最多 2000 个 Unicode code point，缺失或全空白描述规范化为空字符串。创建请求 SHALL 携带由客户端生成且在 actor 与 Workspace 范围内唯一的 UUID request id，以及受支持的当前 locale；Core API SHALL 在同一事务中创建 Project、OWNER Membership、按该 locale 命名的普通初始 Board 和初始 Column。locale SHALL 参与规范化幂等载荷；重试同一请求 MUST 返回同一 Project 而不重复创建任何记录。创建后的 Board 与 Column 名称 SHALL 作为普通用户数据保存，后续切换界面语言 MUST NOT 自动改名。

#### Scenario: 创建 Project
- **WHEN** Workspace OWNER 提交有效名称、可选描述、受支持 locale 和新的 request id
- **THEN** 系统原子创建 Project、该 User 的 Project OWNER 关系、普通初始 Board 与初始 Column并返回新 Project 上下文

#### Scenario: 重试创建响应丢失的请求
- **WHEN** 同一 User 在同一 Workspace 以相同 request id 重试已成功的创建
- **THEN** 系统返回第一次创建的 Project，不新增第二个 Project

#### Scenario: request id 被改变载荷复用
- **WHEN** 同一 actor 和 Workspace 使用已有 request id 但提交不同名称、描述或 locale
- **THEN** Core API 以稳定冲突错误拒绝，且不改变原 Project

#### Scenario: 编辑发生版本冲突
- **WHEN** Owner 用过期 Project 版本提交名称或描述修改
- **THEN** Core API 返回稳定冲突，保留当前值并要求客户端重新加载

#### Scenario: 非 Workspace Owner 创建
- **WHEN** 没有目标 Workspace OWNER 关系的 User 尝试创建 Project
- **THEN** Core API 根据 Workspace Membership 重新授权并拒绝，不要求或伪造尚不存在的 Project Membership

#### Scenario: 非 Project Owner 修改
- **WHEN** User 位于请求的 Workspace 范围内但没有目标 Project OWNER 关系，尝试修改已有 Project
- **THEN** Core API 根据 Project Membership 重新授权并拒绝，不依赖 Desktop 是否隐藏操作入口

### Requirement: Owner 通过 Danger Zone 永久删除 Project
永久删除 SHALL 置于 Project Settings 的 Danger Zone，明确不可恢复，并要求用户输入当前 Project 的精确名称。请求 MUST 同时携带当前版本和确认名称；确认名称 SHALL 与持久化的当前规范化名称按大小写和空白敏感的精确字符串比较。Core API SHALL 在同一事务锁定并重新校验 Workspace 范围、Project OWNER、当前版本和当前名称，再按拥有关系显式物理删除该 Project 的 Board Placement、Column、Board、Work Item、ProjectMembership 与 Project。ACTIVE 和 ARCHIVED Project 均可删除。

#### Scenario: 成功永久删除
- **WHEN** Owner 提交当前版本和与当前 Project 名称逐字符相同的确认名称
- **THEN** 系统在一个事务中删除该 Project 已批准的 Project Work 子资源、Membership 和 Project，后续读取返回 not-found，且不可恢复

#### Scenario: 名称已被并发修改
- **WHEN** 用户打开 Danger Zone 后 Project 名称或版本发生变化
- **THEN** 删除以稳定冲突拒绝，不删除 Project，并要求重新加载后再次确认当前名称

#### Scenario: 确认名称不匹配
- **WHEN** 输入名称与当前 Project 名称不精确相同
- **THEN** Core API 返回 `PROJECT_NAME_CONFIRMATION_MISMATCH` 且不删除任何记录

#### Scenario: 删除最后一个 Project
- **WHEN** Owner 永久删除个人 Workspace 中最后一个 Project
- **THEN** 个人 Workspace 保留，Desktop 显示创建 Project 空状态，系统不自动重建默认 Project

#### Scenario: 存在未知或受保护子资源
- **WHEN** Project 存在除 Board Placement、Column、Board、Work Item 与 ProjectMembership 外，未获批准删除的依赖记录
- **THEN** 数据库约束或应用校验阻止删除，而不是静默级联丢失这些记录

### Requirement: Project 首页保持可信且可恢复
认证后的 Desktop SHALL 显示个人 Workspace 上下文、Project 切换/列表、创建入口、当前 Project 名称与描述、真实 Board 工作区、Project Settings，以及账号、语言和 logout。它 SHALL 对加载、无 Project、Board 加载失败、session 失效和陈旧响应提供明确可恢复状态。它 MUST NOT 展示虚假的团队空间、邀请、成员管理、Agent 或指标数据。

#### Scenario: 首页加载失败
- **WHEN** Workspace、Project 或 Board 请求因暂时故障失败
- **THEN** Renderer 保留可信账号上下文，显示可重试错误，不伪造 Project 或 Board，也不把失败误报为空状态

#### Scenario: session 在首页失效
- **WHEN** Project 操作返回 `AUTHENTICATION_REQUIRED` 且 refresh 无法恢复
- **THEN** Main 清理凭据并递增 session generation，Renderer 回到登录页且清除 Project 状态

#### Scenario: 无 Project 空状态
- **WHEN** 个人 Workspace 没有 ACTIVE Project
- **THEN** Renderer 提供唯一明确的创建 Project 动作，并仍允许查看归档 Project、切换语言和 logout

#### Scenario: Agent Runtime 不可用
- **WHEN** Agent Runtime 未启动或尚未实现
- **THEN** Project 首页及本规格全部 Workspace/Project 操作仍可独立工作
