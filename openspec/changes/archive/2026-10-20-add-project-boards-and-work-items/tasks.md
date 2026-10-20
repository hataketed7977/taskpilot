# Tasks

## 1. Project Work Persistence and Provisioning

- [x] 1.1 **Red:** 扩展 PostgreSQL migration/catalog tests，固定 `project.boards`、`board_columns`、`work_items`、`board_placements` 的 `id UUID` 主键、复合范围 FK、唯一/顺序/version/check 约束与 `ON DELETE RESTRICT`；运行 focused migration tests，确认仅因缺失新 schema 行为失败。
- [x] 1.2 **Red:** 在 `ProjectApplicationIntegrationTest` 与 onboarding transaction/concurrency tests 中固定注册及 Project 创建原子产生 OWNER+本地化普通 Board+Column、Board/Column/Work Item 幂等创建、Work Item 创建的 expected Board version 与失败原子性、Column 不变量、Work Item 权威内容、多 Board Placement、移动并发和 Project 子树删除/回滚；运行 focused Core API tests，确认失败原因是生产行为缺失。
- [x] 1.3 **Green:** 重写首次发布前 V1，在既有 `project` schema 中加入四张 Project Work 表、索引和数据库范围约束；扩展 onboarding 与 Project provisioning，使注册/Project 创建原子创建普通初始 Board/Column，并保持未知依赖 RESTRICT。
- [x] 1.4 **Green:** 在同一 `project` capability 实现 Board、Column、基础 Work Item 与 Placement 的 use-case contract、规范化、幂等指纹、OWNER/范围授权、事务内整数重排、Board/资源乐观版本及显式 Project 删除顺序；Work Item 创建把 expected Board version 纳入指纹，成功重试先返回既有结果，过期新请求原子失败；不新增模块、schema 或第三方排序依赖。
- [x] 1.5 **Refactor:** 合并重复的范围查询、payload fingerprint、排序与 view mapping；运行 migration、onboarding、Project/Project Work integration、contention、Modulith/SQL ownership 与 coverage focused tests，确认跨 Project/Board 组合、过期版本、锚点和失败回滚均由真实 PostgreSQL 证明。
- [x] 1.6 同步 `docs/business-model.md` 的 Placement、基础 Work Item 类型版本边界、Project 删除政策，以及 Board/Workflow 段落与 Rule 12：当前无 Workflow 映射时 Card move 是授权且受并发控制的布局动作，未来由后续 Change 区分布局排序与 Workflow 业务动作；同步 Core API architecture/responsibilities/testing strategy 的 Project Work Current/Target 与验证命令，并用 source review 和 Mermaid/Markdown 检查证明没有把 Workflow/Agent 或自定义字段误写为 Current。

## 2. Core API Desktop Contract

- [x] 2.1 **Red:** 扩展 Spring HTTP 与 OpenAPI contract tests，固定 Board/Column/Work Item/Placement 精确路径、bearer/OWNER、Workspace/Project/Board not-found、201/200/204、request-id、expected version、Problem Details、503 和无独立 Board/Work Item delete；运行 focused tests，确认仅因 contract 未实现失败。
- [x] 2.2 **Green:** 增加 Project capability 的显式 Desktop Controller/transport models 与 Problem mapping，把参数映射到第 1 组 use cases；保持 authorization/application transaction 在 Core API 内，不暴露 JDBC 类型或创建 generic CRUD。
- [x] 2.3 **Refactor:** 收敛稳定错误 code、OpenAPI schema/security 配置和 transport validation；运行 `AuthenticationHttpIntegrationTest`、`OpenApiIntegrationTest`、production docs、Problem handler 与安全链 focused tests，确认文档只声明已实现路径且无秘密示例。
- [x] 2.4 同步根 architecture 与 Core API child docs 的当前 Desktop API 契约和测试边界；若文档导航/所有权没有变化，记录 `docs/README.md` 无需修改的证据。

## 3. Desktop Main and Preload Boundary

- [x] 3.1 **Red:** 为 Project Work transport、client/coordinator、recent Board store、IPC schema、Preload API 编写 Main tests，固定 refresh、Problem Details、environment/User/Workspace/Project/Board response-key fencing、logout/切换后的迟到响应丢弃，以及同一 Board mutation 成功后更早 Board read 的失效；运行 `test:main` 确认缺失生产能力是唯一失败原因。
- [x] 3.2 **Green:** 实现 Main-owned Project Work HTTP client/coordinator 与 environment/User/Project scoped recent Board preference，通过显式 IPC/Preload 方法暴露 list/create/read/edit/reorder/move；Renderer 不得获得 bearer、URL、fetch 或 generic IPC。
- [x] 3.3 **Refactor:** 去重 transport guards、错误 DTO、session generation 和 response-key 组合，运行 Desktop Main、Preload、IPC、architecture 与 typecheck focused gates；同步 Desktop architecture/responsibilities/testing strategy 的 Current 网络与偏好边界。

## 4. Renderer Board Experience and Internationalization

- [x] 4.1 按 Desktop 指令使用 `frontend-design`，基于既有设计基础确定一个现代、克制的多 Board 方向，明确 Project/Board 导航、横向 Column、Card、创建/编辑、loading/empty/error、拖拽回滚、键盘、焦点、live region、reduced-motion 与 `960×640` 双语状态；更新 `design-foundation.md`，不加入 TEAM、Workflow/Agent、指标或大段规则说明。
- [x] 4.2 **Red:** 增加 Renderer tests，固定首次直达初始 Board、最近/fallback、新建 Board 后选择、Column 配置、Work Item 创建/编辑、Card 无独立 ID、乐观移动成功/回滚、旧 response 丢弃、Work Item PATCH 成功后旧 Board GET 晚到不覆盖新内容、双语即时切换且用户数据不翻译；运行 `test:renderer` 确认失败来自缺失 UI 行为。
- [x] 4.3 **Green:** 使用 `vercel-react-best-practices` 实现 Board 页面与最小状态 owner，复用当前应用壳和 i18n；提供指针拖拽及等价键盘移动，成功采用服务端 snapshot，失败恢复权威布局并公告，不增加非必要状态或拖拽依赖。
- [x] 4.4 **Refactor:** 扩展 Cypress component tests，在 `960×640` 的 `zh-CN`/`en` 下覆盖多 Column 横向滚动、长文案、指针/键盘、焦点返回、错误关联和 reduced-motion；使用 `web-design-guidelines` review，修复 material findings 后运行 Renderer、i18n、Cypress、typecheck、lint 和 build focused gates。
- [x] 4.5 同步 Desktop architecture/responsibilities/testing strategy/design foundation 的 Current/Target，确保初始本地化名称、用户数据不翻译、Board 可访问性和未实现能力边界与代码一致。

## 5. Integrated Journey and Recovery Compatibility

- [x] 5.1 **Red/Green/Refactor:** 扩展现有 Desktop system journey，串联首次 GitHub provider double 注册直达初始 Board、创建第二 Board/Column/Work Item、移动 Card、logout 与重登恢复最近 Board；保持真实 PostgreSQL/Redis、编译后的 Main/IPC/Preload 边界，并运行 `test:system`。
- [x] 5.2 验证重写 V1 后 `pnpm dev` 只对 checkout-owned PostgreSQL/Redis volumes 执行一次受控恢复，运行 `pnpm dev:test`，不把 disposable local reset 表述为生产 migration 或 rollback。
- [x] 5.3 运行 Core API `qualityCheck`、Desktop `qualityCheck`/`test:e2e`/`test:system`、根 `pnpm check`；在最终验收阶段运行当前主机 `test:packaged-native`，只记录实际平台证据，不宣称 Windows 或真实 GitHub 已自动验证。

## 6. Model and Documentation Reconciliation

- [x] 6.1 对照已批准模型逐项审计生产代码、V1 migration、API/OpenAPI、Desktop contracts/UI、测试和运行证据，解决或记录身份、范围、基数、基础 Work Item 类型边界、Board/Placement 版本、删除、国际化及 session/旧响应方面的物质漂移。
- [x] 6.2 将稳定结论反馈到 `docs/business-model.md`、根/子 architecture、responsibilities、testing strategy 和 design foundation；协调 Current/Target 状态，确认 `docs/README.md` 是否需要所有权清单更新，并确保未实现的 TEAM、类型字段、Workflow/Agent、独立删除仍明确为非当前能力。
- [x] 6.3 运行全部计划的 focused/affected checks、`openspec schema validate taskpilot-sdd --verbose`、`openspec validate --all --strict --no-interactive` 与 `git diff --check`，确认五份 delta spec 与实现证据一致并具备人工 review 和 delta-spec sync 条件；不得自行 sync、archive 或 commit。

## 7. Board Card Move Experience Refinement

- [x] 7.1 更新 Board/Work Item delta specs、design 与 test plan，固定无独立移动弹窗、编辑表单跨列移动、服务端原子内容+Placement 更新、拖拽反馈及 reduced-motion；运行严格 OpenSpec validation。
- [x] 7.2 **Red:** 扩展 Core API module/HTTP/OpenAPI tests，覆盖同列内容编辑不改变布局 version、跨列编辑移动到末尾，以及 Work Item/Board/Placement version 或范围失败时全事务回滚。
- [x] 7.3 **Green/Refactor:** 扩展 Work Item PATCH command/result 与 Project application transaction，复用现有 Placement 重排逻辑并返回权威 Work Item+Board；同步 Desktop transport、IPC、Preload contract 与 focused Main tests。
- [x] 7.4 **Red:** 扩展 Renderer/Cypress tests，固定移除独立移动按钮/弹窗、编辑表单“所在列表”原子提交、成功焦点/权威快照、失败回滚、拖拽源/目标/插入/落位状态、Card 让位 FLIP 动画、增高 Card 和 reduced-motion。
- [x] 7.5 **Green/Refactor:** 使用既有 React/原生拖拽能力实现克制视觉反馈与约 200ms 落位，保持 selection/generation fencing、live region、键盘等价路径和双语文案，不引入新依赖或 Column 拖拽。
- [x] 7.6 运行 Core API、Desktop Main/Renderer/Cypress focused tests及受影响门禁，执行 `web-design-guidelines` review、`openspec validate --all --strict --no-interactive` 与 `git diff --check`；只汇报证据，不 sync、archive 或 commit。
- [x] 7.7 根据人工验收修正 Card 指针拖拽：以 Card 中线解析最近边缘落点，用单一等高占位槽让周围 Card 让位，并以轮廓、抬升和结构信号强化目标 Column；覆盖第一张前、两张之间、最后一张后、同列原位、空列、reduced-motion 与真实 Chromium 指针路径，不引入新依赖或协议变化。
