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
- Typed presentation of cloud state, Runtime progress, logs, approvals, Diff,
  and artifacts without becoming their business source of truth.
- System-browser login initiation and callback handoff at the boundaries later
  defined by the authentication spec.
- Native dialogs, notifications, credential handles, deep links,
  single-instance behavior, and platform lifecycle integration.
- Main-owned authenticated Desktop API consumption and Main-to-Runtime
  process, version, health, and connection supervision.

## Does Not Own

- Canonical business invariants, authorization, workflow progression, Agent Run
  truth, or approval authority.
- Agent/model execution, tool policy, workspace file access, PTY/process trees,
  execution journaling, Diff calculation, or artifact production.
- Public HTTP API compatibility, Gateway policy, or Core API persistence.
- OS-level isolation of arbitrary processes.

## Internal Ownership

| Area | Responsibility |
| --- | --- |
| `main/app` | Electron lifecycle, windows, single-instance behavior |
| `main/ipc` | IPC sender/origin/session authorization, schema validation, rate/size limits, dispatch |
| `main/cloud-client` | Credentialed Desktop API requests, token refresh, logout cleanup and transport errors |
| `main/native` | Credential, dialog, notification, deep-link and platform adapters |
| `main/runtime-client` | Trusted Runtime launch, authenticated/versioned connection, health and reconnect state |
| `preload` | Narrow typed capabilities exposed to a sandboxed Renderer |
| `renderer/app` | Providers, routing, auth boundary, global error handling |
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
  their owner; Renderer checks are usability, not authorization.
- Workspace selection uses a native picker, but authorization enforcement and
  canonical path checks belong to Runtime.
- High-risk local execution UI explains the immutable evaluated operation and
  records `Local Execution Consent`; Runtime enforces whether that operation may
  execute. A cloud `ApprovalRequest` is rendered and decided through Core API
  and is never inferred from local consent.
- Business terms and allowed actions come from the business model and cloud
  contract rather than being reconstructed from role names in the client.

## Initial Interaction Areas

The Target UI may include login, Workspace/Project selection, Board and Work
Item workflows, Agent configuration, Run monitoring, approval prompts, logs,
Diff review, and artifact access. This inventory is not an implementation claim
or permission to create all pages in one change.

## Security and Privacy

- Renderer content security policy disallows arbitrary remote code.
- External URLs open through an allowlisted native boundary.
- Secrets are represented by opaque handles outside Main/native adapters.
- Logs, Diff, clipboard, notifications, and crash reports apply explicit
  redaction and user-consent rules defined by later behavior specs.
- Window restoration must not expose one user's or Workspace's sensitive state
  to another authenticated session.
