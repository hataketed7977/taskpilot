# Test Plan

## Scope and Risk

本 Change 影响 canonical OpenAPI 与生成投影、Core 注册/Project/Board/Column/Work Item application behavior、Desktop Main/Preload/IPC contracts、Renderer 表单与 Board 菜单，以及相关业务/架构/设计文档。

风险等级为**中高**：文本约束看似局部，但错误实现可能让未来客户端绕过规则、拒绝或截断历史数据、把 omitted 错当成 clear、产生无意义 version、破坏幂等创建，或在指针交互中吞掉真实目标；责任人错误还涉及 Project scope 与原子创建。逃逸缺陷可造成数据不可编辑、部分写入、跨范围信息泄露或危险操作门禁被绕过。

明确非目标：数据库 migration/缩列、唯一性、Work Item lifecycle/status、Agent assignee、assignment history、新设置页面、跨项目表单框架、永久删除语义变更与发布平台签名验证。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| OpenAPI 八类字段上限、required/optional、patch envelope 和 Problem Details path | Contract semantic/generator | 扩展 `ContractToolTest`，解析 write schema 精确断言 80/100/1000/80/1000/50/160/5000、optional scalar、1000/5000 description patch 与 `AssigneePatch` action/value关系、所有 optional-but-non-null mutation property 的 null-fail projection 与 create assignee；检查生成 source不含 Jakarta Bean Validation import/annotation，生成任务成功且输出未被跟踪 | 最早发现 canonical wire contract、生成投影、raw-null 折叠或 UTF-16 runtime validation漂移 |
| generated HTTP binding 不误拒 code-point合法输入 | Core real-HTTP integration | 以 supplementary character构造恰好 limit及 limit+1请求：limit通过generated controller binding并成功，limit+1由Core以稳定字段path拒绝；同时回归关闭Bean Validation前盘点出的结构/格式/数值约束 | 纯application测试无法发现Spring/Jakarta在进入Core前按UTF-16提前拒绝 |
| response 继续接受历史超长值 | Contract + Desktop consumer | response schema 不加入拒绝历史值的 max；Main parser fixture 携带旧容量内但超产品上限的文本仍成功 | 防止把 write policy 误施加到读取边界 |
| trim + NFC + Unicode code-point 边界 | Core pure/application + Renderer pure | ASCII、组合字符、astral character；limit-1/limit/limit+1；空白/NFC；Renderer 对完整候选原子接受/拒绝且 Core 仍最终拒绝绕过客户端的超限请求 | 两端语言字符串模型不同，最低可靠层可精确定位算法偏差 |
| 注册显示名称 1–80 且失败不产生账号事实 | Core onboarding integration + Renderer component | 80 接受、81/空白拒绝并带字段 path；事务表无长期事实；blur/submit feedback 保留草稿 | 事务副作用必须由真实 application/DB 边界证明，UI 只证明提前反馈 |
| Project/Board sparse edit 与历史超长值兼容 | Core HTTP + PostgreSQL integration | 直接 fixture 写入旧容量历史值；optional name 与 descriptionPatch omitted/SET/CLEAR；name、patch property、可省略 patch value 的 raw null 即使伴随其他有效 mutation也以稳定字段 path 在 binding 拒绝；非法 action/value 组合拒绝；只改另一字段成功且旧值逐字保留；提交旧字段超限新值失败；同值/空 mutation 不递增 version | 真实 HTTP binding、持久化与 optimistic version 共同拥有主要回归风险 |
| Work Item sparse title/description/assignee/Placement 原子性 | Core HTTP + PostgreSQL integration | optional title、descriptionPatch 与 assigneePatch 的 omitted/SET/CLEAR；title、patch property、可省略 patch value 的 raw null 即使伴随其他有效 mutation也以稳定字段 path拒绝；非法组合拒绝；只改责任人、只移动 Column、历史长文本不阻塞、无 mutation拒绝、版本冲突全回滚 | 同一事务跨 Work Item 与 Placement，且 generated DTO binding 不能用纯 unit 替代 |
| Project/Board/Column/Work Item 空白与上下限拒绝 | Core application/integration | 每类字段最小边界表、`VALIDATION_FAILED` path、没有部分写入/幂等记录污染 | Core 是所有客户端的最终业务边界 |
| 创建 Work Item 默认未分配与选择 Project Member | Core integration + Desktop Renderer/Main | 未分配和有效成员成功；跨 Project/unknown/inactive 被拒且 Board version 不变；IPC payload携带可选 assignee | Core证明授权/原子性，Desktop证明窄能力传输 |
| assignee 改变创建 fingerprint/request id | Renderer state + Core idempotency integration | UI 选择变化生成新 request id，同载荷 retry复用；Core 同 key 异 assignee 冲突且不重复创建 | 两层分别拥有客户端 retry 身份与服务端幂等事实 |
| 候选加载失败仍可未分配创建 | Renderer component | 失败说明可感知、picker不可伪造候选、submit仍发送 null/omitted assignee；成功后采用权威 Card | 属于客户端恢复行为，无需重复到系统层 |
| required blur/submit、hard limit、80% counter、server path mapping | Renderer pure/component + Cypress | untouched 无错误、blur 空值；limit 接受而 limit+1 候选保留最后合法草稿且不触发 save；选择区替换、delete、undo 可继续；超限 paste 整次拒绝；IME 中间态不干预且超限 commit 原子拒绝；历史超长值完整显示、草稿不超过会话初始历史 ceiling、回到 limit 内才保存；未收敛草稿切换负责人时暂停且不阻塞，负责人以 sparse mutation 保存后采用最新 version并保留草稿；暂停字段权威值并发变化进入 conflict；关闭详情要求继续编辑或放弃并关闭；已知/未知 path、双语/a11y、去重 live status 与 draft/focus 保留 | pure 层固定 Unicode 和决策算法，真实 Chromium 验证 beforeinput/change/composition/paste、caret、focus、字段切换和关闭门禁 |
| 反馈/计数/pending 不使字段头部和主要操作抖动 | Chromium Cypress | 在 zh-CN/en、960×640 与标准 viewport切换 normal/near-limit/limit-reached/required-error/pending，比较关键元素 bounding rect/top | jsdom 不提供可信布局几何，浏览器层检测独特风险 |
| Board 菜单文案、outside pointer 一次点击、Portal inside 与 Escape focus | Renderer integration + Chromium Cypress | `Delete board/删除看板`；外部按钮一次点击生效；Portal option不误关；Escape回 trigger | 真实 pointerdown/click/Portal 顺序需要浏览器证据 |
| 永久删除 Dialog 与轻量菜单隔离 | Renderer component + Cypress | 打开 Dialog 后 menu关闭；Dialog仍显示永久删除警告；outside不绕过 dirty/pending/name match；历史长名称可完整输入匹配 | 防止复用 dismissal 时破坏危险门禁 |
| 搜索/筛选不误用持久字段规则，不创建假页面 | Source review + focused Renderer regression | 只审计当前可达入口；既有 search/filter 测试不出现领域 max；diff检查无新占位 route/API | 这是范围与分类规则，源审查比制造业务测试更可靠 |
| 延迟响应、版本冲突与保存失败恢复 | Existing Renderer state + Core integration | 保留现有 generation fencing、conflict/use-latest、权威 reload 与原子 rollback assertions | 本 Change必须不削弱已有恢复语义，但不在每层重复成功路径 |
| 身份、Card projection、无 lifecycle/status、授权边界不漂移 | Model/document audit + existing architecture/contract tests | diff 对照 `docs/business-model.md`；OpenAPI/consumer tests继续拒绝 status/lifecycle 与跨 Project assignee | 结构测试不能替代语义审计，二者检测不同缺陷 |

## Implementation and Verification Approach

### Slice 1: Canonical contract

先盘点当前生成的 `@Size`、`@Pattern`、数值和嵌套 validation，形成逐项 owner/HTTP 回归清单，并先补齐清单中缺失的 focused HTTP regression；再扩展 contract semantic/generator tests，固定八类字段的 write-only 约束、optional scalar、1000/5000 description patch、`AssigneePatch`、所有 optional-but-non-null mutation property 的 null-fail projection、create assignee 与 response 兼容，并以 generated-source 断言要求不再出现 Jakarta Bean Validation import/annotation（Red）。仅在盘点缺口已有测试 owner 且回归通过后，修改 checked-in OpenAPI、显式保留实际生效的 `useBeanValidation: false` 以关闭 generated Bean Validation projection、删除冗余 `performBeanValidation`，并重新生成到 `build/`（Green）；不引入 custom template、新 validator 依赖、第二份 schema 或 runtime OpenAPI parser。最后按清单跑 real-HTTP 回归、完整 contract gate 并确认生成物未跟踪（Refactor）。

### Slice 2: Core 文本策略与 sparse mutations

按注册、Project/Board/Column、Work Item 边界增加 pure/application、real-HTTP 与 PostgreSQL focused tests。先覆盖 Unicode 边界、supplementary character 通过 generated binding、optional scalar 与 patch envelope 的 omitted/SET/CLEAR、各 optional-but-non-null mutation 属性的 raw null（含 raw null 与另一有效 mutation并存）、历史超长 fixture、空 mutation和事务 rollback（Red）；实现共享字段策略、显式 patch mapping、稳定 binding Problem Details/path 与 application mutation（Green）；再移除旧 DB-sized magic numbers 并保持粗粒度 capability 边界（Refactor）。HTTP tests 拥有 transport binding 及既有结构约束回归，PostgreSQL tests 拥有历史兼容、幂等、version 和跨表原子性证据。

### Slice 3: Desktop typed boundary

先修改 Main/IPC consumer tests，证明 optional scalar、description/assignee patch envelope、typed IPC 不产生 raw null、可选 create assignee、历史 response 和字段 Problem Details mapping（Red）；再更新 shared schema、Preload/Main mapping 和协调器，使用户清空描述唯一映射为 `CLEAR`（Green）；在不暴露 token、URL 或通用 HTTP 的前提下整理重复类型（Refactor）。

### Slice 4: 创建责任人与持久化表单体验

实施前按仓库要求依次使用 `frontend-design` 和 `vercel-react-best-practices`。先在 Renderer tests覆盖默认未分配、候选失败、选择变化 request id、字段 visibility/counter/path mapping，以及达到上限后的候选拒绝、粘贴、IME、修正操作、历史超长值与草稿保留（Red）；实现最小共享 validation/hard-limit semantics和每个现有表单 adapter（Green）；再审计注册、Project、Board/Column、Work Item入口并删除重复逻辑（Refactor），不创建全局 form framework。

### Slice 5: Board 菜单和稳定布局

先用 Renderer/Cypress测试暴露旧菜单文案、outside-click二次点击、Portal误判、Escape焦点，以及 normal/near-limit/limit-reached/pending 的布局位移（Red）；实现 owned-root pointerdown dismissal、Dialog隔离与稳定 feedback slot（Green）；以 `web-design-guidelines` 做最终 UI/UX/a11y review并只修复本 Change引入的问题（Refactor/Review）。

### Slice 6: 文档与跨边界收口

直接更新 owning 文档，不制造 Red/Green：业务不变量归 `docs/business-model.md`，canonical/Core/Desktop职责与测试命令归相应架构/子项目文档，交互节奏归 design foundation。最后执行模型漂移、Current/Target状态、链接和 source review，再跑受影响门禁。

## Verification Commands

所有 Gradle 命令在同一 checkout **串行**执行。

### Focused

- `./gradlew --no-daemon :contracts:canonical-api:test --tests "ai.taskpilot.contracts.ContractToolTest"`: canonical schema、生成与 projection focused evidence。
- `./gradlew --no-daemon :services:core-api:test --tests "*OnboardingProvisioningTransactionIntegrationTest" --tests "*ProjectApplicationIntegrationTest" --tests "*ProjectWorkApplicationIntegrationTest" --tests "*ProjectProblemHandlerTest"`: 注册、Project Work、字段错误与事务 focused evidence；实现时按实际新增测试类补充同类 filter，不用宽泛命令掩盖缺测。
- `pnpm --filter @taskpilot/desktop test:main -- tests/main/ipc/ipc-contract.test.ts tests/main/projects/project-client.test.ts tests/main/projects/project-work-client.test.ts tests/main/projects/project-work-coordinator.test.ts`: Main/IPC sparse与assignee边界。
- `pnpm --filter @taskpilot/desktop test:renderer -- tests/renderer/features/auth tests/renderer/features/shell/project-home.test.tsx tests/renderer/features/board/project-board.test.tsx tests/renderer/features/detail`: 当前持久化表单、创建责任人、菜单与详情状态。
- `pnpm --filter @taskpilot/desktop test:e2e -- --spec cypress/component/board.cy.tsx,cypress/component/shell.cy.tsx`: Chromium pointer/Portal、双语、a11y与几何稳定性。

### Affected and Cross-Boundary

- `./gradlew --no-daemon :contracts:canonical-api:qualityCheck`: parser、semantic、generator、manifest、determinism与artifact boundary完整门禁。
- `./gradlew --no-daemon :services:core-api:qualityCheck`: Core业务、PostgreSQL、HTTP/OpenAPI、架构、lint/format完整门禁。
- `pnpm --filter @taskpilot/desktop qualityCheck`: Desktop typecheck、lint、Main/Renderer/architecture、coverage与build门禁。
- `pnpm --filter @taskpilot/desktop test:e2e`: 全量 Desktop Chromium component门禁。
- `pnpm --filter @taskpilot/desktop test:system`: 编译后的 Main/Preload 到 Core 的关键系统旅程；补充或调整现有 journey只覆盖跨边界独特风险，不重复所有字段矩阵。
- `pnpm check`: 仓库受影响聚合门禁。
- `openspec schema validate taskpilot-sdd --verbose`: repository schema完整性。
- `openspec validate --all --strict --no-interactive`: main specs和 active Change严格验证。
- `git diff --check`: 全仓实现 diff 的 whitespace/conflict-marker sanity，而非只检查 Change目录。

## Manual Evidence and Automation Gaps

实现完成后由产品/开发者在当前支持桌面宿主做一次手工视觉验收：中英文各检查注册、Project/Board/Column、Work Item创建/编辑，在正常、接近上限、达到上限、必填错误和pending间切换时的密度、标签/控件头部对齐、焦点可见性和最小窗口可用性；实际使用中英文输入法、emoji、选择区替换和超限粘贴，确认到达上限仍可删除/撤销且不会进入保存失败“重试”死路；再检查 Board菜单点击页面真实目标、Escape与永久删除Dialog文案。原因是字体栅格、原生输入法、窗口缩放和整体视觉层级无法由 jsdom或固定Chromium几何完全代表。该证据不宣称macOS/Windows安装包、签名、原生凭据或发布质量，也不作为 `tasks.md` checkbox；如发现可稳定复现的几何/交互缺陷，修复时补充Cypress回归。
