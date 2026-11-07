# Spec Delta

## Purpose

统一 Work Item 文本上限和稀疏原子编辑，并在 Desktop 创建入口暴露既有的可选 Project Member 责任人能力。

## MODIFIED Requirements

### Requirement: Work Item 是 Project 内的业务真相
每个 Work Item SHALL 具有稳定 `workItemId`、唯一 `projectId` 引用、必填标题、可选描述、版本、创建者和审计时间。当前实现尚未实现业务模型已批准的 Target Work Item 状态机；当前 Work Item 与 Card 的持久化模型和 API response MUST NOT 包含固定 `OPEN`、`lifecycle`、`status` 或等价占位字段，也 MUST NOT 暴露完成、关闭、取消或重开动作。在 Work Item Type 与自定义字段尚未实现时不要求类型版本；未来使用类型化字段的 Work Item SHALL 通过后续 Change 固定不可变 Work Item Type Version。标题 SHALL 去除首尾空白并规范化为 Unicode NFC，规范化结果 MUST 为 1 至 160 个 Unicode code point；描述 SHALL 去除首尾空白、规范化为 Unicode NFC并限制为最多 5000 个 Unicode code point。创建时缺失或全空白描述规范化为空字符串；编辑时 `descriptionPatch.SET` 的规范化结果 MUST 为 1 至 5000 个 code point，清空 SHALL 使用 `descriptionPatch.CLEAR`。创建和编辑 MUST NOT 静默截断。

#### Scenario: 读取 Work Item
- **WHEN** Project OWNER 通过 canonical user resource API 读取当前 Project 的 Work Item
- **THEN** 响应以 `workItemId` 标识权威记录，并返回标题、描述、版本和审计时间，且不返回 lifecycle 或 status

#### Scenario: 同名 Work Item
- **WHEN** Owner 在同一 Project 创建标题相同的两个 Work Item
- **THEN** 系统以不同 `workItemId` 保存两条记录，不以标题作为身份或唯一键

#### Scenario: 未支持的生命周期动作
- **WHEN** 客户端尝试通过当前 canonical user resource API 完成、关闭、取消或重开 Work Item
- **THEN** 当前 API 不提供该动作，也不通过 Card 移动隐式创建或改变状态

#### Scenario: 当前实现没有状态能力
- **WHEN** 客户端读取 Work Item、Card 或检查当前持久化和 API 契约
- **THEN** 当前持久化模型、API 与 Desktop 不提供 lifecycle、status、固定 `OPEN` 或等价状态字段

#### Scenario: 当前不要求 Work Item Type
- **WHEN** Owner 在当前切片创建基础 Work Item
- **THEN** 系统只要求当前规格的稳定字段，不伪造 Work Item Type Version 或暴露自定义字段入口

#### Scenario: Work Item 文本校验失败
- **WHEN** 创建或编辑请求提交规范化后为空、超过 160 个 code point 的标题，或超过 5000 个 code point 的描述
- **THEN** Core API 以指向相应字段的稳定 validation error 拒绝整个请求，Desktop 保留输入并显示字段级反馈，且系统不截断内容或产生部分写入

### Requirement: Project Owner 可查看和原子编辑 Work Item
Project OWNER SHALL 能按稳定 ID 查看 Work Item，并以当前版本稀疏修改标题、描述或责任人。编辑请求 SHALL 以可省略标题标量、可省略的 `descriptionPatch.SET/CLEAR` 和既有 `assigneePatch.SET/CLEAR` 区分不修改、写入和清空；用户清空描述 SHALL 映射为 `CLEAR` 而非 raw `null` 或空 `SET`；显式提交 raw `null` 的标题、patch 或可省略 patch value SHALL 作为非法 payload 拒绝而不得折叠为省略。请求 SHALL 至少包含一个实际业务 mutation：提交标题、描述或责任人中的至少一个实际变化，或把 Placement 移到不同的目标 Column。Core API SHALL 只校验请求中出现的业务字段；读取仍 SHALL 返回既有超出当前产品上限的历史标题或描述，未提交的历史超长字段 MUST NOT 阻止另一字段、责任人或 Placement 的有效修改，提交该文本字段时则 MUST 满足当前上限。当前 Board 上的编辑请求 SHALL 同时携带 Board、Placement、当前 Column 和目标 Column 上下文；若目标 Column 与当前 Column 不同，还 SHALL 携带当前 Board version 与 Placement version。Core API SHALL 同时校验路径中的 Workspace、Project、Work Item、Board、Placement 和目标 Column 归属，在一个事务内保存已提交的 Work Item 字段与可选 Placement 变更，并返回权威 Work Item 与 Board。成功修改 SHALL 递增 Work Item 版本并保留其 ID；目标 Column 未变化时 SHALL 不改变 Board 或 Placement version，目标 Column 变化时 SHALL 把 Card 移到目标 Column 末尾并递增受影响的布局 version。任一校验或写入失败 MUST 回滚内容和位置的全部变化。

#### Scenario: 只编辑 Work Item 内容
- **WHEN** Owner 以当前 Work Item 版本提交一个或多个实际变化的有效内容字段和未变化的目标 Column
- **THEN** 系统保存权威内容并返回更新后的 Work Item 与 Board，不改变 Board 或 Placement version

#### Scenario: 编辑并移动到另一 Column
- **WHEN** Owner 以当前 Work Item、Board 和 Placement 版本提交有效内容及当前 Board 的另一目标 Column
- **THEN** 系统在同一事务内保存内容、把 Card 移到目标 Column 末尾，并返回更新后的 Work Item 与 Board，且不创建或改变任何 Work Item 状态

#### Scenario: 原子编辑发生版本冲突
- **WHEN** 编辑请求使用过期 Work Item version，或跨 Column 编辑使用过期 Board 或 Placement version
- **THEN** 系统返回稳定冲突，Work Item 内容、Board 与 Placement 全部保持不变，并要求客户端重新加载

#### Scenario: 原子编辑使用错误范围
- **WHEN** 请求组合错误 Workspace、Project、Board、Placement 或目标 Column
- **THEN** Core API 返回 not-found，Work Item 内容与 Placement 全部保持不变，且不泄露资源真实归属

#### Scenario: 稀疏编辑兼容历史超长 Work Item 值
- **WHEN** 既有 Work Item 的标题或描述超过当前产品上限，而 Owner 只修改另一字段、责任人或目标 Column
- **THEN** 系统只校验并保存已提交 mutation，不因未提交的历史值拒绝请求，也不截断或改写该历史值

#### Scenario: 清空 Work Item 描述
- **WHEN** Owner 提交 `descriptionPatch.CLEAR` 并保持目标 Column 不变
- **THEN** 系统清空描述并递增 Work Item version；省略 `descriptionPatch` 则保持描述不变

#### Scenario: 修改历史超长字段
- **WHEN** Owner 提交既有超长标题或描述字段的新值
- **THEN** 新值必须满足当前 160 或 5000 code point 上限，否则整个原子编辑被拒绝

#### Scenario: 提交空 Work Item mutation
- **WHEN** 编辑请求未提交标题、描述或责任人变化，且目标 Column 也没有变化
- **THEN** Core API 以稳定 validation error 拒绝，不递增 Work Item、Board 或 Placement version

### Requirement: 创建 Work Item 默认未分配
Project OWNER 从 Board 创建 Work Item 时 MAY 省略责任人；Desktop 创建表单 SHALL 提供当前 Project Member 责任人选择，默认值仍 SHALL 为未分配，不得自动分配给创建人。当前创建入口默认 SHALL 创建未分配 Work Item。责任人候选加载失败时，Desktop SHALL 允许用户以未分配状态继续创建，并提供可理解的非阻断说明。当用户改变责任人选择时，Desktop SHALL 使先前未提交的创建 request id 失效并让新请求的幂等 fingerprint 包含该选择。若创建请求包含责任人，Core API SHALL 在同一事务内校验该责任目标属于当前 Project 的 active Project Member，并把责任人纳入幂等规范化 payload；同一 request id 重试 MUST 返回相同责任人结果，复用 request id 但责任人不同 MUST 产生稳定幂等冲突。创建成功 SHALL 继续原子建立 Board Placement、递增 Board version，并返回包含 `createdBy` 和 `assignee` 的权威 Work Item/Card 数据。

#### Scenario: 默认创建未分配 Card
- **WHEN** Owner 从当前 Board 提交有效标题、可选描述、新 request id 和当前 Board version，但不提交责任人
- **THEN** 系统创建 Work Item 与 Placement，返回原创建者作为 `createdBy`，并返回 `assignee = null`

#### Scenario: 创建时指定当前 Project Member
- **WHEN** Owner 创建 Work Item 时指定当前 Project 的 active Project Member 作为责任人
- **THEN** 系统原子创建 Work Item 与 Placement，并在 Work Item 与 Card 响应中返回该责任人摘要

#### Scenario: 创建时指定非项目成员
- **WHEN** Owner 创建 Work Item 时指定其他 Project 的 membership、未知 membership 或 inactive User 对应的 membership
- **THEN** 系统拒绝整个创建请求，Work Item、Placement 和 Board 布局均不改变

#### Scenario: request id 责任人载荷冲突
- **WHEN** 相同 actor 与 Project 下的 request id 先后用于相同标题、描述、Board、目标 Column 和 expected Board version 但不同责任人
- **THEN** 系统返回稳定幂等冲突且不创建额外记录

#### Scenario: Desktop 创建时选择责任人
- **WHEN** Project Member 候选加载成功且 Owner 在提交前选择一个成员
- **THEN** Desktop 提交该 Project Membership 目标，成功后采用包含相同 `assignee` 的权威 Work Item 与 Card

#### Scenario: 责任人候选加载失败
- **WHEN** Desktop 无法加载 Project Member 候选但其余创建条件有效
- **THEN** 表单说明责任人暂不可选但仍允许以未分配状态创建，不伪造候选、不自动选择创建人

#### Scenario: 选择变化更新幂等请求
- **WHEN** 用户在一次尚未成功的创建尝试中从未分配切换为成员、切换成员或清空责任人
- **THEN** Desktop 后续提交使用与新规范化 payload 对应的 request id，重试同一选择才复用同一幂等身份
