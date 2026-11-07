# Spec Delta

## Purpose

把产品文本上限、稀疏 mutation、历史值读取兼容和创建责任人固化为所有客户端共享的 canonical wire contract。

## ADDED Requirements

### Requirement: canonical OpenAPI 明确人可读文本的产品写入约束
Checked-in canonical OpenAPI SHALL 是所有 canonical 客户端写入人可读文本约束的唯一 wire contract，并 SHALL 声明规范化后的 Unicode code point 上限：User display name 80、Project name 100、Project description 1000、Board name 80、Board description 1000、Column name 50、Work Item title 160、Work Item description 5000。名称和标题 SHALL 在去除首尾空白并执行 Unicode NFC 后至少包含 1 个 code point；创建请求中的描述 MAY 缺失或规范化为空字符串。数据库列容量 MAY 大于产品上限，但 MUST NOT 被文档或客户端解释为可写上限。任何入口 MUST NOT 静默截断。生成的 Kotlin/Spring transport model MUST NOT 使用按 JVM UTF-16 code unit 计数的运行时长度约束执行上述 code-point 上限；Core API SHALL 在请求进入 application boundary 后按规范化 Unicode code point 执行权威校验。

Project、Board 与 Work Item 编辑 schema SHALL 使用 presence-aware sparse mutation：可编辑名称/标题标量省略表示不修改，出现时表示 SET 且规范化为空 SHALL 无效；可清空描述 SHALL 使用可省略的 `descriptionPatch` envelope，Project 与 Board 引用上限 1000 的 patch schema，Work Item 引用上限 5000 的 patch schema；两者具有相同结构：省略表示不修改，`SET` 携带规范化后 1 至对应上限个 code point 的 `value`，`CLEAR` 不携带 `value` 并表示清空。Work Item assignee SHALL 继续使用同类 `assigneePatch` 的 `SET/CLEAR` envelope。所有 edit request 或 patch envelope 中可省略但 schema non-null 的 mutation 属性（包括名称/标题、`descriptionPatch`、`assigneePatch` 及可省略 patch value）在显式提交 JSON `null` 时 MUST 在 HTTP binding 边界作为无效 payload 拒绝；raw null MUST NOT 被折叠为 omitted，也 MUST NOT 表示清空描述或责任人。只有省略相应属性才表示不修改或按 action 允许缺少 value。每个编辑请求 SHALL 至少包含一个实际业务 mutation；Work Item 移动到不同 Column可作为该 mutation。Core API SHALL 只校验实际提交的业务字段，读取 schema SHALL 继续返回历史超长值。字段 validation failure SHALL 使用共享 Problem Details，并在 `path` 中指向可映射的请求字段。

Work Item 创建 schema SHALL 暴露可选 Project Member assignee，并把责任人纳入规范化幂等 payload；省略或显式允许的空值 SHALL 表示未分配。契约 SHALL 继续要求 Core API 在 Project scope 内重新授权和校验目标，而不是信任客户端候选。

#### Scenario: 自动化检查产品文本约束
- **WHEN** contract 测试读取注册、Project、Board、Column 与 Work Item 的 create/edit request schema 和生成的 Kotlin/Spring model
- **THEN** OpenAPI 中存在与上述产品上限、必填/可选语义和规范化说明一致的约束，文档不把数据库容量声明为可写范围，且生成 model 不包含会按 UTF-16 code unit 误拒合法补充字符输入的运行时长度校验

#### Scenario: 补充字符通过 HTTP binding
- **WHEN** 客户端提交规范化后恰好达到字段上限且由 supplementary Unicode character 构成的合法文本
- **THEN** generated HTTP boundary 不以 UTF-16 长度提前拒绝，Core API 按 Unicode code point 接受该值

#### Scenario: 自动化检查稀疏编辑 schema
- **WHEN** contract 测试读取 Project、Board 与 Work Item edit schema
- **THEN** 可修改名称/标题与 patch envelope 按契约允许省略，描述与责任人通过 `SET/CLEAR` 表达写入或清空，且 operation 文档拒绝没有实际业务 mutation 的请求

#### Scenario: 描述 patch 的三种语义
- **WHEN** 客户端分别省略 `descriptionPatch`、提交 `SET` 及有效 `value`、或提交 `CLEAR`
- **THEN** canonical contract 分别表示不修改、写入规范化描述和清空描述，而不依赖显式 JSON `null` 表达清空

#### Scenario: raw null 被拒绝
- **WHEN** 客户端为 optional name/title、`descriptionPatch`、`assigneePatch` 或可省略但 non-null 的 patch value 提交 raw JSON `null`，即使同一请求还包含其他有效 mutation
- **THEN** HTTP boundary 以带可映射字段 `path` 的稳定 Problem Details 拒绝整个 payload，且不把 raw null 解释为省略或清空

#### Scenario: 读取历史超长值
- **WHEN** canonical read operation 返回新产品上限生效前保存的超长文本
- **THEN** response schema 不截断或拒绝该值，客户端可展示它；只有再次提交该字段时才应用当前写入上限

#### Scenario: 字段错误可映射
- **WHEN** Core API 拒绝空白或超限字段
- **THEN** Problem Details `path` 指向 canonical 请求字段，使第一方或未来客户端可将错误展示在对应控件附近

#### Scenario: Work Item 创建责任人参与幂等语义
- **WHEN** 自动化比较仅责任人不同的两个 Work Item 创建 payload
- **THEN** canonical contract 将它们描述为不同规范化 payload，复用同一 request id 产生稳定幂等冲突
