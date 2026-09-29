# Gateway Responsibilities

- **Status:** Target
- **Owns:** Gateway policy ownership and explicit non-responsibilities
- **Read after:** [`../../../docs/architecture.md`](../../../docs/architecture.md),
  [`architecture.md`](architecture.md)
- **Mandatory before:** Adding a route, filter, security policy, or integration

## Owns

- External route matching and upstream selection.
- Route-specific Desktop, Runtime, and public credential validation.
- Trusted principal and tenant-context normalization.
- Removal of spoofable internal headers.
- Request correlation and trace propagation.
- Route-level timeouts, body limits, and rate limits.
- Consistent transport-level policy errors.
- Gateway health, readiness, and operational metrics.

## Does Not Own

- User, Workspace, Project, Work Item, Board, or Agent persistence.
- Final membership, execution-scope, or resource authorization.
- Business validation.
- API response aggregation for screens.
- Public API DTOs or OpenAPI generation.
- Billing, plans, or entitlement decisions beyond enforcing a supplied quota
  policy.

## Policy Boundaries

| Policy | Gateway responsibility | `core-api` responsibility |
| --- | --- | --- |
| Authentication | Validate the route's technical credential and normalize principal context | Resolve the domain principal and authoritative session/run context |
| Tenant | Derive and normalize context | Verify membership and ownership |
| Authorization | Coarse route access | Use-case, execution-scope, and resource authorization |
| Rate limit | Enforce technical quota | Decide plan/entitlement semantics |
| Validation | Request transport limits | Domain and DTO validation |
| Errors | Transport policy errors | Business error contract |

## Header Contract

- External callers cannot set trusted internal identity or tenant headers.
- The Gateway overwrites, rather than preserves, normalized context headers.
- Correlation identifiers are validated or regenerated before forwarding.
- Hop-by-hop and unintended proxy headers are removed.
- Any internal context format is versioned before incompatible changes.

## Route Change Rules

- A new route declares whether it belongs to the Desktop, managed-execution,
  public, or management surface, plus its authentication mode, timeout, size
  limit, and rate-limit key.
- Desktop user credentials are rejected from managed-execution routes, and
  Runtime credentials are rejected from Desktop and public routes.
- A future execution grant remains short-lived and execution-scoped; this
  document does not define its wire contract or let the Gateway decide whether
  an `AgentRun` may advance.
- Public API version routing cannot silently point to an incompatible upstream.
- Route predicates must not depend on mutable business data.
- Fallback behavior must not convert an authorization failure into anonymous
  access.

## Operational Responsibilities

- Metrics distinguish route, status class, policy rejection, and upstream
  latency without exposing high-cardinality identifiers.
- Logs include correlation metadata and omit secrets.
- Health checks distinguish Gateway readiness from upstream availability.
- Alerts are based on error rate, latency, saturation, and policy rejection
  anomalies.
