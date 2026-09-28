# TaskPilot

TaskPilot is planned as a SaaS-ready task and ticket management product. The
repository is currently in a documentation-first phase; no runnable application
has been initialized yet.

## Target Architecture

The approved direction is a frontend/backend-separated monorepo:

- React and TypeScript for the Web application.
- Kotlin and Spring for the API Gateway and backend.
- Spring Modulith for enforceable modular-monolith boundaries.
- Separate first-party Web API and public HTTP API surfaces.
- Direct application services for ordinary use cases, with durable jobs or
  events only at genuine asynchronous boundaries.

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

The Web, Gateway, and Core API boundaries exist as documentation-only
subprojects with local Agent instructions, architecture, responsibility, and
testing documents. Build files, application source, database migrations, API
specifications, and deployment manifests do not exist yet and must not be
assumed to exist.
