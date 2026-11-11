# Design

## Context

动机与产品范围见 [proposal.md](proposal.md)。本设计已获批准并完成 Apply，实现与执行证据见 [test-plan.md](test-plan.md#execution-results)。用户于 2026-11-11 明确授权归档和提交，delta 已同步到主规格，Change 已归档；授权与最终文档核对见 [归档记录](test-plan.md#archive-and-documentation-audit)。未将归档授权当成未提供的独立评审／人工验收执行结果。已使用 `frontend-design` 分析用户参考图，并核对 Desktop 已有矿物浅色／深青色方向。

Apply 前基线 `1cfaa489b09a916aff53deb48d61e1172531b61e` 的 `board-workspace.tsx` 将 Project 上下文、Board tabs／操作和 `BoardCanvas` 组合为工作区；创建由 `EntityDialog` 处理，详情由独立 feature 处理。基线 `board.css` 使用 25px Project heading、272px 列、110px 等高 Card、12px 标题／11px 两行描述和右上角绝对定位头像。`detail.css` 还拥有 Board 的小窗口宽度覆盖与 reduced-motion 规则，必须一起核对 cascade。Apply 前主规格 `project-work-items` 的固定等高与旧头像位置约束已通过本 Change 的完整 MODIFIED requirement 修订并同步；现有生产 recipe 已按下述决定更新。

基线拖拽预览已经从源 Card `getBoundingClientRect()` 取得宽高；目标 anchor 已依据目标 Card 的实际中线计算。两个 `board-drop-slot` 出口的 CSS 110px 固定高度耦合已在 Apply 中改为同一 canvas-local 实测源高。沿用既有 FLIP、response fencing、mutation owner 与权威回滚。

## Goals / Non-Goals

**Goals:**
- 在现有 Renderer feature 内实现一个连续、清晰、可读的看板工作区，并把决定落实到可测试的布局 recipe。
- 将卡片尺寸变化限定为一行／两行标题差异，使拖拽可靠且责任人更新不造成无意义跳动。
- 使用现有 Preload stub 与真实 Chromium 提供低成本、可重复的验收证据。

**Non-Goals:**
- 不抽象全局表单框架、共享业务状态层、独立看板包或新服务。
- 不修改 `EntityDialog`、详情 feature、全局侧栏、原生窗口控制或产品字段；不新增业务导航与 API 调用。
- 不把参考图中的彩色状态、编号、优先级和未来执行入口投影为已有能力。

## Business Model

采用场景／关系核对，模型结论见 [proposal.md](proposal.md#business-model-impact) 与 [Board Semantics](../../../../docs/business-model.md#board-semantics)。无新对象、状态、引用、权限或持久化不变量。可变 Card 高度属于瞬时 UI 几何；其 owner 是 `BoardCanvas`，不写入 Placement，不参与 ID、version 或移动载荷。

具体边界：Card A 出现在 Board X、Y 时，X 中的拖拽只提交 X 的位置；头像使用返回的 Work Item assignee，未分配不以 createdBy 补齐；长文只被预览裁切；移动冲突采用已有权威恢复，不把临时槽当成已保存位置。

已发现 `project-boards` 的旧键盘移动段落仍提及详情“所在列表”，而较新的 `project-work-items` 与当前 detail 明确禁止该行。这是既有规格漂移，本轮不修改该 requirement，也不以新增详情移动控件解决它；本轮只保留实际已有的键盘 Board 切换、Card 激活与列操作，并验证变化的画布不妨碍它们。需在后续明确授权的规格整理／移动可访问性议题中解决旧段落，不作为本轮实现任务。

## Decisions

### D1. 局部连续布局与既有品牌

复用当前 `apps/desktop/src/renderer/styles/tokens.css` 中的 `--paper`、`--canvas`、`--ink`、`--muted`、`--line`、`--action`；当前值依次为 `#FBFCFA`、`#F5F7F4`、`#17201B`、`#66716A`、`#D9E0DA`、`#276C55`。代码是当前值的来源，本轮不改全局 token，也不把 design foundation 的 Target 色值当作已实现配色。Inter 与平台中文 fallback 保持不变；新增尺寸变量只在 `.board-surface` 作用域内。所有列采用同一中性浅底色，不根据名称或序号映射状态色。

Project 上下文使用 20px／28px heading，普通内容下 header 最小约 48px；Project 描述保留但只显示一行预览，完整值由可访问名称／tooltip 和现有设置页获取。Board tabs／操作区使用约 44px 控件行，内容边缘对齐到 20px gutter。长 Project 名称允许必要换行，不为了固定高度裁掉唯一可见身份；长 tabs 在自身区域横向滚动，操作区保持可达。不新增截图中的全局 New Issue 按钮，沿用明确目标 Column 的创建入口。

Column 以完整可用画布高度呈现浅色区域，弱化静态外边框，无常驻列阴影；列间距 12px，推荐列宽 288px，各窗口保持可读宽度并横向滚动。标题、数量、列操作横向对齐；列内卡片区域纵向滚动，底部添加入口在列可用区域内固定可达。图标操作实际目标至少 32×32px。现有所有列操作保留，hover-only 的视觉隐藏不能阻断键盘 focus-within。

替代方案：整列去掉一切分组底色会削弱参考图的连续分组感；每列不同业务色会引入未定义语义；重做侧栏会扩展到独立导航议题。选用局部浅色 recipe。

### D2. 有界内容 Card

Card 维持单一可激活 button，整个内容可点击；头像不是新按钮，也不在卡片上新增编辑入口。结构顺序为标题、描述摘要、底部责任区。左右／上下内边距 12px、区间距 8px、Card 间距 8px、圆角 8px、轻边框；静态 Card 不加浮动阴影，hover 用轻底色／边界变化，移除常规 `translateY`。

标题 14px／20px、weight 600，最多两行且实际占一行或两行；描述 12px／18px，只预览一行，内部换行在预览中折叠，原始字符串保留；摘要预留 18px 行槽，底部责任区预留 24px，以保证分配／清空、空／非空描述不改变同标题 Card 高度。只有权威已分配责任人显示 24px 头像，底部左对齐；名字保留在 Card 的可访问名称与头像 tooltip。计入边框后普通一行／两行标题 Card 约 104／124px，这些是 recipe 估算而非跨平台逐像素合同。

替代方案：沿用 110px 等高会限制标题层级并要求无条件预留两行；完全自由高度会让全文描述破坏扫读与拖拽；按是否分配动态插入 footer 会导致无关的高度跳动。选用只随有界标题变化的局部几何。

### D3. 拖拽仅适配实际几何

拖起时在隐藏源 Card 前读取一次宽高，以本次 drag 的瞬时 state／ref 保留尺寸，设置在 `BoardCanvas` 的局部 CSS 自定义属性或占位槽 style 上。两个占位出口使用同一尺寸；clone preview 继续使用已有实测值，无需新 DnD 依赖。保持唯一槽、真实目标中线与现有 `beforeWorkItemId` 算法；不按卡片序号乘固定高度。

`clearDragState`、drop／dragend、卸载应清理尺寸与临时状态。优先采用已有 DOM 测量 seam，不新增 ResizeObserver 或每帧全量测量；已有 FLIP 仅在目标改变时执行。减少目标列 elevation／空间偏移，保留 outline 与插入槽作为非仅颜色提示。已有 reduced-motion 选择器同步覆盖改后的 recipe。

替代方案：只改 CSS 后继续用 110px 槽会令源位置与插入反馈失真；重写 drag owner 会引入与本轮无关的回归。选择只消除固定高度耦合。

### D4. 验证与文档反馈

验证边界由 [Desktop testing strategy](../../../../apps/desktop/docs/testing-strategy.md) 拥有。Renderer tests 覆盖呈现内容、可访问名称、原调用载荷和拖拽清理；真实 Chromium 覆盖布局、目标命中、不同高度槽、滚动、focus 与截图。保留详情相关测试，防止调整 `detail.css` 的 Board 段落污染独立面板。实现 React 修改时使用 `vercel-react-best-practices`，最终使用 `web-design-guidelines` 并做当前宿主 packaged Electron 视觉检查。

本轮以 CSS／呈现为主，不制造业务 Red/Green 测试；新增覆盖实际风险的几何与拖拽回归场景，旧固定等高／右上角头像断言按新合同替换。修改生产布局前先以同一五列 fixture 保留三尺寸中英文旧版截图；改造后在同一浏览器、viewport、缩放、数据顺序和起始滚动位置重拍，记录顶部占用、实际列宽、可见 Card 数与标题可读性，供整体密度对照，不将 Card 数单独作为审美通过标准。

reduced-motion 的浏览器证据参照现有 `apps/desktop/cypress/component/select.cy.tsx`，通过 `Cypress.automation('remote:debugger:protocol', ...)` 调用 `Emulation.setEmulatedMedia` 设置 `prefers-reduced-motion: reduce`，使 JavaScript 查询与 CSS 媒体规则同时生效；不以 stub `matchMedia` 替代 CSS 验证。用 computed style 检查 Column／Card 的非必要 transition、仍存在的列伪元素／操作区 transition、占位槽 reveal 与 settling animation 已移除，同时检查 FLIP 的 `Element.animate()` 未调用、实际高度槽与目标提示仍可见、移动载荷和权威结果正确。使用 `afterEach` 清理 hook 将 `features` 重置为空数组，测试断言失败时也不能泄漏媒体仿真到后续用例。文档随布局／拖拽切片更新，末尾核对 owner 和 main-spec delta，具体命令与证据见 test-plan。

## Risks / Trade-offs

- [参考图宽屏导致错误密度预期] → `960×640`、`1280×800`、`1600×900` 下使用五列真实中英文内容比较；不要求最小窗口同时完整显示五列。
- [Card 高度变化导致插入槽跳动] → Chromium 检查源高／槽高匹配和上下半区命中；Renderer 保留 anchor／mutation 场景。
- [旧 CSS 覆盖使最小窗口或 reduced-motion 回退] → 同时核对 `board.css` 与 `detail.css`，验证 computed style、滚动和焦点可达。
- [头像移到底部被误解为交互入口或创建人] → 维持纯展示、权威 assignee、可访问名称与未分配无头像；回归详情分配失败。
- [跨平台字体造成标题行数差异] → 行数受控但高度以实际值为准；当前宿主检查与 Windows／macOS 发布验收分别记录，不混用证据。
- [为紧凑强行截断 Project 身份] → 长名称可换行，完整值可访问，工具栏局部滚动；短内容的紧凑高度不是长名称的硬上限。

## Migration Plan

无数据、API 或依赖迁移。按布局／Card、拖拽适配两个相邻实现切片交付，文档在各切片内同步；focused 与 Desktop gate 及后续 P2 修复验证通过。恢复此前 Renderer 代码与对应文档即可回退，无需服务端操作。用户后续明确授权了 spec sync／archive 和 Git 提交；独立评审、人工验收及平台发布结果按实际证据记录，不由归档推定。
