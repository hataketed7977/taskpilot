# Design

## Context

见 `proposal.md` 的 Why。Renderer 当前在 `App.tsx`、`project-home.tsx` 和 `board-workspace.tsx` 直接渲染 3 个原生 `<select>`。登录页语言选择已有自定义外壳，账号区又实现了一套语言选择，Work Item Dialog 使用第三套表单样式；浏览器展开原生菜单后，选中背景、菜单圆角和阴影仍由 Chromium/操作系统控制。

Desktop 当前没有 UI 组件库，React Renderer 由单一 `styles.css` 持有设计 token。`apps/desktop/docs/testing-strategy.md` 要求交互在 Renderer 测试验证确定性状态，在真实 Chromium component test 验证布局、焦点和浏览器行为。当前工作树还包含在途 `add-project-boards-and-work-items`，因此本 Change 只能增量集成，不能把其文件恢复到 `HEAD`。

## Goals / Non-Goals

**Goals:**

- 建立一个局部、受控、可复用的单值 Select primitive，页面只提供 value、options、label、状态和业务回调。
- 由成熟 headless primitive 承担 WAI-ARIA、键盘、焦点、Portal 和碰撞检测等基础协议，TaskPilot 自行拥有视觉。
- 统一 3 个现有选择字段，并消除两套语言选项与切换逻辑。
- 保持现有业务 value、表单提交时机和错误恢复路径不变。

**Non-Goals:**

- 不建设完整 Design System、通用表单引擎或组件目录体系。
- 不统一 Dialog、Button、Input、Textarea；审计发现的 Dialog 重复只作为后续候选，不在本 Change 处理。
- 不增加搜索、多选、分组、异步加载、虚拟列表或自定义值。
- 不改变支持语言集合、Column 业务模型、Work Item 原子编辑或任何 Main/Core API 契约。

## Business Model

通过关系/状态检查与示例映射确认没有模型变化：Select 没有业务身份，只是把一个稳定 value 映射到当前本地化 label。语言 Select 的 value 仍为受支持 locale；Column Select 的 value 仍为 `columnId`，其 Project/Board 归属、授权、Placement 版本和保存事务继续由既有业务路径拥有。控件只存在 closed/open/highlighted/selected/disabled 的瞬时视图状态，不持久化历史，不改变业务生命周期。

关键不变量：只有用户确认的现有 option value 才触发 `onValueChange`；取消不改变 value；同值选择不制造业务动作；关闭后焦点回到 trigger；业务错误仍由所属页面处理。没有新增异步边界、并发策略、租户范围或数据所有权。`docs/business-model.md` 中 locale、Column、Work Item 和 Placement 规则保持原样。

## Decisions

### 1. 使用 Radix Select primitive，而不是手写 listbox 或完整 UI 框架

新增精确版本的 `@radix-ui/react-select`，由它负责 combobox/listbox 语义、方向键与 typeahead、焦点返回、外部关闭、Portal、滚动按钮和碰撞处理。TaskPilot 包装层只暴露当前需要的受控单值 API，并完全使用仓库 token 定义视觉。

选择它而不是手写，是因为自制可访问 Select 容易遗漏 IME/typeahead、焦点、Portal、屏幕阅读器和边界定位；选择它而不是 Semi/MUI 等完整框架，是为了避免第二套视觉 token、全局样式和大范围组件迁移。原生 `<select>` 作为替代方案保留了平台语义，但无法实现用户确认的展开菜单视觉，因此不采用。

依赖锁定在 `apps/desktop/package.json` 与 `pnpm-lock.yaml`。它只进入 Renderer bundle，不接触 Electron Main、Preload 或网络。

### 2. 包装层保持窄 API，并把页面语义留给调用方

新增局部共享组件（建议 `apps/desktop/src/renderer/components/select.tsx`）：

- `value: string`
- `options: readonly { value: string; label: string; disabled?: boolean }[]`
- `onValueChange(value: string): void`
- `ariaLabel` 或 `labelledBy`，必须二选一
- `disabled?: boolean`
- `variant?: "default" | "compact"`
- 必要的稳定测试定位不进入生产 API；测试按 role/name 操作

组件不接收任意 JSX item renderer、远程数据源或业务对象，避免过早形成通用框架。trigger 的可见文本单行省略，完整 label 保留在语义树和 option 中；Content 使用 `position="popper"`、collision padding、trigger width 下限和 available-height 上限。Portal 内容使用明确的高于 Dialog 的层级，但不改变 Dialog 本身。

Work Item 可见字段使用独立 label id 关联 trigger，不把 button 嵌套进 `<label>`。语言选择器使用可理解的 `aria-label`。选中项同时具备语义状态、勾选图标和对比明确的表面；highlight 与 selected 分开表达。图标均为装饰并从辅助技术隐藏。Work Item 编辑请求进入 `pending` 后，调用方必须向共享 Select 传入 `disabled`，阻止请求期间重新打开菜单或改变已提交的 `targetColumnId`。

Dialog 内的 Select 必须分层处理 Escape：菜单打开时，Select 的 Escape handler 只阻止该键盘事件继续传播给所属 Dialog，不阻止 primitive 自身 dismiss；因此第一次 Escape 关闭菜单并把焦点还给 trigger，菜单已关闭后的下一次 Escape 才沿用 Dialog 的既有关闭协议。该局部事件协调不重构或改写通用 Dialog。

### 3. 只统一一个 LanguageSelector，实现布局变体而非复制逻辑

将 locale options 和 `changeLocale` 连接集中到一个 `LanguageSelector`。它使用共享 Select，并提供适合登录页的 `floating/default` 与账号区的 `account/compact` 布局变体；变体只决定外层布局、可见标签与尺寸，不改变选项或行为。两处都直接消费 `SUPPORTED_LOCALES` 对应的本地化 label，避免语言集合再次硬编码分叉。

不把语言选择并入通用 Select 本身，避免基础控件依赖 i18n 或业务状态。

### 4. 视觉采用克制的“浮层命令面”，而不是模拟系统菜单

trigger 与现有 42px 表单控件共用 8px 圆角、`var(--line-strong)` 边界和 `var(--focus)` focus-visible ring；compact 变体缩小高度但不牺牲清晰点击目标。Content 是紧凑的 `var(--paper)` 浮层，使用细边界和一层低扩散阴影，不使用大面积渐变或发光。Item 以左侧 check/内容对齐，highlight 使用矿物绿低对比表面与清晰文字，避免系统蓝色和仅颜色反馈。

打开/关闭只允许短 opacity/轻微 translate 动效；reduced-motion 下移除位移和动画。菜单内部滚动，不能扩张 Dialog 或产生页面横向滚动。主题只使用现有 CSS variables，不新增页面私有颜色。

### 5. 测试按能力分层，不以合成测试冒充真实浏览器布局

- Vitest Renderer：验证 value/label 映射、业务回调只在确认后触发、取消保持值、disabled、两处语言切换共享行为及 Work Item 保存仍发送所选 `columnId`。
- Cypress component（真实 Chromium）：验证标准键盘路径、焦点返回、role/selected 语义、Portal 不被 Dialog 裁切、Dialog 内两级 Escape、`960×640` 碰撞避让、长名称、菜单内部滚动、提交期间 disabled 与 reduced-motion CSS。
- 既有 i18n/Board Renderer tests：回归认证状态不重置、locale 即时切换及 Work Item 原子编辑参数。
- 人工视觉走查：验证 macOS/Electron 中的密度、阴影、选中态和中英文观感。Cypress 只能证明布局与交互，不代替审美验收。

这是明确可自动化的交互边界，适合先写 focused failing tests，再实现和重构；不为文档或依赖安装制造形式化 Red/Green。

## Risks / Trade-offs

- **[Portal 脱离 Dialog DOM，可能被遮挡、破坏焦点或让一次 Escape 同时关闭菜单和 Dialog]** → 使用 primitive 的 Portal/focus 协议和专用 z-index token；Select Escape handler 阻止继续传播但保留自身 dismiss；Cypress 在真实 Dialog 中验证可见、选择、两级 Escape 和焦点返回。
- **[headless 依赖增加 Renderer bundle 与升级面]** → 只引入单个精确版本 package，不引入主题/图标库；build 检查和 lockfile review 证明依赖边界。
- **[自定义 Select 的浏览器/辅助技术兼容性仍不如原生控件零成本]** → 不手写 ARIA 状态机；覆盖标准键盘与 role/state，并保留既有表单非拖拽路径。Windows/macOS 双平台原生辅助技术仍属于发布验收，而非本地 Cypress 已证明事实。
- **[长 Column 列表可能超过视口]** → Content 使用 available height、Viewport 滚动与滚动按钮；Cypress 用足够多的选项验证首尾可达。当前规模不需要虚拟化。
- **[在途 Board Change 同文件冲突]** → apply 前重新读取工作树，以最小 diff 替换 Select 调用点；禁止 reset、checkout 或覆盖其他 Change。
- **[抽取范围继续膨胀到全套组件库]** → tasks 只允许 Select 和 LanguageSelector；Dialog/Input/Button 审计结果不转化为本 Change 任务。

## Migration Plan

1. 增加并锁定 headless Select 依赖，建立共享 Select 与 focused tests。
2. 先迁移统一 LanguageSelector，验证未登录和已登录路径保持即时切换。
3. 迁移 Work Item Column 字段，保持现有 `targetColumnId` 参数和保存行为，并在提交 pending 期间禁用 trigger。
4. 删除仅服务旧原生 `<select>` 的重复样式，保留其他表单规则；运行 focused、affected Desktop checks 和人工视觉走查。
5. 实施证据成立后更新 Desktop design/responsibility 文档的 Current 描述。

本 Change 不涉及数据迁移或服务端 rollout。若新控件产生不可接受的 Electron/辅助技术问题，可在不改变业务契约的情况下回退组件调用和依赖，恢复原生 `<select>`；不需要数据回滚。
