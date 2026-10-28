# Design

## Context

`AuthExperience` 的 `.brand-panel` 已包含品牌文案、页脚、静态网格和低对比 `.board-signature`；`max-width: 760px` 下品牌区折叠为单栏登录。视觉背景不得读取认证状态或影响右侧表单。

本设计已在真实 Chromium 中研究用户指定的 GitHub Universe 页面：其关键不是自动粒子流，而是静止网格上的 pointer trail。鼠标路径被量化到规则网格，经过的单元依次点亮，头部最实、尾部快速衰减；鼠标停止后画面恢复安静。TaskPilot 采用此交互原则，不复制其品牌素材、字符纹理、Three.js 代码或具体资产。

## Goals / Non-Goals

**Goals:**

- 默认只显示安静网格和既有低对比工作面；不自动漂移粒子。
- 精细指针移动时生成明显、连续、网格对齐的方块尾迹，停止后快速消失。
- 复用 TaskPilot `action`、`agent`、`human`、`warning` 色彩，保持品牌文案和表单层级稳定。
- 动态更新低成本、可取消、可降级、可自动化验证。

**Non-Goals:**

- 不修改认证、Session、Main/Preload/Core API 或业务模型。
- 不重做布局比例、品牌文案、右侧表单或窄屏折叠。
- 不增加自动路线、自由粒子、圆形光晕、模糊跟随层、3D/WebGL 或新依赖。
- 不复制参考站的 GitHub 品牌、角色、字符方格或专有实现。

## Business Model

该组件只有本地短暂视觉状态：网格坐标、进入时间和衰减进度。方格没有业务身份、持久化、权限、租户或历史语义；实现不跨 Renderer 边界。故障或不适配环境直接使用静态网格，不阻断认证。

## Decisions

### 1. 组件配置表达网格尾迹，而不是业务图或路线粒子

`WorkGraphBackground` 接收 `cellSizePx`、`trailLength`、`enterDurationMs`、随机 `activeDurationRangeMs`、`exitDurationMs`、插值路径最大错峰时长、受控色调序列、符号池和动态启用策略。`AuthExperience` 只挂载登录专用配置。既有 `.board-signature` 继续承担低对比工作图语义，动态层只负责鼠标网格尾迹。

### 2. 指针路径按网格采样并补齐跳过单元

`pointermove` 读取品牌区边界，将指针坐标量化为列/行。同一单元内移动不新增方块；跨越多个单元时使用离散线性插值补齐路径，避免事件采样频率低时尾迹断裂。最多保留固定数量单元，防止无界增长。

方块位置与背景网格共用同一 `cellSizePx`，使用近满格的正方形而非圆点、模糊光晕或自由坐标粒子。色彩来自 TaskPilot 现有令牌。

### 3. 只在尾迹存在时运行单一 RAF

pointer 事件通过 ref 直接更新短暂队列；React 不逐帧 setState。RAF 只负责依据进入时间和单格分段生命周期计算 opacity/scale：约 100ms 中心放大进入、100–400ms 随机 active window 内短暂保持、约 100ms 中心缩小退出，退出前半段优先展示缩小动作、后半段再淡出。队列为空即停止调度，因此静止页面没有持续动画开销。

每次新 pointer 采样先取消旧的待执行 frame，再写当前画面并只调度一个后续 frame，确保不存在重复循环。blur、hidden、能力降级和 unmount 会取消 frame 并清空尾迹。

### 4. 动态层不接管交互和布局

Work Graph 根节点保持 `aria-hidden="true"`、`pointer-events: none`，pointer listener 绑定到 `.brand-panel`。品牌标识、文案和页脚位于其上方；右侧 `.auth-panel` 不读取任何视觉变量。窄屏继续隐藏品牌区，不为装饰改变布局。

### 5. 环境降级

`prefers-reduced-motion: reduce`、无 fine pointer、品牌区折叠或动态能力关闭时不注册 pointer trail；只保留静态网格/工作面。窗口失焦或页面隐藏立即清除尾迹，恢复后等待下一次真实指针移动，不自动播放或补偿离开期间的运动。

## Verification

- 组件测试：初始无活动方块且无 RAF；跨格 pointermove 补齐连续单元；同格不重复；分段生命周期结束后完全清空并停止 RAF；blur/unmount 清理；reduced/coarse/narrow 静态降级。
- Cypress：真实 Chromium 等待后仍无活动方块；两次跨距 pointermove 后出现多个不同网格坐标；约 750ms 后全部消失；登录按钮可用且无水平溢出。
- 手工验收：在实际 Electron 窗口检查尾迹可见度、跟手性、文字层级、不同 DPI 和 macOS/Windows 焦点行为。

## Risks / Trade-offs

- **轨迹太弱或太短：** 使用 16 × 16 满格方块、随机保持时长和真实浏览器视觉验收，证明多格可见且不堆积成过长尾巴，而非只测内部变量。
- **事件采样导致断裂：** 补齐首尾之间网格单元。
- **持续计算：** 队列为空即停 RAF；固定 30 个 DOM 槽位，无新依赖。
- **内容干扰：** 动态层位于文案后方并受品牌区裁剪，实际窗口仍需主观验收。

## Open Questions

无。用户已明确要求 GitHub Universe 风格的方格鼠标尾迹，并否定自动粒子和圆形光晕。
