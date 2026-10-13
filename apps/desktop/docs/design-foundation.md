# Desktop Design Foundation

- **Status:** Target
- **Owns:** Desktop visual direction, layout grammar, design tokens, typography,
  interaction states, responsive window behavior, and first-slice screen
  wireframes
- **Read after:** [`../AGENTS.md`](../AGENTS.md),
  [`../../../docs/business-model.md`](../../../docs/business-model.md),
  [`architecture.md`](architecture.md), and
  [`responsibilities.md`](responsibilities.md)
- **Mandatory before:** Creating or substantially reshaping the login flow,
  application shell, navigation, Workspace selection, Project list, create
  Project flow, Project shell, or shared Renderer visual primitives

This document defines the approved visual target; it is not implemented
behavior. Code and screenshots become Current evidence only after the Desktop
application exists and the relevant tests and native checks pass.

## Product Brief

TaskPilot Desktop is a long-lived work surface for technical teams coordinating
human work and Agent execution. It should carry more operational information
than a general productivity app while remaining calmer than an IDE or an
observability console.

The current implementation slice is deliberately auth-only:

```text
secure Desktop shell
→ GitHub authentication in the system browser
→ first registration and legal-document review when needed
→ session restore, refresh, and logout
→ authenticated account view
```

Workspace/Project surfaces, Agent Runtime, local directory binding, execution
controls, terminals, Diff, and Agent activity remain Target. The visual
foundation stays extensible without showing disabled promises for those later
capabilities.

### Audience and primary job

- **Audience:** technical leads and delivery teams who spend hours organizing
  projects and, later, supervising both human and Agent work.
- **Primary job:** keep the user's current account, Workspace, and destination
  unmistakable, make the next valid action easy to find, and preserve confidence
  during authentication and network state changes.
- **Character:** precise, composed, trustworthy, and quietly purposeful.
- **Density:** compact enough for frequent work, with breathing room around
  decisions rather than around every record.

### Platform constraints

- Windows and macOS share one Renderer visual language and interaction model.
- Native title-bar controls, window drag regions, shortcuts, focus traversal,
  scrollbars, credential prompts, and dialogs respect each platform.
- A minimum useful window target is `960 × 640`; the standard composition is
  optimized for `1280 × 800` and remains comfortable on larger displays.
- Text must tolerate Chinese, English, and at least 30% label expansion without
  clipping critical actions.
- The interface remains fully usable without Agent Runtime. A Runtime failure
  must never appear as a global Desktop or cloud-connection failure.

## Explored Directions

### A. Quiet control desk — recommended

A restrained, list-led workspace uses a persistent **context spine** to connect
Workspace selection and local page position, with room for later Project
navigation. Cool mineral
surfaces, near-black green ink, and one deep teal action color create a durable
working environment. Dense records use rules and alignment rather than cards.

Why it fits:

- The context spine visualizes TaskPilot's real ownership hierarchy rather than
  decorating the shell.
- List and split-pane compositions scale from a handful of Projects to hundreds.
- A calm base leaves room for future execution warnings, approvals, and Diff
  without turning the entire product into an alert console.
- The same structure works in Windows and macOS while native chrome remains
  platform-correct.

### B. Execution trace canvas — not selected

A prominent horizontal timeline would make Agent runs and hand-offs the center
of every screen. It is visually distinctive, but it overstates capabilities not
present in the first slice, competes with Project work, and would encourage the
client to reconstruct workflow truth. It may later inspire a Run-detail view;
it is not the application foundation.

### C. Native utility notebook — not selected

A very compact platform-native sidebar and inspector would feel familiar and
lightweight. It was rejected as the primary direction because strict imitation
of Finder on macOS and Explorer on Windows would fragment TaskPilot's identity,
provide too little hierarchy for future workflow and Agent supervision, and
make cross-platform behavior harder to teach consistently.

### Direction review

The recommended direction was revised to remove generic SaaS and
generated-design signals:

| Rejected default | Replacement and reason |
| --- | --- |
| A dashboard grid of identical rounded cards | Aligned lists, sections, and split panes express record hierarchy and scale better |
| Purple, neon, or decorative gradient as shorthand for AI | Deep teal marks selected scope and committed action; execution semantics will use explicit labels and icons |
| Warm cream, editorial serif headings, and clay accents | Cool mineral neutrals and a technical humanist sans suit an operational Desktop tool |
| Shadows on every container | Hairline rules organize persistent surfaces; shadow is reserved for overlays that actually float |
| Animated page entrances and universal hover movement | Motion only explains a user-triggered change, progress, or layer transition |
| Provider- or Agent-first home screen | Workspace and Project remain primary; later Agent capabilities enter through normalized, capability-driven views |

## Visual Signature: the Context Spine

The context spine is the one intentionally distinctive device. It is a slim,
continuous vertical rule inside the navigation surface that connects the active
Workspace and selected destination. The first slice uses a real `Projects`
destination; later Project-scoped navigation may add one nested level without
changing the grammar. Short horizontal branches terminate at the active label.

It is not a progress meter, a decorative timeline, or a place for arbitrary
badges. It communicates only hierarchy and current scope:

```text
  Acme Workspace
        │
        ├── Projects               ← current destination
        ├── Members
        └── Settings
```

Rules:

- Use the action color on only the active branch and current-scope marker;
  inactive structure uses the border color.
- Always pair color with position, weight, and an accessible current-page state.
- Do not extend the spine through unrelated content or repeat it inside every
  panel.
- In the first slice, the spine ends at the real Workspace-level `Projects`
  destination. It may indicate the list surface but must not imply that a
  Project is selected or that Project-scoped navigation already exists.
- In compact navigation, preserve the hierarchy through an explicit breadcrumb
  and accessible labels; do not compress the spine into unexplained dots.

## Color System

### Core palette

| Token | Value | Role |
| --- | --- | --- |
| `mineral-50` | `#F1F4F2` | Window canvas and quiet recessed regions |
| `paper-0` | `#FCFDFC` | Primary working surface and fields |
| `ink-950` | `#18211F` | Primary text and high-emphasis icons |
| `slate-650` | `#5D6A66` | Secondary text and inactive controls |
| `slate-250` | `#CCD6D2` | Non-interactive dividers and context spine |
| `teal-700` | `#006B5D` | Primary action, active scope, and committed selection |

The palette is intentionally neutral rather than monochrome: green undertones
connect the canvas, rules, and action color without a colored wash. Large
content surfaces use `paper-0` or `mineral-50`; tinted cards are not a default
container.

Components consume semantic aliases rather than the palette names directly:

| Semantic alias | Palette value | Use |
| --- | --- | --- |
| `color-canvas` | `mineral-50` | Window background and recessed regions |
| `color-surface` | `paper-0` | Main panes, fields, menus, and dialogs |
| `color-text` | `ink-950` | Primary content and control labels |
| `color-text-muted` | `slate-650` | Supporting text that is not required to complete the action |
| `color-border` | `slate-250` | Structural rules and control outlines |
| `color-control-border` | `#7E8F89` | Interactive field and control boundaries; at least 3:1 against supported light surfaces |
| `color-action` | `teal-700` | Primary action and active-scope emphasis |
| `color-action-text` | `paper-0` | Text and icons on the solid primary action |
| `color-selection` | `teal-700` | Selected branch, current-page marker, and active control edge |

### Semantic tokens

Semantic colors supplement the core palette and never communicate alone.

| Token | Light value | Required companion |
| --- | --- | --- |
| `status-success` | `#167352` | Success icon and concrete result text |
| `status-warning` | `#8A5A00` | Warning icon and consequence or next step |
| `status-danger` | `#B42318` | Error icon and recovery action |
| `status-info` | `#275DAD` | Info icon or explicit connection-state label |
| `focus-ring` | `#0875C1` | Two-pixel outline plus two-pixel surface offset |

Use solid `teal-700` with `paper-0` text for the primary action. Secondary
buttons use `paper-0`, `ink-950`, and `slate-250`; tertiary actions are text or
icon actions without a permanent container. Destructive actions never borrow
the primary teal style.

A dark theme is not created by automatically inverting these values. Semantic
names and component recipes must remain theme-ready, but the first implementation
may ship one fully reviewed light theme. Dark mode requires its own contrast,
elevation, native-chrome, and screenshot review before it is claimed.

## Typography

The Current authentication and account surfaces bundle **Inter Variable** for
Latin text and numbers, with the platform sans-serif stack providing Chinese
fallback. This is the approved typography for the runnable first-use slice; it
must be checked with both Chinese and English content on each release platform.
It does not silently decide the later application shell's complete CJK or
machine-readable font stack.

When the Workspace/Project shell is implemented, select and bundle its Latin,
Simplified Chinese, and machine-readable families from real dense-screen
fixtures. Machine-readable values may use a monospace family, but ordinary
labels and decorative metadata must not. Any replacement or expansion of the
Current stack requires side-by-side Chinese and English screenshots rather than
an arbitrary host-font fallback.

| Style | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Window title | `12 / 16` | 500 | Native title region only |
| Metadata | `12 / 16` | 400 or 500 | Counts, timestamps, supporting facts |
| Control | `13 / 18` | 500 | Buttons, tabs, fields, navigation |
| Body | `14 / 21` | 400 | Default content and descriptions |
| Section title | `16 / 22` | 600 | Pane and form section headings |
| Page title | `20 / 28` | 600 | Workspace or Project destination title |
| Auth decision title | `32–40 / 35–43` | 600 or 700 | Sign-in, registration, legal, and recovery state titles |
| Signed-out brand title | `40–62 / 40–61` | 600 or 700 | Product promise in the authentication brand panel only |

Guidance:

- Use sentence case; do not add tracked all-caps eyebrow labels.
- Left-align application content. The signed-out authentication layout may pair
  one concise product statement with a bounded decision panel; authenticated
  product surfaces do not use marketing display type.
- Center only a bounded authentication decision or empty state; keep forms and
  readable copy left-aligned within that surface.
- Keep prose lines below 72 characters where possible; tables and records follow
  column needs rather than prose width.
- Truncate mutable names only after preserving a tooltip or accessible full
  value. Never truncate the only visible error recovery action.
- Use tabular numerals for counts and timestamps, and reserve bold weight for
  current context or a decision—not every label.

## Geometry and Elevation

- **Spacing unit:** `4px`.
- **Common spacing:** `4`, `8`, `12`, `16`, `24`, `32`, `48`.
- **Control heights:** `28px` compact, `32px` default, `36px` prominent form
  action; pointer targets remain at least `32 × 32px` and critical icon actions
  use `36 × 36px` where space permits.
- **List rows:** `40px` for simple rows and at least `52px` for a title plus
  metadata. Let wrapped localized content increase row height.
- **Radii:** `4px` for compact controls, `6px` for fields/buttons, `10px` for
  dialogs and inspectors. Full pills are reserved for status or removable tags.
- **Borders:** use one-pixel `slate-250` for non-interactive structure and
  `color-control-border` for field and control boundaries; use whitespace before
  adding another box.
- **Elevation:** no shadow for fixed navigation, lists, or page sections. Menus,
  dialogs, and temporary sheets use one restrained shadow and a visible border.
- **Icons:** one coherent outlined set at `16px` or `18px`; icons supplement
  labels. Icon-only controls require a conventional meaning, accessible name,
  and tooltip.

## Shell and Window Behavior

The application uses three persistent layers:

1. a platform-aware title region (`40–44px`) with a dedicated draggable area;
2. a `224px` context navigation pane containing the Workspace switcher and
   context spine; and
3. a flexible work surface with a local header and content region.

At widths below `1080px`, navigation may reduce to `192px` and optional detail
panes become overlays. At the minimum width, navigation may collapse behind an
explicit button, but the current Workspace and destination remain visible in
the header breadcrumb. Core page actions do not disappear into horizontal
scroll.

macOS traffic lights and Windows caption controls keep their native safe areas.
Interactive controls never overlap a drag region. The visual shell may share
layout code, but title-bar measurements and window-control accommodations are
platform adapters, not CSS guesses spread across pages.

### Application shell and Project list

```text
┌─ native title region ──────────────────────────────────────────────────────┐
│  TaskPilot                                                    account      │
├──────────────────────┬─────────────────────────────────────────────────────┤
│ Acme Workspace    ▾  │ Workspace / Projects                              │
│     │                ├─────────────────────────────────────────────────────┤
│     ├─ Projects  ●   │ Projects                             Refresh       │
│     ├─ Members       │                                                     │
│     └─ Settings      │ Atlas migration                          ›          │
│                      │ Release automation                       ›          │
│                      │ Support operations                       ›          │
│ Help                 │                                                     │
└──────────────────────┴─────────────────────────────────────────────────────┘
```

The first-slice shell is list-led rather than a metric dashboard. It loads the
active Workspace's real Project page through the typed Desktop capability and
shows only `name` as user-facing row content in this slice. A row may be focused
or selected for interaction semantics, but activation must not navigate to a
Project detail surface until that later contract exists. There is no Create
Project action, disabled creation promise, or inferred `canCreateProject`.

## First-Slice Wireframes

Wireframes describe hierarchy and state, not final pixel output or an API
contract.

### Authentication

```text
┌──────────────────────────────────┬─────────────────────────────────────────┐
│ TaskPilot                        │ Language                                │
│                                  │                                         │
│ People and Agents collaborate    │ Sign in to TaskPilot                    │
│ on one board.                    │ Verify your identity with GitHub.       │
│                                  │ [ Sign in with GitHub                  ] │
│ A concise board trace reinforces │                                         │
│ the product model.               │ Authorization opens in the browser.     │
└──────────────────────────────────┴─────────────────────────────────────────┘
```

Authentication uses the **Quiet control desk** palette and interaction grammar,
with a distinct signed-out composition: one restrained brand panel describes
human-and-Agent board collaboration while one left-aligned decision panel owns
the active authentication task. A low-contrast board field spans the lower
brand panel as ambient product context; it fades behind the mid-upper product
statement instead of behaving like a separate bottom illustration. The brand
panel is product orientation, not a second form, feature inventory, or place for
implementation and storage rules.
At narrow widths it yields entirely to the decision panel.

The first slice has one emphasized action: **Sign in with GitHub**. It has no
provider selector, email fallback, deep link, embedded browser/WebView, or
preview of future providers. OAuth always opens the system browser; the
Renderer retains only an opaque flow identifier and never receives Provider,
registration-continuation or TaskPilot session secrets.

After GitHub proves control of an identity, an existing identity proceeds directly
to an authenticated session without another account form. A new identity replaces the
decision panel with one registration form:

```text
Create your TaskPilot account
[ avatar ]          [x] Use GitHub avatar   (when available)
Display name        [ suggested name                         ]
Consent             [ ] I agree to User Agreement and have read Privacy Policy
                    [ User Agreement ] [ Privacy Policy ]
                                            [ Create account ]
```

The avatar is a compact optional choice rather than a profile explainer; do not
show its URL, persistence mechanism, future settings, or implementation rules in
the form. The display name is a separate full-width editable field. The avatar
choice appears only when GitHub provides a safe preview URL; absence or
image-load failure leaves a neutral initials fallback and does not block
registration. Consent is explicit and bound to one immutable
User Agreement plus Privacy Policy bundle, while the checkbox hides the internal
bundle identifier. Both documents open read-only inside the same auth surface;
returning preserves the draft and reading never checks consent automatically. An
unknown server bundle blocks submission and asks for a client update. Blank
names, server-identified field errors, and unaccepted consent keep focus at the
affected control. Pending actions retain their
width, disable duplicate activation, and announce progress through a polite
live region.

The same bounded content area replaces itself for every stable auth state:

| State | Presentation and next action |
| --- | --- |
| capability loading/unavailable | Announce configuration check; when GitHub is unavailable explain that sign-in is not configured and offer capability retry only. |
| idle/signed out | Show the single GitHub primary action. |
| opening browser | Disable the primary action and announce that the system browser is opening. |
| waiting for browser / completion required | Explain that authorization finishes in the browser, poll without stealing focus, and offer Cancel. |
| registration required | Show display name, optional avatar choice, explicit User Agreement/Privacy Policy consent, in-app document views, and Create account; unknown bundles fail closed. |
| denied / cancelled | State that authorization was not completed and offer Start again without implying whether an account exists. |
| offline / temporarily unavailable | Preserve the opaque flow when safe and offer Retry; never branch on a human-readable server message. |
| expired | Clear the old flow view and offer a new GitHub attempt. |
| disabled or other safe authentication rejection | Use a non-enumerating “unable to sign in” state and offer a new attempt or support path; do not disclose internal User status. |
| reauthentication required | Return to the signed-out GitHub entry after secret/session cleanup. |
| authenticated handoff | Announce completion briefly while the authoritative session subscription moves the app into the account view. |

Polling and reconnect timers stop on cancellation, authentication, unmount, or
flow replacement. The Current Auth and Account surfaces provide the same compact
native language selector for `简体中文` and `English`; switching is immediate and
does not restart authentication or change the signed-in User. Keyboard order
follows the visual order, all actions and the independently scrollable legal
body have a visible focus indicator, status changes use `role="status"`,
actionable failures use `role="alert"`, long English copy wraps at the `960 ×
640` minimum, narrow windows remain scrollable, and reduced-motion users receive
no decorative transition. Portable Renderer/Cypress checks cover these
contracts; packaged Electron, native credential storage, final platform visual
review, macOS, and Windows remain separate release evidence.

### Workspace selection

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Choose a Workspace                                      Account menu       │
├────────────────────────────────────────────────────────────────────────────┤
│ Find a Workspace…                                                        2 │
│────────────────────────────────────────────────────────────────────────────│
│ ● Acme Workspace                 Organization               Last opened     │
│   基础设施团队                    Organization                               │
│                                                         [Create Workspace] │
└────────────────────────────────────────────────────────────────────────────┘
```

Use one selectable list rather than a card gallery. Preserve keyboard arrow
navigation, visible focus, explicit selected state, and Enter to continue. On
startup, one accessible Workspace may be entered automatically; with multiple
Workspaces, restore the most recent `WorkspaceId` only after the server confirms
access, otherwise show the selector. Never restore across account or environment
boundaries. The first slice lists and creates only Organization Workspaces; it
does not expose a type picker.

### Create Organization Workspace

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Create Workspace                                                           │
│ Name                                                                       │
│ [ Acme Engineering                                      ]                  │
│                                                                            │
│ Organization Workspace                                                     │
│ The first slice does not offer a Workspace type choice.                    │
│                                                                            │
│                                             [Cancel] [Create Workspace]     │
└────────────────────────────────────────────────────────────────────────────┘
```

Show this focused form only when `canCreateWorkspace` is true. When it is
false, omit the submit path or explain the stable
`createWorkspaceReasonCode`; never infer permission from role or Workspace
type. Preserve the name and the same creation request identifier while a network
result is unknown. Generate a new identifier only for a genuinely new user
intent. On confirmed success, establish the returned `WorkspaceId` as active
and load its Project list.

### Project list states

Loading preserves the list geometry beneath the local header. A successful empty
response shows a quiet, truthful state:

```text
Projects                                                   Refresh
──────────────────────────────────────────────────────────────────
No Projects are available to you in this Workspace.
Switch Workspace
```

The empty state offers `Refresh` and `Switch Workspace`; it does not show Create
Project. A network or `PROJECTS_TEMPORARILY_UNAVAILABLE` result replaces the
list with a retryable error rather than pretending `items: []`. A
`WORKSPACE_NOT_FOUND` result clears the active Workspace and returns to the
Workspace recovery flow. Pagination appends or replaces rows without shifting
the shell header, and its progress/error state stays local to the list.

If the Workspace changes while a page is pending, neither rows, empty state,
errors, nor cursor from the old Workspace may flash in the new scope. If any
returned item identifies a different Workspace, the whole page is rejected and
the UI shows a safe retryable contract error; partial rows are never rendered.

## Later Project Mutations — Explicit Non-Goal

Project creation, detail/edit/delete, Project Member management, and
Project-scoped navigation are not authorized by the first-slice wireframes and
must not appear as hard-coded controls or disabled promises. A later end-to-end
Change must define their HTTP and Main/Preload contracts, authorization,
capabilities, error semantics, interaction states, and tests before extending
the context spine below an individual Project. That Change may reuse the
list-led composition and side-inspector grammar from this foundation; this
document intentionally does not freeze a Project form ahead of those contracts.

## Interaction and State Grammar

### Loading

- Preserve the final layout to prevent shell movement.
- Use skeletons only for predictable record geometry; use a compact progress
  label for authentication, mutations, and unknown-duration work.
- Never show an indefinite global spinner when only one pane is refreshing.
- Keep stale authorized content visible only during an ordinary data refresh
  while authentication is still valid, and label it when freshness matters. If
  session refresh is temporarily unavailable, hide protected data until the
  credential state is resolved.

### Empty

An empty state explains what is absent and offers one valid next action:

```text
No Workspaces yet
Create an organization Workspace to start collaborating.
[Create Workspace]
```

Do not add an illustration by default. Permission-limited emptiness is not the
same as a truly empty collection and must not offer an unauthorized action.

### Error

- Put field errors beside their field and summary failures beside the affected
  pane. Reserve a blocking dialog for an action that cannot safely continue.
- State what failed and what remains safe: “Workspaces couldn't be refreshed.
  No Workspace changes were made.”
- Offer a concrete recovery such as `Retry`, `Sign in again`, or `Copy details`.
- Do not use “Something went wrong” when a normalized category is available.
- Never expose credentials, raw provider errors, stack traces, or local paths.

### Disabled and unavailable

A disabled control must have a discoverable reason in adjacent helper text or an
accessible tooltip. Prefer omitting an action the user can never perform;
disable an action when the missing prerequisite is temporary or instructive.
Unsupported provider capabilities use explicit capability language rather than
provider-name branches.

### Focus, keyboard, and selection

- Every interactive element has a visible `focus-ring`; never remove outlines
  without an equivalent.
- Focus order follows visible reading order. Opening a dialog or inspector moves
  focus to its heading or first invalid field; closing it restores focus to the
  trigger.
- Lists distinguish keyboard focus, current selection, and activation. They are
  not three shades of the same background.
- Standard shortcuts use platform conventions. Display `⌘` on macOS and `Ctrl`
  on Windows through a platform-aware formatter.
- Escape closes only the top dismissible layer and never discards dirty input
  without confirmation.

### Offline and reconnect

A narrow status strip sits below the title region, not over content:

```text
Offline — showing data loaded at 10:42                 Reconnect
```

- Cloud-dependent mutations are disabled with a reason; safe local navigation
  remains available.
- Reconnection changes the same strip to `Reconnecting…`, then removes it after
  successful refresh. Failure becomes `Still offline` with an explicit retry.
- Do not call a Runtime-only failure “offline.” Local execution availability and
  cloud connectivity are separate state regions.
- When data may be stale, preserve its timestamp and avoid optimistic claims of
  successful creation or update.

### Motion and feedback

- Use `120–180ms` transitions for a menu, inspector, selection, or disclosure
  directly triggered by the user.
- Do not animate initial page sections into view or move every row on hover.
- Respect reduced-motion preferences by removing spatial transitions while
  preserving state changes.
- Buttons show pending state without changing width. Completion feedback names
  the completed action using the same verb as its trigger.

## Content Voice

Use plain, specific language and stable product vocabulary:

- `Create Workspace` → `Workspace created`, not `Submit` → `Success`.
- `Choose a Workspace`, not `Select your organizational context`.
- `Sign in`, `Verify email`, and `Create account`, not a generic `Continue` or `Submit`.
- Error text explains the affected object and next step without apology or
  personality theater.

Names such as Workspace and Project follow the business model and remain
consistent across navigation, headings, actions, notifications, and tests.
Localization must not translate stable machine values, identifiers, or shortcut
keys as prose.

## Implementation Guardrails

- This foundation does not select a component library. Evaluate one only after
  the first implementation change identifies required primitives, Electron
  compatibility, accessibility behavior, theming control, bundle cost, and
  long-term ownership.
- Implement semantic tokens rather than scattering palette values through
  components. Component recipes may consume tokens but cannot redefine status
  meaning locally.
- Keep page composition in Renderer; do not cross Electron security boundaries
  for styling convenience.
- Do not infer roles, authorization, provider support, or Runtime health in
  presentational components.
- Real content, longest localized labels, keyboard traversal, reduced motion,
  `960 × 640`, `1280 × 800`, and a wide window are review fixtures—not optional
  polish.
- macOS and Windows screenshots are separate design evidence because title bars,
  typography rendering, menus, scrollbars, and focus behavior differ.

## Visual Acceptance Checklist

Before calling an implemented first-slice surface complete:

- [ ] The current account, Workspace, and destination are distinguishable
      without relying on color alone.
- [ ] The context spine encodes actual hierarchy and is not repeated as
      decoration.
- [ ] Lists and rules are used where a generic card grid would add no meaning.
- [ ] Chinese and English samples do not clip, collide, or create ambiguous
      truncation.
- [ ] Loading, empty, error, disabled, focus, offline, reconnect, and reduced-
      motion behavior is visible and testable where applicable.
- [ ] Runtime absence affects no first-slice cloud workflow.
- [ ] Primary, destructive, and selected states remain visually distinct.
- [ ] Keyboard-only use has an obvious location and a reversible escape path.
- [ ] Screenshots at minimum, standard, and wide sizes show intentional density,
      not stretched whitespace or hidden core actions.
- [ ] The result does not resemble a generic AI/SaaS template through gradients,
      interchangeable cards, ornamental labels, gratuitous shadows, or motion.
- [ ] `web-design-guidelines` findings and platform-specific exceptions are
      resolved or explicitly documented.
