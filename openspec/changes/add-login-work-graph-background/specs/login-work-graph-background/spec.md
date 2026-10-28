# login-work-graph-background Specification

## ADDED Requirements

### Requirement: 登录页品牌区域显示独立的 Work Graph 背景

登录页 SHALL 在展示左侧品牌区域的布局中显示静态规则网格和低对比工作面组成的 Work Graph 背景。该背景 MUST 作为装饰层运行，不得替代、隐藏或改变品牌文案、认证内容或法律入口。窄窗口折叠品牌区域时 MUST 优先保持认证内容可见、可读、可操作，且不得引入水平溢出。

#### Scenario: 宽窗口正常加载
- **WHEN** 未认证用户在双栏窗口打开登录页
- **THEN** 左侧显示安静的网格背景，右侧认证内容位置和操作保持不变，且没有自动漂移的方块粒子

#### Scenario: 窄窗口单栏布局
- **WHEN** 窗口折叠左侧品牌区域
- **THEN** 背景不要求显示，页面无水平溢出，认证控件和法律入口保持可用

### Requirement: 精细指针移动生成网格对齐的方块尾迹

在支持精细指针、未请求 reduced motion 且品牌区域可见时，Work Graph SHALL 仅因用户在左侧区域移动指针而生成网格对齐的方块尾迹。跨越多个网格单元时 SHALL 补齐中间路径；同一单元内移动 MUST NOT 重复堆积。最新单元 SHALL 最清晰，较旧单元 SHALL 依次衰减，并在用户停止移动后的有限时间内全部消失。背景 MUST NOT 自主播放路线粒子、自由漂移或圆形光晕。

#### Scenario: 页面静止
- **WHEN** 登录页完成加载且用户未在左侧移动指针
- **THEN** 没有活动尾迹方块，也没有持续 RAF 动画循环

#### Scenario: 指针跨格移动
- **WHEN** 用户在左侧区域从一个网格位置移动到另一个较远位置
- **THEN** 真实移动路径上的多个中间方格依次显示明显的彩色方块，右侧表单不位移且页面不新增滚动

#### Scenario: 指针停止或离开
- **WHEN** 用户停止移动或离开左侧区域
- **THEN** 不再生成新方块，已有尾迹按顺序和时间衰减并在有限时间内完全清空

#### Scenario: 窗口失焦或页面隐藏
- **WHEN** 窗口失焦或页面隐藏
- **THEN** 待执行动画被取消且尾迹立即清空；恢复后保持静止，直到发生新的真实指针移动

### Requirement: 背景交互提供可访问和环境适配的降级

Work Graph SHALL 使用 `aria-hidden="true"` 或等效语义，MUST 不进入辅助技术或键盘顺序，不捕获点击或阻断登录控件。在 reduced motion、粗指针/触摸、不支持动态能力或折叠品牌区时 SHALL 保持静态且不启动隐藏动画。

#### Scenario: reduced motion 或粗指针
- **WHEN** 环境请求减少动态效果或没有 fine pointer
- **THEN** 背景保持静态，不注册方格尾迹动态，认证控件行为不变

#### Scenario: 键盘和辅助技术访问
- **WHEN** 用户使用键盘或辅助技术浏览登录页
- **THEN** Tab 顺序只包含现有可操作控件，背景没有可读名称或焦点目标

### Requirement: Work Graph 组件边界可配置复用

Work Graph SHALL 通过与认证业务解耦的 Renderer 组件提供展示能力，配置至少表达网格尺寸、尾迹最大长度、衰减寿命、色调序列和动态启用策略。登录页 MUST 只传入登录专用配置；本 Change MUST NOT 在其他页面挂载或引入全局业务状态。

#### Scenario: 登录页挂载专用配置
- **WHEN** 登录页渲染 Work Graph
- **THEN** 组件仅依赖固定视觉配置和局部 pointer 输入，不依赖认证 API、Session 或业务实体查询
