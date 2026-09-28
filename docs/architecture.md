# TaskPilot Architecture

- **Status:** Target
- **Owns:** System topology, cross-project technical constraints, quality
  policy, and top-level project boundaries
- **Read after:** [`../AGENTS.md`](../AGENTS.md)
- **Mandatory before:** Creating a subproject or changing a cross-project
  boundary

## Scope

This document is the authoritative home for overall system architecture,
cross-project technical constraints, and confirmed project boundaries while the
repository is being formed. Product vocabulary and behavior belong to the
[`business model`](business-model.md). This document may temporarily contain
frontend, Gateway, backend, CLI, or infrastructure decisions until a real
subproject exists to own the detail.

The repository currently contains documentation-only subproject boundaries. No
runnable application, build configuration, database migration, or API
specification has been initialized.

## Diagram Conventions

Architecture documents use Mermaid as the rendering format and select notation
by the question being answered:

| Question | Mermaid diagram |
| --- | --- |
| How systems or modules connect | `flowchart` |
| Which domain concepts relate | `classDiagram` |
| How a lifecycle changes state | `stateDiagram-v2` |
| How one scenario executes over time | `sequenceDiagram` |
| How implemented tables relate | `erDiagram` |

Use UML semantics through Mermaid where they improve precision. Keep diagrams
conceptual and pair them with tables for ownership, invariants, and details.
Physical ER diagrams belong to the owning backend subproject after its schema
exists.

## System Shape

```mermaid
flowchart LR
    web["React Web"]
    external["Third-party HTTP clients"]
    cli["Future CLI"]
    edge["Edge / TLS / WAF"]
    gateway["Kotlin API Gateway"]
    api["Kotlin core-api control plane"]
    runner["Future Agent Runner execution plane"]
    provider["Agent / model providers and tools"]
    postgres[(PostgreSQL)]
    redis[(Redis technical state)]

    web --> edge
    external --> edge
    cli --> edge
    edge --> gateway
    gateway --> api
    gateway --> redis
    api --> postgres
    api -. dispatch and status protocol .-> runner
    runner --> provider
```

`core-api` remains the owner of AgentRun business state. When Agent execution is
implemented, long-running or resource-intensive work runs in a separately
operated Runner process so API availability, deployment, and resource limits are
not coupled to an execution attempt. This is a process and failure-domain
boundary, not an initial business microservice or independent source of truth.
The Runner uses an authenticated internal protocol and never writes `core-api`
business tables directly.

Redis is optional technical infrastructure. The Gateway may use it for a proven
distributed rate-limit requirement. `core-api` adds a Redis dependency only
when a documented cache or coordination use case, ownership, expiry, and
failure policy exist; Redis never owns business truth.

```mermaid
flowchart LR
    api2["core-api / Agent Runtime area"]
    db2[(PostgreSQL AgentRun truth)]
    runner2["Agent Runner"]
    artifacts["Artifact / log storage"]
    secrets["Protected credential store"]

    api2 --> db2
    runner2 -->|claim, heartbeat, result| api2
    runner2 --> artifacts
    runner2 --> secrets
```

## Top-Level Project Boundaries

```text
taskpilot/
├── apps/
│   ├── web/
│   │   ├── AGENTS.md
│   │   └── docs/
│   └── cli/                 # Future
├── services/
│   ├── gateway/
│   │   ├── AGENTS.md
│   │   └── docs/
│   └── core-api/
│       ├── AGENTS.md
│       └── docs/
├── contracts/               # Future, when API specifications exist
├── docs/
│   ├── README.md             # Documentation knowledge map
│   ├── business-model.md     # Product vocabulary and behavior
│   └── architecture.md       # Cross-project technical architecture
├── AGENTS.md
└── README.md
```

Do not create future directories until the corresponding project or artifact is
implemented.

The current Web, Gateway, and Core API boundaries each have their own
`AGENTS.md` and `docs/`. The future CLI receives the same structure when
created.

## Technology Direction

- Web: React, TypeScript, Vite, shadcn/ui, and TanStack Query. See
  [`apps/web/docs/architecture.md`](../apps/web/docs/architecture.md).
- Gateway: Kotlin and Spring Cloud Gateway. See
  [`services/gateway/docs/architecture.md`](../services/gateway/docs/architecture.md).
- Core API: Kotlin, Spring Boot, and Spring Modulith. See
  [`services/core-api/docs/architecture.md`](../services/core-api/docs/architecture.md).
- Data: PostgreSQL as the system of record; Redis only for a justified
  short-lived technical cache or coordination use case.
- Build: pnpm for JavaScript projects and Gradle Kotlin DSL for Kotlin projects.

Stable, mutually compatible versions are selected when each subproject is
initialized.

## Subproject Documentation

| Subproject | Architecture | Responsibilities | Testing |
| --- | --- | --- | --- |
| Web | [`architecture`](../apps/web/docs/architecture.md) | [`responsibilities`](../apps/web/docs/responsibilities.md) | [`testing strategy`](../apps/web/docs/testing-strategy.md) |
| Gateway | [`architecture`](../services/gateway/docs/architecture.md) | [`responsibilities`](../services/gateway/docs/responsibilities.md) | [`testing strategy`](../services/gateway/docs/testing-strategy.md) |
| Core API | [`architecture`](../services/core-api/docs/architecture.md) | [`responsibilities`](../services/core-api/docs/responsibilities.md) | [`testing strategy`](../services/core-api/docs/testing-strategy.md) |

## SDD Delivery and Review Workflow (Current)

TaskPilot's repository-level OpenSpec workflow is implemented by the project
default [`taskpilot-sdd` schema](../openspec/schemas/taskpilot-sdd/schema.yaml),
its [`test-plan` template](../openspec/schemas/taskpilot-sdd/templates/test-plan.md),
and the generated workflow Skills routed by [`AGENTS.md`](../AGENTS.md). This
section describes the cross-project quality gate; it does not mean the Target
application components described elsewhere in this document already exist.

```mermaid
flowchart LR
    proposal["Proposal"] --> specs["Specs"]
    proposal --> design["Design"]
    specs --> testPlan["Test Plan"]
    design --> testPlan
    testPlan --> tasks["TDD Tasks"]
    design --> tasks
    tasks --> apply["Apply"]
    apply --> verify["Independent read-only verify"]
    verify -->|blocking finding| apply
    verify -->|ready report| receipt["Record verification receipt"]
    receipt --> preflight["Archive preflight"]
    preflight -->|workspace changed| verify
    preflight -->|evidence current and non-blocking| archive["Archive"]
```

- Before implementation, `test-plan.md` maps changed scenarios and material
  risks to the lowest reliable test layer, names focused and affected commands,
  and records justified exceptions. It references this document and the nearest
  child testing strategy rather than repeating their tool and layer matrices.
- Each executable behavior is delivered as one slice: first prove a valid Red
  failure caused by the missing or incorrect behavior, then make the smallest
  clear Green implementation, then Refactor under the focused and
  risk-appropriate affected protection suite. Compile failures, unavailable
  environments, flaky tests, and unrelated failures are not Red evidence.
- Tests and the production behavior they protect land in the same task group.
  Green cannot be obtained by weakening the approved contract or assertion,
  skipping a test, or moving production behavior into test code.
- Documentation-only, generated-file, tooling, dependency, and pure scaffolding
  changes may record behavioral TDD as not applicable. They still require
  planned automated structural evidence such as schema validation, fixtures, a
  self-test, lint, or build; manual observation does not replace an automatable
  gate.
- After apply completes, a separate reviewer runs the repository-local
  `openspec-verify-change` Skill read-only. A self-review is useful for early
  defect discovery but cannot claim independent verification. Blocking findings
  return to apply and require another focused verification cycle. An applicable
  check reported as `Not verified` prevents archive readiness; OpenSpec
  structural validation alone never proves implementation correctness.
- The coordinator records the independent structured report with
  [`record-verification.sh`](../tools/openspec/record-verification.sh). The
  receipt under the Change's `evidence/` directory records reviewer identity,
  commands, findings, `Not verified` applicability, verdict, timestamps, and a
  conservative fingerprint of relevant workspace content. Receipt data is
  evidence of the read-only review, not another planning artifact.
- Before the Archive Skill is invoked,
  [`archive-preflight.sh`](../tools/openspec/archive-preflight.sh) must pass. It
  rejects missing or malformed receipts, non-independent reviewers, failed
  commands, non-ready verdicts, CRITICAL findings, WARNING findings not
  explicitly accepted as non-blocking, applicable `Not verified` checks, and a
  stale workspace fingerprint. Relevant content changes after review require a
  fresh independent review and receipt; the preflight is check-only and never
  archives or edits the workspace.
- The canonical test tools, layer ownership, critical scenarios, and local
  commands remain in the Web, Gateway, and Core API
  [testing strategies](#subproject-documentation). This workflow only requires
  each change to select and evidence the relevant parts.

The official workflow Skills are reproducibly refreshed with
[`tools/openspec/update-workflows.sh`](../tools/openspec/update-workflows.sh),
which uses temporary OpenSpec profile state instead of modifying a developer's
global profile and verifies that all seven generated Skills report the installed
OpenSpec version. Generated Skill files are never edited manually. The isolated
[`tools/openspec/test-workflow.sh`](../tools/openspec/test-workflow.sh) is the
semantic regression gate for the schema graph, TDD guidance, receipt format,
and archive preflight behavior.

## Cross-Project Testing Boundaries

- Each subproject owns comprehensive risk-based tests for its behavior and
  trust boundary.
  Broader system tests sample cross-project integration and do not repeat each
  subproject's validation, routing, permission, or error matrix.
- Web module integration uses a controlled HTTP boundary. Cypress owns real
  browser interaction and the small system end-to-end suite; it is not the
  default runner for all frontend integration tests.
- A system E2E runs the TaskPilot Web, Gateway, Core API, and PostgreSQL across
  their real boundaries. Third-party identity, model, and Agent providers may
  be deterministic test doubles at TaskPilot-owned outbound boundaries.
- System E2E state is prepared through controlled test fixtures or APIs rather
  than repeated UI setup. Test-only setup capabilities are unavailable in
  production and cannot bypass the business rule under test.
- Gateway routing, header trust, credential, timeout, and rate-limit matrices
  remain Gateway integration tests. Core API domain, tenancy, authorization,
  persistence, migration, concurrency, and idempotency matrices remain Core API
  tests.
- OpenAPI compatibility and generated-client checks are contract gates, not a
  substitute for runtime API or system integration tests.
- Essential security, contract, database, migration, and critical-journey tests
  are blocking before release; nightly execution may broaden coverage but is
  never their only home.

## Risk-Based Test Portfolio

Test depth follows the cost of an escaped defect rather than the size of a file
or a desire to maximize test count:

| Risk class | Examples | Minimum evidence |
| --- | --- | --- |
| Critical | Tenant isolation, authentication and authorization, destructive writes, workflow transitions, idempotency, concurrency, migrations, Runner leases | Focused rule tests, real-boundary integration tests, negative cases, and a representative cross-system journey when user-visible |
| High | Main Work Item and Board workflows, public API compatibility, cache scope, retries, external-provider failure | Unit or module integration tests, contract tests where applicable, and selected browser or infrastructure integration |
| Routine | Presentation variants, formatting, simple mapping, non-critical configuration | The lowest reliable unit or component layer; broader tests only when they catch a distinct failure mode |

Every feature or defect fix identifies its important success, rejection,
boundary, and recovery cases. An escaped production defect adds a regression
test at the lowest layer that reproduces it and, when the escape exposed a
missing boundary check, a test at that boundary as well.

## Coverage and Effectiveness Policy

Coverage is a guardrail over executable production code, not the definition of
quality. The generated projects must report at least:

1. Changed executable line and branch coverage for production code.
2. Whole-subproject line and branch coverage as a non-regression trend.
3. Coverage of critical behaviors and risk cases, maintained as named tests or
   a risk-to-test matrix rather than inferred from line coverage.
4. Contract, architecture-boundary, migration, and supported-browser results,
   which source coverage cannot represent.

After coverage instrumentation exists, the initial blocking floor is 80% line
coverage and 75% branch coverage on changed executable production code. Changed
critical domain, tenant, authorization, concurrency, and idempotency rules
require at least 90% branch coverage unless the change records a concrete,
time-bounded exception. Whole-subproject coverage must not decrease without an
explicit explanation and approval.

These floors are minimum signals, not reasons to add assertions without defect
detection value. A change still fails review when an important behavior,
negative path, or boundary is untested even if its percentages pass.

Generated clients, generated schemas, third-party vendored code, and
compiler-generated artifacts are excluded from source coverage. Declarative
migrations are evaluated by migration tests rather than line coverage. Ordinary
production adapters, controllers, filters, error handlers, repositories, and
configuration logic are not excluded merely because they are inconvenient to
test. Every exclusion is visible in versioned configuration and justified by
category.

For pure critical rules, targeted mutation analysis is introduced after the
relevant toolchain exists. It first establishes a baseline, then prevents the
changed critical scope from regressing. Surviving meaningful mutations require
better assertions or a documented equivalent test; mutation score is not
combined with line coverage into one synthetic quality number.

## Feedback-Time and Reliability Policy

The test portfolio must preserve short feedback loops while retaining
production-realistic boundaries:

- Run focused tests first, then affected subproject suites in parallel, while
  keeping architecture, contract, and changed-risk gates mandatory.
- Establish CI p95 duration baselines after initialization. Initial design
  targets are about 10 seconds for a focused local test, 5 minutes for a fast
  subproject pull-request suite, and 15 minutes for all blocking pull-request
  verification. If a target is missed, split and parallelize suites or optimize
  fixtures before removing coverage.
- Reuse expensive service or container processes where isolation is preserved;
  never reuse mutable test data between cases.
- Use change-based test selection only as an acceleration. Main or scheduled
  full suites must detect incorrect dependency maps, and critical security,
  migration, and contract gates cannot be skipped solely by path heuristics.
- Track pass duration, failure cause, retry count, and flake rate by suite.
  Automatic retries do not convert a flaky test into a pass for quality
  reporting.
- A deterministic failure is blocking. A flaky test is fixed promptly or placed
  in a visible quarantine with an owner, reason, and expiry; quarantined
  critical coverage must be replaced before merge or release.
- Preserve failure artifacts sufficient to reproduce the failing layer while
  redacting credentials and personal data.

Exact CI stages, commands, coverage tools, browser versions, and deployment
topology are defined when the runnable projects and CI configuration exist.
Thresholds may be raised from evidence after a stable baseline; lowering a
threshold is an architectural policy change, not a local test workaround.

## Cross-Project API Boundaries

- The first-party Web API and public HTTP API are separate API products.
- Both may be implemented by `core-api`, but they have separate controllers,
  transport models, compatibility policies, and OpenAPI documents.
- Web-generated TypeScript types belong inside the Web subproject.
- The public API exposes HTTP only; TaskPilot does not publish a public SDK.
- The future CLI consumes the public HTTP API like any other external client.
- The Gateway routes and protects both API surfaces without owning business
  workflows.

### Shared HTTP Contract

Both API surfaces follow shared protocol conventions while retaining separate
transport models and compatibility policies:

- Errors use a machine-readable Problem Details-compatible envelope with a
  stable `code`, HTTP status, correlation identifier, and optional field or
  definition diagnostics. Clients never branch on human-readable messages.
- Mutable resources expose an explicit version. Commands based on previously
  read state carry an expected version, using an API-surface-appropriate field
  or conditional request header, and receive a stable conflict response when
  stale.
- Operations that can be duplicated by network retry, especially run creation,
  revision publication, retry commands, and public resource creation, define an
  idempotency contract before implementation.
- Authorization remains authoritative in `core-api`. Web responses may expose
  allowed actions or available transitions for presentation, but the browser
  does not derive domain permission from role names.
- Definition validation returns path-addressable diagnostics so visual editors
  can identify invalid fields without reimplementing canonical DSL rules.
- `core-api` produces separate OpenAPI artifacts. Web API contract changes and
  generated Web transport types are verified together; public API artifacts
  additionally receive compatibility checks.

Exact status codes, headers, payload schemas, artifact locations, and generation
commands are recorded when the first API contract is implemented.

## Business Model Boundary

Product language, logical business objects, lifecycles, workflow semantics,
Event Storming scenarios, and MVP rules are owned by the
[`business model`](business-model.md). Read it before changing any business
behavior, business-facing API or persistence model, Board/Work Item semantics,
workflow DSL, Agent configuration, execution, approval, comments, or custom
fields.

This architecture document does not duplicate that model. In particular:

- Event Storming is an analysis method, not a requirement for event sourcing,
  a command bus, one module per noun, or one repository per business object.
- `core-api` begins as a pragmatic modular monolith organized into a few
  cohesive capability areas. Direct application-service collaboration and one
  clear database transaction are preferred for ordinary synchronous use cases.
- Business lifecycle transitions remain explicit and testable even when they
  are implemented without tactical-DDD patterns.
- Durable jobs or reliable events are used for long-running Agent work,
  provider callbacks, external side effects, realtime notification, audit, and
  other actual asynchronous boundaries.
- A Board projects Work Items and workflow execution; it never becomes a second
  source of business state.

Implementation structure and persistence may refine the logical model, but may
not silently rename concepts, merge independent lifecycles, or contradict its
business rules.

## Backend Evolution

The initial backend is one Spring Modulith application. It is not a collection
of microservices. Ordinary use cases use direct application-service calls and
clear local transactions; durable jobs or reliable events are introduced only
for genuine asynchronous boundaries.

Module boundaries must allow later extraction, but no external broker, service
discovery platform, or distributed transaction mechanism is introduced before
an actual service boundary exists. Detailed transaction, durable-job, Runner,
and future extraction constraints belong to the
[`Core API architecture`](../services/core-api/docs/architecture.md).

## SaaS Direction

Tenant identity and isolation are cross-cutting requirements. The Gateway may
normalize trusted tenant context, while `core-api` remains responsible for
authorization and tenant-scoped data access.

The initial design must permit future plans, quotas, enterprise identity, audit,
and selected tenant isolation strategies without implementing those
capabilities speculatively.

## Ownership Rule

- Overall topology and cross-project technical contracts remain in this
  document; business relationships and rules belong to
  [`business-model.md`](business-model.md).
- Confirmed detail stays here until a real child project can own it.
- Delegation moves detail to the child `docs/` and replaces the root detail with
  a summary and link in the same change.
- Root and child documentation must not maintain duplicate detailed rules.
- A child document may refine the root architecture but must not silently
  contradict it.
- A cross-project architectural change updates this document first.

## Initial Non-Goals

- No microservices.
- No Node.js BFF.
- No public SDK.
- No external message broker.
- No business persistence or orchestration in the Gateway.
- No long-running Agent execution in a `core-api` HTTP request or transaction.
- No direct Runner access to `core-api` business tables.
- No shared package without multiple real consumers.
