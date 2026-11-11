# Desktop Testing Strategy

- **Status:** Current foundation with Target extensions
- **Owns:** Desktop test layers, Electron boundary tests, packaged application
  journeys, accessibility checks, and Windows/macOS release evidence
- **Read after:** [`architecture.md`](architecture.md),
  [`responsibilities.md`](responsibilities.md),
  [`../../../docs/architecture.md`](../../../docs/architecture.md)
- **Mandatory before:** Adding or changing Desktop behavior, IPC, native
  integration, packaging, updates, or tests

## Current Session and Request-Budget Regression Evidence

Focused Main tests exercise whole-flight startup/refresh/Retry joining,
generation fencing and identity-safe finalizers; logout read/clear/new-save order,
offline revocation, and storage failures. Bootstrap captures startup generation
before Renderer load and federated recovery. IPC/Preload tests pin argument-free
Retry, sender validation and UTF-8 body size. Renderer tests cover subscription-
authoritative Retry, pending/double clicks/late return, both logout entries after
ProjectHome unmounts, bilingual accessible cleanup warning, dismissal and new
login/API/unmount fencing. Changed UI still requires packaged Chromium manual
acceptance; jsdom is not native UI evidence.

IPC and Core accept exactly 131072 bytes and reject 131073. Complete create/SET
edit fixtures contain 160-code-point titles, 5000 emoji or NFD text whose NFC
length is 5000, and full scope/version/patch metadata. Core additionally tests
Unicode-escaped JSON, known length and real chunked bodies. Existing field-limit,
sparse edit and historical-response cases remain required. The system journey
uses compiled Main/IPC/Preload → real Gateway/Core/PostgreSQL/Redis for temporary
recovery → explicit Retry, expired-access refresh-based logout, and large Unicode
create/SET edit. Test-only session doubles expire the real Redis access index and
fail one refresh; there is no production test endpoint or Core fallback.

## Principles

Use the lowest reliable layer for each risk and add packaged/native tests only
for boundaries that unit or Renderer integration tests cannot prove. Tests and
production behavior land together.

**Current:** Vitest owns Main, Renderer, architecture, and source coverage
checks; Cypress component tests own browser-level auth, shell, board, detail,
and shared-control interaction evidence outside the coverage percentage; Vite
and TypeScript own production builds; electron-builder owns unpacked packaged
builds. Run `pnpm --filter @taskpilot/desktop qualityCheck` for the complete
portable Desktop gate, `pnpm --filter @taskpilot/desktop test:e2e` for Cypress
component journeys, and `pnpm --filter @taskpilot/desktop test:packaged-native`
for the current host's packaged artifact and native credential lifecycle.
`test:coverage` runs Vitest V8 coverage over `tests/main`, `tests/renderer`, and
`tests/architecture`, includes `src/**/*.{ts,tsx}`, excludes entry shells that
only wire process startup, and emits `coverage/index.html`,
`coverage/cobertura-coverage.xml`, and `coverage/coverage-summary.json` in
addition to terminal text. Cypress execution is reported as browser-level
interaction/layout/focus evidence and is not merged into Vitest line or branch
percentages. `test:e2e` uses `cypress run --component` in headless Electron; it
must not open Cypress GUI or a visible application window. The Desktop
development-loop regression
checks cover the fixed loopback Renderer origin, production CSP preservation,
sandbox-compatible bundled Preload, and the root controller's `dev` command;
manual editing is not the primary proof of those contracts. A development
Change can complete with the portable gates plus current-host packaged/native
evidence. Installation,
signing/notarization or signed-installer behavior, native credential integration,
and final visual smoke are recorded separately on macOS arm64 and Windows x64
before claiming that platform is release-ready.

The portable local system test crosses compiled Main, IPC, and Preload through
a real packaged loopback Gateway into Core API backed by PostgreSQL and Redis.
The Desktop subprocess receives only `TASKPILOT_SYSTEM_BASE_URL` for Gateway and
has Core URL/port variables removed. Test-only Provider,
browser, credential, and session-failure doubles exercise first registration
into the default Project, recent/fallback selection after login, last-Project
empty state, post-commit session failure recovery, cancellation/restart,
Gateway-stopped/Core-still-running no-fallback behavior, Core-unavailable stable
Gateway transport errors, credential retention on temporary failures, absence
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
| Main/Preload contract | Channel allowlist, schema validation, serialization, sender/origin/top-frame/window-generation authorization, keyed Workspace/Project/Board responses, Board-scoped Work Item detail responses, Project Member candidate responses, assignee patch validation, mutation/read generations, permanent-delete validation, and fixed capability exposure |
| Main integration | Fixed federated, Workspace/Project, and Project Work clients; HTTP allowlists; typed response validation; initial/recent Project and Board fallback; environment-plus-User preference isolation; explicit Board deletion commit/refresh behavior; response-lost reconciliation, tombstones/isolation and operation-start fencing; loopback/auth/session handling; and generation fencing with owned test doubles |
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
  Main API transport, session state, credential state, and Renderer-visible protected state; the
  previous account cannot remain usable.

The Current Main/Preload suite covers GitHub capability discovery,
receiver-before-attempt/browser ordering, exact loopback validation and restart
rebinding, valid-proof-only Desktop activation, Main-only registration
continuation, direct session handoff, credential-write failure cleanup, refresh
rotation, logout, legal-document navigation and draft retention, cancellation
without an extra restart step, authenticated Project-home presentation, and
session generation fencing. It also covers Gateway-only origin selection,
canonical paths, absence of Core fallback, and the Workspace/Project HTTP
allowlist and
typed contracts, registration bootstrap, environment-plus-User recent-Project
partitioning, valid and stale preference fallback, corrupt/read/write-failed
preference degradation, terminal `401` cleanup, channel-specific IPC validation,
and late-result rejection after logout or account replacement. Project Work
Main tests additionally cover the fixed empty-Board deletion request, preference
cleanup, earliest/zero-Board home, committed-delete refresh failure, all three
response-lost reconciliation outcomes, scoped result-unknown isolation,
authoritative Work Item detail/update contracts, Project Member list contracts,
create-assignee and assignee parser/IPC/patch validation, sparse request bodies,
raw-null/empty-mutation rejection, Problem Details field-path propagation,
historical over-limit response parsing, and rejection of late Board
read/detail/mutation completions. The pure detail-state reducer covers one active
field, field-local drafts and errors, Escape discard, implicit saving, repeated-intent
deduplication, transient saved feedback, conflict choices, saving-state immunity
to blur/Escape/draft/repeat-submit events, composition Enter suppression, and
editor/draft/pending-intent retention through saving and conflict. Renderer tests
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
Renderer tests. Main API tests own the HTTP adapter; Main auth/session tests own the credential
lifecycle.

**Current bilingual evidence:** Renderer tests cover ordered system-language
resolution, saved-preference precedence, English fallback, storage failure,
message-key parity, immediate `<html lang>` updates, offline switching with no
auth request, and preservation of flow/session/profile state. Legal-catalog tests
cover exact `zh-CN`/`en` quartets, UTC date formatting, no cross-locale legal
fallback, and consent invalidation without losing non-legal registration input.
Cypress exercises login, waiting, error, registration, focus retention,
keyboard-scrollable legal content, and account switching at `960 × 640`, plus
the existing `480 × 640` auth overflow regression. Work Graph background
evidence for the login brand panel is split between focused Renderer component
tests and Cypress: component tests cover an initially empty trail, no idle RAF,
16 × 16 same-origin path sampling, staggered interpolation across skipped cells,
record-stable random colors/optional symbols, independent center-grow/hold/shrink
motion, same-cell deduplication, bounded decay, single-RAF scheduling, blur/hidden/unmount cleanup,
and reduced-motion/coarse-pointer/folded-brand static degradation. Cypress
verifies that the real Chromium composition stays still before input, renders
multiple distinct full-grid character cells along a pointer path, clears them after
the configured lifetime, and remains non-overflowing at `960 × 640`; the `480 ×
640` single-column auth layout keeps the brand panel hidden, dynamic feedback
static, and login controls usable. It also covers the bilingual
Project shell at `960 × 640`, long Project names/descriptions, no horizontal
overflow, visible primary actions, dialog focus trap and focus restoration,
mutation-error association, exact-name permanent deletion, archived restoration,
and reduced-motion styling. Long English copy wraps without horizontal loss or
hiding primary actions. Current Project Work evidence additionally covers Board create/edit, Column
create/edit/reorder/delete, Work Item creation, authoritative read-only detail,
a unique actual-title heading, strict no-state response shape, audit footer, and
field-local title and multiline-description saves. Detail tests assert that no
Placement/Column row, combobox, or movement entry point is present while content
saves still carry the confirmed Column context required by the API. Cypress owns
unchanged-value no-submit, save-before-dismiss, conflict retry/use-latest, Card or
selected-Board focus fallback, long bilingual detail, reduced motion, and
minimum-window (`960 × 640`) journeys.

Stable-sheet geometry probes sample panel bounds, close control, audit footer,
persistent description label, and field text origins across read → edit → saving
→ success/validation/temporary-failure/conflict. Transitions without a genuine
content-footprint change must stay within 1 CSS pixel per axis, with continuous
screenshots and video retained as evidence. Cypress also verifies a single-line
non-scrolling title with an approximately 16px close gap, a viewport-safe standard
sheet of approximately `760 × 560px`, assignee picker layout stability and error recovery, and a full-width multiline description whose
read/edit text origin stays at the top-left of one flexible slot with an
approximately `128px` minimum. Title probes compare the actual text origin, font
metrics, and structural box model rather than only outer bounds. They also verify
editor/draft/label/scroll retention while saving, viewport-safe contraction, and
IME composition Enter suppression.
`test:system` builds Main/Preload before the JVM runner; explicit dynamic imports
execute those compiled modules while the real Renderer mounts in
jsdom against their API. The journey asserts exact Work Item/Card keys, actual
title heading, Enter-triggered implicit save, and persisted version/content;
native Electron geometry and behavior evidence stay separate.
Main consumer tests accept the exact no-state Work Item/Card responses with creator and nullable assignee, validate Project Member candidate calls and assignee set/clear patches, and reject
injected legacy lifecycle/status fields plus unsupported future assignee/history shapes. Cypress tests flat static fields, title
26px/body 14px/footer 11px, conditional feedback without idle slots, long bilingual
content at 960×640, 1280×800, and 1600×900, and no feedback layout shift.
Renderer integration covers loading/error/read-only/editing/saving/conflict
states, Card avatar-only assignee semantics, detail assignee set/clear/save-failure recovery, immutable creator display in the audit footer, and response fencing; it locks editor/draft and persistent-label
retention during saving, IME composition suppression, and single-snapshot saves
across rapid field switches, close requests, and assignee-open requests. Reducer and
Renderer pure/component tests additionally cover NFC/code-point semantics,
supplementary and combining characters, the 80% counter threshold, required-error
visibility, candidate rejection for keys/paste/IME/selection, deletion and undo,
session ceilings for historical values, stable feedback association, and known or
unknown server paths. Renderer integration tests verify that a dirty field saves
before the picker opens, that save failure keeps the picker closed with the draft
recoverable, and that `paused-invalid` drafts survive unrelated assignee saves or
enter conflict when their authoritative baseline changes.
Cypress retains keyboard set/clear, picker geometry,
picker error state, dirty-description save-first sequencing and search-focus transfer,
creator/timestamp footer alignment, and the 560px sheet. Real Chromium also
covers hard-limit keys, atomic paste and IME commit, selection replacement,
post-limit correction with retained focus, paused-draft close gates, and bilingual
minimum/standard viewport geometry. Board-menu evidence uses real pointer targets
to prove outside dismissal without swallowing the action, Portal-owned regions,
Escape closure, and trigger-focus restoration; the permanent-delete Dialog keeps
its separate modal gate. Pointer and keyboard-equivalent movement, optimistic rollback, focus/live-region
behavior, and the horizontally scrollable Column region remain covered. The
system journey uses a provider/browser double plus packaged Gateway, real Core
API, PostgreSQL, and Redis; it does not prove real GitHub OAuth, production Core
network isolation, or Windows-native drag/focus behavior.

### Approved Board visual-layout verification

**Current production and layout-capture evidence for
`refine-board-visual-layout`:** the Renderer implements the Board recipe.
Six candidate Chrome captures have been reported passing, and the saved
geometry records and PNG dimensions have been inspected. Chinese and English
captures use the same five-Column fixture, Chrome version, device-pixel ratio
(`1`), data order, and starting scroll position as their baselines. All Columns
measure `288px` wide and occupy the full available Column height; Cards measure
`104 / 124px` with title heights of `20 / 40px`. The PNGs are exactly
`960 × 640`, `1280 × 800`, and `1600 × 900` for each language.

| Viewport, both languages | Baseline top usage | Candidate top usage | Fully visible Cards, baseline → candidate |
| --- | --- | --- | --- |
| `960 × 640` | `156.89px` | `114px` | `6 → 8` |
| `1280 × 800` | `156.89px` | `114px` | `9 → 9` |
| `1600 × 900` | `156.89px` | `114px` | `12 → 12` |

The paired Chrome evidence uses baseline JSONs under
`/tmp/taskpilot-board-layout/baseline/*.json`, preserved candidate JSONs under
`/tmp/taskpilot-board-layout/candidate-chrome/*.json`, and preserved candidate
screenshots under `/tmp/taskpilot-board-layout/candidate-chrome/screenshots/`.
These are local `/tmp` artifacts retained for this handoff. Subsequent Cypress
runs may overwrite the original `candidate/*.json` and repository Cypress
screenshot paths, so use the preserved Chrome copies for comparison.
[`cypress.config.ts`](../cypress.config.ts) launches headless Chromium at
`1920 × 1080` so wide screenshots retain their actual pixel dimensions; AUT
viewport sizes remain the three fixture sizes above. The capture suite uses
Cypress 16 `Cypress.expose` parameters. A candidate-only capture command is:

```bash
env -u ELECTRON_RUN_AS_NODE pnpm --filter @taskpilot/desktop exec cypress run --component --browser chrome --spec cypress/component/board.cy.tsx --expose captureOnly=true,BOARD_LAYOUT_CAPTURE=candidate --config video=true
```

Use `BOARD_LAYOUT_CAPTURE=baseline` only with the baseline production layout.
Capture-only execution selects the six fixture cases; the ordinary command
without `captureOnly` registers the regression suite as well.

**Current automated verification:** the final execution logs and coverage
summary support the following results. The P2 keyboard-coverage repair reran
Chrome, the complete Electron component suite, ESLint, and Renderer TypeScript.
Focused Vitest, production quality/coverage/build, and packaged evidence below
come from the original Apply; this test-only repair leaves that production
code unchanged. The implementation owner reports changed-executable coverage.

| Check | Final result | Evidence |
| --- | --- | --- |
| Focused Renderer/Detail Vitest | `89 / 89` passing | `/tmp/taskpilot-board-focused-vitest.log` |
| Focused Board Cypress, Chrome 147 | After the P2 repair, `59 / 59` passing, no failures/pending/skips; screenshots and video retained | `/tmp/taskpilot-board-focused-cypress.log` |
| Full Desktop `test:e2e`, default headless Electron (log browser label `Electron 146`) | After the P2 repair, `80 / 80`: Auth 11, Board 59, Select 4, Shell 6; no failures/pending/skips | `/tmp/taskpilot-board-all-cypress.log` |
| Desktop quality gate | Typecheck/lint, Main 168, Renderer 184, architecture 10, coverage suite 362, and production build passed | `/tmp/taskpilot-board-quality.log` |
| Final test-helper and cleanup edits | ESLint and Renderer TypeScript passed after the P2 keyboard-helper repair; final Cypress runs above include the changes | `/tmp/taskpilot-board-lint.log`, `/tmp/taskpilot-board-typecheck.log`, and final Cypress logs |
| Current-host packaging and credential lifecycle | macOS arm64 package built with Electron `44.4.5`; native write, fresh-process restore, rotate, delete passed | `/tmp/taskpilot-board-packaged-native.log` |

Whole-Desktop coverage is **90.74% lines / 78.89% branches**, compared with the
pre-change baseline **90.23% / 78.73%**. The totals are available in
[`coverage-summary.json`](../coverage/coverage-summary.json); the baseline log
is `/tmp/taskpilot-board-baseline-coverage.log`. The implementation owner reports
**11 / 11 instrumented changed executable lines covered**. Changed-branch
coverage is **N/A: no changed branch records**. JSX/CSS is not fully instrumented,
so that narrow changed-line result does not establish complete visual or branch
coverage; the real browser/native presentation checks cover those distinct risks.

**Current-host native presentation inspection fulfilled:**
`/tmp/taskpilot-board-native-visual.log` reports `ok: true`; the matching
`/tmp/taskpilot-board-layout/native/report.json` records macOS arm64,
Electron `44.4.5`, and the current packaged `app.asar` Renderer. The test-only
Preload supplies the fixture, refuses mutations, and uses an isolated `/tmp`
profile. Full-app `960 × 640`, `1280 × 800`, and `1600 × 900` checks include the
`216px` sidebar, five Columns, and 15 Cards, with no page overflow and a
scrollable Board region.

At `960 × 640`, a visible/focused native window receives trusted CDP keyboard
events. Enter opens the creation Dialog and Board menu with focus inside and
bounds inside the viewport; Escape restores the add-Card button and menu trigger
respectively. Screenshots are
`/tmp/taskpilot-board-layout/native/packaged-renderer-create-960x640.png` and
`packaged-renderer-menu-960x640.png` in the same directory, alongside all three
full-app captures. This visible-window result supersedes the older hidden-window
probe and fulfills the current-host presentation/menu/focus inspection.
It is separate from the credential lifecycle result and does not exercise
production Main/Preload/API end-to-end or establish human visual approval.

**Pending human/release handoffs:** independent code review, human visual/manual
acceptance, Windows-native release validation, and signed/notarized platform
release certification have not been supplied. After the P2 repair, the user
explicitly authorized archive and commit on 2026-11-11; the delta specs were
synced and the Change archived. That authorization does not establish unexecuted
human/platform evidence. See the
[`archive audit`](../../../openspec/changes/archive/2026-11-11-refine-board-visual-layout/test-plan.md#archive-and-documentation-audit).
The layout recipe belongs to
[`design foundation`](design-foundation.md#board-layout-and-card-recipe).

Renderer integration in
[`project-board.test.tsx`](../tests/renderer/features/board/project-board.test.tsx)
owns authoritative title/description and assignee semantics, accessible names,
unchanged scoped/versioned move payloads, deterministic DOMRect anchor seams,
and drop/cancel/unmount cleanup. Retain detail/creation/save/picker/failure
regressions; this slice changes no business model or detail-sheet behavior.

Passing real Chromium component checks in
[`board.cy.tsx`](../cypress/component/board.cy.tsx) cover:

- One-/two-line `14 / 20px` titles and a single `12 / 18px` summary; empty
  summaries retain their slot. Same-title descriptions and authoritative
  assignee set/replace/clear keep outer height, title width, and summary position
  stable within `1px` in the same environment. The fixed `24px` footer shows
  only an assigned avatar at bottom left; long and multiline previews leave
  authoritative detail text intact.
- Compact Project context, aligned `20px` gutters and approximately `44px`
  tabs/actions, readable `288px` full-height neutral Columns, canvas-only
  horizontal scrolling, Column vertical scrolling, and reachable create/action
  targets. Long names, focus visibility/restoration, and truthful
  loading/error/empty states remain usable at all fixture sizes.
- At `960 × 640` in both languages, real ProjectHome with its sidebar and five
  long-named Boards overflows the local tab track. Trusted Tab enters the
  current tab; ArrowRight/End/ArrowLeft/Home switch Boards with authoritative
  requests, one selected tab, roving tabindex, visible focus, unclipped bounds,
  and local scrolling clear of toolbar actions. Native Tab traversal reaches
  the last Card of a long Column and scrolls it into view; trusted Enter opens
  authoritative detail and Escape restores the same visible Card, without
  edit/move mutations or page overflow. Keyboard helpers keep CDP's portable
  `key`/`code`/`windowsVirtualKeyCode` and omit OS-specific `nativeVirtualKeyCode`;
  Windows key values must not be reused as macOS native codes. The regression
  retains exact trusted-key and browser-generated-click assertions.
- Different-height sources and target halves resolve the correct anchor;
  preview and unique before-Card/end/empty-Column slots match the measured
  source height within `1px`. Include a real mouse drag, authoritative success,
  failure/reload, cancellation without mutation, and transient geometry cleanup.

Reduced-motion evidence must use real browser media emulation. Before mounting,
call `Cypress.automation('remote:debugger:protocol', ...)` with
`Emulation.setEmulatedMedia` and a `prefers-reduced-motion: reduce` feature, as in
[`select.cy.tsx`](../cypress/component/select.cy.tsx). Assert real `matchMedia`
matches, computed Column/Card transition durations are zero, and any retained
Column pseudo-element/action-area transitions are also zero. Assert insertion
slot reveal and settling animation names are `none`, FLIP's `Element.animate()`
is not called, and the measured slot, structural target feedback, move payload,
and authoritative result remain correct. An `afterEach` hook must reset media
`features` to `[]`, including after assertion failure; a stubbed `matchMedia`
does not prove CSS media-rule behavior. The implemented hook also removes the
capture-only height from `[data-cy-root]`, since mounting reuses that root;
viewport fixtures must not leak their height into subsequent regression cases.
These CSS/JS reduced-motion and cleanup checks passed in the final focused
Chrome and full Electron component runs above.

Capture baseline screenshots before production layout edits and candidate
screenshots afterward using the same five-Column fixture, Chinese and English,
at `960 × 640`, `1280 × 800`, and `1600 × 900`. Hold browser, viewport, zoom,
data order, and starting scroll positions constant. Record top-region usage,
actual Column widths, visible Card counts, and title readability/whitespace;
Card count alone is not a visual acceptance criterion.

Focused commands from the approved test plan are:

```bash
pnpm --filter @taskpilot/desktop exec vitest run --config vitest.config.ts tests/renderer/features/board/project-board.test.tsx tests/renderer/features/detail/work-item-detail-state.test.ts
pnpm --filter @taskpilot/desktop exec cypress run --component --browser chrome --spec cypress/component/board.cy.tsx --config video=true
```

If Chrome is unavailable, record the command using another installed Chromium
browser and retain the actual drag, screenshots, and video evidence.

The implementation owner completed the affected `pnpm desktop:quality`, full
Desktop `test:e2e`, and `test:packaged-native` gates recorded above. This
documentation update checks only relative links and the assigned diff; it
records existing test/native evidence and supplies no new test execution,
human acceptance, independent review, or release approval.

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

Automated checks enforce Desktop configuration has one Gateway origin, production
source/build output has no Core origin or fallback, adapters use only approved
canonical paths, and Renderer has no endpoint/fetch access. They also enforce no Renderer-to-Node/Electron
imports, no raw channel strings outside the IPC owner, no Main-to-Agent
implementation dependency, and no deep imports across Renderer domain-module
owners. Fixture-based allowed/forbidden examples accompany those rules.

## Quality Gates

A Desktop change is incomplete until focused tests,
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
