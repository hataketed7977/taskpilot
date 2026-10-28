# Test Plan

## Strategy

本 Change 使用风险匹配的直接实现与 focused tests，不制造 TDD 红绿证据。关键风险不是“元素是否会动”，而是交互形态是否符合已研究的参考：默认静止、真实鼠标路径触发、网格补格、明显方块尾迹、短时衰减。

## Scenario Matrix

| Risk / behavior | Layer | Evidence |
| --- | --- | --- |
| 登录页挂载背景且认证不变 | Renderer integration | 装饰层存在、固定 trail slots 存在、登录按钮和状态流不依赖背景 |
| 默认静止而非自动粒子 | component + Cypress | 初始/等待后无 visible trail cell，且未请求 RAF |
| 鼠标路径按网格连续显示 | component + Cypress | 两个跨距 pointermove 后出现多个不同 left/top，包含中间单元 |
| 同格不重复、长度有上限 | component | 同一网格内移动不增加 visible cells；固定 DOM 槽位 |
| 停止后快速衰减 | component + Cypress | 超过配置寿命后 visible cells 为 0 且 RAF 队列为空 |
| blur/hidden/unmount 清理 | component | 取消唯一 frame 并清空尾迹；恢复不自动启动 |
| reduced/coarse/narrow 降级 | component + Cypress | 不注册动态尾迹，背景静态，窄屏无隐藏 RAF |
| 可访问与布局隔离 | Renderer + Cypress | `aria-hidden`、`pointer-events: none`、登录键盘路径和无水平溢出 |
| 工程边界 | source review + qualityCheck | 无新依赖、无 API/IPC、无逐帧 React state |

## Implementation Slices

1. 配置化静态网格与固定 trail slots。
2. 网格采样、跨格插值、衰减和单一按需 RAF。
3. 登录挂载、环境降级、focused/Cypress 测试和 Desktop 文档反馈。

## Commands

- `pnpm --filter @taskpilot/desktop exec vitest run --config vitest.config.ts tests/renderer/auth-experience.test.tsx tests/renderer/work-graph-background.test.tsx`
- `pnpm --filter @taskpilot/desktop cypress:run --component --spec cypress/component/first-use.cy.tsx`
- `pnpm --filter @taskpilot/desktop qualityCheck`
- `openspec validate --all --strict --no-interactive`
- `git diff --check`

## Manual Acceptance

在实际 Electron/Chromium `1280 × 800`、`960 × 640` 与 `480 × 640` 检查：默认画面安静；鼠标移动立即出现方格路径；快速移动仍连续；停止后自然消失；文案和表单保持清晰；reduced motion 静态；不同 DPI、macOS/Windows 焦点表现正常。自动化可证明行为合同，但不能替代尾迹节奏、色彩和整体观感验收。
