# Apply Evidence

本文件记录 apply 阶段可复核的基线、测试命令和外部门禁。它不是产品契约；产品语义仍由本 Change 的 specs/design/test-plan 及 owning docs 定义。

## 2026-09-30 基线

- Source：本 Change 在已有 Core API foundation 上新增 `access` 与只读 `project` capability，并创建首个可执行 Desktop；相关文件目前处于未提交工作树中。另一个 active change `make-openspec-apply-continuous` 由并行 session 所有，本 apply 不读取后改写、不删除。
- Migration：`V1` access identity、`V2` verification、`V3` session、`V4` Workspace/Membership/idempotency、`V5` Project/Project Membership。`V4` 允许未来解析 `PERSONAL`，但当前没有自动创建 Personal Workspace 的 use case、endpoint 或 fixture。
- API：固定 `/desktop/v1/auth/**`、`GET /desktop/v1/me`、`GET|POST /desktop/v1/workspaces` 与 `GET /desktop/v1/workspaces/{workspaceId}/projects`；没有 Project mutation API。
- 测试入口：Core API `./gradlew :services:core-api:qualityCheck`；Desktop `pnpm --filter @taskpilot/desktop qualityCheck`、`test:e2e`、`test:packaged`；最终使用 OpenSpec strict validation、scoped diff check 和 negative scan。
- 数据迁移判断：仓库没有生产部署清单、生产数据库连接或已实现的旧 Workspace schema；Workspace migration 本身由本 Change 首次引入。因此没有可识别的 Personal Workspace 生产数据需要迁移。若部署环境后续证明该前提不成立，必须先更新 Change，而不是在 apply 中猜测迁移。
- 并行边界：保留旧 `add-desktop-authentication` 的既有删除状态；不 reset/restore/clean 工作树；不修改另一个 active change；不以本地平台证据宣称 Windows release-ready，也不以自动 mail adapter 测试替代隔离邮件环境证据。

## 已执行门禁

- Core API clean `qualityCheck`：在 production SMTP 强制 required STARTTLS/implicit TLS 的最终实现上通过（35 tasks，包含 PostgreSQL/Testcontainers、Kover、ktlint、detekt、runtime OpenAPI 与 build contract）。
- Desktop `qualityCheck`：通过（Main 64、Renderer 33、Architecture 5；coverage 共 102 tests，statements 91.64%、branches 83.96%、functions 90.22%、lines 95.48%；build、typecheck、lint 均通过）。
- Renderer auth UI review slice：先确认字段错误 ARIA 关联与注册 pending 文案缺失的预期失败，修复后 Renderer 33 tests 通过。
- Desktop Cypress component：以 Electron headless 模式通过（13/13；未打开可见 GUI），覆盖认证流程分离、非枚举错误、字段聚焦、注册结果未知、continuation 过期、离线重试、防重复提交、Workspace/Project 空状态、窄窗口与 secret hygiene。
- macOS arm64 packaged/native：`pnpm --filter @taskpilot/desktop test:packaged-native` 通过，packaged artifact 包含原生 keyring，Keychain 生命周期为 `write` → `fresh-process-restore` → `rotate` → `delete`。
- macOS arm64 无窗口 packaged journey：以 `TASKPILOT_PACKAGED_SYSTEM_JOURNEY=true` 运行 `DesktopFirstUseSystemIntegrationTest` 通过；packaged Electron binary 使用 `ELECTRON_RUN_AS_NODE=1` 从真实 `app.asar` 加载编译后的 Main/Preload/IPC，并跨越真实 Core API、PostgreSQL、capture mail 与 Keychain，完成注册、密码/OTP 登录、password reset、refresh rotation、logout、Workspace list/create/idempotent retry/active restore 和真实 Project empty/data list。最小窗口、键盘、关键错误和 reduced-motion 由 Renderer/Cypress 无 GUI断言覆盖；packaged 最终视觉观感保留为对应平台发布前 smoke。
- OpenSpec strict validation、Change scoped 与全工作区 `git diff --check`：通过。
- Final gate rerun：当前最终工作树上的 Core API clean `qualityCheck` 通过（35 tasks 全部执行）；Desktop `qualityCheck` 通过（102 tests，statements 91.64%、branches 83.96%、functions 90.22%、lines 95.48%）；Cypress 使用 Electron 146 headless 运行并 13/13 通过；macOS arm64 packaged/native gate 通过。OpenSpec strict validation 与全工作区 `git diff --check` 均通过。
- Negative scan：未发现 Project mutation/`canCreateProject`、Gateway/Runtime 首次使用依赖、`safeStorage`/加密文件 credential fallback、独立 `Organization`/`organizationId` 实现；`.env.local` 被忽略且未被 Git 跟踪；owning docs 中仅保留“不自动创建 Personal”和“不假设 OIDC/JWT”的否定边界说明。Gateway 与 Agent Runtime 仍为 documentation-only。
- Production mail implementation：已补齐基于 Spring 标准 `JavaMailSender` 的供应商无关 SMTP transport；三类 purpose 模板、发件人与收件人换行拒绝、明确失败/结果未知分类均有 unit 证据。production 自动装配要求显式 sender/host 且必须启用 STARTTLS 或 implicit TLS，也允许部署显式注入其他 `VerificationMailTransport`；普通测试不连接真实 provider。
- 本地真实开发栈：`pnpm dev:test` 4/4 通过；`.env.local` 为 Git ignored 且权限 `0600`，Compose 配置有效，PostgreSQL 17.10 与 Mailpit 容器均为 healthy 且仅绑定 loopback。Core API `local` profile 真实启动，连接 PostgreSQL、校验 5 个 Flyway migrations 并监听 `127.0.0.1:8080`。`pnpm dev:mail-smoke` 从 Mailpit HTTP API 读取经真实 SMTP 投递的邮件，注册、login OTP、password reset 三条流程全部通过；输出未记录验证码、密码、token 或本地 secret。

## 外部证据状态

- 安全组件基线：Gradle `dependencyInsight` 确认 Spring Security Crypto `7.1.1` 与 Bouncy Castle `1.86`；Desktop 使用 `@napi-rs/keyring 2.1.0`。实现使用 `SecureRandom`、HMAC-SHA-256 pepper digest、PostgreSQL-backed shared rate limit、可替换 mail transport 和 OS credential namespace；仓库未提交 secret。
- 当前执行环境清单：`uname -sm` 为 `Darwin arm64`；仓库没有 Git remote、CI workflow 或 Windows runner 配置。当前进程环境没有 SMTP/mail provider credential，仓库亦没有可用的隔离部署环境。因此不能在本执行器上产生 Windows x64 发布 smoke 或真实 provider smoke 证据。Windows x64 发布 smoke 不阻塞本 Change，但在完成前不得宣称 Windows release-ready。

Windows x64 安装、Credential Manager、签名安装包与最终视觉证据保留为 Windows 发布前 smoke，不再阻塞本 Change；macOS 结果不得冒充 Windows release evidence。隔离环境真实邮件 provider smoke 是对应部署宣称 mail-provider release-ready 前的发布门禁，不阻塞本 Change；本地 Mailpit 证据不能替代公网投递证据。`22.7` 已由真实 PostgreSQL、Flyway、SMTP 与 Mailpit 链路关闭。`22.8` 必须在当前最终工作树上重跑完整质量门后才能勾选。
