# Web Agent Instructions

## Scope

These instructions apply to `apps/web/` and inherit
[`../../AGENTS.md`](../../AGENTS.md).

## Required Navigation

Read the root [`documentation map`](../../docs/README.md). Read the root
[`business model`](../../docs/business-model.md) for any business-facing
change and the root [`architecture`](../../docs/architecture.md) for any
technical change, then select the local document matching the task:

| Document | Mandatory before |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Changing frontend structure, dependencies, data flow, API integration, or business-facing UI |
| [`docs/responsibilities.md`](docs/responsibilities.md) | Adding a page, component, Hook, state owner, or frontend boundary |
| [`docs/testing-strategy.md`](docs/testing-strategy.md) | Adding or changing Web behavior or tests |

Read every prerequisite declared by the selected document. Local engineering
documents implement the root business model; they do not redefine its terms or
rules.

## Skill Routing

Read the applicable Skill's `SKILL.md` before starting that phase. Skills are
working methods, not sources of product meaning or architecture. When Skill
advice conflicts with the business model, architecture, local documentation,
accessibility requirements, test strategy, or explicit user direction, the
repository rule wins and the conflict is reported rather than silently applied.

| Skill | Mandatory trigger | Do not invoke merely for |
| --- | --- | --- |
| `frontend-design` | A new user-facing page or flow; a new application shell, navigation, login/onboarding experience, dashboard, or design-system foundation; or a substantial change to layout, visual hierarchy, typography, color, motion, responsive composition, empty/loading/error states, or product copy | Documentation-only work, tests with no UI change, generated API types, data plumbing with no visible behavior, or a small local fix that preserves the approved visual language |
| `vercel-react-best-practices` | Creating or materially changing React components, Hooks, providers, routing, client data fetching, rendering behavior, code splitting, bundle boundaries, or frontend performance; also any explicit React performance review | CSS-only or copy-only changes, non-React configuration, generated files, documentation, or tests that do not change production React behavior |
| `web-design-guidelines` | Final review of every implemented user-facing UI change; any explicit UI, UX, responsive, interaction, form, or accessibility audit | Pre-implementation ideation with no code to review, backend-only work, generated files, or non-visual refactors |

### Required Order for a New or Substantially Changed Experience

1. **Ground the brief.** Read the product vocabulary and relevant Web
   architecture. State the audience, primary job, information hierarchy,
   constraints, and explicit non-goals.
2. **Design with `frontend-design`.** Establish one intentional visual thesis
   and apply it to real TaskPilot content. Define the necessary desktop/mobile
   composition and loading, empty, error, disabled, focus, and reduced-motion
   states before broad implementation. Do not produce several unrelated themes
   unless the user asks for alternatives.
3. **Implement with `vercel-react-best-practices`.** Apply React/client rules
   compatible with this Vite application. Ignore Next.js- or server-only advice
   unless that technology is explicitly adopted by the owning architecture.
   Design guidance cannot introduce a new framework, state owner, data-fetching
   pattern, or dependency without the normal architecture decision.
4. **Verify behavior.** Add or update focused tests according to
   [`docs/testing-strategy.md`](docs/testing-strategy.md). Run the smallest
   relevant checks before broader suites.
5. **Review with `web-design-guidelines`.** Review the changed user-facing files
   against the freshest available guidelines and inspect the rendered result at
   relevant desktop and mobile widths when a runnable environment exists.
6. **Resolve findings.** In an implementation task, fix in-scope blocking and
   material findings, rerun affected checks, and report any intentional
   exception. In a review-only task, report findings with file/line evidence and
   do not edit unless the user separately authorizes changes.

### Combined and Conditional Use

- A new login page or application shell requires all three Skills in the order
  above.
- A new business component normally requires `frontend-design` and
  `vercel-react-best-practices`, followed by `web-design-guidelines` after it is
  rendered.
- A data-fetching Hook or performance refactor with no visual change requires
  `vercel-react-best-practices`, not `frontend-design`; run
  `web-design-guidelines` only if user-visible behavior changes.
- A styling, responsive, interaction, form, or accessibility fix uses
  `frontend-design` when it changes the visual direction or composition and
  always uses `web-design-guidelines` for the final review. Use
  `vercel-react-best-practices` only when production React behavior also
  changes.
- A pure UI review invokes `web-design-guidelines`; add `frontend-design` only
  when the user asks for redesign proposals, and add
  `vercel-react-best-practices` only when React implementation or performance is
  in scope.
- If the latest external review guidance cannot be fetched, use the installed
  Skill content that is available, disclose the limitation, and do not claim a
  fresh guideline audit.

### Design and Review Guardrails

- Preserve one coherent TaskPilot visual language across routes. Do not create a
  new palette, type system, radius scale, or interaction grammar per page.
- Prefer design tokens and existing primitives over one-off styling. A Skill may
  recommend a dependency, but adding it still requires a real ownership need
  and compatibility check.
- Use real product vocabulary and representative states; do not fill production
  UI with generic dashboard metrics or decorative content that implies an
  unimplemented capability.
- Design output must remain accessible, responsive, testable, and compatible
  with the documented API and state boundaries. Visual novelty does not excuse
  weak contrast, missing keyboard behavior, unstable selectors, or hidden
  business errors.
- Take screenshots or use equivalent rendered inspection when available.
  Passing lint or component tests alone is not visual acceptance.

## Local Rules

- This subproject is documentation-only until the Web toolchain is explicitly
  initialized.
- Do not create package files, source directories, generated clients, or test
  configuration as part of documentation work.
- Keep Web-specific decisions here; cross-project API or domain changes belong
  in the root architecture first.
- Generated API types are not edited manually.
- Frontend behavior changes require focused tests once a test toolchain exists.
