# Core API Agent Instructions

## Scope

These instructions apply to `services/core-api/` and inherit
[`../../AGENTS.md`](../../AGENTS.md).

## Required Navigation

Read the root [`documentation map`](../../docs/README.md). Read the root
[`business model`](../../docs/business-model.md) for any business-facing
change and the root [`architecture`](../../docs/architecture.md) for any
technical change, then select the local document matching the task:

| Document | Mandatory before |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Changing capability boundaries, persistence, APIs, workflow runtime, durable jobs, or provider integration |
| [`docs/responsibilities.md`](docs/responsibilities.md) | Adding a use case, capability area, API adapter, durable job, or ownership boundary |
| [`docs/testing-strategy.md`](docs/testing-strategy.md) | Adding or changing Core API behavior or tests |

Read every prerequisite declared by the selected document. Local engineering
documents implement the root business model; they do not redefine its terms or
rules.

## Local Rules

- The Kotlin/Spring foundation is initialized. Treat executable code and tests as
  the source of truth for the implemented scaffold, while the local documents
  remain Target for unimplemented business architecture.
- Documentation-only work must not create source, migrations, or runtime
  configuration unless an approved implementation Change explicitly requires it.
- Preserve the pragmatic capability boundaries and dependency rules documented
  locally; do not introduce tactical-DDD layers or artifacts by default.
- Do not expose persistence entities across modules or HTTP boundaries.
- Keep Desktop API, server-side remote-provider adapters, local Runtime
  managed-execution, provider-callback ingress, and public API adapters distinct.
  `core-api` owns `AgentRun`, `ApprovalRequest`, executor routing,
  authorization, and business-database truth; providers and Runtime submit
  normalized, authenticated, idempotent observations and never write those
  tables directly.
- Behavior changes require focused tests and module-boundary verification. Run
  the owning test layer described in `docs/testing-strategy.md`; use
  `:services:core-api:qualityCheck` for the complete local/CI Core API gate.
