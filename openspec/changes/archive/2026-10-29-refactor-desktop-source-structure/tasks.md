# Tasks

## 1. OpenSpec Planning and Baseline Audit

- [x] 1.1 确认 `.openspec.yaml` 设置 `skip_specs: true`，并运行 `openspec validate refactor-desktop-source-structure --strict --no-interactive`，证明无 spec-level behavior delta 的 Change 可验证。
- [x] 1.2 记录当前 Desktop source/test/coverage 基线：`find apps/desktop/src/main apps/desktop/src/renderer apps/desktop/tests apps/desktop/cypress/component`、`apps/desktop/package.json` test scripts、`apps/desktop/vitest.config.ts` coverage reporter 和现有 coverage 产物。
- [x] 1.3 运行 `corepack pnpm --filter @taskpilot/desktop typecheck` 与 `corepack pnpm --filter @taskpilot/desktop lint`，建立迁移前编译和 lint 基线。

## 2. Main App Boundary

- [x] 2.1 新增 `apps/desktop/src/main/app/bootstrap.ts`、`create-window.ts`、`window-security.ts`、`device-id.ts`，迁移 `index.ts` 中对应启动、窗口、安全和 deviceInstallationId 逻辑；完成标准是 `index.ts` 只保留 Electron lifecycle entry 和 quit wiring。
- [x] 2.2 将 Main tests 按 owner 迁移/补齐到 `apps/desktop/tests/main/app`、`api`、`auth`、`credentials`、`projects`、`session`、`ipc`；完成标准是没有测试继续依赖旧启动细节路径，且 `corepack pnpm --filter @taskpilot/desktop test:main` 通过。
- [x] 2.3 更新 `apps/desktop/docs/architecture.md`、`apps/desktop/docs/responsibilities.md`、`apps/desktop/docs/testing-strategy.md` 中 Main startup/window/security/testing owner；完成标准是文档只描述已落地的 `main/app` 边界且不复制根架构细节。
- [x] 2.4 运行 `corepack pnpm --filter @taskpilot/desktop typecheck`、`corepack pnpm --filter @taskpilot/desktop lint`、`corepack pnpm --filter @taskpilot/desktop test:main`，修复本 slice 引入的 import、lint 或 Main regression。

## 3. Renderer Foundation Structure

- [x] 3.1 创建 `apps/desktop/src/renderer/app`、`features`、`shared`、`i18n/messages`、`styles` 目录，迁移 `main.tsx`、`App.tsx`、business-neutral shared UI/hooks/lib/icons 和 i18n 基础设施；完成标准是 app entry/provider、shared-neutral 基础设施和消息聚合入口清晰可导入。
- [x] 3.2 将 Renderer foundation tests 迁移到 `apps/desktop/tests/renderer/app`、`shared`、`i18n`；完成标准是 `corepack pnpm --filter @taskpilot/desktop test:renderer` 中相关 focused tests 通过，且不通过 Main internals mock Renderer。
- [x] 3.3 更新 `apps/desktop/docs/architecture.md` 与 `apps/desktop/docs/responsibilities.md` 的 Renderer top-level owner 和 shared-neutral rule；完成标准是文档明确 `app/features/shared/i18n/styles` 含义。
- [x] 3.4 运行 `corepack pnpm --filter @taskpilot/desktop typecheck`、`corepack pnpm --filter @taskpilot/desktop lint`、`corepack pnpm --filter @taskpilot/desktop test:renderer`，修复本 slice 直接回归。

## 4. Renderer Feature Migration and Cypress Alignment

- [x] 4.1 按 `features/auth` 迁移登录、注册、legal、未登录语言选择和品牌背景相关生产代码/tests；完成标准是 auth focused Renderer tests 和迁移后的 `cypress/component/auth.cy.tsx` 通过。
- [x] 4.2 按 `features/shell` 迁移 Project home、signed-in shell、account menu、sidebar/project entry 相关生产代码/tests；完成标准是 shell focused Renderer tests 和 `cypress/component/shell.cy.tsx` 通过。
- [x] 4.3 按 `features/board` 迁移 Board workspace、Column/Card/Work Item 列表交互相关生产代码/tests；完成标准是 board focused Renderer tests 和 `cypress/component/board.cy.tsx` 通过。
- [x] 4.4 按 `features/detail` 迁移 Work Item detail dialog、field editing state 和相关 tests；完成标准是 detail focused Renderer tests 通过，且 Board/detail 之间没有不受文档允许的 feature 深导入。
- [x] 4.5 将共享 Select/通用控件 browser spec 对齐为 `cypress/component/select.cy.tsx`，并删除或重定向旧 `first-use.cy.tsx`、`project-board.cy.tsx`、`select-control.cy.tsx` 中不再适用的文件名；完成标准是目标 Cypress spec 名称存在并通过，旧空壳文件不存在或有明确兼容理由。
- [x] 4.6 运行 `corepack pnpm --filter @taskpilot/desktop exec cypress run --component --browser chrome --spec cypress/component/auth.cy.tsx,cypress/component/shell.cy.tsx,cypress/component/board.cy.tsx,cypress/component/select.cy.tsx`，修复本 slice 引起的真实 Chromium 交互、布局、focus、Portal 或 overflow 回归。

## 5. Styles, i18n, and Coverage Outputs

- [x] 5.1 将单体 Renderer styles 拆分为 `tokens.css`、`base.css`、`shared-ui.css`、`auth.css`、`shell.css`、`board.css`、`detail.css`，保持既有 CSS cascade/import order 和视觉 token；完成标准是 Renderer/Cypress focused checks 没有 layout 或 visual interaction regression。
- [x] 5.2 将 i18n messages 拆分为 `common.ts`、`language.ts`、`session.ts`、`auth.ts`、`account.ts`、`project.ts`、`board.ts`、`detail.ts`、`legal.ts` 和 `index.ts`；完成标准是 message parity、fallback、legal catalog 和 language switch tests 通过。
- [x] 5.3 更新 `apps/desktop/vitest.config.ts` coverage reporter，保留 V8 provider 和 thresholds，输出 `text`、`json-summary`、`html`、`cobertura`；完成标准是 `corepack pnpm --filter @taskpilot/desktop test:coverage` 通过并生成 `apps/desktop/coverage/index.html`、`apps/desktop/coverage/cobertura-coverage.xml`、`apps/desktop/coverage/coverage-summary.json`。
- [x] 5.4 更新 `apps/desktop/docs/testing-strategy.md` 的 coverage 口径：Vitest source coverage 覆盖 Main/Renderer/architecture tests，Cypress component tests 是 browser-level evidence 且不并入 coverage 百分比；完成标准是文档列出 HTML/XML/json-summary 产物和 Cypress 边界。

## 6. Tests, Empty Directories, and Documentation Audit

- [x] 6.1 删除迁移后为空或过时的 `apps/desktop/src`、`apps/desktop/tests`、`apps/desktop/cypress/component` 目录/文件；完成标准是 `find`/`git status` 证明没有仅因旧结构保留的空目录或 dead spec。
- [x] 6.2 从仓库根审核 `AGENTS.md`、`docs/README.md`、`docs/architecture.md`、`docs/business-model.md`；完成标准是更新所有与新 Desktop structure/coverage 事实冲突的 Current/Target 文字，或在最终报告中记录无需更新的证据理由。
- [x] 6.3 审核 `apps/desktop/AGENTS.md` 与 `apps/desktop/docs/design-foundation.md`；完成标准是修正 stale path/shared primitive owner 引用，或记录无需更新的证据理由。
- [x] 6.4 确认 `docs/README.md` 文档地图仍能到达所有被更新的工程文档；若新增、移动、重命名或删除文档，同步更新文档地图。
- [x] 6.5 运行 `corepack pnpm --filter @taskpilot/desktop test:architecture`，证明 architecture boundary tests 与新目录结构一致。

## 7. Final Verification and Model/Documentation Reconciliation

- [x] 7.1 运行 `corepack pnpm --filter @taskpilot/desktop qualityCheck`，确认 typecheck、lint、Main/Renderer/architecture tests、coverage 和 production build 通过。
- [x] 7.2 运行 `corepack pnpm --filter @taskpilot/desktop test:e2e`，确认完整 Cypress component browser journeys 通过且仍作为 coverage 百分比之外的 evidence 报告。
- [x] 7.3 运行 `git diff --check`、`openspec validate refactor-desktop-source-structure --strict --no-interactive` 和 `openspec validate --all --strict --no-interactive`，确认 patch 与 OpenSpec artifacts 结构有效。
- [x] 7.4 对照 proposal/design、实现 diff、tests、coverage artifacts、docs 和 OpenSpec specs 执行 model-drift audit；完成标准是确认无业务模型、API/IPC、授权、安全、持久化或视觉语义漂移，或在发现漂移时暂停并回到 Change 更新/复审。
- [x] 7.5 汇总最终文档反馈：列出已更新 owner 文档、已审核但无需更新的文档及理由、coverage HTML/XML/json-summary 产物、Cypress 不计入 coverage 的说明，并确认本 Change 因 `skip_specs: true` 无 delta-spec sync 内容。
