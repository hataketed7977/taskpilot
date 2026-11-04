# Project Work Items Spec Delta

## ADDED Requirements

### Requirement: Work Item 暴露创建人和当前责任人
每个 Work Item SHALL 在当前详情、创建/编辑响应和相关 Card 投影中暴露不可编辑 `createdBy` 人员摘要，并 SHALL 具有一个可为空的当前 `assignee`。`createdBy` SHALL 引用创建该 Work Item 的 User，且不得被后续编辑改变。`assignee` 归属于 Work Item 而不是 Card 或 Board Placement；当前支持的责任目标类型仅为 `PROJECT_MEMBER`，目标 SHALL 引用同一 Project 内的 active Project Member。未分配 SHALL 以 `assignee = null` 表达，不得用创建人、空字符串、未知用户或固定占位责任人代替。责任人目标模型 SHALL 保留目标类型字段，以便未来通过独立 Change 支持 `PROJECT_AGENT_BINDING`；当前 API 和 UI MUST NOT 暴露可选择 Agent 的假能力。

#### Scenario: 读取包含创建人和未分配责任人的 Work Item
- **WHEN** Project OWNER 读取一个尚未设置责任人的 Work Item
- **THEN** 响应返回 `createdBy` 人员摘要、`assignee = null`、标题、描述、版本和审计时间，且不返回 lifecycle 或 status

#### Scenario: 读取包含 Project Member 责任人的 Work Item
- **WHEN** Project OWNER 读取一个责任人为当前 Project Member 的 Work Item
- **THEN** 响应返回 `assignee.targetType = PROJECT_MEMBER`、稳定 Project Membership 引用和该成员 User 的姓名与头像摘要

#### Scenario: 创建人和责任人语义分离
- **WHEN** Work Item 创建者被设为责任人、责任人被改为其他成员或责任人被清空
- **THEN** `createdBy` 始终保持原创建者，`assignee` 只表达当前责任目标

#### Scenario: 当前不支持 Agent 责任人
- **WHEN** 客户端提交 `PROJECT_AGENT_BINDING` 或其他非 `PROJECT_MEMBER` 责任目标
- **THEN** 当前 API 以稳定 validation 错误拒绝，且不创建或修改 Work Item 责任人

### Requirement: 创建 Work Item 默认未分配
Project OWNER 从 Board 创建 Work Item 时 MAY 省略责任人；当前创建入口默认 SHALL 创建未分配 Work Item。若创建请求包含责任人，Core API SHALL 在同一事务内校验该责任目标属于当前 Project 的 active Project Member，并把责任人纳入幂等规范化 payload；同一 request id 重试 MUST 返回相同责任人结果，复用 request id 但责任人不同 MUST 产生稳定幂等冲突。创建成功 SHALL 继续原子建立 Board Placement、递增 Board version，并返回包含 `createdBy` 和 `assignee` 的权威 Work Item/Card 数据。

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

### Requirement: Project Owner 可编辑 Work Item 责任人
Project OWNER SHALL 能以当前 Work Item version 设置、替换或清空 Work Item 的当前责任人。责任人编辑 SHALL 与标题/描述编辑使用同一 Work Item 乐观并发边界：成功修改 SHALL 递增 Work Item version、更新 `updatedAt`、保留 Work Item ID 和 `createdBy`，并返回包含权威 Work Item 与 Board Card 投影的响应。Core API SHALL 在一个事务内重新校验 Workspace、Project、Work Item、actor OWNER 权限、expected Work Item version、目标责任人 Project 范围和 active membership；任一校验或写入失败 MUST 回滚责任人、内容和可选 Placement 的全部变化。

#### Scenario: 设置责任人
- **WHEN** Owner 以当前 Work Item version 把未分配 Work Item 设置为当前 Project 的 active Project Member
- **THEN** 系统保存责任人、递增 Work Item version、更新 `updatedAt`，并返回新的责任人摘要

#### Scenario: 替换责任人
- **WHEN** Owner 以当前 Work Item version 把责任人从一个当前 Project Member 改为另一个当前 Project Member
- **THEN** 系统保存新的责任人，旧责任人不再作为当前责任目标返回

#### Scenario: 清空责任人
- **WHEN** Owner 以当前 Work Item version 清空责任人
- **THEN** 系统保存 `assignee = null`，并保持标题、描述、创建人和 Board Placement 不变

#### Scenario: 使用过期 Work Item version 修改责任人
- **WHEN** Owner 使用过期 Work Item version 提交责任人修改
- **THEN** 系统返回稳定版本冲突，责任人、标题、描述和 Placement 均不改变

#### Scenario: 责任人与内容原子修改失败
- **WHEN** 同一编辑请求同时修改标题、描述或 Placement 上下文和责任人，但责任人校验失败或版本冲突
- **THEN** 系统回滚整个请求，不保存任何部分字段，也不移动 Card

### Requirement: Desktop 以低噪声方式展示和编辑责任信息
Desktop SHALL 在 Work Item 详情中以稳定属性区展示可编辑责任人，并在底部 audit footer 同行展示不可编辑创建人、创建时间和更新时间；责任人字段 SHALL 提供可聚焦、可搜索、键盘可操作的选择器，候选项展示头像、姓名和成员角色，并提供“未分配”清空选项。Card 正面 SHALL 使用固定高度，以有界两行区域展示标题和描述，并只以固定在右上角且不参与内容流的轻量头像展示当前责任人；未分配 Card 不得显示责任人占位，且已分配/未分配、短/长内容 Card 的外部高度 SHALL 保持一致。责任人选择、保存、成功、validation 错误、暂时失败、版本冲突和迟到响应 SHALL 保持详情和 Card 布局稳定，不得造成标题/描述编辑体验回归或用责任人控件替代 Work Item heading。

#### Scenario: 详情展示责任人与创建人
- **WHEN** 用户打开 Work Item 详情
- **THEN** Desktop 以实际 Work Item 标题作为唯一 heading，在属性区展示可编辑责任人，并在底部 audit footer 同行展示不可编辑创建人、创建时间和更新时间

#### Scenario: 编辑内容时打开责任人选择器

- **WHEN** 用户在标题或描述存在未保存草稿时请求打开责任人选择器
- **THEN** Desktop 保持责任人控件可操作，先且只提交一次当前草稿，保存成功后再展开选择器并把焦点移入搜索框；validation、暂时失败或版本冲突时选择器保持关闭，草稿和恢复路径继续可用

#### Scenario: 搜索并选择责任人
- **WHEN** 用户打开责任人选择器、搜索当前 Project 成员并选择一名候选人
- **THEN** Desktop 以当前 Work Item version 提交责任人修改，成功后以权威响应更新详情元数据和 Board Card 头像

#### Scenario: 清空责任人
- **WHEN** 用户在责任人选择器中选择“未分配”
- **THEN** Desktop 提交清空责任人的修改，成功后详情显示未分配状态，Card 正面移除责任人头像或显示约定的低噪声空态

#### Scenario: 责任人保存失败
- **WHEN** 责任人修改因 validation、暂时错误或版本冲突失败
- **THEN** Desktop 保持详情打开，显示可理解错误和重试/刷新路径，不把失败责任人写入 Board Card，也不丢失标题或描述草稿

#### Scenario: 选择器可访问
- **WHEN** 用户仅使用键盘或辅助技术打开、搜索、选择或关闭责任人选择器
- **THEN** 焦点顺序、候选名称、当前选中状态、未分配选项、加载状态和错误状态均可感知，且 reduced-motion 偏好下移除非必要动效

### Requirement: 本 Change 不提供历史版本能力
当前 Work Item mutation SHALL 继续只维护当前状态、version、`createdAt` 和 `updatedAt`；系统 MUST NOT 暴露或伪造 durable revision history、Activity timeline、字段级 diff、按时间点回溯、版本对比、历史恢复或整板时间旅行能力。未来历史版本能力 SHALL 通过独立 Change 定义 append-only revision、字段扩展策略、查询 API、Card move activity 和 UI 展示，不得由本 Change 的 UI-only 日志替代。

#### Scenario: 修改责任人不会生成可查询历史版本
- **WHEN** Owner 设置、替换或清空 Work Item 责任人
- **THEN** 当前响应只反映最新 Work Item 状态、version 和审计时间，不提供责任人变更历史查询入口

#### Scenario: 历史接口不存在
- **WHEN** 客户端尝试访问未定义的 Work Item versions、history、activity 或 point-in-time 查询
- **THEN** 当前 canonical API 和 Desktop 不提供该能力，也不返回由客户端本地拼接的伪历史
