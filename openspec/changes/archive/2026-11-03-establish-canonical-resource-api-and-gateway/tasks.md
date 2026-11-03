# Tasks

## 1. 初始化可运行的 Gateway 边界

- [x] 1.1 根据当前 Spring Boot 官方 compatibility matrix 选择并锁定兼容的稳定 Spring Cloud release train，在 `settings.gradle.kts`、version catalog 和 `services/gateway` 中初始化独立 Kotlin/Spring Cloud Gateway WebFlux 子工程；以 `./gradlew --no-daemon :services:gateway:dependencies :services:gateway:classes` 成功及版本目录无动态版本为证据。
- [x] 1.2 建立 Gateway application/config binding、loopback/local 与 internal Core origin 配置、liveness/readiness、`bootJar` 和独立启动入口；以 context/config binding tests 及 packaged `bootJar` 使用 stub Core 启动并通过 health smoke 为证据。
- [x] 1.3 建立 Gateway build contract、ktlint/detekt、测试、coverage 和单一 `:services:gateway:qualityCheck`，断言无 Spring MVC、Core API production classes、业务 DB driver/Flyway/Modulith runtime；以故意检查实际 task dependencies 的 build-contract test 和 `./gradlew --no-daemon :services:gateway:qualityCheck` 为证据。
- [x] 1.4 同步 `services/gateway/AGENTS.md` 与 Gateway architecture/responsibilities/testing-strategy：区分已初始化 Current runtime 和尚未实现的 Target route classes，记录精确命令与不拥有业务数据库/授权/OpenAPI；以文档 source review 和所有相对链接可解析为证据。

## 2. 建立 Core canonical resource contract

- [x] 2.1 验证Core HTTP与运行时OpenAPI contract tests精确断言已批准canonical method/path集合、`/desktop/v1/**`全部缺失、错误method与未实现surface缺失；以focused contract tests及Core完整质量门通过为当前交付证据。独立Red失败输出未保留且不追溯补造。
- [x] 2.2 验证短Project/Board/Column/Work Item paths和Placement组合的跨Workspace/Project ownership、非成员、错误role与not-found防泄漏负例使用真实持久化归属并保持既有拒绝语义；以focused authorization tests及Core完整质量门通过为当前交付证据。独立Red失败输出未保留且不追溯补造。
- [x] 2.3 **Green:** 一次性迁移 Auth/session/current-user/Workspace/Project/Board/Column/Work Item/Placement Controllers 和 security matchers 到 specs 中的canonical paths，删除全部旧mapping且不添加alias/redirect；复用现有 DTO、application use case和业务错误，以focused HTTP/OpenAPI tests转绿为证据。
- [x] 2.4 **Green:** 对稳定ID短路径实现从持久化资源反查真实Workspace/Project/Board归属并执行既有授权，保持组合不一致的not-found语义；以real-PostgreSQL authorization tests覆盖交叉ID和合法路径为证据。
- [x] 2.5 **Refactor:** 清理不再需要的父级transport参数和客户端命名，但不得更改schema、success status、Problem Details、expected version、idempotency、transaction或session semantics；以现有archive/restore/delete/version/idempotency/session及Project Work suites全部通过为证据。
- [x] 2.6 更新Core OpenAPI tags/operation IDs和contract ownership：仅Core生成runtime OpenAPI，Local/Test可从internal origin读取，Gateway/public不暴露；逐项迁移并断言federated login schema/status、`x-taskpilot-authentication`、refresh/access security、完整`TaskPilotProblemDetails`字段、Workspace/Project/Project Work契约、Production文档关闭及`persistAuthorization=false`，以OpenAPI secret/security/schema assertions和旧path全文检索无生产mapping为证据。
- [x] 2.7 更新Core架构规则，防止按Desktop/Web/Mobile/CLI复制Controller/DTO/application use case并保持canonical/provider-callback/managed-execution/future public/MCP adapter边界；以扫描非空production classes的架构测试和 `./gradlew --no-daemon :services:core-api:qualityCheck` 为证据。
- [x] 2.8 同步 `services/core-api/AGENTS.md` 与Core architecture/responsibilities/testing-strategy中的canonical API、Gateway upstream、OpenAPI和测试命令，并核对migration inventory确认无数据库migration；以owner文档review、链接检查和无新增migration文件为证据。

## 3. 实现 Gateway 路由与传输策略

- [x] 3.1 验证protocol-focused stub upstream和参数化route tests覆盖全部批准method/path的path/query/body保持，以及旧path、未知path、错误method、Swagger/management/future surfaces不得触发stub；以focused Gateway integration tests、Core OpenAPI双向catalog一致性及Gateway完整质量门通过为当前交付证据。独立Red失败输出未保留且不追溯补造。
- [x] 3.2 **Green:** 实现显式method + PathPattern route catalog和path-preserving转发，不添加`/v1/**` catch-all或第二套rewrite；以route tests转绿及Core runtime OpenAPI与Gateway catalog双向集合一致性test为证据。
- [x] 3.3 **Red/Green:** 增加并实现hop-by-hop、proxy、principal/User/Workspace/Project/role/tenant/internal-origin header清理，以及单值有界`X-Correlation-Id`复用/重生成；以`WebTestClient` + stub断言spoofed值缺失且upstream/response correlation一致为证据。
- [x] 3.4 **Red/Green:** 增加并实现credential最小转发与secret-safe observability，禁止Authorization、refresh/poll secret、OAuth code/state、cookie、body/query和internal origin进入日志、metric tag或error；以captured-log negative assertions和必要credential到达stub为证据。
- [x] 3.5 **Red/Green:** 增加并实现routing前request-size有界读取，覆盖Content-Length、无长度和真实chunked的limit-1/limit/limit+1，超限时返回稳定413且不把body/request发送upstream；以reactive integration tests和stub计数为证据。
- [x] 3.6 **Red/Green:** 增加并实现header、response-size、connect/response timeout与malformed upstream边界，并禁止所有当前operation自动retry；以超限/慢响应/断连tests、mutation counting stub调用恒为1和无internal detail assertions为证据。
- [x] 3.7 **Red/Green:** 实现Gateway transport Problem Details与Core业务response透传，限制management为低信息liveness/readiness且readiness反映upstream可达性；以401/403/404/409业务Problem Details原样透传、local rejection独立code及非health actuator拒绝tests为证据。
- [x] 3.8 将Gateway实现按`config`、`route`、`transport`、`health`职责分包，保留`GatewayApplication`与`GatewayProperties`，其余内部类型去除重复`Gateway*`前缀；同步Core cross-contract import、测试package/class名及Gateway owner文档，不机械拆分综合集成测试。以旧符号全文检索为空、Gateway/Core编译、focused integration tests和两个服务质量门通过为证据。
- [x] 3.9 运行 `./gradlew --no-daemon :services:gateway:qualityCheck`，核对coverage中的route/security/limit/retry关键branch和packaged stub-upstream smoke；任何未执行或被过滤为零tests的suite必须修复而非标记通过。

## 4. 将 Desktop Main 切换到 Gateway

- [x] 4.1 验证Desktop Main consumer tests只接受Gateway origin、canonical path与provider callback，拒绝Core origin和`/desktop/v1`，并覆盖Gateway unavailable/upstream unavailable时不得fallback、不清除仍可能有效credential且不伪造success；以Main focused tests、Gateway failure system journey及Desktop完整质量门通过为当前交付证据。独立Red失败输出未保留且不追溯补造。
- [x] 4.2 将Main auth/session/current-user/Workspace/Project/Board/Column/Work Item/Placement adapters迁移到canonical paths，以 `TASKPILOT_GATEWAY_URL` 取代Desktop可见的`TASKPILOT_CORE_API_URL`，删除Core fallback和编译进Desktop的Core public origin；以Main tests转绿及构建产物/源代码全文检索无Desktop Core origin为证据。
- [x] 4.3 保持Renderer/IPC业务contract和UI不变，更新consumer fixtures只接受canonical no-extra-field responses；以 `pnpm --filter @taskpilot/desktop qualityCheck` 全量通过且没有为本Change增加视觉快照为证据。
- [x] 4.4 同步Desktop architecture/responsibilities/testing-strategy中的Gateway upstream、环境变量、callback与system journey/failure边界；以owner文档review和链接检查为证据。

## 5. 将 Gateway 纳入本地开发与文档

- [x] 5.1 在checkout默认值、`.env.local.example` 和配置解析中增加独立 `TASKPILOT_GATEWAY_PORT`/派生URL，保证PostgreSQL、Redis、Core、Gateway和Desktop端口唯一；把Core URL限制为Gateway/dev tooling internal配置，把GitHub callback设为Gateway canonical URL；以 `pnpm dev:test` 的配置/端口/环境传播cases为证据。
- [x] 5.2 扩展开发控制器的编译、启动、health/readiness、PID ownership、停止、restart、status、logs、doctor和cleanup：顺序为基础设施→Core→Gateway→Desktop，停止反序；未知进程/其他worktree仍fail closed；以Node lifecycle/ownership/failure tests为证据。
- [x] 5.3 将`dev:api`明确为Core+Gateway server stack，使`dev:desktop`要求两者ready，并确保只把Gateway public origin传给Desktop；以child command/environment捕获tests和诊断输出区分public/internal URL为证据。
- [x] 5.4 扩展 `pnpm dev:smoke`：隔离端口启动真实Core和packaged Gateway，验证health、canonical capability、disabled GitHub capability、旧/未知route拒绝且不联系GitHub；以smoke进程退出0、请求记录和cleanup assertions为证据。
- [x] 5.5 更新 `README.md`、`docs/architecture.md` 和必要的 `docs/README.md` 状态/ownership描述为当前Client→Gateway→Core拓扑，明确本地证据与未验证的生产network-policy边界；以Current/Target逐项source review、Mermaid可解析和文档链接检查为证据。

## 6. 扩展仓库质量门选择

- [x] 6.1 验证hook selection矩阵覆盖Gateway-only、Core-only、多模块、root Gradle、跨模块rename/copy、特殊字符、污染工作树和未映射路径，并保持NUL-safe、去重与fail-closed语义；以`pnpm hooks:test`和`pnpm check`通过为当前交付证据。独立mapping Red失败输出未保留且不追溯补造。
- [x] 6.2 将 `services/gateway/**` 显式映射到 `./gradlew --no-daemon :services:gateway:qualityCheck`，使root Gradle/version catalog/wrapper同时触发Core与Gateway并保持NUL-safe、去重、copy/rename和fail-closed语义；以全部hook tests转绿为证据。
- [x] 6.3 更新 `pnpm check` 与开发文档，使dev/hooks/Desktop/Core/Gateway完整门按串行顺序执行且输出区分已运行/未运行/失败；以命令选择测试和一次 `pnpm check` 的实际执行日志为证据。

## 7. 验证跨服务 journey

- [x] 7.1 扩展portable system harness，启动真实Gateway与Core API、PostgreSQL、Redis及provider/browser doubles，并让compiled Desktop Main/IPC/Preload只能获得Gateway origin；以测试拓扑中Core internal port对Desktop不可配置及Gateway观测到请求为证据。
- [x] 7.2 覆盖至少登录/current-user和一个Project→Board→Work Item读写journey，同时注入Gateway停止和Core upstream断开，验证成功链路、stable error和无直连fallback；以 `pnpm --filter @taskpilot/desktop test:system` 通过为证据。
- [x] 7.3 串行重跑 `./gradlew --no-daemon :services:gateway:qualityCheck`、`./gradlew --no-daemon :services:core-api:qualityCheck`、`pnpm --filter @taskpilot/desktop qualityCheck`、`pnpm dev:test`、`pnpm hooks:test` 和 `pnpm dev:smoke`，记录每个实际结果；不得把未执行的真实GitHub、生产网络或平台release evidence宣称为通过。

## 8. 模型与文档对账

- [x] 8.1 比对已批准business model与实现代码、migration inventory、canonical API/OpenAPI、Gateway catalog、Desktop transport、tests和运行证据，确认身份、ownership、cardinality、lifecycle、authorization、version/idempotency和recovery语义未漂移；若发现假设错误，暂停并更新/重新批准Change，不能在代码中隐藏决定。
- [x] 8.2 将稳定结论反馈到 `docs/business-model.md`、根architecture、Gateway/Core/Desktop child文档、README和main specs的owner：仅在模型事实改变时修改business model，否则在Change证据中记录“不需要修改”的理由；核对所有Current/Target状态、链接与命令匹配实际实现。
  - **Apply evidence:** 本 Change 未改变实体稳定身份、ownership/cardinality、lifecycle、business invariant、authorization、version/idempotency 或 recovery semantics；migration inventory 仍仅为 V1。本次只改变 transport topology 与 canonical URI contract，因此 `docs/business-model.md` 无需修改；根与 child architecture/README 已按实现证据更新。
- [x] 8.3 核对`desktop-api-documentation`是被显式retire而非留下空main spec，`canonical-resource-api`和`api-gateway`可新增，所有MODIFIED requirements保留完整原requirement语义；以delta/main逐项comparison和sync-readiness review为证据，但此任务不执行sync或archive。
- [x] 8.4 串行运行 `pnpm check`、`openspec schema validate taskpilot-sdd --verbose`、`openspec validate establish-canonical-resource-api-and-gateway --strict --no-interactive`、`openspec validate --all --strict --no-interactive`、全仓 `git diff --check` 和相关link检查，显式review未跟踪Change artifacts并记录、归因并发Change的独立结果；完成implementation self-review后停在独立code review与manual acceptance gate，不sync、不archive、不stage、不commit。

## 9. 建立 canonical contract module

- [x] 9.1 在 root Gradle 中新增 `:contracts:canonical-api`，固定 OpenAPI Generator 与 parser/validator 的稳定版本，建立独立 `qualityCheck`；生成目录仅位于 Gradle `build/`，以 clean checkout 可执行 `./gradlew --no-daemon :contracts:canonical-api:qualityCheck` 且无 dynamic/snapshot 依赖为证据。
- [x] 9.2 随子项目创建 `contracts/canonical-api/AGENTS.md` 与 `docs/{architecture,testing-strategy}.md`，明确artifact、生成、校验、发布边界和本地命令但不复制根跨项目架构；同一切片更新root architecture与`docs/README.md`的ownership、Current/Target和导航，以指令source review及全部相对链接可解析为证据。
- [x] 9.3 从当前已验证的 canonical HTTP surface 提取完整 `contracts/canonical-api/openapi.yaml`，使 method/path、稳定唯一 `operationId`、parameters、wire schemas、status、security、Problem Details、description/tag 与 `x-taskpilot-ingress` 都由该 artifact 拥有；以 parser validation和逐 capability source review为证据，不用测试代码再复制完整operation表。
- [x] 9.4 在 contract gate 中拒绝缺失/重复 `operationId`、缺失/未知 ingress、旧 `/desktop/v1/**`、management/Swagger、未实现 surface 和非法/重复 method+path；允许批准的secret-bearing request/response字段声明，但拒绝这些字段的example/default、真实或sentinel secret值及path/query/URL暴露，以每类最小invalid fixture或mutation test失败且合法artifact通过为证据。
- [x] 9.5 建立generation determinism与artifact-boundary检查：同一输入重复生成的规范化结果一致，generated source/manifest只进入`build/`且不被Git跟踪；以contract gate在clean tree重建成功和边界测试为证据。

## 10. 生成并迁移 Core HTTP adapter

- [x] 10.1 在开始Core adapter迁移前同步 `services/core-api/AGENTS.md` 与architecture/responsibilities/testing strategy，以Current/Target明确canonical artifact拥有HTTP contract、Core拥有业务行为与最终授权、generated transport仅限adapter以及runtime docs迁移目标；以指令不再要求维护旧contract source、状态未提前写成Current及全部链接可解析为证据。
- [x] 10.2 用固定的 `kotlin-spring` interface-only配置完成代表性prototype，验证Spring Boot 4、Jackson 3、Bean Validation、bearer JSON、GitHub HTML callback、204、PATCH/DELETE等operation及共享Problem Details；以generated source inspection、compile和focused HTTP integration为证据，若不能表达批准contract则暂停并更新Change。
- [x] 10.3 构建期从canonical artifact生成Spring HTTP interfaces、wire models和validation metadata，按capability让手写Core adapters实现生成接口并显式映射既有application commands/results；以contract signature变化导致未同步adapter编译失败、同步后focused HTTP tests通过为证据。
- [x] 10.4 扩展Core架构规则，禁止application/domain/persistence/repository依赖generated transport package，并验证Gateway runtime classpath不包含Core adapter artifact；以扫描非空production classes和build-contract tests为证据。
- [x] 10.5 在全部adapter迁移并转绿后删除Controller中的平行method/path来源、`OpenApiConfiguration`中的手工operation auth/response/description maps及测试中的完整operation期望表；保留focused behavior assertions，以source scan、compile和Core contract tests为证据。
- [x] 10.6 串行运行Core focused与完整质量门，并将Core owner文档中的Target状态收敛为已验证的Current；确认短路径ownership授权、session/OAuth、Project/Board lifecycle、Work Item version、idempotency、transaction和Problem Details语义不变，记录实际命令与结果，不以generator compile替代业务/infrastructure evidence。

## 11. 生成并迁移 Gateway route manifest

- [x] 11.1 在开始Gateway manifest迁移前同步 `services/gateway/AGENTS.md` 与architecture/responsibilities/testing strategy，以Current/Target明确generated manifest是唯一route catalog目标且不再要求与Core手工双向同步，同时保留fail-closed、无catch-all和transport policy责任；以指令不再要求新增旧手写catalog、状态未提前写成Current及全部链接可解析为证据。
- [x] 11.2 从canonical artifact构建只包含批准ingress operation的method/path/operationId manifest，`none`不进入public route，provider callback保持显式分类；以manifest projection与artifact operation集合双向相等测试为证据。
- [x] 11.3 将manifest作为独立生成资源交付Gateway并严格加载为单一immutable catalog，使`RouteConfig`与`TransportPolicyFilter`注入同一实例；缺失、空、重复或非法manifest必须启动失败，且不得引入Core production/MVC依赖。
- [x] 11.4 迁移route integration tests到generated manifest，验证approved route保持path/query/body，wrong method、unknown、legacy、`none`、Swagger和management请求fail closed且不到达stub；运行时Core `/v3/api-docs`可用性或额外mapping不得改变Gateway route。
- [x] 11.5 在manifest消费与transport tests全部通过后删除手写`RouteCatalog.routes`及任何配置文件中的平行canonical method/path列表，并将Gateway owner文档中的Target状态收敛为已验证的Current；以source scan、Gateway build-contract和`./gradlew --no-daemon :services:gateway:qualityCheck`为证据，不保留catch-all、fallback或runtime discovery。

## 12. 统一 runtime docs 与 contract gates

- [x] 12.1 将contract build已校验的canonical artifact作为只读资源打包给Core，使Local/Test `/v3/api-docs`直接解析并序列化该artifact的JSON表示，Swagger只消费该endpoint；删除运行时mapping discovery及从生成接口、Controller annotations/custom maps重建契约的路径，Production Core继续关闭文档且Gateway不代理文档或management endpoint。
- [x] 12.2 增加normalized semantic equality test，比对source与served docs的paths、operations、components、security、responses、descriptions、tags和TaskPilot extensions，忽略键顺序/排版但不忽略契约语义；以Core OpenAPI integration通过为证据。
- [x] 12.3 将contract `qualityCheck`接入Core/Gateway compile与质量门依赖，验证contract变更先完成validation/generation且无需启动服务；以Gradle task dependency inspection和clean build为证据。
- [x] 12.4 清除由Controller annotations、Core测试表、Gateway测试表或运行时discovery形成的第二份完整contract source，同时保留单行为负例和业务回归测试；以source/architecture scan与owner review为证据。

## 13. 更新构建、提交门与 owner 文档

- [x] 13.1 更新`pnpm check`和Git staged-path矩阵：`contracts/canonical-api/**`各选择contract、Core、Gateway gate一次，root Gradle/version catalog/wrapper选择三个JVM边界，纯文档与未知路径保持既有免测/fail-closed语义；以`pnpm hooks:test`、selection tests和实际输出为证据。
- [x] 13.2 对group 9–11已同步的root/contract/Core/Gateway owner文档做跨项目一致性对账，并更新README及仍需收敛的`docs/README.md`导航和Current/Target状态；不得到此任务才首次修正指导前序实现的AGENTS或child owner规则，以链接检查和逐项source review为证据。
- [x] 13.3 同步Desktop与开发工具中受contract-first修正影响的命令/诊断说明，但不改Renderer UI或增加客户端SDK；以Desktop/Main、dev tests和文档ownership review为证据。

## 14. 最终验证与模型/文档对账

- [x] 14.1 串行运行 `:contracts:canonical-api:qualityCheck`、`:services:core-api:qualityCheck`、`:services:gateway:qualityCheck`、Desktop `qualityCheck`、`pnpm dev:test`、`pnpm hooks:test`和`pnpm dev:smoke`，逐项记录实际结果；不得把未执行或零匹配测试记为通过。
- [x] 14.2 运行 `pnpm --filter @taskpilot/desktop test:system`，验证compiled Desktop只能经Gateway完成登录/current-user和Project→Board→Work Item journey，并在Gateway停止/Core断开时稳定失败且无直连fallback。
- [x] 14.3 比对business model、main/delta specs、canonical artifact、generated boundary、Core adapters、Gateway manifest、migrations、tests和运行证据；若模型事实不变，记录`docs/business-model.md`无需修改的理由，否则暂停并更新/重新批准Change。
  - **Apply evidence:** canonical artifact含30个唯一operation（29 canonical、1 provider-callback），generated manifest与全部批准ingress operation双向相等；generated transport import仅位于Core `..api..` packages；数据库仍只有`V1__initialize_taskpilot.sql`且本Change无migration diff。实现只改变HTTP representation、ingress和build ownership，不改变身份、ownership/cardinality、lifecycle、business invariant、authorization、version/idempotency、recovery或持久化事实，因此`docs/business-model.md`无需修改。
- [x] 14.4 串行运行 `pnpm check`、`openspec schema validate taskpilot-sdd --verbose`、`openspec validate establish-canonical-resource-api-and-gateway --strict --no-interactive`、`openspec validate --all --strict --no-interactive`、全仓 `git diff --check`、未跟踪artifact whitespace/link检查并完成implementation self-review；停在独立code review和manual acceptance gate，不sync、不archive、不stage、不commit。
