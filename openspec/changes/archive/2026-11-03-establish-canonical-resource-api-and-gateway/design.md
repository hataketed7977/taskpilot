# Design

## Context

本 Change 的 URI、Gateway、Desktop transport 与本地生命周期切换已经在当前工作树实现，但仍未 sync/archive。实现暴露出一个必须在归档前纠正的架构问题：canonical method/path 在 Core Controller annotations 与 Gateway `RouteCatalog` 各声明一次，认证、响应和描述在 Core `OpenApiConfiguration` 再声明一次，Core contract test 又维护完整期望表。双向测试能报告漂移，却不能避免每次新增 operation 人工同步多处。

当前约束：

- Core API 继续拥有 opaque session、业务 schema 语义、application use case、持久化和最终授权；路径缩短与代码生成不能改变资源真实归属或防泄漏语义。
- Gateway 是 Desktop 与 GitHub provider callback 的强制入口，但不能成为 BFF、第二份业务 API 或运行时 contract discovery 服务。
- Gateway 使用 reactive runtime，Core API 使用 MVC runtime；二者保持独立进程和 classpath，Gateway 不得因共享 contract 引入 MVC、数据库或 Core production dependency。
- `/desktop/v1/**` 采用一次性 breaking switch，不保留兼容别名、重定向或运行时回退。
- 仓库没有生产部署工程；本地可执行链路不能被描述为生产 network-policy 证据。
- Gradle checks 在当前 checkout 串行运行，避免共享 build/test result 竞争。

## Goals / Non-Goals

**Goals:**

- 让 checked-in canonical OpenAPI 成为 method/path、`operationId`、wire schema、安全、响应、文档和 ingress metadata 的唯一事实来源。
- 用成熟 OpenAPI tooling 在构建期生成 Core Spring HTTP interfaces/wire models，并把生成边界限制在 HTTP adapter。
- 从同一 contract 构建 Gateway route manifest，让 routing 与 transport admission 共享一个 fail-closed 数据源。
- 删除 Core 手工 operation contract mapping、Gateway 手写 route list 和测试中的平行完整契约表。
- 保留已实现的 Gateway transport、Desktop fail-closed、本地生命周期及业务授权行为。
- 使 clean checkout、CI 和 IDE build 都能通过标准 Gradle task 确定性产生相同结果。

**Non-Goals:**

- 不生成或重写 domain model、application use case、authorization、repository、persistence entity 或 migration。
- 不生成 Desktop/Web/Mobile/CLI client；不定义 public API 的弃用窗口、版本承诺或 SDK 发布流程。
- 不实现 MCP、Public Developer API、Web、Mobile、CLI、managed-execution route 或新 credential 类型。
- 不使用 `/v1/**` catch-all，不让 Gateway 在运行时拉取 Core `/v3/api-docs`，不引入配置中心或路由热更新。
- 不把 canonical OpenAPI 拆成多个客户端版本，也不预建尚无独立 owner 的 overlay 仓库或自研 OpenAPI 框架。
- 不改变业务对象、数据库 schema、session 模型、幂等/版本规则或 GitHub provider 业务流程。

## Business Model

本次继续使用关系映射、具体场景检查、契约所有权决策树和信任边界 threat modeling，不增加新的领域对象或状态机。

- **参与者与目标：** 第一方用户通过共享 canonical API 操作 TaskPilot 资源；GitHub 浏览器 callback 完成既有 Federated Login Attempt；Gateway 执行技术入口策略；Core API 执行业务用例和最终授权；contract build 只描述和约束 HTTP adapter。
- **身份、关系和基数：** `User`、External Identity、Federated Login Attempt、Workspace/Project/Board/Column/Work Item/Board Placement 的稳定身份、owner 关系和基数保持 `docs/business-model.md` 的现有规则。OpenAPI schema 或 operationId 不是业务身份。
- **生命周期和版本：** Project archive/restore/permanent delete、Board permanent delete、session rotation/revocation、Work Item version 和 Placement movement 保持既有 transition、expected version、幂等和冲突规则。Gateway 与生成代码不新增通用 `status` 或 lifecycle 状态。
- **授权范围：** OpenAPI ingress metadata、Gateway header、URL 中的父 ID、客户端种类和 correlation ID 均不是授权证据。Core API仍须由 credential 和持久化事实解析 actor、Workspace、Project 与对象归属。
- **异步与恢复：** OAuth attempt/poll/callback 边界不变。Gateway 不自动重试 mutation；生成或 contract validation 失败属于 build failure，不产生运行时 fallback。
- **滥用与故障：** 未声明 ingress、重复 operationId、未知 route、伪造 metadata、超限 body、慢上游和 Gateway/Core 不可用必须 fail closed。运行时 Core 文档不可用或包含额外映射时，不得扩大 Gateway ingress。

因此本次没有业务模型或 migration 变化。最终 model-drift audit 必须用生成后的 adapter、runtime mappings、Gateway manifest、测试和 owner 文档复核该结论。

## Decisions

### 1. 在独立 contract 子工程维护单一 checked-in OpenAPI

新增 `:contracts:canonical-api`，源文件固定为 `contracts/canonical-api/openapi.yaml`。它拥有：

- method/path 与稳定唯一的 `operationId`；
- parameters、request/response wire schemas 和 validation；
- success/error status、标准 security、Problem Details、description/tag；
- 每个 operation 的 `x-taskpilot-ingress`。

Contract module 只拥有 HTTP interface description 与构建产物，不拥有 business use case、授权或持久化。OpenAPI Generator/validator/parser 均固定版本，禁止 dynamic/snapshot version；生成目录全部位于 `build/`，不提交生成源码。

选择 contract-first checked-in artifact，是因为它能在 Core/Gateway 启动前完成审查、校验和生成，也能被未来客户端或文档工具复用。拒绝继续以 runtime Springdoc 为事实来源，因为 Gateway 构建不能可靠依赖一个运行中的 Core，且 runtime output 会把部署可用性与 contract governance 耦合。拒绝从 OpenSpec 文本直接生成运行时代码，因为 OpenSpec capability specs 描述产品要求，不是完整机器接口描述。

### 2. Ingress policy 使用 operation vendor extension，而不是第二份 route 配置

每个 operation 必须显式声明以下受限枚举之一：

- `canonical`：第一方 canonical user API ingress；
- `provider-callback`：外部 provider/browser callback ingress；
- `none`：存在于 Core contract 但不由当前 Gateway 暴露。

缺失、未知值、重复 `operationId` 或无法解析的 operation 使 contract build 失败。当前所有 `/v1` operations 均必须显式分类，即使现阶段没有 `none` operation。

选择 `x-taskpilot-ingress` 是因为当前 canonical contract 与 ingress policy 由同一仓库、同一 Change 和同一安全审查边界拥有；独立 `gateway-policy.yaml` 会重新复制 operation 引用并增加同步路径。若未来出现多个独立 Gateway/deployment owner 或需要同一 contract 的多套发布策略，届时通过独立架构 Change 抽出以 `operationId` 为键的 overlay；本 Change 不提前构造该复杂度。

### 3. 构建期产生独立消费产物，运行时禁止 contract discovery

Contract module 使用标准 OpenAPI parser/validator读取规范，并产生两个独立消费边界：

1. Core adapter artifact：OpenAPI Generator `kotlin-spring` 生成的 interfaces、wire models 与 validation metadata；
2. Gateway route manifest：只包含 `operationId`、HTTP method、path template 与 ingress class 的确定性资源。

Core 只消费 adapter artifact；Gateway 只把 route manifest 作为生成资源复制到自身构建产物，不把 Core 或 Spring MVC adapter artifact放入 runtime classpath。Gateway 启动时严格加载 manifest；缺失、重复、非法 method/path/ingress 或空 manifest均启动失败。`RouteConfig` 与 `TransportPolicyFilter` 注入同一个 immutable catalog bean，避免 routing 与 admission 各自解析一份数据。

不在运行时读取 Core `/v3/api-docs`：该方案会让 Core 不可用时 Gateway 无法确定安全 surface，且被意外新增的 Controller 可能立即公开。也不把 route 直接写进 `application.yml`：配置文件仍是第二份人工 method/path source。manifest 是 canonical contract 的构建产物，不是可手工维护的环境配置。

### 4. Core 生成边界停在 HTTP adapter

采用固定版本 OpenAPI Generator Gradle plugin 和 `kotlin-spring` generator，目标配置为 Spring Boot 4、interface-only、无默认实现、Bean Validation、Jackson 3 与明确的 response handling。Apply 首先用代表性 operation 验证配置：

- access-bearer operation 与当前 authenticated actor 获取；
- anonymous GitHub callback 的 HTML response；
- `204` 无 body；
- `:customMethod` path；
- query/path parameters、array response 与共享 Problem Details。

若 generator 需要 request context，限制在生成接口与手写 adapter；authenticated actor 由 Core security context适配，不进入 application method signature。手写 adapter 实现生成接口，把 wire request映射为既有 command，把 application/domain result映射为 wire response。application/domain/persistence package不得引用生成 transport type。

选择生成 interfaces + wire models，而非只生成 models，是为了让 method/path 与实现绑定在编译期；只生成 models仍会留下手写 Controller mappings。选择不生成完整 server/controller/application，是为了保留现有 use case、授权、事务和模块边界。

### 5. Local/Test 文档从 canonical artifact 派生，不再手工补齐 operation

删除 `OpenApiConfiguration` 中按 Controller/path 维护的 response/authentication/description maps。Contract build 将已校验的 canonical artifact 作为只读资源打包给 Core；Local/Test `/v3/api-docs` 直接解析并序列化该 packaged artifact 的 JSON 表示，Swagger UI 只消费该 endpoint。它不调用运行时 mapping discovery，也不从生成接口或 Controller annotations 重建另一份文档。

这不是第二个事实来源：served document 只能由 canonical artifact 的已校验 build output 产生，并必须在 paths、operations、components、security、responses、descriptions、tags 和 TaskPilot extensions 上保持规范化语义相等；Controller 不能通过额外 annotation mapping 扩展 canonical surface。Production 继续关闭 OpenAPI/Swagger；Gateway 永不路由 Core 文档 endpoint。

### 6. Contract tests验证不变量与消费关系，不复制完整契约表

Contract module owns：

- OpenAPI structural validation、无 unresolved refs；
- operationId唯一、ingress枚举完整、禁止 legacy/client-specific path；
- secret/example hygiene；
- generator determinism 和 build output边界；
- route manifest与 canonical operations 的投影一致性。

Core tests验证：生成接口由 Spring adapter完整实现、runtime mappings不多不少、normalized served OpenAPI等价、认证与业务 HTTP行为保持。Gateway tests迭代 generated catalog，验证所有公开 route path-preserving，并验证 unknown/wrong-method/`none`/legacy/docs/management fail closed。测试不得再维护一份完整 hand-written operation map；具体高风险业务schema/status assertions可保留，但其 expected值直接读取 canonical artifact或检查行为结果。

### 7. 保留已实现的 Gateway、Desktop 与本地拓扑决策

Gateway继续是独立 Kotlin/Spring Cloud Gateway WebFlux服务，使用 public origin `35432`；Core internal origin默认 `45432`。Desktop只获得Gateway origin，没有Core fallback。Gateway继续执行 header allowlist/spoofing removal、correlation、bounded request/response、timeout、stable Problem Details、无 mutation retry及有限management endpoints。Core继续独立认证授权。

本地生命周期保持 PostgreSQL → Redis → Core → Gateway → Desktop 启动顺序及反向停止顺序；`dev:api`表示Core+Gateway server stack。system journey继续跨 compiled Desktop Main/IPC/Preload、真实Gateway/Core及PostgreSQL/Redis。Contract generation必须在相关 Core/Gateway compile/package前完成，但不得要求运行任何服务。

### 8. 构建、质量门和文档把 contract 作为一等边界

Root settings纳入 `:contracts:canonical-api`。Contract module提供独立 `qualityCheck`，至少覆盖validation、generation、unit/contract tests、determinism和artifact boundary。Core/Gateway compile与quality gate依赖所消费的contract artifact task；root `pnpm check`按串行顺序运行contract、Core、Gateway和Desktop相关门，避免Gradle并发。

Git staged-path gate将 `contracts/canonical-api/**` 选择 contract、Core、Gateway gates，因为它可同时改变adapter与ingress；root Gradle/version catalog/wrapper继续选择所有JVM边界。owner文档不得后置到收尾切片：创建 contract 子项目时同时创建其 `AGENTS.md`、local architecture/testing strategy并更新文档地图和根架构中的跨项目ownership；Core adapter迁移时同步Core AGENTS与child docs；Gateway manifest迁移时同步Gateway AGENTS与child docs。最终文档任务只做跨项目对账、README和剩余状态收敛。`docs/business-model.md`仅在语义审计发现模型变化时修改。

### 9. 历史 evidence 与新增工作分别记账

原40项 Gateway/URI/Desktop迁移任务已经有现存自动化证据，不回退或伪造历史Red。新增contract-first工作作为未完成任务单独记录，并使用配置prototype、validation、compile、contract/integration和完整quality gate证明。完成新增任务前Change不得被描述为implementation complete、sync-ready或archive-ready。

## Risks / Trade-offs

- **[Generator输出不适配现有Spring Security或特殊response]** → 先对 bearer、HTML callback、204、custom method和Problem Details做代表性prototype；配置固定后才全量迁移。若成熟generator确实不能表达批准contract，暂停并更新设计，不以手写平行Controller绕过。
- **[生成transport type侵入业务层]** → 生成package与artifact独立，手写adapter显式mapping，Core架构规则禁止application/domain/persistence依赖generated package。
- **[Gateway因共享artifact引入MVC/Core依赖]** → route manifest使用独立outgoing artifact/resource；Gateway build-contract检查runtime classpath无WebMVC、Core classes和adapter jar。
- **[Vendor extension误配置导致route意外公开]** → 每个operation必须显式枚举；无默认公开；manifest投影测试和unknown/`none` negative integration双重验证。
- **[runtime文档与source spec序列化差异造成脆弱测试]** → 比较解析、规范化后的语义节点，不比较键顺序或无意义format；关键extension/security/status不得忽略。
- **[生成不确定或工具升级产生大面积diff]** → 固定工具版本、clean build determinism gate；升级必须显式review生成差异，禁止dynamic version。
- **[contract module成为业务schema owner]** → 只拥有HTTP wire representation；业务含义仍由business model/capability specs与Core use case拥有，变更时同时做model impact检查。
- **[一次性迁移造成中间编译失败]** → 按artifact→prototype→Core adapter→Gateway manifest顺序实施，以一个原子交付单元合并；不保留手写fallback。
- **[本地强制入口被误当成生产网络隔离证据]** → local automated evidence与production network-policy evidence分开报告。

## Migration Plan

1. 保留当前已实现 topology和行为测试，建立 `:contracts:canonical-api` 及固定tooling；同时建立该子项目的AGENTS与local architecture/testing owner文档、更新文档地图和根架构ownership；从当前已验证runtime contract提取完整`openapi.yaml`，先做到validation通过，不立即删除旧实现。
2. 为operationId、ingress、legacy path、secret hygiene、manifest projection和determinism建立contract gate；允许批准的secret-bearing字段声明，但拒绝这些字段的example/default、真实或sentinel secret值及path/query/URL/log暴露；完成代表性generator prototype并固定配置。
3. 生成Core interfaces/wire models，按capability迁移手写HTTP adapters及mapping，并在该切片同步Core AGENTS与child docs；保持application/domain/persistence不变。全部adapter编译和HTTP行为通过后，删除手工`CanonicalOpenApiContracts` maps与平行完整期望表。
4. 从同一contract生成Gateway route manifest，令routing/filter共享immutable catalog，并在该切片同步Gateway AGENTS与child docs；全部正反route/transport tests通过后删除手写`RouteCatalog.routes`。
5. 让Local/Test served OpenAPI/Swagger确定性展示canonical artifact并完成normalized equality；Production/Gateway docs继续不可达。
6. 更新root checks与staged-path selection，对已随切片更新的root/contract/Core/Gateway owner文档做跨项目对账，并收敛Desktop、README和剩余Current/Target状态；运行contract、Core、Gateway、Desktop、dev smoke、system journey和OpenSpec门禁。
7. 执行model/documentation drift audit；只有新增任务完成、独立CR与manual acceptance无遗留并收到明确archive授权后，才sync/archive。

回滚必须回退整个contract-first slice到前一个内部一致状态，不能保留“部分Controller实现generated interface、部分仍手写契约”或恢复运行时Gateway discovery。数据库未变化，无数据回滚。
