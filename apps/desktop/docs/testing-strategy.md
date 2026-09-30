# Desktop Testing Strategy

- **Status:** Target
- **Owns:** Desktop test layers, Electron boundary tests, packaged application
  journeys, accessibility checks, and Windows/macOS release evidence
- **Read after:** [`architecture.md`](architecture.md),
  [`responsibilities.md`](responsibilities.md),
  [`../../../docs/architecture.md`](../../../docs/architecture.md)
- **Mandatory before:** Adding or changing Desktop behavior, IPC, native
  integration, packaging, updates, or tests

## Principles

Use the lowest reliable layer for each risk and add packaged/native tests only
for boundaries that unit or Renderer integration tests cannot prove. Tests and
production behavior land together.

**Current:** Vitest owns Main, Renderer, architecture, and coverage checks;
Cypress component tests own browser-level first-use interaction; Vite and
TypeScript own production builds; electron-builder owns unpacked packaged builds.
Run `pnpm --filter @taskpilot/desktop qualityCheck` for the complete portable
Desktop gate, `pnpm --filter @taskpilot/desktop test:e2e` for Cypress component
journeys, and `pnpm --filter @taskpilot/desktop test:packaged-native` for the
current host's packaged artifact and native credential lifecycle. `test:e2e`
uses `cypress run --component` in headless Electron; it must not open Cypress GUI
or a visible application window. A development Change can complete with the
portable gates plus current-host packaged/native evidence. Installation,
signing/notarization or signed-installer behavior, native credential integration,
and final visual smoke are recorded separately on macOS arm64 and Windows x64
before claiming that platform is release-ready.

The opt-in Core API system test selected by
`TASKPILOT_PACKAGED_SYSTEM_JOURNEY=true` launches the current platform's
packaged Electron binary with `ELECTRON_RUN_AS_NODE=1`, loads the compiled
Main/Preload modules from `app.asar`, and crosses typed IPC into the real Core
API/PostgreSQL fixture, capture-mail adapter, and native OS credential backend.
It intentionally creates no `BrowserWindow`, and the normal Core API gate does
not build or require a Desktop package. This proves packaged code and native
credential boundaries, not packaged window layout, keyboard behavior, visual
error states, signing, installer, or the other operating system.

## Test Layers

| Layer | Owns |
| --- | --- |
| Pure unit | Presentation policies, reducers, schema validation, mapping, path-independent decisions |
| Renderer integration | Components, Hooks, query/cache behavior, accessibility, loading/error/recovery states |
| Main/Preload contract | Channel allowlist, schema validation, serialization, authorization and capability exposure |
| Main integration | Window lifecycle, opaque-session refresh/recovery, credential adapter, authenticated cloud client, lazy fixed-path Runtime launch, JSON-RPC/JSONL stdio, backpressure and child supervision with owned test doubles |
| Packaged Desktop journey | Real packaged Electron/Chromium process boundaries and critical user outcomes |
| Native OS validation | Credential store, deep link, notification, installer, signing, update, process lifecycle on supported Windows/macOS targets |

## Security-Critical Cases

- Renderer has no Node/Electron globals; `nodeIntegration` stays disabled,
  `contextIsolation`, sandboxing, and `webSecurity` stay enabled, and `<webview>`
  and the remote module are unavailable.
- Invalid, oversized, stale, cross-session, wrong-origin, wrong-frame, or
  unauthorized IPC messages fail closed without invoking native, cloud, or
  Runtime effects; tests exercise `event.senderFrame` validation.
- Credential values, provider secrets, SDK objects, raw callbacks, raw status
  names, and remote handles never cross into Renderer, logs, snapshots, crash
  data, command lines, or environment variables. Renderer cannot send
  authenticated cloud requests directly.
- Navigation, new windows, permission requests, downloads, external URLs, file
  dialogs, deep links, and callback inputs are deny-by-default, allowlisted, and
  validated.
- Production CSP, Electron Fuses, packaged-resource integrity, and update
  signature/anti-downgrade behavior are checked against the packaged artifact.
- A Runtime outside the fixed packaged path, a replaced packaged binary, an
  incompatible protocol/build, a malformed or oversized JSONL message, a missing
  request ID, or protocol contamination on stdout fails before execution.
- Bounded queues apply backpressure without unbounded memory growth; cancellation,
  EOF, child crash, graceful-shutdown timeout, and forced termination settle every
  pending request exactly once and do not leave an owned Runtime process tree.
- A new Desktop process starts a new Runtime rather than attaching to an orphan.
  Restart cannot replay an approval or local consent, reuse a stale lease/fencing
  token, or duplicate a local operation.
- Logout and account switching clear OS-held credential material, applicable
  Main cloud-client session state, and Renderer-visible protected state; the
  previous account cannot remain usable.

The first implementation slice tests separate in-app registration/password
login/email-code login/password-reset flows, complete refresh-response mapping,
credential-write failure, crash/restart recovery, logout, Workspace
list/select/create, active Workspace restoration, and a real read-only Project
list. Project tests cover the fixed HTTP adapter and typed IPC capability,
protected-API `401` single-flight recovery, environment/`UserId`/`WorkspaceId`
query scope, Workspace-switch late responses, item-scope mismatch rejection,
cursor pagination, and distinct loading/data/empty/error states. The same suite
proves there is no Project create endpoint/capability/CTA and no Runtime startup.
Project mutations and Agent-execution scenarios remain later capability changes.

## Agent Presentation Boundary

- Provider-neutral DTO mapping rejects or strips provider SDK and raw payload
  fields before a value reaches Renderer.
- Capability-driven UI renders supported actions and explicit unsupported states
  without branching on a provider name.
- A `REMOTE_MANAGED` run remains viewable and reloadable when Agent Runtime is
  not installed, not started, incompatible, or unhealthy.
- Runtime startup failure affects only `LOCAL_DESKTOP` actions and cannot fail
  authentication, Workspace list/select/create, active Workspace restoration, or
  the read-only Project list.

## Renderer Behavior

Test user-observable states rather than implementation details: success, empty,
loading, rejection, permission denied, connection loss/recovery, stale response, partial log,
large output, keyboard focus, and reduced motion where applicable. Mock at the
Preload capability boundary, never by importing Main internals into Renderer
tests. Main cloud-client tests own the HTTP adapter and credential lifecycle.

## Packaged and Native Matrix

Electron uses packaged Chromium on both supported operating systems. The
portable development gate covers Main/Preload contracts, Renderer behavior,
headless Chromium interaction, build output, and the current host's packaged
artifact plus native credential lifecycle. It does not imply that an unexecuted
platform is release-ready.

Before releasing a platform, its native matrix additionally covers:

- installation and launch of the platform artifact;
- macOS Keychain or Windows Credential Manager integration;
- signing/notarization or signed-installer and update checks;
- final visual smoke for the critical journey and system prompts;
- bundled Runtime path resolution, stdio lifecycle, parent-exit behavior, and
  whole-process-tree cleanup once Runtime ships.

A passing Renderer browser test is not evidence that IPC, packaging,
credentials, deep links, installers, or process lifecycle work natively. A
passing macOS native test is not Windows evidence, and vice versa; this limits
release claims rather than blocking an otherwise portable feature Change.

## Architecture Regression Checks

Once source exists, automated checks enforce no Renderer-to-Node/Electron
imports, no raw channel strings outside the IPC owner, no Main-to-Agent
implementation dependency, and no deep imports across Renderer domain-module
owners. Fixture-based allowed/forbidden examples accompany those rules.

## Quality Gates

After initialization, a Desktop change is incomplete until focused tests,
strict type checking, lint/formatting, architecture checks, relevant
accessibility assertions, IPC contract checks, and risk-appropriate current-host
packaged or native checks pass. A release claim for macOS or Windows additionally
requires that platform's native release matrix; emulation or another host is
insufficient evidence for that platform.
