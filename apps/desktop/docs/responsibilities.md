# Desktop Responsibilities

- **Status:** Target
- **Owns:** First-party Desktop interaction, Electron capability placement,
  Renderer state ownership, native integration, and Runtime presentation
- **Read after:** [`../../../docs/business-model.md`](../../../docs/business-model.md),
  [`architecture.md`](architecture.md)
- **Mandatory before:** Adding a window, page, component, Hook, IPC capability,
  native adapter, or Runtime-facing interaction

## Owns

- Window lifecycle, navigation, application shell, and first-party workflows.
- Accessible keyboard and pointer interaction in the React Renderer.
- Renderer-owned `zh-CN`/`en` locale resolution, non-sensitive local
  preference, static message resources, English ordinary-message fallback, and
  synchronization of the document language; no localization IPC or remote
  resource loader.
- Provider-neutral typed presentation of cloud state, Agent Run progress,
  normalized capabilities, logs, approvals, Diff, and artifacts without becoming
  their business source of truth.
- System-browser GitHub authentication interaction, Main-owned attempt recovery,
  OS credential persistence, and safe authenticated-state handoff to Renderer.
- Native dialogs, notifications, credential handles, deep links,
  single-instance behavior, and platform lifecycle integration.
- Main-owned authenticated Desktop API consumption and, only when a
  `LOCAL_DESKTOP` capability is invoked, Main-to-Runtime child launch, stdio
  protocol, version/capability, health, shutdown, and failure supervision.

### Federated authentication placement

- Renderer owns the single GitHub action, safe waiting/registration/error views,
  the read-only first-registration User Agreement and Privacy Policy, exact known
  bundle matching, and no authentication secrets.
- Preload owns fixed typed authentication, Workspace, and Project capability
  bridges; it exposes no bearer, endpoint URL, `fetch`, or generic IPC.
- Main owns `shell.openExternal`, the one-shot `127.0.0.1` receiver, valid-proof
  window restoration/show/focus, private attempt-recovery records, direct session
  credential handoff, timers, and window cleanup.
- Core API owns Provider exchange, External Identity resolution, registration,
  session activation, expiry and disabled-User enforcement.
- Deep links, embedded browser/WebView authentication, Provider selection and
  release-platform certification are outside this implementation slice.

## Does Not Own

- Canonical business invariants, authorization, workflow progression, Agent Run
  truth, or approval authority.
- Agent/model execution, tool policy, workspace file access, PTY/process trees,
  execution journaling, Diff calculation, or artifact production.
- Public HTTP API compatibility, Gateway policy, or Core API persistence.
- Remote-provider SDKs, credentials, callbacks, raw status vocabularies, or
  remote-handle reconciliation.
- OS-level isolation of arbitrary processes.

## Internal Ownership

| Area | Responsibility |
| --- | --- |
| `main/app` | Electron lifecycle, windows, single-instance behavior |
| `main/ipc` | IPC sender/origin/session authorization, schema validation, rate/size limits, dispatch |
| `main/cloud-client` | Credentialed Desktop API requests, fixed Workspace/Project route allowlist, token refresh, logout cleanup and transport errors |
| `main/projects` | Typed Workspace/Project response validation, Project-home selection, session-generation fencing, and the environment-plus-User recent-Project device preference |
| `main/native` | Credential, dialog, notification, deep-link and platform adapters |
| `main/runtime-client` | Fixed-path Runtime launch, JSON-RPC/JSONL stdio client, generated contracts, version/capability negotiation, health, cancellation, shutdown and child failure state |
| `preload` | Narrow typed capabilities exposed to a sandboxed Renderer |
| `renderer/app` | Providers, routing, auth boundary, global error handling |
| `renderer/i18n` | Supported locale resolution, safe local preference, static message catalogs, fallback policy and document-language synchronization |
| `renderer/pages` | Route/window entry and page composition |
| `renderer/modules/<domain>` | Cohesive first-party UI capability and its presentation logic |
| `renderer/components` | Application-wide business-neutral React components |
| `renderer/api` | Query-facing adapters over typed Preload cloud capabilities plus error normalization; no credentials or direct authenticated HTTP |
| `shared-ipc` | Serializable process-boundary schemas; no implementation logic |

## Placement Rules

- A Renderer component never imports Electron, Node, Preload internals, cloud
  endpoint functions, or Runtime protocol clients directly.
- Preload APIs are capability-based (`selectWorkspace`, `subscribeRunView`),
  not generic (`send`, `invoke`, `readFile`, `exec`).
- Main handlers validate identity, schema, scope, and lifecycle before calling
  their owner; Renderer checks are usability, not authorization. A live stdio
  channel is transport reachability, not execution authority.
- Cloud Workspace selection uses the authenticated Workspace list and stable
  `WorkspaceId`; only a later `LocalWorkspaceBinding` flow uses a native
  directory picker, whose canonical path checks and execution enforcement belong
  to Runtime.
- High-risk local execution UI explains the immutable evaluated operation and
  records `Local Execution Consent`; Runtime enforces whether that operation may
  execute. A cloud `ApprovalRequest` is rendered and decided through Core API
  and is never inferred from local consent.
- Business terms and allowed actions come from the business model and cloud
  contract rather than being reconstructed from role or provider names in the
  client.
- Renderer consumes normalized capabilities and provider-neutral view models.
  Provider-specific configuration UI, if later required, stays behind a narrow
  adapter and cannot leak into Project, Board, Work Item, workflow, or generic
  Agent Run models.
- Runtime absence disables only `LOCAL_DESKTOP` capabilities; it cannot block
  login, application shell, Workspace/Project operations, or viewing a
  `REMOTE_MANAGED` run.

## Initial Interaction Areas

The Current implementation slice includes system-browser GitHub authentication,
first-registration confirmation with legal-document review, crash-safe attempt
resume, OS-credential-backed session restore/refresh/logout, and the authenticated
Project home. Renderer owns the fixed personal-Workspace context, ACTIVE Project
list/switching, create/edit/archive/restore/permanent-delete interactions,
truthful loading/error/empty states, and reachable account/language/logout
controls. Main additionally owns fixed allowlisted Workspace/Project HTTP
operations, typed response validation, registration-bootstrap and
recent-Project fallback resolution, a non-authoritative recent-Project device
preference partitioned by environment and `UserId`, and session-generation
fencing. Preload owns narrow typed Auth, Workspace, and Project capabilities;
every Project result carries a Main-produced response key and IPC remains
channel-specific and validated.

TEAM Workspace behavior and membership management are not exposed. The current
slice does not start Agent Runtime.
Later Target UI may include Board and Work Item workflows, provider-neutral
Agent configuration, Run monitoring, approval prompts, logs, Diff review, and
artifact access. This inventory is not an implementation claim or permission to
create all pages in one change.

## Security and Privacy

- Renderer content security policy disallows arbitrary remote code.
- External URLs open through an allowlisted native boundary.
- Secrets are represented by opaque handles outside Main/native adapters.
- Logs, Diff, clipboard, notifications, and crash reports apply explicit
  redaction and user-consent rules defined by later behavior specs.
- Window restoration must not expose one user's or Workspace's sensitive state
  to another authenticated session.
