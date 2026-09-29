# Agent Runtime Testing Strategy

- **Status:** Target
- **Owns:** Runtime policy, protocol, filesystem, process/PTY, recovery,
  evidence, security, and Windows/macOS native verification layers
- **Read after:** [`architecture.md`](architecture.md),
  [`responsibilities.md`](responsibilities.md),
  [`../../../docs/architecture.md`](../../../docs/architecture.md)
- **Mandatory before:** Adding or changing Runtime behavior, protocol,
  workspace/tool policy, process execution, recovery, or tests

## Principles

Test deterministic policy at the lowest layer, real OS boundaries where mocks
would hide the risk, and recovery with controlled fault injection. A macOS pass
does not substitute for Windows process-tree, PTY, path, junction, encoding, or
locking evidence.

## Planned Test Layers

| Layer | Owns |
| --- | --- |
| Pure unit/property | Grant and message validation, tool policy, local-consent binding, state machines, redaction, limits |
| Protocol contract | JSON-RPC/JSONL framing, Rust-to-TypeScript/JSON Schema compatibility, initialize/version/build/capability negotiation, request IDs, cancellation, bounded queues, malformed/oversized/stale/replayed messages |
| Filesystem integration | Real files, symlinks/junctions, canonical roots, rename/delete races, permissions, large/binary data |
| Process/PTY integration | Output, exit, timeout, cancellation, process-tree cleanup, backpressure, encoding |
| Journal/recovery | Crash points, torn/corrupt records, replay, snapshots, duplicate cloud acknowledgements |
| Adapter contract | Multiple Agent/tool implementations obey the same normalized contract |
| Native system | Supported Windows/macOS artifacts with real process, PTY, path and credential/grant integration boundaries |

## Security and Rejection Cases

- Invalid, expired, revoked, mismatched, replayed, wrong-Attempt, or stale-lease
  execution grants fail before work or another side effect starts; fencing also
  rejects stale heartbeat, evidence, and result submissions.
- A Runtime binary outside the fixed signed installation, an incompatible build
  or protocol, a request before `initialize`, duplicate or unknown request IDs,
  malformed/oversized JSONL, and any non-protocol stdout line fail before work.
- EOF, parent loss, child crash, blocked readers/writers, cancellation races,
  graceful-shutdown timeout, and forced termination stop new requests and claims,
  settle pending requests once, and do not leak an owned process tree. A new
  Runtime cannot resume a side effect without fresh grant/lease validation.
- A cloud `WorkspaceId` cannot substitute for a `LocalWorkspaceBindingId`; a
  wrong Project, Runtime instance, product profile, revoked binding, or recycled
  binding fails before a TaskPilot-owned file operation or process starts.
- Paths escaping through `..`, symlink, junction, case behavior, rename race, or
  platform normalization fail for TaskPilot-owned file operations. Raw absolute
  local paths are not uploaded by default.
- Approved executable, argv, environment, working directory, timeout, mediated
  network target, or other evaluated input changes invalidate local consent.
- Tests distinguish enforceable Runtime-owned HTTP/tool network policy from the
  non-guaranteed egress behavior of an arbitrary child process.
- Malformed Agent output cannot inject protocol messages or bypass tool policy.
- Output and artifact limits prevent unbounded memory/disk use.
- Cancellation and timeout clean the whole supervised process tree.

Tests must state that these controls do not prove OS-level isolation of an
arbitrary subprocess. General Shell or CLI execution cannot pass its release gate
until separate macOS and Windows sandbox, child-network, process-containment,
isolation-failure, and escape tests verify the approved platform design.

## Recovery Cases

Exercise failure before and after journal append, process start, local consent,
cloud approval observation, side-effect acknowledgement, artifact creation,
cloud submission, lease loss, and Desktop or Runtime restart. Recovery must not duplicate
a tool side effect, consent prompt, approval decision, or business transition.
Corrupt, tampered, truncated, or incompatible journal state fails diagnosably
rather than being treated as authority or success. Schema compatibility is tested
across the supported Desktop/Runtime upgrade and rollback baseline; incompatibility
never silently discards or replays work.

Exact recovery outcomes depend on future behavior specs; tests must not encode
an unresolved "continue or pause" choice.

## Native Platform Matrix

- macOS arm64: process groups/signals, PTY, paths/symlinks, filesystem events,
  permissions, inherited stdio EOF, parent loss, sleep/wake and app lifecycle
  integration.
- Windows x64: Job Objects/process trees, ConPTY, drive/UNC paths, junctions,
  case behavior, file locking, encodings, inherited stdio EOF, parent loss,
  Job Object cleanup and app lifecycle integration.
- Additional architectures require an explicit support decision and native
  evidence.

## Quality Gates

Once initialized, a Runtime change is incomplete until focused unit/contract
checks, applicable real-filesystem and process/PTY suites, recovery fault tests,
static analysis, dependency/security checks, and native platform gates required
by its risk pass. Flaky process tests are quarantined only with an owner and
follow-up; security or cleanup behavior cannot exist solely in a nightly suite.
