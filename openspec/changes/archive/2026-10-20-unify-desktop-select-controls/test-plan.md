# Test Plan

## Scope and Risk

范围是 Desktop Renderer 的共享单值 Select、统一 LanguageSelector、Work Item 编辑 Column 选择、相关 CSS、依赖和局部文档。风险等级为 **High UI interaction / Routine business regression**：错误实现可能使用户无法用键盘选择、菜单被 Dialog 裁切、焦点丢失，或把错误 Column/locale 交给既有业务回调；但不改变认证秘密、授权、API、数据库或持久化模型。

业务不变量是现有 value 语义不漂移：locale 仍限定为 `zh-CN | en`，Column 仍提交稳定 `columnId`，取消和同值选择不制造业务提交。没有新的业务生命周期、租户边界、授权、并发、重试或服务恢复规则；这些后端风险不进入本 Change 的测试矩阵。

明确不测试或实现完整 Design System、Dialog/Input/Button 重构、搜索、多选、异步选项、更多语言、Column 业务行为或跨平台原生辅助技术认证。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| 指针或键盘确认一个选项只触发一次稳定 value | Vitest Renderer | 新增共享 Select focused cases，断言当前 label、选择新项和 `onValueChange` 参数/次数 | React 状态与回调协议可在最低确定性层验证 |
| Escape/外部关闭不改变值，关闭后回到 trigger | Vitest Renderer + Cypress component | Vitest 验证取消无回调；Cypress 以 Chromium 键盘打开、Esc、确认并检查焦点 | 焦点与 headless primitive 的浏览器行为不能只靠 jsdom 声明 |
| Dialog 内 Escape 只关闭最上层 Select | Cypress component | 在 Work Item Dialog 打开 Column 菜单；第一次 Escape 断言菜单关闭、Dialog 保留且 trigger 获得焦点，第二次 Escape 才按既有协议关闭 Dialog | 必须在真实 Portal、document/window 事件传播与 Dialog listener 组合下验证 |
| disabled 不可打开或改变值 | Vitest Renderer | role/name 定位 trigger，断言 disabled 与无业务回调 | 纯组件状态无需浏览器布局层 |
| 选中项可由语义和非颜色标记识别 | Vitest Renderer + source review | 断言 option selected state 与选中图标隐藏语义；复核 CSS 不只依赖背景色 | 语义可自动断言，视觉冗余需代码证据 |
| 长选项、长当前值和内部滚动不破坏布局 | Cypress component | 构造长 label 与足够多 options，检查 trigger/content 边界、可视窗口、首尾项可达和无横向溢出 | 需要真实 Chromium 尺寸、Portal 与滚动布局 |
| 最小窗口和靠边 trigger 的菜单碰撞避让 | Cypress component | `960×640` 中在 Dialog/页面边缘打开菜单，断言 content 落在 viewport 内且不被裁切 | jsdom 没有可靠布局和碰撞检测 |
| Dialog 中选择 Column 后保持 Dialog，并提交正确 `columnId` | 既有/扩展 Board Renderer + Cypress component | 编辑 Work Item，选择另一 Column，保存并断言 `targetColumnId`；检查菜单 z-index、焦点返回与主操作可达 | Renderer 证明业务参数，Chromium 证明 Portal 集成 |
| Work Item 提交期间 Column Select 不可变更 | Board Renderer + Cypress component | 让保存 Promise 保持 pending，断言 Column trigger disabled、菜单不可重新打开且请求中的 `targetColumnId` 不变 | 共享组件单测只能证明 prop 行为，调用点集成测试证明 pending 状态确实接入 |
| 登录与账号区复用相同 locale 选项并即时切换 | 既有/扩展 i18n Renderer + Cypress component | 两个入口均断言 `zh-CN/en`、切换后文案/lang 更新、认证/账号状态不重置 | 防止抽取改变既有国际化行为 |
| reduced-motion 移除非必要菜单位移动画 | Cypress component + CSS review | 模拟 media preference 或读取生效规则，断言 content 动画/位移被禁用但状态仍可见 | 浏览器样式层拥有该风险 |
| 新依赖不越过 Renderer 边界且 bundle 可构建 | dependency/source review + build | 检查 package/lockfile、imports 仅在 Renderer；Desktop build 成功 | 依赖边界不是业务单测问题 |
| 所有原生 `<select>` 已迁移且未形成第二套选项源 | source query + lint | 在生产 Renderer 中查询 `<select>` 和重复 locale option，预期无遗留；ESLint/TypeScript 通过 | 防止漏迁移和静态类型漂移 |
| 现有认证、Project 与 Board Renderer 行为无回归 | affected Desktop suites | Desktop renderer tests、component E2E、qualityCheck 通过 | 覆盖共享 CSS/组件替换对直接调用页的影响 |

## Implementation and Verification Approach

### Slice 1: 共享 Select primitive

对明确的组件交互采用 Red-Green-Refactor：先增加 focused Renderer 与 Cypress 用例，覆盖确认、取消、disabled、焦点、长列表、碰撞和 reduced-motion；再锁定 headless 依赖并实现窄包装与样式。测试只操作 role/name 和用户行为，不读取第三方内部 DOM class。基础组件层只证明 Escape dismiss 和 disabled prop 协议；Dialog 两级 Escape 与提交 pending 接线由 Slice 3 的真实调用点测试拥有。

### Slice 2: 统一语言选择

先扩展既有 i18n 测试，证明登录与账号入口的选项集合、即时切换、`document.lang`、流程状态和焦点；再合并 LanguageSelector 与页面布局变体，删除重复 locale 列表和旧原生 select 样式。业务行为与生产迁移在同一 task group 落地。

### Slice 3: Work Item Column 选择

先把既有 Board 测试收紧到自定义 Select 的键盘/确认路径、Dialog 两级 Escape、pending disabled 与准确 `targetColumnId`；再替换原生字段并验证 Dialog Portal、保存、取消和焦点。不得改 Work Item API、Dialog 通用实现或移动语义。

### Slice 4: 收尾与文档反馈

删除仅服务旧原生 Select 的 CSS，运行 source query、focused、affected 与完整 Desktop gates。根据实际实现更新 Desktop design foundation 和 responsibilities；对业务模型与根架构执行无漂移审计并记录不更新原因。OpenSpec 只做 strict validation，不自动 sync/archive。

## Verification Commands

### Focused

- `pnpm --filter @taskpilot/desktop exec vitest run --config vitest.config.ts tests/renderer/select-control.test.tsx`: 共享 Select 的值、取消、禁用和语义协议。
- `pnpm --filter @taskpilot/desktop exec vitest run --config vitest.config.ts tests/renderer/i18n-auth-experience.test.tsx tests/renderer/project-home.test.tsx tests/renderer/project-board.test.tsx`: 两处语言入口与 Work Item Column 业务回归。
- `pnpm --filter @taskpilot/desktop exec cypress run --component --spec cypress/component/select-control.cy.tsx,cypress/component/project-board.cy.tsx`: Chromium 键盘、Portal、碰撞、长列表、reduced-motion 与 Dialog 集成。
- `rg -n '<select' apps/desktop/src/renderer --glob '*.tsx'`: 生产 Renderer 不再遗留本 Change 范围内的原生 Select。
- `git diff --check`: 变更文本完整性。

### Affected and Cross-Boundary

- `pnpm --filter @taskpilot/desktop test:renderer`: 所有 Renderer 行为回归。
- `pnpm --filter @taskpilot/desktop test:e2e`: 所有 Desktop component journeys，覆盖共享样式和 Portal 对其他页面的影响。
- `pnpm --filter @taskpilot/desktop qualityCheck`: TypeScript、ESLint、Main/Renderer/architecture tests、coverage 与 build。
- `openspec validate unify-desktop-select-controls --strict --no-interactive`: Change 结构与 delta spec 校验。
- `openspec validate --all --strict --no-interactive`: 当前仓库全部 active Changes/main specs 的结构校验；不替代实现测试。

## Manual Evidence and Automation Gaps

- **macOS Electron 视觉与交互走查（Owner：本 Change 实施者 + 用户验收）**：在登录页、账号区和 Work Item Dialog 的中文/英文、标准窗口及 `960×640` 检查 trigger 密度、菜单阴影、选中标记、长文本、窗口边缘避让和焦点。原因：Cypress 可证明 DOM/布局边界，但不能完整判断 Electron 原生窗口中的视觉品质。
- **Windows 与 macOS 原生辅助技术兼容（Owner：后续发布 gate）**：本 Change 自动化验证 Chromium role/keyboard/focus，不声称已通过 VoiceOver/Narrator 的发布认证。后续签名安装包发布前按 Desktop testing strategy 执行平台验收。
