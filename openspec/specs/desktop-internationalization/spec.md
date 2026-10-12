# desktop-internationalization Specification

## Purpose
为 TaskPilot Desktop 提供可预测、可持久化且可访问的本地化体验，使用户能以简体中文或英文完成当前认证与账号流程，同时保证普通文案可安全回退、法律文档按实际阅读语言精确版本化。

## Requirements

### Requirement: Desktop 选择受支持语言并记住用户偏好
Desktop SHALL 支持规范 locale `zh-CN` 和 `en`。有效的设备本地用户选择 SHALL 优先于操作系统语言；没有有效选择时，Desktop SHALL 按操作系统语言优先级列表查找第一个受支持语言族，其中中文语言族映射为 `zh-CN`、英文语言族映射为 `en`，其他语言 SHALL 被跳过；列表中没有受支持语言族时 SHALL 默认使用 `en`。无效、损坏或已不受支持的持久化值 MUST NOT 阻止应用启动。

#### Scenario: 中文系统首次启动
- **WHEN** 设备没有已保存选择，且按优先级跳过不受支持语言后首先匹配中文语言族，例如 `['fr-FR', 'zh-CN']`
- **THEN** Desktop 以 `zh-CN` 显示当前界面

#### Scenario: 非中文系统首次启动
- **WHEN** 设备没有已保存选择，且首先匹配英文语言族，例如 `['en-US', 'zh-CN']`，或整个列表都没有受支持语言族，例如 `['fr-FR']`
- **THEN** Desktop 以 `en` 显示当前界面

#### Scenario: 用户选择覆盖系统语言
- **WHEN** 用户在中文系统上选择 English 后重启 Desktop
- **THEN** Desktop 继续使用 `en`，直到用户再次改变选择

#### Scenario: 本地偏好无效
- **WHEN** 已保存 locale 为空、损坏或不在受支持集合中
- **THEN** Desktop 忽略该值并按操作系统语言规则选择，不显示空白或阻断页

### Requirement: 当前 Desktop 体验可即时切换语言
Desktop SHALL 在未登录和已登录界面提供可通过键盘与辅助技术操作的语言选择。选择受支持语言后，当前窗口的可见产品文案、状态、错误、可访问名称、法律文档和 locale-sensitive 格式 SHALL 在无需重启、重新登录或新建认证 attempt 的情况下切换；文档根元素的 `lang` SHALL 与当前 locale 一致。

#### Scenario: 登录页切换语言
- **WHEN** 用户在登录页从简体中文切换为 English
- **THEN** 登录页、品牌说明、GitHub 登录动作和辅助文本立即显示英文，当前认证 capability 不被重新请求

#### Scenario: 等待或失败状态切换语言
- **WHEN** 用户在 GitHub 等待、取消或错误状态切换语言
- **THEN** 当前流程状态保持不变，仅其可见文案和辅助技术公告切换语言

#### Scenario: 已登录页切换语言
- **WHEN** 用户在账号页切换语言
- **THEN** 账号状态与 `CurrentUserView` 保持不变，页面和退出操作立即使用所选语言

#### Scenario: 键盘和辅助技术使用
- **WHEN** 用户仅使用键盘或辅助技术访问语言选择
- **THEN** 控件具有可理解的当前值、选项名称和可见焦点，切换后焦点不丢失

### Requirement: 本地化消息具有稳定回退和格式化规则
所有当前 Renderer 用户可见产品消息 SHALL 从受控消息目录解析，英文 `en` SHALL 是普通界面消息的最终回退语言。日期和其他 locale-sensitive 值 SHALL 使用当前 locale 格式化；稳定机器值、产品名、provider 名、用户提供的名称、标识符和快捷键 MUST NOT 被当作翻译键或任意翻译。界面 MUST NOT 因单个普通消息缺失而崩溃或显示空白。

#### Scenario: 简体中文普通消息缺失
- **WHEN** `zh-CN` 目录意外缺少一个非法律消息而 `en` 存在该键
- **THEN** Desktop 在该位置显示英文回退消息并保持界面可操作

#### Scenario: locale-sensitive 日期
- **WHEN** 用户在同一法律文档上切换 `zh-CN` 与 `en`
- **THEN** 相同生效日期分别按当前 locale 格式化，底层日期值不改变

#### Scenario: 用户与机器值
- **WHEN** 页面显示用户名称、TaskPilot、GitHub 或稳定错误 code 对应的本地化说明
- **THEN** 用户名称和稳定值保持原样，只有产品说明文案按目录翻译

### Requirement: 本地化资源保持本地且不扩大信任边界
Desktop SHALL 从随应用打包的静态资源加载消息和法律文档，MUST NOT 为切换语言执行远程脚本、下载远程翻译包、向 Renderer 暴露文件系统或通用 IPC，也 MUST NOT 将翻译内容作为未净化 HTML 注入。语言偏好 SHALL 只包含受支持 locale，不包含认证秘密或账号数据。

#### Scenario: 离线切换语言
- **WHEN** Core API、GitHub 或网络不可用
- **THEN** 用户仍可在已打包的 `zh-CN` 与 `en` 之间切换，且不产生网络请求

#### Scenario: 翻译资源包含特殊字符
- **WHEN** 消息或法律文档包含类似 HTML 的字符
- **THEN** Renderer 按文本内容渲染，不把它作为可执行标记或脚本

### Requirement: 双语布局保持当前可用性基线
`zh-CN` 与 `en` 的当前认证、协议和账号界面 SHALL 在最小支持窗口及标准窗口内保持主要内容和操作可达；较长翻译 SHALL 换行而不是被静默截断、相互覆盖或导致主操作不可访问。语言切换动画 SHALL 尊重 reduced-motion。

#### Scenario: 英文最长文案
- **WHEN** Desktop 在最小支持窗口显示英文首次注册、错误或协议入口
- **THEN** 标题、字段、协议链接、错误和主操作仍可阅读并可通过键盘到达

#### Scenario: 简体中文与英文切换
- **WHEN** 用户在相同窗口尺寸反复切换两种语言
- **THEN** 页面不出现横向内容丢失、焦点跳出窗口或依赖动画才能理解的状态
