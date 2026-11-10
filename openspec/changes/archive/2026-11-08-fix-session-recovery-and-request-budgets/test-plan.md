# Test Plan

## Scope and Risk

**Status: Approved verification plan; implementation checks executed.** 本文件保留批准的检查计划；实际命令/结果与未执行的手工/平台证据见 [tasks.md](tasks.md)，不将计划当作通过证明。

C1 涉及 secret-bearing HTTP contract、Redis 原子撤销和 Main 清理竞争，为高安全/一致性风险；漏修会让退出后的 refresh 继续登录或旧结果污染新账号。C2 涉及 IPC/HTTP bytes 与业务文本长度两种独立边界，为兼容性/资源风险；漏修会拒绝合法输入，或因盲目放大/仅信任 Content-Length 允许无界读取。C3 涉及 Main credential-consumption 生命周期和 Renderer recovery，为并发/恢复风险；漏修会再次消费 refresh、触发 replay 撤销，或让 Retry 没有作用。

不测试/实现新业务对象、数据库迁移、授权 redesign、refresh recovery 协议、自动重试、持久 logout queue、Gateway policy 调整和 UI redesign。C4/D1/D2 保留既有修复，不重复扩展其范围。Business Model 的 unchanged rules 与本 Change 的 session invariants 必须逐项回查，测试通过不能代替语义审计。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| logout 两模式、security OR、状态码、me/refresh unchanged | canonical contract/build | 扩展 ContractToolTest，检查 stable operation、optional strict LogoutRequest、extension/description、400/401/503 和 secret hygiene；生成 sources/manifest 不被 tracked | 捕获 wire/projection 漂移，不复制业务实现 |
| 无 body/{} legacy、refresh body、双凭据、null/unknown/type/length 错误 | real Core HTTP + adapter branch | AuthenticationHttpIntegrationTest 穿过真实 filter/Jackson/generated adapter，矩阵覆盖 204/400/401/503；AuthenticationApiBranchTest 只补必要 parser/error branches；拒绝无撤销副作用 | nullable generated 参数不能独立证明 absent/null 区分，mock controller 不能发现 filter/binding 绕过 |
| 未命中/已撤销/过期合法 token 幂等，Redis 故障不虚报成功 | Redis integration + real HTTP status | SessionUseCasesIntegrationTest 检查 state/keys；真实 HTTP 检查 204/503 Problem Details，锁定 logout Redis 失败 code 为 TEMPORARILY_UNAVAILABLE（沿用当前通用 handler），缺失/malformed bearer 为401 | 分别证明真实撤销语义和 transport projection |
| access expiry 后 refresh logout | real Redis | 实际 expire access key，refresh/session 保留，logout 后 refresh 失败；并证明其他 session 仍有效 | 注入 Clock 不等价于 Redis key expiry |
| rotate→logout、logout→rotate、多轮 rotate 的 used marker | real Redis | 在两种串行顺序下验证 pair/session 消失；并发执行不依赖 sleep 断言最终无有效凭据；检查 absolute TTL 不延长、tombstone 自然到期 | 原子性必须由真实 Lua/Redis 验证，不用 in-memory 假实现证明 |
| used replay/response-lost/current-user 等原 scenarios 不退化 | existing Redis/session regression | 保留旧 tests，补必要 marker corruption/expiry；旧 access 方式仍可用但 expired bearer 仍旧限制 | 证明修复没有弱化既有 replay fail-closed |
| Main logout 不 refresh，body 无 bearer/secret 不泄漏 | Main composition | composition.test.ts 断言 logout route/body/headers、legacy fallback 仅 store read failure、revokeIssued 的 refresh-mode cleanup | 捕获 Main-to-HTTP mapping 和 secret boundary，不再复测 Lua |
| logout generation-first，旧slot清理→新save顺序，store failure/offline | Main session unit with deferred fakes | session-coordinator.test.ts 在 load/save/clear/HTTP各阶段插入 logout/new establish；检查 UI立即 signedOut、最后新账号 credential 不被清除、storage error可观察、远程失败 best-effort | 最低确定性层可控制所有 async 时间窗，不靠睡眠/真实OS做竞争测试 |
| 两个退出入口在 signedOut 后仍可见存储错误，旧错误不污染新登录 | Renderer integration + safe IPC error projection | auth-experience.test.tsx 从账号菜单/Project加载失败页调用App-owned退出回调；deferred logout先发送signedOut并卸载ProjectHome，再拒绝CREDENTIAL_STORAGE_UNAVAILABLE，验证登录页双语role=alert、安全提示、无unhandled rejection；覆盖成功无提示、offline+clear失败、新登录意图/新authenticated（含同一User）/api切换/App卸载后旧catch/finally不写状态；ipc-errors保留安全code无秘密 | Main unit的rejection可观察不等于用户可见；必须穿过状态订阅、子页面卸载与App错误拥有权 |
| startup/Retry/protected refresh single-flight | Main session + bootstrap integration | 同 generation 并发只一次 load/refresh/save，所有调用 join；旧 flight finally 不清新 slot，旧 flight 不阻塞新 generation；bootstrap.test.ts 证明启动也走同 owner，federated recovery未完成期间logout/new establish使迟到startup restore不再启动 | 捕获协调而不是只检查按钮调用次数 |
| late load/error/save/result fencing与401/保存失败 | Main session unit | load 后 superseded 不发 HTTP；late issued cleanup 不改新账号；temporary preserve、401清理、清理失败、保存失败的状态/凭据断言；无未处理 rejection | 防止只测成功恢复而漏掉异步旧错误清理新凭据 |
| getSessionView 只读；authenticated/signedOut retry no-op | Main session/composition | spy store/refresh 零调用，return safe SessionView；restoring joins flight | 证明新入口不引入隐藏认证副作用 |
| retry narrow capability、sender/schema/owner、safe返回值 | Main IPC/Preload/architecture | ipc-contract/validation/errors、preload-api 和 architecture tests；无参数、固定channel、错误sender拒绝，结果/日志不含token | 新 capability 是直接 trust boundary，不能由Renderer mock替代 |
| Retry调用Main、不reload、pending/accessibility/error/unmount | Renderer integration | auth-experience.test.tsx 触发 unavailable→retry→恢复；验证 disabled/role=status、双击单请求、catch/finally、terminal/temporary view；logout/new-account event先于retry completion时不被旧返回覆盖 | React状态/交互与迟到completion不由Main tests覆盖 |
| 5000 emoji 和 NFD组合文本 + 最大标题/元数据 | IPC + real Core HTTP | IPC传JS对象；HTTP传UTF-8及全Unicode-escaped JSON；create与SET patch都测，规范化后值正确；旧16384阈值Red复现，完整payload明确计算小于131072 | 两层编码不同，分别检测序列化预算和HTTP原始编码预算 |
| 131072/131073精确边界、无长度、真实chunked | IPC guard + Core filter + real socket HTTP | IPC合法规范化padding对象；filter已知/未知长度限量读且cache可下游复读；真实HTTP发送chunked（Socket或unknown-length BodyPublisher）边界，不能只用MockHttpServletRequest证明chunked | 单元层证明限量读取，真实HTTP层证明transfer framing没绕过；拒绝无业务副作用 |
| transport与产品规则独立，sparse/history兼容 | existing product/HTTP tests | over-limit code-point字段在预算内仍整体拒绝，无截断；历史值可读、未改字段编辑保留；raw超预算但NFC短仍拒绝 | 防止改预算被当成改产品规则；不创建另一套规则 |
| Gateway容纳Core预算、body转发不变、无Core fallback | existing Gateway route/system boundary | RouteIntegrationTest 用stub证明refresh logout body透传、128KiB不提前拒绝；DesktopSystemJourneyTest补selected expired-access logout/retry及大文本真实Gateway hop | 只有跨真实编译/IPC/Gateway/Core路径能发现consumer接线或路由错误，不复制所有低层矩阵 |
| model/doc/contract漂移 | source review + official schema/spec validation | 对照proposal/design/delta与实现、keys、API、实际tests和Current/Target docs；每slice同步owners，保留main spec直到授权sync | 结构验证和测试都不能自动证明所有业务含义一致 |

## Implementation and Verification Approach

### Slice 1: C1 Contract 与 Core refresh logout

直接更新checked-in contract并验证生成/安全声明，不为schema配置制造Red/Green。对明确可自动化的session撤销规则采用Red-Green-Refactor：先以access实际过期与rotation/logout顺序复现，再在原Access owner用原子Lua最小修复，补real HTTP parsing/status矩阵。tests与production行为同组落地，立刻更新Contract/Core owning docs。不开新数据库/通用credential模块。

### Slice 2: C1 Main logout 与 C3 single-flight 恢复

两者共用SessionCoordinator/credential queue，作为一个协调切片避免同owner两套并发机制。对logout/restore/refresh明确行为采用deferred fake Red-Green-Refactor，先复现late load、重复消费与退出/新账号污染，再实现generation/identity fencing。随后直接接shared/preload/channel/Main/Renderer capability，App统一承接账号菜单/加载失败页退出错误并跨signedOut子页卸载显示安全提示，按IPC与React边界检查风险，不把每层都包装成机械TDD。当前视觉语言保持，应用React Skill和最终web-design-guidelines，更新Desktop docs。

### Slice 3: C2 传输预算

在IPC和real HTTP补合法5000-code-point样本的失败回归，再将两常量最小调整为131072。配置/常量不需虚构独立Red阶段；真实observable输入回归须明确。精确/超限/unknown/chunked tests与实现同组，保留既有field/sparse/history assertions；Gateway生产配置不改。更新Core/Desktop及root confirmed contract摘要。

### Slice 4: 跨界整合与语义自查

仅补distinct route/compiler/system风险；Gradle在同checkout串行。执行受影响门禁，不清理他人修改、不编辑generated sources、不跳过断言。所有任务完成后自查实际diff与批准模型/能力、更新实际证据，停在用户安排的独立代码评审与手工验收；不自动archive。

## Verification Commands

以下为批准的Apply命令计划；实际运行结果见tasks.md的Apply Evidence，不以本清单声称通过。根目录命令除特别说明外均从仓库root执行，同checkout所有Gradle命令串行。

### Focused

- `./gradlew --no-daemon :contracts:canonical-api:qualityCheck`：contract每次变化后且consumer编译前必须执行的官方owner gate，含生成/manifest/determinism/artifact边界。
- `./gradlew --no-daemon :services:core-api:test --tests '*SessionUseCasesIntegrationTest' --tests '*AuthenticationHttpIntegrationTest' --tests '*AuthenticationApiBranchTest' --tests '*OpenApiIntegrationTest'`：Redis真实expiry/atomicity与真实HTTP/schema/guard/compatibility；Testcontainers需Docker可用。
- `pnpm --filter @taskpilot/desktop exec vitest run --config vitest.config.ts tests/main/session/session-coordinator.test.ts tests/main/app/bootstrap.test.ts tests/main/app/composition.test.ts tests/main/ipc tests/main/preload-api.test.ts tests/renderer/features/auth/auth-experience.test.tsx`：Main/IPC/Preload/Renderer受影响owner。其他使用AuthCapabilities的fixtures按typecheck补齐，不能用optional capability掩盖缺少接线。
- `pnpm --filter @taskpilot/desktop typecheck`：全部Renderer/Main/system configs；`pnpm --filter @taskpilot/desktop exec eslint <changed-ts-tsx-paths>`：在Desktop cwd将占位符替换为实际改动路径进行定向lint。
- `./gradlew --no-daemon :services:gateway:test --tests '*RouteIntegrationTest'`：manifest consumer与body/budget透传，先读Gateway子文档，不改其生产policy。

### Affected and Cross-Boundary

- `./gradlew --no-daemon :services:core-api:test --tests '*CoreApiArchitectureTest' --tests '*AccessModuleTest' --tests '*CoreApiApplicationSmokeTest'`：ArchUnit/Access Modulith实际production boundaries，generated types不得进入application/persistence。
- `pnpm --filter @taskpilot/desktop test:architecture`：固定capability、dependency和禁止Renderer直连/秘密暴露。
- `./gradlew --no-daemon :services:core-api:qualityCheck`：受影响Core gate含contract、tests、Kover、lint/build/module checks；不以focused结果替代该API/security改动的交付门禁。
- `./gradlew --no-daemon :services:gateway:qualityCheck`：若补route integration测试，执行该owner的affected gate；无新增productionGateway behavior。
- `pnpm --filter @taskpilot/desktop qualityCheck`：最终portable Desktop门禁，包含type/lint/main/renderer/architecture/coverage/build；开发中以focused循环，不重复全量。
- `pnpm --filter @taskpilot/desktop test:system`：编译Main/IPC/Preload经真实packaged Gateway至Core/PostgreSQL/Redis，证明selected场景和无Core fallback；不等于packaged Electron/native。
- `pnpm --filter @taskpilot/desktop test:e2e`：只在新增/更新现有Cypress恢复交互旅程时执行，headless Electron不打开GUI，不重复低层矩阵。
- `pnpm --filter @taskpilot/desktop test:packaged-native`：当前host的packaged产物与native credential lifecycle，不能代表另一OS。
- `openspec schema validate taskpilot-sdd --verbose`、`openspec validate fix-session-recovery-and-request-budgets --strict --no-interactive`、`openspec validate --all --strict --no-interactive`、`git diff --check`：本轮planning与后续reconciliation结构检查，不能作为implementation正确性证明。

## Manual Evidence and Automation Gaps

- **Owner：用户/发布负责人；当前host packaged Electron验收。** portable/jsdom无法证明真实Chromium恢复界面的focus/pending、Preload/native wiring、离线到恢复及OS credential错误可观察性。按Desktop测试策略在packaged应用验证闲置access过期后退出、临时断网恢复点击Retry和存储故障提示（两个退出入口切到登录页后仍有可访问双语反馈，说明清理未确认和重启风险；新登录开始后旧错误不得出现），记录host/version/结果。若另一OS不可用，明确留作其release gate，不声称已完成。
- **Owner：部署/发布负责人；edge/Gateway配置与rollout。** 仓库无production deployment，自动化无法证明真实edge的budget与先Core后Desktop发布顺序。验收确认128KiB body被容纳、旧客户端兼容、Core非公开入口；实际配置/网络证据决定发布，不新增deploy脚本/项目。
- 不要求为本修复重新手验真实GitHub OAuth、签名/安装器等未改变行为；现有平台release matrix仍适用。手工验收不写成tasks.md自动完成checkbox，本次planning没有任何上述手工通过证据。
