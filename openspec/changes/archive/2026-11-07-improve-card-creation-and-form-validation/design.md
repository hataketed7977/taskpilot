# Design

## Context

动机见 [proposal.md](proposal.md)。当前系统已经有 Work Item 可选 `PROJECT_MEMBER` assignee、Project Member 查询、统一 Problem Details、canonical OpenAPI 生成边界和 Desktop 原位编辑；缺口集中在创建表单未暴露责任人、各层文本上限不一致、编辑请求全量回传文本，以及 Board 轻量菜单没有完整 dismissal 语义。

数据库列仍可容纳 display name 200、Project name 200/description 2000、Board name 120/description 2000、Column name 80、Work Item title 300/description 10000。新产品写入上限小于这些容量，因此无需 schema migration；但历史超长值要求 wire contract 和 application mutation 能区分 omitted、显式空值与实际变化。

实现跨越 checked-in OpenAPI、生成的 Core HTTP 边界、Core application/persistence、Desktop Main/Preload/Renderer 和交互文档。contract、Core 和 Desktop 的测试责任分别遵循各自 `docs/testing-strategy.md`；Gradle 门禁必须串行运行。

## Goals / Non-Goals

**Goals:**

- 让 canonical contract 和 Core 共同拥有一致的产品写入语义，Desktop 提供提前且可理解的反馈，而不是形成 UI-only 规则。
- 在不迁移、不截断历史数据的前提下，使 Project、Board、Work Item 的无关字段编辑继续可用。
- 复用既有 Project Member 与 assignee 模型完成创建时分配，并保持幂等、授权和原子性。
- 把表单反馈和轻量浮层 dismissal 沉淀为 Desktop 内部可复用、可访问且不抖动的行为。

**Non-Goals:**

- 不改变数据库列容量，不批量清洗或截断历史数据。
- 不增加唯一性、Work Item lifecycle/status、Agent assignee、assignment history、成员管理或活动时间线。
- 不改变永久删除 API、非空 Board 拒绝、权限或精确名称确认规则。
- 不创建尚不存在的设置页面，不引入新运行时依赖或跨项目表单框架。

## Business Model

采用关系图检查、字段分类和兼容决策树，而不新增战术 DDD 构件：

- **身份与关系：** `WorkItemId` 仍标识业务事实，Card 仍是以该 ID 表示的 Board Placement；assignee 仍是零或一个当前 Project 的 active Project Member。创建时选人不产生新的 Assignment 实体或历史。
- **状态与不变量：** 无 Work Item lifecycle/status 变化。名称和标题经 trim + NFC 后非空，描述可为空；上限是产品写入不变量，数据库容量不是业务许可。重名继续允许。
- **授权：** Renderer 候选列表只辅助输入；Core 必须在请求 Project scope 内重新校验 actor OWNER 权限、membership 存在性与 active 状态，并沿用 not-found 防枚举语义。
- **版本、历史与并发：** 乐观版本、Board/Placement 原子移动和 request-id 幂等边界保持不变。历史超长值可读；只有请求中出现的字段受新写入上限约束。空 mutation 不创建虚假版本；真正跨 Column 的 Placement move 可单独构成 mutation。
- **失败与恢复：** 候选加载失败不阻止未分配创建；字段错误保留草稿与焦点；责任人失效、版本冲突或任一原子编辑失败都不产生部分写入。菜单外部点击不能吞掉用户原目标，Dialog 仍独立保护脏数据和危险操作。
- **滥用边界：** 客户端校验可被绕过，因此 Core 是最终拒绝点。未来 Web/Mobile/CLI/MCP 复用 canonical contract 和 application use case，不复制不同上限。

稳定业务词汇、所有权和删除语义仍由 `docs/business-model.md` 所有；实现后只反馈本 Change 已确认的产品写入不变量与创建责任人入口。

## Decisions

### 1. OpenAPI 声明 wire 约束，Core 以共享业务策略做最终校验

checked-in `contracts/canonical-api/openapi.yaml` SHALL 声明所有请求字段的 `minLength`/`maxLength`、required/presence 语义和 Problem Details `path`。这些 JSON Schema 长度是 canonical wire 描述，但当前 Kotlin/Jakarta `@Size` 对 `CharSequence` 使用 UTF-16 code unit，与产品的 Unicode code-point 语义不兼容。因此 contract generation SHALL 关闭生成 model 的 Bean Validation 运行时投影，不让 generated HTTP binding 用 `@Size` 提前拒绝合法 supplementary character；不新增自定义 generator template、code-point annotation或运行时 OpenAPI parser。关闭该投影前须先盘点当前生成的 `@Size`、`@Pattern`、数值及嵌套校验，并建立逐项 owner/HTTP 回归清单；只有 Jackson 结构绑定或 Core adapter/application 已明确覆盖对应当前请求约束后，才可关闭该投影；generator 配置 SHALL 显式保留实际生效的 `useBeanValidation: false`，并删除冗余的 `performBeanValidation`。生成源码门禁 SHALL 同时证明 Jakarta Bean Validation import/annotation 不再进入 Kotlin/Spring projection，而 OpenAPI schema 约束仍完整保留。

Core application 层使用一组按业务字段命名的文本策略完成 trim、NFC、code-point 计数与错误路径，不从数据库 column metadata 推断产品限制。生成的 wire model 只留在 HTTP adapter；adapter 将 sparse DTO 映射为 application mutation。Desktop 可在其 typed contracts/Renderer validation 中投影同一数值以即时反馈，但 contract tests 必须比较这些投影与 canonical 值，防止手工漂移；不新增第二份完整 schema。

**替代方案：** 保留 generated `@Size` 会错误拒绝合法 supplementary character；把 OpenAPI 上限翻倍会使契约文档失真；自定义 generator template/validator 会为一类业务语义增加新的生成维护面；只设置 HTML/Renderer `maxLength` 会让 CLI/MCP 绕过；让 Core 运行时解析 OpenAPI 会把 transport 描述耦合进 application 层。均不采用。

**测试边界：** contract semantic tests 固定 schema；generated-source tests 证明 Kotlin/Spring projection 不再包含 Jakarta Bean Validation import/annotation、OpenAPI schema 约束仍保留且 projection 可构建；Core real-HTTP integration tests 以 supplementary character 验证请求可通过 binding 并由 application 按 code point 接受/拒绝，同时回归盘点出的既有结构约束；Desktop contract/Renderer tests 固定投影、错误映射和交互。

### 2. 编辑采用 presence-aware 稀疏 mutation，而非回传完整资源

Project、Board、Work Item edit request 保留 expected version 与必要 scope/Placement 上下文，但可编辑业务字段变为可省略。名称/标题直接使用 optional scalar：omitted 表示不修改，出现则表示 SET，规范化为空按必填规则拒绝。可清空描述使用同构但按字段上限命名的 wire schemas：Project/Board 引用 `DescriptionPatch1000`，Work Item 引用 `DescriptionPatch5000`。两者与既有 `AssigneePatch` 一样采用显式动作 envelope：

- omitted `descriptionPatch`：不修改，也不按新上限验证；
- `{ action: "SET", value: "..." }`：trim + NFC 后必须为 1 至对应描述上限个 code point，再写入；
- `{ action: "CLEAR" }`：必须不携带 `value`，把描述清空；
- raw JSON `null`：schema 保持 non-null；对 edit request 及 patch envelope 中每个 optional-but-non-null 属性（包括 optional name/title、`descriptionPatch`、`assigneePatch` 以及可省略的 patch value），通过 OpenAPI Generator 已支持的 property-level extra annotation 生成全限定名 Jackson `@param:JsonSetter(nulls = Nulls.FAIL)`；省略仍使用 Kotlin 默认值，显式 null 在 HTTP binding 阶段拒绝，且不依赖额外 import 或自定义模板。

Work Item assignee继续使用 `assigneePatch` 的 `SET/CLEAR`，不再依赖 nullable scalar。Renderer 将用户清空描述的意图规范化为唯一 `CLEAR` wire 表达，不发送 raw null 或 `SET ""`，避免同一业务 mutation 有两种 payload。创建请求没有旧值需要保留，描述仍可直接省略或以空值表达无描述，创建责任人省略表示未分配。

请求必须至少有一个**实际 mutation**。Project/Board 是至少一个实际变化的名称或 description patch；Work Item 是至少一个实际变化的 title/description/assignee，或目标 Column 与当前 Column 不同。仅重复当前值且没有位置变化属于空 mutation，避免无意义版本递增。Core 在事务内加载权威当前值后判断是否实际变化，客户端的 dirty state 不是安全边界。

**替代方案：** generated nullable DTO 默认无法区分 omitted 与 explicit null，故不使用 raw null 清空；引入 `JsonNullable` 会增加 contract/Core/Desktop 依赖，而 property-level null-fail annotation 能在现有生成边界内严格实现 non-null schema；自定义 generator template 或全局 Jackson null 策略会扩大维护面或误伤其他 optional 字段；保留全量 PUT-like PATCH 会使历史超长字段阻塞无关编辑；允许空 PATCH 会制造审计与版本噪声。均不采用。

**测试边界：** OpenAPI semantic/generator tests 检查 optional scalar、两个受约束 description patch schema、`AssigneePatch` envelope，以及所有 optional-but-non-null mutation property 的 generated null-fail annotation；real-HTTP adapter tests 分别对 name/title、patch property 和可省略 patch value 覆盖 omitted 可用、raw null 以稳定 Problem Details/字段 path 拒绝，并覆盖 SET、CLEAR 与非法 action/value 组合；Core PostgreSQL integration tests 覆盖 omitted legacy field、description/assignee clear、同值空 mutation 和跨 Column move。

### 3. 历史超长值采用读兼容、写收敛，不做数据迁移

response schema 不对历史文本应用会拒绝解析的上限；读取和 Desktop 展示必须保留完整值。提交某字段时，新的规范化值必须满足当前上限，因此该字段自然收敛；提交其他字段时不触碰旧值。删除确认是一类读后精确比较输入，必须能输入完整历史名称，不套普通写入上限。

**替代方案：** 批量截断会造成不可逆数据损失；永久 grandfather 所有旧记录会让同一 API 出现两套写规则；阻止整条资源编辑会造成事实上的锁死。均不采用。

### 4. 创建责任人复用既有 Project Member 查询与 picker 语义

创建 Work Item 表单增加与详情编辑一致的单选 Project Member picker，初始值 `null`，不自动选择 creator。候选 query 失败时显示非阻断状态并保持未分配可提交；选择成员需要有效候选，Core 仍重新校验。

创建 draft 的规范化 fingerprint 包含 assignee membership ID 或 null。title、description、target Column、expected Board version 或 assignee 任一规范化载荷变化，都使尚未成功请求的 request id 失效；同一载荷的传输重试复用 request id。

**替代方案：** 自动分配 creator 改变已批准默认语义；候选失败禁用整个创建会把辅助读取变成不必要依赖；复制新的用户查询/模型会扩大边界。均不采用。

### 5. Renderer 使用小型共享语义和局部适配，不建立通用表单框架

在 Desktop Renderer/shared 边界提取最小可复用能力：字段约束元数据、NFC/code-point 计数、touched/submitted 可见性判定、完整候选编辑的 hard-limit 决策、Problem Details path 映射和稳定 feedback slot。各现有表单保留自己的 draft、提交和业务状态机，通过局部 adapter 使用这些语义。只有实际复用的行为进入共享模块；不引入 form library 或抽象所有输入。

计数在 `ceil(limit * 0.8)` 起显示。合法草稿达到上限后继续显示 `limit / limit`，被拒绝的增长编辑通过同一稳定状态区说明“已达到上限 / Limit reached”。普通字段不允许进入本地已知的超限草稿，也不因长度问题进入自动保存的 pending/error/retry 状态。`maxlength` 不能作为业务实现，因为 HTML 按 UTF-16 code unit 计数，与 canonical Unicode code-point 语义不同；Renderer 使用受控草稿和共享 pure decision 对完整候选值进行 trim + NFC + code-point 判断。

候选编辑采用原子接受或拒绝，而不是裁切：普通键入、选择区替换和粘贴只有在完整结果合法时才更新草稿；超限粘贴整次拒绝，不插入可容纳前缀。IME composition 的中间事件不校验、不切片，`compositionend` 后才判断完整提交值；超限时恢复最后一个已接受草稿。被拒绝的编辑保持字段焦点，并尽量保持原 selection/caret；删除、撤销和任何结果不超过上限的替换始终可用。状态公告使用稳定的 `aria-live`/status 区，不移动焦点，也不对同一“达到上限”状态逐键重复播报。

历史超长值是唯一允许编辑器初始 count 大于 limit 的情况。它完整显示且可选择；共享 decision 以该编辑会话初始权威值的规范化 code-point 数作为临时 ceiling，接受不超过该 ceiling 的删除、替换与撤销，拒绝超过历史 ceiling 的增长；该字段回到当前产品上限内之前不自动保存。仅打开后未修改的历史字段不视为 dirty。若仍超限的 dirty 草稿失焦并转向负责人或另一可独立编辑字段，详情把它转为显式 `paused-invalid` 本地状态：草稿继续可见、标记为未保存并可重新激活，但不进入 mutation，也不阻止目标字段操作。其他字段以当前最新资源 version 单独提交 sparse mutation；成功响应更新资源与 version 时，只要暂停字段的权威值仍等于草稿开始时的基线，就保留本地草稿并把其后续保存基于新 version。若权威字段已变化，则沿用明确 conflict 呈现并保留本地草稿，绝不静默覆盖。

详情关闭与字段切换是不同门禁。普通合法 dirty 字段仍在切换或关闭前保存一次并等待成功；`paused-invalid` 历史草稿切换字段时不保存、不阻断。关闭详情时若仍存在该草稿，则保持详情打开并显示“继续编辑 / Continue editing”和“放弃并关闭 / Discard and close”门禁：前者恢复该字段和焦点，后者恢复权威值后关闭。`Escape` 在该字段编辑态仍只丢弃字段草稿；详情层关闭、外部点击和其他快捷键不得绕过门禁。

feedback slot 预留足够的单行或约定区域；多行错误通过内部换行/扩展区域处理，但标签、控件顶部和主要操作不移动。required 错误在 touched blur 或 submit 后显示，达到上限状态、pending 文案与错误共用稳定区域。

**替代方案：** 每个页面复制逻辑会再次漂移；一次性引入全局 form framework 超出已证明复用边界并增加迁移风险。

**调研依据：** HTML `maxlength` 的常规交互就是达到上限后阻止继续输入，但 [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/maxlength) 明确其长度按 UTF-16 code unit 计算，因此本项目复用交互模式而不复用计数实现。[GOV.UK character count](https://design-system.service.gov.uk/components/character-count/) 允许长回答先超限再回改，适合长篇问卷内容，却会让本项目的短名称、标题和失焦自动保存进入可预防的失败状态，故不采用。达到上限的反馈按 [WCAG 2.2 status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) 通过不移动焦点的状态消息暴露给辅助技术。

**测试边界：** pure Renderer tests覆盖 Unicode、阈值、完整候选接受/拒绝、选择区替换、粘贴、IME commit、撤销/删除和历史超长值收敛；组件/Cypress 以真实输入事件及几何断言覆盖稳定草稿、焦点、status announcement、暂停草稿切换字段、无关稀疏保存后的最新 version、同字段并发冲突和关闭门禁，以及达到上限/计数/pending 状态不抖动和双语/a11y。

### 6. 轻量浮层用 capture `pointerdown` 判定 owned roots，Dialog 保持独立

复用 account menu 已验证的模式：浮层打开时监听 document capture `pointerdown`，对 trigger、content 以及登记的 Portal-owned roots 做 `contains`/composed-path 判断；外部操作先同步关闭浮层但不 `preventDefault`、不 `stopPropagation`，因此目标 click 可继续发生。`Escape` 只关闭最上层轻量浮层并在安全时恢复 trigger focus。选择“删除看板”后关闭菜单并打开独立 Dialog；Dialog 的 outside/dirty/pending/focus 策略不复用轻量默认值。

**替代方案：** backdrop 捕获 click 容易吞掉目标操作且要求二次点击；只监听 blur 无法可靠处理 Portal 和组合焦点；全局统一 Dialog/menu dismissal 会丢草稿或绕过危险门禁。

**测试边界：** Renderer integration tests覆盖 owned roots 与 focus；Chromium Cypress 覆盖真实 pointer 顺序、一次点击生效和 Portal 场景。

### 7. 以风险边界使用 Red-Green-Refactor，并保持生成物单向

明确可自动化的业务和 contract 边界使用 Red-Green-Refactor：先让 contract/Core/Desktop focused tests证明旧上限、全量 mutation、缺失 assignee 和错误 dismissal 的失败，再实现最小行为。视觉打磨在已有行为测试之上用 Cypress 几何/a11y与人工验收，不制造无意义 Red fixture。OpenAPI 修改后重新生成到 `build/`，不提交生成物。

## Risks / Trade-offs

- **[OpenAPI `maxLength` 按 code point描述，但 generated Jakarta `@Size` 和浏览器字符串 API易按 UTF-16计数]** → 关闭 generated Bean Validation投影，盘点并回归原有结构约束；Core使用明确 code-point算法，Renderer使用 `Array.from(normalized).length`，并以 real HTTP/组合字符/astral character边界测试证明没有 binding误拒。
- **[关闭 generated Bean Validation可能移除非文本长度之外的现有 transport校验]** → contract任务先清点生成注解及其当前消费者，再为 Jackson/Core拥有的结构、格式和数值约束补齐 HTTP回归；在证据完整前不得删除配置。
- **[sparse schema 的 optional nullable DTO 默认无法保留 omitted 与 raw null]** → 清空语义只由非空 `DescriptionPatch`/`AssigneePatch` envelope 表达；所有 optional-but-non-null mutation property 生成参数级 Jackson null-fail annotation，real-HTTP tests 证明 omitted 可用而 optional scalar、patch property 或 patch value 的 raw null 均以稳定字段 path 拒绝，Desktop typed boundary 不生成 raw null。
- **[“实际 mutation”需读当前值，可能与 optimistic concurrency 判断次序冲突]** → 在同一事务加载并锁定/按既有 version 校验后比较规范化值；过期 version 优先返回既有冲突，当前 version 的 no-op 返回 validation error。
- **[历史超长 response 被客户端 schema 的新 `maxLength` 误拒绝]** → 上限仅声明在 write schema，response schema不收紧；consumer tests使用历史超长 fixture。
- **[多个 Desktop 表单一次审计易产生不一致改动]** → 先建立共享 pure semantics，再按注册、Project、Board/Column、Work Item 分片迁移并逐片跑 focused tests；不顺手创建新页面。
- **[受控输入 hard limit 可能破坏 IME、粘贴或 caret/undo]** → 不校验 composition 中间态，只在完整 commit 后决策；粘贴按整次候选原子拒绝而非裁切；组件与真实 Chromium 测试覆盖 selection replacement、composition、paste、delete、undo、focus 和最后合法草稿。
- **[暂停历史草稿后保存其他字段可能复用过期 version 或覆盖并发修改]** → 暂停草稿保存其权威字段基线而非冻结资源 version；无关成功响应采用最新 version，只有字段基线未变化才继续携带本地草稿，字段变化转入显式 conflict；组件测试覆盖两条分支。
- **[feedback 预留空间可能增加空白或多语言换行]** → 用设计基础约定的固定 feedback rhythm 与最大支持字体/中英文 Cypress 几何检查，允许反馈区内部增长而不改变字段头部对齐。
- **[capture pointerdown 与 Portal/嵌套浮层竞态]** → 显式 owned-root registry/composed path，覆盖 trigger、Portal option、外部按钮和卸载时 listener 清理。
- **[候选在选择后失效]** → Core 原子重新授权并返回字段错误；Desktop 保留草稿、刷新候选并允许改回未分配，不进行乐观部分创建。

## Migration Plan

1. 先修改 canonical OpenAPI、contract validator/generation tests，并确认 response schema继续接受历史长值；生成输出仅留在 `build/`。
2. 修改 Core adapter/application 校验与 sparse mutation，先保持旧 Desktop 请求仍可在同一原子提交中映射；不修改数据库 schema或历史行。
3. 修改 Desktop shared/Main/Preload contracts和各 Renderer入口，最后启用创建 assignee、字段反馈与菜单交互；monorepo 以同一提交交付，避免长期 contract/client 不一致。
4. 更新业务模型、根架构和子项目职责/测试/设计文档，把实现证据从 Target/Proposed 调整为 Current，并执行模型/文档漂移审计。
5. 串行运行 contract、Core、Desktop 与 system/Chromium 门禁；人工验证中英文、历史超长 fixture、最小窗口和键盘路径。

回滚时整体回退 contract/Core/Desktop 代码即可。数据库未缩列、未迁移或截断；期间产生的新值也符合旧的更大容量，因此回滚不需要数据修复。
