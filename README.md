# TaskPilot

TaskPilot is planned as a SaaS-ready task and ticket management product whose
first-party Windows and macOS Desktop client can coordinate Agents working on
explicitly selected local projects. The repository remains documentation-first
for product capabilities, while a minimal runnable Core API engineering
foundation has now been initialized.

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

The Core API now has a runnable Kotlin/Spring Boot foundation with four empty
Spring Modulith capability boundaries, restricted health probes, layered tests,
and a complete `:services:core-api:qualityCheck` gate. It has no business API,
business persistence, or production migration yet.

Desktop, Agent Runtime, and Gateway remain Target documentation only. API
specifications, platform packages, and deployment manifests do not exist yet
and must not be assumed to exist.
