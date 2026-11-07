# Proposal

## Why

当前新建 Work Item 无法在创建时指定责任人，看板操作菜单不能按常见轻量浮层方式点击外部关闭，而名称、标题和描述的长度/必填校验在 Desktop、canonical OpenAPI 与 Core API 之间也不完整或不一致。需要在数据库保留扩展余量的同时建立适合任务管理产品的信息长度、统一服务端契约和可理解且不抖动的表单反馈，避免未来 Desktop、Web、Mobile、CLI 与 MCP 产生不同数据语义。

## What Changes

- 新建 Work Item 时可从当前 Project Member 中选择责任人，默认仍为未分配；候选加载失败不得阻止创建未分配的 Work Item，责任人参与创建请求的幂等载荷。
- Board `...` 菜单项文案由“永久删除看板 / Permanently delete board”改为“删除看板 / Delete board”；真正的确认 Dialog、危险说明和提交按钮继续明确“永久删除”，删除 API 与业务语义不变。
- Board 轻量操作菜单支持点击外部关闭、`Escape` 关闭并恢复触发器焦点、内部交互不误关；该行为沉淀为 Desktop 轻量浮层的常规交互契约，不套用于有脏数据或危险确认门禁的 Dialog。
- **BREAKING**：将新写入的产品契约上限调整为：用户显示名称 80、Project 名称 100、Project 描述 1000、Board 名称 80、Board 描述 1000、Column 名称 50、Work Item 标题 160、Work Item 描述 5000 个 Unicode code point；名称和标题规范化后必填，描述可选。数据库既有容量保持不变。
- canonical OpenAPI、Core API 和所有第一方 Desktop 创建/编辑入口采用同一产品上限；OpenAPI 保留按 Unicode code point 表达的 `minLength`/`maxLength`，生成的 Kotlin/Spring transport 不得用按 UTF-16 code unit 计数的 Jakarta `@Size` 提前拒绝合法输入，Core API 继续作为权威校验边界；Desktop 在输入边界提供字段级、双语、可访问的反馈，并按完整候选值原子接受或拒绝编辑，不依赖保存失败暴露本地已知的长度问题，也不静默截断粘贴或输入法提交内容。
- 既有超过新产品上限的数据继续可读；用户修改该字段时必须缩短到新上限。历史超长草稿尚未收敛时，可暂停该草稿并切换到负责人等可独立编辑字段：Desktop 不提交、不丢弃该草稿，其他字段继续以最新权威版本执行稀疏 mutation；关闭详情前必须明确继续编辑或放弃未保存草稿。相关 PATCH 契约改为只提交实际变化的字段并拒绝空 mutation：名称/标题省略表示不修改，描述与责任人使用显式 `SET/CLEAR` envelope；所有“可省略但出现时不可为 null”的 mutation 属性都拒绝 raw JSON `null`，从而不把显式非法输入折叠成 omitted，也不全量回传旧值。
- 审计当前已实现的持久化文本表单：首次注册显示名称、Project 创建/设置、Board 创建/编辑、Column 创建/编辑、Work Item 创建/详情编辑；搜索、筛选和精确名称删除确认不被错误套用为普通持久化字段规则。
- 新增常规表单反馈约定：trim + Unicode NFC 后按 code point 校验；必填错误在失焦或提交后出现；对正常值，任何会超过上限的键入、替换、粘贴或输入法提交都在提交前被原子拒绝，最后一个合法草稿、焦点与编辑能力保持不变，并通过稳定状态区说明已达到上限；删除、撤销和收敛编辑继续可用。接近上限才显示计数；反馈不得造成布局抖动；服务端 `path` 映射到具体字段；不得只用无解释的 disabled 按钮表达错误。

## Business Model Impact

本 Change 使用具体场景、字段语义分类、关系检查和兼容决策树完成比例化建模：

- **参与者与目标：** 当前执行者仍是已认证的 Workspace/Project OWNER。目标是在创建 Work Item 时一次性表达可选责任人，并让用户能以一致规则创建和修改人可读的名称、标题与描述。
- **Canonical terms 与关系：** 受影响术语为 User display name、Project、Board、Column、Work Item、Project Member 与 assignee。Work Item 仍属于 Project，Card 仍只是 Work Item 的 Board Placement 投影；创建时选择责任人不新增身份、基数、Assignment 历史或 Card-owned 数据。
- **生命周期与不变量：** Work Item lifecycle/status 仍未实现；创建时分配责任人不会触发 Workflow、AgentRun 或审批。名称/标题在规范化后非空，描述可为空；数值上限是产品写入不变量而非数据库容量声明。数据库不迁移、不截断既有值。
- **授权与范围：** 创建时可选责任人仍只能引用当前 Project 的 active Project Member，并由 Core API 重新授权和校验；候选控件和 Renderer 输入都不构成授权。错误范围或跨 Project member 引用不得泄露其他 Project 成员。
- **版本与历史：** 当前乐观版本、request id 幂等与审计时间语义保持不变。历史超长值完整可读、可选择，并以该权威值的规范化长度作为本次编辑会话的临时天花板，从而允许删除、替换与撤销但不允许继续增长；它不获得写入另一超长值的豁免，达到当前上限前不得保存该字段。暂停草稿不占用旧版本：无关 mutation 成功后采用最新权威版本，同时仅在该历史字段的权威值未变化时保留本地草稿；若该字段已被并发修改则进入明确冲突处理，不静默覆盖。稀疏 PATCH 只校验实际提交字段，因此历史草稿不阻塞无关 mutation。
- **失败、恢复与并发：** 责任人候选加载失败允许用户以未分配继续创建；选择失效成员、字段为空/超限、空 PATCH、过期版本、迟到响应和暂时错误均不得产生部分写入。校验失败保留草稿和编辑上下文，版本冲突继续采用权威重载/重试路径。
- **滥用边界：** UI 限制不是安全边界；Core API 对 Desktop、未来 Web/Mobile/CLI/MCP 使用相同规则。删除确认输入继续执行精确名称匹配，不因常规名称上限而改变或截断。

## Capabilities

### New Capabilities

- `desktop-form-interactions`: 统一当前 Desktop 持久化文本表单的校验反馈、字符计数、稳定布局、焦点恢复，以及轻量浮层的外部点击与键盘关闭行为。

### Modified Capabilities

- `desktop-authentication`: 首次注册显示名称采用 80 code point 产品上限及字段级可访问校验。
- `project-home`: Project 名称/描述采用 100/1000 code point 产品上限，并支持只提交实际变化字段。
- `project-boards`: Board 名称/描述与 Column 名称采用 80/1000/50 code point 产品上限；Board 菜单文案和轻量关闭行为调整，危险确认语义保持不变。
- `project-work-items`: Work Item 标题/描述采用 160/5000 code point 产品上限；创建时可选当前 Project Member 责任人，并以稀疏 mutation 兼容未变化的历史超长值。
- `canonical-resource-api`: checked-in OpenAPI 明确上述文本约束、稀疏 PATCH 和 Work Item 创建责任人契约，使所有客户端共享同一写入语义。

## Impact

- `contracts/canonical-api/openapi.yaml` 及其生成/校验测试：请求字段的 `minLength`/`maxLength`、稀疏 PATCH 和非空 mutation 约束。
- `services/core-api`：注册、Project、Board、Column、Work Item 的规范化与权威校验，稀疏更新、幂等 fingerprint、历史值兼容和 focused integration tests；数据库字段容量与既有 migration 不变。
- `apps/desktop` Main/Preload/shared contracts：对应 IPC schema 与 sparse request mapping；Renderer：新建 Work Item 责任人选择、所有当前持久化文本表单的字段错误/计数/焦点，以及 Board 菜单 dismissal/copy；相应 Renderer/Cypress/system tests。
- 不新增运行时依赖，不新增跨项目表单框架，不改变 Board 永久删除 API、权限或数据删除范围。

## Documentation Impact

- `docs/business-model.md`：记录已实现名称/标题/描述的产品写入不变量、数据库容量与产品契约分离，以及创建 Work Item 可选 Project Member assignee；不改变实体身份、关系或生命周期。
- `docs/architecture.md`：记录 canonical API 是各客户端文本写入约束的唯一契约、Core 最终校验及 sparse PATCH 对历史大值的兼容边界；Current 描述随实现更新。
- `apps/desktop/docs/design-foundation.md`：补充持久化表单反馈、近上限计数、稳定错误区域和轻量浮层 dismissal 的常规交互规则。
- `apps/desktop/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md`：更新 Renderer/Main 的校验责任、创建责任人数据流与验证矩阵。
- `contracts/canonical-api/docs/*` 与 `services/core-api/docs/*`：仅在现有职责/测试文档需要记录 sparse PATCH、契约约束或 focused gates 时更新；不得重复业务规则。
- `docs/README.md` 不新增或移动文档，预计无需修改；实现末尾仍须执行文档导航与 Current/Target 漂移审计。
