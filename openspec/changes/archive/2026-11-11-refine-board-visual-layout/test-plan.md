# Test Plan

## Scope and Risk

范围是 Desktop Renderer 的看板布局、Card 呈现及其瞬时拖拽尺寸。风险等级为中等 UI／可靠性风险：错误可导致看不清任务、主要操作或焦点被裁切、拖拽插错位置，或误把未确认责任人显示为成功。无新业务对象、生命周期、授权、数据写入、API 或跨项目契约；既有 version、scope、响应隔离、创建幂等与隐式保存规则是回归边界。

依据根 [architecture](../../../../docs/architecture.md#cross-project-testing-boundaries) 和 [Desktop testing strategy](../../../../apps/desktop/docs/testing-strategy.md)，几何证据归 Chromium／当前宿主 Electron，语义与调用载荷归 Renderer／Main 既有测试。本轮不新建数据库、后端集成或全链路系统测试，也不借验收新增快速创建、详情移动字段、侧边面板或业务状态。下述场景映射保留已批准的验证计划；Apply 实际结果与尚未完成的人工／平台证据分别记录在 [Execution Results](#execution-results)。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| 看板连续布局／普通多列／长名称与中英文 | Chromium component＋视觉验收 | 修改生产布局前保留同一五列 fixture 的旧版截图，改造后在同一浏览器、viewport、缩放、数据顺序与起始滚动位置重拍；中文／英文各覆盖 960×640、1280×800、1600×900，记录顶部占用、实际列宽和可见 Card 数并对照标题可读性／留白；Card 与工具栏左右对齐，长名称无重叠且完整值可访问 | jsdom 无真实字体、尺寸与溢出能力；相同内容的前后对照判断整体感，避免仅凭新截图或数量判断密度 |
| 最小窗口横向浏览／键盘焦点／列内创建 | Chromium component | 页面宽度不超过 viewport；画布横向滚动、长列纵向滚动；Tab／箭头切换 Board、打开 Card、关闭返回焦点；末列添加入口和工具栏操作可达 | 检测真实滚动容器、目标尺寸、focus clipping 与本机浏览器命中 |
| 空列、加载、错误与重试 | Renderer component，Chromium spot check | 复用真实组件和 Preload stub，断言错误不变空态，既有 retry／创建入口继续存在，loading 不显示伪造数据 | 语义与状态最低可靠层为 Renderer；仅检查调整后的可见性几何 |
| Card 内容层级／受控高度／长文不改写 | Chromium component＋Renderer | 一／两行标题、空／非空及多行描述、历史超长文本、无空格英文与中文 fixture；标题最多两行、摘要一行；同标题的摘要／分配变化不改变外部高度（同一环境容差 1px）；权威 detail 仍收到原文 | Chromium 检测实际裁切与高度，Renderer 检测权威字符串未被预览逻辑修改 |
| 责任人设置／替换／清空与分配变化不挤压标题 | Renderer integration＋Chromium | 原有 set／clear 测试继续使用权威响应；底部头像可访问名称正确，未分配无头像，标题宽度和摘要位置不移动 | 检测引用语义与 UI 更新；头像位置、正文几何需要 Chromium |
| 保留详情展示／保存前打开选择器／保存失败／选择器可访问 | 既有 Renderer、detail reducer 与 Chromium 回归 | 继续运行标题 heading、creator/footer、save-before-picker、失败保留草稿、键盘 set／clear 和详情稳定几何测试，不新增详情字段或控件 | 共享样式 cascade 可能影响 detail；复用既有证据，不重写业务测试 |
| 不同高度间上下半区插入／列内排序 | Renderer drag seam＋真实 Chromium | Renderer 以确定 DOMRect 断言正确 anchor；浏览器用同列高低不同 Card 检查源高与唯一槽高匹配（容差 1px）、上下半区位置及权威结果 | 确定性 seam 检测 anchor 语义，真实浏览器检测布局让位与 drag 实际命中 |
| 跨列末尾／空列、成功、取消、失败与清理 | Renderer＋Chromium | 沿用 API stub 检查目标 Column／可选 anchor／版本载荷；至少一条真实 Chromium mouse drag；空列／末尾单槽；取消无 mutation，失败有公告／reload；dragend／卸载清理 | Renderer 检测副作用边界；浏览器检测原生 drag 与实际槽几何 |
| reduced-motion | Chromium component，真实浏览器媒体偏好仿真 | 参考 `select.cy.tsx`，挂载前使用 `Emulation.setEmulatedMedia` 设置 `prefers-reduced-motion: reduce`，断言真实 `matchMedia` 匹配；Column／Card 及仍存在的列伪元素／操作区的 computed transition duration 均为零，占位槽 reveal 与 `.is-settling` 的 computed animation name 为 `none`，FLIP 的 `Element.animate()` 未调用；实际高度槽和目标提示仍可见，移动提交与权威结果正确；`afterEach` 重置 `features: []`，断言失败也执行清理 | CDP 仿真同时覆盖 CSS `@media` 与 JavaScript；只 stub `matchMedia` 不能检测遗漏或被覆盖的 CSS reduced-motion 规则 |
| 模型、scope、version、迟到响应和跨 Board 独立性不漂移 | source／diff 自审＋既有 Renderer／Main suites | 保持 workItemId、原请求和 mutation owner；既有冲突／迟到响应、project work coordinator 和 IPC 校验通过；无 Main、Preload、canonical API、schema、migration 改动 | 边界没有新实现，不重复创建授权或数据库用例；保留相关现有回归证据 |
| owner 文档与规格反馈 | 文档／diff 自审＋官方 schema／spec validation | design foundation／child docs 去除实施后失效的固定等高与右上角头像描述；根文档无变化理由；主 specs 保持待显式 sync | 结构检查不能替代语义审计，两者分别记录 |

## Implementation and Verification Approach

### Slice 1: 看板布局与 Card 层级

在修改生产布局前，先使用现有 Cypress harness 和约定的五列真实内容 fixture 保留三尺寸中英文旧版截图与几何摘要；允许为 baseline 补齐同一测试数据，但不提前改生产呈现。使用 `frontend-design` 的既定方向直接调整局部 JSX／CSS，并在改变 React 时使用 `vercel-react-best-practices`。在相同切片更新旧 Card 等高／右上角断言为新的真实内容几何与可访问性场景，保留详情和创建行为断言；按相同环境与数据重拍后进行密度对照，更新 design foundation 与 delegated child 说明。此切片属于呈现改造，不制造业务 Red/Green；Chromium 截图与可达性检查是主要证据。未完成 Slice 2 前不得交付可变高度 Card，因为旧固定占位仍有耦合。

### Slice 2: 拖拽实际尺寸与回归

仅把源尺寸接入两个占位出口，保留现有 anchor 和移动 owner。与生产修改一起添加高／低 Card 的确定性落点和唯一槽／清理用例，运行真实 Chromium drag、空列、末尾、取消、冲突／暂时失败。reduced-motion 用例挂载前通过 `Cypress.automation('remote:debugger:protocol', ...)` 调用 `Emulation.setEmulatedMedia`，参数为 `features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]`；不替换该浏览器用例的 `matchMedia`。除 JS FLIP spy 外，在拖起／占位和落位的实际状态断言 computed transition／animation，检查槽与结构性目标反馈、原移动载荷及权威成功结果；清理放在 `afterEach` hook，以 `features: []` 重置，即使断言失败也执行。同步 local responsibilities／architecture／testing strategy 中直接受影响说明。两个切片组成一个完整交付，不独立发布中间不一致状态。

### Slice 3: 集成验证与自审交接

完成下列 focused 与 affected gates，使用 `web-design-guidelines` 审核实现的 UI／UX／accessibility。实际 diff 对照每个 delta scenario、调用载荷与 owner 文档，记录任何未执行平台证据和无根模型／架构更新理由。独立代码评审和人工验收由用户安排；本轮任务完成不会触发 spec sync 或 archive。

## Verification Commands

以下命令均从仓库根运行。Focused 通过后执行一次 affected gate；只有新修改或失败需要重复。

### Focused

- `pnpm --filter @taskpilot/desktop exec vitest run --config vitest.config.ts tests/renderer/features/board/project-board.test.tsx tests/renderer/features/detail/work-item-detail-state.test.ts`：受影响 Renderer 和详情状态回归。
- `pnpm --filter @taskpilot/desktop exec cypress run --component --browser chrome --spec cypress/component/board.cy.tsx --config video=true`：局部真实 Chromium 几何／drag／详情回归，并保留截图与视频；若当前宿主缺 Chrome，则明确使用已安装的另一 Chromium 浏览器并记录实际执行命令，不跳过原生 drag 证据。
- `pnpm exec openspec validate refine-board-visual-layout --strict --no-interactive`：delta 与规划结构。

### Affected and Cross-Boundary

- `pnpm desktop:quality`：已有 qualityCheck 包含 strict typecheck、lint、Renderer／Main／architecture suites、coverage 和 build；其中既有 IPC／project work tests 保护不变边界。
- `pnpm --filter @taskpilot/desktop test:e2e`：现有 Chromium component suite，覆盖全局样式可能影响的 shell／auth 与其他 UI。
- `pnpm --filter @taskpilot/desktop test:packaged-native`：按现有 Desktop portable gate 生成当前宿主包并执行 native credential smoke；不把该结果当成已启动 Electron 的视觉证据。
- `pnpm exec openspec schema validate taskpilot-sdd --verbose` 与 `pnpm exec openspec validate --all --strict --no-interactive`：官方项目 schema、active Changes 与 main specs 验证。
- `git diff --check`：最终 diff 空白检查；源代码自审核对本轮没有未授权的功能、主规格 sync 或边界改动。

本轮无 canonical contract、数据库或远端协议变化，不新增对应跨项目执行；若实际实现需要这些改动，先回到规划范围决策，不能默默扩大本 Change。

## Manual Evidence and Automation Gaps

- 用户／产品验收人：对同一真实中英文任务 fixture 的三尺寸改造前／后截图评估“干净、整体、紧凑而可读”，结合顶部占用、实际列宽、可见 Card 数、标题可读性和留白与参考原则对照；Card 数不作为单独通过标准，该审美判断不能由高度断言替代。结果在交接中记录，不伪造 approval。
- 实施 Agent 在当前宿主 packaged Electron 中查看列滚动、Card 字体、菜单和焦点，使用已有开发／测试数据，不更改真实业务记录；原生 app 的字体渲染与窗口 chrome 无法由 component 浏览器替代。截图注明系统与窗口尺寸。
- macOS 与 Windows 的 release-native 检查各由对应平台发布验收人负责；未运行的平台明确标为未验证，不因另一宿主通过而宣称完成该平台验收。
- 上述人工接受、独立评审与平台发布证据均不写成 tasks.md 完成勾选项；任务仅追踪实现、自动化验证、文档与自审。归档仍等待单独明确授权。

## Execution Results

### Automated and Native Evidence

Apply 验证基线为 `1cfaa489b09a916aff53deb48d61e1172531b61e`，当时目标为其上的未提交实现 diff 与 active Change。以下为实际执行结果；独立代码评审和人工接受结果未被提供。用户后续归档／提交授权及规格同步另见 [归档记录](#archive-and-documentation-audit)。

| Check | Actual Result | Evidence |
| --- | --- | --- |
| Focused Renderer／detail reducer | 89／89 通过 | `/tmp/taskpilot-board-focused-vitest.log`；执行上列 Focused Vitest 命令 |
| Focused Chromium Board | P2 修复后 Chrome 147.0.7727.56，59／59 通过，保留 video | `/tmp/taskpilot-board-focused-cypress.log`；`env -u ELECTRON_RUN_AS_NODE pnpm --filter @taskpilot/desktop exec cypress run --component --browser chrome --spec cypress/component/board.cy.tsx --config video=true` |
| Desktop component regression | P2 修复后默认 headless Electron，日志报告 Chromium 146；80／80 通过，auth 11、Board 59、Select 4、shell 6 | `/tmp/taskpilot-board-all-cypress.log`；`env -u ELECTRON_RUN_AS_NODE pnpm --filter @taskpilot/desktop test:e2e` |
| Desktop quality | strict typecheck、lint、Main 168／Renderer 184／architecture 10，coverage run 362／362，以及 Renderer／Preload／Main build 通过 | `/tmp/taskpilot-board-quality.log`；`pnpm desktop:quality`。最终 Cypress helper 与 root 清理仅改测试，另行通过 ESLint 与 Renderer TypeScript，不重新改变 production 或 build |
| Packaged native credential | macOS arm64 包构建及 write／fresh-process-restore／rotate／delete 通过 | `/tmp/taskpilot-board-packaged-native.log`；`pnpm --filter @taskpilot/desktop test:packaged-native`。无 Developer ID 签名，不作为 release 认证 |
| Packaged Renderer native presentation | macOS arm64、匹配 Electron 44.4.5，三尺寸完整 App 无页面溢出；真实 216px sidebar、5 列／15 Card；960×640 可见且获得焦点的原生窗口中，可信 CDP Enter 打开创建弹窗／Board 菜单、焦点进入且内容在 viewport 内，Escape 返回各 trigger | `/tmp/taskpilot-board-native-visual.log`、`/tmp/taskpilot-board-layout/native/report.json` 与同目录 `packaged-renderer-*.png`；`env -u ELECTRON_RUN_AS_NODE pnpm --filter @taskpilot/desktop exec electron /tmp/taskpilot-board-native-smoke.cjs` |
| Official OpenSpec validation | `taskpilot-sdd` schema 通过；全部 active Changes／main specs strict validation 14／14 通过 | `pnpm exec openspec schema validate taskpilot-sdd --verbose`；`pnpm exec openspec validate --all --strict --no-interactive` |

原生呈现 harness 从当前包的 `app.asar/dist/renderer/index.html` 加载实际 Renderer，使用独立 `/tmp` profile、contextIsolation／sandbox 和测试专用 Preload，拒绝 mutation，不改真实业务记录。这证明当前宿主字体、布局、菜单和焦点呈现；不代表 production Main／Preload／Gateway／Core API 的完整旅程，也不代表用户审美接受或 Windows 发布验收。先前隐藏窗口的 `sendInputEvent` 探针未能激活按钮；最终可见窗口的可信 CDP 键盘检查已通过并取代该探针。

Cypress 16 采集使用 `--expose captureOnly=true,BOARD_LAYOUT_CAPTURE=baseline|candidate`，不是已移除的 `Cypress.env`。headless 浏览器启动窗口为 1920×1080，使 1600px AUT 截图不被外层 runner 裁切。早期键盘失败经 AUT 原生焦点与可信 Enter 修正；后续 900px 页面高度失败来自采集写在复用 `[data-cy-root]` 上的内联高度，已在 `afterEach` 清理。最终保留原 viewport 溢出、真实键盘激活、焦点恢复和媒体查询断言，Chrome 与 Electron 全通过。最后的测试修正通过 `pnpm --filter @taskpilot/desktop exec eslint cypress/component/board.cy.tsx`、`pnpm --filter @taskpilot/desktop exec tsc -p tsconfig.json --noEmit` 和 `git diff --check`。

### Keyboard Regression Repair

后续只读自审发现 P2 验证缺口：原六个多 Column 布局用例只有一个 Board，未兑现本计划中真实浏览器的多 Board tabs 键盘／局部滚动验证，也未用真实 Enter 激活 Card。此前 57／57 与 78／78 是原用例结果，不能证明这些缺失场景。用户授权修复后，在同一 active Change 补齐了两个中英文 `960×640` 场景，并重新核对完成状态。

- 使用真实 `ProjectHome`、现有 sidebar、五个不同长名称 Board 和真实内容列，先断言 tabs 的 `scrollWidth > clientWidth`；可信 CDP Tab 从 Project 设置进入当前 tab，再用 ArrowRight／End／ArrowLeft／Home 切换。断言每次权威 Board 请求、唯一 `aria-selected`、roving tabindex、实际焦点、`:focus-visible`／outline 和 tab 边界；末项使局部 `scrollLeft > 0`，Home 返回起点，轨道不覆盖操作区。
- 从当前 tab 沿真实 Tab 顺序到达长 Column 的最后一张 Card；不在每次按键前重新聚焦。验证列自动滚动、Card 在实际可见边界内，可信 Enter 产生浏览器原生 `detail: 0` click 并请求正确 Work Item 详情；Escape 关闭后返回同 Card，且未调用编辑／移动 mutation，页面不溢出。
- 新场景暴露了测试 helper 把 Windows 键码同时填入 OS 专用 `nativeVirtualKeyCode` 的问题，英文首个 Tab 可复现 `Unidentified`，并影响后续原 Enter 场景；失败日志保留于 `/tmp/taskpilot-board-keyboard-first-run.log` 与 `taskpilot-board-keyboard-second-run.log`。已从 Tab、Enter 与导航 helper 移除该错误字段，保留 CDP 的 `key`／`code`／标准 `windowsVirtualKeyCode`，让 Chromium 处理平台原生表示。保留精确按键值、`isTrusted`、目标和几何断言，不靠降低断言或重试将失败计为通过。

修复后 Chrome 59／59 和完整 Electron 80／80 通过，ESLint／Renderer TypeScript 通过。此次仅修改 Cypress 测试及验证文档／任务记录；生产 JSX／CSS、业务和架构契约没有新改动，因此原 Apply 的 Focused Vitest、quality／coverage／build 与 packaged 证据继续适用，本次未重复执行这些不受影响的 gate。P2 修复自审核对了可信按键、无额外 refocus、真实 overflow／权威请求／关闭焦点断言和文档结论，没有剩余范围内问题。

### Paired Layout and Coverage

在生产布局修改前保存旧版三尺寸中英文 fixture。配对记录均为相同 Chrome 147.0.7727.56、DPR 1、viewport、5 列／15 Card 顺序和零起始横／纵滚动；六张 baseline 与六张 candidate PNG 均为约定尺寸。旧版证据保留于 `/tmp/taskpilot-board-layout/baseline/`，最终 Chrome candidate 固定保留于 `/tmp/taskpilot-board-layout/candidate-chrome/*.json` 与 `candidate-chrome/screenshots/`，避免完整 Electron suite 覆写默认截图目录后混用浏览器结果。

| Viewport | Top Occupied, Before → After | Fully Visible Cards, Before → After | Implemented Column Width |
| --- | --- | --- | --- |
| 960×640 | 156.89 → 114px | 6 → 8 | 288px |
| 1280×800 | 156.89 → 114px | 9 → 9 | 288px |
| 1600×900 | 156.89 → 114px | 12 → 12 | 288px |

两种界面的结果相同。此表是 BoardWorkspace 同内容配对，不把不含 sidebar 的局部 capture 当作完整 App 宽度。完整 App 可用性由单独 ProjectHome Chromium 场景与 packaged Renderer 证据覆盖。实际 Card 为 104／124px，标题为 20／40px；标题字号从 12px 增为 14px，摘要单行、底部责任槽稳定，较长无空格英文可断行，完整值保留在可访问名称／权威详情。更少顶部留白和中性整列提高连续感，但 Card 数量及本 Agent 的截图观察不替代用户的整体观感验收。

整体 coverage 从基线 90.23% lines／78.73% branches 到候选 90.74%／78.89%，没有下降；结果分别位于 `/tmp/taskpilot-board-baseline-coverage/coverage-summary.json` 与 `apps/desktop/coverage/coverage-summary.json`。按实际 diff 与 Cobertura 可测执行行交集，11／11 changed executable lines 命中（100%）；无 changed branch records，分支增量为不适用。此指标不声称 CSS／所有 JSX 行已由 coverage 仪器计入，真实几何仍由 Chromium 验证。

### UI Self-review and Model Feedback

使用 `frontend-design` 的 D1／D2 方向、`vercel-react-best-practices` 的适用 React 规则完成实现，并按最新 [web-design-guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) 自审。自审范围为 Board JSX／局部 CSS、相关 detail cascade、Cypress 配置／受影响测试与四份 child owner 文档；Main／Preload、创建／详情编辑流程、全局导航重设计和后端在范围外。未发现本 Change 引入的阻断项。

- 原生 button、完整 Card 可访问名称、Column 32×32px 操作与 focus-within 保留；Board 切换、创建弹窗与 Card 详情、列操作、焦点返回和横／纵滚动经浏览器回归。局部 `focus-visible` outline 在裁切容器中使用内侧 offset，窗口缩小时操作仍可到达。
- 当前 token 计算的对比度：muted／paper 4.93:1，muted／canvas 4.71:1，ink／paper 16.21:1，white／action 6.25:1，focus／paper 5.16:1；全局配色没有改动。
- reduced-motion 经真实 `Emulation.setEmulatedMedia` 同时覆盖 JS 和 CSS：Column／Card／操作区及伪元素 transition 为零、slot／settling animation 为 `none`、FLIP 未调用；槽和结构性目标标记仍可见，原载荷与权威移动结果正确；hook 用 `features: []` 重置。
- 实测发生在 drag start，单次尺寸供 clone preview 与 canvas-local `--board-drag-height` 使用；两个槽共享源高并填满同宽列的内容区，没有新每帧测量、observer、DnD 依赖或布局 state owner。现有 API 载荷、actual midpoint／anchor、scope／version、响应 fencing 和失败恢复保留。

已对照全部 17 个 delta scenarios、实际 diff、权威 assignee／Placement 语义与回归证据。Card 仍为同一 `workItemId` 的投影，Column 不成为全局 status；无 schema／migration、API、数据库、授权或跨项目边界变化。仅调整 Renderer 呈现与瞬时几何，因此根 `docs/business-model.md`／`docs/architecture.md` 无需更新。四份 Desktop owner 文档反馈本 slice 的 Current recipe、测量／验证责任和证据；编辑统一及其他未实现能力保持 Target。没有新增／移动／更换工程文档 ownership，documentation map 无需修改。

保留规划阶段已标明的既有非阻断漂移：详情 sheet 的 760×620／760×560 文档差异，以及旧主规格／child 文档仍提及不存在的详情 Column 移动替代入口。本轮未增加这些控件、未依赖该旧描述，也未恶化相关行为。本 Change delta 保留既有六个详情／责任人场景；后续授权归档时已同步主规格，未更改上述范围外旧 requirement。

独立代码评审、用户对同 fixture 前后截图的人工接受、Windows native／两平台 release 认证结果尚未提供。实现和自动化任务完成本身不授权 sync／archive；本轮归档由下述后续明确授权触发。

### Archive and Documentation Audit

用户于 2026-11-11 明确指示“可以 archive 然后提交了”。该指示授权了 delta sync、最终模型／文档反馈核对、归档和 Git 提交；不将其记录为未提供的独立代码评审、人工观感或平台发布验收通过。

- 归档前 CLI 确认所有 planning artifacts 完成，任务 11／11。逐项复核生产 JSX／局部 CSS、瞬时拖拽几何、权威载荷、测试日志和 owning 文档后，模型结论仍为无新身份、关联、生命周期、授权、schema／migration、API 或跨项目契约。根 business model／architecture 与 documentation map 无需新增修改；child Current recipe 与代码对应，编辑统一等未实现能力保留 Target。
- `project-boards` 同步 2 个 ADDED requirements；`project-work-items` 同步 1 个完整 MODIFIED requirement，保留原 6 个详情／责任人场景并增加 2 个 Card 场景。逐块核对全部 delta 与主规格一致，其他主规格 requirements 保持原文；未新增 capability 或 TBD Purpose。
- 同步后 `openspec validate --specs --strict --no-interactive` 通过 13 项。随后运行 `pnpm exec openspec archive refine-board-visual-layout --skip-specs --yes --json`，归档到 `openspec/changes/archive/2026-11-11-refine-board-visual-layout/`。`--skip-specs` 仅避免 CLI 重复执行已完成并核验的同步，不是跳过本轮规格反馈；`.openspec.yaml` 随 Change 保留。
- 归档移动增加了一层路径，已修复本 Change 到 root／Desktop 文档的相对链接，并将当前 active／尚未 sync 的描述更新为历史 Apply 和已授权归档状态。归档后继续执行官方 schema／main-spec strict validation、文档链接／空白检查和仓库要求的 staged 提交 gate；提交结果由 Git 记录，不在本文件虚构 commit hash。
