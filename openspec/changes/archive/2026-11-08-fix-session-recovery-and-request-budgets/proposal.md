# Proposal

## Why

当前 Desktop 闲置到 access token 过期后退出可能只清除本地凭据而未撤销 Redis session；暂时不可用页面的 Retry 也只重载 Renderer，无法恢复 Main 会话。此外，合法的 5000 code point 描述可能超过 IPC/Core 的 16 KiB 原始字节预算。修复这些已确认缺陷，同时保留凭据轮换、安全边界和产品文本规则。

## What Changes

- C1：在既有 `POST /v1/session:logout` 增加 refresh credential body 撤销方式，保留无 body/空对象配合 access bearer 的旧方式。Desktop Main 优先使用已持有的 refresh 凭据，退出不额外 refresh。Redis 原子撤销同一 session，包含与 rotation 竞争的情况。
- C2：将 Desktop IPC 和 Core 请求体预算设为 128 KiB（131072 字节），允许精确边界，超限仍拒绝。Gateway 默认 1 MiB 请求预算不变；部署必须容纳 Core 的预算。产品 NFC/code point 上限、sparse edit 与历史值兼容规则不变。
- C3：增加无参数的窄 `auth.retrySessionRestore()` capability；Retry 显式重试 Main 恢复，不重载窗口。`getSessionView()` 保持只读。恢复与 refresh 共享 single-flight；退出/账号切换通过 generation fencing 使旧操作失效，不等待旧 HTTP flight。
- 不新增 HTTP 路径、数据库表、依赖或业务模型对象；C4 端口冲突与 D1/D2 文档局部修复已在前一轮完成，不属于本 Change。

## Business Model Impact

- 方法：具体场景映射、会话状态转换分析和凭据信任边界威胁分析，不引入战术 DDD。
- Actor 为当前 User，通过 Desktop Main 操作自身 session。User、Workspace、Project、Work Item 和 Membership 的稳定身份、拥有关系、基数、授权、版本与历史均无模型变化；本 Change 实现 `docs/business-model.md` 的 Current 文本写入规则和 `desktop-authentication` 已批准的退出、轮换及秘密隔离规则。
- Session 属于同一 User 的一次登录，与其他 session 隔离；refresh 凭据只允许撤销其自身可解析到的 session，不接收客户端指定的 UserId/sessionId/tenant scope。旧 bearer 方式的权限不扩大，access TTL 不延长。
- `temporarilyUnavailable → restoring → authenticated/signedOut/temporarilyUnavailable` 是客户端恢复状态而非 User/Work Item 业务生命周期。恢复只有安全保存凭据后才发布 authenticated；terminal 401 清理凭据，临时网络/Gateway/Core 故障保留可能有效的 refresh 凭据。
- 异步边界涵盖 OS credential store、Gateway/Core 与 Redis：重复点击不能重复消费 refresh，退出及账号替换先 fence，迟到读取、写入、错误与返回值不得改变新状态。Redis 原子撤销与 rotation 对所有执行顺序均不能留下有效凭据。
- 威胁边界：refresh 凭据永不进入 Renderer、URL、日志或示例；只在受控 Main HTTPS transport 与 Core Access 内使用。超限 body、错误 IPC sender、双凭据歧义及伪造 scope 在副作用前拒绝。
- 无网络或 OS 存储故障时不保证服务端立即撤销；退出仍优先使本地 UI 失效并 best-effort 撤销，清理失败由 App 在 signedOut 登录页显示安全可访问的提示，不伪造成功保存/删除；旧退出错误不得带入新登录/账号状态。

## Capabilities

### New Capabilities

无；复用现有能力。

### Modified Capabilities

- `desktop-authentication`：定义 refresh-based logout、退出/轮换竞争、显式且单飞的 Main session 恢复和 Retry 行为。
- `canonical-resource-api`：扩展同一 logout operation 的认证与请求声明，定义合法产品文本与有界传输预算的关系。

## Impact

- Canonical contract：`contracts/canonical-api/openapi.yaml`、build-only HTTP projection 和契约测试；method/path/operationId 不变，新增可选请求 schema 与认证说明，不提交生成源码。
- Core Access：`AuthenticationController`、`SessionUseCases`、`RedisSessionUseCases` 以及 `DesktopRequestGuardFilter`；logout 的通用 bearer filter 分支由精确 operation 的独立 adapter 校验替代，其他 route 不变；对应 Redis、HTTP、契约及边界测试。
- Desktop：`main/session/session-coordinator.ts`、`main/composition.ts`、`main/ipc.ts`、shared contracts、Preload、Renderer `app/App.tsx`、`features/shell/project-home.tsx`、双语错误提示与对应测试；App 统一承接两个退出入口的错误，不重塑 UI。
- 升级顺序为先 Core/contract 后 Desktop；旧客户端可继续 bearer logout，新客户端不能先于支持 refresh logout 的 Core 发布。Redis 复用现有 active/used digest 和 session 数据结构，无 schema 迁移。离线退出不新增持久撤销队列。

## Documentation Impact

- `docs/business-model.md`：产品词汇、关系、生命周期和文本限制不变，无新增模型段落；Apply 核验现有 Current 规则即可，不把所有 Target 内容改为 Current。
- `docs/architecture.md`：在实现后确认新 logout 认证契约、恢复并发边界及跨层预算，保持 Core 最终授权/Gateway 技术入口职责。
- `services/core-api/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md`：在对应实现切片记录 Access 撤销与 body guard 行为及实际测试覆盖。
- `apps/desktop/docs/architecture.md`、`responsibilities.md`、`testing-strategy.md`：记录窄 retry capability、Main 秘密/状态拥有权、single-flight/fencing 与实际测试证据。
- `contracts/canonical-api/docs/architecture.md`、`testing-strategy.md`：记录 logout 两种方式和投影/认证 metadata 检查。不新增工程文档，不改变地图所有权。
- 两份 main spec 仅在明确授权 sync/archive 后合并 delta；本轮所有新行为是 Proposed，不能宣称已实现。Apply 完成需独立代码评审及手工验收，之后仍等待明确归档授权。
