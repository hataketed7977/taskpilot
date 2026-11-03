# Spec Delta

## MODIFIED Requirements

### Requirement: Workspace 使用统一类型模型并限制个人空间生命周期
Workspace SHALL 具有稳定 `workspaceId` 和 `PERSONAL | TEAM` 类型。当前能力 SHALL 只创建和返回 `PERSONAL` Workspace；每个 User MUST 恰有一个个人 Workspace。用户 MUST NOT 创建、删除、转移个人 Workspace，也不能向其中邀请或添加成员。`TEAM` 只作为模型保留值，当前 canonical user resource API 和 Desktop MUST NOT 暴露团队空间创建、邀请或管理入口。

#### Scenario: 读取个人 Workspace
- **WHEN** 已认证 User 通过 `GET /v1/workspaces` 读取其可访问 Workspace
- **THEN** 系统返回其唯一 PERSONAL Workspace 及 OWNER 关系，不依赖外部 provider identity 或设备语言确定 Workspace 身份

#### Scenario: 尝试创建或管理个人 Workspace
- **WHEN** 客户端尝试创建第二个个人 Workspace、删除或转移个人 Workspace、或添加个人空间成员
- **THEN** 当前 canonical user resource API 不提供该操作，Core API 也不通过其他当前路径接受该状态变更

#### Scenario: TEAM 尚未实现
- **WHEN** 客户端构造 TEAM Workspace 的创建或成员管理请求
- **THEN** 系统拒绝或不存在该操作，且 Desktop 不显示不可用的团队空间占位入口
