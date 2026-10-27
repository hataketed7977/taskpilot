# Tasks

## 1. Core API 空 Board 永久删除

- [x] 1.1 **Red：**在 `ProjectWorkApplicationIntegrationTest` 增加多空 Column Board 删除成功且 Work Item 保留，以及非空、过期 version、名称不匹配、错误 Workspace/Project/OWNER、限制依赖时全量回滚的测试；业务冲突固定断言 `BOARD_NOT_EMPTY`、`BOARD_VERSION_CONFLICT`、`BOARD_NAME_CONFIRMATION_MISMATCH`、`BOARD_DELETE_RESTRICTED`；运行 `./gradlew --no-daemon :services:core-api:test --tests "*ProjectWorkApplicationIntegrationTest"`，确认新增断言只因删除 use case 尚不存在而失败。
- [x] 1.2 **Green：**扩展 Project Work 公共命令/use case 与事务实现：锁定并校验 Board，将四类业务冲突稳定映射为 `BOARD_NOT_EMPTY`、`BOARD_VERSION_CONFLICT`、`BOARD_NAME_CONFIRMATION_MISMATCH`、`BOARD_DELETE_RESTRICTED`，显式按 Columns→Board 删除且不操作 Work Items；重复运行 1.1 focused test 至通过。
- [x] 1.3 **Red：**在 `AuthenticationHttpIntegrationTest` 与 `OpenApiIntegrationTest` 增加 `POST .../boards/{boardId}/permanent-deletion`、bearer、`expectedVersion`/`confirmationName`、`204`、四个稳定 Problem Details code 均为 `409` 和不再为 `405` 的契约断言；运行 focused tests，确认仅因 endpoint/contract 未实现而失败。
- [x] 1.4 **Green/Refactor：**实现 controller、请求 DTO、Problem handler 与 OpenAPI 描述，固定四个业务冲突的 `409` 映射，消除重复校验但不改变 capability 边界；运行 `./gradlew --no-daemon :services:core-api:test --tests "*ProjectWorkApplicationIntegrationTest" --tests "*AuthenticationHttpIntegrationTest" --tests "*OpenApiIntegrationTest"` 至通过。
- [x] 1.5 在本切片更新 `docs/business-model.md`，将空 Board 永久删除、Project 可拥有零 Board、删除 Board 不删除 Work Item 标为与实现相符的 Current；同时更新 `services/core-api/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md` 中 Project Work 当前 endpoint、事务职责与不可逆删除验证，以文档 diff 对照 1.2–1.4 的实际 API/测试，且不把局部契约重复提升到根架构。

## 2. Desktop Main/Preload 删除编排与异步资格

- [x] 2.1 **Red：**在 Main coordinator/client/recent-store、Preload 与 IPC 测试中增加固定删除请求、明确 `204` 后偏好清理和最早 Board/零 Board home、偏好失败、refresh 失败，以及无权威响应后的三态调和：list 不含 Board、仍含 Board、list 也失败；同时覆盖 session/Project 隔离、reconciliation isolation 和删除/调和后旧 read/detail/mutation 后到；运行 test plan 的 focused Main 命令，确认新增断言因能力、tombstone/isolation/start token 尚不存在而失败。
- [x] 2.2 **Green：**扩展共享 `DeleteBoardInput`/详情作用域 schema、Project Work client、coordinator、IPC allowlist 和 Preload capability；明确 `204` 时返回权威 `BoardHomeView` 并区分已提交删除与 refresh 失败；无权威响应时不自动重发，隔离 Board scope 并以权威列表调和为永久 tombstone、解除隔离且递增 generation，或维持隔离并返回“删除结果未知”；以操作开始 token、selection intent 与 generation fencing 阻止迟到提交；重复 focused Main tests 至通过。
- [x] 2.3 **Refactor：**收敛 Board scope key、response key、reconciliation isolation 和偏好串行写入逻辑，验证结果未知时仅允许重试调和或离开 Project、不可继续该 Board mutation，并验证 Renderer 未获得 URL、bearer、通用 IPC 或偏好文件访问；运行 `pnpm --filter @taskpilot/desktop test:main` 与 `pnpm --filter @taskpilot/desktop test:architecture`。
- [x] 2.4 更新 `apps/desktop/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md` 中 Main/Preload 删除编排、Board tombstone/response fencing 和测试职责；以文档 diff 与 focused test 名称证明 Current 描述对应实际实现。

## 3. Renderer Board 删除体验

- [x] 3.1 按 `frontend-design` 读取既有设计基础并记录当前 Board 局部危险操作、确认 Dialog、loading/error/disabled/focus/keyboard/reduced-motion/`960×640` 的唯一视觉方案；完成标准是实现说明明确复用既有视觉语言且未引入新依赖或第二套 Dialog/按钮系统。
- [x] 3.2 **Red：**在 Renderer integration tests 增加删除入口、精确名称、脏确认、pending 防重复、四个稳定业务错误、成功后的剩余/零 Board home、“删除结果未知”的操作限制、已提交但 refresh 失败和焦点恢复；运行 focused Renderer test 并确认因 UI 尚不存在而失败。
- [x] 3.3 **Green：**按 `vercel-react-best-practices` 实现 Board 删除入口、不可逆/空 Board/Work Item 保留说明、名称确认和 response-key commit；结果未知时显示仅可重试调和或离开 Project 的状态，并阻止该 Board mutation；补充 `zh-CN`/`en` 文案及样式，重复 focused Renderer test 至通过。
- [x] 3.4 在 Cypress 增加键盘删除、脏 Escape、pending、成功回退、删除结果未知及重试/离开限制、双语长名称、最小窗口与 reduced-motion 场景；运行 `pnpm --filter @taskpilot/desktop exec cypress run --component --spec cypress/component/project-board.cy.tsx`，修复后确保既有拖拽与 Select/Dialog 旅程不回归。
- [x] 3.5 更新 `apps/desktop/docs/design-foundation.md` 的 Current 危险操作、确认和零 Board 交互规则，并与 3.1 方案及 Cypress fixture 对照检查。

## 4. Work Item 只读详情与单字段编辑（修订前已完成基线）

> 本组记录最初批准并已完成的显式保存实现；第 6 组以已确认的隐式保存交互取代其日常保存/取消和 dirty-gate 语义。

- [x] 4.1 **Red：**为专用详情状态转换增加 `closed/loading/read-only/editing(clean|dirty)/saving/conflict`、单 active field、保存/放弃/继续编辑、clean 字段 Escape 退出、dirty 字段 Escape/外部关闭门禁和迟到读取测试；运行 focused Renderer tests，确认失败来自状态机尚未实现。
- [x] 4.2 **Green/Refactor：**实现独立 Work Item detail 状态与组件，以 scoped `openWorkItem` 权威读取替换直接 `edit-card` 整表单，保持 Card 投影只作定位/占位；读取成功、失败、重试、切 Card/Board/关闭后的迟到结果和安全焦点回退测试通过。
- [x] 4.3 **Red：**增加标题和描述字段测试：只激活一个字段、从最新 confirmed baseline 构造请求、标题 Enter、描述换行与 `Ctrl/Cmd+Enter`、validation/暂时失败保留草稿、成功同步详情和 Card；运行 focused Renderer tests 观察缺失行为失败。
- [x] 4.4 **Green/Refactor：**实现标题/描述的只读触发器、field-local draft/error/save/cancel，不复用旧 Card snapshot 覆盖确认值；重复 4.3 tests 至通过并保持可见 hover/focus affordance。
- [x] 4.5 **Red：**增加 Column 字段测试：统一 Select 的临时选择与显式保存、当前 Work Item/Board/Placement versions、原子移动、菜单取消、version conflict 后重载权威 Work Item+Board、最新值与本地草稿的显式放弃/重试；运行 focused Renderer tests 观察失败。
- [x] 4.6 **Green/Refactor：**接入 Column 单字段编辑和现有原子 Work Item PATCH，按 Select→clean/dirty 字段→只读详情层级处理 Escape 与焦点：第一次 Escape 只关 Select，clean 字段退出，dirty 字段要求保存/放弃/继续编辑，回到只读详情后才允许关闭；重复 4.5 tests，并运行 Core API 原子编辑既有 focused tests确保服务端内容/Placement 不发生部分写入。
- [x] 4.7 在 Cypress 将原“点击 Card 直接编辑”旅程改为先只读详情，再覆盖标题、描述、Column、clean/dirty 草稿、保存/放弃/继续编辑、冲突、portal/Escape/focus、Card 消失回退、中英长内容和 `960×640`；运行单 spec Cypress 至通过。
- [x] 4.8 更新 `apps/desktop/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md`、`design-foundation.md` 中 Work Item detail 的 Current 状态所有权、字段编辑职责、可访问交互与验证 seam；删除已不再真实的“整表单直接编辑”描述，并记录详情/字段编辑只是 Desktop UI 状态，不新增 Work Item 业务生命周期或业务模型概念。

## 5. 跨边界验证与模型/文档反馈

- [x] 5.1 扩展 `DesktopSystemJourneyTest` 的代表性成功路径：创建空 Board→永久删除→剩余或零 Board→重新创建，以及 Card→只读详情→字段保存；串行运行 `pnpm --filter @taskpilot/desktop test:system`，不在 system test 重复 Core API 拒绝矩阵或制造 response-lost 网络时序，三态调和与隔离由 Main deterministic tests 负责。
- [x] 5.2 对照已批准模型与实现代码、SQL 限制、HTTP/OpenAPI、IPC、Renderer 状态、自动化和操作证据执行 model-drift audit；确认 Board/Column/Placement/WorkItem 所有权、零 Board、空 Board 删除、Work Item 保留、详情状态和并发恢复没有漂移，发现行为决策缺口则暂停并更新/重新批准 Change。
- [x] 5.3 复核 `docs/business-model.md` 已在 Slice 1 随实现更新且其 Current/Target 与证据一致，不在本阶段首次补写业务规则；复核 `docs/architecture.md`，仅在跨项目边界实际变化时更新，否则在 apply evidence 中记录 Core API 授权、Main 凭据请求、Renderer 非真相边界均未变化的代码证据；复核所有子项目文档已随所属切片更新。
- [x] 5.4 串行运行 `./gradlew --no-daemon :services:core-api:qualityCheck`、`pnpm --filter @taskpilot/desktop qualityCheck`、`pnpm --filter @taskpilot/desktop test:e2e` 与 `pnpm --filter @taskpilot/desktop test:system`，记录实际结果且不把未执行的平台/手工证据标为通过。
- [x] 5.5 运行 `openspec schema validate taskpilot-sdd --verbose`、`openspec validate add-board-deletion-and-card-detail-view --strict --no-interactive`、`openspec validate --all --strict --no-interactive` 和 `git diff --check`；逐项自审实际 diff 对照 proposal/specs/design/test-plan/tasks，并确认两个 delta specs 已具备后续明确授权时的 sync readiness。
- [x] 5.6 对全部已实现用户界面执行 `web-design-guidelines` 最终审查并处理 material findings；记录当前平台手工视觉/键盘检查与 Windows/macOS 尚未验证的发布风险，然后停在独立 code review、用户手工验收和显式 archive 授权之前。

## 6. Work Item 隐式保存与 Quiet Precision 修订

- [x] 6.1 使用 `frontend-design` 对照 `apps/desktop/docs/design-foundation.md`，把已批准的 Quiet Precision 方向落实为标题、描述、Column、保存反馈、字段错误、冲突恢复、最小窗口与 reduced-motion 的单一视觉方案；以方案记录和现有界面 source review 证明不引入新的全局设计系统、装饰性渐变或常驻操作栏。
- [x] 6.2 **Red：**扩展 `work-item-detail-state` focused tests，覆盖标题 Enter/真正失焦、描述真正失焦/`Ctrl/Cmd+Enter`、字段 `Escape` 恢复确认值、保存快照、`pendingIntent`、同一草稿重复提交去重，以及切换/关闭保存成功后继续、失败/冲突时停留；运行 focused state tests，确认失败来自旧显式保存/dirty-gate 行为。
- [x] 6.3 **Green/Refactor：**按 `vercel-react-best-practices` 更新详情状态转换和 React 连接，移除正常路径保存/取消与三按钮门禁，实现字段类型驱动提交、待完成意图和轻量 `saving/saved` 反馈；重复 6.2 tests 至通过，并确认请求仍从最新 confirmed baseline 构造且保持版本/原子写入契约。
- [x] 6.4 **Red：**扩展 Renderer/Cypress tests，覆盖 Select portal 内焦点移动不提交、选择新 Column 只提交一次、菜单 Escape/原值不提交、外部 dismiss 先保存、validation/暂时失败/冲突异常区、焦点恢复、无常驻按钮、双语长内容、`960×640` 与 reduced motion；运行 focused Renderer 与单 spec Cypress，确认缺失行为失败。
- [x] 6.5 **Green/Refactor：**实现 portal 逻辑焦点边界、Column 选择即保存、字段内错误/精简恢复动作和 Quiet Precision 样式/动效；重复 6.4 tests 至通过，且不得通过弱化断言、转移生产逻辑或恢复日常操作按钮规避失败。
- [x] 6.6 随该切片更新 `apps/desktop/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md`、`design-foundation.md` 的 Current 状态所有权、自动保存/焦点/反馈规则和验证 seam；复核 `docs/business-model.md` 与根 `docs/architecture.md`，记录 Work Item 身份、生命周期、授权、API 和跨项目边界没有变化的证据。

## 7. 修订后跨边界验证与模型/文档反馈

- [x] 7.1 更新 portable system journey 的代表性 Card 成功路径为原位编辑后的隐式保存；串行运行 `pnpm --filter @taskpilot/desktop test:system`，不在 system test 重复 portal、失败矩阵或视觉断言。
- [x] 7.2 对照修订后的 proposal/specs/design/test-plan，审计实现代码、请求版本、原子 API、Renderer 状态、焦点恢复、自动化和操作证据；确认只改变 Desktop 详情交互语义，未改变 Work Item/BoardPlacement 所有权、生命周期、授权或持久化不变量，发现漂移则暂停并更新/重新批准 Change。
- [x] 7.3 串行运行 `pnpm --filter @taskpilot/desktop qualityCheck`、`pnpm --filter @taskpilot/desktop test:e2e` 和 `pnpm --filter @taskpilot/desktop test:system`；仅在实际受影响时重跑 Core API focused/quality gate，并记录不重跑的 API/服务端无变更证据。
- [x] 7.4 运行 `openspec schema validate taskpilot-sdd --verbose`、`openspec validate add-board-deletion-and-card-detail-view --strict --no-interactive`、`openspec validate --all --strict --no-interactive` 和 `git diff --check`；确认 owner docs 的 Current/Target 与实现一致、两个 delta specs 保持 sync readiness。
- [x] 7.5 使用 `web-design-guidelines` 完成最终 UI/UX/无障碍审查并处理 material findings；在当前平台 Electron/Chromium 检查中英文 `960×640`、`1280×800`、宽窗口、键盘、portal、保存反馈与 reduced motion，记录 Windows/macOS 原生烟测仍属发布风险后，停在独立 code review、用户手工验收和显式 archive 授权之前。

> **修订说明：** 1–7 组保留为此前已完成 Apply 的历史记录；其中“服务端/表结构/生命周期不变”“两个 delta specs”以及 Quiet Precision 详情布局等结论已被本次确认的 proposal、三个 delta specs、design 与 test plan 取代。以下 8–10 组是新的未完成 Apply 范围，旧勾选不得作为这些任务已完成的证据。

## 8. Work Item 无状态模型与 Core API 契约修正

- [x] 8.1 **Red：**在 `WorkspaceProjectMigrationIntegrationTest`（或同级既有 migration/catalog test）新增空 PostgreSQL 执行 `V1__initialize_taskpilot.sql` 后的 exact catalog 断言：`work_items` 不存在 `lifecycle` column 与 `ck_work_items__lifecycle_supported`，其余当前字段、外键、唯一性和并发约束仍存在；运行 `./gradlew --no-daemon :services:core-api:test --tests "*WorkspaceProjectMigrationIntegrationTest"`，确认失败仅来自现有 V1 仍声明错误字段。
- [x] 8.2 **Red：**扩展 `ProjectWorkApplicationIntegrationTest`、`AuthenticationHttpIntegrationTest` 与 `OpenApiIntegrationTest`，要求 Work Item create/detail/edit 和 Board/Card exact response/OpenAPI properties 均不含 `lifecycle`、`status` 或固定 `OPEN`，并回归 identity、version、audit、授权、原子回滚以及同一 Work Item 在多个 Board 的 Column/Placement 独立；运行 focused Core API tests，确认失败来自现有 SQL/view/schema 仍暴露字段而非环境或无关编译错误。
- [x] 8.3 **Green：**直接修正首次发布前基线 `V1__initialize_taskpilot.sql`，删除 lifecycle column/check constraint，并从 SQL insert/select/mapper、Kotlin `WorkItemView`/`CardView`、application service、controller serialization 和运行时 OpenAPI 中完整删除该字段；不得新增 V2、Flyway repair、optional/nullable/deprecated 兼容字段或 Column→状态映射；重复 8.1–8.2 focused tests 至通过。
- [x] 8.4 **Refactor：**删除 Core API tests、builders、fixtures 和 helper 中仅为固定 `OPEN` 存在的参数/断言，保持 Board move 只更新当前 Placement；以 `rg -n 'lifecycle|OPEN|status' services/core-api` 分类所有残留，允许未来概念说明和明确否定，禁止当前 DTO、SQL、schema 或 fixture 依赖。
- [x] 8.5 随本切片更新 `docs/business-model.md`，把“当前实现没有 Work Item 状态能力、Column 只描述特定 Board Placement”标为与实现相符的 Current，同时保留已批准的 Target `Open`、`Completed`、`Cancelled` 状态机及 reopen 转换；注明后续独立 Change 负责其 persistence/API、权限、历史与多 Board 集成，而不是重新决定该状态集合或合法转换。更新 `services/core-api/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md` 的 V1、Project Work response 与验证职责。若根 `docs/architecture.md` 的跨项目边界未改变，记录代码/API 证据而不重复局部字段清单。
- [x] 8.6 串行运行 `./gradlew --no-daemon :services:core-api:qualityCheck`，记录 migration/catalog、application/HTTP、OpenAPI、format、Detekt、architecture、coverage 与 build 的实际结果；若发现 released baseline 或不可丢弃数据库证据，立即暂停并回到 Change 更新/批准生产迁移方案。

## 9. Desktop strict contract 与 Focused Work Sheet

- [x] 9.1 **Red：**扩展 `project-work-client`、transport、coordinator、IPC/Preload tests，使不含 lifecycle/status 的新 Work Item/Card shape 通过 strict Zod/共享 contract，注入旧 `lifecycle` 或 `status` 的 response fail closed；运行 test plan 的 focused Main 命令，确认失败来自现有 schema/fixture 仍依赖旧字段。
- [x] 9.2 **Green/Refactor：**从共享 TypeScript contract、Zod parser、Main client/coordinator、IPC/Preload response、Renderer props、fixtures、system seam 与双语文案中完整删除 lifecycle/status/`OPEN`；不得以 optional、nullable、unknown passthrough 或隐藏 UI 的方式保留，并重复 9.1 focused tests 至通过。
- [x] 9.3 **Red：**扩展 Renderer integration tests，要求实际 Work Item 标题成为唯一 Dialog heading，且“工作项详情”、重复标题、“当前看板”、状态/进行中区域、字段卡片式选中容器和永久空白保存槽均缺席；同时锁定描述正文、“所在列表”紧凑属性行、合并审计 footer、条件 saving/saved/error、现有失焦保存与冲突恢复语义。
- [x] 9.4 **Red：**扩展 `project-board.cy.tsx`，在中英文、长内容、`960×640`、`1280×800` 与宽窗口下覆盖 heading/accessibility tree、标题/正文间距、portal 焦点、Column 选择即保存、平整静态态与局部 focus-visible、无布局跳动、reduced motion 和审计 footer；运行单 spec，确认失败来自旧详情信息架构与样式。
- [x] 9.5 **Green/Refactor：**按 `vercel-react-best-practices` 实现已批准的 Focused Work Sheet：以 actual title 为标题，描述为正文，Column 为“所在列表”属性行，创建/更新时间为弱化 footer；移除重复标题、当前看板、状态、整块字段卡片和常驻反馈占位，只在 hover/focus/editing/error/saving/saved 时提供邻近且可访问的反馈。保留保存快照、`pendingIntent`、原子请求、portal 逻辑焦点边界、冲突恢复和关闭后焦点语义，重复 9.3–9.4 tests 至通过。
- [x] 9.6 更新 `apps/desktop/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md`、`design-foundation.md` 的 Current strict contract、无状态文案、Focused Work Sheet 信息架构、条件反馈、焦点与测试 seam；以文档 diff、组件结构和测试名称证明对应实际实现，不把详情 UI 状态描述成 Work Item 生命周期。
- [x] 9.7 运行 `pnpm --filter @taskpilot/desktop qualityCheck` 与 `pnpm --filter @taskpilot/desktop test:e2e`；随后使用 `web-design-guidelines` 对已实现界面做最终 UI/UX/无障碍审查，修复 material findings，并记录当前平台尚待用户完成的视觉/键盘验收与 Windows/macOS 原生发布证据。

## 10. 修订后跨边界验证与模型/文档反馈

- [x] 10.1 更新 portable system journey 的代表性成功路径，使编译后的 Main/IPC/Preload 从真实 Core API 接收无 lifecycle/status 的 Work Item/Card response，打开以实际标题命名的详情并完成一次隐式保存；串行运行 `pnpm --filter @taskpilot/desktop test:system`，不复制 focused 层的全部拒绝矩阵。
- [x] 10.2 对 SQL、Kotlin、OpenAPI、TypeScript/Zod、Renderer、i18n、fixtures、tests 和 owning docs 执行 `lifecycle|status|OPEN|工作项详情|当前看板|进行中` source search 并逐项分类；清除所有当前固定字段、展示、测试依赖和误导文案，只保留已批准的 Target 状态机、未来实现说明、明确否定或与本模型无关且有证据的同名概念。
- [x] 10.3 对照修订后的 proposal、三个 delta specs、design 与 test plan，执行 model-drift/documentation-feedback audit：确认 Work Item 当前实现无状态、Column 只属于 Board-local Placement、V1/JSON/OpenAPI/Desktop strict shape 一致，且 business model 继续保留 Target `Open`、`Completed`、`Cancelled` 与 reopen 转换；确认隐式保存/授权/版本/删除不变量未漂移，把稳定结论反馈到 business model、Core API/Desktop owner docs，或记录无需改根架构的证据。
- [x] 10.4 串行重跑 `./gradlew --no-daemon :services:core-api:qualityCheck`、`pnpm --filter @taskpilot/desktop qualityCheck`、`pnpm --filter @taskpilot/desktop test:e2e` 与 `pnpm --filter @taskpilot/desktop test:system`；记录实际结果，不以局部通过代替任一直接受影响边界，也不把未执行的平台/手工证据标为通过。
- [x] 10.5 运行 `openspec schema validate taskpilot-sdd --verbose`、`openspec validate add-board-deletion-and-card-detail-view --strict --no-interactive`、`openspec validate --all --strict --no-interactive` 和 `git diff --check`；逐项自审实际 diff 对照规划并确认三个 delta specs 的后续 sync readiness。
- [x] 10.6 完成实现自审后停在独立 code review、用户手工视觉/业务验收和显式 archive 授权之前；不得因任务完成、自动化通过或 self-review 无 finding 自动 sync/archive。

## 11. Stable Focused Work Sheet 动态交互修订

> 1–10 组的 58 个已完成任务保留为此前 Apply 历史，不表示本轮用户验收缺陷已修复。以下任务须在独立规划审查后，经用户再次明确授权 Apply 才能实施。

- [x] 11.1 **Red：**扩展 `project-board.cy.tsx`，在标题、空/单行/多行描述和 Column 上逐步采样 read→edit→saving→success/validation/temporary failure/conflict 的 panel bounds、关闭按钮、footer、常驻标签和文本原点；对没有新增换行或其他真实 footprint 增长的状态转换使用每轴 `≤1 CSS px` 阈值，并保存连续截图/视频。运行 focused Cypress，确认失败来自现有 content-sized Dialog、`rows={6}` 或标签卸载，而非字体加载、计时或无关快照。
- [x] 11.2 **Red：**扩展 reducer/Renderer tests，要求 saving 期间保留 editor/draft/`pendingIntent`，权威成功才切换等占位 read surface；失败/冲突保留标签、scroll 与恢复动作；IME composition 的 Enter 不提交；快速 A→B/close 和重复事件仍只保存一个 snapshot。运行 focused Vitest，记录由缺失行为导致的预期失败。
- [x] 11.3 **Green：**在现有 Work Item detail 内实现 viewport-adaptive 稳定 shell、固定 header/关闭按钮和 audit footer、单一主内容 scroll owner；不得用高度动画或任意 `min-height` 掩盖 reflow。以 11.1 的 geometry probes 证明字段模式切换不改变 shell 边界或视觉中心。
- [x] 11.4 **Green：**实现复用的字段 identity/layout slots：title read/input 匹配字体与文字原点且不新增可见“标题”标签；“描述”和“所在列表”在所有状态常驻；description preview/textarea 与 Column value/Select 等占位；反馈只在身份行右侧原位替换。保留现有 palette、Inter Variable、原子保存和 reducer 并发语义。
- [x] 11.5 **Green/Refactor：**保留 saving editor/draft 与字段/主内容 scroll，权威成功后切换等占位 reading surface；validation、暂时失败、冲突继续保留 `pendingIntent` 和恢复入口；添加 IME composition guard、局部 hover/focus-visible affordance 与 reduced-motion 处理，不引入 debounce autosave、永久 toolbar、富文本、新依赖或全局视觉重做。重复 11.1–11.2 focused tests 至通过，并按 `vercel-react-best-practices` 自审直接受影响 React。
- [x] 11.6 更新 `apps/desktop/docs/design-foundation.md`、`testing-strategy.md` 及实际受影响的 `architecture.md`/`responsibilities.md`：仅在实现证据成立后把稳定 shell、常驻标签、scroll ownership 和状态序列标为 Current；若某 owner 无职责变化，以 diff/组件边界记录无需修改的原因。

## 12. 动态体验验证与模型/文档反馈

- [x] 12.1 运行 focused Renderer 与带 video 的 Cypress 命令，覆盖空描述、单行、多行、长标题、中文 IME、快速字段切换、慢网络、键盘、portal 和 reduced motion；检查产出的连续截图/视频与 geometry log，不以单张终态截图替代。
- [x] 12.2 运行 `pnpm --filter @taskpilot/desktop qualityCheck`、`pnpm --filter @taskpilot/desktop test:e2e` 与 `pnpm --filter @taskpilot/desktop test:system`；所有 Gradle-backed gate 串行。若 diff 未触及 Core API/数据库/API owner，以 source/diff 审计和此前历史 gate 说明不重跑 Core full gate；若触及则串行重跑 `./gradlew --no-daemon :services:core-api:qualityCheck`。
- [x] 12.3 获取最新 `web-design-guidelines`，对直接受影响 UI 做最终可访问性/键盘/表单/响应式审查并修复 material findings；在当前平台真实操作完整状态序列，记录仍需用户完成的专业质感验收与 Windows/macOS 原生发布证据。
- [x] 12.4 对照 proposal、三个 delta specs、design 和 test plan 执行 model-drift/documentation-feedback audit：确认本轮只改变详情呈现，WorkItem/Placement 身份、所有权、状态、授权、API、版本和 Board 删除语义均未漂移；反馈稳定结论到 Desktop owner docs，确认 `project-boards` 与 `desktop-api-documentation` delta 无需修改，并复核主规格 sync readiness。
- [x] 12.5 运行 `pnpm exec openspec schema validate taskpilot-sdd --verbose`、`pnpm exec openspec validate add-board-deletion-and-card-detail-view --strict --no-interactive`、`pnpm exec openspec validate --all --strict --no-interactive`、`git diff --check` 和 untracked artifact whitespace checks；自审实际实现 diff 后停在独立 code review、用户手工验收与显式 archive 授权之前，不自动 sync/archive/stage/commit。


## 13. Focused Work Sheet 信息架构收敛

- [x] 13.1 **Red：**更新 `work-item-detail-state.test.ts` 与 `project-board.test.tsx`，要求详情字段仅有 title/description、无 Placement/Column 行或编辑入口、footer 保留，且内容保存仍携带 confirmed Column context；运行 focused Vitest 并确认失败来自现有 detail Column 分支。
- [x] 13.2 **Red：**更新 `project-board.cy.tsx`，在三种 viewport 验证标题占满 close 左侧可用宽度并保持约 16px gap、description preview/textarea 全宽多行、短内容无旧固定高度留白，以及 read/title-edit/description-edit 的 sheet/close/footer 稳定；运行带 video 的 focused Cypress 并记录预期失败。
- [x] 13.3 **Green：**将 detail reducer 收敛为 `title | description`，删除 `select-column` 和详情 Column JSX/i18n/CSS；保留 `confirmed.columnId` 作为完整 PATCH context，不改变 Core API、Main/Preload、Board 拖拽或原子 Placement 能力。
- [x] 13.4 **Green：**实现 content-adaptive、viewport-bounded shell；让标题 heading/input 使用关闭按钮左侧全部剩余宽度并保留约 16px gap，让描述成为完整内容宽度的多行主体，footer 保留且普通短内容不产生大块无效留白。
- [x] 13.5 **Refactor：**按 `vercel-react-best-practices` 自审直接受影响 React，更新 Desktop architecture/responsibilities/testing-strategy/design-foundation 的 Current 描述，并重复 focused Vitest/Cypress 至通过。

## 14. 验证、模型与文档反馈

- [x] 14.1 运行带 video 的 focused Cypress 并人工检查 `960×640`、`1280×800`、`1600×900` 连续截图，确认中英文、标题、全宽多行描述、footer、空白密度、键盘、IME、失败/冲突和 reduced motion 的整体体验。
- [x] 14.2 串行运行 `pnpm --filter @taskpilot/desktop qualityCheck`、`test:e2e`、`test:system`；若本轮未触及 Core API/数据库/API owner，以 diff/source audit 记录不重跑 Core full gate，不能把历史结果冒充本轮执行。
- [x] 14.3 获取最新 `web-design-guidelines` 并审查直接受影响 UI，修复 material findings；记录仍需用户完成的视觉验收和 Windows/macOS 原生发布 smoke。
- [x] 14.4 对照实现、tests、API/migration 和 owner docs执行 model-drift/documentation-feedback audit，确认详情移除 Column 入口不改变 Placement 模型、原子 API、Board 拖拽与删除语义，并确认三个 delta specs 的 sync readiness。
- [x] 14.5 运行 OpenSpec schema/change/all strict validation、`git diff --check` 和 untracked whitespace checks；完成 self-review 后停在独立 code review、用户手工验收与显式 archive 授权之前，不自动 sync/archive/stage/commit。

## 15. 用户视觉验收修正：详情尺度与描述文字原点

- [x] 15.1 **Red：**更新 focused Cypress，要求标准桌面 viewport 的详情 sheet 使用约 `760px` 主宽度，描述 preview 的文字原点位于左上 padding，空描述 textarea 具有舒适的多行高度且显式左上排版；确认旧 `620px`/`82px` 样式失败。
- [x] 15.2 **Green：**将 Focused Work Sheet 主宽度调整为 `min(760px, viewport safe width)`，将描述 read/edit 共用 slot 提升为约 `128px`，并对 preview 与 textarea 显式设置左对齐、顶部对齐；保留 content-adaptive 高度和 viewport max-height，不恢复固定整窗高度。
- [x] 15.3 **Refactor：**复核标题/close/footer 与 read/edit/saving/success/error/conflict 几何稳定性，更新直接拥有该视觉契约的 Desktop design/architecture/testing 文档和 Change design/test-plan，不改变 reducer、API、Placement 或 Board 行为。
- [x] 15.4 运行 focused Vitest 与带 video 的 focused Cypress，人工检查中英文三档 viewport 新截图；随后运行 Desktop `qualityCheck` 和受影响的 E2E，记录未执行的 native/system 风险，不复用旧视觉结果。
- [x] 15.5 重新执行最新 `web-design-guidelines` 审查、OpenSpec schema/change/all strict validation、`git diff --check` 和 untracked whitespace check；完成 self-review 后仍停在独立 CR、用户视觉验收与显式 archive 授权前。


## 16. 用户视觉验收修正：详情高度与标题编辑稳定性

- [x] 16.1 **Red：**更新 focused Cypress，要求标准桌面 viewport 的详情 sheet 高度约 `480px`、最小窗口按 viewport 自适应，并直接比较标题只读文字与 input 的 content origin、字体 metrics 和 box model；确认当前短面板与 `6px` input padding/边框造成失败。
- [x] 16.2 **Green：**使用 viewport-responsive 的稳定详情高度（标准窗口约 `480px`），由描述主体吸收新增空间且 footer 固定；标题 input 移除会移动文字的 padding/布局边框，以不占布局的 inset boundary/focus ring 表达编辑态。
- [x] 16.3 **Refactor：**复核 read/edit/saving/success/error/conflict 的 sheet、close、footer 和标题文字原点稳定性，更新 Change design/test-plan 与 Desktop design/architecture/testing owner docs；不改变 reducer、保存、API、Placement 或 Board 行为。
- [x] 16.4 运行 focused Vitest、带 video 的 focused Cypress并人工比较标题 read/edit 连续截图及中英文三档 viewport；运行 Desktop `qualityCheck`、受影响 E2E、最新 UI guideline 与 OpenSpec/whitespace gates，停在用户视觉验收、独立 CR 和显式 archive 授权前。
