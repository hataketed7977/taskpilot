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

- This subproject is documentation-only until the Kotlin/Spring toolchain is
  explicitly initialized.
- Do not create Gradle files, source directories, migrations, or runtime
  configuration as part of documentation work.
- Preserve the pragmatic capability boundaries and dependency rules documented
  locally; do not introduce tactical-DDD layers or artifacts by default.
- Do not expose persistence entities across modules or HTTP boundaries.
- Behavior changes require focused tests and module-boundary verification once
  a test toolchain exists.
