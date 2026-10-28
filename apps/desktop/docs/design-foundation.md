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

This document contains both the Current first-use visual foundation and Target
directions for later product surfaces. A section is Current only where it is
explicitly backed by runnable Renderer code and portable tests; packaged/native
visual checks remain separate release evidence.

## Product Brief

TaskPilot Desktop is a long-lived work surface for technical teams coordinating
human work and Agent execution. It should carry more operational information
than a general productivity app while remaining calmer than an IDE or an
observability console.

The Current Renderer covers authentication, legal review, session lifecycle,
the Project shell, and its direct multi-Board work surface. Main and Preload provide narrow, typed
personal-Workspace and Project capabilities. The implemented first-use journey
is:

```text
secure Desktop shell
→ GitHub authentication and first registration when needed
→ resolve the one personal Workspace and current Project
→ Project home with create, edit, archive, restore, and permanent deletion
→ account, language, and logout remain reachable
```

`TEAM`, members, Workflow/Agent execution, Swimlanes, custom fields, independent
Work Item deletion, local directory binding, terminals, Diff, and activity
metrics remain Target. Empty Board permanent deletion is Current and remains
separate from Work Item deletion. The shell stays extensible without
showing disabled promises or fabricated data for those later capabilities.

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

### A. Quiet project desk — recommended

A restrained, list-led workspace uses compact **Project slots** for navigation.
Workspace identity stays fixed above the list, while a single folder glyph marks
the Project collection and each Project remains a quiet text row. Cool mineral
surfaces, near-black green ink, and one deep teal action color create a durable working
environment. Dense records use rules and alignment rather than cards.

Why it fits:

- Project slots make navigation immediately recognizable without turning the
  sidebar into a timeline, tree, or decorative process diagram.
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

## Visual Signature: Project Slots

Project slots are the intentionally distinctive navigation device. A single
folder glyph marks the Project collection and aligns with the adjacent Archived
Projects action; individual ACTIVE Projects remain text rows. The selected slot
uses a low-contrast mineral-teal surface, a short inset edge signal, and stronger
text weight instead of a repeated logo, tree branch, or status dot.

The collection glyph communicates familiar navigation structure without
pretending that Board content, progress, or Agent activity is already visible
in the sidebar:

```text
  Personal space

  ▱ Projects
    My project                    ← current Project
    Launch notes

  + New project                  ← action, not a Project slot
```

Rules:

- Use one folder glyph on the Project collection label, aligned with the
  Archived Projects icon. Do not repeat it on every Project row.
- Pair the selected color with a quiet surface, short inset edge signal, text
  weight, and an accessible current-page state; never rely on teal alone.
- Do not use tree lines, nodes, glow, or gradients in Project navigation. The
  fixed Workspace header and explicit Project section label already express the
  hierarchy.
- New Project and Archived Projects are adjacent actions, not Project slots
  that imply business resources.
- In compact navigation, preserve scope through the current Project name and
  accessible labels; never compress Project destinations into unexplained dots.

## Color System

### Core palette

| Token | Value | Role |
| --- | --- | --- |
| `mineral-50` | `#F1F4F2` | Window canvas and quiet recessed regions |
| `paper-0` | `#FCFDFC` | Primary working surface and fields |
| `ink-950` | `#18211F` | Primary text and high-emphasis icons |
| `slate-650` | `#5D6A66` | Secondary text and inactive controls |
| `slate-250` | `#CCD6D2` | Structural dividers and quiet control borders |
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
| `color-selection` | `teal-700` | Selected edge, current-page marker, and active control emphasis |

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

The Current authentication and Project-home surfaces bundle **Inter Variable**
for Latin text and numbers, with the platform sans-serif stack providing Chinese
fallback. Portable Renderer/Cypress fixtures cover both Chinese and English;
each release platform still requires a native visual check. The current Project
home has no machine-readable data region that warrants a monospace family.
Any later replacement, dedicated CJK family, or machine-readable stack requires
real dense-screen fixtures and side-by-side Chinese and English screenshots
rather than an arbitrary host-font change.

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
2. a `224px` context navigation pane containing the personal Workspace label,
   Project navigation list, and account controls; and
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

### Application shell, Project and Board home

```text
┌─ title region ─────────────────────────────────────────────────────────────┐
│ TaskPilot                                                                  │
├──────────────────────┬─────────────────────────────────────────────────────┤
│ Personal space       │ My project                         Project settings │
│ ▱ Projects           │ [Planning] [Delivery]                    + Board    │
│   My project         ├─────────────────────────────────────────────────────┤
│   Launch notes       │ ┌ To do ─────┐ ┌ Doing ────┐ ┌ Done ───────────┐  │
│ + New project        │ │ + Work item│ │           │ │                 │  │
│ Archived projects    │ │ Task card  │ │           │ │                 │  │
│                      │ └────────────┘ └───────────┘ └─────────────────┘  │
│ Ada · Account        │       Board region scrolls horizontally             │
└──────────────────────┴─────────────────────────────────────────────────────┘
```

The shell stays list-led rather than becoming a dashboard. The fixed personal
Workspace is context, not a switcher. ACTIVE Projects remain stable navigation
slots; selecting one opens its remembered accessible Board, or the earliest
Board deterministically. Board tabs/selectors sit inside the Project pane, and
Columns form one bounded horizontal scrolling region so `960 × 640` never gains
page-level horizontal overflow.

Cards are compact Work Item projections, not decorative metric tiles. User
names, Board/Column names, titles, and descriptions are never translated.
Creating a Board selects it; deleting the selected empty Board adopts the
authoritative earliest remaining Board or the truthful zero-Board state with one
primary create action. The Board-local overflow exposes permanent deletion as a
danger action without introducing a second settings page. Its confirmation
states that the action is irreversible, only an empty Board qualifies, Columns
are removed, and Project-owned Work Items remain; it requires the exact current
Board name, prevents duplicate submission, and returns focus to the stable Board
action trigger. A dirty confirmation requires explicit discard. When the result
is unknown, the work surface exposes only reconciliation retry or leaving the
Project; a committed deletion followed by refresh failure is labeled separately.
Dialogs use the first meaningful field, preserve input on validation errors, and
return focus.

Activating a Card opens an overlay only after authoritative Work Item detail has
loaded; the Card itself is location context, not a detail snapshot. The initial
view is a read-only Focused Work Sheet: the actual Work Item title is the unique,
single-line Dialog heading (26px/700), description is the full-width multiline
body (14px/1.6), and created/updated times share a muted audit footer (11px).
There is no generic detail heading, duplicate title field, current-Board block,
Placement/Column property row, or Work Item state. The Board canvas expresses
location, and Board drag remains the movement entry point.

The sheet uses a viewport-responsive stable work surface. At a standard desktop
window it is approximately `760 × 480px`; width and height both contract to
viewport-safe margins in smaller windows. Its header/close control and audit
footer stay pinned, the description body absorbs ordinary free space, and only
the middle content region scrolls when content is long. Entering or leaving edit mode, pending saves, saved feedback, validation
errors, temporary failures, and conflicts never resize or recenter the shell
unless the state introduces a genuine new content footprint. Opening the sheet
moves semantic focus to its unique heading without visually selecting an editable
field.

Static fields remain flat rather than permanent outlined cards or selected
surfaces. Pointer hover may reveal a low-contrast local surface, while keyboard
`focus-visible` and active editors use a soft action-colored boundary and ring;
neither state adds elevation or turns the whole row into a card. Each editable
field is a named, focusable trigger rendered in one layout slot shared by its
read and edit surfaces. The title trigger and input use the entire width left of
the close control, retain an approximately 16px gap, share single-line metrics,
structural box model, and actual text origin, and truncate long read values with
an ellipsis while preserving the full value for editing and accessibility. Title
editing uses the same reserved full-width field boundary and caret as the read state, matching the description editor while preserving a stable text origin. The description trigger and textarea span the content width and share
the same flexible multiline body, with an approximately `128px` minimum. Both read and edit text begin at the same left-top padded origin, so the
surface behaves like a normal writing area rather than vertically centering short
content; the body expands within the stable desktop sheet and contracts safely
with the viewport. The “描述”/“Description” label stays mounted in every mode.

Only one field becomes editable at a time, with local draft and error treatment;
the other field stays readable. Pending state keeps the editor and draft mounted
and shows saving feedback until the authoritative result arrives, and IME
composition Enter never submits. The interaction follows one Quiet Precision
direction: hover/focus reveals the editable affordance without introducing a
permanent action bar, decorative gradient, or second design system. Title saves
with `Enter` or true focus exit; description keeps ordinary `Enter` for newlines
and saves on true focus exit or `Ctrl/Cmd+Enter`. A field `Escape` discards only
its unsubmitted draft. Switching fields or dismissing the detail saves a dirty
field once, then continues only after success. Lightweight saving/saved text
renders only when meaningful, adjacent to the affected field without a permanent
blank row or layout shift, and settles without spatial animation. Validation,
temporary failure, and conflict alone reveal compact recovery actions. Closing
read-only detail returns focus to the originating Card. If an authoritative
update removes that Card, focus falls back to the selected Board control.
Conflict presentation keeps the local draft visibly distinct from the reloaded
authoritative value and requires retry or discard; it never implies automatic
merge or success. These interaction states are transient UI state, not a Current
Work Item business lifecycle.

Card move supports pointer drag;
the pointer's closest Card edge selects an exact insertion position, while one
Card-height slot replaces the source Card in layout while one lifted drag preview
follows the pointer. Surrounding Cards yield through a short, interruptible FLIP
translation and the target Column combines outline, elevation, and a structural
signal rather than color alone. Editing a Work Item and selecting its
Column is the non-drag equivalent. Moves preview
locally, adopt the successful server snapshot, and roll back with one associated
alert and reload action on failure. Focus follows the moved Card and announcements
use a polite live region. Reduced motion removes spatial transitions without
hiding the slot, outline, or other state changes.

### Project operation layers

- **Create Project:** a focused dialog with name and optional description. It
  creates one request id for the user intent and retains that id across an
  uncertain retry. Success selects the returned Project and restores focus to
  the new Project row.
- **Project settings:** a reversible main-pane view for name and description.
  Save carries the currently displayed version. Archive is a separate warning
  action; success selects the next ACTIVE Project or the truthful empty state.
- **Archived Projects:** a main-pane list, reached from the navigation, with a
  Restore action per row. Restoration returns the Project to the ACTIVE list
  without silently changing the current Project.
- **Project Danger Zone:** Project permanent deletion is available only from
  Project settings. A modal repeats the current Project and personal-space
  context, requires the exact current name, and submits that name plus the
  displayed version. Success removes the Project and selects another ACTIVE
  Project or the empty state.
- **Board danger action:** empty Board permanent deletion is available from the
  selected Board's overflow. Its exact-name Dialog uses the shared danger style,
  keeps mutation controls disabled while pending, and never suggests that Work
  Items are deleted. Success adopts Main's authoritative Board home, including
  the zero-Board state; uncertain results replace the mutable Board surface with
  reconciliation-only recovery.
- **Account menu:** shows the real avatar/name, locale selector, and logout. It
  contains no profile-storage explanations or future provider inventory.

Dialogs move focus to the first meaningful field, trap keyboard focus, close on
Escape only when no mutation is pending, and return focus to their trigger.
Mutation buttons retain width while pending. Conflict or field errors stay in
the owning layer and preserve input; session expiry clears the protected shell
and returns to sign-in through the authoritative session state.

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

Authentication uses the **Quiet project desk** palette and interaction grammar,
with a distinct signed-out composition: one restrained brand panel describes
human-and-Agent board collaboration while one left-aligned decision panel owns
the active authentication task. A low-contrast board field spans the lower
brand panel as ambient product context; it fades behind the mid-upper product
statement instead of behaving like a separate bottom illustration. The brand
panel is product orientation, not a second form, feature inventory, or place for
implementation and storage rules.

**Current Work Graph background:** the signed-out brand panel carries an
`aria-hidden`, pointer-transparent Work Graph layer behind the
wordmark/message/footer. Its baseline is one quiet 16-pixel grid with no
self-moving nodes or route particles. On fine-pointer two-column layouts, real
pointer movement lights full 16 × 16 cells on the same grid origin along the
sampled path. Skipped cells are interpolated and staggered; each new record
chooses a controlled color and optional symbol that remain stable while that
cell grows from its center, briefly holds, then shrinks and fades. The short,
bounded trail decays completely after input stops. The layer does not represent live
Work Items, Agents, approvals, Evidence, Workspace data, authentication state,
or execution telemetry. Reduced-motion, coarse-pointer, unsupported
media-query, and folded-brand-panel states retain only the static baseline;
window blur or page hiding clears pending trail work. The right-side
authentication panel never moves or reflows because of the decoration.
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
| authenticated handoff | Announce completion briefly while the authoritative session subscription moves the app into the authenticated Project home. |

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

### Project-home states

**Loading** preserves the full shell: Workspace label, several neutral Project
row skeletons, and a main-pane title skeleton. It does not briefly show the old
account page or an empty Project list.

**No ACTIVE Projects** keeps the personal Workspace and account controls visible
and presents one primary `Create Project` action. Archived Projects remains
reachable so an archived Project can be restored instead of creating another.

**Retryable load error** replaces only the protected Project content with a
specific error and `Retry`; it never converts a transport failure into an empty
state. A `SIGN_IN` recovery or authoritative signed-out event leaves no Project
name or description visible.

**Stale completion** is discarded when any Main response key differs from the
accepted session generation or User. Project-scoped responses additionally
must match the requested Workspace and Project. A discarded completion does not
show success, error, rows, or form closure in the replacement session.

**Long content** wraps names and descriptions rather than resizing the shell.
The current Project name is always available in full in the main heading; a
navigation row may clamp after two lines with its full name in the accessible
label and native title.

### Project-home wireframes

```text
Empty ACTIVE list                    Archived Projects
┌───────────────────────────────┐    ┌──────────────────────────────────────┐
│ Personal space               │    │ Archived Projects            Back   │
│ No active projects           │    │──────────────────────────────────────│
│ Create a project to begin.   │    │ Launch notes       Archived   Restore│
│ [ Create Project ]           │    │ Old prototype      Archived   Restore│
└───────────────────────────────┘    └──────────────────────────────────────┘

Project settings                     Permanent deletion
┌───────────────────────────────┐    ┌──────────────────────────────────────┐
│ Project settings       Back   │    │ Permanently delete “My project”?    │
│ Name        [My project     ] │    │ Personal space · cannot be undone   │
│ Description [              ] │    │ Type My project to confirm          │
│                [Save]         │    │ [My project                       ] │
│───────────────────────────────│    │                 [Cancel] [Delete]    │
│ Archive project      [Archive]│    └──────────────────────────────────────┘
│ Danger Zone          [Delete] │
└───────────────────────────────┘
```

Creation and edit forms contain no business-rule essay. Short helper or error
text appears only when it enables the next action. Archiving and restoring use
their exact verbs. Permanent deletion uses the danger color and never reuses the
teal primary treatment.

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
No active projects
Create a Project to begin.
[Create Project]
```

Do not add an illustration by default. Archived Projects remain a separate,
reachable recovery path; an API error is never rendered as this empty state.

### Error

- Put field errors beside their field and summary failures beside the affected
  pane. Reserve a blocking dialog for an action that cannot safely continue.
- State what failed and what remains safe: “Projects couldn't be refreshed.
  No Project changes were made.”
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

The Current Renderer single-value Select uses one shared trigger/menu recipe for
language and Work Item Column fields. It keeps the stable value controlled by
its caller, renders the menu in a collision-aware portal above dialogs, marks
the selected option with both a check and semantic state, restores focus to the
trigger on dismissal, and disables the whole interaction while its owning form
is pending. Long labels truncate visually without changing their accessible
name, long lists scroll inside the menu, and decorative menu motion is removed
for reduced-motion preferences. Escape dismisses this menu before an enclosing
Dialog.

The signed-out and account language entry points consume the same supported
locale source and switching logic. Their floating, inline, and account layouts
may differ, but their values, option names, keyboard behavior, and focus return
remain one interaction contract.

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
- The decorative login Work Graph is a quiet grid by default; it has no
  autonomous route or drifting particles. Fine-pointer movement is quantized to
  grid-aligned square cells, skipped cells are interpolated into a continuous
  short trail, and the trail decays completely after input stops.
- The trail is limited to the visible brand panel, mutates fixed DOM slots
  through refs, and runs one on-demand `requestAnimationFrame` loop only while
  cells are alive. Reduced-motion, coarse-pointer, and folded narrow-window
  layouts keep the static composition.
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
- [ ] Project slots express destination and selection without repeated icons,
      tree lines, nodes, glow, or decorative status semantics.
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
