# Project Boards Specification

## Purpose

在 Project 内提供可持久化的多 Board 与 Column 组织能力，并以无独立 Card 身份的 Placement 投影真实 Work Item，使用户能够可靠地查看、排列和跨列移动工作卡片。

## Requirements

### Requirement: Project 可拥有多个普通 Board
每个 Board SHALL 具有稳定 `boardId`、唯一 `projectId` 引用、必填名称、可选描述、版本和审计时间。一个 Project SHALL 可拥有任意多个普通 Board，系统 MUST NOT 使用 `isDefault` 或特殊 Board 类型区分首个 Board。Board 名称 SHALL 去除首尾空白并规范化为 Unicode NFC，规范化结果 MUST 为 1 至 80 个 Unicode code point；描述 SHALL 去除首尾空白、规范化为 Unicode NFC 并限制为最多 1000 个 Unicode code point。创建时缺失或全空白描述规范化为空字符串；编辑时 `descriptionPatch.SET` 的规范化结果 MUST 为 1 至 1000 个 code point，清空 SHALL 使用 `descriptionPatch.CLEAR`。创建和编辑 MUST NOT 静默截断。Board 编辑请求 SHALL 以可省略名称标量及可省略的 `descriptionPatch.SET/CLEAR` 只提交实际变化；用户清空描述 SHALL 映射为 `CLEAR` 而非 raw `null` 或空 `SET`；显式提交 raw `null` 的名称、patch 或可省略 patch value SHALL 作为非法 payload 拒绝而不得折叠为省略，且请求 MUST 包含至少一个实际 mutation。Core API SHALL 只校验请求中出现的字段。读取仍 SHALL 返回既有超出新产品上限的历史值；未提交的历史超长字段 MUST NOT 阻止另一字段的有效修改，但提交该字段时 MUST 满足当前上限。Board 创建请求 SHALL 携带在 actor 与 Project 范围内唯一的 UUID request id 和受支持的当前 locale；系统 SHALL 在同一事务内按该 locale 创建普通初始 Column：`zh-CN` 为“待处理”，`en` 为“To do”。locale SHALL 参与规范化幂等载荷，同一有效请求的重试 MUST 返回同一 Board；初始 Column 创建后是普通用户数据，切换界面语言 MUST NOT 自动改名。

#### Scenario: 创建第二个 Board
- **WHEN** Project OWNER 提交有效名称、可选描述、受支持 locale 和新的 request id
- **THEN** 系统创建具有新 `boardId` 的普通 Board，不改变或取代已有 Board

#### Scenario: 读取 Project 的 Board
- **WHEN** Project OWNER 读取当前 Project 的 Board 列表或某个 Board 详情
- **THEN** 列表按 `createdAt`、`boardId` 升序返回，详情包含该 Board 的权威 Column 与 Card 布局

#### Scenario: 重试 Board 创建
- **WHEN** 同一 actor 在同一 Project 以相同 request id、locale 和规范化 payload 重试
- **THEN** 系统返回先前创建的 Board，而不重复创建 Board 或初始 Column

#### Scenario: request id 被复用为不同 Board
- **WHEN** 同一 actor 在同一 Project 以相同 request id 提交不同规范化名称、描述或 locale
- **THEN** 系统返回稳定幂等冲突且不创建新 Board

#### Scenario: 修改 Board 信息
- **WHEN** Project OWNER 以当前版本提交有效 Board 名称和描述
- **THEN** 系统保存修改、递增版本，并保持 Board、Column 和 Placement 身份不变

#### Scenario: Board 文本校验失败
- **WHEN** 创建或编辑请求提交规范化后为空、超过 80 个 code point 的名称，或超过 1000 个 code point 的描述
- **THEN** Core API 以指向相应字段的稳定 validation error 拒绝整个请求且不静默截断，Desktop 保留输入并显示字段级反馈

#### Scenario: 稀疏编辑兼容历史超长 Board 值
- **WHEN** 既有 Board 的名称或描述超过当前产品上限，而 Owner 只提交另一字段的有效修改
- **THEN** 系统只校验并保存已提交字段，不因未提交的历史值拒绝请求，也不截断或改写该历史值

#### Scenario: 清空 Board 描述
- **WHEN** Owner 省略名称并提交 `descriptionPatch.CLEAR`
- **THEN** 系统清空描述并递增 Board version；省略 `descriptionPatch` 则保持描述不变

#### Scenario: 提交空 Board mutation
- **WHEN** 编辑请求没有提交任何实际变化的名称或描述
- **THEN** Core API 以稳定 validation error 拒绝且不递增 Board version

### Requirement: 每个 Board 始终拥有至少一个 Column
创建 Board SHALL 在同一事务中创建一个普通初始 Column。Column SHALL 具有稳定 `columnId`、所属 `boardId`、必填名称、稳定顺序、版本和审计时间。Column 名称 SHALL 去除首尾空白并规范化为 Unicode NFC，规范化结果 MUST 为 1 至 50 个 Unicode code point，且 MUST NOT 被静默截断。Project OWNER SHALL 能以 actor 与 Project 范围内唯一的 UUID request id 及当前 Board version 新增 Column，并能改名和重排 Column；新增的同键同规范化载荷重试 SHALL 返回原 Column，同键异载荷 SHALL 稳定冲突。Column 改名或删除 SHALL 同时携带当前 Board version 与 Column version；重排 SHALL 携带当前 Board version。只有没有 Placement 的 Column 可删除，且最后一个 Column MUST NOT 被删除。

#### Scenario: 创建 Board 的初始 Column
- **WHEN** Board 创建成功
- **THEN** 同一事务创建一个初始 Column，Board 可立即接收 Work Item Card

#### Scenario: 新增并重排列
- **WHEN** Owner 以当前 Board version 新增 Column，或提交包含全部 Column ID 且无重复的顺序
- **THEN** 系统保存确定性顺序并返回权威 Board 布局

#### Scenario: 重试新增 Column
- **WHEN** 同一 actor 在同一 Project 以相同 request id 和规范化名称重试已成功的新增 Column
- **THEN** 系统返回原 Column 和当前权威布局，不重复创建 Column

#### Scenario: request id 被复用为不同 Column
- **WHEN** 同一 actor 在同一 Project 以相同 request id 提交不同规范化名称或不同 Board
- **THEN** 系统返回稳定幂等冲突且不创建额外 Column

#### Scenario: Column 版本过期
- **WHEN** Owner 以过期 Board version 或 Column version 改名或删除 Column
- **THEN** 系统返回稳定冲突，不覆盖较新的名称、Column 集合或 Placement

#### Scenario: 删除空 Column
- **WHEN** Board 至少还有另一个 Column，且 Owner 以当前 Board version 与 Column version 删除没有 Placement 的 Column
- **THEN** 系统删除该 Column 并返回 `204`；Desktop 随后重新读取剩余权威布局

#### Scenario: 删除非空或最后一个 Column
- **WHEN** Owner 尝试删除含 Card 的 Column或 Board 的唯一 Column
- **THEN** 系统以稳定冲突拒绝，Column 与 Placement 均保持不变

#### Scenario: 重排包含跨 Board 或遗漏 ID
- **WHEN** Column 顺序包含其他 Board 的 ID、重复 ID 或遗漏当前 Board 的 Column
- **THEN** 系统拒绝整个请求且不改变任何 Column 顺序

#### Scenario: Column 名称校验失败
- **WHEN** Owner 创建或改名时提交规范化后为空或超过 50 个 Unicode code point 的 Column 名称
- **THEN** Core API 以指向名称字段的稳定 validation error 拒绝且不改变 Board 或 Column version，Desktop 保留输入并显示字段级反馈

### Requirement: Card 是 Work Item 的 Board Placement 投影
Card SHALL 复用 `workItemId`，MUST NOT 具有 `CardId`，也 MUST NOT 独立拥有或复制 Work Item 标题、描述、lifecycle 或 status。`BoardPlacement` SHALL 以 `(boardId, workItemId)` 唯一标识 Work Item 在一个 Board 中的位置，并引用该 Board 的一个 Column、稳定排序值和乐观版本。同一个 Work Item MAY 在多个 Board 中拥有各自 Placement；每个 Board 读取 SHALL 以 Work Item 权威内容和该 Board Placement 组合 Card。Column 及其名称只表示该 Placement 在特定 Board 内的位置，MUST NOT 被解释为 Work Item 全局状态。

#### Scenario: 同一 Work Item 出现在两个 Board
- **WHEN** 同一 Project Work Item 分别在两个 Board 中具有 Placement
- **THEN** 两个 Card 使用同一 `workItemId` 和权威内容，但各自保持 Column、顺序和 Placement 版本，且任一 Column 都不成为 Work Item 状态

#### Scenario: Work Item 内容更新
- **WHEN** Work Item 标题或描述被修改
- **THEN** 所有包含该 Work Item 的 Board 下次读取均显示新内容，无需同步 Card 副本

#### Scenario: Placement 指向错误范围
- **WHEN** 请求把 Work Item 放入其他 Project 的 Board，或把 Placement 指向其他 Board 的 Column
- **THEN** Core API 以 not-found 语义拒绝且不泄露真实归属

### Requirement: Card 移动只改变当前 Board 布局
Project OWNER SHALL 能把 Card 移到当前 Board 的目标 Column，并相对目标位置排序。移动请求 SHALL 携带当前 Board 版本、当前 Placement 版本、目标 Column 和可选 `beforeWorkItemId`；有值表示移动到该目标 Column 内对应 Card 之前，缺失表示移动到目标 Column 末尾。Core API SHALL 在一个事务内重新校验范围、版本、锚点和权威布局，保存稳定顺序并返回更新后的 Board 布局；已处于目标位置的有效请求 SHALL 返回当前布局且不递增版本。该动作 MUST NOT 创建或修改 Work Item 状态、其他 Board Placement、Workflow 或 Agent 行为。

#### Scenario: 在同一 Column 内排序
- **WHEN** Owner 把 Card 移到当前 Column 的两个有效 Card 之间
- **THEN** 系统只更新当前 Board 的权威排序并返回该顺序

#### Scenario: 跨 Column 移动
- **WHEN** Owner 把 Card 移到当前 Board 的另一 Column
- **THEN** 系统只把当前 Placement 改为目标 Column 与目标顺序，不创建或推导 Work Item 状态

#### Scenario: 移动到目标列末尾
- **WHEN** Owner 指定目标 Column 且不提供 `beforeWorkItemId`
- **THEN** Card 成为目标 Column 的最后一项，并保持确定性顺序

#### Scenario: 移动到当前位置
- **WHEN** 当前版本请求所描述的位置与权威布局完全相同
- **THEN** 系统返回当前布局，不更新时间或递增 Board 与 Placement 版本

#### Scenario: 其他 Board 不受影响
- **WHEN** 被移动的 Work Item 也出现在另一个 Board
- **THEN** 另一个 Board 的 Column、顺序和 Placement 版本保持不变

#### Scenario: 并发后使用过期布局
- **WHEN** 移动请求携带过期 Board、Placement 或锚点状态
- **THEN** 系统返回稳定冲突，客户端丢弃乐观布局并重新加载服务端权威 Board

### Requirement: Desktop 直接进入最近可访问 Board
Desktop SHALL 在进入 ACTIVE Project 时优先打开当前 environment、User 与 Project 下记住且仍可访问的 Board；没有有效偏好时 SHALL 打开按 `createdAt`、`boardId` 升序的第一个 Board。创建 Board 成功后 SHALL 直接进入新 Board。删除当前 Board 成功后，Desktop SHALL 使该 Project 的最近 Board 偏好失效并打开剩余 Board 中按相同顺序的第一个；没有剩余 Board 时 SHALL 显示既有“暂无看板”状态及创建入口。Board 选择偏好不是业务真相，读取、写入或清理失败 MUST NOT 阻止确定性回退，也 MUST NOT 使已删除 Board 再次成为当前选择。

#### Scenario: 最近 Board 仍可访问
- **WHEN** User 再次进入 Project 且本机记住的 Board 仍属于该 Project
- **THEN** Desktop 打开该 Board 并展示其权威 Column 与 Card

#### Scenario: 最近 Board 无效
- **WHEN** 偏好缺失、损坏、指向其他 Project 或指向已经删除的 Board
- **THEN** Desktop 打开该 Project 最早创建的现存 Board，并清理无效偏好

#### Scenario: 创建新 Board
- **WHEN** Board 创建成功且响应仍属于当前 session、Workspace 与 Project
- **THEN** Desktop 选择新 Board并把焦点恢复到可理解的 Board 标题或首个主要操作

#### Scenario: 删除当前 Board 后仍有其他 Board
- **WHEN** 当前 Board 删除成功且 Project 仍有至少一个可访问 Board
- **THEN** Desktop 使旧偏好失效、打开按 `createdAt`、`boardId` 升序的第一个剩余 Board，并把焦点移到其标题或首个主要操作

#### Scenario: 删除最后一个 Board
- **WHEN** Project 的最后一个 Board 删除成功
- **THEN** Desktop 显示“暂无看板”状态与创建入口，不自动创建替代 Board

### Requirement: Desktop 不提交失去资格的 Board 快照
Desktop SHALL 同时使用 session/Workspace/Project/Board response key 与每个 Board 单调递增的 request generation 判断异步结果是否仍可提交。切换上下文 SHALL 使旧上下文响应失效；同一 Board 上任何会改变 Board snapshot 内容的 mutation 成功后，所有在该 mutation 成功提交前启动且随后才返回的 Board 读取也 SHALL 失效。Board 删除成功 SHALL 使该 Board 的所有读取、详情和 mutation 响应永久失去当前提交资格，并启动一次确定性 home 解析；失效响应 MUST NOT 覆盖当前 Board 列表、Column、Card 内容、布局、详情、错误或选择。

#### Scenario: Work Item 编辑后旧 Board 读取迟到
- **WHEN** 较早启动的 Board 读取在当前 Board 的 Work Item 编辑成功并更新 Card 后才返回旧标题或描述
- **THEN** Desktop 按该 Board 的 request generation 丢弃旧读取，保留已成功提交的新内容

#### Scenario: 同一 Board 布局修改后旧读取迟到
- **WHEN** 较早启动的 Board 读取在 Column 或 Placement mutation 成功后才返回旧布局
- **THEN** Desktop 不提交旧快照，继续显示成功 mutation 的权威结果

#### Scenario: Board 删除后旧响应迟到
- **WHEN** 已删除 Board 的读取、Work Item 详情或 mutation 响应在删除成功并解析新 home 后返回
- **THEN** Desktop 丢弃该响应，不重新选择已删除 Board、不重开旧详情，也不覆盖零 Board 或后继 Board 状态

### Requirement: Board 交互可通过键盘和辅助技术完成
Desktop SHALL 为 Board 切换、Column 操作、Board 永久删除、Card 打开以及移动和排序提供可见焦点、可理解名称和不依赖拖拽的键盘等价操作。指针用户 SHALL 能直接拖拽 Card 到目标 Column 或目标 Card 前；拖起、目标 Column、插入位置、成功结果和失败回滚 SHALL 有克制且可感知的反馈。Card 激活 SHALL 先打开只读 Work Item 详情；详情中的“所在列表”字段 SHALL 提供跨 Column 移动的主要非拖拽等价路径，不再提供独立移动按钮或移动弹窗。Board overflow 轻量菜单 SHALL 将入口命名为“删除看板 / Delete board”；点击菜单与触发器之外的区域 SHALL 关闭菜单且不得吞掉目标操作，按 `Escape` SHALL 关闭菜单并把焦点恢复到触发器，菜单内部及其 Portal-owned 内容 SHALL 视为内部交互。打开后的危险确认 Dialog SHALL 与轻量菜单分别管理，继续明确“永久删除”、不可逆、非空限制和 Work Item 保留语义，并要求输入完整精确 Board 名称后才能提交；脏输入、pending 与危险操作门禁 MUST NOT 被普通外部点击规则绕过。reduced-motion 偏好 SHALL 禁用非必要位移动画，同时保留状态反馈。

#### Scenario: 键盘移动 Card
- **WHEN** 用户不使用拖拽而在 Work Item 详情中激活“所在列表”字段并选择另一目标 Column
- **THEN** 系统立即原子保存 Work Item 与 Placement 上下文、把 Card 移到目标 Column 末尾，并把焦点保留在仍打开的权威详情或该字段的稳定位置

#### Scenario: 指针拖拽 Card
- **WHEN** 用户拖起 Card 并经过目标 Column 或目标 Card
- **THEN** UI 按指针所在 Card 的上半区或下半区解析该 Card 前或下一 Card 前的落点，仅越过最后一张 Card 时选择列末尾，并以一个使周围 Card 让位的占位槽及非仅颜色的目标 Column 反馈呈现插入位置；提交成功后采用服务端权威布局并以短暂落位反馈呈现移动后的 Card

#### Scenario: 拖拽失败
- **WHEN** Card 拖拽请求被并发冲突或暂时错误拒绝
- **THEN** UI 恢复权威位置、公告失败原因并提供重试或重新加载路径

#### Scenario: 外部指针关闭 Board 菜单
- **WHEN** Board overflow 菜单已打开，用户在菜单、触发器及其 Portal-owned 内容之外按下指针
- **THEN** 轻量菜单关闭，原目标仍接收本次操作，系统不得要求再次点击或把普通页面区域显示为禁用

#### Scenario: Escape 关闭 Board 菜单
- **WHEN** 用户在打开的 Board overflow 菜单中按 `Escape`
- **THEN** 菜单关闭且焦点回到打开它的触发器

#### Scenario: 危险确认不继承轻量关闭规则
- **WHEN** 用户从“删除看板 / Delete board”打开永久删除确认 Dialog
- **THEN** 菜单关闭，Dialog 继续独立执行精确名称、脏输入、pending、取消和焦点恢复规则，点击普通外部区域不得绕过这些门禁

#### Scenario: Board 删除确认可访问
- **WHEN** 用户仅使用键盘打开 Board 删除确认、输入名称并提交或取消
- **THEN** 焦点顺序、危险说明、名称匹配错误、pending 状态和关闭后的焦点恢复均可感知，且 `Escape` 不静默丢弃已输入的确认名称

#### Scenario: 最小窗口横向浏览
- **WHEN** Board 在 `960×640` 显示多个 Column、Work Item 详情或 Board 删除确认
- **THEN** Column 区域可有序横向滚动，Board 导航、当前标题、详情字段和主要操作仍可通过键盘到达且不相互遮挡

### Requirement: Project Owner 可永久删除空 Board
Project OWNER SHALL 能以当前 Board version 和精确当前 Board 名称确认永久删除普通 Board。Core API SHALL 在一个事务内锁定并重新校验 Workspace、Project、Board、OWNER 权限、version、名称和 Placement 数量；只有没有任何 Placement 的 Board 可删除。成功删除 SHALL 显式删除该 Board 的全部 Columns 后删除 Board 并返回 `204`，MUST NOT 删除或修改任何 Project-owned Work Item。非空 Board SHALL 返回 `BOARD_NOT_EMPTY`，名称不匹配 SHALL 返回 `BOARD_NAME_CONFIRMATION_MISMATCH`，版本过期 SHALL 返回 `BOARD_VERSION_CONFLICT`，当前或未来受保护依赖 SHALL 返回 `BOARD_DELETE_RESTRICTED`；这些业务冲突均使用 `409` 并拒绝整个操作，不得留下部分删除。错误范围或越权请求 SHALL 继续使用既有 not-found 或 authorization 语义。Project MAY 在删除后拥有零个 Board。

#### Scenario: 删除有多个空 Column 的 Board
- **WHEN** Project OWNER 以当前 Board version 和精确当前名称确认删除一个没有任何 Placement、但有多个 Column 的 Board
- **THEN** 系统在一个事务内删除该 Board 的全部 Columns 和 Board、返回 `204`，并保留 Project 的全部 Work Item

#### Scenario: 拒绝删除非空 Board
- **WHEN** Board 的任意 Column 中存在至少一个 Placement
- **THEN** 系统返回 `BOARD_NOT_EMPTY` 冲突，Board、Columns、Placements 与 Work Items 全部保持不变

#### Scenario: 名称确认不匹配
- **WHEN** OWNER 提交的确认名称不精确匹配锁定后的当前 Board 名称
- **THEN** 系统返回 `BOARD_NAME_CONFIRMATION_MISMATCH`，不移除任何 Column、Placement、Board 或 Work Item

#### Scenario: Board version 已经过期
- **WHEN** OWNER 提交的 expected version 不是锁定后的当前 Board version
- **THEN** 系统返回 `BOARD_VERSION_CONFLICT`，不移除任何 Column、Placement、Board 或 Work Item

#### Scenario: 错误租户范围或越权删除
- **WHEN** 请求组合错误 Workspace、Project 或 Board，或 actor 不是 Project OWNER
- **THEN** Core API 按既有 not-found 或 authorization 语义拒绝且不泄露资源真实归属

#### Scenario: 受保护依赖阻止删除
- **WHEN** 当前或未来受保护记录仍通过限制性引用依赖待删除 Board 或 Column
- **THEN** 系统返回 `BOARD_DELETE_RESTRICTED` 并回滚整个事务，不绕过未知依赖或产生部分删除

### Requirement: Desktop 调和没有权威响应的 Board 删除
Board 永久删除请求发生传输错误或暂时错误且 Desktop 没有权威成功或失败响应时，Desktop MUST NOT 自动重发永久删除，MUST 将该 Board 作用域置为调和中并拒绝相关迟到结果，随后重新读取权威 Board 列表。若目标 Board 已不存在，Desktop SHALL 按删除成功处理、永久拒绝该 Board 的迟到结果、使最近 Board 偏好失效并解析新 home；若目标 Board 仍存在，Desktop SHALL 按删除失败处理、解除隔离、递增该 Board generation 并重新加载该 Board；若 Board 列表也无法读取，Desktop SHALL 明确显示删除结果未知并保持该 Board 隔离，只允许用户重试调和或离开 Project，MUST NOT 声称删除成功或失败，也 MUST NOT 允许继续在该 Board 上 mutation。

#### Scenario: 删除已提交但响应丢失
- **WHEN** Core API 已永久删除 Board，但 Desktop 只收到没有权威响应的错误，且随后读取的权威 Board 列表中已无该 Board
- **THEN** Desktop 将结果调和为删除成功，丢弃该 Board 的迟到响应并进入后继 Board 或零 Board home

#### Scenario: 删除没有提交且 Board 仍存在
- **WHEN** Desktop 收到没有权威响应的错误，但随后读取的权威 Board 列表仍包含该 Board
- **THEN** Desktop 将结果调和为删除失败，重新加载该 Board 的权威状态且不伪造删除成功

#### Scenario: 删除结果暂时无法调和
- **WHEN** 删除请求没有权威响应且随后读取 Board 列表也失败
- **THEN** Desktop 显示删除结果未知、继续隔离该 Board 的迟到响应和 mutation，并且只提供重试调和或离开 Project

### Requirement: Card 投影包含 Work Item 当前责任人
每个 Board 读取 SHALL 以 Work Item 权威内容、Work Item 当前责任人和该 Board Placement 组合 Card。Card SHALL 复用 `workItemId`，MUST NOT 独立拥有或复制责任人；同一 Work Item 在多个 Board 中出现时，所有 Card SHALL 展示同一个 Work Item 当前责任人，同时保留各自 Column、顺序和 Placement version。Card move SHALL 只改变当前 Board Placement，不得创建、清空或修改 Work Item 责任人。

#### Scenario: Board 读取显示责任人头像所需数据
- **WHEN** Project OWNER 读取包含已分配 Work Item 的 Board
- **THEN** Card response 包含该 Work Item 当前责任人摘要和 Placement 信息，使 Desktop 可在 Card 正面展示责任人头像

#### Scenario: 同一 Work Item 在多个 Board 的责任人一致
- **WHEN** 同一 Work Item 分别在两个 Board 中具有 Placement 且责任人被修改
- **THEN** 两个 Board 下次读取对应 Card 时均显示同一最新责任人，但各自 Column、顺序和 Placement version 不受责任人修改影响

#### Scenario: 移动 Card 不改变责任人
- **WHEN** Owner 把 Card 拖拽或键盘移动到另一个 Column
- **THEN** 系统只更新当前 Board Placement，Work Item 责任人、创建人、标题和描述保持不变

#### Scenario: 责任人修改不改变 Board 布局
- **WHEN** Owner 修改 Work Item 责任人且不提交 Placement 变化
- **THEN** 系统不改变 Board、Column、Placement 顺序或 Placement version，并在权威 Card 投影中返回新的责任人

### Requirement: Desktop 看板使用紧凑且连续的工作区布局

Desktop SHALL 在既有 Project 导航旁呈现连续浅色看板工作区，以紧凑 Project 上下文、Board 切换／操作工具栏和 Column 画布建立稳定层级。Project 名称、当前 Board 选择和既有主要操作 SHALL 清晰可辨；Column SHALL 使用低对比浅色分组表面，列名、数量与操作 SHALL 对齐，Card SHALL 成为主要内容边界。各 Column MUST NOT 按名称、顺序或看似 Todo／Done 的文字自动赋予业务状态颜色。工具栏与画布 SHALL 使用一致的水平对齐；紧凑布局 MUST NOT 通过缩小正文至难以阅读、缩小可操作目标或遮挡焦点实现。现有 Project 导航结构与 Board／Column／Work Item 操作语义 SHALL 保持不变，MUST NOT 添加未实现的筛选、视图、优先级或执行入口。

#### Scenario: 查看普通多列看板
- **WHEN** 用户打开含多列与真实工作项的 Board
- **THEN** Project 上下文与 Board 工具栏保持紧凑，Column 呈现浅色分组，Card 标题、摘要和责任信息按一致层级排列，且画布不被大标题区或重复容器边界主导

#### Scenario: 在最小窗口浏览多列
- **WHEN** 用户在 `960×640` 窗口打开包含五个 Column 的 Board
- **THEN** Column 画布可横向滚动，各列内容可纵向浏览，Project 上下文、Board 操作与列内创建入口仍可到达；页面本身不产生失控横向溢出，也不把所有列压缩成不可读窄列

#### Scenario: 长名称和中英文内容
- **WHEN** Project／Board／Column 名称较长或用户切换中文与英文界面
- **THEN** 名称完整值仍可通过可访问名称或 tooltip 获取，标题与工具栏允许必要的安全换行或局部滚动，操作不重叠且 Card 的正文保持可读

#### Scenario: 空列和权威状态反馈
- **WHEN** Board 含空 Column、正在加载，或发生现有读取／mutation 错误
- **THEN** 空列继续提供既有创建入口，加载和错误出现在既有状态边界内；UI 不将错误显示为空数据，不隐藏恢复入口，也不因布局调整显示伪造任务或统计

#### Scenario: 键盘访问和焦点
- **WHEN** 用户仅使用键盘切换 Board、打开 Card 或到达 Column 操作
- **THEN** 当前选择、可理解名称、可见焦点和既有焦点恢复继续有效，水平或垂直滚动不会永久裁切焦点和操作

### Requirement: 不同 Card 高度下拖拽反馈匹配实际布局

Desktop SHALL 在 Card 因标题行数具有不同高度时，使用被拖起 Card 的实际尺寸呈现预览与唯一插入占位槽，以目标 Card 的实际可见边界解析精确插入位置。目标 Column 和占位槽 SHALL 保持可感知且不只依赖颜色。提交 SHALL 继续使用既有当前 Board／Placement 版本、目标 Column 与 `beforeWorkItemId` 语义；成功采用权威 Board，失败恢复权威位置与恢复入口，取消不提交 mutation。拖拽结束、取消或看板卸载 SHALL 清理预览、占位与临时几何状态。reduced-motion SHALL 移除非必要位移动画并保留插入位置和成功／失败状态反馈。

#### Scenario: 不同高度卡片之间插入
- **WHEN** 用户把两行标题 Card 拖到一行标题 Card 的上半区或下半区
- **THEN** 预览和占位槽高度匹配拖起 Card，落点按目标实际边界解析到该 Card 前或下一 Card 前，且不以旧固定高度推算目标

#### Scenario: 跨列移动到末尾或空列
- **WHEN** 用户拖动 Card 越过目标列最后一张 Card 或进入空列
- **THEN** 唯一占位槽显示在目标列末尾，提交省略 `beforeWorkItemId`，成功后位置与权威响应一致

#### Scenario: 拖拽失败或取消
- **WHEN** 拖拽被取消，或提交发生暂时失败／版本冲突
- **THEN** 取消不提交请求；失败保留既有错误公告和重新加载路径，Card 不残留在未确认位置，临时槽和拖拽预览清理

#### Scenario: reduced-motion 拖拽
- **WHEN** 用户启用 reduced-motion 并拖动不同高度 Card
- **THEN** UI 保留预览、实际高度占位和结构性目标提示，移除非必要让位与落位动画，且提交位置语义不变
