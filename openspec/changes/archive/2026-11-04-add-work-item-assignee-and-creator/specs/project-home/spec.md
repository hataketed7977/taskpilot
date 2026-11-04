# Project Home Spec Delta

## ADDED Requirements

### Requirement: Project 成员可作为责任人候选查询
Project OWNER SHALL 能在当前 Workspace 和 Project 范围内查询可被设为 Work Item 责任人的 Project Member 候选。候选列表 SHALL 只包含该 Project 的 membership，且对应 User 必须处于 active 可用状态；响应 SHALL 返回稳定 Project Membership 引用、User 摘要、项目角色和可用于选择器排序/显示的必要审计或显示字段。该能力只提供成员候选读取，不提供邀请、移除、角色编辑、Workspace 成员管理或 Project 外用户搜索。错误 Workspace、Project 或越权请求 SHALL 继续使用既有 not-found 或 authorization 语义。

#### Scenario: 查询当前 Project 成员候选
- **WHEN** Project OWNER 打开责任人选择器并查询当前 Project 成员
- **THEN** 系统返回当前 Project 的 active member 摘要，每个候选包含头像、姓名、角色和稳定 membership 标识

#### Scenario: 不返回其他 Project 成员
- **WHEN** 同一 Workspace 或其他 Workspace 中存在不属于当前 Project 的 User 或 Project Member
- **THEN** 当前 Project 的候选列表不包含这些人员，也不泄露其 membership 是否存在

#### Scenario: 当前仅有 Owner 角色
- **WHEN** 当前 Project 只有创建者的 OWNER membership
- **THEN** 候选列表仍以通用 Project Member 模型返回该 Owner，而不是把责任人选择写死为当前用户

#### Scenario: 成员候选接口不管理成员
- **WHEN** 客户端尝试通过候选查询能力邀请、移除或变更 Project Member 角色
- **THEN** 当前 API 不提供这些动作，Project Membership 保持不变
