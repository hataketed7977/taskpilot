# Proposal

## Why

当前登录页左侧已有网格和看板轮廓，但缺少与网格语言一致、可被直接感知的鼠标反馈。用户给出的 GitHub Universe 参考并不是自动漂移的粒子场：默认画面保持安静，鼠标移动时才在规则网格上留下离散彩色方块尾迹，并快速衰减。登录页需要采用这一交互原则，同时保持 TaskPilot 现有色彩、层级和认证边界。

## What Changes

- 新增登录页左侧 Work Graph 背景能力：静态规则网格叠加现有低对比工作面轮廓，默认不播放自动粒子或路线动画。
- 在桌面精细指针设备上，将真实鼠标路径采样到网格单元；跨格移动时补齐中间单元，形成清晰、连续的彩色方块尾迹。
- 尾迹使用与网格同原点的满格方块，并采用短促、克制的路径长度；每个新方格独立随机受控颜色与可选特殊符号，随机结果在该方格生命周期内稳定。
- 插值方格沿路径错峰出生，各自从中心快速放大、短暂保持，再从中心缩小并淡出；停止移动后在有限时间内完全消失，鼠标静止时不持续生成或移动方块。
- 将网格尺寸、尾迹最大长度、分段生命周期、色调、符号池和动态能力封装为可复用 Renderer 视觉组件配置；本 Change 只在登录页左侧挂载。
- 背景保持 `aria-hidden`、不进入键盘顺序、不捕获点击、不改变认证状态机或数据边界。
- `prefers-reduced-motion`、粗指针/触摸设备、窄窗口和页面失焦使用静态降级；保留现有登录文案、布局和认证流程。

## Business Model Impact

本 Change 只改变认证入口的视觉反馈，不改变业务模型：

- **Actors / canonical terms:** 未认证用户与登录页左侧装饰背景；方格不代表真实 Work Item、Agent、Evidence 或 Approval。
- **Identity / ownership / cardinality:** 尾迹单元是短暂的本地视觉采样，不持久化、不拥有业务身份、不形成业务引用。
- **Lifecycle / invariants / versioning:** 仅有“静止 → 指针移动生成尾迹 → 衰减清空”的视觉状态；不改变任何 User、Session、Workspace、Project 或 Work Item 生命周期。
- **Authorization / async boundary:** 不新增权限、API、IPC、网络或业务异步边界；输入仅为 Renderer 左侧容器内的指针位置。
- **Failure / recovery / concurrency / abuse:** 动态能力不可用时保留静态网格；同一网格单元不重复生成方块，只在存在尾迹时维持单一 RAF 衰减循环，失焦/隐藏/卸载立即清理。

## Capabilities

### New Capabilities

- `login-work-graph-background`: 为登录页左侧提供可访问、可降级、低成本的网格鼠标尾迹背景，并定义其复用边界。

### Modified Capabilities

- 无。`desktop-authentication` 的认证流程、秘密边界和可访问状态合同不变。

## Impact

- **Renderer:** 登录入口挂载；新增纯视觉 Work Graph 组件、配置和网格尾迹调度。
- **Tests:** Renderer 组件测试验证默认静止、路径补格、衰减、单一 RAF 和环境降级；Cypress 在真实 Chromium 验证静止无自动粒子、移动产生多格尾迹、停止后消失及布局无溢出。
- **Dependencies / APIs:** 不新增依赖，不改 Main、Preload、Core API、IPC、认证合同或持久化数据。
- **Performance:** 仅在存在尾迹或待出生方格时使用单一 `requestAnimationFrame`，通过 DOM ref 写位置、内容、transform/opacity，不触发逐帧 React render。

## Documentation Impact

- 更新 Desktop design foundation、responsibilities、testing strategy，使 Current 描述与网格尾迹实现一致。
- `docs/business-model.md`、`docs/architecture.md` 无需修改，因为没有产品实体、生命周期、权限、跨进程或数据合同变化。
- delta spec 在归档授权后同步；本 Apply 不执行 sync/archive/commit。
