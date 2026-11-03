# Canonical API Contract Agent Instructions

## Scope

These instructions apply to `contracts/canonical-api/` and inherit
[`../../AGENTS.md`](../../AGENTS.md).

## Required Navigation

Read the root [`documentation map`](../../docs/README.md), root
[`business model`](../../docs/business-model.md), and root
[`architecture`](../../docs/architecture.md). Before changing the contract,
generation, validation, or tests, also read:

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/testing-strategy.md`](docs/testing-strategy.md)

## Local Rules

- `openapi.yaml` is the single checked-in canonical HTTP contract. Do not add a
  second complete method/path, wire-schema, security, response, or ingress map.
- The module owns transport representation and build-time projection, not
  business meaning, authorization, persistence, or application workflows.
- Every operation has one stable unique `operationId` and an explicit
  `x-taskpilot-ingress` value: `canonical`, `provider-callback`, or `none`.
- Generated Core sources and the Gateway route manifest stay under Gradle
  `build/`; never commit generated output.
- Secret-bearing fields required by the approved contract are allowed. They
  must not have examples/defaults, real or sentinel values, or URL exposure.
- Run `./gradlew --no-daemon :contracts:canonical-api:qualityCheck` after any
  local contract, generator, validator, or projection change. Gradle gates run
  serially in this checkout.
