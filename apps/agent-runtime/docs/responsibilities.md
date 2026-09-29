# Agent Runtime Responsibilities

- **Status:** Target
- **Owns:** Placement of Agent adapters, tool evaluation, local execution,
  workspace access, evidence, recovery, and platform-specific behavior
- **Read after:** [`../../../docs/business-model.md`](../../../docs/business-model.md),
  [`architecture.md`](architecture.md)
- **Mandatory before:** Adding an Agent adapter, tool, execution policy,
  supervisor, worker, journal record, Diff/artifact producer, or platform adapter

## Owns

- Runtime instance identity and authenticated local/cloud protocol endpoints.
- Run worker lifecycle, resource bounds, cancellation, and crash recovery.
- Agent CLI/SDK adapters and structured tool intents.
- Canonical path evaluation for TaskPilot-owned workspace operations.
- Tool risk evaluation and enforcement of immutable approvals.
- Process-tree and PTY supervision on supported native platforms.
- Bounded logs, execution journal, Diff, artifact metadata, and evidence upload.
- Idempotent synchronization of local evidence with the cloud control plane.

## Does Not Own

- User login sessions or long-lived Desktop credentials.
- Workspace membership, Project access, workflow progression, Agent Run truth,
  approval authority, or other canonical business decisions.
- Desktop windows, React UI, native dialogs, or notifications.
- Core API persistence or Gateway routing policy.
- Kernel-enforced isolation that has not been separately designed and built.

## Internal Ownership

| Area | Responsibility |
| --- | --- |
| `supervisor` | Runtime lifecycle, protocol sessions, worker registry, reconnect and recovery |
| `protocol` | Versioned schemas, authentication, idempotency and compatibility |
| `execution` | Run context, limits, cancellation, structured results |
| `agents` | Provider/CLI/SDK adaptation to normalized Agent interactions |
| `tools` | Intent schemas, policy evaluation, approval binding, dispatch |
| `workspace` | Root identity, canonicalization, TaskPilot-owned file operations |
| `process` | Process tree, PTY, output, timeout, termination and platform adapters |
| `journal` | Durable local events, snapshots, evidence references and synchronization |
| `changes` | Diff/status calculation and bounded artifact metadata |
| `platform` | Narrow Windows/macOS implementations with shared contracts |

## Placement Rules

- Agent adapters do not bypass tool policy or call filesystem/process adapters
  directly for side effects.
- Workspace helpers reject ambiguous or out-of-scope paths but never claim to
  restrict an arbitrary subprocess's OS permissions.
- Protocol handlers validate and authorize before creating work; workers do not
  infer business permission from the presence of a message.
- Journal writes precede externally visible acknowledgements where recovery
  requires durable evidence.
- Cloud synchronization translates local evidence but cannot rewrite local
  history to manufacture success.
- Platform-specific behavior stays behind a shared semantic contract only when
  both native implementations can actually uphold it.

## Sensitive Data

Environment variables, command lines, workspace contents, logs, Diff, artifacts,
and provider responses may contain secrets. Owners minimize collection, apply
explicit redaction/retention/upload policy, and keep raw local evidence behind
OS file permissions. Security scanning is defense in depth, not proof that data
is non-sensitive.
