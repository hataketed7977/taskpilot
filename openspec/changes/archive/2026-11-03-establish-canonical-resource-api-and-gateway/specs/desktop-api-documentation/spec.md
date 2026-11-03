# Spec Delta

## REMOVED Requirements

### Requirement: 当前 Desktop API 具有准确的运行时文档
**Reason**: 客户端专属 Desktop API 被统一 canonical user resource API 取代，运行时文档由 `canonical-resource-api` capability 按资源而非客户端拥有。

**Migration**: 当前无外部兼容负担；所有 `/desktop/v1/**` 一次性迁移到 `/v1/**`，不保留双路由。

### Requirement: 联合登录契约区分浏览器与 Desktop Main 的秘密
**Reason**: 该合同仍然有效，但不再属于 Desktop 专属 API 文档 capability；完整要求迁移至 `canonical-resource-api` 与 `desktop-authentication`。

**Migration**: 保留秘密、认证和 schema 语义，只替换 path 与 capability owner。

### Requirement: Session 与 current-user 契约准确声明认证方式
**Reason**: Session/current-user 是 canonical user resource API 的共享契约，不是 Desktop 专属契约。

**Migration**: 迁移到 `/v1/session:refresh`、`/v1/session:logout`、`/v1/me`，保留 opaque credential 和 security 语义。

### Requirement: 文档使用共享 Problem Details
**Reason**: 共享错误契约由 `canonical-resource-api` 统一拥有，避免为不同客户端维护多份文档规则。

**Migration**: 所有 canonical operation 继续使用当前 `TaskPilotProblemDetails` 与稳定错误 code。

### Requirement: API 文档按环境安全暴露
**Reason**: canonical OpenAPI 的环境暴露策略由 `canonical-resource-api` 接管。

**Migration**: Local/Test 与 Production 的现有安全策略保持不变。

### Requirement: 文档和 Swagger 不持久化秘密
**Reason**: canonical OpenAPI 的 secret hygiene 由 `canonical-resource-api` 接管。

**Migration**: 现有 no-secret 约束原样保留在新 capability。

### Requirement: 当前阶段只维护运行时契约
**Reason**: runtime-contract-only 会让 Controller/OpenAPI mapping、contract test 与 Gateway route catalog 形成多份事实来源，不满足 canonical API 的长期契约治理要求。

**Migration**: 由 `contracts/canonical-api/openapi.yaml` 接管唯一 canonical HTTP contract；Core HTTP adapter 与 Gateway route manifest 在构建期生成，Local/Test 文档展示该 artifact 的确定性等价表示。当前不建立 external public API 的弃用窗口或 compatibility baseline。

### Requirement: Workspace 与 Project 契约准确声明范围和并发控制
**Reason**: Workspace/Project HTTP contract 迁移到统一 resource paths，并由 `canonical-resource-api` 记录；业务规则仍由原 capability specs 拥有。

**Migration**: 保留 schema、授权、幂等、版本、删除与 success status，只迁移 URI。

### Requirement: Project Work API 准确声明范围、幂等与并发控制
**Reason**: Board/Column/Work Item/Placement contract 迁移到统一 resource paths，不再以 Desktop 客户端命名。

**Migration**: 保留 schema、授权、幂等、并发和错误语义，只迁移 URI 与文档 owner。
