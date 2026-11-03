# Test Plan

## Scope and Risk

本 Change 是**高风险跨边界架构与 breaking HTTP contract 变更**。第一阶段已经在当前工作树完成 canonical URI、Gateway、Desktop transport、本地开发生命周期和 system journey；归档前新增的 contract-first 修正还将影响 `contracts/canonical-api`、Core HTTP adapter、Gateway route manifest、根 Gradle、提交门和 owner 文档。逃逸缺陷可能导致越权或租户信息泄漏、未知 operation 被意外公开、客户端绕过 Gateway、wire contract 漂移、生成代码侵入业务层、构建不可复现、重复 mutation、OAuth 无法完成或 Desktop 全量不可用。

风险分类：

- **契约所有权：** checked-in `openapi.yaml` 必须是 method/path、稳定 `operationId`、wire schema、security、response、Problem Details、文档和 ingress metadata 的唯一事实来源；Controller 注解、测试表或 Gateway 配置不能继续维护平行完整契约。
- **生成边界：** 成熟且固定版本的 OpenAPI tooling 只生成 Core Spring HTTP interfaces、wire models 和 validation metadata；domain/application/persistence/authorization 不得依赖生成 transport type。
- **Gateway 准入：** 每个 operation 必须显式声明受限枚举的 `x-taskpilot-ingress`；manifest 缺失、无效、重复或为空必须在 build/startup 时 fail closed，不能退化为 `/v1/**` catch-all 或运行时读取 Core 文档。
- **安全/授权：** 短资源路径必须继续按持久化归属授权；OpenAPI metadata、Gateway header、URL 父 ID 和客户端类型都不是授权证据，Core API 仍须独立认证授权。
- **协议/兼容：** `/desktop/v1/**` 一次性退役；canonical operation、schema、status、Problem Details、secret hygiene 和 Local/Test 文档必须精确，Production 与 Gateway 不能暴露文档。
- **可靠性/恢复：** chunked/未知长度超限、header/response 超限、timeout、upstream 失败和响应未知不得泄漏内部信息或自动重试 mutation；contract generation 失败不能产生运行时 fallback。
- **拓扑/配置：** Desktop 与 GitHub callback 必须经过 Gateway，Core API 只使用 internal origin；本地生命周期与真实 system journey 必须保持 checkout 隔离。
- **构建/治理：** clean checkout 必须可确定性重建生成产物，generated source 不提交；contract、Core、Gateway、Desktop、staged-path 选择和 owner 文档必须与实现一致。

显式非目标：不测试或实现 MCP/Public/Web/Mobile/CLI/managed-execution，不生成客户端 SDK，不调用真实 GitHub，不改变数据库 schema、业务对象或生命周期，不定义 external public API 的版本兼容承诺，不建设配置中心、route hot reload 或自研 OpenAPI parser，也不以本 Change 宣称尚未取得环境证据的生产网络策略、Windows/macOS release 或安装包就绪。

该工作主要是 contract extraction、生成配置、adapter/manifest 迁移、架构约束和文档治理，不为流程合规制造 Red/Green。新增 contract-first 切片采用直接实现、代表性 prototype、compile failure、schema/semantic validation、focused integration 和 clean-build determinism 证据；已有 Gateway route/filter 与 Core HTTP 行为继续由现存正反测试防回归。

**Evidence ledger：** 第一阶段实施没有保留 Core HTTP/OpenAPI、短路径授权、Gateway route、Desktop consumer 和 hook mapping 五项独立 Red 命令的失败输出，因此本 Change 不声称这些历史 Red 证据存在，也不通过回退或故意破坏实现追溯补造。`tasks.md` 的 1–8 组保留当时可审计的完成证据；9–14 组单独记录尚未实施的 contract-first 修正。在新增任务完成并重新验证前，本 Change 不得描述为 implementation complete、sync-ready 或 archive-ready。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| canonical artifact 完整且语法有效 | contract schema/semantic validation | parser/validator 读取 `openapi.yaml`；断言每个 operation 有唯一稳定 `operationId`、显式合法 `x-taskpilot-ingress`、明确 request/response/security/Problem Details，且无旧 path、management、未实现 surface；批准的secret-bearing字段可以存在，但不得带example/default，也不得出现真实或sentinel secret值及path/query/URL暴露 | 在任何消费方生成前拒绝不完整或不安全契约 |
| contract 是唯一完整 operation source | architecture/source boundary | contract gate 扫描并禁止 Core/Gateway/test 中的平行完整 method/path、auth/response map；允许单 operation 的 focused fixture 与生成 manifest 消费代码 | 消除人工多处同步，而不是仅在漂移后报警 |
| 固定 tooling 可在 clean checkout 确定性生成 | build/determinism | 固定 plugin/parser 版本；同一输入重复生成的规范化 artifact hash 相同；`git status`/artifact-boundary test 证明 generated source 只在 Gradle `build/` 且不被跟踪 | 捕获工具漂移、机器相关输出和误提交 generated source |
| generator 能表达现有特殊 HTTP 契约 | representative prototype + compile/integration | 在全量迁移前覆盖 bearer JSON operation、GitHub HTML callback、204 response、PATCH/DELETE 等非简单 GET/POST operation、validation 与共享 Problem Details；失败时暂停并更新设计 | 尽早验证成熟 generator 是否适配 Spring Boot 4/Jackson 3 和当前契约，避免迁移中途保留双实现 |
| contract 变更会约束 Core adapter | generated-interface compile contract | 修改测试 fixture 中的 operation/signature/schema 后，未同步 adapter 必须编译失败；同步后 focused HTTP test 通过 | method/path 与实现绑定在编译期，而不是依靠手写期望表 |
| generated transport type 不侵入业务层 | Core architecture test | 扫描非空 production classes，禁止 application/domain/persistence/repository 引用 generated package；手写 adapter mapping tests覆盖 wire ↔ command/result | 防止 contract module成为业务模型或持久化 owner |
| Core path迁移保留 schema、status、Problem Details 与 secret hygiene | Core HTTP contract/integration | 从 canonical artifact 驱动的参数化断言，加现有 federated login、session、Workspace/Project/Project Work focused tests；不维护第二份完整 operation 表 | Core 是行为 owner；artifact 驱动避免再次复制 contract |
| 短资源 path 仍按真实 ownership 授权 | Core + real PostgreSQL integration | 交叉 Workspace/Project/Board/Column/Work Item ID、错误 Placement 组合、非成员、错误 role 按既有 not-found/authorization 语义拒绝 | 必须使用真实持久化关系，Gateway 或 generated interface 无法证明授权 |
| Project/Board lifecycle、version/idempotency 不变 | Core module/integration | archive/restore/permanent delete、expected version、精确名称、重复 idempotency key、事务回滚现有测试继续通过 | 防止 transport 重构改变状态机、并发和恢复语义 |
| Work Item 仍无通用 status/lifecycle/delete API，TEAM 仍未开放 | canonical contract negative assertions + business tests | artifact 中不存在相应字段/operation，现有业务负例继续通过 | 证明 contract extraction 没有把未批准模型能力带入 HTTP surface |
| manifest 是 canonical ingress 投影 | contract projection test | 对每个 operation 按 `x-taskpilot-ingress` 生成 method/path/operationId/ingress；manifest 集合与 approved ingress operations 完全相等，`none` 不进入 public route | 在生成边界证明无遗漏、无额外公开和无人工 route list |
| routing 与 admission 使用同一 immutable manifest | Gateway context/integration | `RouteConfig` 与 `TransportPolicyFilter` 注入同一 catalog bean；重复/非法/空 manifest 启动失败；wrong method、unknown、legacy、`none` route 不到达 stub upstream | 防止路由层和 filter 层各自维护或解析不同集合 |
| Core runtime docs 是 canonical artifact 的确定性表示 | Core OpenAPI integration | 解析并规范化 Local/Test `/v3/api-docs` 与 checked-in artifact，比对 paths、operations、components、security、responses、descriptions、tags 与 TaskPilot extensions；忽略键顺序等非语义格式 | 防止 runtime docs 重新成为由 Controller 推导的第二份事实来源，同时避免脆弱文本比较 |
| Production/Gateway 不暴露 OpenAPI 或 Swagger | profile + Gateway negative integration | Production Core docs endpoint关闭；Gateway 上 `/v3/api-docs`、Swagger 和 management requests 不到达 Core | 保持内部文档边界和 public ingress 最小化 |
| Gateway transport policy 保持不变 | Gateway route/filter integration + observable stub | approved routes path/query/body保持；header清理、correlation、body/header/response limit、timeout、stable error、no retry 与 secret hygiene 现有矩阵继续通过 | contract source迁移不能削弱已实现的技术策略 |
| Desktop 只能使用 Gateway，Gateway/Core 故障不直连降级 | Desktop Main tests + system journey | local 默认与注入 origin 均为 Gateway public origin；compiled Main/IPC/Preload → Gateway → Core；停止 Gateway 或断开 Core 得到稳定失败且无 Core fallback | 捕获配置或 adapter 迁移导致的拓扑回退 |
| contract 路径正确选择质量门 | hook selection tests | `contracts/canonical-api/**` 选择 contract、Core、Gateway 各一次；root Gradle 选择三个 JVM 边界；纯 docs 免测；rename/copy/特殊字符/未知路径保持既有语义 | contract 同时改变两个消费者，漏跑任一门都会放过不一致构建 |
| model、文档与实现无漂移 | final semantic/source review | 比对 business model、main/delta specs、artifact、generated boundary、Core adapter、Gateway manifest、migrations、owner docs 和运行证据 | 测试通过不证明产品语义、ownership 或 Current/Target 状态一致 |

## Implementation and Verification Approach

### Slice 1: 建立 canonical contract module 并提取 artifact

直接将 `:contracts:canonical-api` 纳入 root Gradle，固定成熟 OpenAPI Generator 与 parser/validator 版本；同一切片创建该子项目的 `AGENTS.md`、local architecture/testing strategy并更新文档地图和根架构ownership。从当前已验证 HTTP surface 提取完整 `openapi.yaml`。先让 syntax、semantic、operationId、ingress enum、legacy/management/secret-hygiene checks 通过；secret hygiene允许批准的secret-bearing字段声明，但拒绝字段example/default、真实或sentinel secret值及path/query/URL暴露。不删除当前 Controller 或 Gateway route 实现。生成输出只进入 module 的 `build/`。

### Slice 2: 验证 generator 代表性边界

用最小但有代表性的 operations 验证 `kotlin-spring` 的 Spring Boot 4、Jackson 3、interface-only、skip-default-implementation、Bean Validation 与 response 配置，覆盖 bearer JSON、HTML callback、204、非简单 method 和 Problem Details。该切片是配置/工具适配 prototype，不制造业务 Red；以 generated source inspection、compile 和 focused HTTP integration 为证据。若成熟 generator 无法表达批准契约，暂停并更新 Change，不增加手写平行 Controller 绕过。

### Slice 3: 迁移 Core generated HTTP adapter 边界

构建期先验证 contract，再生成 Spring interfaces/wire models，随后按 capability 让手写 Core adapters 实现生成接口并显式映射既有 command/result。用编译失败证明 contract signature 可约束 adapter，用架构测试禁止 generated type 进入 application/domain/persistence。迁移前先同步 Core AGENTS 与 child architecture/responsibilities/testing strategy，用Current/Target使实施指令不再要求维护 Core runtime mapping contract source但不提前声称实现完成。全部 HTTP、授权、lifecycle、version/idempotency 测试通过后，删除手工 operation auth/response/description maps、平行完整 operation 期望表和不再需要的 Controller mapping source，并把经验证的Target状态收敛为Current。

### Slice 4: 生成并迁移 Gateway route manifest

从同一 artifact 构建只包含允许 ingress 的 manifest，作为独立生成资源供 Gateway 消费，不把 Core adapter artifact或 MVC runtime带入 Gateway。Gateway 启动时严格加载为一个 immutable catalog，routing 与 transport admission 注入同一实例。迁移前先同步 Gateway AGENTS 与 child architecture/responsibilities/testing strategy，用Current/Target使实施指令不再要求新增或继续扩展手写catalog但不提前声称实现完成。先完成 projection、invalid manifest和route negative evidence，再删除手写 `RouteCatalog.routes`并把经验证的Target状态收敛为Current；不保留 fallback、catch-all 或 runtime discovery。

### Slice 5: 让 runtime docs 确定性展示 canonical artifact

Contract build 将已校验的 canonical artifact 作为只读资源打包给 Core；Local/Test `/v3/api-docs` 直接解析并序列化该 packaged artifact 的 JSON 表示，Swagger UI 只消费该 endpoint。删除运行时 mapping discovery 以及从生成接口、Controller annotations或custom maps重组契约的路径。测试比较解析并规范化后的语义节点，不比较 YAML/JSON 排版或键顺序。Production Core与Gateway继续关闭文档入口。

### Slice 6: 更新构建、提交门与跨项目文档对账

使 contract `qualityCheck` 覆盖 validation、generation、determinism、artifact boundary 和 projection；Core/Gateway compile与质量门依赖各自消费 artifact。更新 `pnpm check` 和 staged-path selection，保持 Gradle串行。对前序切片已经更新的contract/Core/Gateway owner文档和root architecture做跨项目一致性复核，并同步Desktop child docs、README及剩余导航与Current/Target状态；不得到本切片才首次修改用于指导前序实现的AGENTS或owner规则。

### Slice 7: 受影响回归与跨边界 journey

串行运行 contract、Core、Gateway、Desktop、dev、hooks和system gates。重点回归 Core授权/业务不变量、Gateway transport策略、Desktop无直连fallback、GitHub callback和旧/未知route拒绝；不因contract-first修正重复不相关UI或平台发布测试。

### Slice 8: 最终模型与文档对账

比对 business model、main/delta specs、canonical artifact、生成产物边界、Core adapters、Gateway manifest、migrations、tests和运行证据。若发现产品词汇、关系、生命周期、授权或恢复假设变化，暂停并更新/重新批准 Change；若仍无模型变化，记录 `docs/business-model.md` 无需修改的证据。完成 self-review后停在独立 code review与manual acceptance gate，不自行 sync/archive/stage/commit。

## Verification Commands

Gradle相关命令必须**串行**执行，避免共享 `build/test-results` 竞争。`contracts` 命令由 Slice 1 创建后执行；所有结果按实际输出记录，命令存在不等于已经通过。

### Focused

- `./gradlew --no-daemon :contracts:canonical-api:qualityCheck`：canonical syntax/semantic、operationId/ingress、legacy、secret-field example/default与secret-value/URL exposure、generation、projection、determinism和artifact-boundary完整门。
- `./gradlew --no-daemon :services:core-api:test --tests '*OpenApi*' --tests '*Api*' --tests '*Authorization*'`：generated adapter、runtime docs、canonical paths和短路径授权focused证据；Apply时按实际测试类名确认匹配，不能静默零测试。
- `./gradlew --no-daemon :services:core-api:qualityCheck`：Core compile、contract、real-infrastructure、architecture和coverage完整门。
- `./gradlew --no-daemon :services:gateway:test --tests '*Route*' --tests '*Transport*' --tests '*UpstreamUnavailable*'`：manifest loading、route admission、transport policy和Core unavailable focused证据；Apply时确认实际匹配的测试数量。
- `./gradlew --no-daemon :services:gateway:qualityCheck`：Gateway compile、static analysis、integration、build-contract、coverage和`bootJar`完整门。
- `pnpm --filter @taskpilot/desktop test:main`：Desktop Gateway origin、canonical adapters、callback和fail-closed focused tests。
- `pnpm dev:test`：checkout ports、process ownership、startup/stop、status/logs/doctor/smoke控制逻辑。
- `pnpm hooks:test`：contract/Core/Gateway staged-path、共享Gradle、rename/copy、特殊路径和fail-closed分类。

### Affected and Cross-Boundary

- `pnpm --filter @taskpilot/desktop qualityCheck`：Desktop type/lint/Main/Renderer/architecture/coverage/build完整门。
- `pnpm dev:smoke`：隔离真实Core+Gateway进程的health、canonical/legacy route和disabled-provider smoke。
- `pnpm --filter @taskpilot/desktop test:system`：compiled Main/IPC/Preload → Gateway → Core API → PostgreSQL/Redis selected journey，以及Gateway停止/Core断开时无fallback。
- `pnpm check`：串行运行仓库launcher及受影响的contract、Core、Gateway、Desktop门；输出必须列出实际执行命令，不能把未执行门标为通过。
- `openspec schema validate taskpilot-sdd --verbose`：验证仓库自定义schema有效。
- `openspec validate establish-canonical-resource-api-and-gateway --strict --no-interactive`：验证本Change planning artifacts和delta结构。
- `openspec validate --all --strict --no-interactive`：验证全部active changes与main specs；并发Change失败须单独归因，不得修改它来让本Change通过。
- `git diff --check`：检查全仓已跟踪implementation/planning diff的whitespace error和conflict marker；未跟踪Change artifacts须另做显式whitespace与内容review，不能把空diff当成功证据。

## Manual Evidence and Automation Gaps

- **生产网络旁路防护：** 当前仓库无实际生产部署工程。自动化只能证明loopback/private binding配置、Desktop无Core origin和本地链路；生产发布owner必须在真实环境验证Core应用端口从公网不可达且只有Gateway网络身份可达。取得该证据前不得宣称生产网络隔离已验收，后续部署Change/release gate拥有自动化落点。
- **真实GitHub OAuth：** provider/browser doubles与callback contract不证明GitHub配置、浏览器焦点或真实回调域名。当前Change完成后由开发者在目标环境执行一次真实登录smoke；该检查不进入`tasks.md` checkbox，也不扩大为provider integration。
- **平台发布：** 本Change不改Renderer体验，也不声称Windows/macOS安装、签名或native credential release-ready；这些证据继续由Desktop platform release matrix拥有。
- **生成工具升级：** 当前Change固定并验证一个版本，但未来升级的生成差异必须由维护者显式review并重跑contract/Core/Gateway门；本Change不建立跨版本长期兼容承诺。
