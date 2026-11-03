# Gateway Responsibilities

- **Status:** Current with explicitly marked Target extensions
- **Owns:** Gateway technical-policy ownership and non-responsibilities
- **Read after:** [`../../../docs/architecture.md`](../../../docs/architecture.md),
  [`architecture.md`](architecture.md)
- **Mandatory before:** Adding a route, filter, transport policy, or integration

## Current Ownership

- Explicit canonical HTTP method/path matching and the single Core upstream.
- Path/query/body-preserving forwarding for allowlisted operations.
- Request/response header hygiene and removal of spoofable identity, tenant,
  scope, proxy, hop-by-hop, and cookie headers.
- Bounded correlation identifiers and response propagation.
- Request/response/header limits, connect/response timeouts, and no mutation
  retry.
- Stable transport-level Problem Details without secrets or internal origins.
- Gateway liveness and Core-aware readiness.
- Independent packaged build, configuration binding, logs, and quality gate.

## Does Not Own

- User, Workspace, Project, Board, Column, Work Item, Placement, session, or
  Agent persistence and lifecycle.
- Credential validity, final membership/resource authorization, or tenant
  derivation. Core API owns all three for current routes.
- Business validation, schema evolution, response aggregation, or client UI.
- Business DTOs, operation semantics, runtime OpenAPI, or Swagger publication.
- A database, migration, Redis state, business cache, or distributed workflow.
- Production ingress/TLS/network-policy deployment evidence.

## Current Policy Split

| Concern | Gateway | Core API |
| --- | --- | --- |
| Route | Exact technical allowlist and upstream selection | Canonical controller mapping |
| Credential | Preserve the required `Authorization` header | Authenticate session/access credential |
| Identity and tenant | Remove spoofed caller metadata | Resolve actor and persisted scope |
| Authorization | None beyond technical route admission | Final use-case and resource authorization |
| Validation | Header/body/time bounds | DTO and business validation |
| Errors | Local transport Problem Details | Business Problem Details |
| Contract docs | No public docs | Runtime OpenAPI in Local/Test only |

## Route Change Rules

- A current route must correspond to one implemented canonical Core operation
  and be compared in both directions by automated contract tests.
- Do not add a broad `/v1/**` predicate, a client-named prefix, a legacy alias,
  or a path rewrite when direct path preservation is sufficient.
- Declare method, PathPattern, authentication expectation, limits, timeout, and
  retry behavior. Mutation routes remain non-retrying by default.
- A callback route may be anonymous at Core only when the owning Core security
  contract explicitly allows it; Gateway does not invent trust.
- Unknown, management, OpenAPI/Swagger, future, and wrong-method requests fail
  before contacting Core.
- A new surface such as managed execution or public API requires an approved
  trust/credential design; it must not be inferred from the existing catalog.

## Operational Rules

- Logs and responses include bounded correlation metadata but omit credentials,
  cookies, request/response bodies, OAuth secrets, internal origins, and stack
  traces.
- Liveness reports the Gateway process; readiness separately accounts for Core
  availability.
- Local process ownership, health, and diagnostics are checkout-scoped.
- Production routing, private Core binding, and network policies belong to a
  future deployment owner and require real environment evidence.
