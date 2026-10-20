# Core API Architecture

- **Status:** Target
- **Owns:** Core API runtime structure, application transactions, persistence,
  HTTP adapters, durable jobs, managed-execution protocol, and provider
  integration
- **Read after:** [`../AGENTS.md`](../AGENTS.md),
  [`../../../docs/business-model.md`](../../../docs/business-model.md),
  [`../../../docs/architecture.md`](../../../docs/architecture.md)
- **Mandatory before:** Initializing or changing Core API structure,
  persistence, APIs, workflow runtime, asynchronous execution, or providers

## Current Foundation

**Current:** The repository now contains a runnable `:services:core-api` Gradle
subproject. The root Gradle Wrapper includes only this subproject and pins JDK
21, Kotlin 2.3.21, Spring Boot 4.1.1, Spring Modulith 2.1.1, ArchUnit 1.5.1,
JUnit 6.0.3, Testcontainers 2.0.5, Detekt 1.23.8, ktlint 1.8.0, and Kover
0.9.10. Detekt runs with its compatible isolated Kotlin 2.0.21 tool classpath;
that does not change the application Kotlin version. Handwritten production
source is Kotlin-only under `src/main/kotlin`; Spring Modulith module metadata is
carried by annotation-only Kotlin marker classes, so `src/main` contains no Java
source. All test code, resources, and fixtures are physically owned by
`src/test`, and the standard `test` task is the single complete test-suite entry.

The two architecture-fixture categories retain only the isolation their loading
mechanisms require. Spring Modulith fixtures are ordinary `src/test/java` output
on the test runtime and use an explicit import option so test packages are
scanned. FQCN-conflicting ArchUnit fixtures are compiled from
`src/test/architecture-fixtures/java` by an internal dependency-isolated source
set and imported by explicit class-output paths; that source set is not an
additional test task and its output does not leak onto the normal test runtime.
Detekt scans the two standard Kotlin roots, Kover measures main production
classes from standard `test` execution with unchanged 80% line and 75% branch
thresholds, and `qualityCheck` combines the complete suite with compile, format,
static-analysis, build-contract, and coverage gates. This layout change does not
alter capability boundaries, API or persistence contracts, authorization,
tenancy, lifecycle, concurrency, or recovery behavior.

The implemented application is deliberately limited to:

- one Spring Boot application rooted at `ai.taskpilot.coreapi`;
- six declared Spring Modulith capability boundaries (`access`, `workspace`,
  `project`, `onboarding`, `automation`, and `agent`); `onboarding` is the narrow
  first-registration coordinator, depends only on the public Access, Workspace, and Project
  provisioning contracts, and owns no table or HTTP endpoint;
- a final-development Flyway baseline containing the durable Access identity,
  Workspace/Workspace Membership, and Project/Project Membership tables in
  their owning `access`, `workspace`, and `project` schemas;
- Redis-backed, TTL-bounded OAuth attempts and registration continuations,
  login rate limits, and opaque access/refresh sessions; Redis failure causes
  authentication to fail closed and never becomes business truth;
- a narrow GitHub adapter behind the `FederatedIdentityProvider` application
  port, returning only the durable numeric subject and constrained profile
  suggestions; provider tokens and raw payloads do not cross the adapter;
- purpose-separated HMAC digests, PKCE S256, and AEAD-protected temporary values
  using independent runtime keys; incomplete or reused key configuration
  disables the federated capability;
- no mail sender, SMTP, Mailpit, email, password, OTP, or reset fallback;
  first registration provisions the Access identity facts, one PERSONAL
  Workspace with OWNER membership, and one ordinary default Project with OWNER
  membership plus a localized ordinary Board and initial Column;
- authenticated Workspace discovery plus Project and Project Work operations:
  Project create/edit/archive/restore/delete, multiple Boards, Columns, basic
  OPEN Work Items, Board Placements, and Card moves, all backed by server-side
  OWNER authorization, request-id idempotency, and optimistic version checks;
- a fail-closed Spring Security chain that permits only explicit anonymous auth
  endpoints and Actuator probes, authenticates Desktop account, Workspace, and
  Project routes with opaque access credentials, and rejects every other route; and
- executable module-graph, technical-dependency, startup, health,
  PostgreSQL/Flyway, Redis, static-analysis, executable Boot JAR, and coverage
  gates.

The ArchUnit rules use independently reported `rule-id/case-id` fixtures for
model dependencies on MVC, Security, Jakarta Persistence, Spring Data, Spring
JDBC, jOOQ, transport, and provider types; implementation-type leakage; every
directed Desktop/public/managed-execution surface pair; controller access to
another capability's internal or repository packages; reverse project
dependencies; and shared/common escape packages. The three future HTTP adapter
surface package segments are fixed as `desktopapi`, `publicapi`, and
`managedapi`; a future Change that renames or adds a surface must update the
owning architecture contract and fixtures together.

The Current first-use HTTP surface exposes Desktop authentication, session,
current-user, PERSONAL Workspace discovery, and complete current Project
controllers. Runtime OpenAPI and non-persistent Swagger authorization remain
enabled outside Production; exact-path contract tests cover these implemented
routes, their access-bearer boundary, transport schemas, successful responses,
shared Problem Details, and secret hygiene. Legacy
email/password/OTP/reset, TEAM, provider, durable-job, workflow, Agent-execution,
and managed-execution behavior remain unimplemented. The current persistence choice is explicit Spring JDBC plus
Flyway for durable business facts and Redis for expiring authentication state.
The Core API application composition root owns shared PostgreSQL DataSource
auto-configuration; each business capability owns only its schema, JDBC
implementation, and participation in explicitly coordinated transactions.
Everything below that describes later capabilities remains **Target** unless
explicitly marked Current.

## Federated Access Implementation Status

**Current:** `access` owns the provider-neutral identity key
`(provider, authority, subject)`, the GitHub adapter, cryptographic primitives,
PostgreSQL identity/acceptance persistence, and Redis stores for attempts,
registration continuations, rate limits, and sessions. Attempt state, OAuth
state, completion proof, and registration continuation are single-use and
TTL-bounded. The schema does not impose `(user_id, provider, authority)`
uniqueness and never merges accounts by email or profile similarity.

**Current HTTP slice:** Core API exposes capability discovery, attempt creation,
the fixed GitHub callback, poll/cancel, first registration, refresh, logout, and
`GET /desktop/v1/me`. Attempts accept only the exact restricted `127.0.0.1`
completion URI shape. The callback claims one-time state, performs Provider HTTP
outside database transactions, and retains only normalized encrypted identity
state. Its no-store completion page uses a nonce CSP, removes OAuth query data,
posts proof to the bound loopback receiver, and attempts best-effort close only
after loopback success. Stable Problem Details hide Provider payloads and OAuth,
poll, completion, continuation, and TaskPilot credential material.

First registration validates the exact `(locale, legalBundleVersion,
termsVersion, privacyVersion)` quartet against a canonical, duplicate-free
configured legal-locale allowlist and one configured version triple. Unknown,
non-canonical, duplicate, or mismatched configuration fails closed. A valid registration runs through the `onboarding` coordinator and atomically
stores User, External Identity, the complete Terms Acceptance quartet, one
PERSONAL Workspace, its OWNER membership, one localized ordinary default
Project, and its OWNER membership in PostgreSQL. Access, Workspace, and Project
perform only their owned writes inside the ambient onboarding transaction; rejection or any
provisioning failure leaves none of the seven facts durable. This is
legal-document validation rather than a general server-side localization
facility. The registration preview exposes the required version triple and
legal-locale allowlist. Only after PostgreSQL commits does Access issue an
active opaque Redis session. A successful first registration also returns the
non-secret `workspaceId`/`projectId` bootstrap, including from encrypted attempt
completion replay; existing-identity login does not return that bootstrap. Refresh rotates both credentials; replay
of an old refresh token revokes the session family, logout revokes immediately,
and corrupt or unavailable Redis state fails closed. Existing-identity login
updates only `lastAuthenticatedAt`, never the TaskPilot-owned display name or
avatar. Incomplete GitHub/HMAC/AEAD/legal configuration keeps the service healthy
but disables the capability.

**Current Desktop collaboration:** Desktop Main alone launches the system
browser, hosts the loopback receiver, combines poll and completion proof, holds
registration and TaskPilot credential secrets, and persists refresh material
through the OS credential store before publishing authentication. Renderer
receives only safe presentation models. Main consumes the fixed PERSONAL
Workspace and Project routes through narrow Preload capabilities and validates
registration bootstrap plus recent/fallback Project selection before presenting
Project home. Automated tests use browser, loopback, Provider, Redis, PostgreSQL,
and credential doubles/containers; the integrated journey crosses compiled
Main, IPC, Preload, Core API, PostgreSQL, and Redis. Real GitHub OAuth remains
manual evidence; packaged/native evidence is platform-specific. Deep links,
embedded WebViews, GitHub repository integration, Gateway authentication, and
production rollout remain outside this slice.

## Runtime Role

`core-api` is one Kotlin/Spring Boot application. For the MVP it is also the
only application-layer Resource Server: Desktop Main reaches it through the
deployment edge/TLS boundary, and Core API validates its own opaque Desktop
access token before constructing an authenticated principal. It owns application use cases,
business rule enforcement, authorization, PostgreSQL persistence, first-party
Desktop API controllers, public HTTP API controllers, workflow orchestration,
and the control-plane state for Agent execution.

Long-running Agent work follows the immutable execution mode pinned by the
selected Agent Version and copied onto the Agent Run. `REMOTE_MANAGED` work is
started and reconciled through a server-side provider adapter; the provider owns
the remote computation, while `core-api` owns its control-plane integration.
`LOCAL_DESKTOP` work is dispatched through the separately operated Agent Runtime
and its authenticated managed-execution surface. The Runtime never writes Core
API tables directly and is not a second source of business truth.

`core-api` remains authoritative for `AgentRun`, `ApprovalRequest`, executor
selection, durable dispatch, domain authorization, and all business-state
transitions. Both execution paths submit normalized, idempotent lifecycle data;
only local execution depends on Desktop or Agent Runtime availability.

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
- Database-backed durable jobs for Agent dispatch and reconciliation; claim
  leases and execution grants for local Runtime execution

The Current foundation's pinned versions are listed in
[Current Foundation](#current-foundation). Future upgrades must preserve the
Spring Boot/Spring Modulith compatibility contract and pass the complete quality
gate.

## Initial Capability Areas

Use the five coarse business areas plus one narrow onboarding coordinator:

| Area | Backend responsibility |
| --- | --- |
| `access` | User identity, external identity, legal acceptance, and login/session integration |
| `workspace` | Workspace, Workspace Membership, PERSONAL provisioning, and narrow membership authorization facts |
| `project` | Project, Project Membership, authorized Project list, Work Items and types, Boards, comments, and custom values |
| `onboarding` | First-registration coordination only; owns no business tables or HTTP surface and calls narrow Access/Workspace/Project contracts in one PostgreSQL transaction |
| `automation` | Workflow definitions and versions, Workflow Runs, Step Runs, approval, transition evaluation, and orchestration |
| `agent` | Provider Connections, Agents and versions, Project Agent Bindings, Agent Runs, attempts, artifacts, execution-mode routing, durable dispatch, server-side provider adapters, and local managed-execution protocol |

These names are initial code areas, not permanent service boundaries. A new
module or split requires evidence of an independent ownership, permission,
scale, reliability, or change boundary. A screen does not create a module.

Cross-area use cases may be coordinated by an application service in the area
that owns the user intent. First registration is the explicit exception: Access
owns authentication continuation/session behavior and exposes a provisioning
port; `onboarding` implements that port and coordinates Access, Workspace, and Project
writes without any capability reading another owner's private tables. The coordinator calls focused operations and commits
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
waiting for an Agent Runtime worker, streaming output, uploading a large
artifact, or waiting
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

**Current:** Project Work remains inside the `project` capability and PostgreSQL
schema. A Project owns ordinary Boards and basic OPEN Work Items; a Board owns at
least one ordered Column and Board-local Placements. Cards reuse `WorkItemId` and
join canonical Work Item content at read time rather than persisting a Card
copy. The same Work Item may have independent Placements in multiple Boards.

Board, Column, Work Item, and Placement mutations execute in local PostgreSQL
transactions after Workspace/Project OWNER and composite scope checks. Creation
uses actor-plus-Project request IDs and payload fingerprints. Board layout writes
lock the Board and use Board/resource versions; integer positions are normalized
under deferrable unique constraints. A Card move updates only the selected
Placement and returns the authoritative Board snapshot. It does not change Work
Item lifecycle or invoke Workflow/Agent behavior.

**Target:** Workflow-derived Board views, action mappings, Swimlanes, WIP policy,
custom fields, and independent Board/Work Item deletion are not Current.

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
- The runnable modular monolith uses one TaskPilot PostgreSQL database and one
  Flyway history. Business tables are explicitly qualified into coarse-grained
  capability schemas: the current baseline owns `access`, `workspace`, and `project`;
  capabilities such as `automation` and `agent` create schemas only when they first
  persist tables. `public` is reserved for Flyway metadata.
- SQL never relies on `search_path`; every business table reference is
  schema-qualified, including cross-schema foreign keys and joins.
- Independent durable entities use a single `id UUID` primary key. Foreign keys
  keep semantic names such as `user_id` and `workspace_id`; relationship rows
  such as memberships retain an `id` and separately enforce their business
  uniqueness. Keyed operational state may retain an explicit natural or
  composite primary key when that key is the state identity.
- Physical ER diagrams are added only when they improve an implemented schema;
  Flyway migration and naming conventions are guarded by PostgreSQL integration
  tests rather than duplicated diagrams.

## Current Workspace-Scoped Project Operations

The Current Desktop API exposes the authenticated User's PERSONAL Workspace,
authorized Project operations, and explicit Project Work operations for Board
list/create/read/edit, Column create/edit/reorder/delete, basic Work Item
create/read/edit, and Placement move. Project pages are
ordered by `(createdAt, projectId)` and use an opaque Base64URL cursor whose
encoding is an internal server contract; clients must not parse it. The cursor
is bound to one Workspace and Project status. `limit` defaults to 50 and is
restricted to 1–100. A `ProjectView` contains `projectId`, `workspaceId`,
`name`, `description`, `status`, `version`, `createdAt`, `updatedAt`, and
`archivedAt`; pages also return `nextCursor` only when another page exists.

Access owns User/session. Workspace owns Workspace, Workspace Membership, its
transport, and Workspace authorization. Project owns Project, Project Membership,
transport, and Project authorization, and consumes only the narrow Workspace
membership contract rather than Workspace private tables. Workspace trusts the
Access-established actor and does not query Access private tables.
Listing and reading require aligned Workspace OWNER and Project OWNER facts.
Creation requires Workspace OWNER, atomically grants Project OWNER, permits
duplicate names, and is idempotent for `(User, Workspace, requestId)` when the
normalized payload is unchanged. Editing requires Project OWNER and a matching
`expectedVersion`. Names and descriptions are trimmed and constrained by Unicode
code-point length.

Invalid input maps to path-aware `400 VALIDATION_FAILED`; invalid session to
`401 AUTHENTICATION_REQUIRED`; missing or inaccessible Workspace/Project to the
same non-enumerating `404 PROJECT_NOT_FOUND`; stale version or changed-payload
request replay to stable `409` conflicts; and safe
persistence outages to `503 TEMPORARILY_UNAVAILABLE`. Registration remains one
ambient PostgreSQL transaction coordinated by `onboarding`; Access issues the
Redis session only after commit. Project OWNER may archive/restore with optimistic
versions; retries that already reached the target state return the unchanged
view. Permanent deletion locks and revalidates the scoped Project, version, and
exact current name, explicitly deletes Placement → Column → Board → Work Item →
Membership → Project, preserves the PERSONAL Workspace, and maps unknown
protected dependencies to `PROJECT_DELETE_RESTRICTED`. All current and future Project FKs default to
`RESTRICT`; no generic cascade is approved. Runtime OpenAPI publication and Desktop Main/Preload consumption for these
Workspace/Project operations are Current. TEAM behavior remains Target.

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

Desktop API, managed-execution, and public HTTP API controllers are separate
adapter surfaces over the
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

The initial Desktop surface exposes runtime-generated OpenAPI JSON and Swagger
UI for federated authentication, session refresh/logout, current user, PERSONAL
Workspace discovery, and the complete current Project lifecycle, and verifies
them with runtime contract tests. The contract fixture freezes anonymous versus
refresh-body versus opaque-bearer security, exact loopback completion-URI
constraints, registration/session and Workspace/Project request/response shapes,
operation-specific success and failure statuses, shared Problem Details, the
email-free `CurrentUserView`, PERSONAL-only Workspace transport, and the absence
of reusable OAuth/attempt/session secret examples and unimplemented paths.
Production disables both OpenAPI JSON and Swagger UI. Main adapter fixtures cover
the consumed shape; this phase does not require a committed standalone schema,
generated Desktop client, or breaking-change compatibility gate. Managed-
execution and public API contract lifecycles remain separate and are established
by the Changes that initialize those surfaces.

## Durable Jobs and Notifications

Use durable jobs or reliable publication only for a concrete boundary:

| Need | Mechanism |
| --- | --- |
| Start or retry long-running Agent execution | Database-backed durable job; local claims additionally use a fenced lease |
| Provider callback or polling observation | Authenticated, idempotent normalized application command |
| External side effect with uncertain outcome | Idempotency key plus reconciliation job |
| Realtime client progress | Transport notification backed by authoritative reload |
| Audit and future statistics | Append-oriented audit/business-fact record |
| Future cross-process integration | Versioned integration event introduced with that boundary |

Ordinary local updates use direct calls. In-process notifications never hide
validation needed before commit. Event payloads do not contain credentials,
persistence entities, security contexts, or unbounded output.

## Agent Execution Boundary

The Core API selects one executor route from the execution mode pinned to the
Agent Run. Selection is explicit and durable; a retry or reconciliation cannot
silently switch the run between remote and local execution.

### Remote managed execution

`REMOTE_MANAGED` runs use a server-side provider-neutral port. The port's
conceptual responsibilities are capability discovery and validation, start,
status/progress observation, cancellation, result retrieval, and reconciliation.
This document intentionally does not freeze a Kotlin interface or provider
framework before the first adapter proves the shape.

Provider callbacks and polling observations enter the same idempotent application
commands. An adapter maps provider-specific status, progress, results, errors,
and cancellation semantics into TaskPilot's normalized model; unsupported
capabilities remain explicit instead of being simulated. Every remote handle is
namespaced by `ProviderConnectionId`, provider kind, remote object kind, and
remote ID. It never replaces `AgentRunId` or `AttemptId`.

Provider SDK types, credentials, raw callback payloads, raw status vocabularies,
and remote identifiers remain inside server-side infrastructure. Provider
credentials are resolved from protected secret references and never sent to
Desktop or Agent Runtime. The first Volcengine Managed Agent integration follows
this boundary without making its SDK the application contract.

### Local Desktop execution

`LOCAL_DESKTOP` runs use durable dispatch plus the separate Agent Runtime
managed-execution surface. Core API owns Agent Run state, attempts, dispatch and
cancellation intent, retry limits, leases, result/artifact references, and
execution-grant issuance and server-side validation. The grant conforms to the
root
[identity and execution authorization contract](../../../docs/architecture.md#identity-and-execution-authorization),
includes the registered opaque `LocalWorkspaceBindingId`, and neither requires
nor treats a raw local path as cloud business identity.

The Agent Runtime:

- claims a local dispatch with an expiring lease and fencing token;
- accepts only a grant whose bindings and lifecycle checks remain valid;
- invokes approved local Agent, CLI, and tool adapters;
- reports heartbeat, bounded progress, artifacts, result, and reconciliation
  data through authenticated idempotent endpoints;
- observes cancellation and timeout policies; and
- never decides authoritative workflow transitions or writes business tables.

Claiming, heartbeat, grant renewal/revocation, lease expiry and fencing,
cancellation, retry, duplicate result, and `OutcomeUnknown` reconciliation
semantics must be specified and tested before local Agent execution is enabled.
Only this local route requires an execution grant, `LocalWorkspaceBindingId`, or
Agent Runtime claim lease. A Core API `ApprovalRequest` is canonical workflow
approval; a device-local `Local Execution Consent` is separate evidence and
cannot advance it.

`HYBRID` remote reasoning with local tool execution is deferred. It must receive
an explicit authorization, callback, replay, cancellation, and failure protocol
before either existing route is stretched to support it.

## Security and Tenancy

- Core API issues high-entropy opaque Desktop access and refresh tokens and
  stores only purpose-separated token digests in TTL-bounded Redis records.
  Refresh rotates both tokens; reuse of an old refresh credential revokes the
  session family. Malformed, expired, corrupt, revoked, unknown, or unavailable
  session state fails closed.
- The deployment edge does not create trusted identity. A future Gateway may
  apply route-specific credential validation or normalize trusted context as
  defense in depth, without assuming OIDC/JWT, but Core API still independently
  authenticates the principal and authorizes every resource action.
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
- No direct Agent Runtime database access.
- No long-running provider call inside an HTTP/database transaction.
- No business authorization or orchestration in the Gateway.
