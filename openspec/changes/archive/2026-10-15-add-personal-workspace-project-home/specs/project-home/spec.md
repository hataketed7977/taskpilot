# Spec Delta

## Purpose

提供登录后的最小可用 Project 上下文：新用户直接进入普通默认 Project，已有用户可靠恢复可访问项目，并能在统一 Workspace 范围内安全创建、维护、归档、恢复和永久删除 Project。

## ADDED Requirements

### Requirement: 注册创建普通默认 Project 及 Owner 关系
新 User 的注册事务 SHALL 在其个人 Workspace 中创建一个普通 `ACTIVE` Project 和 `ProjectMembership(OWNER)`。初始名称 SHALL 按注册时已接受的法律 locale 选择：`zh-CN` 为“我的项目”，`en` 为“My project”；初始描述 SHALL 为空。默认 Project MUST NOT 具有 `isDefault`、特殊类型或删除后自动重建语义。

#### Scenario: 中文注册
- **WHEN** User 使用 `zh-CN` 法律组合完成首次注册
- **THEN** 其个人 Workspace 获得名为“我的项目”、空描述的 ACTIVE Project，且该 User 为 Project OWNER

#### Scenario: 英文注册
- **WHEN** User 使用 `en` 法律组合完成首次注册
- **THEN** 其个人 Workspace 获得名为“My project”、空描述的 ACTIVE Project，且该 User 为 Project OWNER

#### Scenario: 默认 Project 后续变更
- **WHEN** Owner 编辑、归档、恢复或永久删除注册时创建的 Project
- **THEN** 系统按普通 Project 规则处理，不阻止变更，也不创建替代 Project

### Requirement: 登录后直接解析 Project 首页
Desktop SHALL 在认证成功或 session 恢复后直接解析 Project 上下文而不显示 Workspace onboarding。首次注册 SHALL 打开刚创建的默认 Project；再次登录 SHALL 优先打开当前 environment 与 User 下记住且仍可访问的 ACTIVE Project，否则打开个人 Workspace 中按 `createdAt`、`projectId` 升序的第一个可访问 ACTIVE Project；仍无项目时 SHALL 显示创建 Project 空状态。

#### Scenario: 首次注册完成
- **WHEN** Desktop 已安全保存新 session 且注册响应包含新建默认 Project 上下文
- **THEN** Renderer 直接进入该 Project 首页，不要求用户选择 Workspace 或 Project

#### Scenario: 最近 Project 仍有效
- **WHEN** 再次登录时本机记住的 Project 仍属于当前 User 的个人 Workspace且为 ACTIVE
- **THEN** Desktop 打开该 Project

#### Scenario: 最近 Project 已归档、删除或不可访问
- **WHEN** 记住的 Project 不能再作为 ACTIVE Project 访问
- **THEN** Desktop 清除该选择并打开排序后的第一个可访问 ACTIVE Project；若不存在则显示创建 Project 空状态

#### Scenario: 迟到响应来自旧 session
- **WHEN** logout、重新登录、User 或 environment 切换后收到旧 session generation 的 Workspace 或 Project 响应
- **THEN** Desktop 丢弃该响应，不恢复旧项目、旧错误或旧选择

### Requirement: Project 使用统一模型和 Workspace 范围
每个 Project SHALL 具有稳定 `projectId`、唯一 `workspaceId` 引用、必填名称、可选描述、`ACTIVE | ARCHIVED` 状态、版本和审计时间。Project 名称 MUST NOT 作为身份，同一 Workspace 内 SHALL 允许重名；个人 Workspace 与未来 TEAM Workspace MUST 复用同一 Project 与 ProjectMembership 模型。

#### Scenario: 同一 Workspace 创建重名 Project
- **WHEN** Owner 使用现有 Project 的相同名称创建另一个 Project
- **THEN** 系统创建具有不同 `projectId` 的 Project，而不以名称判定重复

#### Scenario: 读取当前 Project
- **WHEN** User 请求其可访问 Workspace 中的 Project
- **THEN** 响应以稳定 ID 和 Workspace 归属标识该 Project，并返回名称、描述、状态、版本和审计时间

#### Scenario: 跨 Workspace 组合 ID
- **WHEN** 客户端把一个 Project ID 与错误 Workspace ID 组合请求
- **THEN** Core API 以 not-found 语义拒绝且不泄露 Project 的真实归属

### Requirement: Workspace Owner 可创建 Project，Project Owner 可编辑 Project
当前实现 SHALL 只授予 `WorkspaceMembership(OWNER)` 与 `ProjectMembership(OWNER)` 角色。创建 Project SHALL 以目标 Workspace 的 `WorkspaceMembership(OWNER)` 授权；Project 创建成功前不得要求尚不存在的 Project Membership。创建者 SHALL 在同一事务中成为 Project OWNER。修改已有 Project 的名称和描述 SHALL 同时校验 Workspace 范围与该 Project 的 `ProjectMembership(OWNER)`。名称 SHALL 先去除首尾空白，规范化结果 MUST 为 1 至 200 个 Unicode code point；描述 SHALL 去除首尾空白并限制为最多 2000 个 Unicode code point，缺失或全空白描述规范化为空字符串。创建请求 SHALL 携带由客户端生成且在 actor 与 Workspace 范围内唯一的 UUID request id，重试同一请求 MUST 返回同一 Project 而不重复创建。

#### Scenario: 创建 Project
- **WHEN** Workspace OWNER 提交有效名称、可选描述和新的 request id
- **THEN** 系统原子创建 Project 与该 User 的 Project OWNER 关系并返回新 Project

#### Scenario: 重试创建响应丢失的请求
- **WHEN** 同一 User 在同一 Workspace 以相同 request id 重试已成功的创建
- **THEN** 系统返回第一次创建的 Project，不新增第二个 Project

#### Scenario: request id 被改变载荷复用
- **WHEN** 同一 actor 和 Workspace 使用已有 request id 但提交不同名称或描述
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

### Requirement: Project 可归档、查看和恢复
Project OWNER SHALL 能把 ACTIVE Project 归档为 ARCHIVED，并能把 ARCHIVED Project 恢复为 ACTIVE。默认 Project 列表 SHALL 只返回 ACTIVE；归档列表 SHALL 明确只返回 ARCHIVED。Core API SHALL 先完成 Workspace 范围与 Project OWNER 授权：若 Project 尚未达到目标状态，转换 MUST 校验当前版本；若 Project 已经达到目标状态，重复请求 SHALL 即使携带转换前的旧版本也返回当前 Project，而不更新时间、递增版本或产生冲突。

#### Scenario: 归档当前 Project
- **WHEN** Owner 以当前版本归档 ACTIVE Project
- **THEN** Project 变为 ARCHIVED，从默认列表消失，并触发 Desktop 按登录落点规则选择下一个 ACTIVE Project或空状态

#### Scenario: 查看并恢复归档 Project
- **WHEN** Owner 查看归档列表并以当前版本恢复一个 ARCHIVED Project
- **THEN** Project 变为 ACTIVE 并重新出现在默认列表

#### Scenario: 响应丢失后重试状态转换
- **WHEN** Project 已由同一动作达到目标状态，Owner 因前次响应丢失而携带转换前的旧版本重复提交归档或恢复
- **THEN** 系统返回当前 Project，不重复更新时间、递增版本或返回版本冲突

### Requirement: Owner 通过 Danger Zone 永久删除 Project
永久删除 SHALL 置于 Project Settings 的 Danger Zone，明确不可恢复，并要求用户输入当前 Project 的精确名称。请求 MUST 同时携带当前版本和确认名称；确认名称 SHALL 与持久化的当前规范化名称按大小写和空白敏感的精确字符串比较。Core API SHALL 在同一事务锁定并重新校验 Workspace 范围、Project OWNER、当前版本和当前名称，再物理删除 ProjectMembership 与 Project。ACTIVE 和 ARCHIVED Project 均可删除。

#### Scenario: 成功永久删除
- **WHEN** Owner 提交当前版本和与当前 Project 名称逐字符相同的确认名称
- **THEN** 系统原子删除该 Project 的 Membership 和 Project，后续读取返回 not-found，且不可恢复

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
- **WHEN** Project 存在未获本能力批准为可级联删除的依赖记录
- **THEN** 数据库约束或应用校验阻止删除，而不是静默级联丢失这些记录

### Requirement: Project 首页保持可信且可恢复
认证后的 Desktop SHALL 显示个人 Workspace 上下文、Project 切换/列表、创建入口、当前 Project 名称与描述、Project Settings，以及账号、语言和 logout。它 SHALL 对加载、无 Project、失败、session 失效和陈旧响应提供明确可恢复状态；MUST NOT 展示虚假的团队空间、邀请、成员管理、Board、Agent 或指标数据。

#### Scenario: 首页加载失败
- **WHEN** Workspace 或 Project 请求因暂时故障失败
- **THEN** Renderer 保留可信账号上下文，显示可重试错误，不伪造 Project，也不把失败误报为空状态

#### Scenario: session 在首页失效
- **WHEN** Project 操作返回 `AUTHENTICATION_REQUIRED` 且 refresh 无法恢复
- **THEN** Main 清理凭据并递增 session generation，Renderer 回到登录页且清除 Project 状态

#### Scenario: 无 Project 空状态
- **WHEN** 个人 Workspace 没有 ACTIVE Project
- **THEN** Renderer 提供唯一明确的创建 Project 动作，并仍允许查看归档 Project、切换语言和 logout

#### Scenario: Agent Runtime 不可用
- **WHEN** Agent Runtime 未启动或尚未实现
- **THEN** Project 首页及本规格全部 Workspace/Project 操作仍可独立工作
