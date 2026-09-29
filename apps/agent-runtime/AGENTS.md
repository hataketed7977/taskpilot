# Agent Runtime Instructions

## Scope

These instructions apply to `apps/agent-runtime/` and inherit
[`../../AGENTS.md`](../../AGENTS.md). This directory currently owns Target
documentation only; no Runtime executable or dependency graph exists yet.

## Required Navigation

Read the root [`documentation map`](../../docs/README.md), the
[`business model`](../../docs/business-model.md), and the root
[`architecture`](../../docs/architecture.md). Then select the local document:

| Document | Mandatory before |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Changing Runtime process boundaries, local protocol, workspace guard, tools, PTY, journal, Diff, artifacts, or platform adapters |
| [`docs/responsibilities.md`](docs/responsibilities.md) | Adding an Agent adapter, tool, execution policy, supervisor, worker, or integration |
| [`docs/testing-strategy.md`](docs/testing-strategy.md) | Adding or changing Runtime behavior, security boundaries, recovery, process handling, or tests |

## Local Rules

- Treat every workspace path, tool request, process, environment value, log,
  Diff, artifact, protocol message, and cloud instruction as untrusted input.
- Never claim local project-root checks are an OS-level sandbox. Arbitrary child
  processes inherit the user's OS authority unless a separately designed and
  implemented isolation boundary says otherwise.
- Execute only `LOCAL_DESKTOP` work. Do not host remote Managed Agent provider
  SDKs, credentials, callbacks, polling, or `HYBRID` behavior here.
- Never store or reuse the Desktop's long-lived user token. Local managed
  execution requires a future short-lived execution-grant contract.
- Keep canonical business state, approval authority, and final authorization in
  Gateway/Core API. The Runtime reports evidence; it does not write business
  tables or invent domain outcomes.
- Keep platform differences behind narrow adapters and require native Windows
  and macOS evidence for process-tree, PTY, path, filesystem, and recovery work.
- Add focused automated tests with behavior changes once code exists; never
  describe Target contracts as implemented.
