# Tasks

<!-- 本 Change 使用直接实现与风险匹配验证，不制造 TDD 红绿证据。 -->

## 1. 网格尾迹视觉组件

- [x] 1.1 新增与认证业务解耦的 Work Graph 组件和登录配置，表达网格尺寸、尾迹长度、寿命、色调及动态策略，不引入新依赖。
- [x] 1.2 实现默认静止的规则网格；精细指针移动时按网格采样真实路径、补齐跨越单元，并使用固定 DOM slots 呈现方块尾迹。
- [x] 1.3 使用按需单一 RAF 衰减尾迹；队列为空停止调度，blur/hidden/unmount 清理，reduced/coarse/narrow 静态降级。

## 2. 登录页整合与验证

- [x] 2.1 仅在 `AuthExperience` 左侧 `.brand-panel` 挂载，保持 `aria-hidden`、`pointer-events: none`，不改变认证、表单或右侧布局。
- [x] 2.2 使用现有 TaskPilot 色彩和网格语言，删除自动路线粒子、自由漂移、视差吸附和圆形光晕。
- [x] 2.3 focused tests 覆盖默认无动画、跨格连续路径、同格去重、寿命衰减、单一 RAF、清理和环境降级。
- [x] 2.4 Cypress 在真实 Chromium 验证静止无方块、鼠标移动出现多格尾迹、停止后消失及 `960 × 640`/`480 × 640` 无溢出。

## 3. 文档与门禁

- [x] 3.1 根据真实参考页研究修正 proposal/spec/design/test-plan，不再把“会自动移动”作为正确交互证据。
- [x] 3.2 更新 Desktop design foundation、responsibilities、testing strategy 的 Current 描述。
- [x] 3.3 运行 Desktop qualityCheck、focused Cypress、OpenSpec strict validation 和 `git diff --check`。
- [x] 3.4 self-review 实现、文档和业务模型边界；等待用户实际视觉验收，不执行 sync/archive/stage/commit。

## 4. 方格尾迹质感优化

- [x] 4.1 扩展配置和轨迹记录，支持满格方块、受控随机色调、可选特殊符号和有上限的路径错峰时长。
- [x] 4.2 将方块改为与 16px 网格同原点的 16×16 满格，并实现每格独立的中心放大、保持、中心缩小及渐入渐出。
- [x] 4.3 更新 focused/Cypress 测试，证明随机属性生命周期稳定、插值格错峰出生、满格对齐、短促清理和环境降级。
- [x] 4.4 更新 Desktop Current 文档，运行 focused tests、Chrome Cypress、qualityCheck、OpenSpec strict validation 和 self-review。

## 5. 源码节奏校准

- [x] 5.1 根据 GitHub Universe 当前线上 bundle/CSS 校准为短促尾迹：约 100ms 进入、100–400ms 随机 active window、约 100ms 退出，保留 TaskPilot 路径插值但避免长尾堆积。
- [x] 5.2 更新 focused/Cypress 测试、Desktop Current 文档和 OpenSpec artifacts，运行受影响门禁并完成实际 Chromium 视觉检查。
