# Test Plan

## Strategy

本 Change 使用风险匹配的直接实现与 focused tests，不制造 TDD 红绿证据。关键风险不是“元素是否会动”，而是交互形态是否符合已研究的参考：默认静止、真实鼠标路径触发、满格同原点、错峰补格、生成时随机且生命周期稳定、中心生长/保持/收缩和短促尾迹。

## Scenario Matrix

| Risk / behavior | Layer | Evidence |
| --- | --- | --- |
| 登录页挂载背景且认证不变 | Renderer integration | 装饰层存在、固定 trail slots 存在、登录按钮和状态流不依赖背景 |
| 默认静止而非自动粒子 | component + Cypress | 初始/等待后无 visible trail cell，且未请求 RAF |
| 鼠标路径按网格连续显示 | component + Cypress | 两个跨距 pointermove 后出现多个不同 left/top，包含错峰中间单元 |
| 满格与网格同原点 | component + CSS review | 16px 网格使用 16×16 方格，位置无额外偏移、无边框/圆角/间隙 |
| 随机但不闪烁 | component | mock 随机源证明新记录可取不同颜色/符号，后续 RAF 不改变同一记录属性 |
| 独立出生和退出 | component + Cypress | 中间格 enteredAt 有序；单格经历小→满格→小并渐入渐出 |
| 同格不重复、长度有上限 | component | 同一网格内移动不增加 visible cells；固定 DOM 槽位 |
| 停止后快速清理 | component + Cypress | 超过最长分段生命周期后 visible cells 为 0 且 RAF 队列为空 |
| blur/hidden/unmount 清理 | component | 取消唯一 frame 并清空尾迹；恢复不自动启动 |
| reduced/coarse/narrow 降级 | component + Cypress | 不注册动态尾迹，背景静态，窄屏无隐藏 RAF |
| 可访问与布局隔离 | Renderer + Cypress | `aria-hidden`、`pointer-events: none`、登录键盘路径和无水平溢出 |
| 工程边界 | source review + qualityCheck | 无新依赖、无 API/IPC、无逐帧 React state |

## Implementation Slices

1. 配置化静态网格与固定 trail slots。
2. 网格采样、错峰跨格插值、单元随机属性、独立中心生长/收缩和单一按需 RAF。
3. 登录挂载、环境降级、focused/Cypress 测试和 Desktop 文档反馈。

## Commands

- `pnpm --filter @taskpilot/desktop exec vitest run --config vitest.config.ts tests/renderer/auth-experience.test.tsx tests/renderer/work-graph-background.test.tsx`
- `pnpm --filter @taskpilot/desktop cypress:run --component --spec cypress/component/first-use.cy.tsx`
- `pnpm --filter @taskpilot/desktop qualityCheck`
- `openspec validate --all --strict --no-interactive`
- `git diff --check`

## Manual Acceptance

在实际 Electron/Chromium `1280 × 800`、`960 × 640` 与 `480 × 640` 检查：默认画面安静；鼠标移动立即出现满格字符方块路径；快速移动仍连续且逐格出生；尾迹短促、不堆积、不抢标题层级；每格从中心生长、短暂保持并缩小消失；文案和表单保持清晰；reduced motion 静态；不同 DPI、macOS/Windows 焦点表现正常。自动化可证明行为合同，但不能替代尾迹节奏、色彩和整体观感验收。
