# Core API Responsibilities

- **Status:** Target
- **Owns:** Core API capability ownership, use-case placement, synchronous and
  asynchronous collaboration, and explicit non-responsibilities
- **Read after:** [`../../../docs/business-model.md`](../../../docs/business-model.md),
  [`architecture.md`](architecture.md)
- **Mandatory before:** Adding a backend use case, capability area, API adapter,
  durable job, provider integration, or ownership boundary

## Current Implemented Responsibility

**Current:** `core-api` owns its runnable application shell and engineering
guardrails: four declared capability boundaries, explicit Spring Security
routes, architecture tests, a standard `src/test` tree and single complete
`test` entry, executable Boot JAR verification, and the Core API quality task.
Spring Modulith fixtures remain runtime-visible in ordinary `src/test/java`,
while only FQCN-conflicting ArchUnit fixtures use an isolated internal
compilation subtree under `src/test/architecture-fixtures/java`; neither is a
second test-suite entry. The implemented `access` slice
owns first-party email/password/OTP registration and login, password reset,
opaque sessions and refresh recovery, `CurrentUserView`, Organization Workspace
list/create, creator Membership, and server-side Workspace authorization. The
implemented narrow `project` slice owns Workspace-scoped read-only Project list
queries with both Workspace and Project Membership checks. Spring JDBC/Flyway
owns the corresponding PostgreSQL persistence, uniqueness, transaction,
idempotency, locking, expiry, pagination, and concurrency semantics. Runtime
OpenAPI documents these Desktop endpoints outside Production. Project creation
and other Project mutations, Agent execution, workflow behavior, and the
remaining capability targets are not implemented.

The `access` infrastructure also owns the concrete production verification-mail
transport behind its provider-neutral port. The current adapter uses Spring's
standard SMTP sender, requires an explicit sender address and SMTP host, and
fails startup unless STARTTLS is required or implicit TLS is enabled. Deployment owns
provider selection and injects SMTP username/password through its runtime or CI
secret store; those credentials must not enter source, configuration examples,
logs, API payloads, or test fixtures. Unit and ordinary CI tests use the
explicit capture adapter. Local development uses the separate `local &
!production` adapter, which can send plaintext SMTP only to loopback Mailpit;
it is not a deployable provider configuration.

The responsibilities below are the approved **Target** allocation for future
changes. A future item becomes Current only when its production implementation
and focused tests land together.

## Service Responsibilities

`core-api` owns:

- Application use cases and enforcement of the business-model rules.
- Final Workspace, Project, resource, and approval authorization.
- PostgreSQL business persistence and schema migration.
- Workflow definition validation and workflow runtime progression.
- Agent configuration control-plane state and Project Agent resolution.
- Agent Run execution-mode routing, dispatch state, attempts, cancellation,
  reconciliation, and output references.
- Server-side remote-provider adapter orchestration and normalized lifecycle
  commands.
- Desktop API, local managed-execution, provider-callback, and public HTTP API
  representations and OpenAPI generation.
- Durable local jobs, audit facts, and realtime notification sources.

It does not own:

- Desktop presentation or client cache state.
- Edge routing, WAF, or distributed edge rate limiting.
- Long-running Agent execution inside its process.
- Managed-provider internals or direct storage of provider credentials.
- Arbitrary business logic embedded in the Gateway or Agent Runtime.

## Business Model Compliance

The root [`business model`](../../../docs/business-model.md) is authoritative for
product terms, relationships, state machines, Event Storming scenarios, and MVP
rules. This document does not redefine those concepts.

Backend naming uses `WorkItem`, `WorkflowRun`, `StepRun`, `AgentRun`,
`ApprovalRequest`, `Column`, and `Swimlane` consistently. Transport or table
constraints must not introduce a conflicting vocabulary such as treating a Card
as the canonical work record or Todo/Doing/Done as Swimlanes.

Event Storming facts are implemented according to need:

- direct application transactions for synchronous work;
- durable jobs for long-running execution;
- authenticated idempotent commands for callbacks;
- notifications for realtime UI updates;
- append-oriented facts for audit and future statistics.

No artifact is required solely because an event was named during analysis.

## Capability Ownership

| Area | Owns | Does not own |
| --- | --- | --- |
| Access | User identity integration, Workspace, membership, session/actor facts, membership authorization operations | Project participation, work, workflow, Agent execution |
| Project Work | Project and membership, Work Item and type, custom values, Board configuration/query, comments | Workflow progression, provider execution |
| Automation | Workflow and versions, Workflow Run, Step Run, transition evaluation, Approval Request, cancellation orchestration | Provider SDK invocation, Card persistence |
| Agent Execution | Provider Connection, Agent and versions, Project Agent Binding, Agent Run, Attempt, Artifact references, execution-mode routing, remote provider adapters, local dispatch/lease, and reconciliation | Human membership, approval authority, Work Item truth |

This table guides placement without requiring separate deployables or one class
shape per concept.

## Initial Application Use Cases

### Access and project setup

- List an authenticated User's accessible Workspaces.
- Create an Organization Workspace and its creator Membership atomically and
  idempotently.
- Preserve one Workspace/Membership model so a later Personal Workspace type can
  reuse the same ownership and authorization path without being provisioned now.
- For the first implementation slice, list only Projects for which the
  authenticated User has both an effective Workspace Membership and a matching
  Project Membership in the requested Workspace.
- Keep Project creation, Project Member management, and other Project mutations
  as later use cases; controlled test fixtures may create records without
  exposing production creation APIs.
- Resolve an actor's allowed Project actions when those later mutations are
  introduced.

### Work management

- Create, edit, complete, cancel, and explicitly reopen a Work Item.
- Publish a Work Item Type Version and explicitly migrate compatible Work Items.
- Assign a human or select/override an Agent Slot binding.
- Add and list comments.
- Configure and query a Board.
- Resolve a Card drag to an authorized business action.

### Workflow automation

- Publish and validate a Workflow Version.
- Bind a Workflow Version to a Project or Work Item type.
- Start, advance, cancel, fail, and complete a Workflow Run.
- Activate and complete a Step Run.
- Request, grant, reject, expire, or cancel human approval.
- Handle bounded rework loops and manual intervention.

### Agent execution

- Configure a Provider Connection using protected secret references.
- Create an Agent and publish an Agent Version.
- Bind an Agent Slot in a Project to an exact Agent Version.
- Create an Agent Run with its execution mode and executor route pinned.
- Start, observe, cancel, and reconcile `REMOTE_MANAGED` work through a
  server-side provider adapter.
- Dispatch, claim, heartbeat, report progress/artifacts/result, cancel, retry,
  and reconcile `LOCAL_DESKTOP` work through the Agent Runtime.

The use-case names describe behavior; they do not require one service or command
class per bullet.

## Placement Rules

Place a use case in the capability that owns the initiating business intent:

- Board viewing and configuration belong to Project Work.
- Starting or progressing a workflow belongs to Automation.
- Accepting authenticated, idempotent execution evidence belongs to the Core
  API agent capability; the application flow then advances Automation in the
  same local transaction when the business result is accepted.
- A human approval decision belongs to Automation even when presented on a
  Project page.
- Agent editing belongs to the Core API agent capability, not to a generic
  administration area.

If a use case needs multiple capability records, use a coordinating application
service and one explicit transaction. Do not duplicate state to avoid a direct
call, and do not use an asynchronous event when the caller needs an immediate
success/failure decision.

## Synchronous and Asynchronous Boundaries

Use synchronous collaboration for:

- reference and scope validation required before commit;
- authorization;
- workflow transition and outcome evaluation;
- Board-action resolution;
- exact Agent Version resolution when creating an Agent Run; and
- atomic local state changes.

Use durable asynchronous work for:

- provider/Agent execution;
- retries and reconciliation;
- large artifact processing;
- outbound webhooks or external integrations; and
- optional projection/statistics updates that do not decide the source command.

The durable job and the state authorizing it are committed together. Consumers
are idempotent and observable.

## Board Responsibilities

Project Work owns Board definitions and Board queries. A Board may define
Columns, Swimlane rules, filters, sorting, visible fields, and action mappings.
It does not persist Card business state.

Moving a Card resolves to a typed application action. Automation and Project
Work remain authoritative for workflow and Work Item transitions. Attempts to
move a Card past a pending Approval Request or into an impossible Column are
rejected with stable diagnostics.

## Workflow Responsibilities

Automation owns definition validation and runtime progression. It guarantees:

- exact version pinning;
- at most one active Workflow Run per Work Item;
- at most one active Step Run per Workflow Run for the MVP;
- declared, structured outcomes;
- new runtime records for loops and rework;
- idempotent progression and decision handling; and
- explicit cancellation and waiting semantics.

It does not parse free-form Agent text to infer a transition.

## Agent Control-Plane Responsibilities

The Core API agent capability owns control-plane state. It guarantees:

- exact Agent Version pinning;
- Provider Connection scope and protected secret references;
- immutable execution-mode and executor-route selection per Agent Run;
- durable dispatch, with exclusive claim leases for local Runtime work;
- bounded attempts, retry eligibility, timeout, and cancellation;
- idempotent normalized progress, artifacts, results, provider observations,
  and callbacks;
- provider capability validation without pretending unsupported features exist;
- namespaced remote handles that cannot replace TaskPilot run identities;
- distinction between terminal failure and uncertain external outcome; and
- no direct Agent Runtime or provider access to PostgreSQL business tables.

Agent output is not human approval. Normalized executor data may provide
artifacts or evidence for a later Approval Request. Provider SDK objects, raw
status names, callback payloads, and credentials stay behind the remote adapter;
local Runtime evidence stays behind the managed-execution adapter.

## Query Responsibilities

- Every query has explicit Workspace scope and, where applicable, Project scope.
- Screen-oriented queries may join or batch across capability-owned data through
  an owned read service.
- Queries do not mutate state or enforce transitions.
- Query models are purpose-built and need not match write records or HTTP DTOs.
- Persistent denormalized projections require documented freshness, replay,
  rebuild, and monitoring.

## API Responsibilities

- Desktop controllers optimize first-party workflows.
- Public controllers maintain their own compatibility policy.
- Both call the same application use cases without sharing transport DTOs by
  accident.
- The server returns allowed actions for presentation but always reauthorizes
  commands.
- Validation and conflict errors are stable and path-addressable where relevant.
- Provider callback ingress authenticates and normalizes remote observations
  before invoking idempotent application commands; raw provider payloads do not
  become Desktop or public contracts.
- Local managed-execution endpoints accept authenticated, idempotent evidence
  from Agent Runtime and are separated from Desktop and public APIs.
- `core-api`, not a provider or Runtime, owns `AgentRun`, `ApprovalRequest`,
  durable jobs, authorization, and business-database truth.

## Security Responsibilities

- Never trust Workspace or actor identity solely from client input.
- Require Workspace scoping for business reads and writes.
- Enforce Project membership and action-level authorization server-side.
- Keep Agent capability separate from User permission.
- Validate Approval Request eligibility and optimistic version at decision time.
- Keep secrets out of records, DTOs, logs, jobs, events, and artifacts.
- Audit security-sensitive configuration, approval, cancellation, and external
  side-effect actions.
