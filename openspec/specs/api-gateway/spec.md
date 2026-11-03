# Api Gateway Specification

## Purpose

为 TaskPilot 建立唯一、可运行且可验证的外部 API 入口，在不复制业务 schema 或授权的前提下集中执行路由、传输安全、限制、关联和故障边界，并阻止客户端旁路 Core API。

## Requirements

### Requirement: Gateway 是 current user API 的唯一外部入口
Desktop 和所有外部浏览器 callback SHALL 只访问 Gateway；Gateway SHALL 以 path-preserving 方式把已批准的 canonical `/v1/**` 路由到 Core API。Core API 的应用端口 MUST 仅对受信内部网络或 loopback 可达，生产拓扑 MUST 在网络层拒绝公网旁路；Gateway 不可用时客户端 MUST fail closed，MUST NOT 降级为直连 Core API。

#### Scenario: Desktop 调用 canonical API
- **WHEN** Desktop Main 请求 Gateway 上已批准的 `/v1/**` operation
- **THEN** Gateway 保留 method、path、query 和受支持 body 转发到内部 Core API，并返回上游业务响应

#### Scenario: GitHub callback 到达
- **WHEN** GitHub 浏览器访问配置的 `/v1/provider-callbacks/github/oauth`
- **THEN** 请求先进入 Gateway，再由 Core API 验证 state/code 并生成安全完成页，不存在公开 Core API callback URL

#### Scenario: Gateway 不可用
- **WHEN** Desktop 无法连接 Gateway 或 Gateway 无法安全到达 Core API
- **THEN** 客户端收到可恢复的连接/暂时不可用结果，且不尝试 Core API direct origin

#### Scenario: 尝试公网旁路
- **WHEN** 外部调用方直接访问 Core API 应用端口
- **THEN** 部署/网络配置拒绝连接；Core API 自身仍独立执行认证与授权，不能依赖网络隔离作为唯一业务保护

### Requirement: Gateway 只允许 canonical contract 显式声明的 ingress surface
canonical OpenAPI 中每个 operation SHALL 使用受限枚举的 `x-taskpilot-ingress` 显式声明 ingress；允许值及语义固定为 `canonical`（第一方 canonical user API ingress）、`provider-callback`（外部 provider/browser callback ingress）和 `none`（存在于 Core contract 但不由当前 Gateway 暴露）。缺失、重复、无效值或重复 `operationId` MUST 使 contract build 失败。构建 SHALL 从该 artifact 生成只包含 `canonical` 与 `provider-callback` operation 的 method + path route manifest，并 MUST 排除 `none`；Gateway routing 与 transport admission MUST 消费同一 manifest。Gateway MUST NOT 手写或配置第二份 canonical method/path 列表，MUST NOT 使用 `/v1/**` catch-all，也 MUST NOT 在运行时读取 Core `/v3/api-docs` 来扩大 route。Gateway 到 Core API SHALL 保持相同业务 path，不维护第二套 canonical path rewrite。

#### Scenario: 可公开的 ingress operation
- **WHEN** canonical operation 的 `x-taskpilot-ingress` 为 `canonical` 或 `provider-callback`
- **THEN** 构建生成包含其 `operationId`、method、path 与 ingress class 的 route manifest，Gateway 按该 manifest 转发且不改变业务资源 path

#### Scenario: 显式不公开的 operation
- **WHEN** canonical operation 的 `x-taskpilot-ingress` 为 `none`
- **THEN** contract 本身保持有效，但生成的 Gateway route manifest MUST NOT 包含该 operation

#### Scenario: 未声明或无效 ingress
- **WHEN** operation 缺少 `x-taskpilot-ingress`、值不受支持或引用无法唯一识别的 operation
- **THEN** contract validation/generation 失败，Gateway 不会以默认公开或通配方式补偿

#### Scenario: 未知或退役 route
- **WHEN** 请求 `/desktop/v1/**`、未实现 `/v1/**`、错误 method 或 `x-taskpilot-ingress: none` 的 operation
- **THEN** Gateway 返回稳定 transport-level not-found/method rejection，且不把请求发送给 Core API

#### Scenario: Core runtime 文档变化
- **WHEN** Core `/v3/api-docs` 在运行时不可用、被篡改或包含额外 route
- **THEN** Gateway route 集合不改变；只有重新校验和构建 canonical contract 才能改变公开 ingress

#### Scenario: 管理端点暴露
- **WHEN** 外部请求 Gateway health/readiness 之外的 management endpoint
- **THEN** Gateway 拒绝访问且不泄露 route、配置、内部地址或 secret

### Requirement: Gateway 清理不受信 metadata 并传播关联信息
Gateway SHALL 在转发前移除所有客户端提供的 principal、User、Workspace、Project、role、tenant、内部 origin、forwarded identity 与 correlation header，再生成或验证受限格式的 correlation ID；Gateway MAY 传播安全的 transport metadata，但 MUST NOT 将其解释为业务授权。Core API MUST 独立从 credential 与持久化事实确定 actor 和 scope。

#### Scenario: 伪造内部身份 header
- **WHEN** 客户端提交伪造的 User、Workspace、Project、role、tenant 或 internal-forwarding header
- **THEN** Gateway 移除该值，且 Core API 不以该值授权

#### Scenario: 客户端 correlation ID 合法
- **WHEN** 请求携带符合长度与字符约束的 correlation ID
- **THEN** Gateway 可保留该 ID 并在响应和上游调用中关联同一请求

#### Scenario: correlation ID 缺失或非法
- **WHEN** correlation ID 缺失、重复、超长或格式非法
- **THEN** Gateway 生成新的安全 ID，不回显非法值

### Requirement: Gateway 执行有界传输策略
Gateway SHALL 对已批准 route 执行可配置且有测试保护的 request-size、header-size、连接/响应 timeout 与 response-size 边界；限制必须覆盖缺失或不可信 `Content-Length` 的流式请求。Gateway MUST NOT 默认重试非幂等 method，也 MUST NOT 因 timeout、上游连接失败或 malformed upstream response 泄露内部地址、stack trace 或 secret。

#### Scenario: oversized streaming request
- **WHEN** chunked 或未知长度请求超过 route 的最大 body 大小
- **THEN** Gateway 在完整转发前以稳定 `413` 拒绝，Core API 不接收超限 body

#### Scenario: 上游超时
- **WHEN** Core API 在 route timeout 内未返回
- **THEN** Gateway 终止等待并返回稳定暂时失败，不泄露内部地址或自动重发 mutation

#### Scenario: mutation 响应丢失
- **WHEN** Gateway 已向 Core API 发送 POST/PATCH/PUT/DELETE 但未获得权威响应
- **THEN** Gateway 不自动重试；客户端继续依赖现有幂等或调和规则处理结果未知

### Requirement: Gateway 错误保持 transport 与业务边界
Gateway 自己拒绝的未知 route、超限、timeout、上游不可达和 malformed request SHALL 使用稳定、无内部细节的 transport error，并携带 correlation ID。已到达 Core API 的业务响应和共享 Problem Details SHALL 透传，Gateway MUST NOT 把 authentication、authorization、validation、conflict 或 not-found 业务结果重新分类或包装成成功。

#### Scenario: Core API 返回业务冲突
- **WHEN** Core API 返回带稳定 code 的 `409` Problem Details
- **THEN** Gateway 保留 status、media type、允许 header 与 body 语义返回调用方

#### Scenario: Gateway 本地拒绝
- **WHEN** 请求在 route、header、size 或 timeout policy 阶段被 Gateway 拒绝
- **THEN** 响应明确属于 transport policy、包含 correlation ID 且不包含 upstream stack trace、host 或 credential

### Requirement: Gateway 可独立构建、验证和运行
仓库 SHALL 提供受版本控制的 Gateway 子工程、配置绑定、健康/readiness、单一 `qualityCheck` 和本地启动入口。Gateway 启动 MUST NOT 依赖业务数据库或复制 Core API migration；其 route/filter/security 行为 SHALL 可通过 stub upstream 验证，真实跨服务 smoke SHALL 验证 packaged Gateway 能到达 Core API。

#### Scenario: 执行 Gateway 质量门
- **WHEN** 开发者运行 `./gradlew --no-daemon :services:gateway:qualityCheck`
- **THEN** 编译、格式、静态分析、测试、覆盖率和构建产物边界均被验证，并产生可定位失败

#### Scenario: Gateway 独立启动
- **WHEN** 使用有效 Core API internal origin 启动 Gateway 而业务数据库尚未直接提供给 Gateway
- **THEN** Gateway 可启动并报告自身 health/readiness，且不创建或访问 TaskPilot 业务表

#### Scenario: 路由集成验证
- **WHEN** Gateway 以 stub upstream 运行 route integration tests
- **THEN** allowlist、path preservation、header hygiene、size、timeout、error 和 non-retry 行为可重复验证
