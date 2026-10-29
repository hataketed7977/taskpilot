# Design

## Context

见 `proposal.md` 的 Why。当前 Desktop 是 Electron 应用，顶层 `apps/desktop/src` 已按进程边界区分 `main`、`preload`、`renderer` 和 shared 类型；本 Change 不改变这个 Electron 进程边界，只整理 Main 与 Renderer 内部责任。

当前 Main 的 `src/main/index.ts` 行数不大，但同时拥有 Electron `app` 生命周期、`BrowserWindow` 创建、导航/权限/新窗口限制、dev/prod Renderer 加载、transport/credential/store/composition 初始化、IPC 注册、session restore 和 device installation ID。当前 Renderer 的 `App.tsx`、`project-home.tsx`、`board-workspace.tsx`、`styles.css` 和 `messages.ts` 承载了过多互不相同的责任；测试路径也没有稳定反映源码 owner。当前 coverage 由 Vitest V8 插件统计，不包含 Cypress browser execution，产物缺少 HTML/XML。

约束：保持 `contextIsolation`、sandbox、typed preload capability、Main 边界校验和 Core API 最终授权不变；不引入 Redux/Zustand、React Router、Tailwind、shadcn、CSS-in-JS、Storybook 或新的 UI 框架；不改变行为、视觉语言、API/IPC、持久化模型或业务术语。

## Goals / Non-Goals

**Goals:**

- 让 `src/main/index.ts` 只表达 Electron 生命周期入口，把启动细节移入可测试的 `src/main/app/*`。
- 让 Renderer 目录一眼区分 app entry/provider、feature UI、business-neutral shared primitives、i18n 和 styles。
- 让 `tests/` 与 `src/` owner 对齐，Cypress spec 名称按用户可见区域/控件表达。
- 让 coverage 口径明确且可被人和 CI 消费：Vitest 统计 source coverage，输出 text/json-summary/html/XML；Cypress 作为 browser evidence，不并入百分比。
- 将稳定边界反馈到 Desktop architecture/responsibilities/testing docs，并审核根文档是否存在冲突。

**Non-Goals:**

- 不重写 UI、交互、视觉 token、文案、认证/项目/看板/工作项行为。
- 不建设完整 Design System，不引入新状态管理、路由、样式或测试框架。
- 不改变 Electron process trust boundary、preload API、IPC channel、HTTP API、数据库或 Core API 规则。
- 不把 Cypress coverage instrumentation 纳入本 Change；如果未来确实要合并 Cypress source coverage，应单独设计 Vite/Istanbul/Cypress instrumentation 和报告合并策略。
- 不以目录迁移为理由清理无关旧代码、重命名业务概念或改变 target architecture。

## Business Model

方法：source/document audit 与关系/边界 checklist。结论：业务模型无变化，仍以 `docs/business-model.md` 为产品语义来源。目录 owner 不是业务 owner；`features/board`、`features/detail` 等只代表 Renderer 代码放置位置，不重新定义 Board、Work Item、Card 或 Placement 的身份、关系、生命周期、授权或版本规则。

异步边界保持不变：Renderer 通过 preload capability 调 Main IPC，Main 通过 Desktop API client 调 Core API；Main 不获得新的业务授权，Renderer 不获得 Node/Electron/secret/raw filesystem 能力。错误恢复、session recovery、recent selection、Work Item save conflict、Board deletion 等既有行为只随文件移动更新 import 和测试路径，不改变状态机。

## Decisions

1. **保留 Electron 顶层进程目录，只重构内部层级。**
   - 选择：继续使用 `src/main`、`src/preload`、`src/renderer` 的 Electron 常见边界，在 `main` 和 `renderer` 内部新增 owner 子目录。
   - 理由：这是 Electron 项目的主流可理解边界，符合当前构建配置和安全模型；问题在内部文件职责过宽，不在顶层命名。
   - 替代：把 `renderer` 改名为 `ui` 或引入 `packages/desktop-ui`。拒绝，因为会制造跨构建边界和迁移成本，但没有真实复用 owner。

2. **Main 引入 `src/main/app/*`，并让 `index.ts` 只做生命周期入口。**
   - 目标结构：
     ```text
     src/main/
       index.ts
       app/
         bootstrap.ts
         create-window.ts
         window-security.ts
         device-id.ts
       api/
       auth/
       credentials/
       projects/
       session/
       composition.ts
       ipc.ts
       ipc-result.ts
       renderer-location.ts
     ```
   - `index.ts` 只保留 `app.whenReady().then(bootstrapDesktopApp)` 和 `window-all-closed` quit 等生命周期连接。
   - `bootstrap.ts` 负责 composition、IPC 注册、restore sequence 和 session changed push 的编排。
   - `create-window.ts` 负责 BrowserWindow options、preload 路径和 dev/prod Renderer loading 的窗口构造。
   - `window-security.ts` 负责 navigation、window-open、permission、download/load failure 等安全钩子。
   - `device-id.ts` 负责 deviceInstallationId 的读取/创建细节。
   - 替代：保持 `index.ts` 单文件或按 `native/security/startup` 拆散到多个同级目录。拒绝，因为入口继续承载细节会影响测试和 review，同级碎片也会让 app startup owner 不清楚。

3. **Renderer 采用 feature-first + shared-neutral 结构。**
   - 目标结构：
     ```text
     src/renderer/
       app/
         App.tsx
         main.tsx
       features/
         auth/
         shell/
         board/
         detail/
       shared/
         ui/
         hooks/
         lib/
         icons/
       i18n/
         messages/
       styles/
     ```
   - `app` 拥有 React entry、providers、顶层 session/state routing。
   - `features/auth` 拥有登录、注册、legal consent 的认证体验。
   - `features/shell` 拥有已登录 app shell、Project home、sidebar/account menu、Project entry。
   - `features/board` 拥有 Board workspace、Column/Card/Work Item 列表交互。
   - `features/detail` 拥有 Work Item detail dialog 与 field editing。
   - `shared` 只能放 business-neutral Renderer 基础设施：通用 `ui`、generic `hooks`、纯 DOM/text/date helper 和 common icons；不能成为跨 feature 业务状态垃圾桶。
   - 替代：按类型分 `components/hooks/pages`。拒绝，因为当前痛点正是业务页面和共享组件边界不清，按类型会继续鼓励跨 feature 深导入。

4. **i18n 和 styles 拆分按 owner，而不是按文件大小。**
   - i18n target：
     ```text
     i18n/messages/
       common.ts
       language.ts
       session.ts
       auth.ts
       account.ts
       project.ts
       board.ts
       detail.ts
       legal.ts
       index.ts
     ```
   - styles target：
     ```text
     styles/
       tokens.css
       base.css
       shared-ui.css
       auth.css
       shell.css
       board.css
       detail.css
     ```
   - 拆分时保持 message key parity、fallback 语义、CSS cascade/import order 和既有 class contract。样式拆分不是视觉重设计。
   - 替代：保留单体 `messages.ts`/`styles.css`。拒绝，因为它们已经成为修改冲突和回归定位热点。

5. **测试结构镜像源码 owner，Cypress 按用户旅程命名。**
   - Vitest target：
     ```text
     tests/
       main/
         app/
         api/
         auth/
         credentials/
         projects/
         session/
         ipc/
       renderer/
         app/
         features/
         shared/
         i18n/
       architecture/
       system/
       setup.ts
     ```
   - Cypress target：
     ```text
     cypress/component/
       auth.cy.tsx
       shell.cy.tsx
       board.cy.tsx
       select.cy.tsx
     ```
   - 迁移规则：`src/main/app/* -> tests/main/app/*`；`src/renderer/features/<feature>/* -> tests/renderer/features/<feature>/*`；`src/renderer/shared/* -> tests/renderer/shared/*`；`src/renderer/i18n/* -> tests/renderer/i18n/*`。
   - 空目录和过时目录在对应 slice 完成后删除。

6. **Coverage 由 Vitest 统计 source coverage，Cypress 不纳入百分比。**
   - 当前事实：`pnpm --filter @taskpilot/desktop test:coverage` 等价于 `vitest run --config vitest.config.ts --coverage tests/main tests/renderer tests/architecture`；`coverage.include` 为 `src/**/*.{ts,tsx}`，入口壳文件被排除；reporter 只有 `text` 和 `json-summary`。
   - 目标：保留 V8 provider 和 threshold，增加 `html` 与 `cobertura` reporter，保留 `json-summary` 供趋势/脚本使用。最终应生成 `coverage/index.html`、`coverage/cobertura-coverage.xml` 和 `coverage/coverage-summary.json`。
   - Cypress 继续通过 `test:e2e`/component run 提供真实 Chromium 布局、hover、focus、reduced-motion、Portal 和 overflow 证据。没有 Cypress source instrumentation 前，不把 Cypress 执行混进 coverage 百分比，避免虚假的合并指标。
   - 如需要区分“前端 coverage”，报告中应把 Renderer Vitest coverage 作为前端 source coverage，把 Cypress 列为 browser interaction evidence。

7. **文档更新是实现 slice 的一部分，不后置漂移。**
   - 必改 owner：`apps/desktop/docs/architecture.md`、`apps/desktop/docs/responsibilities.md`、`apps/desktop/docs/testing-strategy.md`。
   - 必审 owner：根 `AGENTS.md`、`docs/README.md`、`docs/architecture.md`、`docs/business-model.md`、`apps/desktop/AGENTS.md`、`apps/desktop/docs/design-foundation.md`。
   - 根文档保持高层边界，不复制 Desktop child 文档的目录细节；child 文档拥有 Desktop 本地目录和测试结构。

## Risks / Trade-offs

- [Risk] 大规模 import path churn 造成编译或测试遗漏 → 分 Main、Renderer foundation、feature、styles/i18n、tests/docs slices 迁移；每 slice 跑 focused typecheck/lint/tests。
- [Risk] CSS 拆分改变 cascade，导致布局/hover/focus/overflow 回归 → 保持显式 import order；用 Renderer tests 和 Cypress component 覆盖真实 Chromium 布局与交互。
- [Risk] i18n 消息拆分丢 key 或破坏 fallback → 保留消息聚合 index 和 parity 测试；运行 existing i18n/legal focused tests。
- [Risk] Main startup 拆分弱化 Electron 安全钩子 → `window-security.ts` 独立 owner；Main tests 覆盖 BrowserWindow options、navigation/window-open/permission deny、IPC registration 和 restore sequence。
- [Risk] `shared` 目录变成业务逻辑垃圾桶 → responsibilities 文档明确 shared-neutral rule；architecture tests 或 source review 禁止 feature 深导入和 shared 业务状态漂移。
- [Risk] Coverage HTML/XML 被误解为包含 Cypress → testing strategy 明确 coverage 口径；报告分开展示 Vitest source coverage 与 Cypress browser evidence。
- [Risk] 文档只在最后补，导致 Current/Target 不一致 → 每个迁移 slice 同步 owning docs；最终做 model/docs drift audit。

## Migration Plan

1. 完成 OpenSpec planning artifacts，并设置 `skip_specs: true`；严格验证 Change。
2. Main app boundary slice：新增 `src/main/app/*`，瘦身 `index.ts`，迁移/新增 `tests/main/app/*`，更新 Desktop architecture/responsibilities/testing docs 的 Main 部分。
3. Renderer foundation slice：建立 `app/shared/i18n/styles/features` 目录，迁移 `main.tsx`/`App.tsx`、business-neutral shared primitives 和基础测试。
4. Renderer feature slice：按 `auth/shell/board/detail` 迁移功能文件、相关 tests 和 Cypress specs，保持行为不变。
5. Styles/i18n/coverage slice：拆分 CSS/messages，更新 coverage reporters，验证 HTML/XML/json-summary 产物。
6. Tests/docs reconciliation slice：删除空/过时目录，完成根文档审计与 Desktop docs 更新，运行完整 affected gates。

Rollback 策略是普通 Git revert：本 Change 不包含 migration、API contract 或持久化格式变化。

## Open Questions

None. 用户已确认 Main `index.ts` 现在就要瘦身、Renderer 采用上述结构、tests 对齐新结构、根到 Desktop 文档在 proposal 阶段明确纳入，coverage 口径采用 Vitest source coverage 与 Cypress browser evidence 分离。
