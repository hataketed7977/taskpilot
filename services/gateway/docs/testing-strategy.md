# Gateway Testing Strategy

- **Status:** Target
- **Owns:** Gateway test layers, policy cases, and verification gates
- **Read after:** [`../../../docs/architecture.md`](../../../docs/architecture.md),
  [`architecture.md`](architecture.md),
  [`responsibilities.md`](responsibilities.md)
- **Mandatory before:** Implementing or changing Gateway behavior

## Development Loop

Use RED-GREEN-REFACTOR:

1. Add a focused failing policy or routing test.
2. Implement the smallest Gateway change.
3. Refactor while preserving route behavior.
4. Run focused, related integration, and required project checks.

Exact Gradle commands must be added when the Gateway project is initialized.

## Test Layers

| Layer | Planned approach | Covers |
| --- | --- | --- |
| Unit | JUnit Jupiter with Kotlin-friendly mocks | Pure policy, key, and header logic |
| Filter integration | Spring `WebTestClient` | Filter ordering and response behavior |
| Route integration | Stub upstream server | Predicates, rewrites, forwarding, timeouts |
| Infrastructure integration | Testcontainers Redis | Distributed rate-limit behavior |
| Security integration | Signed test tokens and invalid credentials | Trust-boundary enforcement |
| Smoke | Packaged service with stub `core-api` | Startup, health, and basic routing |

## Required Security Cases

- Missing, expired, malformed, and wrong-audience credentials.
- Forged tenant, principal, role, and correlation headers.
- Tenant context derived from each supported trusted source.
- Desktop, managed-execution, and public credentials rejected from every
  incompatible route surface.
- Forged Runtime identity, expired or replayed execution credentials, and
  cross-Workspace/Project/run context rejected once the grant contract exists.
- Management endpoints inaccessible through public routes.
- Secrets and tokens absent from logs and error bodies.

## Required Routing Cases

- Desktop, managed-execution, and public API route separation.
- Versioned public route selection.
- Unknown routes return a stable transport-level response.
- Request-size rejection occurs before upstream forwarding.
- Timeout behavior does not leak internal addresses or stack traces.
- Non-idempotent requests are not retried by default.
- Correlation metadata reaches the stub upstream.

## Rate-Limit Cases

- Limits are isolated by tenant, credential, and route policy.
- One tenant cannot consume another tenant's bucket.
- Redis unavailability follows an explicitly tested fail-open or fail-closed
  policy per route class.
- Retry-after and quota headers are consistent where exposed.

## Test Design Rules

- Test externally observable HTTP behavior.
- Use deterministic clocks for token and rate-limit windows.
- Keep upstream stubs protocol-focused; do not duplicate business behavior.
- Do not mock Spring Cloud Gateway internals when an integration test is
  practical.
- Avoid end-to-end domain assertions in this subproject.
- Representative packaged Desktop/system journeys prove only selected routing
  and authentication paths; they do not replace the Gateway's header-trust,
  credential, rate-limit, timeout, or route-isolation matrix.
- Keep packaged Desktop setup and domain fixtures outside Gateway tests. Gateway
  tests use protocol-focused upstream stubs and assert externally observable
  HTTP behavior.

## Execution and Coverage Policy

- Run pure policy tests first and route, security, and Redis integration suites
  in parallel where infrastructure permits.
- Apply the repository-wide changed-code and non-regression coverage gates from
  the [root architecture](../../../docs/architecture.md#coverage-and-effectiveness-policy)
  to hand-written Gateway production code.
- Authentication, tenant-context derivation, forged-header rejection,
  route-surface separation, retry eligibility, and rate-limit isolation are
  critical branches under the higher repository threshold.
- Generated configuration metadata and framework-generated code may be
  excluded. Hand-written filters, predicates, key resolvers, header logic, and
  error mapping are not excluded.
- Coverage from a unit test does not replace observable `WebTestClient`, stub
  upstream, signed-token, or Redis tests for the relevant boundary.
- Track route/security suite duration and flake rate. Reuse infrastructure when
  state remains isolated, and do not remove negative cases to meet a time
  budget.

## Quality Gates

Once initialized, a Gateway change is incomplete until:

- Focused tests pass.
- Applicable changed-code coverage, critical-branch coverage, and whole-Gateway
  non-regression gates pass.
- Route and security integration tests pass.
- Kotlin compile, lint, and formatting checks pass.
- Configuration binding and startup smoke checks pass.
- Any changed trust-boundary rule has a negative security test.
