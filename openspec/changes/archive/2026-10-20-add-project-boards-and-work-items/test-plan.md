# Test Plan

## Scope and Risk

本 Change 同时改变 Project Work 业务模型、发布前数据库 baseline、Project/onboarding 事务、Desktop HTTP/OpenAPI、Electron Main/Preload 边界及 Renderer Board 交互，整体为 **High**。逃逸缺陷可能造成跨 Project 数据泄露、重复 Work Item、丢失 Board 布局、Project 删除不完整、session/旧响应串线，或产生只可用鼠标操作且双语溢出的核心页面。

验证遵循 `services/core-api/docs/testing-strategy.md` 与 `apps/desktop/docs/testing-strategy.md`：不在每层重复全部场景；业务不变量和并发优先由真实 PostgreSQL 模块集成测试证明，HTTP/OpenAPI 只证明 adapter/contract，Main 测试证明 secret/IPC/generation 边界，Renderer/Cypress 证明交互与视觉可达，system journey 只串联关键首次使用路径。

不验证 TEAM、成员管理、Work Item Type/自定义字段、独立 Board/Work Item 删除、Workflow/Agent、realtime、离线队列、公共 API、生产升级或 Windows 发布认证。本机 packaged smoke 不能替代 Windows/macOS 双平台发布证据。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| V1 schema、主键/约束/索引、Project 范围复合 FK、RESTRICT | PostgreSQL migration integration | 扩展 `WorkspaceProjectMigrationIntegrationTest` / `PostgreSqlFoundationIntegrationTest`，从空库迁移并检查 catalog、非法跨范围插入、唯一约束和删除限制 | 只有真实 PostgreSQL 能证明约束及 Flyway 行为 |
| 注册与 Project 创建原子产生 OWNER+Board+Column，locale 固化 | PostgreSQL module integration | 扩展 onboarding transaction/concurrency 与 `ProjectApplicationIntegrationTest`；故障注入验证全回滚 | 最低可靠层可直接观察一个事务内的业务事实 |
| Board/Column/Work Item 创建、确定性读取、幂等重试及异载荷冲突 | PostgreSQL module integration，Red-Green-Refactor | 新增 Project Work integration cases，覆盖 Board 排序、同键同载荷、不同载荷、并发相同 request id；Work Item 创建覆盖当前/过期 expected Board version、成功重试先返回原结果及失败时不产生 Work Item/Placement | 并发、唯一约束、Board 栅栏和返回原对象需要真实数据库 |
| Board 至少一列、空列删除、完整重排、跨 Board ID 拒绝 | PostgreSQL module integration | 覆盖最后/非空列冲突，遗漏/重复/跨 Board 顺序不改变数据 | 这是事务与关系不变量，不应只在 Controller 测 |
| Work Item 权威内容、Card 无副本、多 Board Placement | PostgreSQL module integration | 验证更新 Work Item 后两个 Board 读取一致，placement 各自保持位置/version | 能检测复制内容或错误归属模型 |
| 编辑 Work Item 并跨列移动的原子性 | PostgreSQL module integration，Red-Green-Refactor | 覆盖内容与跨列移动一次成功、移动到目标列末尾；Work Item/Board/Placement 版本冲突及错误 Board/Column 范围均全回滚；同列内容编辑不改变 Board/Placement version | 真实事务层才能证明没有标题已保存但位置失败的半成功 |
| Card 移动、Board/Placement/锚点并发冲突与回滚 | PostgreSQL contention integration | 两连接竞争移动、过期版本/锚点、其他 Board 不变、连续稳定顺序 | 防止最后写赢造成静默布局丢失 |
| Project Danger Zone 原子删除已批准子树、未知依赖 RESTRICT | PostgreSQL module/migration integration | 成功删除顺序、故障/未知 FK 下全保留、名称/version 冲突 | 数据丢失风险必须在真实事务和 FK 上证明 |
| bearer、OWNER、Workspace/Project/Board 路径范围及 Problem Details | Spring HTTP integration | 扩展认证 HTTP tests，覆盖 201/200/204、401/404/409/503、稳定 code、跨范围 not-found | Controller、安全链与异常映射的拥有层 |
| 运行时 OpenAPI 路径、schema、安全、秘密卫生、退役路径 | OpenAPI contract integration | 扩展 `OpenApiIntegrationTest` / production docs test，固定 Project Work path set、状态、Problem Details 与无独立 delete | 防止运行时契约与客户端漂移 |
| Main transport、最近 Board、generation/response-key fencing、refresh | Vitest Main/architecture | client/coordinator/store/IPC/preload tests；旧 session/Project/Board 响应不可提交；同一 Board mutation 成功后，更早启动的迟到 Board read 也不可提交 | Electron trust boundary 不由 Renderer 测试替代 |
| Board UI 创建/编辑/切换、权威错误/空态、乐观移动回滚 | Vitest Renderer，Red-Green-Refactor | Renderer 组件测试覆盖成功、失败、焦点、live region、退出返回登录、无虚假数据，以及 Work Item PATCH 成功后旧 Board GET 晚到不覆盖新内容 | 快速确定性覆盖状态机、同 Board 响应顺序与可访问语义 |
| 拖拽最近边缘落点、单一等高占位槽、周围 Card 的 FLIP 让位动画、非仅颜色的目标列反馈、键盘等价、横向滚动、长英文、reduced-motion | Vitest Renderer + Cypress component | 目标列有多张 Card 时分别覆盖第一张前、两张之间和最后一张后，断言正确 `beforeWorkItemId`、仅一个占位槽及目标列结构反馈；真实 Chromium 断言受影响 Card 使用 `180ms` 位移动画且 reduced-motion 不启动该动画；`960×640` zh-CN/en 覆盖焦点、错误公告和 DOM 尺寸 | Vitest 确定性覆盖落点边界，真实 Chromium 证明布局、动画调用和指针事件 |
| 首次 GitHub 注册直接进入初始 Board，重登恢复最近 Board | Desktop system journey | 扩展 `DesktopSystemJourneyTest` 跨 Main/IPC/Preload、Core API、PostgreSQL、Redis | 只在此层证明各边界真正串联 |
| 双语消息完整、用户数据不翻译、即时切换不重取数据 | Renderer/i18n tests + Cypress | message key 对齐、切换 locale 保持 snapshot、初始名称创建后固定 | 同时防止目录缺键与运行时业务数据漂移 |
| capability/schema ownership 未漂移 | Modulith/ArchUnit/source ownership | 既有 architecture tests 加 Project Work SQL/依赖断言 | 防止为名词拆模块或跨 capability 私有访问 |

## Implementation and Verification Approach

### Slice 1: Project Work persistence 与 provisioning

采用 Red-Green-Refactor。先让 migration/catalog、注册、Project 创建、Project 删除和 Project Work application integration tests 因缺少表/行为失败；再重写 V1、增加同一 Project capability 内的 contracts/application/JDBC，并通过事务/约束完成；最后提取规范化、指纹、排序和 view mapping，保持 SQL ownership 与覆盖率门槛。

### Slice 2: Core API Desktop contract

采用 Red-Green-Refactor。先扩展 HTTP/OpenAPI tests 固定路径、认证、状态、schema 与错误；再增加显式 Controller/DTO/Problem mapping；最后去重共享 transport/错误配置，不建立 generic CRUD 或暴露 persistence type。

### Slice 3: Desktop Main/Preload boundary

采用 Red-Green-Refactor。先写 transport、client、coordinator、recent-board store、IPC schema 与 generation fencing 测试；再实现最窄能力；最后运行 architecture tests 确认 Renderer 无 URL/bearer/fetch、Preload 无 generic IPC。

### Slice 4: Renderer Board experience

先按 `frontend-design` 明确单一 Board 视觉方向和全部状态，再采用 Red-Green-Refactor 写 Renderer 行为测试并以 `vercel-react-best-practices` 实现。随后添加 Cypress 真实布局/键盘/指针证据，执行 `web-design-guidelines` review 并修复 material findings。不新增状态库或拖拽依赖，除非实现过程中出现经重新批准的必要性。

### Slice 5: Integrated journey 与文档反馈

扩展一次关键 system journey，而不把所有分支重复到 E2E。完成后对照 specs 审计代码、V1、OpenAPI、测试与运行证据；把已证实规则同步到 business model、root/child architecture、responsibilities、testing strategy 与 design foundation，未实现部分继续标为 Target。

## Verification Commands

### Focused

- `./gradlew --no-daemon :services:core-api:test --tests "*WorkspaceProjectMigrationIntegrationTest" --tests "*PostgreSqlFoundationIntegrationTest" --tests "*ProjectApplicationIntegrationTest" --tests "*Onboarding*IntegrationTest"`：migration、Project Work 不变量、幂等、并发与 provisioning。
- `./gradlew --no-daemon :services:core-api:test --tests "*AuthenticationHttpIntegrationTest" --tests "*OpenApiIntegrationTest" --tests "*ProjectProblemHandlerTest"`：Desktop HTTP/OpenAPI/Problem Details。
- `pnpm --filter @taskpilot/desktop test:main -- project-work-client.test.ts project-work-coordinator.test.ts recent-board-store.test.ts ipc-contract.test.ts preload-api.test.ts`：Main/Preload 能力与 fencing。
- `pnpm --filter @taskpilot/desktop test:renderer -- project-board.test.tsx internationalization.test.tsx`：Board 状态、交互和双语。
- `pnpm --filter @taskpilot/desktop test:e2e`：`960×640` Chromium 下的拖拽、键盘、焦点、横向布局和长英文；拖拽同时保留合成 `DataTransfer` 的边界/错误分支测试，并至少用一条 CDP 原生鼠标输入路径证明真实 Chromium drag session 可完成移动。

### Affected and Cross-Boundary

- `./gradlew --no-daemon :services:core-api:qualityCheck`：Core API 全套测试、架构、格式、静态分析、coverage、build contract。
- `pnpm --filter @taskpilot/desktop qualityCheck`：Desktop typecheck、lint、Main/Renderer/architecture、coverage 与 build。
- `pnpm --filter @taskpilot/desktop test:system`：编译后的 Electron 边界至 Core API/PostgreSQL/Redis 的关键 journey。
- `pnpm dev:test`：开发生命周期与自动数据库恢复脚本回归。
- `pnpm check`：仓库 affected quality gate。
- `pnpm --filter @taskpilot/desktop test:packaged-native`：当前主机打包与 native credential smoke；只报告实际平台。
- `openspec schema validate taskpilot-sdd --verbose`、`openspec validate --all --strict --no-interactive`、`git diff --check`：规划/规格结构及 diff 卫生，不替代行为测试。

## Manual Evidence and Automation Gaps

- **Board 视觉走查（Owner：本 Change 实施者 + 用户验收）**：在真实 Electron `960×640` 与标准窗口检查 zh-CN/en 的层级、密度、滚动、拖拽落点、焦点和错误回滚。原因：DOM/Cypress 不能完整判断视觉质量与 native chrome 协调。
- **真实 GitHub 登录后首次落点（Owner：用户验收）**：用开发配置新注册一次，确认直接进入初始 Board；重启确认最近 Board 恢复。原因：自动 system journey 使用 provider/browser double，不声称真实 GitHub OAuth 已验证。
- **平台缺口**：当前主机 packaged-native 只证明实际执行的平台；Windows 原生 drag/focus、credential 和打包验收仍是后续发布 gate，不因本 Change 自动化而宣称完成。
- **性能缺口**：当前无真实大规模 Board 数据分布，因此不承诺大 Board SLO；若后续实测整数重排或 Board 查询成为瓶颈，由性能 gate 与独立排序设计处理。
