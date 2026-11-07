# Spec Delta

## Purpose

收紧 Board 与 Column 的文本写入约束，并定义 Board 轻量菜单和永久删除 Dialog 的清晰交互边界。

## MODIFIED Requirements

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
