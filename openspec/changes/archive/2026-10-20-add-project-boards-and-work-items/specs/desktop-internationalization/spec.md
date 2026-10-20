# Spec Delta

## MODIFIED Requirements

### Requirement: 当前 Desktop 体验可即时切换语言
Desktop SHALL 在未登录和已登录界面提供可通过键盘与辅助技术操作的语言选择。选择受支持语言后，当前窗口的可见产品文案、状态、错误、可访问名称、法律文档、Board、Column、Card、Work Item 操作和 locale-sensitive 格式 SHALL 在无需重启、重新登录或新建认证 attempt 的情况下切换；文档根元素的 `lang` SHALL 与当前 locale 一致。

#### Scenario: 登录页切换语言
- **WHEN** 用户在登录页从简体中文切换为 English
- **THEN** 登录页、品牌说明、GitHub 登录动作和辅助文本立即显示英文，当前认证 capability 不被重新请求

#### Scenario: 等待或失败状态切换语言
- **WHEN** 用户在 GitHub 等待、取消或错误状态切换语言
- **THEN** 当前流程状态保持不变，仅其可见文案和辅助技术公告切换语言

#### Scenario: 已登录页切换语言
- **WHEN** 用户在账号页切换语言
- **THEN** 账号状态、当前 Workspace、Project、Board、Column 与 Work Item 数据保持不变，页面、Board 操作和退出操作立即使用所选语言且不重新加载业务数据

#### Scenario: Board 工作区切换语言
- **WHEN** 用户在 Board、Column 或 Work Item 加载、空状态、错误或移动结果中切换语言
- **THEN** 产品文案与辅助技术公告立即切换，用户输入的名称、描述和当前业务布局保持不变

#### Scenario: 键盘和辅助技术使用
- **WHEN** 用户仅使用键盘或辅助技术访问语言选择
- **THEN** 控件具有可理解的当前值、选项名称和可见焦点，切换后焦点不丢失

### Requirement: 本地化消息具有稳定回退和格式化规则
所有当前 Renderer 用户可见产品消息 SHALL 从受控消息目录解析，英文 `en` SHALL 是普通界面消息的最终回退语言。日期和其他 locale-sensitive 值 SHALL 使用当前 locale 格式化；稳定机器值、产品名、provider 名、用户提供的 Project、Board、Column、Work Item 名称与描述、标识符和快捷键 MUST NOT 被当作翻译键或任意翻译。界面 MUST NOT 因单个普通消息缺失而崩溃或显示空白。

#### Scenario: 简体中文普通消息缺失
- **WHEN** `zh-CN` 目录意外缺少一个非法律消息而 `en` 存在该键
- **THEN** Desktop 在该位置显示英文回退消息并保持界面可操作

#### Scenario: locale-sensitive 日期
- **WHEN** 用户在同一法律文档上切换 `zh-CN` 与 `en`
- **THEN** 相同生效日期分别按当前 locale 格式化，底层日期值不改变

#### Scenario: 用户与机器值
- **WHEN** 页面显示用户名称、用户提供的 Project/Board/Column/Work Item 内容、TaskPilot、GitHub 或稳定错误 code 对应的本地化说明
- **THEN** 用户输入和稳定值保持原样，只有产品说明文案按目录翻译

### Requirement: 双语布局保持当前可用性基线
`zh-CN` 与 `en` 的当前认证、协议、账号、Project 和 Board 界面 SHALL 在最小支持窗口及标准窗口内保持主要内容和操作可达；较长翻译 SHALL 换行或在定义的 Board 横向滚动区域内滚动，而不是被静默截断、相互覆盖或导致主操作不可访问。语言切换动画 SHALL 尊重 reduced-motion。

#### Scenario: 英文最长文案
- **WHEN** Desktop 在最小支持窗口显示英文首次注册、错误或协议入口
- **THEN** 标题、字段、协议链接、错误和主操作仍可阅读并可通过键盘到达

#### Scenario: Board 最小窗口长英文
- **WHEN** Desktop 在 `960×640` 显示英文 Board 导航、多个 Column、Card 操作、加载或错误状态
- **THEN** 当前 Board 标题、主要创建动作、Column 标题和键盘移动入口仍可阅读并可达，横向滚动不吞掉全局导航

#### Scenario: 简体中文与英文切换
- **WHEN** 用户在相同窗口尺寸反复切换两种语言
- **THEN** 页面不出现横向内容丢失、焦点跳出窗口或依赖动画才能理解的状态
