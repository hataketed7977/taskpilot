# Gateway Agent Instructions

## Scope

These instructions apply to `services/gateway/` and inherit
[`../../AGENTS.md`](../../AGENTS.md).

## Required Navigation

Read the root [`documentation map`](../../docs/README.md). Read the root
[`business model`](../../docs/business-model.md) for any business-facing
change and the root [`architecture`](../../docs/architecture.md) for any
technical change, then select the local document matching the task:

| Document | Mandatory before |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Changing Gateway structure, filters, routing, configuration, or dependencies |
| [`docs/responsibilities.md`](docs/responsibilities.md) | Adding Gateway behavior, policy, or integration |
| [`docs/testing-strategy.md`](docs/testing-strategy.md) | Adding or changing Gateway behavior or tests |

Read every prerequisite declared by the selected document. Local engineering
documents implement the root business model; they do not redefine its terms or
rules.

## Local Rules

- The Gateway is a runnable Kotlin/Spring Cloud Gateway WebFlux subproject.
- The checked-in canonical OpenAPI artifact is the only operation source.
  Gateway consumes its independently generated route manifest as the single
  immutable method/path catalog shared by routing and transport admission.
- Do not add a hand-written or configuration-file route list, generic `/v1/**`
  route, legacy `/desktop/v1/**` alias, client-specific business surface, or
  runtime Core discovery.
- Preserve canonical paths and query/body semantics; the Gateway is a technical
  policy boundary, not a BFF or business adapter.
- Keep the Gateway free of business workflows, business persistence, DTO/schema
  ownership, and final authorization. Core API independently authenticates the
  credential and makes every business authorization decision.
- Do not expose Core API runtime OpenAPI, Swagger, or arbitrary management paths
  through the public Gateway origin.
- Treat the Core origin as internal configuration. It must not enter Desktop
  configuration, client responses, or logs.
- Route, header, limit, timeout, error, health, and configuration changes require
  focused negative tests and `./gradlew --no-daemon
  :services:gateway:qualityCheck`.
- Gradle verification in this checkout runs serially because modules share
  build/test-result locations.
