# Project Work Items Specification

## Purpose

为 Project 提供最小但真实的 Work Item 业务记录，使 Board Card 始终投影稳定、可授权和可并发控制的工作数据，而不是把标题与描述复制为仅存在于界面的演示状态。

## Requirements

### Requirement: Work Item 是 Project 内的业务真相
每个 Work Item SHALL 具有稳定 `workItemId`、唯一 `projectId` 引用、必填标题、可选描述、版本、创建者和审计时间。当前实现尚未实现业务模型已批准的 Target Work Item 状态机；当前 Work Item 与 Card 的持久化模型和 API response MUST NOT 包含固定 `OPEN`、`lifecycle`、`status` 或等价占位字段，也 MUST NOT 暴露完成、关闭、取消或重开动作。在 Work Item Type 与自定义字段尚未实现时不要求类型版本；未来使用类型化字段的 Work Item SHALL 通过后续 Change 固定不可变 Work Item Type Version。标题 SHALL 去除首尾空白并规范化为 Unicode NFC，规范化结果 MUST 为 1 至 300 个 Unicode code point；描述 SHALL 去除首尾空白、规范化为 Unicode NFC 并限制为最多 10000 个 Unicode code point。

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

### Requirement: 从 Board 创建 Work Item 时原子建立 Placement
Project OWNER SHALL 能从当前 Board 提交标题、可选描述、UUID request id 和 expected Board version 创建 Work Item。Core API SHALL 在一个事务内重新校验 Workspace、Project、Board、expected Board version 和目标 Column，创建 Work Item 及其在当前 Board 的唯一 Placement并递增 Board version；同一 actor 与 Project 范围内相同 request id 和规范化 payload 的成功重试 MUST 返回同一 Work Item 与 Placement，即使首次成功已递增 Board version，也不得重复创建任一记录。规范化幂等 payload SHALL 包含标题、描述、Board、目标 Column 和 expected Board version。

#### Scenario: 在当前 Column 创建 Card
- **WHEN** Owner 在当前 Board 的有效 Column 提交有效字段、新 request id 和当前 Board version
- **THEN** 系统原子创建不含状态字段的 Work Item 与 Placement、递增 Board version，Card 出现在目标 Column 的末尾

#### Scenario: 使用过期 Board version 创建 Card
- **WHEN** Owner 以新 request id 和过期 Board version 提交 Work Item 创建
- **THEN** 系统返回稳定并发冲突，Work Item、Placement 和 Board 布局均不改变

#### Scenario: 创建响应丢失后重试
- **WHEN** 客户端以相同 request id、expected Board version 和其余规范化 payload 重试已成功的创建
- **THEN** 系统返回原 Work Item 与原 Placement，不因首次成功已递增 Board version 而冲突，也不产生重复 Card

#### Scenario: request id 被复用为不同 Work Item
- **WHEN** 相同 actor 与 Project 下的 request id 被用于不同标题、描述、Board、目标 Column 或 expected Board version
- **THEN** 系统返回稳定幂等冲突且不创建额外记录

#### Scenario: 目标 Column 不属于 Board
- **WHEN** 创建请求组合了同 Project 的一个 Board 与另一个 Board 的 Column
- **THEN** 系统以 not-found 语义拒绝，Work Item 与 Placement 都不创建

### Requirement: Project Owner 可查看和原子编辑 Work Item
Project OWNER SHALL 能按稳定 ID 查看 Work Item，并以当前版本修改标题和描述。当前 Board 上的编辑请求 SHALL 同时携带 Board、Placement、当前 Column 和目标 Column 上下文；若目标 Column 与当前 Column 不同，还 SHALL 携带当前 Board version 与 Placement version。Core API SHALL 同时校验路径中的 Workspace、Project、Work Item、Board、Placement 和目标 Column 归属，在一个事务内保存 Work Item 内容与可选 Placement 变更，并返回权威 Work Item 与 Board。成功修改 SHALL 递增 Work Item 版本并保留其 ID；目标 Column 未变化时 SHALL 不改变 Board 或 Placement version，目标 Column 变化时 SHALL 把 Card 移到目标 Column 末尾并递增受影响的布局 version。任一校验或写入失败 MUST 回滚内容和位置的全部变化。

#### Scenario: 只编辑 Work Item 内容
- **WHEN** Owner 以当前 Work Item 版本提交有效标题、描述和未变化的目标 Column
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

### Requirement: 当前切片不提供 Work Item 独立删除
当前 canonical user resource API 和 UI MUST NOT 提供单独永久删除 Work Item 的动作。经 Project Danger Zone 显式确认的 Project 永久删除 MAY 按 Project 拥有关系删除其 Work Item；除此之外，未知或受保护依赖 SHALL 继续阻止无语义的数据删除。

#### Scenario: 查找独立删除动作
- **WHEN** 用户打开 Work Item 详情、Card 菜单或调用当前 canonical user resource API
- **THEN** 系统不提供 Work Item 独立永久删除入口或 endpoint

#### Scenario: 永久删除所属 Project
- **WHEN** Project OWNER 按 Project 删除规格永久删除拥有该 Work Item 的 Project
- **THEN** Work Item 可作为已批准的 Project 子资源在同一事务被删除

### Requirement: Card 先打开权威只读 Work Item 详情
Desktop SHALL 在用户激活 Card 后按稳定 `workItemId` 读取当前 Workspace 与 Project 范围内的权威 Work Item，并始终以实际 Work Item 标题作为 Dialog 的唯一可访问 heading 和名称，展示描述及紧凑审计时间；MUST NOT 使用“工作项详情”替代对象标题、重复渲染第二份标题字段、展示虚构的“当前看板”、展示 Placement/Column 属性行或展示 lifecycle/status。详情 SHALL 使用 content-adaptive、viewport-bounded 的稳定面板：普通短内容不得因固定高度产生大块无效留白；关闭按钮与审计 footer 在内容和字段模式切换时保持可达且位置稳定；超长内容 SHALL 由明确的内部滚动区域吸收，不得通过整面板反复调整尺寸或重新居中呈现。详情打开时 MUST NOT 自动把全部字段变为输入控件。详情的加载、not-found、暂时错误与迟到响应 SHALL 保持当前 Board 可用，不得用 Card 快照伪造一次成功详情或覆盖较新的选择。关闭详情 SHALL 把焦点恢复到原 Card；若该 Card 已因权威布局变化而不可用，则恢复到当前 Board 内最近的可理解操作。

#### Scenario: 打开 Card 详情
- **WHEN** 用户激活当前 Board 中的 Card 且权威 Work Item 读取成功
- **THEN** Desktop 以实际标题为唯一主 heading，展示权威描述和审计 footer，不展示 Placement/Column 属性行或编辑入口，不自动聚焦输入框且不展示状态占位

#### Scenario: 长内容保持稳定面板
- **WHEN** 详情展示长标题、多行描述或内容超过可用 viewport 高度
- **THEN** 面板边界、关闭按钮和审计 footer 保持稳定，内容在明确区域内滚动且键盘焦点仍可到达

#### Scenario: 详情读取失败
- **WHEN** Work Item 不存在、用户失去访问权或读取暂时失败
- **THEN** Desktop 显示可理解的详情级错误与重试或关闭路径，保持 Board 可操作且不展示伪造详情

#### Scenario: 切换 Card 后旧详情迟到
- **WHEN** 用户已选择另一 Card、切换 Board 或关闭详情后，先前 Work Item 读取才返回
- **THEN** Desktop 丢弃旧结果，不重开详情或覆盖当前选择

### Requirement: Work Item 详情使用稳定的单字段原位编辑与隐式保存
只读详情 SHALL 只为作为主 heading 的标题和正文描述提供可见、可聚焦且具有可理解名称的局部编辑入口；同一时刻最多一个字段处于编辑态。详情 MUST NOT 展示或编辑当前 Placement/Column；Card 在 Board 中的所在位置继续由画布表达，移动入口继续是 Board 拖拽。只读表面与编辑控件 SHALL 共享该字段的文字原点和布局占位。标题读写态 MUST 使用匹配的字形度量且不得只在编辑态插入可见“标题”标签；标题 SHALL 保持单行，只读长值使用 ellipsis，编辑 input 使用关闭按钮左侧除约 16px 间距外的全部可用宽度，不得按字符数固定宽度或出现纵向滚动。描述 SHALL 是使用详情完整内容宽度的多行主要正文，“描述”标签 SHALL 在只读、编辑、saving、成功、validation error、暂时失败和冲突状态始终可见。描述预览与多行 textarea SHALL 使用相同完整宽度和受控占位；一行或空描述进入编辑时不得突然扩展为固定大高度，合法多行内容可在字段拥有的受控区域内增长或滚动，但 MUST NOT 引起整个详情面板闪动或重新居中。正常编辑路径 MUST NOT 显示常驻的“保存”“取消”“继续编辑”或三按钮脏草稿门禁，也 MUST NOT 把每个只读字段渲染成持续选中的描边卡片。字段提交 SHALL 使用打开详情后最近一次服务端确认的 Work Item 与 Placement/Column 上下文补齐完整 API 请求，但用户不得从详情改变该位置上下文。

标题在有效草稿按 `Enter` 或焦点真正离开标题交互区域时 SHALL 提交；描述在焦点真正离开描述交互区域或按 `Ctrl/Cmd+Enter` 时 SHALL 提交，普通 `Enter` MUST 保留换行。输入法处于 composition 时，标题 `Enter` 与描述快捷键 MUST NOT 被误判为提交。焦点在字段拥有的输入或辅助控件之间移动 MUST NOT 被误判为离开交互区域。`Escape` SHALL 放弃当前字段尚未提交的本地草稿、恢复最近确认值并退出编辑。

#### Scenario: 标题原位进入编辑并占满可用宽度
- **WHEN** 用户从只读 heading 激活标题编辑
- **THEN** 标题保持单行文字原点和字形度量，input 占用关闭按钮左侧除约 16px 间距外的全部可用宽度，详情面板、关闭按钮和 footer 不移动，也不突然出现“标题”标签

#### Scenario: 标题 Enter 或失焦提交
- **WHEN** 用户激活 heading 标题、修改为有效值，并在非输入法 composition 状态按 `Enter` 或把焦点移出标题交互区域
- **THEN** Desktop 自动使用当前 Work Item version 提交标题，不要求额外保存，并以权威响应同时更新 Dialog heading 与 Board Card

#### Scenario: 描述使用全宽多行编辑
- **WHEN** 用户激活空、单行或多行描述
- **THEN** “描述”标签保持可见，preview 与多行 textarea 使用详情完整内容宽度和一致文字原点，普通 `Enter` 输入换行，且不出现窄列布局或固定大块空白

#### Scenario: 描述失焦或快捷键提交
- **WHEN** 用户编辑多行描述并把焦点移出描述交互区域或在非输入法 composition 状态按 `Ctrl/Cmd+Enter`
- **THEN** Desktop 自动提交描述且普通 `Enter` 仍输入换行；标题在编辑期间保持只读

#### Scenario: 详情不展示 Placement 属性
- **WHEN** 用户查看或编辑 Work Item 详情
- **THEN** Desktop 不展示“所在列表”/“In column”、Column 值、combobox 或 Column 编辑入口；Card 的 Board 内位置仍由画布呈现，并可继续通过 Board 拖拽改变

#### Scenario: 中文输入法确认候选不提交
- **WHEN** 标题或描述输入处于 IME composition 且用户按 `Enter` 确认候选
- **THEN** Desktop 保留编辑态和组合后的草稿，不触发保存、字段切换或详情关闭

#### Scenario: Escape 放弃当前字段草稿
- **WHEN** 当前标题或描述已有尚未提交的修改且用户按 `Escape`
- **THEN** Desktop 不提交 mutation，恢复最近一次服务端确认值、退出字段编辑，并把焦点恢复到该字段触发器，且保持字段标签、详情面板和滚动位置稳定

### Requirement: 切换字段或关闭详情先完成隐式保存
用户在脏字段编辑期间激活另一字段、关闭详情或关闭上层界面时，Desktop SHALL 先提交当前字段，并把原始切换或关闭动作保留为待完成意图。保存进行中 SHALL 保留当前 editor、draft、字段标签和滚动位置，不得在权威结果到达前切回只读表面。提交成功后 SHALL 以权威值切换到等占位只读表面并执行该意图；validation、暂时失败或冲突时 MUST 留在当前详情和受影响字段，不得关闭、切换或丢弃草稿。保存请求进行中 MUST 防止同一草稿重复提交，并保持待完成意图可恢复。

#### Scenario: 从脏字段切换到另一字段
- **WHEN** 用户修改字段 A 后直接激活字段 B
- **THEN** Desktop 先保存字段 A，成功后才进入字段 B；失败则留在字段 A 并保留草稿

#### Scenario: 带脏字段关闭详情
- **WHEN** 用户修改当前字段后点击详情关闭按钮或触发详情外部 dismiss
- **THEN** Desktop 先保存当前字段，成功后关闭详情并安全恢复焦点；失败则保持详情打开和草稿可恢复；字段仍拥有焦点时按 `Escape` 则按字段规则放弃草稿而不提交

#### Scenario: 保存中保留编辑表面
- **WHEN** 任一字段的隐式保存尚未收到权威成功或失败响应
- **THEN** Desktop 保留该字段 editor、draft、常驻描述标签和滚动位置，只在既有字段身份行显示 saving，不提前切回只读表面或改变面板几何

#### Scenario: 保存期间重复关闭或切换
- **WHEN** 隐式保存正在进行且用户再次触发关闭或字段切换
- **THEN** Desktop 不重复提交同一草稿，并在当前请求完成后只执行仍然有效的待完成意图

### Requirement: 隐式保存状态与异常恢复保持低干扰
正常路径 SHALL 仅在实际 pending 或刚收到权威成功响应时，以活动字段既有标签/身份行右侧的轻量状态表达“保存中”和短暂的“已保存”；反馈出现、替换和消退 MUST NOT 新增一行、推移字段正文或改变详情面板几何。无变化时不得保留成功提示或显示操作栏；实现 MAY 为同一身份行保留不影响正文的反馈占位。只读态 SHALL 通过聚焦/hover 时出现的局部编辑控件或等价的非仅颜色 affordance 表达可编辑性，不得给整段文本加持续下划线或 selected-card 外观。可编辑 affordance、pending、错误和焦点状态 SHALL 通过颜色以外的信息可理解，并在 reduced-motion 偏好下移除非必要空间动效；不得用高度动画掩盖布局重排。

字段保存发生 validation、暂时错误或乐观并发冲突时，Desktop SHALL 保持详情打开，标识受影响字段并保留用户草稿，MUST NOT 把失败值写入 Board Card。普通失败 SHALL 提供字段内错误与精简的重试路径；版本冲突 SHALL 重新读取权威 Work Item 与 Board，清楚区分最新权威值与本地草稿，并仅在异常恢复区域提供“基于最新版本重试”与“使用最新内容”等明确动作。标题或描述保存仍 SHALL 携带未变化的 Placement/Column 上下文并继续遵守现有原子回滚语义；移除详情内 Column 入口不得删除或放宽 Core API 的可选 Placement 变化能力。

#### Scenario: 成功反馈自动消退
- **WHEN** 字段隐式保存成功
- **THEN** Desktop 以权威值切回等占位只读表面，在同一字段身份行短暂显示可感知的成功状态并自动淡出，不展示常驻按钮，不移动字段标签、正文、footer 或面板边界

#### Scenario: 字段校验失败
- **WHEN** 用户以空标题或超长内容触发隐式保存
- **THEN** Desktop 在字段旁显示验证错误、保留草稿和焦点，不呈现成功状态，也不执行待关闭或待切换意图

#### Scenario: 暂时保存失败
- **WHEN** 服务端暂时不可用或请求失败且没有权威 mutation 成功证据
- **THEN** Desktop 保持字段编辑态和草稿，Board Card 保持最近确认值，并提供字段内重试；日常三按钮门禁不重新出现

#### Scenario: Work Item version 冲突
- **WHEN** 字段保存使用的 Work Item version 已过期
- **THEN** Desktop 重新读取最新 Work Item 与 Board，保留本地草稿并在异常恢复区域提供基于最新版本重试或使用最新内容，且不自动覆盖任一方

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
