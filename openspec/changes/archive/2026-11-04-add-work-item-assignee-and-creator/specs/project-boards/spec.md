# Project Boards Spec Delta

## ADDED Requirements

### Requirement: Card 投影包含 Work Item 当前责任人
每个 Board 读取 SHALL 以 Work Item 权威内容、Work Item 当前责任人和该 Board Placement 组合 Card。Card SHALL 复用 `workItemId`，MUST NOT 独立拥有或复制责任人；同一 Work Item 在多个 Board 中出现时，所有 Card SHALL 展示同一个 Work Item 当前责任人，同时保留各自 Column、顺序和 Placement version。Card move SHALL 只改变当前 Board Placement，不得创建、清空或修改 Work Item 责任人。

#### Scenario: Board 读取显示责任人头像所需数据
- **WHEN** Project OWNER 读取包含已分配 Work Item 的 Board
- **THEN** Card response 包含该 Work Item 当前责任人摘要和 Placement 信息，使 Desktop 可在 Card 正面展示责任人头像

#### Scenario: 同一 Work Item 在多个 Board 的责任人一致
- **WHEN** 同一 Work Item 分别在两个 Board 中具有 Placement 且责任人被修改
- **THEN** 两个 Board 下次读取对应 Card 时均显示同一最新责任人，但各自 Column、顺序和 Placement version 不受责任人修改影响

#### Scenario: 移动 Card 不改变责任人
- **WHEN** Owner 把 Card 拖拽或键盘移动到另一个 Column
- **THEN** 系统只更新当前 Board Placement，Work Item 责任人、创建人、标题和描述保持不变

#### Scenario: 责任人修改不改变 Board 布局
- **WHEN** Owner 修改 Work Item 责任人且不提交 Placement 变化
- **THEN** 系统不改变 Board、Column、Placement 顺序或 Placement version，并在权威 Card 投影中返回新的责任人
