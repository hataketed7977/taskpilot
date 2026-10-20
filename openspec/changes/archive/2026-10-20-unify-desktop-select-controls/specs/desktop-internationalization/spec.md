# Spec Delta

## MODIFIED Requirements

### Requirement: 当前 Desktop 体验可即时切换语言
Desktop SHALL 在未登录和已登录界面提供复用统一选择交互与 locale 选项来源、可通过键盘和辅助技术操作的语言选择。不同页面 MAY 使用适应所在布局的 trigger 变体，但选项、当前值、选择语义与焦点协议 MUST 保持一致。选择受支持语言后，当前窗口的可见产品文案、状态、错误、可访问名称、法律文档、Board、Column、Card、Work Item 操作和 locale-sensitive 格式 SHALL 在无需重启、重新登录或新建认证 attempt 的情况下切换；文档根元素的 `lang` SHALL 与当前 locale 一致。

#### Scenario: 登录页切换语言
- **WHEN** 用户在登录页从简体中文切换为 English
- **THEN** 登录页、品牌说明、GitHub 登录动作和辅助文本立即显示英文，当前认证 capability 不被重新请求

#### Scenario: 等待或失败状态切换语言
- **WHEN** 用户在 GitHub 等待、取消或错误状态切换语言
- **THEN** 当前流程状态保持不变，仅其可见文案和辅助技术公告切换语言

#### Scenario: 已登录页切换语言
- **WHEN** 用户在账号页切换语言
- **THEN** 账号状态与 `CurrentUserView`、当前 Workspace、Project、Board、Column 与 Work Item 数据保持不变，页面、Board 操作和退出操作立即使用所选语言且不重新加载业务数据

#### Scenario: Board 工作区切换语言
- **WHEN** 用户在 Board、Column 或 Work Item 加载、空状态、错误或移动结果中切换语言
- **THEN** 产品文案与辅助技术公告立即切换，用户输入的名称、描述和当前业务布局保持不变

#### Scenario: 键盘和辅助技术使用
- **WHEN** 用户仅使用键盘或辅助技术访问任一页面的语言选择
- **THEN** 控件具有可理解的当前值、统一选项名称和可见焦点，切换后焦点回到语言选择 trigger 且不丢失

#### Scenario: 页面间语言选择保持一致
- **WHEN** 用户先后在未登录与已登录界面访问语言选择
- **THEN** 两处使用相同的受支持 locale 集合、当前值和选择语义，不因布局变体产生不同语言选项或切换规则
