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
| Pure unit/property | Grant and message validation, tool policy, approval binding, state machines, redaction, limits |
| Protocol contract | Version negotiation, authentication, idempotency, malformed/oversized/stale/replayed messages |
| Filesystem integration | Real files, symlinks/junctions, canonical roots, rename/delete races, permissions, large/binary data |
| Process/PTY integration | Output, exit, timeout, cancellation, process-tree cleanup, backpressure, encoding |
| Journal/recovery | Crash points, torn/corrupt records, replay, snapshots, duplicate cloud acknowledgements |
| Adapter contract | Multiple Agent/tool implementations obey the same normalized contract |
| Native system | Supported Windows/macOS artifacts with real process, PTY, path and credential/grant integration boundaries |

## Security and Rejection Cases

- Invalid, expired, revoked, mismatched, or replayed execution grants fail
  before work starts once that contract exists.
- Paths escaping through `..`, symlink, junction, case behavior, rename race, or
  platform normalization fail for TaskPilot-owned file operations.
- Approved executable, argv, environment, working directory, timeout, network,
  or target changes invalidate the approval.
- Malformed Agent output cannot inject protocol messages or bypass tool policy.
- Output and artifact limits prevent unbounded memory/disk use.
- Cancellation and timeout clean the whole supervised process tree.

Tests must state that these controls do not prove OS-level isolation of an
arbitrary subprocess. Any future sandbox feature requires separate escape and
platform-threat tests.

## Recovery Cases

Exercise failure before and after journal append, process start, approval,
side-effect acknowledgement, artifact creation, cloud submission, and Desktop
disconnect. Recovery must not duplicate a tool side effect, approval prompt, or
business transition. Corrupt or incompatible journal state fails diagnosably
rather than being treated as success.

Exact recovery outcomes depend on future behavior specs; tests must not encode
an unresolved "continue or pause" choice.

## Native Platform Matrix

- macOS arm64: process groups/signals, PTY, paths/symlinks, filesystem events,
  permissions, sleep/wake and app lifecycle integration.
- Windows x64: Job Objects/process trees, ConPTY, drive/UNC paths, junctions,
  case behavior, file locking, encodings, service/app lifecycle integration.
- Additional architectures require an explicit support decision and native
  evidence.

## Quality Gates

Once initialized, a Runtime change is incomplete until focused unit/contract
checks, applicable real-filesystem and process/PTY suites, recovery fault tests,
static analysis, dependency/security checks, and native platform gates required
by its risk pass. Flaky process tests are quarantined only with an owner and
follow-up; security or cleanup behavior cannot exist solely in a nightly suite.
