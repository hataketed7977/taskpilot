# Desktop Agent Instructions

## Scope

These instructions apply to `apps/desktop/` and inherit
[`../../AGENTS.md`](../../AGENTS.md). This directory contains a runnable Electron
first-use slice alongside Target documentation for later Desktop capabilities.

## Required Navigation

Read the root [`documentation map`](../../docs/README.md), the root
[`business model`](../../docs/business-model.md) for business-facing changes,
and the root [`architecture`](../../docs/architecture.md) for technical changes.
Then read the local document matching the task:

| Document | Mandatory before |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Changing Electron process boundaries, dependencies, data flow, typed IPC, API integration, packaging, or business-facing UI |
| [`docs/responsibilities.md`](docs/responsibilities.md) | Adding a window, page, component, Hook, IPC capability, state owner, or native integration |
| [`docs/testing-strategy.md`](docs/testing-strategy.md) | Adding or changing Desktop behavior, security boundaries, packaging, or tests |
| [`docs/design-foundation.md`](docs/design-foundation.md) | Creating or substantially reshaping login, the application shell, navigation, Workspace or Project surfaces, or shared visual primitives |

Local documents refine the root architecture and implement the root business
model; they do not redefine product terms or move business truth into the
Desktop.

## Skill Routing

Read an applicable Skill's `SKILL.md` before the relevant phase. The following
routing applies to the React Renderer and user-facing native shell, not to
Preload/Main-only, documentation-only, generated-file, or backend changes.

| Skill | Mandatory trigger | Do not invoke merely for |
| --- | --- | --- |
| `frontend-design` | A new user-facing flow, window, application shell, navigation, login/onboarding experience, dashboard, design-system foundation, or substantial visual/interaction change | Documentation-only work, tests without UI changes, generated transport types, or a local correction that preserves the approved visual language |
| `vercel-react-best-practices` | Creating or materially changing Renderer React components, Hooks, providers, routing, data fetching, rendering, bundle boundaries, or frontend performance | Main/Preload-only code, CSS/copy-only changes, generated files, documentation, or tests that do not change production React behavior |
| `web-design-guidelines` | Final review of every implemented user-facing UI change, including accessibility, keyboard, responsive, form, or interaction behavior | Pre-implementation ideation, Main/Preload-only work, generated files, or non-visual refactors |

### Required Order for a New or Substantially Changed Experience

1. Read the product vocabulary plus Desktop architecture and state explicit
   audience, job, constraints, platform differences, and non-goals.
2. Use `frontend-design` to establish one intentional visual direction and all
   necessary loading, empty, error, disabled, focus, keyboard, reduced-motion,
   offline, and reconnect states.
3. Use `vercel-react-best-practices` while implementing Renderer React code.
   Ignore Next.js/server-only guidance unless the owning architecture changes.
4. Add focused tests using [`docs/testing-strategy.md`](docs/testing-strategy.md).
5. Review the implemented interface with `web-design-guidelines` and inspect it
   in packaged Electron/Chromium on applicable Windows and macOS targets.
6. Fix material findings, rerun affected checks, and report intentional
   exceptions.

A new login or application shell uses all three Skills in this order. A
Main/Preload security or IPC change with no visual impact uses the local
architecture and testing strategy, not frontend design Skills.

## Local Rules

- Keep `contextIsolation` enabled and Renderer sandboxing on. Do not expose
  Node.js, Electron modules, raw filesystem paths, credentials, or unrestricted
  IPC to Renderer code.
- Expose narrow, typed, capability-oriented Preload APIs. Validate every IPC
  message at the Main boundary and authorize the operation again at its owner.
- Keep Agent execution, workspace file access, PTY/process supervision, Diff
  production, and execution journaling in the Agent Runtime, not Main or
  Renderer.
- Keep TaskPilot business truth and final authorization in Gateway/Core API.
- Treat macOS and Windows behavior as separate release evidence even when they
  share TypeScript and React code.
- Never describe Target behavior as implemented until executable code and tests
  exist.
