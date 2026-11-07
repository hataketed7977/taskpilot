# Spec Delta

## Purpose

统一 Project 创建与编辑的产品文本上限，并以稀疏 mutation 兼容可读的历史超长值。

## MODIFIED Requirements

### Requirement: Workspace Owner 可创建 Project，Project Owner 可编辑 Project
当前实现 SHALL 只授予 `WorkspaceMembership(OWNER)` 与 `ProjectMembership(OWNER)` 角色。创建 Project SHALL 以目标 Workspace 的 `WorkspaceMembership(OWNER)` 授权；Project 创建成功前不得要求尚不存在的 Project Membership。创建者 SHALL 在同一事务中成为 Project OWNER。修改已有 Project 的名称和描述 SHALL 同时校验 Workspace 范围与该 Project 的 `ProjectMembership(OWNER)`。名称 SHALL 去除首尾空白并规范化为 Unicode NFC，规范化结果 MUST 为 1 至 100 个 Unicode code point；描述 SHALL 去除首尾空白、规范化为 Unicode NFC 并限制为最多 1000 个 Unicode code point。创建时缺失或全空白描述规范化为空字符串；编辑时 `descriptionPatch.SET` 的规范化结果 MUST 为 1 至 1000 个 code point，清空 SHALL 使用 `descriptionPatch.CLEAR`。创建和编辑 MUST NOT 静默截断。编辑请求 SHALL 以字段是否出现区分“未修改”和显式写入：名称以省略或 SET 标量表达，描述以省略、`descriptionPatch.SET` 或 `descriptionPatch.CLEAR` 表达，用户清空描述 SHALL 映射为 `CLEAR` 而非 raw `null` 或空 `SET`；显式提交 raw `null` 的名称、patch 或可省略 patch value SHALL 作为非法 payload 拒绝而不得折叠为省略；请求仅提交实际变化且 MUST 包含至少一个实际 mutation。Core API SHALL 只校验请求中出现的业务字段。读取仍 SHALL 返回既有超出新产品上限的历史值；未提交的历史超长字段 MUST NOT 阻止另一字段的有效修改，但一旦提交该字段就 MUST 满足当前上限。创建请求 SHALL 携带由客户端生成且在 actor 与 Workspace 范围内唯一的 UUID request id，以及受支持的当前 locale；Core API SHALL 在同一事务中创建 Project、OWNER Membership、按该 locale 命名的普通初始 Board 和初始 Column。locale SHALL 参与规范化幂等载荷；重试同一请求 MUST 返回同一 Project 而不重复创建任何记录。创建后的 Board 与 Column 名称 SHALL 作为普通用户数据保存，后续切换界面语言 MUST NOT 自动改名。

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

#### Scenario: 创建或编辑文本不合法
- **WHEN** 创建或编辑请求提交规范化后为空、超过 100 个 code point 的名称，或超过 1000 个 code point 的描述
- **THEN** Core API 以指向相应字段的稳定 validation error 拒绝整个请求且不静默截断，Desktop 保留输入并显示字段级反馈

#### Scenario: 稀疏编辑兼容历史超长值
- **WHEN** 既有 Project 的名称或描述超过当前产品上限，而 Owner 只提交另一字段的有效修改
- **THEN** 系统只校验并保存已提交字段，不因未提交的历史值拒绝请求，也不截断或改写该历史值

#### Scenario: 清空 Project 描述
- **WHEN** Owner 省略名称并提交 `descriptionPatch.CLEAR`
- **THEN** 系统清空描述并递增 Project version；省略 `descriptionPatch` 则保持描述不变

#### Scenario: 提交空 Project mutation
- **WHEN** 编辑请求没有提交任何实际变化的名称或描述
- **THEN** Core API 以稳定 validation error 拒绝且不递增 Project version
