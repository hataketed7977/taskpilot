# Tasks

**Status: Archived; implementation complete; main specs synced.**
用户先授权“开始apply”，并于2026-11-08明确授权“archive吧”。下面21项实施/自动验证工作已完成；勾选不表示独立评审、手工验收或发布已完成。批准依据为本Change的proposal、两个delta specs、design和test-plan；各编号组遵循root architecture与对应子项目testing strategy。主规范已同步，已通过官方命令归档至`openspec/changes/archive/2026-11-08-fix-session-recovery-and-request-budgets/`，未stage/commit。

## 1. C1 Contract 与 Core 原子 refresh logout

- [x] 1.1 直接扩展checked-in `openapi.yaml` 的原logout operation：optional strict LogoutRequest、双模式extension/security/description、400/401/503；更新ContractToolTest并在必要时局部扩充既有validator。证据：`./gradlew --no-daemon :contracts:canonical-api:qualityCheck`通过，method/path/operationId及me/refresh unchanged，generated sources/manifest仅在build且未tracked。
- [x] 1.2 **Red：**在SessionUseCasesIntegrationTest以真实Redis的access key实际expiry、logout/rotate双序和used marker定位复现缺陷；测试失败必须来自未撤销有效session而非编译/容器故障。证据：`./gradlew --no-daemon :services:core-api:test --tests '*SessionUseCasesIntegrationTest'`的目标断言失败记录，保留原replay/current-user/TTL assertions。
- [x] 1.3 **Green：**在手写SessionUseCases/RedisSessionUseCases增加refresh credential撤销，原子解析active/used marker并删除当前pair/session，保持legacy bearer、TTL和其他session隔离；在AuthenticationController局部处理body presence/strict shape并映射generated request，通用bearer filter跳过精确logout operation由adapter独立认证。证据：同一Redis focused命令通过且无GET/revoke竞争窗，generated types未进入application/persistence。
- [x] 1.4 **Refactor与HTTP证据：**完善AuthenticationHttpIntegrationTest/AuthenticationApiBranchTest/OpenApiIntegrationTest的absent/{}、refresh、双凭据、null/unknown/type/empty/length、204幂等/401/400/503矩阵，含真实filter chain、generated binding及拒绝无副作用；仅必要局部整理，不弱化断言。证据：test-plan Focused的Core命令通过，marker/session corruption及Redis unavailable fail closed；logout Redis故障锁定503 TEMPORARILY_UNAVAILABLE，沿用通用handler，不新增专用映射或改其他端点错误码。
- [x] 1.5 在本切片更新Contract architecture/testing、Core architecture/responsibilities/testing和root architecture的logout确认摘要，记录secret隔离及旧bearer过期仍有旧限制。证据：source/API/test与docs逐项对照，Current仅标已实现部分；`git diff --check`、contract qualityCheck及Core focused通过。

## 2. C1 Main logout 与 C3 显式 single-flight 恢复

- [x] 2.1 **Red：**在session-coordinator.test.ts通过deferred store/HTTP fakes复现logout晚读凭据、restore/refresh重复消费、late success/error/save污染及旧finally清新flight；加入退出后新establish、store失败、response-lost replay用例。证据：test-plan Desktop focused命令的session目标断言失败记录，失败不是类型接线/环境原因。
- [x] 2.2 **Green：**在原SessionCoordinator统一每generation load→rotate→save→publish flight，generation在load前capture、identity-safe finally、新generation不被旧flight阻塞；generation-first logout同步登记旧slot cleanup、refresh优先撤销及revokeIssued cleanup，错误分支按design状态处理。证据：session-coordinator focused tests通过，旧load不消费、旧cleanup不清新账号、temporary保留/401清理/保存失败无authenticated，未引入新owner/service。
- [x] 2.3 **Refactor与启动接线：**在composition.ts接refresh-body logout无bearer、不先refresh和store读失败的legacy fallback；bootstrap既有federated recovery后startup意图受generation fence。证据：composition.test.ts/bootstrap.test.ts通过，覆盖等待federated restore时logout/new establish、offline best-effort和迟到issued清理，原API allowlist/no-Core-fallback维持。
- [x] 2.4 直接在shared AuthCapabilities、Preload、CHANNELS/schema/owner注册和Main composition加入无参数`auth.retrySessionRestore(): Promise<SessionView>`，保持getSessionView只读及authenticated/signedOut retry no-op，更新所有typed fixtures。证据：ipc-contract/validation/errors、preload-api tests、Desktop typecheck/test:architecture通过；错误sender/参数在owner副作用前拒绝，safe返回值无秘密。
- [x] 2.5 按React Skill在App将Retry由reload改为窄capability，并以App-owned退出回调统一承接账号菜单/Project加载失败页两个入口；signedOut后的登录页显示CREDENTIAL_STORAGE_UNAVAILABLE双语安全role=alert，说明本地清理未确认和重启风险，不只吞异常。保留原视觉语言、pending/accessibility、catch/finally和卸载/旧operation fencing，同次退出signedOut不取消错误反馈，新登录意图/新authenticated（包括同一User）清提示并使旧操作失效；subscription仍为session状态权威。证据：auth-experience.test.tsx覆盖两个入口先signedOut卸载子页再reject、offline+clear失败、成功无提示、新登录/api切换/App卸载后旧catch/finally不写状态，以及Retry恢复/临时/terminal、重复点击、late返回、不reload与无unhandled rejection；最终web-design-guidelines检查和定向ESLint通过。
- [x] 2.6 在本切片更新Desktop architecture/responsibilities/testing和root architecture协调摘要；明确秘密/状态仍Main owns，窄capability与startup/restore/refresh共用flight，logout不等待旧网络结果。证据：test-plan Desktop focused/typecheck/test:architecture及`git diff --check`通过，Current/Target对照实际code/test，不改变业务词汇/生命周期。

## 3. C2 独立有界的 128 KiB 传输预算

- [x] 3.1 在IPC/真实Core HTTP补完整WorkItem create与SET edit payload回归：5000 emoji、5000 NFC字符的NFD输入、最大160-code-point title及UUID/scope/version/patch metadata，HTTP另测全Unicode-escaped JSON。证据：serialize字节数明确小于131072，旧16384预算因合法body误拒的失败记录；不制造配置文件专属Red阶段。
- [x] 3.2 将main/ipc与Core request guard两个局部预算调整为131072，保留Content-Length快速拒绝、budget+1限量读、缓存下游读取和现有413/IPC错误映射；不改Gateway默认1MiB、不新增共享package。证据：上一任务回归通过，代表性完整raw/escaped payload被接受且正常规范化保存。
- [x] 3.3 同切片补精确131072/131073、已知/未知length和真实chunked tests；构造schema合法且trim后合法padding来区分bytes与field policy，断言超限无业务副作用、cached body可解析。证据：IPC validation及Core HTTP/filter focused命令通过，真实chunked不是仅MockHttpServletRequest。
- [x] 3.4 保留/补充预算内字段超限整体拒绝、无截断、历史响应与未改字段sparse edit兼容回归；更新Desktop/Core预算和testing docs及root跨层摘要。证据：Core/IPC focused结果与Current产品text policy逐项对照、`git diff --check`，数据库capacity/response schema/产品限制未改。

## 4. 跨界验证与 Model and Documentation Reconciliation

- [x] 4.1 在既有Gateway RouteIntegrationTest仅补refresh logout body透传与容纳128KiB边界的distinct风险，不引入Gateway业务fixture或改生产policy。证据：`./gradlew --no-daemon :services:gateway:test --tests '*RouteIntegrationTest'`与该owner qualityCheck通过，manifest operation surface unchanged；若本切片新增持续测试职责，同步Gateway testing策略。
- [x] 4.2 在既有DesktopSystemJourneyTest补selected expired-access logout、temporarilyUnavailable显式retry和大文本真实Gateway hop，复用现有test-only doubles/real Redis/PostgreSQL，无新production测试endpoint。证据：`pnpm --filter @taskpilot/desktop test:system`通过且Desktop无Core直连fallback；在本切片Desktop testing-strategy记录实际新增系统覆盖。
- [x] 4.3 串行执行test-plan Affected门禁：contract qualityCheck、Core architecture/Access Modulith与qualityCheck、Gateway affected qualityCheck、Desktop portable qualityCheck/必要headless Cypress与当前host packaged-native；复用同一有效diff的结果不重复全量。证据：逐项实际命令/结果，覆盖按owner策略；任何未执行的门禁明确记录，不以focused代替必须门禁。
- [x] 4.4 对照批准模型与实际code、Redis key/TTL、HTTP/IPC contracts、tests和operational evidence审计C1/C2/C3 invariants及错误/竞争路径。证据：自查实际diff无material drift；无新增业务表/身份/关系/授权、无generated类型泄漏，所有发现修正并重跑受影响检查；如发现会改变批准行为的决策，暂停该slice重新更新/审批planning，不静默改code。
- [x] 4.5 复核各slice已更新的owning docs，协调Current/Target及跨层摘要；business-model无需新规则的理由是已有Current文本policy和既有退出/轮换/secret规则未变，docs map所有权未变则无需新增导航。证据：每个proposal Documentation Impact owner有更新或证据化无需更新理由，delta对实际API/状态/预算一致；确认未来sync readiness但不修改main specs。
- [x] 4.6 运行`openspec schema validate taskpilot-sdd --verbose`、本Change/all strict validation及`git diff --check`；输出实际验证、自查与剩余风险，保持Change active停在独立代码评审交接。证据：官方验证结果、实际diff与任务状态一致；不执行stage/commit、sync/archive，不自动安排独立reviewer。


## Apply Evidence — 2026-11-08

### Red / Green

| Slice | 实际失败证据 | 实际修复与通过证据 |
| --- | --- | --- |
| C1 Core | `SessionUseCasesIntegrationTest` 的实际access-index expiry后撤销断言失败（4 tests / 1 failed），不是编译/容器错误；本机日志 `/tmp/taskpilot-core-red.log` | refresh Lua原子撤销；同一Redis focused suite通过（`/tmp/taskpilot-core-green.log`）；最终四个Core focused suites通过，含rotate/logout双序、used定位最新pair、TTL/隔离、HTTP凭据与shape矩阵、Redis503及拒绝无副作用 |
| C1/C3 Main | deferred load 下restore/refresh调用两次、logout后旧恢复发布restoring，两条断言失败（`/tmp/taskpilot-session-red.log`） | shared whole-flight、generation/identity fencing、queued old-slot cleanup；portable gate通过；自查再补save pending期间restore/refresh/Retry join及response-lost后显式Retry terminal replay拒绝，最终session suite 27 tests通过（`/tmp/taskpilot-session-final.log`） |
| C2 | 合法完整Unicode body及exact128KiB因旧16KiB guard误拒，IPC与真实HTTP目标断言失败（`/tmp/taskpilot-budget-red.log`、`/tmp/taskpilot-http-budget-red.log`） | 两个局部131072预算、bounded/cache读保持；raw/escaped create/SET edit、known/chunked exact/+1通过；预算内字段超限、sparse edit/history旧回归仍通过 |

Red阶段采用代表性行为回归；其余竞争/边界矩阵在Green/refactor阶段补齐，不声称每条新增用例均单独经历Red。日志路径为当前机器临时证据，持续回归以仓库测试源码为准。

### 实际自动门禁

- `./gradlew --no-daemon :contracts:canonical-api:qualityCheck`：通过；系统门禁重新生成并再次通过contract qualityCheck。generated代码/manifest仍仅在build，不tracked。
- `./gradlew --no-daemon :services:core-api:qualityCheck :services:gateway:qualityCheck`：通过（`/tmp/taskpilot-services-quality2.log`），包含全部Core/Gateway tests、Core ArchUnit/Access Modulith、lint/Detekt/Kover、contract及build。
- `./gradlew --no-daemon :services:core-api:test --tests '*SessionUseCasesIntegrationTest' --tests '*AuthenticationHttpIntegrationTest' --tests '*AuthenticationApiBranchTest' --tests '*OpenApiIntegrationTest'`：最终通过（`/tmp/taskpilot-core-final-focused.log`）；包含自查新增trailing JSON拒绝用例，不以结构验证替代真实HTTP。
- `pnpm --filter @taskpilot/desktop qualityCheck`：通过（`/tmp/taskpilot-desktop-quality3.log`）；Main166、Renderer180、architecture10，coverage汇总356，全部type/lint/build通过。此后只增加两条Main测试并重跑session27、定向ESLint及Main TypeScript；无后续production TS改动，复用portable结果，不重复全量。
- `pnpm --filter @taskpilot/desktop exec cypress run --component --spec cypress/component/auth.cy.tsx`：11通过（`/tmp/taskpilot-auth-cypress.log`）；真实headless Electron中Retry pending/disabled、subscription authority、双语alert/focus/dismiss通过。已实际查看中英文截图，沿用既有扁平error视觉；web-design-guidelines对本次改动的最终检查无material问题。
- `pnpm --filter @taskpilot/desktop test:system`：通过（`/tmp/taskpilot-system-green2.log`）；compiled Main/IPC/Preload经真实Gateway到Core/Redis/PostgreSQL，包含显式Retry、实际access index expiry后logout、大Unicode create/SET edit及Gateway/Core不可用时无fallback。初跑两个旅程共用localhost累计触发既有限流；现分进程执行selected旅程并仅在两者之间删除测试容器的rate counter，保留所有session/业务数据和生产限流规则。
- `pnpm --filter @taskpilot/desktop test:packaged-native`：当前macOS arm64通过（`/tmp/taskpilot-packaged-native.log`），packaged native module真实write/fresh-process restore/rotate/delete通过。未获得Developer ID签名，非签名/安装器发布验收。
- 自查后Kotlin测试变更运行 `./gradlew --no-daemon :services:core-api:ktlintCheck :services:core-api:detekt`：通过；再补CountDownLatch起跑的真实Redis concurrent rotate/logout，用 `./gradlew --no-daemon :services:core-api:test --tests '*SessionUseCasesIntegrationTest' :services:core-api:ktlintCheck :services:core-api:detekt` 验证通过（`/tmp/taskpilot-redis-final-concurrent.log`），不依赖sleep决定竞争结果；Gradle全程串行。
- `pnpm exec openspec schema validate taskpilot-sdd --verbose`、本Change strict和all strict：通过（all 14/14）；`git diff --check`通过。任务更新后再次执行官方校验。

### Actual Diff Self-review / Model and Documentation Audit

- Review target：base `454576eda95d20dd43219561c8a9d814d18d0492` → 当前working tree的本Change C1/C2/C3 diff。in scope为logout HTTP/Redis/Main、restore/Retry及IPC/Renderer、独立body预算、直接受影响tests/owner docs。未把五项前序C4/D1/D2变更（Desktop AGENTS、loopback及其tests、docs map、business-model）当作本Change实施，保留而不覆盖；无stage/commit。
- 已逐项核对批准不变量：Lua单Redis linearization point；active digest/expiry校验；used marker保留原absolute TTL并定位current pair；其他session不受影响；严格双凭据拒绝；无新业务表/tenant授权/身份关系；Main安全保存先于authenticated，temporary保留、terminal清理、save failure同slot清理；old-slot logout先于new save，旧generation/finalizer不污染新账号；Retry返回值不写session；request budget精确有界且字段policy不变。自查无未修复blocking finding；不是独立review结论。
- 已更新root architecture、Contract architecture/testing、Core architecture/responsibilities/testing、Desktop architecture/responsibilities/testing及Gateway testing。Core/Contract明确legacy bearer在access-index expiry后仍不能定位session；refresh模式才修复该限制。无新增engineering document或所有权变化，docs map不需额外更新；business-model既有身份/关系/生命周期/text规则不变，无新增模型章节。未把其他Target转为Current、未修改main specs。
- Delta/design与实际method/path/operationId、128KiB独立预算、secret boundary/错误状态/竞争路径一致。规划中的“Current缺陷”是Apply前基线，非最终运行现状；稳定Current结论已反馈到上述owning docs。计划行为没有因夹具修正而变化，无需新增Change或设计决策。

### 未执行 / 人工与发布交接

- 独立code review：等待用户安排；不自动启动reviewer。
- 当前host packaged Electron真人交互验收：退出access过期session、断网后Retry、两个退出入口存储故障反馈/键盘焦点、重新登录清旧提示仍待用户/发布负责人执行；headless截图/native脚本不替代这些证据。
- Windows packaged/native与平台手工验收未执行，留作Windows release gate。
- 生产Gateway/edge 128KiB容纳、Core网络隔离、Core先Desktop后发布（回滚反序）未验证，属于部署/发布负责人门禁。
- Apply阶段保持active、未sync/archive；后续归档授权不代表上述独立review或人工/发布证据已通过。本次仍不stage/commit、不更新个人memory。

## Archive Model and Documentation Feedback Audit（2026-11-08）

- 按用户“archive吧”的独立授权完成归档前审计。重新对照当前implementation/source pointers、approved delta与root business-model/architecture及受影响子项目owner docs：没有新增身份、关系、业务生命周期、字段规则或持久化模型，session仍为Redis技术状态；无额外模型漂移或迁移决策。
- 已实现的双模式logout、原子撤销与generation/single-flight、App-owned错误反馈和独立131072-byte预算已在Apply切片反馈给现有owner docs；Gateway默认1MiB保持不变。没有新增engineering文档或所有权变化，docs map无需额外变更；前序C4/D1/D2文件原样保留。
- 已将canonical-resource-api与desktop-authentication各1条MODIFIED和1条ADDED requirement同步到main specs；逐capability复核全部delta文本/场景一致，未触及requirements和原有存活scenarios完整保留。主规范仅保留单一Requirements区段。
- 本轮`pnpm exec openspec validate --specs --strict --no-interactive`通过（13/13）；未重跑Apply阶段的产品自动门禁，上述日志明确为Apply证据。归档不把计划、自动测试或用户授权转换为独立评审、真人验收、Windows或生产部署证据；这些未验证项继续保留。
- 官方`openspec archive fix-session-recovery-and-request-budgets --skip-specs --yes --json`已完成；`--skip-specs`仅避免重复同步，本轮inline sync及逐能力复核已先完成。归档后调整本目录内的跨层相对文档链接，保留批准行为与历史证据。
- 归档后`pnpm exec openspec schema validate taskpilot-sdd --verbose`与`pnpm exec openspec validate --all --strict --no-interactive`通过（13/13 main specs，0失败，仅长requirement INFO）；`openspec list --json`确认active changes为空。再次核对归档delta与main specs、相对链接、`.openspec.yaml`保留及前序五文件未变；`git diff --check`通过，Git index为空。
