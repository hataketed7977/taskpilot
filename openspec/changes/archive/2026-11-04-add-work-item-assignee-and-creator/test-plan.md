# Test Plan

## Scope and Risk

范围覆盖 canonical OpenAPI/route manifest、Core API Project Work persistence/API/OpenAPI、Project Member list read、Desktop Main/Preload contracts、Renderer Board Card 与 Work Item detail UI，以及对应业务/架构/测试文档更新。主要风险是责任人归属错误、跨 Project 成员泄露或误分配、创建人与责任人混淆、乐观并发和原子回滚破坏、Card projection 复制出第二份责任人事实、以及详情 UI 引入布局抖动或不可访问选择器。

风险等级为中高：错误实现会把工作责任分配给项目外人员、误导用户当前负责人，或在未来 Agent/history 能力前留下不兼容的数据模型。非目标验证：不测试历史版本、Activity timeline、Agent picker、Project member 管理、生命周期/status、通知、评论或实时同步，因为本 Change 不实现这些能力。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| Work Item 读取返回 immutable `createdBy` 和 nullable/current `assignee` | Core API application + HTTP contract | `ProjectWorkApplicationIntegrationTest`/HTTP Work Item detail tests assert creator summary, `assignee=null`, assigned member summary, no lifecycle/status | 应用/HTTP 层同时覆盖 persistence join、DTO 映射和当前 API contract |
| 创建默认未分配，创建时可显式指定当前 Project Member | Core API application tests with Red-Green-Refactor | Create Work Item tests for omitted assignee, valid member assignee, idempotent replay includes assignee | 业务边界清晰，应用层最快证明事务和幂等语义 |
| 创建/编辑拒绝非项目成员、跨 Project membership、unknown membership、inactive user、unsupported target type | Core API application + HTTP error tests | Parameterized rejection tests assert no Work Item/Placement/assignee change and stable Problem Details | 这是安全/租户边界，必须在服务端验证，不能靠 UI |
| 责任人设置、替换、清空递增 Work Item version/updatedAt且不改变 createdBy | Core API application tests | Assignee-only mutation tests assert version increment, creator stable, `assignee` changed/cleared | 应用层能确定性验证状态转换和审计字段 |
| 责任人与标题/描述/Placement 同请求原子回滚 | Core API application/integration tests | Invalid assignee combined with content and Placement context leaves content, assignee, Board and Placement versions unchanged | 捕获最容易遗漏的跨字段事务一致性 |
| 过期 Work Item version 修改责任人冲突 | Core API HTTP/application tests | stale version returns conflict code; response path reloads authoritative Work Item/Board as current edit does | 版本冲突是用户可见恢复路径，需要契约级证据 |
| Card projection 包含 Work Item assignee，责任人修改不改变 Placement version，Card move 不改变 assignee | Core API application + Board HTTP tests | Board read with assigned Work Item; two-Board fixture; move card then verify assignee unchanged; edit assignee then verify placement version unchanged | Board/Card 投影语义属于服务端事实，不应只由 Renderer mock 证明 |
| Project Member list API 只返回当前 Project active members 并保留通用成员模型 | Canonical contract + Core API HTTP/OpenAPI tests | `GET /v1/projects/{projectId}/members` has access bearer and `x-taskpilot-ingress: canonical`; candidate list with multiple Projects/users returns role/avatar/name/id and no outside members | Contract 层防止路径/manifest 漂移，API 层覆盖授权、范围、schema 和文档契约 |
| Canonical OpenAPI 文档化 PersonSummary/assignee/Project Member/errors 且不暴露 Agent 假能力 | `:contracts:canonical-api:qualityCheck` + Core `OpenApiIntegrationTest` + source review | checked-in artifact asserts schemas/paths/codes/ingress and absence of Agent picker/current fake endpoints; runtime OpenAPI shows the same artifact in Local/Test | 防止 canonical contract、Gateway manifest、Desktop contract 与 runtime docs 漂移 |
| Desktop Main transport/parsers接受新字段并 fail-closed on unknown/invalid shapes | Main contract tests | Zod/strict parser fixtures for WorkItem/Card/Project Members, nullable assignee, unsupported target type rejection at boundary as appropriate | Main 是 Renderer 能力边界，必须阻止契约漂移或宽松解析 |
| Renderer Card 低噪声展示责任人头像，未分配不喧宾夺主 | Renderer tests + Cypress browser component | Card renders assigned avatar accessible name/tooltip; unassigned state minimal; real Chromium screenshot/DOM layout assertions as appropriate | jsdom 覆盖语义，Cypress 覆盖真实布局/hover/focus 风险 |
| Work Item detail 以责任人作为可编辑属性，并在 audit footer 对齐不可编辑创建人和创建/更新时间，且不破坏标题/描述编辑稳定性 | Renderer integration + Cypress | open detail, edit title/description, open/close picker, save/error; assert heading remains title, creator stays in the footer, default picker caps at 6 members, searched results cap at 8 matches with overflow hints, and geometry/focus does not regress | 之前该区域有视觉抖动风险，浏览器证据必要 |
| 编辑标题/描述时请求打开责任人选择器 | Reducer + Renderer integration + Cypress | dirty draft triggers exactly one content save; picker remains closed while pending, opens and focuses search only after success; failure/conflict preserves draft and recovery without opening picker | 跨控件导航必须遵守自动保存语义，不能以禁用光标阻断真实可用操作或抢走焦点 |
| 责任人选择器搜索、键盘、清空、loading/error/retry、reduced-motion | Renderer integration + accessibility-oriented Cypress | keyboard-only select member/clear; accessible names; loading and network error; reduced-motion disables nonessential transitions | 选择器是新交互，需覆盖键盘/AT/状态恢复 |
| Desktop 迟到响应/版本冲突不把失败责任人写入 Card 或丢失草稿 | Renderer state tests | mocked delayed mutation/read responses under Board generation/session fencing; assert authoritative state wins | Renderer state机最能捕获迟到调和问题 |
| 不提供 history/versions/activity endpoints or UI-only logs | Canonical OpenAPI/route-manifest source review + Renderer tests | absence assertions in OpenAPI/contract if practical; source review and UI tests verify no activity feed/history affordance | 本 Change 的非目标需要防止“顺手做半成品历史” |
| 文档 Current/Target 与实现一致 | Documentation review + OpenSpec validate | Update/check root business/architecture, Core API docs, Desktop docs; final semantic drift audit | 文档语义不能由测试自动推导，需要人工对照模型和实现 |

## Implementation and Verification Approach

### Slice 1: Core API model, migration, and Work Item contracts

对清晰业务行为采用 Red-Green-Refactor：先补应用/HTTP tests 表达 creator、nullable assignee、默认未分配、valid member assignment、non-member rejection、stale version 和 atomic rollback；再实现 migration/schema、DTO/use-case/query 更新；最后重构重复 join/summary mapping。迁移测试需验证 FK/check 约束能防止跨 Project assignment 或由应用层配合约束防止。

### Slice 2: Canonical contract, Project Member API, and OpenAPI

采用 contract-first focused tests：先更新 checked-in canonical OpenAPI/contract tests，冻结 `GET /v1/projects/{projectId}/members`、`PersonSummary`、`AssigneeTarget`、Problem Details codes、`x-taskpilot-ingress: canonical` 和无 Agent 假能力；再实现 Core use case/controller/transport model。只做读取 Project Members，不创建成员管理入口，也不手写 Gateway route list。

### Slice 3: Desktop Main/Preload/shared contracts

直接实现契约更新并补/改 boundary tests。更新 TypeScript shared contracts、Main API adapter、strict parsers、fixtures 和 IPC能力；运行 Main contract tests、typecheck 和 lint。这里不做 UI 行为断言，只证明 Renderer 收到的能力边界正确。

### Slice 4: Renderer Card/detail/picker UI

Apply 阶段先按 Desktop AGENTS 执行 `frontend-design`，确定 assignee property row、creator/timestamp audit footer、Card avatar 和 picker状态的视觉方案，再用 `vercel-react-best-practices` 指导 React state/query implementation。使用 Renderer tests 驱动责任人展示、选择、清空、错误恢复、迟到响应调和；使用 Cypress component 覆盖真实 Chromium 中的布局稳定、hover/focus、keyboard、Portal/弹层和 reduced-motion。

### Slice 5: Documentation and semantic drift audit

直接更新 owning docs 和 main/delta specs sync owner说明。最终对照 proposal/spec/design、migration/API/Renderer diff 和测试证据，确认创建人、责任人、成员候选、历史非目标、Agent 预留与 Current/Target 文档一致。

## Verification Commands

### Focused

- `./gradlew --no-daemon :services:core-api:test --tests "*ProjectWorkApplicationIntegrationTest"`: Work Item create/detail/edit/Board projection, assignee validation, version and rollback behavior。
- `./gradlew --no-daemon :contracts:canonical-api:qualityCheck`: canonical OpenAPI syntax/semantics, generated Core interfaces, and Gateway route manifest projection.
- `./gradlew --no-daemon :services:core-api:test --tests "*AuthenticationHttpIntegrationTest" --tests "*OpenApiIntegrationTest"`: Core HTTP/OpenAPI schema、Problem Details、auth/security documentation；若 Project Work HTTP tests 位于其他类，Apply 时替换为实际 focused class。
- `./gradlew --no-daemon :services:core-api:test --tests "*WorkspaceProjectMigrationIntegrationTest"`: PostgreSQL schema/FK/check/migration constraints for current assignee。
- `corepack pnpm --filter @taskpilot/desktop test:main`: Desktop Main transport/parser/IPC contract focused coverage。
- `corepack pnpm --filter @taskpilot/desktop test:renderer`: Renderer state/component tests for Card avatar-only DOM semantics plus detail/picker; Apply 可进一步用 `--testNamePattern` 先跑 focused cases。
- `corepack pnpm --filter @taskpilot/desktop test:e2e -- --component`: Cypress component browser evidence for Board Card fixed height, top-right avatar, title/description clamping, and detail/picker visual interaction；如仓库脚本名称不同，使用 `apps/desktop/docs/testing-strategy.md` 当前等价 Cypress component 命令。

### Affected and Cross-Boundary

- `./gradlew --no-daemon :services:core-api:qualityCheck`: Core API affected gate after persistence/API/OpenAPI updates。
- `./gradlew --no-daemon :services:gateway:qualityCheck`: Gateway manifest admission and transport policy gate after adding the new canonical operation; no hand-written route list is expected。
- `corepack pnpm --filter @taskpilot/desktop qualityCheck`: Desktop typecheck/lint/unit/browser applicable gate after UI/contract changes。
- `openspec validate --all --strict --no-interactive`: Active Change and main specs structural validation。
- `git diff --check`: whitespace/conflict marker sanity for planning and implementation diffs。

## Manual Evidence and Automation Gaps

Manual acceptance is recommended after implementation because the user explicitly cares about “专业”的卡片/详情体验 and subtle perceived layout stability. Owner: product/user or implementing agent with screenshot/video evidence. Scope: macOS packaged or dev Electron window at normal and narrow sizes; verify equal Card height across assigned/unassigned and short/long content, top-right avatar visual weight, title/description truncation, assignee-property and creator/timestamp footer alignment, capped default/search picker lists with overflow hints, dirty-field save-before-picker flow, picker keyboard flow, no title/description jitter, and clear error states. This manual pass complements but does not replace Cypress/Renderer checks.
