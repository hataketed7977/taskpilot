# Web Responsibilities

- **Status:** Target
- **Owns:** Frontend ownership boundaries, domain-module responsibilities, and
  placement decisions
- **Read after:** [`../../../docs/business-model.md`](../../../docs/business-model.md),
  [`architecture.md`](architecture.md)
- **Mandatory before:** Adding a page, component, Hook, or frontend service

## Owns

- Browser navigation and application shell.
- First-party user workflows.
- Accessible presentation and interaction.
- Form validation and immediate user feedback.
- Web API consumption through typed domain-module API adapters.
- Workspace- and Project-scoped query caching, invalidation, cancellation, and
  optimistic interaction where justified.
- Frontend business models needed to present and manipulate workflows.
- Visual editors for Board definition, Work Item Type, and Workflow definition.

## Does Not Own

- Final authorization or tenant isolation.
- Canonical business invariants and workflow/Work Item action validation.
- Public HTTP API compatibility.
- Agent execution.
- Gateway routing or authentication policy.
- Canonical Board, Work Item Type, or Workflow definition validation.

## Internal Ownership

| Area | Responsibility |
| --- | --- |
| `app` | Providers, routing, auth boundary, global error handling |
| `pages/<page>/<PageName>Page.tsx` | Route entry and page composition |
| `pages/<page>/components` | Route-only React composition that has no independent domain owner |
| `pages/<page>/hooks` | Route parsing and route-only presentation state |
| `modules/<domain>/components` | Business Components for one frontend domain |
| `modules/<domain>/hooks` | React and TanStack Query adapters for that domain |
| `modules/<domain>/models` | Pure business concepts, policies, calculations, and transformations |
| `modules/<domain>/api` | Endpoint calls, DTO mapping, and transport adaptation |
| `modules/<domain>/schemas` | Form and frontend-boundary validation |
| `modules/<domain>/types` | Module declarations with no better model or schema owner |
| `modules/<domain>/index.ts` | Explicit public API for cross-owner imports |
| `components` | Application-wide business-neutral React components |
| `components/ui` | shadcn/ui-based primitives |
| `hooks` | Application-wide business-neutral reusable Hooks |
| `api/generated` | Machine-generated Web API types |
| `api/client.ts` | Credentials, base URL, transport errors, correlation metadata |
| `lib` | Framework and business-neutral utilities |
| `config` | Validated environment and application configuration |

Route-only Components and Hooks start inside their owning page. Business code
starts in a domain module when it has cohesive non-view rules, an API adaptation
boundary, or multiple consumers. Cross-page reuse is not the only reason to
create a module.

## Placement Decisions

| Question | Owner |
| --- | --- |
| Does it only parse or compose one route? | `pages/<page>` |
| Does it express a TaskPilot business concept? | `modules/<domain>` |
| Does it adapt a domain endpoint or generated DTO? | `modules/<domain>/api` |
| Is it pure business logic independent of React and transport? | `modules/<domain>/models` |
| Is it a generic React primitive or application pattern? | Root `components` |
| Is it a generic Hook with no business vocabulary? | Root `hooks` |
| Is it transport infrastructure used by all modules? | Root `api` |

Reuse alone does not make code business-neutral. A `WorkItemCard` used on several
pages belongs to `modules/work-item/components`, not root `components`.

## Module Responsibilities

- Components receive models or view-specific props and render interaction.
- Hooks own Query state, mutation state, and React lifecycle integration.
- Models contain reusable non-view rules and are testable without React.
- API adapters are the anti-corruption boundary around generated DTOs; mapping
  into a separate frontend model is selective rather than mandatory.
- Schemas validate forms and frontend inputs; they do not become a second
  implementation of backend invariants.
- Public `index.ts` files export only capabilities needed by other owners.
- Modules do not expose generated DTOs as their business interface.

## Initial Pages

- Identity pages handle login, logout, session expiry, and account presentation.
- Project pages handle project selection and project-scoped navigation.
- Board pages render and edit Board definition without owning Work Item or workflow truth.
- Work Item pages edit Work Item data and invoke workflow transitions.
- Agent pages manage custom Agent definitions and versions.
- Execution pages present run status and outputs; they do not execute agents in
  the browser.

These page names do not prescribe matching frontend modules. Create a module
only when its frontend behavior satisfies the placement rules above.

## Interaction Rules

- A list row with one primary action should be clickable as a whole.
- Create and edit operations prefer in-place Dialog or Sheet flows.
- Validation warnings disappear immediately when their conditions are resolved.
- Destructive actions require explicit confirmation and visible scope.
- Loading, empty, error, denied, and stale-data states are designed with the
  owning page or module, not added afterward.

## Security and Configuration

- Browser-visible values are never treated as secrets.
- Environment-specific endpoints use build/runtime configuration.
- Tenant identifiers from the browser are untrusted hints; backend authorization
  remains authoritative.
- Generated transport types must not be widened with untyped escape hatches.
- The browser renders server-provided capabilities and available transitions but
  never treats them as a substitute for server authorization.
- Workspace changes cannot expose cached or late-arriving data from another
  Workspace.
