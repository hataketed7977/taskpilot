# Spec Delta

## MODIFIED Requirements

### Requirement: Work Item 是 Project 内的业务真相
每个 Work Item SHALL 具有稳定 `workItemId`、唯一 `projectId` 引用、必填标题、可选描述、版本、创建者和审计时间。当前实现尚未实现业务模型已批准的 Target Work Item 状态机；当前 Work Item 与 Card 的持久化模型和 API response MUST NOT 包含固定 `OPEN`、`lifecycle`、`status` 或等价占位字段，也 MUST NOT 暴露完成、关闭、取消或重开动作。在 Work Item Type 与自定义字段尚未实现时不要求类型版本；未来使用类型化字段的 Work Item SHALL 通过后续 Change 固定不可变 Work Item Type Version。标题 SHALL 去除首尾空白并规范化为 Unicode NFC，规范化结果 MUST 为 1 至 300 个 Unicode code point；描述 SHALL 去除首尾空白、规范化为 Unicode NFC 并限制为最多 10000 个 Unicode code point。

#### Scenario: 读取 Work Item
- **WHEN** Project OWNER 通过 canonical user resource API 读取当前 Project 的 Work Item
- **THEN** 响应以 `workItemId` 标识权威记录，并返回标题、描述、版本和审计时间，且不返回 lifecycle 或 status

#### Scenario: 同名 Work Item
- **WHEN** Owner 在同一 Project 创建标题相同的两个 Work Item
- **THEN** 系统以不同 `workItemId` 保存两条记录，不以标题作为身份或唯一键

#### Scenario: 未支持的生命周期动作
- **WHEN** 客户端尝试通过当前 canonical user resource API 完成、关闭、取消或重开 Work Item
- **THEN** 当前 API 不提供该动作，也不通过 Card 移动隐式创建或改变状态

#### Scenario: 当前实现没有状态能力
- **WHEN** 客户端读取 Work Item、Card 或检查当前持久化和 API 契约
- **THEN** 当前持久化模型、API 与 Desktop 不提供 lifecycle、status、固定 `OPEN` 或等价状态字段

#### Scenario: 当前不要求 Work Item Type
- **WHEN** Owner 在当前切片创建基础 Work Item
- **THEN** 系统只要求当前规格的稳定字段，不伪造 Work Item Type Version 或暴露自定义字段入口

### Requirement: 当前切片不提供 Work Item 独立删除
当前 canonical user resource API 和 UI MUST NOT 提供单独永久删除 Work Item 的动作。经 Project Danger Zone 显式确认的 Project 永久删除 MAY 按 Project 拥有关系删除其 Work Item；除此之外，未知或受保护依赖 SHALL 继续阻止无语义的数据删除。

#### Scenario: 查找独立删除动作
- **WHEN** 用户打开 Work Item 详情、Card 菜单或调用当前 canonical user resource API
- **THEN** 系统不提供 Work Item 独立永久删除入口或 endpoint

#### Scenario: 永久删除所属 Project
- **WHEN** Project OWNER 按 Project 删除规格永久删除拥有该 Work Item 的 Project
- **THEN** Work Item 可作为已批准的 Project 子资源在同一事务被删除
