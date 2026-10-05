# TaskPilot

TaskPilot is a SaaS-ready task and ticket management product under active
implementation. Its first-party Windows and macOS Desktop client is designed to
coordinate Agents working on explicitly selected local projects. The repository
currently includes a runnable Desktop first-use slice and a runnable Core API;
most workflow and Agent-execution capabilities remain approved Target design.

## Target Architecture

The approved direction is a cross-platform Desktop plus cloud-control-plane
monorepo:

- Electron, React, TypeScript, and Vite for one shared Windows/macOS Desktop
  codebase, with narrow native platform adapters.
- A separately supervised Agent Runtime for controlled workspace access,
  Agent/tool adaptation, process/PTY execution, logs, Diff, and artifacts.
- Kotlin and Spring for the API Gateway and Core API control plane.
- Spring Modulith for enforceable modular-monolith backend boundaries.
- Separate first-party Desktop API and public HTTP API surfaces.
- PostgreSQL as business truth; the Agent Runtime submits execution evidence
  and never writes Core API business tables directly.

Local project-root authorization is not an OS-level sandbox: arbitrary child
processes retain the user's operating-system permissions unless a future
isolation design is separately specified and implemented.

The system-level design lives in
[`docs/architecture.md`](docs/architecture.md). This file intentionally stays
at project-summary level.

## Repository Entry Points

- [`AGENTS.md`](AGENTS.md): mandatory instructions for AI agents.
- [`docs/README.md`](docs/README.md): complete documentation knowledge map.
- [`docs/business-model.md`](docs/business-model.md): product language, logical
  business model, Event Storming scenarios, and MVP rules.
- [`docs/architecture.md`](docs/architecture.md): overall system architecture.

## Current Status

The Core API currently implements first-party email/password/OTP
authentication, opaque sessions, Organization Workspace list/create, and a
Workspace-scoped read-only Project list with PostgreSQL/Flyway persistence,
runtime OpenAPI in non-production profiles, and a complete
`:services:core-api:qualityCheck` gate.

The Electron/React Desktop currently implements the corresponding in-app
authentication, session recovery, Workspace onboarding, and read-only Project
list through hardened Main/Preload/Renderer boundaries. Its source, component,
architecture, coverage, and build gates are executable; signed installers and
cross-platform native release evidence are not complete. Agent Runtime and
Gateway remain Target documentation only. The repository includes only a local
development Compose stack; production deployment manifests do not yet exist.

## Local Development

Prerequisites are JDK 21, Docker with Compose, Node.js 22.12 or newer, and the
pinned pnpm version. Prepare a checkout once, then start it:

```bash
pnpm bootstrap
pnpm dev
```

`bootstrap` is the explicit, network-capable preparation step. It validates the
system tools, creates or extends the Git-ignored `.env.local` without replacing
credentials or existing values, installs exactly `pnpm-lock.yaml`, compiles the
Desktop and Core API, and pulls only missing PostgreSQL and Mailpit images. It
does not install or upgrade JDK, Docker, Node.js, or pnpm.

`dev` is the repeatable runtime path. It validates tools and installed JavaScript
dependencies, starts PostgreSQL 17 and Mailpit through Docker Compose, starts the
Core API through the Gradle Wrapper, waits for Spring Boot to compile, validate
and apply Flyway migrations, and become healthy, then opens Electron. Renderer
changes use Vite HMR; Main, Preload, or shared-contract changes rebuild and
restart Electron. Pressing `Ctrl+C` stops host processes started by that
invocation but keeps PostgreSQL and Mailpit available for the next run.

### Lifecycle commands

```bash
pnpm dev:api          # infrastructure plus Gradle/Spring Boot Core API, no Desktop
pnpm dev:desktop      # Desktop only; require this checkout's Core API to be healthy
pnpm dev:doctor       # read-only tools, dependencies, ports, ownership, and stale-state diagnosis
pnpm dev:status       # process/container ownership, health, and actual local URLs
pnpm dev:logs         # Core API log; add --follow or --service postgres|mailpit
pnpm dev:restart      # stop this checkout, then start the complete local stack
pnpm dev:stop         # stop owned host processes and Compose containers; keep database data
pnpm dev:smoke        # headless registration, login OTP, and password-reset mail smoke
pnpm check            # complete launcher, Desktop, and Core API quality gates
```

`dev:api` and the complete `dev` entry still run Kotlin through
`./gradlew :services:core-api:bootRun`; pnpm only owns cross-project development
orchestration. `dev:desktop` refuses to start unless the configured Core API is both
healthy and recorded as owned by this checkout. `dev:smoke` may temporarily start infrastructure and Core API, never
opens Desktop, and stops only the Core API it started.

Each newly bootstrapped checkout receives a deterministic
`TASKPILOT_COMPOSE_PROJECT` and a persisted set of distinct loopback ports for
PostgreSQL, Mailpit SMTP/HTTP, Core API, and Vite. The values are written to
`.env.local`, propagated through Compose, Spring Boot, Vite, Electron, and the
Desktop HTTP transport, and may be edited when that checkout is stopped. An
existing `.env.local` is extended with its legacy `taskpilot-local` project and
ports so the existing database volume remains visible; it is never silently
moved or reset.

The controller never takes over an unrecognized process or changes a persisted
port automatically. Use `pnpm dev:doctor` to identify a conflict, then stop the
owner or edit the stopped checkout's `.env.local`. On macOS and Linux, process shutdown sends a
graceful signal, waits, and escalates after a timeout; Windows terminates the
owned process tree directly. Ownership state is deleted only after confirmed exit. Docker unavailability does not prevent owned host
processes from stopping. If a host process cannot stop, its state and
infrastructure are preserved rather than orphaning it from PostgreSQL.

Every newly bootstrapped checkout owns a separate Compose project and PostgreSQL
volume, so branches with different Flyway histories do not migrate the same database.
A legacy checkout keeps its existing project and volume for compatibility.
Spring Boot is the only local migration runner. A compile, migration, or health
failure prevents Desktop startup and leaves infrastructure running for
diagnosis; the launcher never runs Flyway repair, edits migration checksums,
deletes a volume, or resets data automatically. Rebase-time migration version
conflicts must be resolved in source before retrying.

Runtime ownership state and Core API logs live under the Git-ignored
`.taskpilot/dev/` directory and contain no credentials. All services bind only
to loopback. Packaged Desktop builds continue to load local Renderer files with
the production CSP.

Use `.env.local.example` only as a key reference. Do not commit `.env.local` or
reuse these local credentials in a deployed environment. Local plaintext SMTP
is restricted in code to the non-production `local` profile and loopback
Mailpit. The default `pnpm dev` path therefore needs no mail-provider account,
and `pnpm dev:smoke` remains a deterministic Mailpit-only registration, login
code, and password-reset check.

For an optional real-inbox development smoke, set
`TASKPILOT_VERIFICATION_MAIL_MODE=external` and the documented
`TASKPILOT_EXTERNAL_SMTP_*` values in `.env.local`, then restart the Core API.
The launcher rejects incomplete credentials, invalid ports, plaintext transport,
and simultaneous STARTTLS/implicit-SSL selection before startup. External SMTP
uses the existing production mail adapter, which independently requires either
required STARTTLS or implicit SSL. Request one code at a time from the Desktop
and inspect the test inbox manually; automated smoke never sends provider mail.
