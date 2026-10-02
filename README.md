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
pinned pnpm version. Install JavaScript dependencies once with `pnpm install`,
then run:

```bash
pnpm dev
```

The command creates a Git-ignored `.env.local` on first use, starts PostgreSQL
17 and Mailpit through Docker Compose, waits for Core API health, and opens
Electron against the local API in Desktop development mode. Renderer changes
use Vite HMR without reopening the window; Main, Preload, or shared-contract
changes are rebuilt and restart Electron automatically. The development server
is loopback-only on `http://127.0.0.1:5173`; packaged builds continue loading
local files with the production CSP. Pressing `Ctrl+C` stops the Desktop and a
Core API started by that invocation; PostgreSQL and Mailpit remain available
for the next run.

To run only the Desktop development loop against an already running local Core
API, use `pnpm --filter @taskpilot/desktop dev`. Use
`pnpm --filter @taskpilot/desktop build` for a production-style local build.

### Lifecycle commands

```bash
pnpm dev:doctor       # read-only prerequisites, environment, ports, and stale-state diagnosis
pnpm dev:status       # service ownership, process state, health, and local URLs
pnpm dev:logs         # last 200 Core API log lines
pnpm dev:logs --follow
pnpm dev:logs --service postgres
pnpm dev:logs --service mailpit --follow
pnpm dev:restart      # stop this local stack, then start it again
pnpm dev:stop         # stop owned host processes and Compose containers; keep database data
pnpm dev:smoke        # headless registration, login OTP, and password-reset mail smoke
```

`dev:smoke` starts missing infrastructure and Core API services but never opens
the Desktop. If Core API was already running for this checkout, the command
leaves it running; otherwise it stops the temporary Core API after the smoke.
The legacy focused commands remain available:

```bash
pnpm dev:setup          # create .env.local without overwriting it
pnpm dev:infra          # start only PostgreSQL and Mailpit
pnpm dev:infra:down     # stop infrastructure and retain its PostgreSQL volume
pnpm dev:mail-smoke     # run only the mail flow against services already running
```

Local addresses default to:

- Core API: [http://127.0.0.1:8080](http://127.0.0.1:8080)
- Mailpit inbox: [http://127.0.0.1:8025](http://127.0.0.1:8025)
- PostgreSQL: `127.0.0.1:5432`
- Mailpit SMTP: `127.0.0.1:1025`

The PostgreSQL, SMTP, and Mailpit HTTP `TASKPILOT_*_PORT` values in
`.env.local` can change their infrastructure ports. Core API remains on 8080
because the current Desktop local transport contract is fixed to that address.
Runtime state and Core API logs live under the Git-ignored
`.taskpilot/dev/` directory and are scoped to this checkout. State contains
only process metadata, never environment values or credentials.

The controller never kills or reuses an unrecognized process just because it
owns a required port, never runs Flyway repair, and never deletes the database
volume during normal stop. Use `pnpm dev:doctor` to identify a conflict, then
free the port or select another one. A service recorded in local state is
stopped only when its command line proves that it belongs to this checkout.
Compose container labels are checked the same way so another checkout cannot be
reused or stopped accidentally.

Use `.env.local.example` only as a key reference. Do not commit `.env.local` or
reuse these local credentials in a deployed environment. Local plaintext SMTP
is restricted in code to the non-production `local` profile and loopback
Mailpit; production SMTP still requires STARTTLS or implicit TLS and runtime
secret injection. A real external mail-provider smoke remains a deployment and
release responsibility, not a local-development prerequisite.
