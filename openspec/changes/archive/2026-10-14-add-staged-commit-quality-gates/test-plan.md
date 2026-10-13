# Test Plan

## Scope and Risk

影响范围是仓库级 Git hooks、Node 门禁工具、checkout bootstrap、根 package scripts 及跨项目质量策略文档。风险类别为开发流程正确性、跨平台兼容性和误判可靠性：漏映射会让可执行改动未测试即提交；过度映射会违背“未改模块不跑”；错误解析 rename/copy 或特殊文件名会选择错误模块；混合工作树会让通过结果不代表待提交快照；不清晰诊断会迫使开发者绕过门禁。

本 Change 不涉及产品业务不变量、身份、租户、授权、数据或 API；不验证 Docker、数据库、OAuth、Cypress、打包和原生平台 smoke，也不把本地 hook 提升为不可绕过的 CI 安全边界。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Verification Layer | Planned Evidence | Why This Layer |
| --- | --- | --- | --- |
| 接受/拒绝 commit subject 的 type、scope、`!` 和 description | Node 单元测试 | 表驱动测试覆盖历史合法主题、spec 穷举的全部允许 type、非法 type/scope/大小写/空描述/句号 | 纯解析器是最低且确定的行为边界 |
| 错误信息包含 rule、原主题、示例和明确下一步 | Node 单元测试 + CLI 测试 | 断言结构化错误与最终 stderr 包含 `Next:` 修复提示 | 防止“只返回 1”或只有示例而没有可操作下一步 |
| 正文/footer 不参与校验且 merge/revert/fixup/squash 无隐式豁免 | Node 单元测试 + 临时 Git 仓库 | 多行 message fixture；合法 `revert(scope): ...` 通过；Git 默认 `Revert "..."` 主题被拒并获得修改提示 | 固定合法 type 与禁止隐式豁免可同时成立，并覆盖 Git 的真实默认主题 |
| 只按 index 选择模块，不使用 unstaged diff | 临时 Git 仓库集成测试 | 创建 committed/staged/unstaged 三种版本并断言选择结果 | 真实 Git index 比 mock 命令文本更可靠 |
| `A/C/M/R/D/T/U/X/B` 与跨模块 rename/copy | 解析单元测试 + 临时 Git 仓库 | NUL name-status fixtures；真实 rename；`C` 与普通目标 `A` 的 copy 等价 fixture | 覆盖 parser 全状态；rename 影响源/目标，copy 只影响目标且不依赖 similarity heuristic 扩大源模块测试 |
| 路径含空格、换行和控制字符 | 临时 Git 仓库集成测试 | 创建特殊文件名、暂存并验证单一路径和安全转义输出 | 只有真实 `-z` 输出能捕获 shell/换行拆分缺陷 |
| Desktop、Core API、dev、hook、自共享配置的映射与去重 | Node 单元测试 | 当前路径矩阵 fixture 断言 gate 集合、顺序、触发原因 | 声明式映射的最低可靠层 |
| Markdown、OpenSpec、Agent 指令和元数据免测 | Node 单元测试 + CLI 测试 | 每类路径 fixture；空 gate 时断言明确免测输出 | 防止文档被宽模块规则误选 |
| 未映射路径 fail-closed | Node 单元测试 + CLI 测试 | 新顶层可执行路径 fixture，断言命令未运行及维护提示 | 防止新模块静默绕过 |
| 当前仓库所有 tracked 顶层路径均可分类 | 仓库结构测试 | 扫描受支持的当前路径代表和共享配置，断言无 unknown；未来源码路径 fixture 仍 unknown | 检测映射随仓库演进漂移，同时不把所有未知默认免测 |
| 受影响边界内 partially staged tracked 文件 | 临时 Git 仓库集成测试 | 同一路径 staged 后再次修改，断言在命令前拒绝 | 真实 index/worktree 差异是风险本体 |
| 受影响边界内 untracked 文件 | 临时 Git 仓库集成测试 | 创建未跟踪文件，断言拒绝并列出路径 | 验证未跟踪污染不是只检查 tracked diff |
| 无关模块的 unstaged/untracked 文件不阻塞 | 临时 Git 仓库集成测试 | staged Desktop + dirty Core API，断言只选择/执行 Desktop fake gate | 防止纯净度策略退化为全仓洁净要求 |
| gate 固定顺序、去重、fail-fast、未运行汇总 | 注入 runner 的 Node 单元测试 | 可控 spawn 结果覆盖成功、非零、signal、ENOENT，断言 argv/顺序/汇总 | 不需要真的重复运行昂贵模块门即可穷举故障 |
| 子命令输出可见且平台启动方式安全 | Node 单元测试 + source review | POSIX 断言固定 argv、`stdio: inherit` 与 `shell: false`；Windows 断言 `.cmd`/`.bat` 经转义的 `cmd.exe` adapter、`windowsVerbatimArguments` 且不拼入用户输入 | 捕获诊断丢失、Windows 无法启动批处理和路径注入风险 |
| hook 入口转发 message path/退出码 | 临时 Git 仓库 hook 集成测试 | 安装仓库 fixture hook，执行合法/非法 commit；fake gate 避免业务套件 | 验证 Git 到 Node 的真实参数和阻断行为 |
| 首次、重复和冲突 `core.hooksPath` 安装 | 临时 Git 仓库集成测试 | 真实 worktree/local/global git config 覆盖未设置、worktree 幂等、相同期望值继承和不同来源冲突，断言只在无冲突时写当前 worktree config | per-worktree 配置与对用户其他配置层的保护不能只靠纯函数证明 |
| linked worktree 安装隔离 | 双 worktree Git 集成测试 | 在 worktree A 安装后断言 A 使用 `.githooks`，worktree B 的有效值和 `config.worktree` 不变；再单独安装 B | 防止 `--local` 共享 `.git/config` 导致未安装 checkout 被隐式接管 |
| bootstrap 使用同一 installer 且冲突可解释 | Node source/behavior test | 注入 bootstrap child runner 或导出 installer seam，断言安装步骤和失败传播 | 防止 bootstrap 复制并漂移安装逻辑 |
| macOS/Windows 命令差异 | Node 单元测试 + CI/source review | 平台 fixture 断言 `pnpm`/`pnpm.cmd`、`gradlew`/`gradlew.bat` 逻辑命令；Windows runner fixture 断言受控 `cmd.exe` adapter 与转义，shell hook 保持 POSIX Git 兼容 | 无需伪造 Windows 运行结果，但固定可验证的平台分支 |
| 文档与真实命令/映射一致 | source review + `git diff --check` | 对照 package scripts、Gradle task、README、architecture 和映射表 | 自动测试不能证明文档语义完整 |

## Implementation and Verification Approach

### Slice 1: 提交信息解析与 CLI

这是工程工具行为，不采用业务 Red-Green-Refactor。先实现无副作用的解析器和结构化诊断，再添加 message-file CLI 与 `commit-msg` 入口；用表驱动测试覆盖合法/非法矩阵及错误可操作性。

### Slice 2: 暂存路径解析、模块映射与纯净度

直接实现 NUL 安全的 Git adapter、声明式路径分类和受影响边界纯净度检查。纯函数测试负责状态解析与映射矩阵，临时 Git 仓库负责真实 index、特殊路径、部分暂存、未跟踪、跨模块 rename 以及 `C`/目标 `A` 两种 copy 表示。未知路径必须在任何质量命令前失败。

### Slice 3: Gate 执行与诊断

实现固定顺序、去重和 fail-fast runner，使用可注入的子进程 seam 穷举 spawn/exit/signal 失败；生产 runner 只接受固定逻辑命令，POSIX 直接传 argv，Windows 的 `.cmd`/`.bat` 通过受控 adapter 执行，并继承 stdout/stderr。CLI 集成测试证明免测、执行计划和失败汇总。

### Slice 4: 安装、bootstrap 与真实 hook 链

实现 worktree-specific installer，接入根 scripts 和 bootstrap，再在普通仓库及双 linked-worktree 仓库验证首次/幂等/冲突/隔离及真实 `git commit` hook 阻断。测试使用 fake gate command seam 或 fixture repository，避免每个集成用例真的运行 Desktop/Core API 全套质量门；生产默认命令不可由仓库外不可信输入替换。

### Slice 5: 文档与整体一致性

更新架构和 README 后，运行门禁工具全套测试、受实际改动影响的 dev/desktop 质量门、OpenSpec 严格校验与 diff 检查。通过 source review 对照映射表、package scripts 和现有 Gradle task；完成模型/文档漂移审计，不伪造产品模型变化。

## Verification Commands

### Focused

- `pnpm hooks:test`: 运行 commit parser、Git adapter、映射、纯净度、runner、installer 和临时仓库 hook 集成测试。
- `pnpm hooks:commit-msg -- <message-file>`: 手动复现指定提交信息文件的校验。
- `pnpm hooks:pre-commit`: 手动复现当前 index 的模块选择与质量门；仅在专用验收 index 或确认当前暂存区适合时运行。
- `pnpm dev:test`: 验证 bootstrap 安装接入及现有开发工具行为没有回归。

### Affected and Cross-Boundary

- `pnpm --filter @taskpilot/desktop qualityCheck`: 根 package/lock 或 Desktop 受实现影响时执行现有 Desktop 门。
- `./gradlew --no-daemon :services:core-api:qualityCheck`（Windows 使用 `gradlew.bat`）: 仅当 Gradle/Core API 文件被实现修改时执行；命令映射本身由 fake runner 测试，不以未改 Core API 的全量执行替代该测试。
- `openspec validate add-staged-commit-quality-gates --strict --no-interactive`: 验证 Change artifacts。
- `openspec validate --all --strict --no-interactive`: 验证主 specs 与全部 active Changes 的结构一致性。
- `git diff --check`: 检查所有实施和规划文本的 whitespace 错误。
- 临时 Git 仓库 smoke：使用真实 `git commit` 验证合法主题通过、非法主题被 `commit-msg` 拒绝、质量失败被 `pre-commit` 拒绝，且原仓库 index/worktree 不被测试修改。

## Manual Evidence and Automation Gaps

- **Owner：实施者；时机：Apply 自审。** 在当前 macOS checkout 执行一次 `pnpm hooks:install` 并确认重复执行幂等，再恢复测试前 worktree 配置（若测试要求）。原因：临时仓库已覆盖行为，但当前 checkout 的路径解析和文件可执行位仍需一次真实确认。
- **Windows gap：** 当前环境不能提供真实 Windows Git 执行证据。自动化覆盖平台逻辑命令、`.cmd`/`.bat` 的受控 `cmd.exe` adapter 和 Git-for-Windows 支持的 POSIX hook 入口；首次 Windows 人工验收由后续 Windows 发布/开发环境 gate 承担。该缺口不改变本 Change 行为或实现顺序，不能被表述为已验证 Windows。
