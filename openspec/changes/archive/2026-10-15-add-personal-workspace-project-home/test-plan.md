# Test Plan

## Scope and Risk

受影响区域是 Core API 的业务模型、Flyway/PostgreSQL、Access/Workspace/Project/Onboarding capability 边界、注册事务、Workspace/Project HTTP 与 OpenAPI，以及 Desktop Main/Preload/Renderer/i18n/应用壳。总体为高正确性与中高安全风险：逸出缺陷可能产生完整性破坏的半账号、越权跨 Workspace 读写、不可逆误删、重复 Project、旧 User 数据串入新 session，或把 Target TEAM 行为误标为 Current。

验证遵循 `services/core-api/docs/testing-strategy.md` 和 `apps/desktop/docs/testing-strategy.md`，优先最低可靠层；PostgreSQL 约束、锁、事务与 Flyway 使用真实 Testcontainers，HTTP/安全/OpenAPI 使用 Spring 集成，跨进程边界使用 Main/Preload contract，用户状态使用 Renderer/Cypress。TDD 用于边界清晰的业务行为，不用于 migration、文档或视觉流程本身。

非目标：不验证 TEAM 行为、其他 Project 角色、成员管理、Board/Work Item/Workflow/Agent、Agent Runtime、生产无损 migration、回收站/异步清理、真实 GitHub OAuth 或另一未执行操作系统的发布就绪性。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| 完整注册创建 7 类事实且任一步失败全回滚 | Core application + PostgreSQL Testcontainers | 成功断言行与关系；分别注入 Project 配置失败/约束失败并断言所有表无残留、无 session issue 调用 | 真实本地事务和 FK/唯一约束不可由 mock 证明 |
| Workspace schema 与 capability owner 一致 | Flyway metadata + architecture | 断言 Workspace 两表只位于 `workspace` schema、`access` 不含 Workspace 表、Project FK 指向 `workspace.workspaces`；Workspace persistence 不读取 Access 私表 | 同时固定数据库 owner 与代码边界 |
| Capability 依赖方向 | Spring Modulith + ArchUnit/source SQL | 固定 `workspace -> access`、`project -> access,workspace`、`onboarding -> access,workspace,project`；禁止非 owner 直接引用 implementation 或查询他方私表 | 防止只移动 package/table 而保留错误耦合 |
| 同一 External Identity 并发注册只产生一个完整账号 | PostgreSQL 并发集成 | 双线程/栅栏并发确认，断言一个 User、一个 PERSONAL Workspace、一个默认 Project、各一 Owner Membership，双方解析同一 User | 捕获唯一约束与事务竞态 |
| 每 User 唯一 PERSONAL、TEAM 不暴露 | Flyway schema + API/OpenAPI negative contract | 约束测试拒绝第二 PERSONAL；Workspace API 只返回 PERSONAL；无 TEAM create/member 路径 | 同时证明数据库不变量和当前外部表面 |
| Workspace/Project 授权与跨租户访问不泄露 | Spring security/API integration | Workspace OWNER 可创建且无需预存 Project Membership；已有 Project 写入要求 Project OWNER；他人或错误 Workspace+Project 组合均稳定 404，响应无真实归属 | HTTP 层拥有认证与错误映射风险 |
| 默认名称由法律 locale 决定且默认 Project 无特殊语义 | Application/persistence | `zh-CN/en` 分别断言名称与空描述；同一 Project 可改、归档、恢复、删除；schema 无 default flag | 业务策略在应用层，schema review 防止隐藏特例 |
| Project 输入规范化且同 Workspace 重名合法 | Unit + persistence/application | 覆盖 name 1..200、description 0..2000 Unicode code point、首尾空白/空描述与字段错误；创建两个同名 Project 得到不同 ID 与 Owner Membership | 纯边界适合 unit，真实 DB 捕获错误长度/唯一约束 |
| 创建 request id 重试与改载荷冲突 | Application + PostgreSQL concurrency | 同请求重放返回同 ID；并发重放只一行；改 payload 返回 `IDEMPOTENCY_CONFLICT` | 真实唯一约束与指纹比较共同决定结果 |
| 编辑版本冲突不覆盖新值 | Application + API | 两个版本并发更新，后到返回 `PROJECT_VERSION_CONFLICT`，数据库保持先到值 | 证明乐观锁与稳定错误 |
| ACTIVE/ARCHIVED 状态机、列表隔离、重复动作幂等 | Unit policy + persistence/API | 合法转换、实际转换的错误 expected version、ACTIVE/ARCHIVED 筛选；响应丢失后携带转换前旧版本重试目标状态，返回当前 view 且不改 timestamp/version | 纯转换先单测，查询与持久时间用真实 DB |
| Danger Zone 精确名称、Owner、版本与物理删除 | Application + PostgreSQL/API | mismatch、非 Owner、改名竞态、成功删 Membership+Project、最后项目删除后 Workspace 保留 | 不可逆路径必须同时证明授权、锁与数据范围 |
| 未批准子资源阻止删除 | Flyway/constraint integration | 测试依赖 fixture 或 FK 元数据审计证明非 Membership 子资源默认 RESTRICT；当前删除只覆盖 Membership | 捕获通配 cascade 数据丢失风险 |
| 登录落点：新默认、最近有效、确定性 fallback、空态 | Main coordinator unit + Renderer | capability double 覆盖四条分支；排序固定 `createdAt,id`；UI 断言无 onboarding | Main 决定数据解析，Renderer只验证可观察状态 |
| 最近 Project 按 environment+User 分区且存储失败可退化 | Main unit | 多环境/多用户隔离、损坏/写失败 fallback、服务端无权时清除 | 设备偏好所有权在 Main |
| logout/切换账号后的迟到响应被丢弃 | Main/IPC + Renderer async tests | generation、User、Workspace、Project key 不匹配的 list/detail/mutation 响应不提交 UI | 捕获最易出现的数据串号路径 |
| 创建成功响应绑定新 Project identity | Main coordinator unit + Renderer fencing | 断言 create 返回 key 同时包含 WorkspaceId 与服务端 ProjectId，Renderer 接受结果、关闭表单并刷新选择 | 捕获“服务端已创建但 UI 丢弃成功响应”的验收回归 |
| Renderer 无 bearer、fetch、Node/Electron 或 generic IPC | Architecture + contract tests | transport allowlist、Preload shape、forbidden import/secret sentinel scan、sender/origin/generation validation | 静态与边界测试比 UI mock 更可靠 |
| 首页 loading/empty/error/session-expired 可恢复且无假数据 | Renderer Vitest | 骨架、唯一创建 CTA、retry、401 回登录、归档入口；无 TEAM/Board/Agent/指标文案 | 用户状态适合 Preload boundary mock |
| 创建/编辑/归档/恢复/删除交互和焦点 | Cypress component at 960×640 | 键盘完成表单、错误关联、Danger Zone 确认、成功后 fallback、modal focus return | 浏览器真实布局/焦点行为不是 jsdom 强项 |
| zh-CN/en、长名称、reduced motion 和最小窗口 | Cypress component | `960×640` 两语言与长 Project 名称无横向丢失、主动作可见、prefers-reduced-motion 无非必要动效 | 捕获 CSS 折行与响应式缺陷 |
| OpenAPI 与实际路径/security/schema/errors 一致 | Spring OpenAPI contract | 精确路径集合、新操作 bearer/scope/version/requestId/name-confirmation；创建 201、读/改/状态动作 200、删除 204 及对应响应体；共享 Problem Details、未实现路径缺失 | 防止运行时文档漂移 |
| Agent Runtime 不参与 | Desktop architecture/system | composition spy/negative assertion证明登录与 Project journey 不启动、不调用 Runtime | 守住项目边界 |
| PostgreSQL 提交后 Redis session issue 失败 | Application/system integration | 模拟 Redis/session issuer 暂时失败，断言账号完整并可通过随后登录恢复 | 证明跨存储恢复语义而非假原子性 |
| 模型、文档与实现无漂移 | 最终 source review + strict validation | 比对 migration/API/tests 与四份 specs，更新 business/architecture/child docs 的 Current/Target | 测试通过不证明语义和文档所有权一致 |

## Implementation and Verification Approach

### Slice 1: Schema 与模型约束

直接实现重建后的 V1 migration 和最小 persistence types。用 Testcontainers 先固定表、FK、check、唯一与索引契约，再让 migration 通过；不为 migration 文件制造单元 Red。审计所有 `ON DELETE` 范围。

### Slice 2: capability 公共契约与原子注册

对完整成功、逐步失败、并发确认和 session issue 失败采用 Red-Green-Refactor。先写 Onboarding application/Testcontainers 测试，再实现 Access/Project 窄公开契约和事务协调者，最后收窄 Modulith allowed dependencies 与公开 package。

### Slice 3: Workspace/Project 查询、创建和编辑

按用例分组进行 Red-Green-Refactor：先在应用层覆盖范围授权、重名、幂等与版本冲突，再实现 Repository/application，随后用少量 Spring API 测试覆盖 bearer、路径 scope、serialization 和 Problem Details，避免逐层重复全部业务断言。

### Slice 4: 归档、恢复和永久删除

先写状态策略与应用事务测试，包括幂等转换、最后项目、名称/版本竞态和删除限制；实现后再补 HTTP contract。永久删除必须在真实 PostgreSQL 上验证锁、FK 与精确删除范围。

### Slice 5: Runtime OpenAPI

实现 Controller 注解/transport schema 后更新精确路径集合测试和 secret hygiene。此为契约验证，不伪造 TDD；以运行时 `/v3/api-docs` 为证据。

### Slice 6: Desktop Main、Preload 与 session-scoped Project state

先在 Main 单元测试固定 endpoint allowlist、bootstrap fallback、最近 Project 分区、401/session generation、迟到响应和 storage failure；实现窄 typed capability，再更新 IPC validation/architecture tests。Renderer 不直接导入 Main 测试替身。

### Slice 7: Renderer Project shell 与操作

实施前重新使用 `frontend-design` 校准 Quiet control desk。用 Renderer 测试先固定 loading/empty/error/data、无虚假 TEAM、表单和 logout，再以 `vercel-react-best-practices` 实现组件/数据流；Cypress 覆盖 960×640、双语、键盘、焦点、长名称、reduced-motion 和 Danger Zone。最后用 `web-design-guidelines` review，修复 material findings。

### Slice 8: 完整 journey 与文档反馈

用现有 system journey 串联 fake GitHub/loopback、Main/Preload、Core API、PostgreSQL 和 Desktop capability，证明首次注册直达默认 Project、再次登录 fallback 与 Runtime 零依赖。逐切片更新 owning docs，最终执行模型漂移审计、strict OpenSpec 和完整 affected gates；不在此阶段 archive。

## Verification Commands

### Focused

- `./gradlew :services:core-api:test --tests '*Workspace*' --tests '*Project*' --tests '*Onboarding*'`: Core 新业务、事务、持久化、HTTP 与契约的快速定向证据；实现时按实际测试类名收窄。
- `pnpm --filter @taskpilot/desktop test:main`: Main transport、bootstrap、偏好、session generation 与 IPC。
- `pnpm --filter @taskpilot/desktop test:renderer`: Project shell 与所有可观察状态。
- `pnpm --filter @taskpilot/desktop test:architecture`: Renderer/Preload/Main 依赖、secret 与 Runtime 负向边界。
- `pnpm --filter @taskpilot/desktop test:e2e`: Cypress 960×640、双语、键盘、焦点、Danger Zone 与 reduced-motion。

### Affected and Cross-Boundary

- `./gradlew :services:core-api:qualityCheck`: Core compile、format/Detekt、全部 test/Testcontainers、模块/架构、OpenAPI、Kover 和可执行 JAR gate。
- `pnpm --filter @taskpilot/desktop qualityCheck`: Desktop typecheck、lint、Main/Renderer/architecture/coverage 与 build。
- `pnpm --filter @taskpilot/desktop test:packaged-native`: 当前主机 packaged Electron 与 native credential smoke；仅在本 Change 最终验收/发布证据阶段运行。
- `pnpm dev:test`: launcher 生命周期与 disposable local database 修复策略回归，确认重写 V1 不扩大到未知或外部数据库。
- `pnpm check`: focused gates 通过后执行仓库拥有的 Launcher、Desktop 和 Core API 总门禁。
- `pnpm --filter @taskpilot/desktop test:system`: 由 Slice 8 为现有 system journey 补齐并验证的可执行入口；在受控 Core API base URL 下证明 Main/Preload/Core API 跨边界 journey 与 Runtime 零依赖。
- `openspec validate add-personal-workspace-project-home --strict --no-interactive`: 当前 Change 结构与 delta 完整性。
- `openspec validate --all --strict --no-interactive`: 全部主规格与 active Change 一致性。
- `git diff --check`: 规划及后续实现 diff 的空白/冲突标记检查。

若实施改变了受文档管理的命令，先同步最近 testing strategy 与本 test plan；不得并存两套互相矛盾的门禁。

## Manual Evidence and Automation Gaps

- **原生视觉与窗口 chrome（Owner：功能验收者）**：当前开发主机用真实 Electron 在 `960×640` 和常用窗口尺寸检查 Context Spine、背景看板纹理、长名称、菜单、Project Settings 与 Danger Zone 的视觉层级。原因：Cypress 可测溢出与焦点，不能证明最终 Electron 字体渲染和整体观感。
- **真实 GitHub 后再次登录（Owner：功能验收者）**：使用 dev GitHub OAuth 完成首次注册直达默认 Project、logout、再次登录恢复最近 Project。原因：自动 journey 使用 provider/browser doubles，不证明真实系统浏览器 handoff；该证据不重复验证 GitHub 自身认证逻辑。
- **跨平台发布矩阵（Owner：发布 gate）**：macOS 与 Windows 分别保留安装、启动、系统凭据和最终视觉 smoke；未执行的平台不得宣称 release-ready。本 Change 可在单一开发主机完成，但不能用其结果替代另一平台。


## Apply Evidence and Reconciliation

### Model-drift audit

最终实现与已批准模型逐项对照，无未解决的物质漂移：

- `V1__initialize_taskpilot.sql` 以 PERSONAL partial unique index 和 owner/type
  check 固定每个 User 至多一个 PERSONAL Workspace；运行时 Workspace 查询、
  transport/OpenAPI 与 Desktop contract 均只暴露 PERSONAL。TEAM 只存在于统一
  Workspace 持久化类型和内部模型，未增加创建、成员管理或 UI 入口。
- 注册协调器在一个 PostgreSQL 事务中创建 User、External Identity、Terms
  Acceptance、PERSONAL Workspace、Workspace OWNER、普通默认 Project 和 Project
  OWNER；默认 Project 没有特殊标记，和其他 Project 共用状态、版本与完整生命周期。
- 所有 Project 操作重新校验 Workspace OWNER；已有 Project 的读取与写入再校验
  Project OWNER。路径 scope 不匹配或不可访问 ID 使用不泄露真实归属的 404。
- 永久删除锁定并复核 Project、expected version 和精确当前名称，显式删除该
  Project Membership 后物理删除 Project；删除最后一个 Project 仍保留 PERSONAL
  Workspace，不自动补建默认 Project。
- V1 中所有业务外键均为 `ON DELETE RESTRICT`。受保护依赖导致删除回滚并映射
  `PROJECT_DELETE_RESTRICTED`，不存在通配级联。

这些结论由 migration/application/HTTP/OpenAPI/architecture tests 和集成 system
journey 共同覆盖；未借此扩展 TEAM、成员管理、Board、Work Item、Agent 或 Agent
Runtime 范围。

### Executed automated evidence

本次 apply 已实际执行并通过：

- `./gradlew :services:core-api:qualityCheck --no-daemon`
- `pnpm --filter @taskpilot/desktop qualityCheck`
- `pnpm --filter @taskpilot/desktop test:e2e`
- `pnpm --filter @taskpilot/desktop test:system`
- `pnpm dev:test`
- `pnpm check`
- `pnpm --filter @taskpilot/desktop test:packaged-native`

`test:system` 实际跨越编译后的 Main、IPC、Preload、Core API、PostgreSQL 和 Redis，
以 test-only Provider/browser/credential/session-failure doubles 验证首次注册、最近
Project、fallback、最后 Project 空态、session issue 恢复、取消后重试、退役邮箱
路径和 Agent Runtime 零依赖。`test:packaged-native` 在当前 **macOS arm64** 主机通过
凭据 write、fresh-process restore、rotate 和 delete；Windows 未执行，不构成 Windows
release-ready 证据。真实 GitHub OAuth、签名/公证或安装器和最终原生视觉仍属于上文
列出的人工或发布 gate。

### Documentation feedback

稳定结论已反馈到 `docs/business-model.md`、根 `docs/architecture.md`、Core API 与
Desktop 的 architecture/responsibilities/testing strategy，以及 Desktop design
foundation；已落地的注册配置、Workspace/Project API、Main/Preload 消费和 Project
首页标为 Current，TEAM 与后续业务能力保持 Target。

`docs/README.md` 无需修改：本 Change 没有新增、删除、移动、重命名文档，也没有改变
任何文档的 owner、导航入口或清单状态；现有 documentation map 仍能到达所有受影响
文档。

### Final self-review correction

最终 self-review 发现首页 ACTIVE Project 与归档列表虽然使用 cursor API，但客户端只读取
首个 50 条分页，导致第 51 个及后续 Project 没有可达 UI。修复保持现有 API 和 UI 范围：
Main 首页协调器聚合全部 ACTIVE 分页，Renderer 归档面聚合全部 ARCHIVED 分页，并对重复
cursor fail closed；现有列表行使用 `content-visibility` 避免大列表一次性渲染全部离屏内容。
新增 focused tests 在修复前稳定失败、修复后通过。修复后再次执行 Desktop
`qualityCheck`（22 files / 168 tests、coverage、build）、`test:e2e`（12/12）与跨边界
`test:system`；创建成功响应的 `projectId` fencing 回归包含在 Main tests 中。

### Workspace boundary correction evidence

人工验收发现 Workspace 错放在 Access 后，本 Change 在不扩展产品行为的前提下完成架构
纠偏：V1 现在由 `access`、`workspace`、`project` 三个 owner schema 组成；生产代码由独立
Workspace capability 拥有 Workspace 模型、公开授权契约、Controller 与 JDBC，Project 只通过
该公开契约授权；Onboarding 继续在同一个 ambient PostgreSQL transaction 中调用三方
provisioner。source-level SQL ownership test 固定 Workspace 不查询 Access 私表、Project 不查询
Workspace 私表，Modulith test 固定依赖方向。共享 DataSource 自动配置提升到 Core API
composition root，不再由任一业务 capability 偶然拥有。

纠偏后实际重新执行并通过 `:services:core-api:qualityCheck`、Desktop `qualityCheck`、
`test:e2e`、`test:system`、`pnpm dev:test` 与根 `pnpm check`。Core API gate 覆盖 105 tests、
Kover、Detekt、ktlint、Modulith/ArchUnit、migration/HTTP/OpenAPI 和可执行 JAR 构建契约；
Desktop gate 覆盖 Main 98、Renderer 60、architecture 10，并以 168 tests 重跑覆盖率。
本轮未重复执行 `test:packaged-native`；上方已有 macOS arm64 证据仍只证明当时的当前主机
凭据生命周期，不扩大为 Windows 或 release-ready 结论。
