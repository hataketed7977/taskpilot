# Proposal

## Why

客户端中立的 canonical API 和强制 Gateway 入口已经建立，但当前 HTTP 契约仍由 Controller 注解、Core 手工 OpenAPI 映射、契约测试期望表和 Gateway `RouteCatalog` 重复声明。继续沿用这种结构会使新增 operation 必须人工同步多处，并让“测试发现漂移”代替“从结构上消除漂移”；本 Change 必须同时建立可长期演进的单一契约事实来源。

## What Changes

- **BREAKING**：一次性移除 `/desktop/v1/**`，不保留双路由、重定向或兼容窗口；当前 HTTP 契约改为 `/v1/**` 下按资源和动作建模的 canonical user resource API。
- 新增可运行的 Kotlin/Spring Gateway，并将 Desktop、GitHub OAuth callback 与本地开发/system journey 的外部 HTTP 入口迁移到 Gateway；Core API 仅作为内部上游和最终业务授权者。
- Gateway 保持 path-preserving，负责显式路由准入、伪造转发头清理、correlation ID、请求大小、超时、稳定传输错误与安全管理端点；它不拥有业务授权、业务编排或业务数据库。
- 在 `contracts/canonical-api` 建立 checked-in、版本控制的 canonical OpenAPI，使 method/path、稳定 `operationId`、HTTP wire schema、认证、响应和 Problem Details 只有一个权威来源。
- 每个 OpenAPI operation 通过显式 `x-taskpilot-ingress` 声明 Gateway ingress；构建期从同一 OpenAPI 生成 fail-closed Gateway route manifest，删除手写 method/path catalog，不增加 `/v1/**` catch-all，也不在运行时从 Core 发现路由。
- 从 canonical OpenAPI 构建期生成 Core Spring HTTP interfaces 与 wire models；手写 Core adapter 实现生成接口并映射既有 application use case/domain model，生成边界不进入业务层、持久化层或授权规则。
- Local/Test OpenAPI 与 Swagger 展示 canonical artifact 的确定性表示；Production 继续默认关闭，Gateway/public origin 继续不暴露文档。
- Desktop、未来 Web/Mobile/CLI 共用同一 canonical user resource API，不按客户端复制 Controller、DTO 或 application use case。未来 public developer API 默认复用相同资源语义与 use case，通过 credential/scope、allowlist、配额和发布文档形成产品边界。
- MCP/AI tool 作为未来协议 adapter 复用同一 application use case；本 Change 只固定复用边界，不实现 MCP server、tools 或新的 MCP 专用业务 API。
- 以新的 `canonical-resource-api` capability 取代 `desktop-api-documentation` 的客户端命名和契约，并更新 Core API 架构规则、构建与仓库提交质量门。
- 同步根架构、Gateway/Core API/Desktop 子项目文档、README 与本地开发工具；每个实现切片同时更新其 owner 文档，不把文档债务推迟到最后。

## Business Model Impact

本 Change 不改变 `User`、`Workspace`、`Project`、`Board`、`Column`、`Work Item`、`Board Placement`、Membership 或 Federated Login Attempt 的稳定身份、归属、关系、基数、生命周期、版本、幂等与业务不变量；这些规则继续由 `docs/business-model.md` 及现有 capability specs 定义。资源路径中的父级缩短也不改变真实归属：Core API MUST 从持久化事实解析资源并重新执行 Workspace/Project 授权，不得把 URL、Gateway header、OpenAPI metadata 或客户端身份当作授权证据。

本次采用关系映射、契约所有权决策树与信任边界 threat modeling：参与者为第一方用户客户端、GitHub 浏览器 callback、Gateway 与 Core API；安全重点是阻止 Core API 公网旁路、未知 operation 意外公开、跨 surface credential 混用、伪造内部 header、超大请求、无界等待和错误重试。Gateway failure 不得降级为 Desktop 直连 Core API，非幂等请求不得由 Gateway 自动重试；correlation metadata 与生成的 route metadata 都不能授予业务权限。业务数据、并发与恢复语义不变，变化仅涉及传输入口、URI contract 及该 contract 的工程所有权。

## Capabilities

### New Capabilities

- `canonical-resource-api`: 定义按资源建模、供第一方客户端共同复用的 `/v1` HTTP 契约、checked-in canonical OpenAPI、生成边界、错误与 adapter 复用边界。
- `api-gateway`: 定义唯一外部 API 入口、由 canonical contract 构建生成的显式 route manifest、path-preserving 路由、技术策略、旁路防护、健康检查和 fail-closed 行为。

### Modified Capabilities

- `desktop-api-documentation`: 移除全部客户端专属 API 文档要求，由 `canonical-resource-api` 接管，不保留并行 Desktop API 或 runtime-contract-only 决策。
- `desktop-authentication`: 将 current-user 契约迁移到 canonical `/v1/me`，并要求 Desktop 通过 Gateway 完成认证链路。
- `workspace-access`: 将“当前 Desktop API”约束改为统一 canonical user resource API，保持业务授权不变。
- `project-work-items`: 将尚未支持的 lifecycle/delete surface 从 Desktop 专属表述改为 canonical user resource API 表述。
- `core-api-foundation`: 将按 Desktop/public/managed-execution 的客户端式 API 隔离规则改为 canonical user resource API、生成的 HTTP adapter contract 与不同信任边界 adapter 的隔离规则。
- `repository-commit-quality-gates`: 新增 Gateway、canonical contract 路径分类和对应 Gradle quality gate 选择规则。

## Impact

- **Canonical contract：** 新增 `contracts/canonical-api` Gradle 子工程、`openapi.yaml`、OpenAPI validation/generation 配置、Core adapter sources、Gateway route manifest 及确定性/完整性测试；生成产物只存在于 Gradle build 输出，不提交到 Git。
- **Core API：** 所有现有 Controller paths、HTTP adapter interfaces/wire models、OpenAPI custom mapping、contract tests、HTTP security matchers、transport tests和架构规则；业务 use case、domain model、数据库 schema 与 migrations 不变。
- **Gateway：** `services/gateway` Gradle 子工程、route catalog/manifest loading、routing/filter/security/error handling、测试与 `qualityCheck`。
- **Desktop：** Main transport origin、path allowlist、auth/project/board/work-item clients、fixtures、architecture tests 与 system journey；Renderer UI 和 IPC 公共行为不变。
- **开发工具：** `settings.gradle.kts`、version catalog、root pnpm dev/bootstrap/doctor/smoke/status/logs/check、checkout-isolated ports/state，以及 GitHub OAuth callback 配置。
- **依赖：** 固定版本的 OpenAPI Generator Gradle plugin 与标准 OpenAPI parser/validator；不得使用动态版本或自研 OpenAPI 解析框架。
- **质量与契约：** contract validation/generation/determinism、Core generated-interface binding、Local/Test served-doc equality、Gateway manifest completeness/fail-closed、Core/Gateway/Desktop focused/affected suites、跨服务 system journey，以及 Git staged-path gate。
- **兼容性：** 当前迁移明确是 breaking switch；canonical artifact 可版本控制，但 external public API 的发布版本、弃用窗口和兼容承诺不由本 Change 定义。
- **明确非目标：** 不生成 Desktop/Web/Mobile/CLI client，不生成 domain/application/persistence 代码，不迁移认证/session 所有权，不改 opaque session，不实现 Public Developer API、MCP、managed-execution 或新 provider integration，不增加 BFF response composition，不改业务模型/数据库，不把最终业务授权移到 Gateway，不建设完整生产部署平台。

## Documentation Impact

- `docs/architecture.md`：记录 Client → Gateway → Core API 当前拓扑，以及 `contracts/canonical-api` 对 HTTP contract、Core adapter generation 和 Gateway route generation 的所有权；明确运行时 OpenAPI discovery 不是路由来源。
- `services/gateway/docs/{architecture,responsibilities,testing-strategy}.md` 与 `services/gateway/AGENTS.md`：将手写 catalog 规则改为生成 manifest 规则，保留 fail-closed、无 catch-all 和独立质量门。
- `services/core-api/docs/{architecture,responsibilities,testing-strategy}.md` 与 `services/core-api/AGENTS.md`：记录 contract-first HTTP adapter、wire/domain mapping、运行时文档来源及生成代码不得侵入 application/domain/persistence 的边界。
- `apps/desktop/docs/{architecture,responsibilities,testing-strategy}.md`：将 Main 上游改为 Gateway，更新 transport、环境变量、system journey 和失败时禁止直连降级。
- `contracts/canonical-api/AGENTS.md` 与 `contracts/canonical-api/docs/{architecture,testing-strategy}.md`：随子项目创建，拥有该模块的 artifact、生成、校验、发布边界和本地验证命令；不复制根架构中的跨项目 contract ownership。
- `docs/README.md`：随 contract 子项目文档创建同步导航，并在后续 ownership/status 对账中保持入口准确。
- `README.md` 与本地开发说明：更新启动拓扑、端口、环境变量、callback、contract build 和诊断入口。
- `docs/business-model.md`：预期无产品词汇、关系、生命周期或不变量变化；实现后以 model-drift audit 复核，若证据仍一致则记录“不需要修改”的理由。
- OpenSpec 主 specs：归档时新增 `canonical-resource-api`、`api-gateway`，同步列出的 modified capabilities；`desktop-api-documentation` 的 requirements 全部退役，后续 inventory 不再把它作为有效 API capability。
