# Spec Delta

## Purpose

为 Project 提供最小但真实的 Work Item 业务记录，使 Board Card 始终投影稳定、可授权和可并发控制的工作数据，而不是把标题与描述复制为仅存在于界面的演示状态。

## ADDED Requirements

### Requirement: Work Item 是 Project 内的业务真相
每个 Work Item SHALL 具有稳定 `workItemId`、唯一 `projectId` 引用、必填标题、可选描述、总体生命周期、版本、创建者和审计时间。当前创建的基础 Work Item SHALL 处于 `OPEN`，本切片不批准其他 lifecycle 值；在 Work Item Type 与自定义字段尚未实现时不要求类型版本，也 MUST NOT 暴露类型选择、自定义字段、完成、取消或重开动作。未来使用类型化字段的 Work Item SHALL 通过后续 Change 固定不可变 Work Item Type Version。标题 SHALL 去除首尾空白并规范化为 Unicode NFC，规范化结果 MUST 为 1 至 300 个 Unicode code point；描述 SHALL 去除首尾空白、规范化为 Unicode NFC 并限制为最多 10000 个 Unicode code point。

#### Scenario: 读取 Work Item
- **WHEN** Project OWNER 读取当前 Project 的 Work Item
- **THEN** 响应以 `workItemId` 标识权威记录，并返回标题、描述、`OPEN` 生命周期、版本和审计时间

#### Scenario: 同名 Work Item
- **WHEN** Owner 在同一 Project 创建标题相同的两个 Work Item
- **THEN** 系统以不同 `workItemId` 保存两条记录，不以标题作为身份或唯一键

#### Scenario: 未支持的生命周期动作
- **WHEN** 客户端尝试通过当前 Desktop API 完成、取消或重开 Work Item
- **THEN** 当前 API 不提供该动作，也不通过 Card 移动隐式改变生命周期

#### Scenario: 当前不要求 Work Item Type
- **WHEN** Owner 在当前切片创建基础 Work Item
- **THEN** 系统只要求当前规格的稳定字段，不伪造 Work Item Type Version 或暴露自定义字段入口

### Requirement: 从 Board 创建 Work Item 时原子建立 Placement
Project OWNER SHALL 能从当前 Board 提交标题、可选描述、UUID request id 和 expected Board version 创建 Work Item。Core API SHALL 在一个事务内重新校验 Workspace、Project、Board、expected Board version 和目标 Column，创建 Work Item 及其在当前 Board 的唯一 Placement并递增 Board version；同一 actor 与 Project 范围内相同 request id 和规范化 payload 的成功重试 MUST 返回同一 Work Item 与 Placement，即使首次成功已递增 Board version，也不得重复创建任一记录。规范化幂等 payload SHALL 包含标题、描述、Board、目标 Column 和 expected Board version。

#### Scenario: 在当前 Column 创建 Card
- **WHEN** Owner 在当前 Board 的有效 Column 提交有效字段、新 request id 和当前 Board version
- **THEN** 系统原子创建 OPEN Work Item 与 Placement、递增 Board version，Card 出现在目标 Column 的末尾

#### Scenario: 使用过期 Board version 创建 Card
- **WHEN** Owner 以新 request id 和过期 Board version 提交 Work Item 创建
- **THEN** 系统返回稳定并发冲突，Work Item、Placement 和 Board 布局均不改变

#### Scenario: 创建响应丢失后重试
- **WHEN** 客户端以相同 request id、expected Board version 和其余规范化 payload 重试已成功的创建
- **THEN** 系统返回原 Work Item 与原 Placement，不因首次成功已递增 Board version 而冲突，也不产生重复 Card

#### Scenario: request id 被复用为不同 Work Item
- **WHEN** 相同 actor 与 Project 下的 request id 被用于不同标题、描述、Board、目标 Column 或 expected Board version
- **THEN** 系统返回稳定幂等冲突且不创建额外记录

#### Scenario: 目标 Column 不属于 Board
- **WHEN** 创建请求组合了同 Project 的一个 Board 与另一个 Board 的 Column
- **THEN** 系统以 not-found 语义拒绝，Work Item 与 Placement 都不创建

### Requirement: Project Owner 可查看和原子编辑 Work Item
Project OWNER SHALL 能按稳定 ID 查看 Work Item，并以当前版本修改标题和描述。当前 Board 上的编辑请求 SHALL 同时携带 Board、Placement、当前 Column 和目标 Column 上下文；若目标 Column 与当前 Column 不同，还 SHALL 携带当前 Board version 与 Placement version。Core API SHALL 同时校验路径中的 Workspace、Project、Work Item、Board、Placement 和目标 Column 归属，在一个事务内保存 Work Item 内容与可选 Placement 变更，并返回权威 Work Item 与 Board。成功修改 SHALL 递增 Work Item 版本并保留其 ID 与生命周期；目标 Column 未变化时 SHALL 不改变 Board 或 Placement version，目标 Column 变化时 SHALL 把 Card 移到目标 Column 末尾并递增受影响的布局 version。任一校验或写入失败 MUST 回滚内容和位置的全部变化。

#### Scenario: 只编辑 Work Item 内容
- **WHEN** Owner 以当前 Work Item 版本提交有效标题、描述和未变化的目标 Column
- **THEN** 系统保存权威内容并返回更新后的 Work Item 与 Board，不改变 Board 或 Placement version

#### Scenario: 编辑并移动到另一 Column
- **WHEN** Owner 以当前 Work Item、Board 和 Placement 版本提交有效内容及当前 Board 的另一目标 Column
- **THEN** 系统在同一事务内保存内容、把 Card 移到目标 Column 末尾，并返回更新后的 Work Item 与 Board

#### Scenario: 原子编辑发生版本冲突
- **WHEN** 编辑请求使用过期 Work Item version，或跨 Column 编辑使用过期 Board 或 Placement version
- **THEN** 系统返回稳定冲突，Work Item 内容、Board 与 Placement 全部保持不变，并要求客户端重新加载

#### Scenario: 原子编辑使用错误范围
- **WHEN** 请求组合错误 Workspace、Project、Board、Placement 或目标 Column
- **THEN** Core API 返回 not-found，Work Item 内容与 Placement 全部保持不变，且不泄露资源真实归属

### Requirement: 当前切片不提供 Work Item 独立删除
当前 Desktop API 和 UI MUST NOT 提供单独永久删除 Work Item 的动作。经 Project Danger Zone 显式确认的 Project 永久删除 MAY 按 Project 拥有关系删除其 Work Item；除此之外，未知或受保护依赖 SHALL 继续阻止无语义的数据删除。

#### Scenario: 查找独立删除动作
- **WHEN** 用户或契约测试检查当前 Work Item 操作
- **THEN** 不存在独立删除 endpoint 或 UI 动作

#### Scenario: 永久删除所属 Project
- **WHEN** Project 永久删除已通过名称、版本、权限和依赖校验
- **THEN** 该 Project 的 Work Item 与 Board 子资源在同一事务内被显式删除，或任一步失败时全部保留
