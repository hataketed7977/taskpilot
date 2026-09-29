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
production behavior land together. Exact frameworks and commands are recorded
when the application toolchain is initialized.

## Planned Test Layers

| Layer | Owns |
| --- | --- |
| Pure unit | Presentation policies, reducers, schema validation, mapping, path-independent decisions |
| Renderer integration | Components, Hooks, query/cache behavior, accessibility, loading/error/recovery states |
| Main/Preload contract | Channel allowlist, schema validation, serialization, authorization and capability exposure |
| Main integration | Window lifecycle, callback routing, credential adapter and Runtime connection supervision with owned test doubles |
| Packaged Desktop journey | Real packaged Electron/Chromium process boundaries and critical user outcomes |
| Native OS validation | Credential store, deep link, notification, installer, signing, update, process lifecycle on supported Windows/macOS targets |

## Security-Critical Cases

- Renderer has no Node/Electron globals and cannot invoke undeclared channels.
- Invalid, oversized, stale, cross-session, or unauthorized IPC messages fail
  closed without invoking native or Runtime effects.
- Credential values never cross into Renderer, logs, snapshots, or crash data.
- External navigation, file dialogs, deep links, and callback inputs are
  allowlisted and validated.
- Runtime reconnect cannot replay an approval or duplicate a local operation.
- Logout and account switching cannot retain the previous session's protected
  state.

The detailed login and execution scenarios are added by their future capability
changes; this Target strategy does not claim those tests exist.

## Renderer Behavior

Test user-observable states rather than implementation details: success, empty,
loading, rejection, permission denied, reconnect, stale response, partial log,
large output, keyboard focus, and reduced motion where applicable. Mock at the
Preload or HTTP adapter boundary, never by importing Main internals into
Renderer tests.

## Packaged and Native Matrix

Electron uses packaged Chromium on both supported operating systems. The
release matrix therefore covers:

- packaged macOS arm64 critical journeys and native integrations;
- packaged Windows x64 critical journeys and native integrations;
- architecture-specific artifacts added only when product support declares
  them;
- signing/notarization and installer/update checks in their native environment.

A passing Renderer browser test is not evidence that IPC, packaging,
credentials, deep links, installers, or process lifecycle work natively.

## Architecture Regression Checks

Once source exists, automated checks enforce no Renderer-to-Node/Electron
imports, no raw channel strings outside the IPC owner, no Main-to-Agent
implementation dependency, and no deep imports across Renderer domain-module
owners. Fixture-based allowed/forbidden examples accompany those rules.

## Quality Gates

After initialization, a Desktop change is incomplete until focused tests,
strict type checking, lint/formatting, architecture checks, relevant
accessibility assertions, IPC contract checks, and risk-appropriate packaged or
native checks pass. Cross-platform release claims require evidence from both
supported operating systems; emulation or one host alone is insufficient.
