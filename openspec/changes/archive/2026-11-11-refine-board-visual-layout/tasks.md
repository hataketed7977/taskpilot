# Tasks

## 1. Board Layout and Card Presentation

- [x] 1.1 修改生产布局前，先保留同一中英文五列 fixture 在 960×640、1280×800、1600×900 下的旧版截图与几何摘要；随后使用 `frontend-design` 的 design D1 方向调整 `board-workspace.tsx` 与局部样式，复用当前 `tokens.css` 配色：紧凑 Project 上下文、Board tabs／操作对齐、浅色整列与可达添加入口；客观证据为旧版 baseline、保留现有操作且不修改全局 token 的 JSX／CSS diff，以及新布局无页面溢出／操作重叠的 Chromium 检查。
- [x] 1.2 使用 `vercel-react-best-practices` 实现 design D2 的有界 Card：标题最多两行、一行摘要、稳定底部责任槽与权威头像；证据为同标题分配／清空和空／非空摘要几何稳定、长描述不增高、完整标题／人员含义可访问，且创建与详情行为无改动。
- [x] 1.3 在同切片更新 `project-board.test.tsx` 与 `board.cy.tsx` 的受影响断言，替换旧 110px 等高／右上角头像场景并保留详情、创建和错误恢复回归；运行 test-plan 的 Focused Renderer／Chromium 命令，在相同浏览器、viewport、缩放、数据顺序与起始滚动位置保存三尺寸中英文新版截图，与 1.1 的 baseline 对照并记录顶部占用、实际列宽、可见 Card 数及标题可读性／留白。
- [x] 1.4 同步 `apps/desktop/docs/design-foundation.md`、`architecture.md`、`responsibilities.md`、`testing-strategy.md` 中本切片的布局与 Card recipe；证据为文档明确区分已实现 Current、仍待后续 Change 的编辑统一与其他 Target 能力，且不再把旧 Card 几何描述为新实现。

## 2. Drag Geometry and Recovery

- [x] 2.1 按 design D3 将实际源 Card 尺寸接入两个唯一占位槽出口，保留既有预览、anchor 和 API owner；dragend／drop／卸载清理临时尺寸；证据为本轮没有固定 110px 槽依赖、无每帧全量新测量或新 DnD 依赖，原移动载荷不变。
- [x] 2.2 同切片增加／调整 Renderer 确定性拖拽场景与 Chromium 高低 Card、上下半区、空列／末尾、取消／失败、唯一槽／清理场景；reduced-motion 用例参照 `select.cy.tsx` 使用 `Emulation.setEmulatedMedia`，断言真实媒体查询匹配、Column／Card 相关 computed transition duration 为零、占位槽／settling 的 computed animation name 为 `none` 和 FLIP 未调用，且槽与目标提示仍可见、提交及权威结果正确；`afterEach` 重置 `features: []`，不以 stub `matchMedia` 替代 CSS 验证；运行 Focused 命令，证据为正确 anchor、源高／槽高匹配和至少一条真实 Chromium mouse drag 成功。
- [x] 2.3 同步 design foundation 的拖拽几何说明及 child architecture／responsibilities／testing strategy 的实际尺寸与验证责任；证据为文档 source pointer 与生产 owner 对应，且业务移动、scope、version 和失败恢复规则未被改写。

## 3. Model and Documentation Reconciliation

- [x] 3.1 运行 test-plan 的 affected gates：`pnpm desktop:quality`、`pnpm --filter @taskpilot/desktop test:e2e`、`pnpm --filter @taskpilot/desktop test:packaged-native`；记录实际结果与 coverage，不因不相关边界未改动而跳过已有 Desktop gate。
- [x] 3.2 使用 `web-design-guidelines` 对实现的看板进行 UI／UX／accessibility 自审并处理范围内问题；证据为 focus、目标尺寸、滚动、对比度、reduced-motion 和变高 Card 操作检查结果，以及修复后必要的 affected rerun。
- [x] 3.3 对照已批准模型、delta scenarios、实际 JSX／CSS／drag、测试与证据做最终语义和文档反馈审计；记录无 migrations／API／授权变化、根 `business-model.md`／`architecture.md` 无需更新的证据，核对 child Current／Target，确认未改写创建／编辑或旧详情移动议题，且 delta 可在后续授权时 sync。
- [x] 3.4 运行 `pnpm exec openspec schema validate taskpilot-sdd --verbose`、`pnpm exec openspec validate --all --strict --no-interactive` 与 `git diff --check`，自审实际 diff 对本 Change 的范围和验收映射；整理实现交接结果，保持 Change active，等待用户安排独立代码评审和人工验收，不执行 sync／archive。
