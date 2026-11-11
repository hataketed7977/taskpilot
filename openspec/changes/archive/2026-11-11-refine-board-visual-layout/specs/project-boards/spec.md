# Spec Delta

## ADDED Requirements

### Requirement: Desktop 看板使用紧凑且连续的工作区布局

Desktop SHALL 在既有 Project 导航旁呈现连续浅色看板工作区，以紧凑 Project 上下文、Board 切换／操作工具栏和 Column 画布建立稳定层级。Project 名称、当前 Board 选择和既有主要操作 SHALL 清晰可辨；Column SHALL 使用低对比浅色分组表面，列名、数量与操作 SHALL 对齐，Card SHALL 成为主要内容边界。各 Column MUST NOT 按名称、顺序或看似 Todo／Done 的文字自动赋予业务状态颜色。工具栏与画布 SHALL 使用一致的水平对齐；紧凑布局 MUST NOT 通过缩小正文至难以阅读、缩小可操作目标或遮挡焦点实现。现有 Project 导航结构与 Board／Column／Work Item 操作语义 SHALL 保持不变，MUST NOT 添加未实现的筛选、视图、优先级或执行入口。

#### Scenario: 查看普通多列看板
- **WHEN** 用户打开含多列与真实工作项的 Board
- **THEN** Project 上下文与 Board 工具栏保持紧凑，Column 呈现浅色分组，Card 标题、摘要和责任信息按一致层级排列，且画布不被大标题区或重复容器边界主导

#### Scenario: 在最小窗口浏览多列
- **WHEN** 用户在 `960×640` 窗口打开包含五个 Column 的 Board
- **THEN** Column 画布可横向滚动，各列内容可纵向浏览，Project 上下文、Board 操作与列内创建入口仍可到达；页面本身不产生失控横向溢出，也不把所有列压缩成不可读窄列

#### Scenario: 长名称和中英文内容
- **WHEN** Project／Board／Column 名称较长或用户切换中文与英文界面
- **THEN** 名称完整值仍可通过可访问名称或 tooltip 获取，标题与工具栏允许必要的安全换行或局部滚动，操作不重叠且 Card 的正文保持可读

#### Scenario: 空列和权威状态反馈
- **WHEN** Board 含空 Column、正在加载，或发生现有读取／mutation 错误
- **THEN** 空列继续提供既有创建入口，加载和错误出现在既有状态边界内；UI 不将错误显示为空数据，不隐藏恢复入口，也不因布局调整显示伪造任务或统计

#### Scenario: 键盘访问和焦点
- **WHEN** 用户仅使用键盘切换 Board、打开 Card 或到达 Column 操作
- **THEN** 当前选择、可理解名称、可见焦点和既有焦点恢复继续有效，水平或垂直滚动不会永久裁切焦点和操作

### Requirement: 不同 Card 高度下拖拽反馈匹配实际布局

Desktop SHALL 在 Card 因标题行数具有不同高度时，使用被拖起 Card 的实际尺寸呈现预览与唯一插入占位槽，以目标 Card 的实际可见边界解析精确插入位置。目标 Column 和占位槽 SHALL 保持可感知且不只依赖颜色。提交 SHALL 继续使用既有当前 Board／Placement 版本、目标 Column 与 `beforeWorkItemId` 语义；成功采用权威 Board，失败恢复权威位置与恢复入口，取消不提交 mutation。拖拽结束、取消或看板卸载 SHALL 清理预览、占位与临时几何状态。reduced-motion SHALL 移除非必要位移动画并保留插入位置和成功／失败状态反馈。

#### Scenario: 不同高度卡片之间插入
- **WHEN** 用户把两行标题 Card 拖到一行标题 Card 的上半区或下半区
- **THEN** 预览和占位槽高度匹配拖起 Card，落点按目标实际边界解析到该 Card 前或下一 Card 前，且不以旧固定高度推算目标

#### Scenario: 跨列移动到末尾或空列
- **WHEN** 用户拖动 Card 越过目标列最后一张 Card 或进入空列
- **THEN** 唯一占位槽显示在目标列末尾，提交省略 `beforeWorkItemId`，成功后位置与权威响应一致

#### Scenario: 拖拽失败或取消
- **WHEN** 拖拽被取消，或提交发生暂时失败／版本冲突
- **THEN** 取消不提交请求；失败保留既有错误公告和重新加载路径，Card 不残留在未确认位置，临时槽和拖拽预览清理

#### Scenario: reduced-motion 拖拽
- **WHEN** 用户启用 reduced-motion 并拖动不同高度 Card
- **THEN** UI 保留预览、实际高度占位和结构性目标提示，移除非必要让位与落位动画，且提交位置语义不变
