# Core API Architecture

- **Status:** Target
- **Owns:** Core API runtime structure, application transactions, persistence,
  HTTP adapters, durable jobs, Runner protocol, and provider integration
- **Read after:** [`../AGENTS.md`](../AGENTS.md),
  [`../../../docs/business-model.md`](../../../docs/business-model.md),
  [`../../../docs/architecture.md`](../../../docs/architecture.md)
- **Mandatory before:** Initializing or changing Core API structure,
  persistence, APIs, workflow runtime, asynchronous execution, or providers

## Runtime Role

`core-api` is one Kotlin/Spring Boot application. It owns application use cases,
business rule enforcement, authorization, PostgreSQL persistence, first-party
Web API controllers, public HTTP API controllers, workflow orchestration, and
the control-plane state for Agent execution.

Long-running Agent work executes in the separately operated Runner described by
the root architecture. The Runner never writes Core API tables directly and is
not a second source of business truth.

## Architecture Posture

The Core API is a pragmatic modular monolith. Spring Modulith is used to make a
small number of useful capability boundaries visible and testable; it does not
require tactical DDD.

- Organize code around cohesive business capabilities and use cases.
- Use direct application-service calls for ordinary synchronous collaboration.
- Let one clear transaction update the related records needed by a use case.
- Keep lifecycle transitions explicit in state-transition functions or focused
  policy objects.
- Introduce interfaces at real replacement, permission, or ownership
  boundaries, not around every class.
- Introduce a repository abstraction only when it clarifies business access or
  isolates a meaningful persistence strategy; do not require one per object.
- Do not create a command class, event class, listener, module, service, or
  package merely because a term appears in Event Storming.

The [`business model`](../../../docs/business-model.md) owns product vocabulary,
relationships, lifecycles, and rules. This document owns their backend
implementation shape.

## Technology Direction

- Kotlin
- Spring Boot and Spring MVC
- Spring Security
- Spring Modulith for coarse module verification and reliable in-process
  publication where used
- PostgreSQL and Flyway
- Springdoc OpenAPI
- Database-backed durable jobs and leases for initial Agent dispatch

Compatible stable versions are selected when initialization begins.

## Initial Capability Areas

Use the four coarse areas from the business model as the starting point:

| Area | Backend responsibility |
| --- | --- |
| `access` | User identity, login/session integration, Workspace and membership authorization |
| `project` | Project membership, Work Items and types, Boards, comments, and custom values |
| `automation` | Workflow definitions and versions, Workflow Runs, Step Runs, approval, transition evaluation, and orchestration |
| `agent` | Provider Connections, Agents and versions, Project Agent Bindings, Agent Runs, attempts, artifacts, durable dispatch, and Runner/provider protocols |

These names are initial code areas, not permanent service boundaries. A new
module or split requires evidence of an independent ownership, permission,
scale, reliability, or change boundary. A screen does not create a module.

Cross-area use cases may be coordinated by an application service in the area
that owns the user intent. The coordinator calls focused operations and commits
all required local database changes in one transaction. Cyclic package
dependencies remain forbidden, but avoiding a cycle must not produce an event
chain for work that requires an immediate answer; move shared orchestration or
adjust the coarse boundary instead.

When initialized, document the actual package graph and enforce it with Spring
Modulith verification. Do not invent a detailed graph before executable use
cases prove it.

## Internal Structure

A capability may use the following internal responsibilities without requiring
every directory or layer to exist:

```text
<capability>/
├── api/              # controllers and transport mapping when owned here
├── application/      # use cases, authorization, transactions, orchestration
├── model/            # state, transition functions, validation, focused policy
└── infrastructure/   # persistence and external adapters
```

Small cohesive code stays together. Business model code does not depend on HTTP
DTOs, persistence entities, Spring Security contexts, or provider SDK types.
Transport and persistence types may be shared internally when doing so remains
clear and does not leak them across capability or HTTP boundaries.

## Application and Transaction Flow

A normal write use case follows this shape:

1. Authenticate the actor and establish trusted Workspace scope.
2. Validate request shape and idempotency/concurrency metadata.
3. Load only the state required for authorization and business decisions.
4. Invoke explicit transition or policy functions.
5. Persist all related local changes in one bounded transaction.
6. Insert any durable job, audit fact, or reliable notification required by the
   committed result in the same transaction.
7. Return an immutable application result for transport mapping.

A transaction may update Work Item, Workflow Run, Step Run, Agent Run, approval,
or job records together when one use case requires a consistent result. Do not
split a single local business decision into eventual event handlers solely to
preserve theoretical object boundaries.

Never keep a database transaction open while calling a managed-Agent provider,
waiting for a Runner, streaming output, uploading a large artifact, or waiting
for human approval.

## Workflow Runtime

The Workflow runtime implements the business-model state machines and pins exact
definition versions.

- A Workflow Version is validated and normalized before publication.
- Starting a run creates the Workflow Run and first Step Run atomically.
- Advancing a workflow completes the current Step Run, selects one declared
  transition, and creates the next Step Run or terminal result atomically.
- An Agent node creates its Agent Run and durable dispatch job atomically.
- A human-approval node creates its Step Run and Approval Request atomically.
- Returning to an earlier node creates new runtime records and preserves
  history.
- Duplicate result, decision, cancellation, and advance commands are
  idempotent.
- Optimistic versions prevent two callbacks or decisions from advancing the
  same active step twice.

The DSL is declarative, schema-versioned, path-diagnosable, and free of arbitrary
executable code. YAML may be accepted for import/export; normalized JSON is the
canonical persisted form.

## Board Interaction

Board queries compose Work Items with active workflow and execution summaries.
A persistent Card table is not introduced initially.

`MoveCard` is an application use case, not a direct placement update:

1. Load the Board definition and current Work Item execution summary.
2. Resolve the target Column to an allowed action.
3. authorize the actor and validate expected versions.
4. Execute the corresponding workflow or Work Item operation.
5. Return authoritative state for client reconciliation.

Advisory WIP checks may be performed. Hard concurrent WIP rejection requires a
separate reservation or locking design before it is claimed as guaranteed.

## Persistence

PostgreSQL is the system of record. Persistence design follows access patterns
and lifecycle rules rather than mirroring every conceptual relationship as a
class hierarchy.

- Every Workspace-owned row carries `workspace_id` directly when doing so makes
  isolation, indexing, and operations safer, even if ownership is derivable.
- Queries and mutations include Workspace scope; globally unique identifiers do
  not replace tenant predicates.
- Foreign keys, uniqueness, check constraints, and indexes enforce rules that
  the database can reliably own.
- Flexible definitions and custom values may use validated JSONB with promoted
  columns or indexes for proven query needs.
- Published definition/version records and completed decisions are immutable.
- Optimistic version columns protect contested mutable records.
- Large logs and artifacts live in approved object storage; PostgreSQL stores
  references, metadata, digests, and bounded summaries.
- Physical ER diagrams and migration rules are added here only after a schema
  exists.

## Query and Read Models

Queries do not need to reconstruct write-oriented model objects. Each screen or
API query has an explicit Workspace scope and may use purpose-built SQL or read
models owned by Core API.

Cross-capability screens are composed in a query service with batched access.
No capability reads another capability's private tables through accidental ORM
relationships. Persistent denormalized projections require an owner, freshness
contract, idempotent updater, rebuild path, and monitoring; do not add them
before measured need.

## HTTP API Adapters

Web API and public HTTP API controllers are separate adapter surfaces over the
same application use cases:

- Controllers parse transport input, call application services, and map typed
  results to surface-specific DTOs.
- Persistence entities, provider SDK types, and mutable internal state never
  appear in HTTP schemas.
- Business errors map to stable Problem Details-compatible codes.
- Mutable operations accept expected versions where stale decisions matter.
- Retryable create, start, result, approval, and callback operations define an
  idempotency key.
- Definition validation returns JSON/YAML paths so editors can highlight exact
  errors.
- The server remains authoritative for permissions and allowed actions.

The Web and public OpenAPI documents are generated and verified independently.

## Durable Jobs and Notifications

Use durable jobs or reliable publication only for a concrete boundary:

| Need | Mechanism |
| --- | --- |
| Start or retry long-running Agent execution | Database-backed durable job and lease |
| Provider callback/result | Authenticated idempotent internal command |
| External side effect with uncertain outcome | Idempotency key plus reconciliation job |
| Realtime Web progress | SSE notification backed by authoritative reload |
| Audit and future statistics | Append-oriented audit/business-fact record |
| Future cross-process integration | Versioned integration event introduced with that boundary |

Ordinary local updates use direct calls. In-process notifications never hide
validation needed before commit. Event payloads do not contain credentials,
persistence entities, security contexts, or unbounded output.

## Runner Protocol

The Core API owns Agent Run state, attempts, dispatch intent, cancellation
intent, retry limits, leases, and result/artifact references. The Runner:

- claims a durable job with an expiring lease;
- resolves protected credentials through an approved runtime path;
- invokes the selected provider and tools;
- reports heartbeat, bounded progress, artifacts, result, and reconciliation
  data through authenticated idempotent endpoints;
- observes cancellation and timeout policies; and
- never decides authoritative workflow transitions or writes business tables.

Claiming, heartbeat, expiry, cancellation, retry, duplicate result, and
`OutcomeUnknown` reconciliation semantics must be specified and tested before
real provider execution is enabled.

## Security and Tenancy

- The Gateway may normalize trusted context; Core API independently authenticates
  the principal and authorizes every resource action.
- Workspace and Project membership are checked by application use cases, not by
  UI role names.
- Provider Connections contain secret references, never credential material in
  public records.
- Agent tools use least privilege and explicit allowlists.
- Approval eligibility is evaluated server-side against the policy snapshot and
  current actor facts defined by the business rule.
- Logs, errors, events, and artifacts do not leak secrets or cross-Workspace
  identifiers.

## Future Evolution

Extract a service, add a broker, create a persistent projection, or split a
capability only when measured scale, reliability, security, deployment, or
ownership needs justify the operational cost. At that point, define versioned
contracts, delivery guarantees, reconciliation, observability, and migration.

## Non-Goals

- No event sourcing or mandatory CQRS.
- No command/event class for every use case.
- No repository, interface, DTO, or service per business object by default.
- No microservice per capability area.
- No arbitrary workflow scripts.
- No external broker before a proven need.
- No direct Runner database access.
- No long-running provider call inside an HTTP/database transaction.
- No business authorization or orchestration in the Gateway.
