# Project Work Items Specification

## Purpose

为 Project 提供最小但真实的 Work Item 业务记录，使 Board Card 始终投影稳定、可授权和可并发控制的工作数据，而不是把标题与描述复制为仅存在于界面的演示状态。

## Requirements

### Requirement: Work Item 是 Project 内的业务真相
每个 Work Item SHALL 具有稳定 `workItemId`、唯一 `projectId` 引用、必填标题、可选描述、版本、创建者和审计时间。当前实现尚未实现业务模型已批准的 Target Work Item 状态机；当前 Work Item 与 Card 的持久化模型和 API response MUST NOT 包含固定 `OPEN`、`lifecycle`、`status` 或等价占位字段，也 MUST NOT 暴露完成、关闭、取消或重开动作。在 Work Item Type 与自定义字段尚未实现时不要求类型版本；未来使用类型化字段的 Work Item SHALL 通过后续 Change 固定不可变 Work Item Type Version。标题 SHALL 去除首尾空白并规范化为 Unicode NFC，规范化结果 MUST 为 1 至 300 个 Unicode code point；描述 SHALL 去除首尾空白、规范化为 Unicode NFC 并限制为最多 10000 个 Unicode code point。

#### Scenario: 读取 Work Item
- **WHEN** Project OWNER 读取当前 Project 的 Work Item
- **THEN** 响应以 `workItemId` 标识权威记录，并返回标题、描述、版本和审计时间，且不返回 lifecycle 或 status

#### Scenario: 同名 Work Item
- **WHEN** Owner 在同一 Project 创建标题相同的两个 Work Item
- **THEN** 系统以不同 `workItemId` 保存两条记录，不以标题作为身份或唯一键

#### Scenario: 未支持的生命周期动作
- **WHEN** 客户端尝试通过当前 Desktop API 完成、关闭、取消或重开 Work Item
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
当前 Desktop API 和 UI MUST NOT 提供单独永久删除 Work Item 的动作。经 Project Danger Zone 显式确认的 Project 永久删除 MAY 按 Project 拥有关系删除其 Work Item；除此之外，未知或受保护依赖 SHALL 继续阻止无语义的数据删除。

#### Scenario: 查找独立删除动作
- **WHEN** 用户或契约测试检查当前 Work Item 操作
- **THEN** 不存在独立删除 endpoint 或 UI 动作

#### Scenario: 永久删除所属 Project
- **WHEN** Project 永久删除已通过名称、版本、权限和依赖校验
- **THEN** 该 Project 的 Work Item 与 Board 子资源在同一事务内被显式删除，或任一步失败时全部保留

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
