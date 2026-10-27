# Test Plan

## Scope and Risk

本 Change 已在此前 Apply 中实现空 Board 永久删除、Desktop 删除调和、Work Item 隐式保存、固定 `OPEN lifecycle` 的端到端移除和 Focused Work Sheet 首版。2026-10-26 用户验收明确否决首版详情的动态体验：读写表面尺寸不同导致 Dialog 点击时重排闪动，保存后“描述”等标签消失。当前重新 Apply 的范围只包含 Renderer 详情信息架构收敛：删除 Placement/Column 行、标题占满关闭按钮左侧空间、描述全宽多行、shell 高度随普通内容收紧，以及直接相关 reducer、样式、i18n、测试和 Desktop owner docs；此前通过的业务/API/数据库实现保留为历史证据，不把它们误报为本轮已完成。

空 Board 永久删除、V1/API/strict contract 与 Work Item 原子编辑仍是回归边界，但本轮不修改。详情模式切换闪动、标签丢失、saving 过早退出 editor、scroll/focus 跳动和 IME 误提交属于 **High** 交互正确性与用户信任风险；双语长内容、小 viewport、reduced motion 和局部 affordance 属于 **High** 体验与可访问性风险。逃逸缺陷会直接让已保存内容显得结构缺失、让用户怀疑输入是否丢失，并形成明显不专业的核心编辑体验。

本轮测试必须证明 read→edit→saving→success、validation、temporary failure 与 conflict 的完整序列，而非只比较静态截图或 saved feedback 消退后的 footer。Renderer 状态测试拥有 draft、`pendingIntent`、IME 与保存资格；Chromium 拥有真实 CSS 几何、focus、scroll、连续截图/录屏和 pointer/keyboard 行为。业务/API 边界使用受影响回归门禁证明未漂移，不重复制造已完成 Core API Red/Green。OpenSpec 结构校验或单张截图均不能替代动态体验证据。

明确不实现 Work Item 状态、完成/取消/重开转换、Column 到状态的映射、状态历史、Work Item 独立删除、含 Card Board 的删除/迁移、软删除/恢复、评论/自定义字段/Workflow/Agent，也不引入生产迁移兼容层；业务模型已批准的 Target `Open`、`Completed`、`Cancelled` 状态机及 reopen 转换保持不变。当前方案仅适用于首次发布前且数据可丢弃的 checkout-owned loopback 数据库；若 Apply 前发现 released baseline 或不可丢弃数据，必须暂停并重新批准追加 migration 与兼容测试方案。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| 空 Board 以当前 version 与精确名称删除；Columns→Board 原子删除且 Work Items 保留 | Core API PostgreSQL integration | `ProjectWorkApplicationIntegrationTest` 覆盖多空 Column、无 Placement、保留 Project Work Item 与成功结果 | 真实事务和限制性外键不能由 mock 证明 |
| 非空 Board、过期 version、名称不匹配、受保护依赖全部拒绝且无部分删除 | Core API PostgreSQL integration | `BOARD_NOT_EMPTY`、`BOARD_VERSION_CONFLICT`、`BOARD_NAME_CONFIRMATION_MISMATCH`、`BOARD_DELETE_RESTRICTED` 和删除前后表快照 | 业务不变量和回滚属于持久化边界 |
| OWNER、Workspace/Project/Board 隔离及不泄露归属 | Core API application + HTTP integration | 同 Project OWNER 成功；错误 Workspace/Project、另一 OWNER/非成员按批准语义失败 | 授权只能由 Core API 真实安全链与 use case 证明 |
| permanent-deletion action、请求 schema、`204`、Problem Details；标准 `DELETE /boards/{boardId}` 仍为 `405` | HTTP/OpenAPI contract | `AuthenticationHttpIntegrationTest` 与 `OpenApiIntegrationTest` 覆盖固定 POST action、bearer、body、状态、稳定 code 和独立 `DELETE` guard | 防止 Desktop/Core API 手写契约漂移或误开放标准 DELETE |
| 删除当前 Board 后选择最早剩余 Board；最后一个删除后返回空 home；无权威响应三态调和且不自动重发 | Main coordinator deterministic unit | deferred fake 覆盖明确成功、list 不含 Board、仍含 Board、list 失败、偏好失败和 refresh 失败 | 不可逆命令的结果调和需要确定性编排测试 |
| 删除/调和期间旧 Board read/detail/mutation 不可复活，且账号/Project scope 隔离 | Main coordinator concurrency unit | tombstone、reconciliation isolation、operation-start token、generation 与 response key 断言 | 可确定控制竞态，不依赖脆弱计时 |
| 修正后的空库 V1 创建 `work_items` 时不存在 lifecycle column 与 lifecycle check constraint | PostgreSQL/Flyway catalog integration | `WorkspaceProjectMigrationIntegrationTest` 或同级 migration test 从空库执行 `V1__initialize_taskpilot.sql`，查询 `information_schema.columns`/`pg_constraint` exact absence，并回归其余 Work Item 列与约束 | 只有真实 PostgreSQL/Flyway 能证明基线 DDL 和 catalog |
| Kotlin `WorkItemView`/`CardView`、SQL mapper 与 JSON response 不含 lifecycle/status | Core API compile + application/HTTP integration | 创建、读取、编辑和 Board read 的 exact JSON/property assertions；编译确保 use case/view/mapper 无旧字段 | 防止只删数据库或只隐藏 UI，导致服务端 shape 漂移 |
| 运行时 OpenAPI 的 Work Item/Card schema 不含 lifecycle、status 或固定 `OPEN`，其余 required properties 准确 | Runtime OpenAPI contract | `OpenApiIntegrationTest` 对 schema property set 做 exact assertion，并覆盖 create/detail/edit/Board response 引用 | 文档 schema 是 Desktop 手写 adapter 的跨边界契约 |
| Desktop Zod strict parser、共享 contract 与 transport fixtures 采用新 shape；含旧字段响应应 fail closed | Main/Preload contract unit + TypeScript compile | `project-work-client`、transport、coordinator、IPC/Preload tests 解析不含字段的合法响应，并断言注入 `lifecycle`/`status` 的 response 被 strict schema 拒绝；typecheck 无旧属性访问 | 防止旧字段被 optional/nullable/deprecated 方式暗中保留 |
| Work Item 创建、查看、标题/描述编辑在无状态模型下仍保留 identity、version、audit 与原子回滚 | Core API PostgreSQL + HTTP integration | `ProjectWorkApplicationIntegrationTest` 与 HTTP tests 回归成功、过期 version、错误 scope、Column 改变和失败回滚；断言不产生状态副作用 | 删除占位字段不能破坏现有内容与并发契约 |
| 同一 Work Item 在两个 Board 的 Column 独立；移动仅改变当前 Placement | Core API PostgreSQL + Renderer integration | 多 Board fixture 中移动 Board A 后，Board B 的 Column/Placement 不变，Work Item 内容一致且无全局 status/lifecycle | 直接证明 Column 是 Board-local Placement 而非状态 |
| Card 先 loading/读取权威详情，读取失败或切换后迟到结果不覆盖 | Renderer integration | Card 投影与 GET 结果不同、not-found/retry、关闭/切 Board/切 Card 的迟到响应 | React 状态和 response eligibility 属于 Renderer seam |
| 实际 Work Item 标题是唯一 Dialog heading；不存在“工作项详情”、重复标题、“当前看板”或状态/`OPEN` | Renderer integration + Cypress component | 按 role 查询唯一 heading 与 accessible name；断言禁用文案/区域缺席，并覆盖中英文真实内容 | 组件语义和 Chromium accessibility tree 共同防止重复信息架构 |
| 描述是全宽多行正文；详情不展示 Placement/Column 行；创建/更新时间合并为弱化 footer | Renderer integration + Cypress component + manual visual | DOM 结构/顺序、禁用行/combobox 缺席、字段角色和 viewport fixture；人工审查层级、密度和审计信息弱化 | 自动化证明结构，人工判断视觉层级而非像素快照替代设计验收 |
| 字段默认平整、编辑态由局部 focus ring/底色表达；没有整块卡片选中效果或永久空白保存槽 | Cypress component + style/source review + manual visual | focus-visible、编辑前后几何和反馈节点条件渲染断言；检查 changed CSS 不生成常驻占位区 | 浏览器可测交互与布局，人工判断“高级且克制”的视觉结果 |
| 标题 Enter/真正失焦、描述真正失焦/`Ctrl/Cmd+Enter` 各只提交一次，普通 Enter 换行 | 纯状态转换 + Renderer integration | reducer/组件测试覆盖 dirty、saving、重复 blur/click 去重和最新 confirmed baseline 请求 | 状态组合由纯测试穷举，DOM 测试证明事件连接正确 |
| 从脏字段切换或关闭详情时先保存，成功后执行 pending intent，失败则停留并保留草稿与仍有效的意图 | 纯状态转换 + Renderer integration | 字段 A→B、关闭/外部 dismiss、saving 期间重复意图、validation/rejection/conflict 分支；失败或冲突后不执行也不清除仍有效的意图，重试保存成功后继续原关闭或字段切换动作且只执行一次 | 数据安全和后续动作顺序属于状态机最低可靠层 |
| 详情不提供 Placement/Column 编辑入口；标题/描述保存仍携带未变化的 Work Item/Board/Placement context | Renderer contract + Core API integration | Renderer 断言无详情 combobox 且内容保存的 `currentColumnId === targetColumnId`；Core API 原子编辑、冲突、错误范围和多 Board 独立回归 | UI 范围与既有服务端事务契约各自由最低可靠层验证 |
| 详情没有 Placement/Column Select portal，字段 Escape、Dialog Escape 与焦点恢复仍保持分层 | Renderer integration + Cypress component | 断言详情无 combobox；dirty 字段 Escape 仅丢弃草稿，只读 Dialog Escape 关闭并恢复 Card/Board 焦点 | jsdom 与真实 Chromium 分别覆盖状态和焦点路径 |
| 字段 Escape 恢复确认值；只读详情 Escape 才关闭；关闭焦点恢复和 Card 消失安全回退 | Renderer integration + Cypress component | dirty 字段 Escape 不请求、确认值恢复、detail dismiss 与 trigger removal | 区分放弃局部草稿和关闭前保存的可达路径 |
| validation、暂时失败和 version 冲突保留草稿，不把失败值写入 Card；冲突重载权威值 | Renderer integration | field error、deferred/rejected save、Work Item+Board reload、重试/采用最新内容 | 需要观察详情与画布的共同状态 |
| saving/saved 仅在有意义时邻近出现并自动消退；无常驻按钮；reduced motion 保留可理解反馈 | Renderer integration + Cypress component + manual visual | 条件渲染、accessible live feedback、无布局跳动、按钮缺席与 reduced-motion fixture | 自动化验证状态，人工判断反馈是否抢占正文 |
| `zh-CN`/`en`、长标题/描述、`960×640`、`1280×800` 与宽窗口 | Cypress component + manual visual | 两语言多 viewport fixture，无裁切、遮挡、双滚动或焦点不可达；人工密度审查 | 浏览器可测几何，视觉完成度仍需人工判断 |
| read→edit→saving→success 在无真实 footprint 增长时的稳定几何 | Cypress component geometry + continuous screenshots/video | 在标题和空/单行/多行描述上逐状态采样 panel bounds、关闭按钮、footer、标签和文本原点；同一换行足迹的每轴差异 `≤1 CSS px` | 只有真实 Chromium layout 能捕获重排与重新居中 |
| saving、validation、暂时失败、冲突保留 editor/draft/标签/scroll，成功才换等占位 read surface | Renderer state + integration + Cypress slow network | deferred success/rejection/conflict，断言 editor 未提前卸载、pendingIntent 保留、反馈在身份行、scroll 不跳顶 | 状态资格与真实 DOM 连续性需要分层证明 |
| 空/单行描述不膨胀；长内容或合法草稿增长只由受控内容区吸收 | Cypress component geometry | empty/one-line/multiline/long-title/long-description fixtures；主 shell 不变、无双滚动、footer 可达 | 样式 footprint 和 scroll ownership 无法由 jsdom 证明 |
| 中文 IME、快速字段切换与键盘 Escape | Renderer integration + Cypress component | composition Enter 不保存；A→B 保存一次并恢复意图；字段与 Dialog Escape 分层；focus-visible 与 focus restore | 覆盖实际输入法、事件顺序和焦点风险 |
| current-platform 专业体验 | real operation recording + continuous screenshots + manual inspection | 鼠标和键盘完成完整状态序列，审查是否闪动、标签连续、局部 affordance、视觉层级与 reduced motion | 自动阈值能防几何回归，但不能独立判断专业质感 |
| 代表性跨边界旅程：Board 删除/回退；打开 Card→无状态详情→字段隐式保存 | Desktop portable system | `DesktopSystemJourneyTest` 穿过编译后的 Main/IPC/Preload、Core API、PostgreSQL、Redis | 捕获新 response shape 与真实边界组合缺陷，不重复全部错误矩阵 |
| 仓库当前边界不再依赖固定生命周期 | Source search + semantic review | 对 SQL/Kotlin/TS/TSX/i18n/fixtures/tests/docs 的 `lifecycle`、`status`、`OPEN` 搜索逐项分类；允许已批准的 Target 状态机、未来实现说明和明确否定，不允许当前字段/文案/fixture | 搜索是遗漏侦测补充，不能替代 catalog、contract 和行为测试 |
| 业务模型、Current/Target、实现/API/测试一致，三个 delta specs 可同步 | 语义审查 + OpenSpec schema/strict validation | 证明 Current 不含状态字段/动作且 Column 仅表示 Placement，同时保留 Target `Open`、`Completed`、`Cancelled` 与 reopen 转换；对照 SQL、Kotlin、OpenAPI、Desktop contract/UI、tests、owning docs 与三个 delta specs并记录有意保留项 | 结构校验不能证明语义一致 |

## Implementation and Verification Approach

### Slice 1: 已批准 Board 删除与 Desktop 调和回归

保留已完成实现的 focused 与 affected regression，不重做既有实现。Core API 继续证明空 Board 删除的授权、原子性、稳定错误和标准 DELETE guard；Main/Preload 继续证明三态调和、tombstone、generation fencing 与零 Board home。若无关回归失败，先区分本修订引入的 contract 传播问题与既有缺陷，不借机扩大范围。

### Slice 2: 无状态 Work Item 基线与 Core API 契约修正

采用 Red-Green-Refactor，因为数据库和 response shape 有清晰可自动化边界。Red 先把 migration catalog、Kotlin/JSON exact shape、运行时 OpenAPI exact properties、多 Board Placement 独立性测试改为要求 lifecycle/status 缺席；失败必须来自现有 V1/DTO/schema 仍暴露字段。Green 直接修正首次发布前的 V1，删除 SQL、view、mapper、OpenAPI 中的固定字段，并保持 identity、version、audit、原子编辑与授权不变量。Refactor 清理仅为 `OPEN` 存在的 fixture/helper，并在同组更新 `docs/business-model.md` 与 Core API owning docs：Current 改为未实现状态能力，已批准的 Target 状态机保持不变。不得把字段改成 optional、nullable、deprecated，也不得新增 V2 或运行 Flyway repair。

### Slice 3: Stable Focused Work Sheet 动态体验修订

采用针对可观察行为的 Red-Green-Refactor。Red 先在 Cypress 增加完整状态序列的 geometry probes，要求没有新增换行或其他真实 footprint 增长的转换在 panel bounds、关闭按钮、footer、字段标签和文本原点上每轴差异不超过 `1 CSS px`；同时在 Renderer tests 锁定 saving 保留 editor/draft、IME composition 不提交、失败/冲突保留 `pendingIntent`。新增断言必须在现有实现上因重排、标签卸载或事件处理缺口而失败，而不是因环境、截图字体偶然差异或任意像素快照失败。

Green 在现有组件内建立稳定 shell、固定 header/footer、单一主内容 scroll owner和复用的 field identity/layout slots；让 title read/input、description preview/textarea、Column value/Select 共享几何，反馈在身份行右侧原位替换。不得重写 reducer 并发模型、引入依赖、增加 debounce autosave 或永久 toolbar。Refactor 收敛样式和 React 结构，遵循 `vercel-react-best-practices`，避免为每种状态复制整棵字段 DOM或用高度动画隐藏重排；同组更新 Desktop design/testing owner docs，只有实现证据成立后才标为 Current。

### Slice 4: 受影响回归、模型漂移与最终动态 UI 审查

扩展 portable system journey 覆盖无状态 response shape 与详情成功保存，不复制 Core API 的全部拒绝矩阵。Core API 与 Desktop 都是本修订直接受影响边界，必须完整串行运行各自 gate；不能再以“服务端无变化”为由跳过。随后执行 source search，逐项分类残留词；对 implemented code、V1、API、tests、business model、Desktop/Core API owning docs 与三个 delta specs 做 model/documentation drift audit。最后使用 `web-design-guidelines` 审查实现后的可访问性、键盘、表单和响应式行为，并将自动化无法判断的视觉层级留给当前平台手工验收。

## Verification Commands

### Focused

所有 Gradle 命令串行执行，避免共享 `build/test-results` 争用。

- `./gradlew --no-daemon :services:core-api:test --tests "*WorkspaceProjectMigrationIntegrationTest"`: 从空 PostgreSQL 执行修正后 V1，并验证 Work Item catalog 不含 lifecycle column/check constraint。
- `./gradlew --no-daemon :services:core-api:test --tests "*ProjectWorkApplicationIntegrationTest" --tests "*AuthenticationHttpIntegrationTest" --tests "*OpenApiIntegrationTest"`: Work Item 无状态 view/JSON/OpenAPI、多 Board Placement、原子编辑、授权与 Board 删除契约。
- `pnpm --filter @taskpilot/desktop exec vitest run --config vitest.config.ts tests/main/project-work-client.test.ts tests/main/project-work-coordinator.test.ts tests/main/transport.test.ts tests/main/preload-api.test.ts tests/main/ipc-errors.test.ts`: Desktop strict parser、共享 transport、Main/Preload shape 与异步资格。
- `pnpm --filter @taskpilot/desktop exec vitest run --config vitest.config.ts tests/renderer/work-item-detail-state.test.ts tests/renderer/project-board.test.tsx`: 隐式保存状态机、唯一 heading、信息架构、禁用区域缺席和异常恢复。
- `pnpm --filter @taskpilot/desktop exec cypress run --component --spec cypress/component/project-board.cy.tsx --config video=true`: Chromium 中 read/edit/saving/success/failure/conflict 的真实 geometry、连续截图/视频、portal/focus/scroll、IME、双语、多 viewport 与 reduced motion；保存 panel/field/footer 坐标采样作为客观证据。
- `rg -n --glob '!openspec/changes/**' 'lifecycle|OPEN|工作项详情|当前看板|进行中' services/core-api apps/desktop docs`: 对当前实现、fixtures、文案和 owning docs 做残留侦测；结果必须人工分类，不能把搜索零结果当成唯一完成证据。

### Affected and Cross-Boundary

按以下顺序执行，Core API Gradle gate 与 Desktop system Gradle journey不得并发：

- `./gradlew --no-daemon :services:core-api:qualityCheck`: 仅当本轮 diff 或回归调查触及 Core API/数据库/API owner 时重跑；纯 Renderer 修订默认引用此前 Apply 的历史通过结果并以 source/diff 审计确认未触及，不能冒充本轮新执行。
- `pnpm --filter @taskpilot/desktop qualityCheck`: Desktop typecheck、lint、Main/Renderer/architecture tests、coverage 与 production build。
- `pnpm --filter @taskpilot/desktop test:e2e`: 全部 Cypress component journeys，检查 Dialog/Select、Board 拖拽和详情回归。
- `pnpm --filter @taskpilot/desktop test:system`: 编译后 Main/IPC/Preload 到真实 Core API、PostgreSQL、Redis 的代表性新 shape 旅程。
- `openspec schema validate taskpilot-sdd --verbose`: 项目 schema 自校验。
- `openspec validate add-board-deletion-and-card-detail-view --strict --no-interactive`: 当前 Change 的三个 delta specs 与 planning artifacts 严格校验。
- `openspec validate --all --strict --no-interactive`: 所有 active Changes 与 main specs 严格校验。
- `git diff --check`: changed planning artifact、后续 code 与 docs 的 whitespace/error 基线。

## Manual Evidence and Automation Gaps

Apply 完成后的实现自审阶段，由实现者在当前平台 Electron/Chromium 录制或连续截图完整操作，而不是只留静态终态：在 `960×640`、`1280×800` 与宽窗口的中英文界面，分别操作标题和空/单行/多行描述，确认详情没有 Placement/Column 行，并观察 read→edit→saving→success、validation、temporary failure 与 conflict。实际标题必须形成唯一清晰入口；“描述”全程存在且使用完整内容宽度；标题占满关闭按钮左侧可用空间；panel、关闭按钮、footer 和未编辑字段不闪动；saving 保留 editor/draft；长内容在受控区域滚动；局部 affordance、鼠标/键盘 focus ring、IME 和 reduced-motion 均可用。自动 geometry threshold 能防回归，但不能可靠判断信息层级、质感和连续交互是否达到专业标准，因此当前平台真实操作检查不可由单张截图替代。

数据库基线重建只允许复用仓库既有 checkout ownership、loopback 与 disposable-data 防护；执行前需要由实施者确认当前环境满足条件。任何 released 或不可丢弃数据库都属于阻断信号，不得以手工删除列、Flyway repair 或忽略 checksum 代替重新设计。

Windows x64 与 macOS arm64 的最终原生截图/键盘视觉烟测继续是发布证据，不作为本开发 Change 完成的自动门禁；本修订不改变 native integration、安装、签名或凭据。独立规划审查、实现后的独立 code review、用户手工验收和 archive 授权由用户安排，结果不由本 Agent 替代或推断。

## Apply Evidence — 2026-10-26 Revision (Tasks 8–10)

> **Historical evidence only:** 以下结果证明此前 lifecycle/contract/Focused Work Sheet 首版 Apply 的自动化状态。用户随后发现读写切换闪动和保存后标签消失，因此旧截图、19 个 project-board Cypress cases 和 footer 单点几何断言不能作为本轮稳定交互验收证据；本轮任务仍未 Apply。

### Scope and Red/Green Evidence

本次 Apply 获用户“开始apply吧”授权，实施已批准的无状态 Work Item
contract correction 与 Focused Work Sheet，不重做既有空 Board 删除/详情/隐式保存切片，
不新增依赖、状态转换、授权规则或跨项目机制。保留进入本次 Apply 前已有的工作树改动。

- Core API Red：四个 focused integration suites 共 38 tests，5 个失败，触发点是
  旧 V1 catalog、view/HTTP JSON 和 runtime OpenAPI 仍依赖 lifecycle；修正后 focused
  Green 通过，最终完整 gate 覆盖新增的 create/detail/edit/read/move exact-key 断言。
- Desktop contract Red：单独 `project-work-client` suite 为 6 tests / 4 failures，
  新 shape 被旧 parser 拒绝，旧 lifecycle response 被接受。初次组合 Main 执行还出现
  fixture 编辑导致的语法错误，该次不作为业务 Red 证据；修正 fixture 后以独立 parser
  Red 和最终全部 Main tests 验证。Green 同时拒绝 Work Item/Card 的 lifecycle 和 status。
- Renderer Red：`project-board.test.tsx` 45 tests / 3 failures，包含唯一 actual heading、
  无状态/空白反馈槽断言和旧详情选择器；Cypress 单 spec 17 tests / 2 failures，
  actual-title dialog 在旧 generic heading 下无法找到。Green 后覆盖双语、长内容、
  portal focus、隐式保存、冲突恢复与 footer。
- 新增 reducer 回归分别覆盖 close/switch intent 经 validation failure → temporary
  failure → conflict → successful retry 后只执行一次；保持草稿与权威版本恢复语义。

### Contract, Model and Documentation Feedback Audit

已对 SQL、Kotlin views/mappers、运行时 OpenAPI、共享 TypeScript、strict Zod、
Renderer/i18n、fixtures/tests 和 owner docs 检查
`lifecycle|status|OPEN|工作项详情|当前看板|进行中`。生产 Work Item/Card/V1 不再携带
这些状态字段，也没有 optional/nullable/deprecated/passthrough 兼容方案。
残留命中按语义分类，不以仓库全局零匹配为目标：

- Project ACTIVE/ARCHIVED、User/account 与 HTTP/ProblemDetail status、OAuth/session
  status、进程生命周期及 React StrictMode lifecycle 属于其他既有概念。
- UI saving/saved/status 与 read-only/editing/conflict 是客户端交互状态，不是 Work Item 状态。
- `lifecycle`/`status`/`OPEN` 注入与不存在的 constraint/区域断言是明确拒绝或否定测试。
- Select fixtures 和用户创建的“进行中”Column 名称是 Board-local 位置，不推导全局状态。
- `docs/business-model.md` 保留 Target `Open`、`Completed`、`Cancelled` 及明确 reopen
  转换，注明 Current 尚无状态能力，后续独立 Change 实现对应 persistence/API/权限/历史。
- 已归档 artifacts 与尚未获同步授权的 main specs 是历史/待同步描述，不作为 Current
  实现证据。三个 delta specs 已具备后续 sync readiness，但本次不执行 sync。

稳定结论已反馈到 business model、Core API architecture/responsibilities/testing-strategy
与 Desktop architecture/responsibilities/testing-strategy/design-foundation。
Work Item 仍由 Project 拥有，Column/Placement 仍属于特定 Board；移动只改变当前 Placement，
不改变 canonical content 或其他 Board 的 Placement。授权、乐观版本、原子回滚、空 Board
删除、未知结果 reconciliation 与迟到响应 fencing 的既有测试继续保留。
根 `docs/architecture.md` 无需更新：Core API 仍拥有 SQL/API/业务真相，Desktop Main strict
parser、窄 IPC/Preload 和 Renderer 的职责不变，没有新增边界或机制。
`docs/README.md` 无需更新：没有新增/迁移/改名文档或改变文档 ownership。

V1 在 Testcontainers 的空 PostgreSQL 17 基线上验证；没有新增 V2 或运行 Flyway repair，
没有停止或删除本机既有开发数据库/Redis。现有 checkout 的旧 disposable 数据可能在下次
启动时遇到 V1 checksum 不匹配，必须走既有 checkout-owned/loopback/disposable recovery；
released 或不可丢弃数据库不在本 Change 的安全执行范围。

### UI/UX and Accessibility Self-Review

按 `frontend-design` 的已批准 Focused Work Sheet 方向实施，React 变更遵循
`vercel-react-best-practices`，最终使用官方 `web-design-guidelines` 审查直接受影响组件。

- `board-workspace.tsx`：actual title 是唯一 Dialog heading；标题编辑时保留隐藏的
  confirmed heading，编辑 input 有 label、错误关联和单字段 autofocus。
  描述为全宽多行正文，Placement/Column 行与详情 combobox 不存在，audit 为弱化 footer；
  无重复标题、状态区或 idle feedback slot。保存反馈条件渲染为邻近 live status，错误含重试/恢复路径。
- `styles.css`：检查单一 Dialog scroll/overscroll、内容换行、局部 focus-visible 与
  reduced-motion。截图检查发现全局 `button:hover:not(:disabled)` 特异性高于局部规则，
  会给描述整块填色；已加局部 hover/active 覆盖并通过真实 Chromium pointer 测试锁定
  无浮升/no shadow，保留 action-colored 全框边界和键盘 focus ring。
- `project-board.cy.tsx`：真实鼠标 hover、键盘 focus、字段/Dialog 分层 Escape、
  无详情 combobox、内容保存保留 Placement context、saved feedback 消失时 footer 几何不变均有自动化回归。
  当前平台检查中英文 ordinary/long 内容的 960×640、1280×800、1600×900 截图；
  ordinary 内容显示标题/正文/Column/footer 的清晰层级，长内容在单一 modal 内滚动。
  截图位于 Cypress ignored output，不作为已完成用户验收或原生发布 smoke 的凭据。

自审目标为 `HEAD 118cb7f → 当前工作树`，本轮重点是 tasks 8–10 的新增修订及直接相关
旧切片回归。范围包含 contract/persistence/UI/test/owner docs；不包含无关 Runtime、
provider redesign、安装签名、数据库生产升级或其他预存改动。修复上述 hover 问题后未发现
本次范围内剩余 blocking finding。此为实现者自审，不是独立 code review。

### Handoff and Remaining Evidence

保持 Change active。下一阶段等待用户安排独立 code review 与手工视觉/业务验收；
Windows x64 / macOS arm64 原生视觉、键盘与发布 smoke 尚未执行。
没有运行 spec sync/archive，没有暂存或提交。通过自动化或勾选任务不代表上述人类门禁完成，
也不构成 archive 授权。

### Final Automated Gate Results

最终修复后以下四个门禁按 test plan 顺序**串行**执行，均 exit 0（Core API quality
与 system journey 没有并发写入 Gradle test results）：

| Command / check | Actual result |
| --- | --- |
| `./gradlew --no-daemon :services:core-api:qualityCheck` | BUILD SUCCESSFUL；134 tests，0 failures/errors/skipped；ktlint、Detekt、architecture、migration/catalog、HTTP/OpenAPI、Kover、build 通过 |
| `pnpm --filter @taskpilot/desktop qualityCheck` | typecheck/lint/build 通过；Main 125、Renderer 120、architecture 10，共 255 tests；coverage 255 tests 通过，statements 85.22%、branches 78.82%、functions 84.42%、lines 90.15% |
| `pnpm --filter @taskpilot/desktop test:e2e` | 35/35：first-use 12、project-board 19、select-control 4；0 failed/pending/skipped |
| `pnpm --filter @taskpilot/desktop test:system` | build 后执行 DesktopSystemJourneyTest，BUILD SUCCESSFUL；1 portable journey 通过，真实 Core API/PostgreSQL/Redis + 编译 Main/IPC/Preload + source-mounted Renderer |
| `pnpm exec openspec schema validate taskpilot-sdd --verbose` | schema valid |
| `pnpm exec openspec validate add-board-deletion-and-card-detail-view --strict --no-interactive` | Change valid |
| `pnpm exec openspec validate --all --strict --no-interactive` | 11/11 passed；仅有既有 long-requirement INFO，0 failed |
| `git diff --check` + untracked Change/reducer files no-index whitespace check | 无 whitespace error |

System seam 显式加载 `dist/main` 与 `dist/preload/api.js`，不以 source alias 冒充编译产物；
jsdom 下 `import.meta.url` 为 HTTP 的初次失败已修正为从 desktop runner cwd 解析 file URL，
最终串行 system gate 已通过。Renderer source-mounted/jsdom 验证不等于打包 Electron
端到端或原生发布 smoke。Cypress 与 Gradle 的既有弃用提示不改变上述通过结果，也未在本轮
扩展浏览器/构建平台迁移范围。

## Apply Evidence — 2026-10-26 Revision (Tasks 11–12)

> 本证据覆盖 Stable Focused Work Sheet 动态体验修订，并以当前工作树相对
> `refs/taskpilot/pre-group11` 的完整 Change diff 为范围。此前 8–10 组已修改 Core API、
> PostgreSQL V1、Main/Preload 和共享 contract，因此本轮未沿用“仅 Renderer diff”或“不重跑
> Core gate”的旧判断；业务/API/删除证据仍由完整 Change 的现行实现与门禁共同负责。

### Red / Green / Refactor 证据

- Red（动态布局）：首轮 Cypress 几何场景在旧详情上暴露 content-sized Dialog、固定六行
  description textarea、保存后标签卸载，以及进入编辑时 shell/关闭按钮/footer 位移；原几何
  helper 虽采集 close/footer，却只断言 sheet，不能证明固定区域稳定。
- Red（冲突恢复）：旧 reducer 只允许 `editing` 接受 `draft`，导致 conflict UI 看似仍可编辑，
  实际会忽略修改后的标题/描述草稿；新增 reducer、Renderer 与 Cypress 场景先证明该
  可达失败，再要求 retry 使用最新 authority/version 与用户修订后的 draft。
- Red（焦点与字段类型）：Dialog 初次打开会自动聚焦“编辑标题”，造成视觉上的假编辑态；改为
  聚焦唯一 heading 后又暴露静态 heading 的橙色大焦点框。标题沿用可增长 textarea/三行局部
  滚动也不符合最终确认的“标题单行、描述多行”字段模型。
- Green：详情改为 content-adaptive、viewport-bounded 的稳定 shell；header/关闭按钮/footer
  固定，中间正文为唯一主滚动 owner。“描述”标签常驻，Placement/Column 行完全移除，saving
  保留 editor、draft、标签和滚动位置，反馈只占用字段身份行。
- Green：标题只读态为单行 ellipsis，编辑态使用单行 `input[type=text]`，不换行且无纵向滚动条；
  完整值仍保留在 DOM/accessible name/input value。描述继续使用可自动增长的多行 textarea，
  普通 Enter 换行，Ctrl/Cmd+Enter 保存，空或单行内容不会突增为固定六行。
- Green：`editing` 与 `conflict` 均接受 title/description draft，retry 以最新 confirmed version
  提交且保持 confirmed Placement context。几何断言对 sheet、close、footer 的
  left/right/top/bottom/width/height 全部使用 `≤1 CSS px` 阈值。
- Refactor：初始语义焦点落到唯一 heading，但静态 heading 不绘制交互式焦点框；焦点 trap、字段
  Escape/blur/IME、保存后触发器恢复保持不变。完整 typecheck 曾捕获 conflict union 被错误写入
  `error` 字段，最终以 discriminated branch 分开 `editing` 与 `conflict` 返回值修复。

### 实际执行结果

以下命令均在当前工作树实际执行并通过；计数采用最终一次完整通过结果：

| Command / check | Actual result |
| --- | --- |
| focused Vitest：`work-item-detail-state.test.ts` + `project-board.test.tsx` | 2 files，61/61 passed |
| focused Cypress component（Electron，`video=true`） | 27/27 passed，17 screenshots，video 已生成 |
| `pnpm --filter @taskpilot/desktop qualityCheck` | typecheck、lint、Main 125、Renderer 127、architecture 10、coverage 262、build 全通过；coverage statements 85.36%、branches 78.70%、functions 84.69%、lines 90.36% |
| `pnpm --filter @taskpilot/desktop test:e2e` | 43/43：first-use 12、project-board 27、select-control 4 |
| `pnpm --filter @taskpilot/desktop test:system` | `BUILD SUCCESSFUL`；1 个 Desktop system journey 通过，覆盖编译后的 Main/IPC/Preload 与真实 Core API/PostgreSQL/Redis |
| `./gradlew --no-daemon :services:core-api:qualityCheck` | `BUILD SUCCESSFUL`；134 tests，ktlint、Detekt、architecture、migration/catalog、HTTP/OpenAPI、Kover 全通过 |
| OpenSpec schema/change/all strict validation | schema valid；Change valid；11 passed、0 failed，仅既有 long-requirement INFO |
| `git diff --check` + Change markdown trailing-whitespace check | 无错误 |

连续交互与视觉证据由
`cypress/videos/project-board.cy.tsx.mp4`、`work-item-geometry-*.png` 和
`work-item-sheet-ordinary-{zh-CN,en}-*.png` 提供（目录被 `.gitignore` 忽略，不入库）。当前 host
Electron component journey 覆盖 read/edit/saving/saved、validation、temporary failure、conflict、
空/单行/多行描述、长标题、IME、字段与 Dialog Escape 分层、reduced motion，以及 `960×640`、
`1280×800`、`1600×900`。最终截图人工检查确认：普通态无假编辑焦点框，标题单行省略且无滚动条，
标题编辑为单行 input，描述保持多行，标签/footer 常驻，普通内容没有由字段模式切换造成的空白或跳动。

### 最终 web-design-guidelines 审查

2026-10-26 再次获取最新 guidelines，并逐项审查直接受影响的
`board-workspace.tsx` 与 `styles.css`：

- Dialog 使用 `role=dialog`、`aria-modal`、唯一 heading 和语义 header/footer；关闭 icon button 有
  `aria-label`，所有字段均使用 button/input/textarea/Select 的原生语义并具有 label 或 aria-label。
- 标题 input 有 `type=text`、`name`、`autocomplete=off`、受控 `value/onChange`；描述 textarea 有
  独立 name/label，允许普通 Enter 换行；未阻止 paste。错误使用 `role=alert` 与
  `aria-describedby`，saving/saved 使用 `role=status` + `aria-live=polite`。
- 初始 heading 焦点只承担 Dialog 语义宣告，不伪装成可编辑控件；可交互字段和 input/textarea
  仍有 `:focus-visible` 替代，focus trap、Escape 和保存后焦点恢复有自动化覆盖。
- modal/正文使用受控 overscroll；长文本具有 ellipsis、wrap 或内部滚动策略，flex/grid
  子项可收缩；无 `transition: all`，非必要动效在 reduced motion 下关闭。
- destructive Board 删除仍有确认 Dialog；日期使用 `Intl.DateTimeFormat`；未新增图片、媒体、
  手势唯一操作、路由状态或大列表虚拟化风险。

结论：直接受影响界面无 material guideline finding。该结论证明代码、当前 host Electron interaction
和已检查截图的一致性，不替代用户对最终专业质感的主观验收，也不构成 packaged Electron、macOS
arm64 或 Windows x64 原生发布 smoke；这些仍是发布前未验证风险。

### 最终实现自审与 handoff

- 标题为单行 input/read ellipsis，无标题纵向滚动；描述为多行 textarea；两类字段语义未再混用。
- conflict 可修改 title/description draft，retry 使用 conflict refresh 后最新 confirmed versions；
  内容请求继续携带未变化的 Placement context，`pendingIntent`、原子回滚和 Card 权威值保持现行契约。
- heading 初始聚焦但无视觉假编辑框；“描述”、close、footer 在状态转换中稳定；详情没有
  Placement/Column 行或 combobox，sheet/close/footer 六轴几何断言完整。
- proposal、三个 delta specs、design、owner docs、实现和测试一致；本轮 UI 修订没有改变 WorkItem /
  Placement 身份、所有权、授权、API、版本或 Board 删除业务语义，也未引入依赖或无关重构。

Change 保持 active；等待独立 code review、用户手工视觉/业务验收与显式 archive 授权。未执行
spec sync、archive、stage 或 commit。


## Apply Plan — 2026-10-27 Revision (Tasks 13–14)

> 本节是本轮计划，不复用 2026-10-26 旧布局的通过结果。实现后在此追加实际 Red/Green、命令结果与截图审查证据。

### Focused Red / Green

- **Reducer Red：**收敛 detail field union 为 `title | description`，删除 `select-column` action；更新 reducer tests，确保 title/description 的 draft、pending intent、conflict retry 不退化。
- **Renderer Red：**`project-board.test.tsx` 要求详情中不存在“所在列表”/“In column”、`Edit column` 和详情 combobox，同时 footer 仍显示，标题与描述仍可编辑并使用未变化的 confirmed Column context 构造完整 PATCH。
- **Geometry Red：**Cypress 在 `960×640`、`1280×800`、`1600×900` 断言标题 input 使用 close 左侧剩余宽度且间距约 `16px`，description preview/textarea 使用正文完整宽度，普通短内容 sheet 不再维持旧约 `300px` 固定高度或大块空白。
- **Stability Red：**普通 read、title edit/saving、description edit/saving 的 sheet/close/footer 六轴保持稳定；validation/conflict 的真实新增内容由有界正文滚动吸收。footer 的创建/更新时间始终保留。
- **Green：**删除详情 Column JSX、detail-only reducer/i18n/CSS/tests；保留 `confirmed.columnId` 作为 API context 和 Board 拖拽移动能力。将 shell 改为 content-adaptive + viewport-bounded，移除 heading 重复右侧预留，描述成为全宽多行主体。

### Affected Gates and Review

- 运行 focused reducer/Renderer Vitest 与带 video 的 focused Cypress，并人工检查三种 viewport 的连续截图，不能只依据坐标断言判断整体感。
- 运行 Desktop `qualityCheck`、`test:e2e`、`test:system`。本轮若没有修改 Core API、数据库或 API owner，则以 diff/source audit 记录不重跑 Core full gate；历史 134 tests 仅作历史证据。
- 获取最新 `web-design-guidelines`，审查可访问名称、键盘、focus、textarea、响应式、滚动与 reduced motion，修复 material findings。
- 更新 Desktop 四份 owner docs；执行 model/documentation drift audit，确认只收敛详情入口，不改变 WorkItem/Placement 身份、授权、版本、原子写契约、Board 删除或拖拽语义。
- 最后运行 schema/change/all strict validation、`git diff --check` 与 untracked whitespace check；停在独立 code review、用户视觉验收和显式 archive 授权前，不 sync/archive/stage/commit。

## Tasks 13–14 Apply Evidence — 2026-10-27

### Red / Green / Refactor

- **Red：**focused reducer/Renderer tests 先要求 detail field union 只有 `title | description`，详情中
  不存在 Placement/Column 行、编辑入口或 combobox；Cypress 同时锁定三档 viewport 的标题/close
  间距、描述全宽、普通短内容高度，以及 sheet/close/footer 六轴稳定性。失败来自旧 detail Column
  分支、旧固定高度和 read/edit 表面尺寸不一致，而不是放宽阈值或删除有效断言。
- **Green：**删除 detail-only `select-column` reducer action、Column JSX/i18n/CSS，保留
  `confirmed.columnId`。标题只读态与单行 input 均使用 `35px` border-box 高度；这修复了旧 input
  比只读标题高约 `4px`、居中 Dialog 在切换时整体上移约 `2px` 的根因。描述成为全宽多行主体，
  sheet 使用 `height: auto` 与 viewport `max-height`，普通短内容不再被固定高度撑开。
- **Refactor：**直接受影响 React 保持单一 reducer 状态机、稳定 callback/ref 与既有 StrictMode
  late-response fencing；没有引入新依赖、跨项目抽象或 API 分支。Desktop architecture、
  responsibilities、testing-strategy 与 design-foundation 已同步稳定 shell、无详情 Column 入口、
  Placement context 保留和 `≤1 CSS px` geometry contract。

### 本轮实际执行结果

以下结果只记录 2026-10-27 Tasks 13–14 实际执行；不复用上方 2026-10-26 旧布局计数：

| Command / check | Actual result |
| --- | --- |
| focused Vitest：`work-item-detail-state.test.ts` + `project-board.test.tsx` | 2 files，57/57 passed |
| focused Cypress component（Electron，`video=true`） | 24/24 passed，17 screenshots，video 已生成 |
| `pnpm --filter @taskpilot/desktop qualityCheck` | typecheck、lint、Main 125、Renderer 123、architecture 10、coverage 258、production build 全通过；coverage statements 85.3%、branches 78.6%、functions 84.53%、lines 90.33% |
| `pnpm --filter @taskpilot/desktop test:e2e` | 40/40：first-use 12、project-board 24、select-control 4 |
| `pnpm --filter @taskpilot/desktop test:system` | `BUILD SUCCESSFUL`；真实 Core API/PostgreSQL/Redis seam 的 Desktop system journey 通过 |
| OpenSpec schema/change/all strict validation | schema valid；Change valid；11 passed、0 failed，仅主规格既有 long-requirement INFO |
| `git diff --check` + untracked artifact whitespace check | 无错误 |

本轮 Tasks 13–14 的实现 diff 未修改 Core API、数据库 migration 或 API owner，因此没有把历史 Core
full `qualityCheck` 冒充本轮执行，也没有再次运行该 full gate。完整 Change 工作树仍包含此前已实现的
Core/API/数据库修改；`test:system` 本轮实际执行了 Gradle-backed Core API journey，但不等同于 Core
full gate。

### 连续视觉、guideline 与 drift 审查

- 人工检查 12 张中英文截图对照板：普通内容与长内容各覆盖 `960×640`、`1280×800`、
  `1600×900`。标题保持单行 ellipsis、无纵向滚动条且与 close 约 16px；描述全宽、多行，长内容
  由中间区吸收；footer 可达；没有 Placement/Column 行、可见双滚动或横向溢出。普通短内容形成
  清晰的标题—描述—审计 footer 三段结构，没有旧固定高度的大块空白。
- 重新获取 2026-10-27 最新 `web-design-guidelines` 并审查直接受影响的 JSX/CSS：icon close、字段、
  live status、inline error、focus-visible、overscroll、long-content、reduced-motion、日期格式和动效规则
  无 material finding。该审查与当前 host Electron 截图不替代用户专业质感验收或 Windows/macOS
  packaged native smoke。
- 实现、tests、API/migration 与 owner docs 对照确认：内容保存继续发送
  `currentColumnId === targetColumnId === confirmed.columnId`；WorkItem/Placement 身份、所有权、
  authorization、version、原子 Placement API、Board 拖拽和 Board 删除语义未改变。三个 delta specs
  与实现一致，可进入后续独立 review，但本轮不执行 sync 或 archive。

## Apply Plan — 2026-10-27 Visual Acceptance Follow-up (Task 15)

用户在真实界面验收中确认两个剩余缺陷：`620px` 详情主宽度在桌面 Board 上显得局促；描述内容在
多行 surface 中呈现为垂直居中，而不是正常的左上文字原点。本切片只修正 Focused Work Sheet 的
视觉尺度和文字排版，不改变业务模型、字段状态机、隐式保存、API、Placement、Board 拖拽或删除语义。

- **Red：**在标准桌面 viewport 断言 sheet 约 `760px`，描述 preview 的文字 bounds 与 surface 左上
  padding 对齐；空描述 textarea 约 `128px`，computed `text-align`/`align-content` 明确为 left/start。
- **Green：**使用 `min(760px, calc(100vw - safe-gap))`，保持小窗口自适应；read/edit 描述共用
  `128px` 最小 slot，并分别以 flex start 与 textarea start alignment 固定文字原点。
- **稳定性：**不设置固定 sheet height；短内容仍 content-adaptive，长内容仍由 viewport-bounded
  中间正文滚动。read/edit 两态共享高度，因此不得重新引入点击或保存时的 shell/footer 闪动。
- **验证：**focused Vitest、带 video Cypress、中英文三档截图、Desktop qualityCheck、受影响 E2E、
  最新 web guidelines、OpenSpec strict validation 与 whitespace checks；native smoke 和用户最终质感
  验收仍为 release gap。


## Task 15 Apply Evidence — 2026-10-27

### Red / Green / Refactor

- **Red：**标准 viewport 的新增 Cypress 几何断言在旧样式上准确失败：sheet 仍约 `620px`，描述
  read/edit slot 仍约 `82px`，preview/textarea 没有明确的左上文字原点；首轮结果为 22/24。
- **Green：**`.work-item-sheet` 改为 `min(760px, calc(100vw - 40px))`，描述 preview 与 textarea
  共用 `128px` 最小高度；preview 使用 flex start/start，textarea 显式使用 left/start。未设置固定整窗
  高度，原有 viewport max-height、正文滚动 owner、header/footer 固定关系保持不变。
- **Refactor：**长内容场景的唯一剩余失败来自 sheet 增宽后，打开前的 Card 指针坐标恰好落入描述
  hover 区域，而断言仍要求非 hover 透明背景。测试先把真实 Chromium 指针移动到 close affordance，再
  采样静态字段样式；没有删除 hover 反馈或削弱布局断言。Desktop design-foundation、architecture、
  testing-strategy 与 Change design/test-plan 已统一 `760px`、viewport-safe、`128px` 和左上文字原点契约。

### 本轮实际执行结果

| Command / check | Actual result |
| --- | --- |
| Red focused Cypress | 22/24 passed；新增宽度和描述几何场景按预期失败 |
| focused Vitest：`work-item-detail-state.test.ts` + `project-board.test.tsx` | 2 files，57/57 passed |
| focused Cypress component（Electron，`video=true`） | 24/24 passed，17 screenshots，video 已生成 |
| `pnpm --filter @taskpilot/desktop qualityCheck` | typecheck、lint、Main 125、Renderer 123、architecture 10、coverage 258、production build 全通过；coverage statements 85.3%、branches 78.6%、functions 84.53%、lines 90.33% |
| `pnpm --filter @taskpilot/desktop test:e2e` | 40/40：first-use 12、project-board 24、select-control 4 |

`test:system` 本切片未重跑：生产变更仅为 Renderer CSS，未修改 React 状态机、Main/Preload、共享
contract、Core API、数据库或 system seam；focused Chromium、完整 Desktop component E2E 与 build
是本轮直接受影响证据。此前 system 结果不冒充本轮通过。打包 Electron 真实窗口以及 Windows/macOS
原生视觉、键盘、字体和滚动条 smoke 仍未执行。

### 视觉、guideline 与 model-drift 审查

- 人工复核中英文普通/长内容在 `960×640`、`1280×800`、`1600×900` 的新截图：桌面 sheet 宽度
  更舒展，小窗口不越界；标题保持单行 ellipsis；描述文字从左上 padding 起排，底部创建/更新时间
  保持可见；长内容只由中间正文滚动，没有横向溢出或可见双滚动。
- 重新获取 2026-10-27 最新 `web-design-guidelines`，复核直接受影响 JSX/CSS 的语义控件、label /
  aria-label、focus-visible、modal overscroll、长内容、reduced motion 和动效属性；无新增 material
  finding。该审查与 headless Electron 截图不替代用户最终专业质感验收或 packaged native smoke。
- 本轮只改变 sheet 和 description 的 CSS 几何及其测试/owner 文档。reducer、隐式保存、API payload、
  WorkItem/Placement 身份与版本、Board 拖拽和永久删除语义均未变化，因此没有业务模型或公开 contract
  变更，也不需要修改 delta specs。


## Apply Plan — 2026-10-27 Visual Acceptance Follow-up (Task 16)

用户确认上轮只放大宽度与描述 slot，普通内容的整窗高度仍显得偏小；标题进入编辑虽然外框六轴稳定，
但只读文字原点与 input 的 `border + 6px padding` 不一致，产生明显的横向跳动和视觉抖动。本切片将
桌面详情改为 viewport-responsive 的稳定工作面板：标准 `1280×800` 约 `480px` 高，最小窗口安全收缩，
新增空间由描述主体吸收，footer 固定；标题 read/edit 使用相同 content origin、字体 metrics 与 box model，
编辑 boundary 使用预留的同尺寸全框字段空间。业务模型、reducer、隐式保存、API、Placement、拖拽和删除均不变。

### Task 16 verification

- **Red：**focused Cypress 在标准 viewport 量得旧短面板仅 `288.5px` 高；标题 input 的真实文字原点因 `border + 6px padding` 相对只读标题右移 `6px`。
- **Geometry contract：**标准桌面 sheet 高度断言为 `470–490px`；最小窗口保持 viewport-safe。标题比较实际文字原点、`font-family/size/weight/letter-spacing/line-height`、同尺寸 structural border/padding，并覆盖 read → edit → saving → success/error。
- **Interaction contract：**标题 read/edit 共享预留的全框字段空间，编辑态使用与描述一致的 action-colored 边界/ring；描述 preview/textarea 共享同一弹性主体 slot、至少 `240px` 可用高度且文字位于左上。
- **Green evidence：**带 video 的 focused Cypress 为 `24/24`；标准面板约 `480px`，标题连续截图中的文字、close、sheet 与 footer 均稳定，描述读写高度差在 `1 CSS px` 阈值内。其余 focused/broad 门禁按 Task 16.4 完成后记录。
