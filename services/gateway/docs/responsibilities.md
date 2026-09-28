# Gateway Responsibilities

- **Status:** Target
- **Owns:** Gateway policy ownership and explicit non-responsibilities
- **Read after:** [`../../../docs/architecture.md`](../../../docs/architecture.md),
  [`architecture.md`](architecture.md)
- **Mandatory before:** Adding a route, filter, security policy, or integration

## Owns

- External route matching and upstream selection.
- Edge credential validation.
- Trusted tenant-context normalization.
- Removal of spoofable internal headers.
- Request correlation and trace propagation.
- Route-level timeouts, body limits, and rate limits.
- Consistent transport-level policy errors.
- Gateway health, readiness, and operational metrics.

## Does Not Own

- User, Workspace, Project, Work Item, Board, or Agent persistence.
- Final membership or resource authorization.
- Business validation.
- API response aggregation for screens.
- Public API DTOs or OpenAPI generation.
- Billing, plans, or entitlement decisions beyond enforcing a supplied quota
  policy.

## Policy Boundaries

| Policy | Gateway responsibility | `core-api` responsibility |
| --- | --- | --- |
| Authentication | Validate token or credential | Resolve domain principal |
| Tenant | Derive and normalize context | Verify membership and ownership |
| Authorization | Coarse route access | Use-case and resource authorization |
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

- A new route declares its API surface, authentication mode, timeout, size
  limit, and rate-limit key.
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
