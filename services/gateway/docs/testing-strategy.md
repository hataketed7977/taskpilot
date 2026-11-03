# Gateway Testing Strategy

- **Status:** Current
- **Owns:** Gateway test layers, transport/security cases, and verification gates
- **Read after:** [`../../../docs/architecture.md`](../../../docs/architecture.md),
  [`architecture.md`](architecture.md),
  [`responsibilities.md`](responsibilities.md)
- **Mandatory before:** Implementing or changing Gateway behavior or tests

## Development Loop

Use focused Red-Green-Refactor for observable route/filter behavior:

1. Add the smallest failing protocol or configuration case.
2. Implement the smallest transport-policy change.
3. Refactor without weakening the external assertion.
4. Run focused tests, then the serial module quality gate.

Do not duplicate Core business fixtures in Gateway tests.
 Tests follow the production responsibility packages (`config`, `route`, and
`health`), while the comprehensive route integration test intentionally keeps
transport-policy cases with the observable route/stub boundary instead of
splitting shared infrastructure merely to mirror directories.

## Current Test Layers

| Layer | Implementation | Covers |
| --- | --- | --- |
| Configuration | Spring context and property tests | valid/invalid Core origin, limits, timeouts, health groups |
| Route/filter integration | `WebTestClient` plus observable Reactor Netty stub | catalog, path/query/body preservation, headers, limits, timeout, errors, no retry |
| Availability integration | unavailable Core stub/origin | readiness and stable 503 transport response |
| Cross-contract | Canonical contract projection tests plus strict Gateway manifest-loader tests | manifest and approved ingress operations are equal; missing, empty, duplicate, and invalid manifests fail startup |
| Packaged smoke | `bootJar` with real local Core or protocol probe | startup, probes, canonical and rejected legacy path |
| System journey | compiled Desktop Main/IPC/Preload → packaged Gateway → Core/PostgreSQL/Redis | selected real route and no Core fallback |
| Build contract | Gradle runtime graph and packaged JAR inspection | no MVC, Core production class, DB/Flyway/Redis/Modulith runtime |

## Required Current Cases

- Every approved method/path forwards exactly once with path, query, and body
  preserved; unknown, legacy, wrong-method, future, Swagger/OpenAPI, and
  management requests never reach the stub.
- Forged identity/tenant/role/scope, forwarded, proxy, hop-by-hop, cookie, and
  connection-nominated headers are removed; required credential/content headers
  remain.
- One valid bounded correlation ID is reused. Missing, repeated, invalid, or
  overlong values are replaced consistently upstream and downstream.
- Declared, unknown-length, and explicitly chunked request bodies pass at
  `limit - 1` and `limit`, fail at `limit + 1`, and do not reach Core when
  rejected.
- Declared and streaming response limits, request/response headers, slow Core,
  disconnects, and malformed/truncated upstream framing return stable complete
  local errors without leaking internal origin or low-level exception text.
- Core business Problem Details preserve status, media type, allowed business
  headers, and body semantics.
- Mutation disconnects do not trigger an automatic retry.
- Credentials, OAuth code/state, cookies, bodies, and internal origin are absent
  from transport errors and captured logs.
- Core unavailable makes readiness fail while liveness remains up.

## Commands

Run Gradle commands serially in this checkout:

```bash
./gradlew --no-daemon :services:gateway:test --tests '*RouteIntegrationTest'
./gradlew --no-daemon :services:gateway:test --tests '*UpstreamUnavailableIntegrationTest'
./gradlew --no-daemon :services:gateway:qualityCheck
pnpm dev:smoke
pnpm --filter @taskpilot/desktop test:system
```

`qualityCheck` includes compile, test, ktlint, Detekt, build-contract, Kover,
and `bootJar` evidence. The module currently enforces at least 80% line and 70%
branch coverage for hand-written production code, excluding only the application
entry point.

## Evidence Boundary

Gateway tests prove protocol policy and local topology, not Core business
correctness, real GitHub OAuth, platform-native Desktop release behavior, or
production Core network isolation. Core owns authorization and OpenAPI tests;
Desktop owns consumer/fallback tests; a deployment owner must later prove that
Core cannot be reached externally except through Gateway.
