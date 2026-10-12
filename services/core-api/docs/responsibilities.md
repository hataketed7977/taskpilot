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
guardrails plus one implemented `access` slice. That slice owns stable User
identity, provider-neutral External Identity uniqueness, legal acceptance,
GitHub OAuth attempts and registration continuations, login rate limiting,
opaque session issue/rotation/replay revocation/logout, `CurrentUserView`, and
the corresponding Desktop HTTP adapters. Access also owns the configured legal
locale allowlist, exact `(locale, legalBundleVersion, termsVersion,
privacyVersion)` validation, atomic acceptance persistence, and server-generated
`acceptedAt`; it does not own Desktop language preference or general server-side
i18n. The GitHub adapter performs only
authorization/token/authenticated-user exchange outside database transactions
and returns a normalized durable identity; it does not persist Provider tokens.

Spring JDBC/Flyway owns PostgreSQL persistence for exactly User, External
Identity, and Terms Acceptance. Redis owns only expiring OAuth workflow,
rate-limit, and session technical state. Runtime OpenAPI documents only the
implemented authentication/session/current-user endpoints outside Production.
The deleted email/password/OTP/reset stack, SMTP/Mailpit, Workspace/Project
behavior, Agent execution, and workflow behavior are not current
responsibilities. Four capability boundaries remain declared for the Target
architecture, but `project`, `automation`, and `agent` currently contain no
runnable business capability.

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
| Access | User and External Identity, federated login attempts and registration continuations, opaque session/actor facts, and Target Workspace membership authorization operations | Provider repository integration, Project participation, work, workflow, Agent execution |
| Project Work | Project and membership, Work Item and type, custom values, Board configuration/query, comments | Workflow progression, provider execution |
| Automation | Workflow and versions, Workflow Run, Step Run, transition evaluation, Approval Request, cancellation orchestration | Provider SDK invocation, Card persistence |
| Agent Execution | Provider Connection, Agent and versions, Project Agent Binding, Agent Run, Attempt, Artifact references, execution-mode routing, remote provider adapters, local dispatch/lease, and reconciliation | Human membership, approval authority, Work Item truth |

This table guides placement without requiring separate deployables or one class
shape per concept.

## Target Application Use Cases

### Access and project setup

- Resolve a provider-normalized external identity to an internal User without
  using email or profile similarity as a merge key.
- Own short-lived federated attempt, registration continuation, rate-limit,
  and opaque session state in Redis; keep external Provider calls outside local
  database transactions, and persist User, External Identity, and legal
  acceptance facts atomically in PostgreSQL. Successful authentication issues an
  active session directly; refresh rotation, replay revocation, logout, TTL, and
  fail-closed Redis behavior stay inside the access slice.
- Keep Provider credentials and protocol payloads inside infrastructure
  adapters; application code receives only normalized identity and stable error
  categories.
- List an authenticated User's accessible Workspaces.
- Create an Organization Workspace and its creator Membership atomically and
  idempotently.
- Preserve one Workspace/Membership model so a later Personal Workspace type can
  reuse the same ownership and authorization path without being provisioned now.
- In the Target Workspace/Project slice, list only Projects for which the
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
