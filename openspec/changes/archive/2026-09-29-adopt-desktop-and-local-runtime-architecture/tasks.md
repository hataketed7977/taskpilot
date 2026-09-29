# Tasks

## 1. 锁定文档迁移范围

- [x] 1.1 用 `find apps/web -type f | sort`、`find . -maxdepth 2 -type f | sort` 和 `git status --short` 记录基线，确认 `apps/web/` 只有文档、仓库没有 runnable app，并保护与本 change 无关的并发改动；若发现实现代码则停止并重新规划。
- [x] 1.2 用 `openspec list --json` 和 `find openspec/changes -mindepth 1 -maxdepth 1 -type d | sort` 确认不存在另一个有效且方向互斥的第一方 Web change；不依赖已删除 change 的任务状态。

## 2. 迁移第一方客户端文档边界

- [x] 2.1 删除 `apps/web/`，创建 `apps/desktop/AGENTS.md` 及 `docs/architecture.md`、`docs/responsibilities.md`、`docs/testing-strategy.md`，按语义迁移可复用 React/UI 规则并增加 Electron Renderer/Preload/Main、typed IPC、安全、打包和 packaged Electron/Chromium 双平台验证边界；以 `test ! -e apps/web && test -f apps/desktop/AGENTS.md && test -f apps/desktop/docs/architecture.md && test -f apps/desktop/docs/responsibilities.md && test -f apps/desktop/docs/testing-strategy.md` 为文件边界证据，不初始化源码或依赖。
- [x] 2.2 运行 `find apps/desktop -type f | sort` 以及一次性只读 Markdown checker 的 Desktop 相对链接、anchor、metadata 检查，确认 Desktop 是唯一第一方 UI owner，四份文档的 Status/Owns/Read after/Mandatory before 与 Skill routing 完整。

## 3. 建立 Agent Runtime 文档边界

- [x] 3.1 创建 `apps/agent-runtime/AGENTS.md` 和 architecture/responsibilities/testing 三份 Target 文档，固定 Runtime 与 Desktop、Gateway/Core API、本地工作区之间的 owner 和信任边界；以四个 `test -f` 断言和 `find apps/agent-runtime -type f | sort` 为完成证据，不创建实现 scaffold。
- [x] 3.2 在 Runtime 文档中明确 workspace guard 不是 OS 级沙箱、任意子进程仍继承用户权限，以及 Runtime 不持有 Desktop 长期用户令牌；用 `rg -n -i 'OS 级沙箱|用户权限|长期用户令牌|execution grant|执行授权' apps/agent-runtime --glob '*.md'` 核对必需边界，并将完整 grant 协议留给后续 implementation change。
- [x] 3.3 运行一次性只读 Markdown checker 的 Runtime metadata、相对链接和 anchor 检查，并用 `rg -n '^#|Status:|Owns:|Read after:|Mandatory before:' apps/agent-runtime --glob '*.md'` 复核 child 导航完整且内部细节未重复回根文档。

## 4. 更新根导航和 Target Architecture

- [x] 4.1 更新根 `AGENTS.md` 的 Required Navigation 与 Skill routing，把 `apps/web` 路由迁移为 Desktop Renderer UI 路由并增加 Runtime change route；以 `rg -n 'apps/(web|desktop|agent-runtime)|Desktop Renderer|Agent Runtime' AGENTS.md` 和 Markdown link checker 为完成证据，不复制 child 设计细节。
- [x] 4.2 更新 `docs/README.md` 的阅读路线、Mermaid 导航图和 inventory，删除 Web section，增加 Desktop 与 Agent Runtime section；以 documentation map checker 和 `rg -n 'Web Documents|Desktop Documents|Agent Runtime Documents|apps/(web|desktop|agent-runtime)' docs/README.md` 证明所有工程文档唯一可达。
- [x] 4.3 更新根 `README.md` 和 `docs/architecture.md` 的系统图、目录树、Technology Direction、subproject table、API/身份/测试/非目标边界为 Electron Desktop + 独立的 Agent Runtime + Gateway/Core API，并持续声明无 runnable app；以 scoped `rg`、Markdown checker 和 changed Mermaid 渲染结果为证据。
- [x] 4.4 更新 `docs/business-model.md` 中与 Web/SSE 载体耦合的必要表述，并注明 Runtime 不拥有业务真相；用 `git diff -- docs/business-model.md` 确认关系、基数、唯一标识、生命周期和 MVP 规则未改变。

## 5. 同步云端控制面文档

- [x] 5.1 更新 Gateway 的 `AGENTS.md` 和三份工程文档，把 First-party Web API、Cookie/CSRF 与 browser session 方向迁移为 Desktop identity、未来 Runtime execution grant 和 Desktop API 边界；用 `rg -n -i 'First-party Web API|Cookie|CSRF|browser session|Desktop|Runtime|grant' services/gateway --glob '*.md'` 审计结果为证据，不补写尚未决定的 grant 协议。
- [x] 5.2 更新 Core API 的 `AGENTS.md` 和三份工程文档，记录 AgentRun/ApprovalRequest 的业务真相所有权、Agent Runtime 提交 execution evidence 的边界和 Runtime 禁止直写数据库；用 `rg -n -i 'AgentRun|ApprovalRequest|Agent Runtime|execution evidence|业务数据库' services/core-api --glob '*.md'` 和 child link checker 为证据，不复制本地执行内部设计。
- [x] 5.3 对根、Desktop、Runtime、Gateway 和 Core API 文档运行 security-boundary scoped `rg`，确认未把 workspace guard 描述为 OS 级沙箱、未让 Runtime 复用长期用户令牌，也未把 Target 行为描述为 Current；命中项逐条写入临时 allowlist 或修复，最终命令与 allowlist 一并作为证据。

## 6. 验证知识地图、图表和 OpenSpec

- [x] 6.1 运行一次性只读 Markdown checker，验证 changed Markdown 的相对链接、heading anchors、fence、Status/Owns/Read after/Mandatory before、documentation map inventory 和 child `AGENTS.md` 导航；checker 与输出保存到临时目录，所有检查退出码为 0 后才完成。
- [x] 6.2 提取所有 changed Markdown 的 Mermaid blocks，使用 `/Users/bytedance/.local/bin/node/bin/mmdc` 与本机 Chrome 实际渲染到临时目录；以提取数等于成功渲染数、所有进程退出码为 0 及关键边界人工可读为完成证据。
- [x] 6.3 运行 `rg -n -i 'apps/web|React Web|First-party Web API|Cookie|CSRF|Cypress|browser matrix|to the Web' AGENTS.md README.md docs apps services --glob '*.md'`，逐项删除旧第一方客户端假设，或将确属外部 Web/历史语境的命中记录进临时 allowlist。
- [x] 6.4 运行 `openspec status --change adopt-desktop-and-local-runtime-architecture --json`，确认 `specs` 为 `skipped`；再运行 `openspec validate adopt-desktop-and-local-runtime-architecture --strict --no-interactive`、`git diff --check`、`git status --short` 和 changed-file inventory，确认本 change 只有目录/文档迁移且未混入实现。
## Post-Apply Handoff

Apply 的完成边界是以上结构、文档与自动化证据全部通过。18 项任务完成后评估 delta spec 同步；本 change 使用 `skip_specs: true`，因此没有需要同步的 delta specs，随后按仓库当前流程正式归档。仅在用户明确要求或风险评估需要时追加独立 review。
