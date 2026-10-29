# Test Plan

## Scope and Risk

范围是 Desktop 源码目录、测试目录、coverage 输出配置和相关架构文档的重构。风险等级以工程结构回归为主：编译/import 断裂、Electron Main 启动和安全钩子遗漏、Renderer UI 行为因移动/拆 CSS 回归、i18n key/fallback 漂移、coverage 口径被误读、文档 owner 与实现不一致。

非目标：不验证新的业务行为，因为没有业务行为变化；不新增 API/IPC/database/authorization contract；不把 Cypress 执行纳入 source coverage 百分比；不以目录迁移为理由降低现有断言、删除风险覆盖或改变视觉规范。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| `src/main/index.ts` 瘦身后仍正确连接 Electron ready 和 window lifecycle | Main unit/integration + typecheck | `tests/main/app/*` 覆盖 `bootstrapDesktopApp` 调用序列；`corepack pnpm --filter @taskpilot/desktop test:main` | Main tests 能确定性证明启动编排，不需要真实 packaged app 才能发现 import/sequence 回归 |
| BrowserWindow 创建、preload 路径、dev/prod renderer loading 和安全 deny hooks 未丢失 | Main boundary tests | `tests/main/app/create-window*.test.ts`、`window-security*.test.ts` 或迁移后的等价 existing tests | Electron 安全默认值属于 Main boundary，Renderer/Cypress 不能证明 deny-by-default |
| IPC registration、composition、session restore、session changed push 行为随文件移动不变 | Main integration tests | 迁移 existing IPC/composition/session/project tests 到 `tests/main/**` 新 owner 并运行 `test:main` | 能捕获启动拆分时 wiring 漏接或顺序错误 |
| Renderer entry/provider/top-level routing 移动后不改变登录、项目首页、看板、详情状态 | Renderer integration tests | `tests/renderer/app/*` 与 `tests/renderer/features/*` focused tests；`test:renderer` | jsdom/RTL 层能快速发现 props/state/import 断裂和行为漂移 |
| CSS 拆分后真实 Chromium 布局、focus、Portal、hover、overflow、reduced-motion 不回归 | Cypress component browser tests | `cypress/component/auth.cy.tsx`、`shell.cy.tsx`、`board.cy.tsx`、`select.cy.tsx` 或迁移前等价 specs | CSS cascade 和浏览器布局必须由真实 browser evidence 覆盖 |
| i18n 消息拆分后 key parity、fallback、语言切换和 legal 文案不漂移 | Renderer tests + selected Cypress | i18n/locale/legal focused Vitest；auth/shell Cypress smoke | i18n 数据可由 unit/integration 验证，关键用户入口用 browser 补充 |
| Tests 目录与 source owner 对齐且没有 stale deep imports | Lint/typecheck/source review | `typecheck`、`lint`、`find`/`rg` 审核旧路径和空目录 | 编译和 lint 捕获 import 错误，source review 捕获 owner 命名漂移 |
| Coverage 输出包含 HTML/XML/json-summary，口径不包含 Cypress | Coverage command + artifact check | `test:coverage` 后检查 `coverage/index.html`、`coverage/cobertura-coverage.xml`、`coverage/coverage-summary.json` 存在；testing strategy 记录口径 | 产物存在性和文档边界能防止 CI/人工误解 coverage 来源 |
| 根和 Desktop 文档与新结构一致 | Documentation review + OpenSpec validate | 审核指定文档；`openspec validate --all --strict --no-interactive` | 文档语义不能只靠测试证明，需要 owner review 和结构验证 |
| 无业务模型、API/IPC、持久化或授权变化 | Semantic diff audit | 最终 model/docs drift audit 对照 proposal/design、代码 diff、测试和 docs | 防止重构中夹带行为变更 |

## Implementation and Verification Approach

### Slice 1: Main app boundary

直接重构，不使用 Red-Green-Refactor。新增 `src/main/app/bootstrap.ts`、`create-window.ts`、`window-security.ts`、`device-id.ts`，把 `index.ts` 缩小为生命周期入口。迁移和补齐 Main tests 到 `tests/main/app/*`，运行 focused Main tests、typecheck 和 lint。同步 Desktop architecture/responsibilities/testing docs 中 Main startup owner。

### Slice 2: Renderer foundation

直接重构。创建 `src/renderer/app`、`features`、`shared`、`i18n`、`styles` 基础目录；迁移 `main.tsx`、`App.tsx` 和 business-neutral shared UI/hooks/lib/icons；更新 imports 和 app/shared/i18n tests。运行 Renderer focused tests、typecheck 和 lint。

### Slice 3: Renderer features and Cypress specs

按 `auth`、`shell`、`board`、`detail` 分 slice 移动文件和 tests，避免单次大爆炸。每个 feature 迁移后运行对应 Renderer tests；Cypress specs 重命名到 `auth.cy.tsx`、`shell.cy.tsx`、`board.cy.tsx`、`select.cy.tsx` 并更新 imports/support。保持用户可见行为和视觉不变。

### Slice 4: Styles, i18n, and coverage outputs

拆分 `styles.css` 与 `messages.ts`，保留显式聚合入口和导入顺序；运行 i18n/legal/detail/select 相关 tests 和 Cypress component focused specs。更新 `vitest.config.ts` coverage reporter 为 `text`、`json-summary`、`html`、`cobertura`，必要时调整 `package.json` coverage 脚本命名但不改变 threshold 语义；验证产物存在。

### Slice 5: Documentation and final reconciliation

审核根到 Desktop 的文档清单，完成必须更新的 Desktop docs，删除空/过时目录，运行 affected gates。最终执行 model-drift 和 documentation-feedback audit，确认没有业务/API/IPC/security/persistence 漂移。

## Verification Commands

### Focused

- `corepack pnpm --filter @taskpilot/desktop typecheck`: 验证路径迁移后的 TypeScript 边界。
- `corepack pnpm --filter @taskpilot/desktop lint`: 验证 lint、React hooks 和禁止 stale import 的基本规则。
- `corepack pnpm --filter @taskpilot/desktop test:main`: 验证 Main startup、security、IPC、session/project wiring。
- `corepack pnpm --filter @taskpilot/desktop test:renderer`: 验证 Renderer app/features/shared/i18n 行为。
- `corepack pnpm --filter @taskpilot/desktop test:architecture`: 验证 Desktop architecture boundary tests。
- `corepack pnpm --filter @taskpilot/desktop test:coverage`: 验证 Vitest V8 source coverage threshold 和 reporter 产物。
- `test -f apps/desktop/coverage/index.html && test -f apps/desktop/coverage/cobertura-coverage.xml && test -f apps/desktop/coverage/coverage-summary.json`: 验证 HTML/XML/json-summary 产物存在。
- `corepack pnpm --filter @taskpilot/desktop exec cypress run --component --browser chrome --spec cypress/component/auth.cy.tsx,cypress/component/shell.cy.tsx,cypress/component/board.cy.tsx,cypress/component/select.cy.tsx`: 验证迁移后真实 Chromium component journeys。迁移中间态可使用旧 spec 文件名，但最终应使用目标文件名。

### Affected and Cross-Boundary

- `corepack pnpm --filter @taskpilot/desktop qualityCheck`: Desktop portable gate，覆盖 typecheck、lint、Main/Renderer/architecture tests、coverage 和 production build。
- `corepack pnpm --filter @taskpilot/desktop test:e2e`: 完整 Cypress component browser journeys；coverage 百分比之外的交互/布局证据。
- `git diff --check`: 检查 whitespace 和 patch 格式。
- `openspec validate refactor-desktop-source-structure --strict --no-interactive`: 验证本 Change artifacts。
- `openspec validate --all --strict --no-interactive`: 验证所有 active changes/specs。
- `openspec schema validate taskpilot-sdd --verbose`: 仅当本 Change 触及 schema/governance 或 validation 异常时运行；本 Change 正常不改 schema。

## Manual Evidence and Automation Gaps

不需要新的手工验收作为本 Change 的完成条件；这是结构重构，核心风险由 typecheck、lint、Vitest、Cypress component、coverage artifacts、build 和文档审计覆盖。

保留一个报告边界：Cypress 证明浏览器交互/布局，不证明 native packaged Electron、macOS/Windows credential、installer/signing 或 platform-specific release readiness；本 Change 不改变这些 release gates。
