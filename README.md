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

Prerequisites are JDK 21, Docker, Node.js, and the pinned pnpm version. Install
JavaScript dependencies once with `pnpm install`, then run:

```bash
pnpm dev
```

On first use this command creates a Git-ignored `.env.local` with random
local-only credentials, starts PostgreSQL 17 and Mailpit with Docker Compose,
waits for their health checks, starts Core API with the explicit `local`
profile, applies all Flyway migrations, builds Desktop, and opens the Electron
app against `http://127.0.0.1:8080`. Mailpit's inbox is available at
[http://127.0.0.1:8025](http://127.0.0.1:8025).

Useful commands:

```bash
pnpm dev:infra          # start only PostgreSQL and Mailpit
pnpm dev:mail-smoke     # verify registration, login OTP, and password reset mail
pnpm dev:infra:down     # stop local infrastructure; keep PostgreSQL data
```

`pnpm dev:setup` creates `.env.local` without overwriting an existing file.
Use `.env.local.example` only as a key reference. Do not commit `.env.local` or
reuse these local credentials in a deployed environment. Local plaintext SMTP
is restricted in code to the non-production `local` profile and loopback
Mailpit; production SMTP still requires STARTTLS or implicit TLS and runtime
secret injection. A real external mail-provider smoke remains a deployment and
release responsibility, not a local-development prerequisite.
