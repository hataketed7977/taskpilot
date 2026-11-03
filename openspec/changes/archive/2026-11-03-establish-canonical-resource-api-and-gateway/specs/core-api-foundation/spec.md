# Spec Delta

## MODIFIED Requirements

### Requirement: 技术架构规则受到独立保护
Core API SHALL 使用独立于模块图验证的架构规则分析编译后的生产代码，防止业务模型依赖 Web、Spring Security、持久化或 provider SDK 类型，防止持久化与 provider 类型跨能力或 HTTP 边界泄漏，并保持 canonical user resource API、managed-execution、provider-callback 与 future public/MCP adapter 的信任边界相互隔离。第一方 Desktop、Web、Mobile 与 CLI MUST NOT 形成平行的业务 API package 或 application use case；不同协议 adapter MUST 复用既有 application use case。构建生成的 canonical HTTP interfaces 与 wire models MUST 限定在 API adapter 边界，业务模型、application use case、持久化和授权实现 MUST NOT 依赖生成的 transport types。架构测试 SHALL 证明生产代码扫描范围非空并执行全部已批准规则，MUST NOT 依赖人工允许/禁止 fixture、伪造的框架类型或独立 fixture source set 作为通过证据。

#### Scenario: 合法依赖示例
- **WHEN** 架构测试导入 Core API 编译后的生产代码
- **THEN** 它 SHALL 发现 Core API 架构根及生产类型，并 SHALL 对同一生产类集合执行全部已批准技术架构规则

#### Scenario: 禁止依赖示例
- **WHEN** Core API 生产代码引入被已批准技术架构规则禁止的依赖、平行客户端业务 surface 或包结构
- **THEN** 对应架构规则 SHALL 失败并指出违规规则以及可定位的来源和目标

#### Scenario: protocol adapter 复用业务能力
- **WHEN** Core API 以后增加 public、managed-execution、provider-callback 或 MCP adapter
- **THEN** 架构规则 SHALL 允许独立 credential/transport adapter，但拒绝其复制 canonical application use case、业务实体或持久化 truth

#### Scenario: 生成 HTTP adapter 边界
- **WHEN** canonical OpenAPI 生成 Spring interfaces、wire models 或 validation metadata
- **THEN** 生成类型只被 Core API 的 HTTP adapter 实现和 transport mapping 使用，domain/application/persistence 不依赖该类型
