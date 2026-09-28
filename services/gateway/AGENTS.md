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
| [`docs/architecture.md`](docs/architecture.md) | Changing Gateway structure, filters, routing, or dependencies |
| [`docs/responsibilities.md`](docs/responsibilities.md) | Adding Gateway behavior, policy, or integration |
| [`docs/testing-strategy.md`](docs/testing-strategy.md) | Adding or changing Gateway behavior or tests |

Read every prerequisite declared by the selected document. Local engineering
documents implement the root business model; they do not redefine its terms or
rules.

## Local Rules

- This subproject is documentation-only until the Kotlin/Spring toolchain is
  explicitly initialized.
- Do not create Gradle files, source directories, configuration, or deployment
  files as part of documentation work.
- Keep the Gateway free of business workflows and business persistence.
- Gateway trust decisions must remain independently enforceable by `core-api`
  where domain authorization is involved.
- Routing and security policy changes require focused tests once a test
  toolchain exists.
