# Canonical Resource API Spec Delta

## MODIFIED Requirements

### Requirement: canonical path 以资源身份和关系组织
集合创建与列表 SHALL 位于拥有关系下，稳定 ID 可唯一定位的单资源读取与修改 SHALL 使用短资源路径；Core API MUST 从权威持久化归属重新校验 scope，不得因短路径省略父级而放宽授权。非 CRUD 生命周期转换 SHALL 使用 `:customMethod`，不得伪装成客户端专属 endpoint 或通用 status PATCH。

当前 canonical path 集合 SHALL 精确包含：

```text
GET  /v1/authentication-capabilities
POST /v1/federated-login-attempts
GET  /v1/provider-callbacks/github/oauth
POST /v1/federated-login-attempts/{attemptId}:poll
POST /v1/federated-login-attempts/{attemptId}:cancel
POST /v1/federated-registrations
POST /v1/session:refresh
POST /v1/session:logout
GET  /v1/me

GET  /v1/workspaces
GET  /v1/workspaces/{workspaceId}/projects
POST /v1/workspaces/{workspaceId}/projects
GET  /v1/projects/{projectId}
PATCH /v1/projects/{projectId}
POST /v1/projects/{projectId}:archive
POST /v1/projects/{projectId}:restore
POST /v1/projects/{projectId}:permanentlyDelete
GET  /v1/projects/{projectId}/members

GET  /v1/projects/{projectId}/boards
POST /v1/projects/{projectId}/boards
GET  /v1/boards/{boardId}
PATCH /v1/boards/{boardId}
POST /v1/boards/{boardId}:permanentlyDelete
POST /v1/boards/{boardId}/columns
PATCH /v1/columns/{columnId}
DELETE /v1/columns/{columnId}
PUT  /v1/boards/{boardId}/column-order
POST /v1/boards/{boardId}/work-items
GET  /v1/work-items/{workItemId}
PATCH /v1/work-items/{workItemId}
POST /v1/boards/{boardId}/placements/{workItemId}:move
```


#### Scenario: 列出或创建拥有资源
- **WHEN** User 列出或创建 Workspace 下的 Project，或 Project 下的 Board
- **THEN** operation 使用对应 owner collection path，并由 Core API 以真实 Membership 和归属授权

#### Scenario: 读取稳定 ID 资源
- **WHEN** User 通过 `/v1/projects/{projectId}`、`/v1/boards/{boardId}`、`/v1/columns/{columnId}` 或 `/v1/work-items/{workItemId}` 操作单资源
- **THEN** Core API 解析该资源真实 Workspace/Project/Board 归属并执行既有授权与 not-found 防泄漏语义

#### Scenario: 执行生命周期动作
- **WHEN** Project OWNER 归档 Project 或永久删除经确认的 Project/Board
- **THEN** operation 使用已声明的 custom method，并继续执行既有 expected version、精确名称、权限、事务和冲突规则

#### Scenario: 组合资源身份不一致
- **WHEN** move Placement 的 `boardId` 与 `workItemId` 不属于同一合法 Board/Project 组合
- **THEN** Core API 以既有 not-found 语义拒绝且不泄露资源真实归属

#### Scenario: 查询 Project Member 候选集合
- **WHEN** User 查询当前 Project 的可选责任人成员
- **THEN** operation 使用 `GET /v1/projects/{projectId}/members`，由 Core API 从 Project 持久化归属解析 Workspace scope、执行 OWNER 授权，并只返回该 Project 的 eligible members

## ADDED Requirements

### Requirement: canonical contract 描述人员摘要和责任人契约
Checked-in canonical OpenAPI SHALL 描述 `PersonSummary`、Project Member 列表、Work Item `createdBy`、Work Item/Card `assignee` 目标和责任人 mutation 契约。`assignee` SHALL 可为 `null`，当前唯一支持目标类型为 `PROJECT_MEMBER`，且请求中选择的 membership 必须属于目标 Work Item 所在 Project。OpenAPI SHALL 描述责任人相关成功响应、稳定 validation 错误、not-found/authorization 语义、Work Item version conflict、暂时错误和共享 Problem Details。文档和示例 MUST NOT 包含真实用户资料、真实头像 URL 中的秘密参数、access/refresh token 或未来 Agent 选择的未实现路径。

#### Scenario: OpenAPI 展示 Work Item 责任人字段
- **WHEN** 开发者查看 canonical OpenAPI 中的 Work Item detail、create/edit response 或 Card schema
- **THEN** schema 描述 `createdBy`、可为空 `assignee`、`PROJECT_MEMBER` 目标摘要和禁止 lifecycle/status 占位字段的当前契约

#### Scenario: OpenAPI 展示 Project Member 列表
- **WHEN** 开发者查看 `GET /v1/projects/{projectId}/members`
- **THEN** 文档说明该 API 要求 access bearer、使用 Project path scope，并返回可用于责任人选择的 Project Member 摘要

#### Scenario: OpenAPI 记录责任人错误
- **WHEN** 责任人 mutation 因非项目成员、未知 membership、inactive 用户、unsupported target type 或过期 Work Item version 失败
- **THEN** 文档描述对应 Problem Details `code`、HTTP 状态和客户端应重新读取权威 Work Item/Board 的路径

#### Scenario: 文档不暴露未来 Agent 假能力
- **WHEN** 当前 OpenAPI 描述责任人目标类型
- **THEN** 文档可以说明目标模型可扩展，但不得把 Agent picker、Project Agent Binding 选择或 Agent assignment endpoint 描述为当前已实现能力
