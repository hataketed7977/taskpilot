# Core API Testing Strategy

- **Status:** Target
- **Owns:** Core API business, persistence, API, concurrency, durable-job,
  managed-execution-protocol, and provider-adapter verification
- **Read after:** [`../../../docs/business-model.md`](../../../docs/business-model.md),
  [`architecture.md`](architecture.md),
  [`responsibilities.md`](responsibilities.md)
- **Mandatory before:** Implementing or changing Core API behavior or tests

## Principles

Use the narrowest test that proves the risk, without replacing infrastructure
whose semantics matter:

- Pure state transitions, DSL validation, and policies use fast unit tests.
- Application tests cover use cases and transaction outcomes.
- PostgreSQL, Flyway, locking, JSONB, and constraints use real PostgreSQL.
- Security and HTTP serialization use Spring integration tests.
- Durable jobs, leases, callbacks, and provider adapters receive explicit
  idempotency and failure tests.
- A small full-application suite proves assembly and critical journeys.

Tests prove the business model, not internal class counts or tactical-DDD
patterns. Event Storming does not require event-listener tests when the use case
is intentionally synchronous.

## Development Loop

1. Identify the business rule or failure mode in the business model.
2. Add the smallest failing test at the owning layer.
3. Implement the smallest clear behavior.
4. Refactor without changing the observable contract.
5. Run the focused suite, affected capability suite, architecture checks, and
   relevant PostgreSQL/API/executor-boundary tests.

Exact commands are added after the toolchain exists.

## Test Layers

| Layer | Planned approach | Covers |
| --- | --- | --- |
| Unit | JUnit Jupiter, no Spring | State transitions, outcome mapping, loops, retry decisions, validation, authorization policy inputs |
| Application | Focused Spring or plain service tests | Use-case orchestration, transactions, idempotency, related-record updates |
| Capability integration | Spring Modulith/application slice | Capability wiring and supported cross-capability calls |
| PostgreSQL | Testcontainers PostgreSQL | Migrations, constraints, JSONB, indexes, optimistic/concurrent writes, leases |
| API contract | MockMvc/WebTestClient and generated OpenAPI | Auth, DTO mapping, errors, versions, idempotency, Desktop/managed-execution/public separation |
| Executor boundary | Separate remote-provider and authenticated local-Runtime fakes | Capability validation, start/claim, observation/heartbeat, progress, result, cancellation, timeout, reconciliation |
| Full application | Small Spring Boot suite | Startup, security chain, main cross-capability assembly |

Mocks replace only true external boundaries or another capability's narrow
contract. Do not mock the state transition or use case under test.

## Business Model Coverage

### Workspace and access

- Personal Workspace provisioning is idempotent.
- Organization membership and Project membership are distinct.
- Cross-Workspace reads and writes fail even with a valid identifier.
- Removing or disabling membership affects subsequent authorization without
  rewriting unrelated business history.
- An Agent cannot satisfy human membership or approval requirements.

### Work Items and custom fields

- Work Item values conform to the pinned Work Item Type Version.
- Publishing a new type version does not mutate existing Work Items.
- Required, enum, and typed values return path-specific diagnostics.
- Assignment changes responsibility but do not start an Agent Run.
- Comments cannot masquerade as workflow outcomes or approval decisions.

### Boards

- Columns and Swimlanes have their distinct configured semantics.
- Board queries project authoritative Work Item and execution state without a
  second Card state.
- Card moves resolve to allowed actions and reject stale versions, forbidden
  actors, invalid transitions, and approval bypass.
- Advisory WIP behavior is not tested or documented as a strict guarantee.
- Board list/query access is batched and avoids N+1 patterns.

### Workflow definitions

- Valid versioned definitions publish immutably.
- Unknown versions, missing nodes, unreachable nodes, ambiguous outcomes,
  unbounded loops, unsafe retry settings, unresolved required Agent Slots, and
  arbitrary scripts are rejected.
- Validation diagnostics identify exact definition paths.
- Published versions cannot be modified in place.

### Workflow runtime

Cover the Event Storming paths from the business model:

1. Create Work Item, assign, and start a workflow.
2. Execute Agent nodes normally to completion.
3. Complete Review technically but route `changes_requested` back to a new
   Coding Step Run.
4. Exhaust a bounded loop into manual intervention.
5. Grant and reject human approval.
6. Cancel while running and while waiting.
7. Explicitly restart/reopen without rewriting completed history.

Also prove:

- one active Workflow Run per Work Item;
- one active Step Run per Workflow Run in the MVP;
- exact Workflow Version pinning;
- repeat delivery cannot complete or advance a Step twice; and
- two concurrent decisions or results produce one legal winner and one stable
  conflict/idempotent replay.

### Agent execution

- Project Agent Slots resolve to an allowed exact Agent Version.
- Agent Run history is unaffected by later Agent versions.
- Technical retry creates a new Attempt in the same Agent Run.
- Business rework creates a new Step Run and Agent Run.
- Retry policies distinguish safe transient failures from external side effects.
- Uncertain side effects enter `OutcomeUnknown` and reconcile before retry.
- Cancellation request and confirmed stop remain distinguishable.
- Artifact metadata/digest is stored without embedding large or secret content.

## Persistence and Migration Cases

- Run migrations from an empty supported PostgreSQL version.
- Upgrade from each supported released baseline once releases exist.
- Verify foreign keys, tenant-scoped uniqueness, checks, version columns, JSONB
  validation assumptions, and job/lease indexes.
- Test real query plans for measured high-risk Board and job-claim queries when
  data volume warrants it.
- Verify rollback/forward-fix policy without claiming online safety from a fresh
  migration test alone.
- Validate concurrent job claims and contested workflow/approval updates using
  real database transactions.

## API Cases

- Desktop, managed-execution, and public API generate separate OpenAPI groups.
- Local Runtime and provider-callback endpoints are not exposed as public API.
- Persistence entities, provider SDK types, raw provider status/callback data,
  credentials, and remote handles never appear in Desktop or public schemas.
- Stable error codes cover authorization, validation, conflict, stale version,
  unsupported definition, and idempotency conflict.
- Public breaking changes fail compatibility checks once a baseline exists.
- Desktop API changes fail generated Desktop transport type checks until
  synchronized.
- Allowed actions aid presentation but never bypass a negative command check.

## Durable Job and Agent Execution Cases

Shared control-plane cases:

- An Agent Run pins exactly one execution mode and executor route; retry and
  reconciliation never switch it implicitly.
- A durable job and its authorizing Agent Run state commit atomically.
- Duplicate progress, artifact, result, cancellation, callback, and polling
  observations are idempotent.
- Retry limit, timeout, backoff, cancellation, and reconciliation transitions
  are deterministic under a controlled clock.
- Normalized capabilities reject unsupported Agent Versions before execution
  and detect relevant provider capability drift before remote start.
- Logs and errors do not expose Provider Connection secrets or raw provider
  payloads.

Remote-provider fake cases:

- Capability discovery, start, status/progress, cancellation, result, and
  reconciliation map into the normalized executor contract.
- Callback and polling paths produce the same idempotent application commands.
- Provider-specific statuses and errors cannot leak into Agent Run state or
  Desktop/public DTOs.
- Remote handles are scoped by `ProviderConnectionId`, provider kind, remote
  object kind, and remote ID; cross-connection collisions cannot cross runs.
- Core API restart, duplicate callbacks, delayed observations, provider timeout,
  partial output, cancellation races, and uncertain side effects remain
  observable and reconcilable without Agent Runtime availability.

Local-Runtime fake cases:

- Only one Agent Runtime worker holds a valid claim lease; expired claims recover
  safely and stale heartbeats or results are rejected.
- Grant issuance and validation reject every missing or mismatched root-contract
  binding, including User, Workspace, Project, Agent Run, Attempt, job claim,
  lease/fencing token, Agent Version, `LocalWorkspaceBindingId`, Runtime instance,
  policy digest, limits, and expiry.
- A raw local path is neither required grant material nor accepted as cloud
  Workspace identity; a revoked or re-registered local binding cannot authorize
  an existing grant.
- Core API restart and Agent Runtime loss do not leave unobservable active work.
- An Agent Runtime instance cannot access another Workspace's run or Core API
  tables.

## Realtime Cases

- Progress subscribers receive bounded, scoped updates.
- Reconnect reloads authoritative state and does not depend on every transient
  notification being retained.
- Late updates from an old Workspace, Project, run, or attempt cannot pollute a
  newly selected scope.
- Backpressure or a disconnected Desktop client does not block Agent execution.

## Architecture Verification

Once initialized:

- Spring Modulith verification rejects undeclared capability dependencies and
  cycles.
- Architecture checks reject HTTP/persistence/provider leakage across public
  capability contracts.
- The checks enforce the actual coarse package graph, not speculative layers or
  one module per business noun.
- A new boundary updates architecture/responsibility docs and verification
  fixtures in the same change.

## Test Data and Isolation

- Fixtures declare Workspace and Project explicitly.
- A reusable builder never defaults to a global tenant.
- Clocks, identifiers, randomness, retry, and leases are controlled.
- Tests cleanly isolate database state and can run in parallel where declared.
- Remote-provider and local-Runtime fakes are distinct; each models timeout,
  duplication, partial output, uncertain side effects, cancellation, and
  executor-specific failures rather than only success.

## Coverage and Defect Detection

Follow the repository policy in the
[root architecture](../../../docs/architecture.md#coverage-and-effectiveness-policy).
Prioritize meaningful branch coverage in state transitions, authorization,
workflow outcome mapping, idempotency, retry/reconciliation, and definition
validation. Mutation testing may be used selectively for these pure critical
policies; it is not a target for DTO mapping or generated code.

## Quality Gates

Once initialized, a Core API change is incomplete until:

- Focused and affected capability tests pass.
- Relevant business-model scenarios and critical branches pass.
- Spring Modulith verification passes.
- PostgreSQL/migration tests pass when persistence changes.
- API generation and compatibility/type checks pass when contracts change.
- Remote-provider and local-Runtime failure tests pass when their execution
  paths change.
- Kotlin compile, lint, and formatting checks pass.
