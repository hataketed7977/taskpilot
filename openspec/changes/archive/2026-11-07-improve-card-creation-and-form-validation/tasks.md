# Tasks

## 1. Canonical 文本与稀疏 mutation 契约

- [x] 1.1 **Red：**先盘点当前生成的 `@Size`、`@Pattern`、数值与嵌套 validation，形成逐项 Jackson/Core owner 和 real-HTTP 回归清单，并在本任务先补齐清单中缺失的 focused HTTP regression；再扩展 `ContractToolTest`，解析注册、Project、Board、Column、Work Item 的 create/edit write schema，断言精确产品上限、required/optional、optional name/title、1000/5000 description patch 与 `AssigneePatch` action/value 关系、所有 optional-but-non-null mutation property 为 non-null、Problem Details path、create assignee 和 response 未收紧。增加 generated-source 断言，要求 Kotlin/Spring projection 不含 Jakarta Bean Validation import/annotation，并要求 optional name/title、patch property 及可省略 patch value 生成参数级 Jackson null-fail annotation；运行 focused contract test 并确认当前 contract/generator 按预期失败。
- [x] 1.2 **Green：**修改唯一 checked-in `contracts/canonical-api/openapi.yaml`，为 Project/Board 与 Work Item 编辑描述建立同构但分别限制 1000/5000 的 SET/CLEAR patch schemas；对 edit request 与 patch envelope 中所有 optional-but-non-null property，通过 generator 已支持的 property-level extra annotation 生成全限定名 Jackson `@param:JsonSetter(nulls = Nulls.FAIL)`，让显式 null 在 binding 失败，同时保留 schema `minLength/maxLength` 文档。仅在 1.1 盘点缺口已补齐 owner/回归并通过后，关闭 generated Kotlin/Spring Bean Validation projection，显式保留实际生效的 `useBeanValidation: false` 并删除冗余 `performBeanValidation` 配置；重新生成 Core model 和 Gateway manifest 到 `build/`，使 1.1 通过且 `git ls-files '*/build/*'` 不出现新生成物；不得加入 custom generator template、新 validator 依赖、第二份 schema、全局 Jackson null 策略或 runtime OpenAPI parser。
- [x] 1.3 **Refactor：**按 1.1 清单比较变更前后生成投影，逐项运行 Jackson/Core real-HTTP 回归，确认被移除的格式、数值和嵌套 validation 均有明确 owner，且配置只保留实际生效并由 generated-source gate 验证的 `useBeanValidation: false`，不残留冗余开关；运行 `./gradlew --no-daemon :contracts:canonical-api:qualityCheck`，并同步 `contracts/canonical-api/docs/architecture.md`、`testing-strategy.md` 中的生成与门禁职责。

## 2. Core 权威文本策略与稀疏编辑

- [x] 2.1 **Red：**为 onboarding、Project、Board、Column、Work Item 增加/扩展 pure/application 与 real-HTTP focused tests，覆盖 trim + NFC、Unicode code-point limit-1/limit/limit+1、组合字符和 supplementary character、空白必填、可空描述、稳定字段 `path`、无截断和失败无部分写入；明确证明恰好 limit 的 supplementary 文本通过 generated Spring binding、limit+1 由 Core 拒绝，并回归 1.1 盘点出的既有结构约束；运行 test-plan 的 focused Core Gradle 命令并确认旧规则/生成校验导致预期失败。
- [x] 2.2 **Green：**在 Core application边界实现按业务字段命名的共享文本策略，替换注册 200、Project 200/2000、Board 120/2000、Column 80、Work Item 300/10000 写入规则为产品上限；保持持久化 column容量和 migration不变，使 2.1 focused tests通过。
- [x] 2.3 **Red：**以 real HTTP binding 和真实 PostgreSQL fixture 加入 Project/Board/Work Item sparse mutation 测试：optional name/title、`descriptionPatch` 与 `assigneePatch` 的 omitted/SET/CLEAR；分别向 optional scalar、patch property、可省略 patch value 提交 raw null，并加入“raw null + 另一有效 mutation”用例，断言请求以稳定 Problem Details 和可映射字段 `path` 整体拒绝而非折叠为 omitted；覆盖非法 action/value 组合、历史超长值只读/不阻塞无关编辑、提交历史字段需收敛、同值或空 mutation不递增 version、只移动不同 Column 是有效 mutation、过期版本与失败全回滚；确认当前全量请求/nullable DTO 映射按预期失败。
- [x] 2.4 **Green：**把生成 wire DTO 的 optional scalar 和显式 patch envelope 映射到 Project、Board、Work Item application mutation；补齐 Jackson binding exception 到共享 Problem Details/字段 `path` 的稳定映射；`DescriptionPatch.SET` 只接受规范化后非空有效值，`CLEAR` 不得携带 value，任何 optional-but-non-null mutation 的 raw null 在进入 adapter 前拒绝且不得成为 omitted 或 clear；仅验证与保存已提交且实际变化的字段，在既有事务/乐观锁边界内判断 no-op，保持 Placement 移动、assignee clear、授权和原子 rollback 语义，使 2.3 focused tests 通过。
- [x] 2.5 **Red-Green：**扩展 Work Item创建幂等与授权集成测试，先证明仅 assignee不同的同 request id载荷冲突、有效当前 Project Member成功、未分配成功、cross-Project/unknown/inactive全部回滚，再把责任人纳入规范化 fingerprint并保持 Board version/Placement原子性；运行 `ProjectWorkApplicationIntegrationTest` 相关 focused测试。
- [x] 2.6 **Refactor：**删除被替代的 DB-capacity magic number与全量更新分支，不改变 capability边界；运行 `./gradlew --no-daemon :services:core-api:qualityCheck`，并同步 `services/core-api/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md` 中 sparse mutation、最终校验和 focused evidence。

## 3. Desktop Main、Preload 与 IPC 边界

- [x] 3.1 **Red：**扩展 Main/IPC consumer tests，覆盖 Project/Board/Work Item 只发送 changed fields、optional name/title、description/assignee patch 的 omitted/SET/CLEAR、typed IPC 不产生 raw null 且拒绝非法组合、空 mutation 拒绝、Work Item create 可选 assignee、历史超长 response 可解析，以及 Problem Details `path` 透传；运行 test-plan 列出的 focused `test:main` 命令并确认失败来自旧 contract。
- [x] 3.2 **Green：**更新 Desktop shared schema、Main client/coordinator、Preload 与 IPC validation/mapping 以匹配生成后的 canonical contract；用户清空描述唯一发送 `descriptionPatch.CLEAR`，不发送 raw null 或空 `SET`；保留 sender/frame/session generation、固定 path/method 和窄 capability 边界，不向 Renderer 暴露 token、URL 或通用 HTTP，使 3.1 focused tests 通过。
- [x] 3.3 **Refactor：**移除旧全量请求和重复 wire shape，补齐 architecture test防止边界回退；运行 `pnpm --filter @taskpilot/desktop test:main` 与 `pnpm --filter @taskpilot/desktop test:architecture`，并在本切片同步 `apps/desktop/docs/architecture.md`、`responsibilities.md` 的 Main/Preload数据流。

## 4. 创建 Work Item 责任人

- [x] 4.1 实现前按顺序阅读并应用 `frontend-design` 与 `vercel-react-best-practices`，记录本切片采用现有 Project Member picker、默认未分配、无新视觉语言和无新依赖的设计约束；以 source review确认没有自动分配 creator或 Agent picker。
- [x] 4.2 **Red：**扩展 Renderer tests，覆盖默认未分配、有效 Project Member选择、候选加载失败仍可未分配提交、无伪造候选、选择/切换/清空使尚未成功的 request id失效、同规范化载荷 retry复用，以及成功后采用权威 assignee；运行 focused `test:renderer`并确认当前创建表单缺少该行为。
- [x] 4.3 **Green：**在现有创建 Card/Work Item表单中复用 Project Member query与详情 picker语义，增加尺寸稳定且可访问的单选责任人字段；把 assignee纳入 draft fingerprint和typed create payload，保留失败说明、输入和重试上下文，使 4.2 tests通过。
- [x] 4.4 **Refactor：**只提取创建/详情实际共享的 member option与picker adapter，不创建 Agent路径或跨项目抽象；运行相关 Main、Renderer和 `pnpm --filter @taskpilot/desktop test:system`旅程，更新 `apps/desktop/docs/testing-strategy.md`中的创建责任人边界证据。

## 5. 当前持久化表单的一致校验体验

- [x] 5.1 **Red：**建立 Renderer pure/component测试，覆盖 NFC/code-point（含组合字符和astral character）、80% threshold、untouched无required错误、blur/submit后空值错误、完整候选值在limit接受且limit+1原子拒绝、选择区替换、delete、undo、整次paste拒绝、IME composition中间态与commit、历史超长值使用会话初始历史 ceiling、已知/未知server path mapping、最后合法draft/focus/context保留和可访问关联；确认当前各表单行为不一致而失败。
- [x] 5.2 **Green：**实现最小共享字段约束元数据、规范化/计数、touched/submitted visibility、完整候选hard-limit decision、Problem Details path mapping与稳定 feedback slot；不依赖HTML `maxlength`承担业务计数，超限候选不进入draft或save/retry状态，不静默截断paste/composition，删除/撤销/修正保持可用，submit不得只以无解释 disabled表达错误，使 pure/component测试通过。
- [x] 5.3 **Red-Green：**逐项迁移并验证当前可达入口：首次注册display name、Project创建/设置、Board创建/编辑、Column创建/编辑、Work Item创建/详情编辑；为每片先加入字段边界、输入法/粘贴和保留草稿测试再接入共享语义。历史超长字段须完整可读、以会话初始权威长度为临时ceiling支持删除/替换/撤销、回到limit内才保存；未收敛草稿切换负责人/其他独立字段时转为明确暂停状态且不提交、不丢失、不阻塞目标操作，无关稀疏保存采用最新version并在字段基线不变时保留草稿，字段基线变化进入conflict。不改搜索/筛选和精确名称删除确认，也不创建不存在的设置页面。
- [x] 5.4 **Red-Green：**扩展 `board.cy.tsx`、`shell.cy.tsx`，先捕获 zh-CN/en、960×640与标准viewport中 normal/near-limit/limit-reached/required-error/pending/paused-invalid的标签、控件顶部和主要操作位移，并验证真实Chromium中超限键入/paste/IME commit保持最后合法草稿、焦点和可修正能力且live status不逐键重复播报；覆盖暂停历史草稿后一次点击进入负责人、负责人保存后恢复草稿仍使用最新version、字段并发变化冲突，以及关闭详情时继续编辑/放弃并关闭门禁；再调整 feedback/counter布局直到几何和a11y断言通过。历史长名称删除确认须能完整输入并精确匹配。
- [x] 5.5 **Refactor：**按 `web-design-guidelines` 对本 Change表单做最终 UI/UX/a11y review，只修复可定位到本 diff的问题；运行 focused Renderer/Cypress及 `pnpm --filter @taskpilot/desktop typecheck`、`lint`，同步 `apps/desktop/docs/design-foundation.md`的表单反馈、计数和稳定布局规范。

## 6. Board 轻量菜单与永久删除 Dialog 边界

- [x] 6.1 **Red：**扩展 Renderer/Cypress测试，覆盖菜单项“删除看板 / Delete board”、外部目标一次 pointer操作即生效、trigger/content/Portal-owned区域不误关、`Escape`关闭并恢复trigger focus、listener卸载，以及打开永久删除Dialog后菜单关闭但Dialog门禁独立；确认旧行为按预期失败。
- [x] 6.2 **Green：**复用 account menu模式实现 owned-root/composed-path capture `pointerdown` dismissal，不调用 `preventDefault`/`stopPropagation`；更新菜单文案，同时保留确认Dialog的永久删除警告、精确完整名称、dirty/pending/cancel/focus规则，使 6.1 tests通过。
- [x] 6.3 **Refactor：**仅在已证明的Desktop轻量浮层范围内提取可复用dismiss/focus语义，不把Dialog纳入同一默认行为；运行 `pnpm --filter @taskpilot/desktop test:renderer` 与 `pnpm --filter @taskpilot/desktop test:e2e`，并同步 `apps/desktop/docs/design-foundation.md`、`testing-strategy.md`的轻量浮层约定和浏览器证据。

## 7. Model and Documentation Reconciliation

- [x] 7.1 对照已批准 proposal/spec/design，比较实现代码、数据库 schema/migration（应无变化）、OpenAPI、生成投影、Core/IPC/Renderer测试和运行证据；确认身份、Project Member单责任人、Card projection、无 lifecycle/status、授权、幂等、版本、历史值和删除语义无漂移，发现差异时先回到 Change artifacts重新批准而非用代码隐藏决策。
- [x] 7.2 把稳定结论反馈给 `docs/business-model.md`、`docs/architecture.md`及各切片已列的 child文档，校准 Current/Target状态；检查 `docs/README.md`导航（若无文档新增/移动则记录无需修改的证据），并确认 main spec delta具备 sync readiness但本任务不自行 sync/archive。
- [x] 7.3 串行运行 `./gradlew --no-daemon :contracts:canonical-api:qualityCheck`、`./gradlew --no-daemon :services:core-api:qualityCheck`，再运行 `pnpm --filter @taskpilot/desktop qualityCheck`、`pnpm --filter @taskpilot/desktop test:e2e`、`pnpm --filter @taskpilot/desktop test:system` 与 `pnpm check`；如门禁重叠仍保留完整真实命令输出，不把未执行项标为完成。
- [x] 7.4 运行 `openspec schema validate taskpilot-sdd --verbose`、`openspec validate --all --strict --no-interactive`、`git diff --check`，source-review全量diff中的秘密、生成物、冲突标记、无关页面/依赖与未声明契约变化，并确认任务台账、测试证据和 test-plan一致后交付独立 code review与手工验收。
