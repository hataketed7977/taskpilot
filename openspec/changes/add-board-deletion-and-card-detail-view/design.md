# Design

## Context

参见 `proposal.md` 的动机。Core API 当前持久化普通 Board、Column、Work Item 与 Board Placement，并以限制性外键阻止隐式级联；Desktop Main 拥有 Project Work HTTP client、按 Board generation 的响应围栏和 environment/User/Project 作用域的最近 Board 偏好。此前 Apply 已完成空 Board 删除、Work Item 字段隐式保存和固定 `OPEN lifecycle` 的端到端移除；这些是当前工作树中的已实现证据，但 Change 仍未 sync/archive。

随后用户验收发现 Focused Work Sheet 的首轮 Renderer 实现不满足动态体验：Dialog 仍是内容驱动高度并居中，标题/描述的只读表面与 input/固定六行 textarea 尺寸不同，进入编辑会让整个面板重排和重新居中；“描述”等标签只存在于编辑结构，保存切回只读后消失；既有 Cypress 几何断言只覆盖 saved feedback 消退后的 footer，没有覆盖 read→edit→saving→success/failure/conflict 的连续状态。该事实使此前“视觉验收通过”的结论失效，但不改变已实现的业务、API、删除或并发语义。

本次规划修订只重新打开 Renderer 详情交互、直接相关样式/i18n/测试和 Desktop owner docs。Core API、数据库、Main/Preload contract、Board 删除、授权与 capability boundary 均不改变；不引入依赖。

## Goals / Non-Goals

**Goals:**

- 复用现有不可逆 Project 删除的契约形状，为空 Board 提供服务端授权、锁定、确认和原子删除。
- 让 Board 删除后的 home、偏好和迟到响应收敛到一个确定状态，包括零 Board。
- 以一个明确的详情状态机实现“先查看、原位编辑、字段类型驱动隐式保存”，且提交继续使用现有原子 Work Item/Placement 写契约。
- 让实际 Work Item 标题成为详情唯一主 heading，并以 content-adaptive 稳定 shell、全宽多行描述和审计 footer 建立清晰层级；详情不展示 Placement/Column 行，正常路径无常驻保存/取消、三按钮门禁、额外反馈行或整块选中字段卡片。
- 从首次发布前的 PostgreSQL V1 基线、Core API/OpenAPI 和 Desktop strict contract 中端到端删除固定 `OPEN lifecycle`，明确当前 Work Item 没有状态能力。
- 在不削弱 Renderer/Main/Core API 边界的前提下，为删除规则、schema/catalog、strict transport、generation fencing、草稿、字段焦点和键盘行为提供确定性测试 seam。

**Non-Goals:**

- 不增加软删除、恢复、审计历史、批量删除、Work Item 删除或含 Card Board 的迁移/删除。
- 不拆分 Core API 的 Work Item PATCH 为多个字段 endpoint；字段级是 Desktop 交互语义，服务端继续接受完整的当前 Work Item 内容与可选 Placement 变化。
- 不实现或修改业务模型已批准的 Target `Open`、`Completed`、`Cancelled` 状态机及 reopen 转换，不把 Column 映射或重命名为全局状态；不改变 Project Work capability boundary 或 Card 拖拽语义。
- 第一版不做输入停止后的防抖持续保存，不建立离线 mutation 队列，不引入富文本或常驻 Save/Cancel 工具栏，也不重做 Desktop 全局视觉系统。
- 不以面板高度动画、任意大 `min-height` 或隐藏标签掩盖 read/edit DOM 几何不一致；不要求无条件冻结所有长草稿的字段高度。
- 不把 Renderer 可见状态、最近 Board 偏好或 Card 快照提升为业务授权或持久化真相。

## Business Model

分析使用关系图、Board 删除状态转换、详情交互状态机和具体失败场景；不要求引入对应的 DDD 类型或事件。

- `Project 1:N Board`、`Board 1:N Column`、`Board 1:N BoardPlacement`、`Project 1:N WorkItem` 保持不变；Placement 引用而非转移 Work Item 所有权。Card 仍是 Work Item 与当前 Board Placement 的投影。
- Board 状态增加 `Existing(empty) -> PermanentlyDeleted`。`Existing(non-empty)` 没有删除转换；不存在 `Deleting` 业务状态，pending 仅是客户端交互状态。
- 锁定后的 Board version、精确名称和零 Placement 是同一事务内的删除前置条件。Project 可以合法拥有零个 Board；注册或创建 Project 时自动建初始 Board 的规则不意味着后续必须保留至少一个。
- 详情状态为 `closed -> loading -> read-only -> editing(field, clean|dirty) -> saving(pendingIntent?) -> read-only`，读取/保存失败分别回到可重试详情或保留草稿的编辑态；冲突进入只属于异常恢复的 `conflict`。同一时刻只有一个 `field`，至多保留一个仍有效的字段切换或关闭意图。
- 标题和描述属于 Work Item；所在 Column 属于当前 Board Placement。详情只编辑 Work Item 内容，不展示 Placement 属性。移除该 UI 入口不改变所有权，也不删除 Core API 同时校验 Work Item、Board、Placement 的原子命令。
- Work Item 当前实现只有 identity、content、version、creator 和 audit facts，没有 lifecycle/status。固定单值 `OPEN` 没有转换、不承载授权或查询规则，移除后不以其他占位字段替代。业务模型已批准的 Target `Open`、`Completed`、`Cancelled` 与 reopen 转换继续有效；后续独立 Change 负责设计其 persistence/API、权限、历史和多 Board 集成，不能从 Column 推导状态。本 Change 不重新决定已批准的状态集合或合法转换。
- 同一 Work Item 可在多个 Board 具有不同 Column；任何一个 Column 都不是该 Work Item 的全局状态，移动只改变当前 Placement。
- Core API 继续按 Workspace/Project/Board/WorkItem 路径范围授权 OWNER。Board 删除、Work Item 保存和 Column 变化均使用乐观版本；没有后台或异步业务处理。

## Decisions

### 1. Board 使用显式 permanent-deletion 动作

新增 `POST /desktop/v1/workspaces/{workspaceId}/projects/{projectId}/boards/{boardId}/permanent-deletion`，请求体为 `expectedVersion` 与 `confirmationName`，成功返回 `204`。

选择该形式是为了与现有 Project 不可逆删除保持一致，避免依赖带 body 的 `DELETE` 在不同客户端/中间层中的兼容性，也让精确名称确认成为明确命令。曾考虑 `DELETE /boards/{boardId}?expectedVersion=...`，但它无法自然承载名称确认且与仓库既有危险操作不一致。

Core API 在事务中：重新授权 OWNER；以 Project、Board 范围锁定 Board；校验非负 version、当前 version 和精确当前名称；检查任意 Placement；删除该 Board 的 Columns；删除 Board。业务冲突固定映射为 `409`：version 过期返回 `BOARD_VERSION_CONFLICT`，名称不匹配返回 `BOARD_NAME_CONFIRMATION_MISMATCH`，存在 Placement 返回 `BOARD_NOT_EMPTY`，限制性未知依赖返回 `BOARD_DELETE_RESTRICTED`。错误范围与越权继续使用既有 not-found/authorization 语义。任何异常回滚全部写入。拥有真实 PostgreSQL 的 Project Work 集成测试负责证明锁定、删除顺序与外键行为；HTTP/OpenAPI 测试负责契约和稳定错误码。

### 2. 删除成功由 Main 协调偏好清理与确定性 home 解析

共享 Renderer 能力使用单一 `permanentlyDeleteBoard` 调用。Main client 得到明确云端 `204` 后，coordinator：

1. 将被删 Board scope 标记为 tombstone 并递增其 generation/selection intent；
2. 尽力清除 environment/User/Workspace/Project 最近 Board 偏好；
3. 重新列出 Board，并按服务端 `createdAt`、`boardId` 顺序取首个；有首个时读取其详情并记住它，无首个时返回空 home；
4. 向 Renderer 返回带当前 response key 的 `BoardHomeView`。

偏好 I/O 失败不回滚已提交的云端删除；重新解析失败则 Renderer 显示“删除已完成，但看板列表刷新失败”的可恢复状态，并通过 retry resolveHome 收敛，不能把删除报告为未发生。

若删除请求因传输或暂时错误结束且没有权威 HTTP 响应，Main 不自动重发不可逆命令，而是将该 Board scope 置于 reconciliation isolation 并重新读取权威 Board 列表：Board 已不存在时按删除成功处理，永久 tombstone、清理偏好并解析新 home；Board 仍存在时按删除失败处理，解除隔离、递增 generation 并重新读取该 Board；Board 列表也失败时返回“删除结果未知”，保持调和隔离，只允许重试调和或离开 Project，不允许继续对该未知 Board mutation。曾考虑让 Renderer 在收到 `204` 后分别 clear 与 resolve，或对未知结果自动重发删除，但前者扩大竞态并让 Renderer 承担设备偏好编排，后者可能重复执行不可逆命令。

### 3. 删除 tombstone 与操作开始时 generation 共同拒绝迟到响应

现有读取在操作开始时捕获 generation，但 mutation 在响应后递增 generation。为避免删除成功后一个旧 mutation 生成更大的“新”generation，coordinator 为 Board 操作捕获开始 token，并在返回时检查 scope 未 tombstone、未处于 reconciliation isolation 且 token 仍有资格。删除成功或调和确认 Board 缺失后，该 scope 进入永久 tombstone，旧操作只能失败或返回不可提交结果；调和确认 Board 仍存在后解除隔离并递增 generation，使隔离前的响应全部失效；权威列表读取失败时维持隔离，拒绝该 Board 的旧 read/detail/mutation 提交和新 mutation。Work Item 详情的 Renderer/Main 输入增加当前 `boardId` 作为响应作用域，但 Main HTTP client 仍只把 Workspace、Project、`workItemId` 发送到现有 GET endpoint；这样详情读取可携带 Board generation，而不把 Board 错误地变成 Work Item 所有者。

Renderer 同时递增选择/详情请求序列并只接受当前 Board key。该双层围栏覆盖 Main 内部并发和 React 生命周期竞态；Main coordinator/unit tests 与 Renderer integration tests分别验证。

### 4. 删除入口复用现有危险确认语言，但作为 Board 局部操作呈现

删除入口放在当前 Board 的明确操作菜单或设置区域，不与日常编辑按钮并列成高频动作。确认 Dialog 展示不可逆、仅空 Board 可删、Work Item 不会被删除但非空 Board 会被拒绝；只有精确输入当前名称后主按钮才可提交。pending 时禁用关闭和重复提交；脏确认文本按设计基础规则在 Escape/关闭前确认丢弃。视觉方案在 Apply 开始时先按 `frontend-design` 明确，并保持现有 Semi/设计基础语言。

曾考虑对空 Board 直接一键删除，但危险动作的误触成本与最后一个 Board 的空状态影响不适合省略精确确认。

### 5. Work Item 详情使用一个状态机、服务端确认基线和待完成意图

Card 激活先以 `workItemId` 调用已有 Work Item GET；Dialog 在 loading 成功后展示 `confirmedWorkItem` 的标题、描述与审计时间，不展示 Placement/Column 属性。Card 投影只用于定位和加载占位，不冒充读取成功。状态至少包含详情 request id、触发 Card、`confirmedWorkItem`、当前权威 Board/Placement context、active field、draft、dirty、saving、field error、save feedback 与可选 `pendingIntent`。

`pendingIntent` 只表示保存成功后应执行的字段切换或详情关闭，不是第二份草稿。脏字段真正失焦、点击关闭或激活另一字段时，reducer 先把当前 draft 固化为唯一一次保存请求，再记录最后一个仍有效的意图；保存成功后以权威响应更新基线并执行意图，validation、暂时失败或冲突时暂不执行该意图，保留草稿与仍有效的 `pendingIntent` 并停在当前字段；重试保存成功后继续执行原关闭或字段切换意图。重复 blur/click/close 事件不得为同一 draft 创建重复 mutation。Board mutation 或详情刷新导致 Card 不再存在时关闭详情并移动到安全焦点。

曾考虑复用通用 `EntityDialog` 的整表单提交和现有 dirty gate，但它们无法自然表达按字段触发、焦点边界和保存后续接意图；继续使用专用 Work Item detail 状态与纯状态转换辅助函数。

### 6. 字段类型决定提交时机，HTTP 写契约保持不变

标题在有效 draft 按 `Enter` 或焦点真正离开其交互区域时提交；描述在真正离开交互区域或按 `Ctrl/Cmd+Enter` 时提交，普通 `Enter` 保留换行。第一版不使用输入防抖保存，避免高频请求、难以解释的中间版本和额外的关闭竞态。详情状态机的 `field` 收敛为 `title | description`，删除 detail-only 的 Column 选择 action 和恢复分支。

标题或描述保存从 `confirmedWorkItem` 补齐未编辑内容，并继续传当前 Work Item version、Board、Placement 与未变化的 current/target Column 上下文；不得从打开 Card 时的旧投影拼装请求。这样既满足现有完整 PATCH 契约，也避免详情 UI 改变 Placement。Core API 的可选 Placement 变化能力和 Board 拖拽调用路径继续保留，响应仍返回 Work Item 与 Board，以一次提交更新详情和画布。

这避免新增多个 endpoint，并保留内容与 Placement 同事务语义。代价是字段级编辑不是字段级 HTTP PATCH；乐观 version 会拒绝并发变化。遇到 version/placement/Board 冲突，先获取最新 Work Item 与 Board，保留本地 draft 并在异常恢复区域呈现最新值与本地更改，提供基于最新版本重试或使用最新内容。普通暂时错误不自动读取覆盖草稿。

### 7. 焦点所有权与 Escape

标题与描述各拥有一个逻辑交互区域，包含原位输入和该字段的辅助控件。blur/focusout 后在下一次焦点稳定时检查 `relatedTarget`/当前 active element 是否仍属于该逻辑区域；属于则不提交。详情不再有 Select portal，因此删除 detail-only 的 portal ownership 和两层 Escape 分支；通用 Select 及 Board 其他入口保持不变。

Escape 语义与隐式关闭分离：标题或描述编辑态的 `Escape` 放弃尚未提交的本地草稿、恢复 `confirmedWorkItem` 并返回字段触发器；只有没有 active field 的只读详情才由 `Escape` 关闭。用户点击详情关闭按钮或外部 dismiss 时，脏字段先保存，成功后关闭，失败则保持打开；这不是 Escape 丢弃语义。IME composition 期间的 `Enter` 或组合快捷键不提交。打开详情聚焦唯一 heading 或其语义容器，不自动聚焦任一输入；进入编辑聚焦字段且尽量保持已有 scroll offset；关闭详情恢复原 Card，Card 不存在时恢复当前 Board 标题或首个主要操作。

纯状态测试负责提交去重、pending intent、Escape 和错误恢复；Renderer integration 与 Cypress component tests 负责真实焦点、键盘和最小窗口。

### 8. Focused Work Sheet 使用整体、viewport-responsive 的稳定信息架构

详情继续使用 `Inter Variable` 和现有冷矿物色板：Ink `#17201B`、Muted Moss `#66716A`、Canvas `#F5F7F4`、Paper `#FBFCFA`、Action Teal `#276C55`、Focus Blue `#1C6CC0`。不新增视觉系统。实际 Work Item 标题仍是约 `26px/700` 的唯一 Dialog heading；“描述”是始终可见的语义标签，创建/更新时间是 `11–12px` muted 审计 footer。Placement/Column 已由 Board 画布表达，详情中不再复制为属性行或 combobox。

Dialog 使用约 `760px × 480px` 的标准桌面工作面板，并以 viewport 安全边距自适应小窗口；宽度为 `min(760px, viewport safe width)`，高度为 `min(480px, viewport safe height)`。header、关闭按钮与 footer 固定，描述主体吸收剩余工作区；超长内容时中间正文成为唯一主 scroll owner。描述 read/edit 占据同一完整主体 slot，初始最小高度约 `128px`，文字原点固定在左上。标题 heading 在 header flex/grid 中占满关闭按钮左侧的剩余空间，只为真实关闭 hit target 保留约 `16px` gap，不再重复使用额外的 `padding-right` 缩短输入框。

字段由同一个 layout slot 渲染只读和编辑表面。标题进入编辑时，Dialog 的可访问名称仍由唯一的实际 Work Item 标题语义提供；不得重新引入泛化“工作项详情”heading 或第二份可见标题，visible editor 直接占据原 heading slot：

| 字段 | 只读与编辑几何 | 常驻身份 | 内容增长与反馈 |
| --- | --- | --- | --- |
| 标题 | heading button 与单行 `input` 共用字体、line-height、可用宽度、结构边框、padding 和真实文字原点；编辑显示与描述一致的 action-colored 全框边界/caret | 标题本身是唯一 heading，不在编辑时突然插入可见“标题” | 占满 close 左侧除约 16px gap 外的剩余宽度；标题始终单行，只读长值 ellipsis，编辑 input 内横向处理且无纵向滚动 |
| 描述 | preview 与 textarea 共用详情完整内容宽度、padding、line-height 和同一弹性主体 slot（最小约 `128px`）；两态文字均从左上开始 | “描述”标签在 read/edit/saving/success/error/conflict 全程存在 | textarea 明确支持多行；长正文/草稿在有上限的字段区域或主内容区滚动，不留下窄列或双滚动 |

描述身份行预留右侧反馈槽；标题反馈继续在 heading 内的非增高位置表达。saving、短暂 saved 和错误摘要不新增日常垂直行。saving 期间保留 editor 和 draft；权威成功后才换为同尺寸 reading surface。validation、暂时失败和冲突继续保留 editor、draft、`pendingIntent` 与字段 scroll，错误动作只在该字段的异常恢复区出现。模式交换后恢复可用 focus/selection，并保存和恢复主内容区/字段 scroll，避免 React 替换节点把用户弹回顶部。

只读态保持平整，不给整段文本常驻 underline、边框、阴影、浮升或 selected-card 背景；打开详情时语义焦点落在唯一 heading，但程序化聚焦不绘制静态标题焦点框，不让任一可编辑字段看起来已被选中。pointer hover 可以显露低对比局部 surface/边界，键盘 `focus-visible` 与描述编辑态显示与实际控件范围一致的 action-colored soft surface 和 focus ring；标题 read/edit 则共享预留好的全框字段空间，避免整块输入边界突然出现造成视觉抖动，并与描述编辑态保持同一 action-colored 视觉语言。所有状态均不增加浮升、阴影或整块卡片效果。动效只用于 `120–180ms` opacity/颜色反馈；`prefers-reduced-motion` 关闭非必要转换。普通 read→title edit→description edit/saving→权威成功/失败中，只要内容 footprint 未真实增长，面板、关闭按钮和 footer 的自动化几何差异阈值为每个轴不超过 `1 CSS px`；validation/conflict 的真实异常内容由有界正文滚动吸收，不使 shell 超出 viewport 或重新居中闪动。

曾考虑继续使用约 `300px` 的短面板、只给 textarea 加 `min-height` 或对高度做平滑动画。这些方案会让详情工作区局促，或把重排伪装成动效，因此拒绝。标准桌面采用约 `480px` 稳定高度，但保留 viewport-safe 收缩，避免破坏小窗口。继续拒绝 pill 堆叠、装饰渐变、整块 hover 浮升和复制其他产品外观。Apply 时遵循 `vercel-react-best-practices`，最终用最新 `web-design-guidelines`、Chromium 连续截图/录屏和当前平台真实操作验收；单张静态截图不能证明交互专业度。

### 9. 在所有当前边界中删除 lifecycle，不保留兼容占位

`project.work_items.lifecycle`、`ck_work_items__lifecycle_supported`、SQL insert/select/row mapper、Kotlin `WorkItemView`/`CardView`、运行时 OpenAPI、Desktop Zod parser、共享 TypeScript contract、Renderer 文案与 fixtures 同批删除。严格 parser 应接受新的准确 response shape，不把旧字段改成 optional、nullable 或 deprecated；仓库尚未承诺跨版本 Desktop/Core API 兼容，Core API 与 Desktop 必须同批交付。曾考虑只隐藏 UI 或保留固定字段等待未来状态功能，但两者都会把尚未实现的 Target 错误固化为当前单值占位并允许后续代码依赖，因此拒绝。

移动 Card 的 OpenAPI/规格改为“只更新当前 Board Placement”，而不是“保持 lifecycle 不变”。实现 Target 状态功能需要独立 Change，设计其 persistence/API 所有权、多 Board 集成、权限与历史，并遵守业务模型已批准的 `Open`、`Completed`、`Cancelled` 与 reopen 转换；只有另一个明确获批的业务模型变更才能修改该状态集合或合法转换。

### 10. 首次发布前直接修正 V1 基线

仓库只有 `V1__initialize_taskpilot.sql`，生产部署和支持的 released baseline 尚不存在；本地 checkout PostgreSQL/Redis 明确为可丢弃数据，并已有针对 checkout-owned loopback Flyway checksum incompatibility 的安全重建机制。因此直接从 V1 删除 lifecycle column/check constraint，不新增先创建错误字段再删除的 V2，也不运行 Flyway repair。空库 migration/catalog 测试证明新基线；现有 checkout 在首次启动时按既有 ownership 和 loopback 防护重建本地 PostgreSQL/Redis。

这不是生产迁移方案。若 Apply 前发现任何已发布或不可丢弃数据库证据，必须停止并重新批准追加 migration 与兼容策略，不能沿用基线重写。

### 11. 文档反馈随所属实现切片完成

Core API/模型切片同步更新 `docs/business-model.md`，明确 Work Item 当前实现没有状态/lifecycle、Column 只属于 Placement，同时保留已批准的 Target Work Item 状态机，并更新 V1、API/职责/测试文档。Desktop 切片同步更新无 lifecycle strict contract、详情信息架构、自动保存、职责、测试与设计基础。最终审计复核 Current 实现边界、Target 状态机与代码、SQL、OpenAPI、Desktop contracts 和测试没有漂移。根架构只有在发现跨项目边界变化时才修改；否则记录“边界未变”的代码证据，避免重复局部字段清单。

## Risks / Trade-offs

- [删除已提交但 `204` 响应丢失会让客户端无法判断结果并可能重发不可逆命令] → Main 不自动重发，隔离该 Board scope 并以权威 Board 列表调和为已删除、未删除或结果未知；coordinator 和 Renderer 测试覆盖三态及隔离。
- [明确收到 `204` 但 home 刷新失败会让用户误以为删除失败并重试] → Main 区分 mutation commit 与后续 refresh，Renderer 使用“删除已完成，但刷新失败”恢复文案；coordinator 和 Renderer 测试覆盖。
- [限制性外键或未来依赖导致部分删除] → 单事务、先校验 Placement、显式 Columns→Board 顺序，并保留 `ON DELETE RESTRICT`；PostgreSQL 集成测试覆盖回滚。
- [旧 Board 请求在删除后返回并生成更高 generation] → tombstone 加操作开始 token，不只依赖完成时递增；Main 并发单元测试和 Renderer 迟到响应测试覆盖。
- [全量 Work Item PATCH 覆盖并发字段更新] → 只从最新服务端确认基线构造，始终携带 version，冲突后在异常区显式重试或使用最新内容；Core API 并发测试与详情状态测试覆盖。
- [Column 拖拽与字段保存同时发生] → 当前 Board/Placement version 与 currentColumn 校验使整次保存失败并重载，不允许部分内容写入；Core API 事务测试覆盖。
- [blur 与点击切换/关闭连续触发导致重复保存或错误关闭] → 单一保存快照、pending intent 和请求期去重；纯状态与 Renderer tests 覆盖事件顺序。
- [详情 Column/Select 分支残留导致死状态或不可达恢复] → reducer field union、Renderer、i18n 和测试一起收敛为 title/description；source search 与 focused tests 覆盖。
- [字段编辑与 Dialog 导致焦点丢失或 Escape 语义混乱] → Escape 由字段/详情依次拥有，字段 Escape 恢复确认值，关闭按钮/外部 dismiss 走先保存；真实浏览器组件测试和手工键盘检查覆盖。
- [隐式保存失败后用户误以为内容已保存] → 成功状态只在权威响应后出现，失败保留 draft、阻止待完成意图并显示字段内恢复动作；状态测试覆盖。
- [读写 DOM 尺寸不同使 Dialog 在点击和保存时重排/重新居中] → viewport-adaptive 稳定 shell、等占位 slot 和每轴 `≤1 CSS px` transition geometry assertions；Cypress 连续状态测量而非只测最终截图。
- [常驻标签或反馈在状态切换中消失/推移正文] → 字段身份行不随模式卸载，右侧反馈槽原位替换；Renderer 语义断言与浏览器几何断言覆盖 read/edit/saving/success/error/conflict。
- [长内容、合法草稿增长或节点交换造成双滚动和 scroll jump] → 单一主内容 scroll owner，描述字段仅在约束后拥有内部滚动，切换前后保存/恢复 scroll；长内容、快速切换与慢网络浏览器测试覆盖。
- [中文 IME 的 Enter 被当成保存] → composition guard；Renderer 与 Chromium composition event 用例覆盖。
- [详情只读字段看起来不可编辑或信息架构割裂] → 使用局部 affordance 和统一的标题→全宽描述→审计 footer 层级，在连续截图/录屏中验证中英长文本、键盘与 reduced motion。
- [只删 UI 会让固定 lifecycle 继续污染数据库和契约] → 以 catalog、OpenAPI exact-property、Desktop strict parser 与 source search 四个边界共同证明端到端删除。
- [重写 V1 会使已有本地 Flyway checksum 不兼容并丢失开发数据] → 仅依赖 checkout-owned loopback disposable-data 重建机制，不 repair、不触及外部数据库；Apply 前再次核对无 released baseline。
- [用户把 Column 当成 Work Item 全局状态] → 详情不展示 Column 属性，Board 画布继续表达位置，多 Board 场景证明各 Placement 独立。
- [确认名称存在 Unicode 或空白歧义] → 与现有已规范化并持久化的 Board 当前名称做精确字符串比较，不在删除时再次宽松规范化；API 集成测试覆盖相似但不相等名称。

## Migration Plan

1. 先修改 Core API migration/catalog 测试和 OpenAPI exact-property 断言，使其要求 Work Item 表及 Work Item/Card response 均不存在 lifecycle/status；再修正 V1、Kotlin view、SQL 与运行时契约并运行 focused/quality gate。
2. 同批修改 Desktop strict parser、shared contract、fixtures 和 Main/Preload/Renderer 消费点；新旧 response shape 不并行兼容，避免 optional 占位继续扩散。
3. 按 `frontend-design` 已确认的 Focused Work Sheet 修订 Renderer：先用浏览器几何测试锁定 read/edit/saving/result 序列，再实现 content-adaptive 稳定 shell、占满可用宽度的单行标题、全宽多行描述、无 Placement/Column 属性行、审计 footer 与身份行反馈；保留既有隐式保存状态机、原子请求、`pendingIntent` 与异常恢复语义。
4. 更新 owning docs，串行运行 Desktop focused、浏览器、quality 和 system gates，再执行 source search 与模型/文档漂移审计；只有本轮 diff 或回归调查触及 Core API/数据库/API owner 时才重跑 PostgreSQL catalog、HTTP/OpenAPI 和 Core API full gate，历史通过结果不得冒充本轮执行。
5. checkout-owned loopback 本地数据库遇到 V1 checksum incompatibility 时，由现有 dev recovery 在验证 ownership 后重建 PostgreSQL 并清理配套 Redis；明确接受本地测试数据丢失。不得对外部或未知数据库运行该恢复。
6. 回滚未发布代码可恢复先前 checkout 并重建其 disposable 数据；已删除 Board 无法恢复。若发现 released baseline 或不可丢弃数据库，停止 Apply 并重新设计追加 migration、双版本契约与 rollout，不能把本计划当作生产回滚策略。
