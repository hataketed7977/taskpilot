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
or a visible application window. The Desktop development-loop regression
checks cover the fixed loopback Renderer origin, production CSP preservation,
sandbox-compatible bundled Preload, and the root controller's `dev` command;
manual editing is not the primary proof of those contracts. A development
Change can complete with the portable gates plus current-host packaged/native
evidence. Installation,
signing/notarization or signed-installer behavior, native credential integration,
and final visual smoke are recorded separately on macOS arm64 and Windows x64
before claiming that platform is release-ready.

The portable local system test crosses compiled Main, IPC, and Preload into a
real loopback Core API backed by PostgreSQL and Redis. Test-only Provider,
browser, credential, and session-failure doubles exercise first registration
into the default Project, recent/fallback selection after login, last-Project
empty state, post-commit session failure recovery, cancellation/restart, absence
of retired email routes, and zero Agent Runtime dependency without adding a
production test endpoint. Real GitHub OAuth and native credential persistence
remain separate manual/current-platform evidence. The previous capture-mail
packaged journey was removed with the email-auth capability; the portable system
journey alone implies no packaged or native result.

## Test Layers

| Layer | Owns |
| --- | --- |
| Pure unit | Presentation policies, reducers, schema validation, mapping, path-independent decisions |
| Renderer integration | Components, Hooks, query/cache behavior, accessibility, loading/error/recovery states |
| Main/Preload contract | Channel allowlist, schema validation, serialization, sender/origin/top-frame/window-generation authorization, keyed Workspace/Project responses, and fixed capability exposure |
| Main integration | Fixed federated and Workspace/Project clients, HTTP method/path/query allowlists, typed response validation, bootstrap/recent/fallback selection, environment-plus-User preference isolation and failure degradation, loopback method/path/body/size rules, attempt crash recovery, system-browser URL allowlist, direct session handoff, refresh rotation, credential adapter, authenticated cloud client, and generation fencing with owned test doubles |
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

The Current Main/Preload suite covers GitHub capability discovery,
receiver-before-attempt/browser ordering, exact loopback validation and restart
rebinding, valid-proof-only Desktop activation, Main-only registration
continuation, direct session handoff, credential-write failure cleanup, refresh
rotation, logout, legal-document navigation and draft retention, cancellation
without an extra restart step, authenticated Project-home presentation, and
session generation fencing. It also covers the Workspace/Project HTTP allowlist and
typed contracts, registration bootstrap, environment-plus-User recent-Project
partitioning, valid and stale preference fallback, corrupt/read/write-failed
preference degradation, terminal `401` cleanup, channel-specific IPC validation,
and late-result rejection after logout or account replacement. Renderer tests
also cover initial/default/recent/fallback Project selection, create/edit,
archive/restore/permanent-delete and post-delete selection, retryable errors,
empty state, bilingual copy, logout, and stale keyed-result rejection. These
tests prove Renderer receives no token, URL, generic network or generic IPC
capability and that the slice does not start Agent Runtime. Agent-execution
scenarios remain later changes.

## Agent Presentation Boundary

- Provider-neutral DTO mapping rejects or strips provider SDK and raw payload
  fields before a value reaches Renderer.
- Capability-driven UI renders supported actions and explicit unsupported states
  without branching on a provider name.
- A `REMOTE_MANAGED` run remains viewable and reloadable when Agent Runtime is
  not installed, not started, incompatible, or unhealthy.
- Runtime startup failure affects only future `LOCAL_DESKTOP` actions and cannot
  fail the current authentication/session journey.

## Renderer Behavior

Test user-observable states rather than implementation details: success, empty,
loading, rejection, permission denied, connection loss/recovery, stale response,
partial log, large output, keyboard focus, and reduced motion where applicable.
Mock at the Preload capability boundary, never by importing Main internals into
Renderer tests. Main cloud-client tests own the HTTP adapter and credential
lifecycle.

**Current bilingual evidence:** Renderer tests cover ordered system-language
resolution, saved-preference precedence, English fallback, storage failure,
message-key parity, immediate `<html lang>` updates, offline switching with no
auth request, and preservation of flow/session/profile state. Legal-catalog tests
cover exact `zh-CN`/`en` quartets, UTC date formatting, no cross-locale legal
fallback, and consent invalidation without losing non-legal registration input.
Cypress exercises login, waiting, error, registration, focus retention,
keyboard-scrollable legal content, and account switching at `960 × 640`, plus
the existing `480 × 640` auth overflow regression. It also covers the bilingual
Project shell at `960 × 640`, long Project names/descriptions, no horizontal
overflow, visible primary actions, dialog focus trap and focus restoration,
mutation-error association, exact-name permanent deletion, archived restoration,
and reduced-motion styling. Long English copy wraps without horizontal loss or
hiding primary actions.

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

## Federated Login Evidence Boundary

Main/Preload automated tests use a fixed HTTP client, loopback/browser doubles and
credential stores; they do not open a real browser or call GitHub. Renderer and
Cypress tests prove the safe bilingual capability experience, no-date consent
copy, in-app keyboard-accessible legal-document navigation with draft retention,
exact bilingual bundle selection, locale-switch consent invalidation, and
unknown-bundle failure. Packaged Electron,
native credential prompts, real GitHub OAuth, macOS signing/notarization and
Windows installer behavior require separate manual/current-platform evidence and
are not implied by the portable gates. No deep-link or WebView path exists to
test in this slice.
