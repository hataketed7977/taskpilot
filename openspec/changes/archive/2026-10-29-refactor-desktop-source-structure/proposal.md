# Proposal

## Why

Desktop 当前从可运行 MVP 切片演进而来，`apps/desktop/src/renderer` 的页面、状态、共享控件、全局 CSS 和 i18n 消息混在少数大文件中，`src/main/index.ts` 也同时承载 Electron 生命周期、窗口、安全钩子、启动编排和设备标识细节。这个结构已经让 UI 调整、测试定位、文档维护和 code review 成本变高；现在做结构重构，可以在不改变产品行为的前提下建立后续 Desktop 开发的清晰边界。

## What Changes

- 重构 `apps/desktop/src/main` 内部结构：保留 `src/main/index.ts` 作为 Electron 生命周期入口，并新增 `src/main/app/*` 承载启动编排、窗口创建、安全钩子和设备安装 ID 读写。
- 重构 `apps/desktop/src/renderer` 内部结构为 `app/`、`features/`、`shared/`、`i18n/`、`styles/`，把入口、业务特性、Renderer 共享基础设施、消息和样式责任分开。
- 将 Renderer i18n 消息拆到领域化 `i18n/messages/*`，将单体 `styles.css` 拆为 token/base/shared/feature 样式文件，同时保持现有视觉语言、CSS 技术栈和导入顺序语义。
- 将 `apps/desktop/tests` 与新的 Main/Renderer 目录结构对齐，并重命名 Cypress component specs 到用户可理解的界面区域；删除迁移后为空或过时的目录。
- 明确 Desktop coverage 口径：Vitest V8 coverage 继续覆盖 Main、Renderer 和 architecture tests；Cypress 保持浏览器级交互/布局证据，不混入 coverage 百分比；增加 HTML 和 XML coverage 产物。
- 审核并更新根目录和 Desktop 文档中的架构、责任、测试与路径说明，避免实现目录与仓库知识继续漂移。
- 不改变用户可见行为、业务规则、API/IPC 契约、认证/授权、持久化数据、依赖框架或视觉设计系统。

## Business Model Impact

无业务模型变化。本 Change 只调整 Desktop 源码、测试、coverage 输出和工程文档组织，不改变 `docs/business-model.md` 中的 Actor、Workspace、Project、Board、Column、Work Item、Card、Placement、User、Session、locale 或法律同意等产品术语，也不改变身份、归属、基数、生命周期、授权、租户范围、版本/历史或并发规则。

建模方法是 evidence-backed source/document audit：检查当前 Desktop Main/Renderer 源码、测试目录、根架构 coverage policy、Desktop testing strategy 和相关 OpenSpec capability inventory。结论是本 Change 实现的是已批准产品行为之下的技术结构整理，不引入新的业务事件、状态转换、拒绝路径、恢复语义或滥用面。若 Apply 中发现实现事实与业务模型不一致，必须暂停并回到 Change 更新/复审，而不是通过目录迁移静默改变产品语义。

## Capabilities

### New Capabilities

- None. 这是纯源码结构、测试结构、coverage 输出和文档组织重构，不引入新的产品或系统能力。

### Modified Capabilities

- None. 现有 OpenSpec specs 的 REQUIREMENTS 不改变；本 Change 在 `.openspec.yaml` 中设置 `skip_specs: true`，避免为无行为变化的重构制造虚假 delta spec。

## Impact

- 主要代码：`apps/desktop/src/main/index.ts`、`apps/desktop/src/main/app/*`、`apps/desktop/src/renderer/**`、`apps/desktop/vitest.config.ts`、`apps/desktop/package.json` 中 coverage 相关脚本/配置。
- 测试：`apps/desktop/tests/main/**`、`apps/desktop/tests/renderer/**`、`apps/desktop/tests/architecture/**`、`apps/desktop/cypress/component/**` 的路径、导入和 spec 命名会随源码结构调整。
- 文档：根 `AGENTS.md`、`docs/README.md`、`docs/architecture.md`、`docs/business-model.md` 需要审核；Desktop `AGENTS.md`、`docs/architecture.md`、`docs/responsibilities.md`、`docs/testing-strategy.md`、`docs/design-foundation.md` 需要审核并按实际 owner 更新。
- Coverage：当前 `test:coverage` 只由 Vitest V8 统计 `tests/main tests/renderer tests/architecture`，include `src/**/*.{ts,tsx}`，exclude 三个入口壳文件，并只输出 `text` 与 `json-summary`；本 Change 将输出扩展为机器可读 XML 和人可读 HTML。
- 不影响 Core API、Gateway、Agent Runtime、数据库 migration、OpenAPI、Desktop API/IPC channel 语义、Electron 安全默认值或生产依赖框架。

## Documentation Impact

- `docs/business-model.md`：预计不更新；本 Change 不改变产品词汇、关系、生命周期、不变量或授权规则。最终 audit 需要记录这一证据结论。
- `docs/architecture.md`：审核 coverage/effectiveness policy、Desktop 边界和测试边界；预计只在已有文字与新的 Desktop coverage 输出或目录 owner 冲突时做最小 Current 更新。
- `docs/README.md`：审核文档地图；本 Change 不新增文档，预计不更新，除非实现中移动/新增/删除工程文档。
- 根 `AGENTS.md`：审核 Desktop/Renderer 路径、Skill routing 和 OpenSpec 指引；预计不更新，除非存在与新结构冲突的路径/owner 表述。
- `apps/desktop/AGENTS.md`：审核本地路径、React/Renderer skill routing 和文档导航；只修正与新结构冲突的引用。
- `apps/desktop/docs/architecture.md`：必须更新 `Current Source Boundaries`、`Renderer Architecture` 和 Main startup 边界，记录 `main/app` 与 Renderer `app/features/shared/i18n/styles` 的 Current/Target 责任。
- `apps/desktop/docs/responsibilities.md`：必须更新 Desktop owner 表，替换过时的 `main/cloud-client`、`main/native`、`renderer/pages`、`renderer/modules/<domain>`、`renderer/components`、`renderer/api` 等责任名。
- `apps/desktop/docs/testing-strategy.md`：必须更新源码/测试镜像规则、Cypress spec 命名、coverage 统计口径、HTML/XML 产物和 Cypress 不计入 coverage 百分比的边界。
- `apps/desktop/docs/design-foundation.md`：审核共享视觉 primitive、样式 owner 和路径引用；预计只在发现 stale path 时最小更新，不借此改变视觉规范。
