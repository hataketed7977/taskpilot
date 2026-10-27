# Desktop API Documentation Spec Delta

## MODIFIED Requirements

### Requirement: Project Work API 准确声明范围、幂等与并发控制
Board、Column、Work Item 和 Placement 操作 SHALL 要求 access bearer，并在路径中显式携带 `workspaceId` 与 `projectId`；Board 范围操作 SHALL 进一步携带 `boardId`。Core API SHALL 以 not-found 语义拒绝跨 Workspace、Project 或 Board 的组合 ID。Board 与 Work Item 创建 SHALL 文档化 request id 幂等契约；所有可变资源和 Board 布局写入 SHALL 文档化 expected version、稳定冲突和权威重载路径。Work Item 与 Card response schema SHALL 包含各自当前权威内容、版本和位置所需字段，并 MUST NOT 包含尚未在当前实现形成能力的 `lifecycle`、`status` 或固定 `OPEN` 占位字段。所有操作 SHALL 使用共享 Problem Details，并记录适用的 `400/401/404/409/503` 响应。

#### Scenario: 检查 Board 与 Column 契约
- **WHEN** 自动化读取 Board list/create/detail/edit、Board permanent-deletion 与 Column create/edit/reorder/delete 操作
- **THEN** 文档声明 Project OWNER 授权、Board 创建 `201`、Board 列表按 `createdAt` 与 `boardId` 确定性排序、普通读取和修改 `200`、空 Board permanent-deletion `204`、Column 删除 `204` 且客户端随后重读布局、初始 Column 原子创建、最后或非空 Column 删除冲突以及 Board 布局版本

#### Scenario: 检查 Work Item 与 Placement 契约
- **WHEN** 自动化读取 Board 内 Work Item create、Work Item detail/edit 和 Placement move 操作
- **THEN** 文档声明创建 `201`、普通读取和修改 `200`、Card 复用 `workItemId`、创建请求携带 expected Board version、Work Item 与 Placement 原子提交并递增 Board version、过期创建不留下记录、移动返回 `200` 权威 Board 布局，且 Work Item 与 Card schema 不含 lifecycle 或 status

#### Scenario: 检查 Project Work 创建幂等
- **WHEN** 自动化读取 Board、Column 或 Board 内 Work Item 创建请求
- **THEN** schema 包含 UUID request id，文档声明 actor 与所属 Project 范围、规范化 payload 重试和不同 payload 复用的幂等冲突；Work Item 创建 payload 还包含 expected Board version，同键同载荷成功重试返回原结果

#### Scenario: 检查跨范围组合 ID
- **WHEN** 自动化构造其他 Workspace、Project 或 Board 的 Board、Column、Work Item 或 Placement ID 组合
- **THEN** 契约记录 not-found 与共享 Problem Details，不泄露资源真实归属
