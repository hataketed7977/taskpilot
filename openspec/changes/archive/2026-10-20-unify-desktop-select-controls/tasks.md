# Tasks

## 1. Shared Select Primitive

- [x] 1.1 **Red:** 新增 `apps/desktop/tests/renderer/select-control.test.tsx` 与 `apps/desktop/cypress/component/select-control.cy.tsx`，用最小可编译的组件契约覆盖稳定 value 单次确认、Escape/外部取消、disabled、selected 语义、键盘与焦点返回、长文本/长列表、`960×640` 碰撞避让、Dialog Portal 和 reduced-motion；基础组件只证明自身 dismiss/disabled 协议，Dialog 事件传播和 pending 接线留给 Slice 3；运行 focused Vitest 与 Cypress，保存由缺失 Select 行为导致的断言级失败证据，不以导入、编译或环境失败充当 Red。
- [x] 1.2 **Green:** 在 Desktop package 中精确锁定 `@radix-ui/react-select@2.4.1`，实现 `apps/desktop/src/renderer/components/select.tsx` 的受控单值窄 API 及 TaskPilot token 样式，使 focused Renderer 与 Cypress 用例通过；复核依赖和 import 只进入 Renderer，不扩大 Main、Preload、IPC 或网络能力。
- [x] 1.3 **Refactor:** 收紧组件 API、拆除测试所需的临时壳层并整理样式，确认组件不接收业务对象、任意 item renderer、搜索、多选、分组或异步数据源；重新运行 `pnpm --filter @taskpilot/desktop exec vitest run --config vitest.config.ts tests/renderer/select-control.test.tsx` 与 `pnpm --filter @taskpilot/desktop exec cypress run --component --spec cypress/component/select-control.cy.tsx`，保持 focused checks 通过。

## 2. Unified Language Selection

- [x] 2.1 扩展 `tests/renderer/i18n-auth-experience.test.tsx` 和直接相关的 Project-home Renderer cases，固定登录页与已登录账号区共用 `zh-CN/en` 选项、即时更新文案和 `document.lang`、切换后焦点回到 trigger，且认证 attempt、错误/等待状态和 `CurrentUserView` 不重置；运行对应 focused Vitest 建立迁移前行为证据。
- [x] 2.2 抽取一个复用 locale 选项与 `changeLocale` 逻辑的 `LanguageSelector`，以布局变体迁移 `App.tsx` 与 `project-home.tsx` 的两个入口并删除重复的 locale 列表和原生 `<select>` 实现；运行 `pnpm --filter @taskpilot/desktop exec vitest run --config vitest.config.ts tests/renderer/i18n-auth-experience.test.tsx tests/renderer/project-home.test.tsx`，证明即时切换、状态保持与统一焦点协议通过。
- [x] 2.3 更新 `apps/desktop/docs/design-foundation.md` 中已落地的语言 Select 视觉/交互基线；只有共享责任已由生产代码和测试证明后，才同步 `apps/desktop/docs/responsibilities.md` 的 Renderer primitive 边界，并保持 Current/Target 表述与证据一致。

## 3. Work Item Column Selection

- [x] 3.1 扩展 `tests/renderer/project-board.test.tsx` 和 `cypress/component/project-board.cy.tsx`，通过 role/name 与用户行为覆盖 Dialog 中打开、选择另一 Column、第一次 Escape 只关闭菜单并把焦点还给 trigger、第二次 Escape 才关闭 Dialog，以及保存 Promise pending 时 trigger disabled、菜单不可重开且已提交 `targetColumnId` 不变；先运行 focused cases，确认既有业务参数基线且新自定义 Select 集成断言在迁移前未满足。
- [x] 3.2 基于当前在途 Board 工作树把 `board-workspace.tsx` 的 Column 原生 `<select>` 最小迁移到共享 Select：以局部 Escape handler 阻止事件继续传播但保留 Select 自身 dismiss，并传入 `disabled={pending}`；保留原有 label 关联、表单校验、保存/取消和原子编辑语义，不重构 Dialog，不 reset、checkout 或覆盖 `add-project-boards-and-work-items` 的改动；运行 `pnpm --filter @taskpilot/desktop exec vitest run --config vitest.config.ts tests/renderer/project-board.test.tsx` 与 `pnpm --filter @taskpilot/desktop exec cypress run --component --spec cypress/component/project-board.cy.tsx`，证明业务值、两级 Escape、pending disabled 和 Dialog/Portal 行为通过。

## 4. Renderer Cleanup and Affected Verification

- [x] 4.1 删除仅服务旧原生 Select 或重复语言实现的 CSS，保留 Dialog、Button、Input、Textarea 和其他在途 Board 样式；运行 `rg -n '<select' apps/desktop/src/renderer --glob '*.tsx'`，预期生产 Renderer 无本 Change 范围内的原生 `<select>`，并用 source review 确认没有第二套 locale options 或页面私有 Select 协议。
- [x] 4.2 运行 `pnpm --filter @taskpilot/desktop test:renderer` 与 `pnpm --filter @taskpilot/desktop test:e2e`，修复仅由共享组件、Portal、焦点或样式迁移引起的直接回归，不借此重构本 Change 非目标组件。
- [x] 4.3 运行 `pnpm --filter @taskpilot/desktop qualityCheck`，确认 TypeScript、ESLint、Main/Renderer/architecture tests、coverage 和 build 通过；复核 `apps/desktop/package.json`、`pnpm-lock.yaml` 与 bundle/import 证据，确认新增依赖版本精确且只属于 Renderer。

## 5. Model and Documentation Reconciliation

- [x] 5.1 对照 proposal、delta specs 与已实现组件、调用点、依赖、测试和运行证据执行 model-drift audit；确认 locale、Column、Work Item、Placement、授权、版本、API/IPC、持久化和业务提交时机均未改变，若出现实质漂移则暂停并先更新、复审本 Change，而不是在代码中静默决定。
- [x] 5.2 复核 `apps/desktop/docs/design-foundation.md` 与 `apps/desktop/docs/responsibilities.md` 的 Current/Target 状态，记录 `docs/business-model.md`、`docs/architecture.md`、Desktop architecture/testing strategy 无需更新的证据；若实现证明形成新的稳定责任，最小反馈到实际 owner，且不把 Dialog/Input/Button 候选扩大为本 Change 工作。
- [x] 5.3 运行 focused checks、`pnpm --filter @taskpilot/desktop test:renderer`、`pnpm --filter @taskpilot/desktop test:e2e`、`pnpm --filter @taskpilot/desktop qualityCheck`、`rg -n '<select' apps/desktop/src/renderer --glob '*.tsx'`、`git diff --check`、`openspec validate unify-desktop-select-controls --strict --no-interactive` 和 `openspec validate --all --strict --no-interactive`；汇总实际通过/未执行证据，确认两个 delta specs 可 sync，但不自动 sync、archive 或 commit。
