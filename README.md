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

The Core API currently implements GitHub federated authentication and opaque
sessions. PostgreSQL/Flyway stores the durable `User`, provider-neutral
`ExternalIdentity`, and legal acceptance facts; Redis stores expiring OAuth
attempts, login rate limits, and session state. Runtime OpenAPI is available in
non-production profiles, and `:services:core-api:qualityCheck` is the complete
Core API gate. GitHub proves control of an external identity while TaskPilot
keeps its own stable `UserId` and authorization boundary.

The Electron/React Desktop implements the corresponding system-browser GitHub
login, first-registration confirmation, OS-credential-backed session restore,
refresh, and logout through hardened Main/Preload/Renderer boundaries. Workspace
and Project capabilities, Agent Runtime, Gateway, signed installers, production
deployment, and cross-platform native release evidence remain Target only.

## Local Development

Prerequisites are JDK 21, Docker with Compose, Node.js 22.12 or newer, and the
pinned pnpm version. Prepare a checkout once, then start it:

```bash
pnpm bootstrap
pnpm dev
```

`bootstrap` validates tools, creates or normalizes the Git-ignored `.env.local`
without replacing existing values, installs this checkout's repository-managed
Git hooks, installs the locked JavaScript graph, compiles Desktop and Core API,
and pulls the PostgreSQL and Redis images. The local file
uses the same documented sections and key order as `.env.local.example`;
checkout values and secrets are preserved by key during upgrades. Settings from
the retired email-authentication stack are moved to the Git-ignored
`.env.local.retired` file instead of remaining active or being discarded. `dev` starts the
checkout-scoped PostgreSQL 17 and Redis 7.4 containers, runs Core API and Flyway through the
Gradle Wrapper, waits for health, and then opens Electron. Re-running `pnpm dev`
first stops and replaces Desktop/Core API processes whose ownership can be
proved for this checkout; it never kills an unknown process merely because it
uses a configured port. `Ctrl+C` stops only host processes started by that
invocation; PostgreSQL and Redis remain available.

### GitHub OAuth App

Without GitHub credentials the stack deliberately stays healthy and
`GET /desktop/v1/auth/capabilities` reports GitHub login disabled. For a real
manual login, create a dedicated development GitHub OAuth App and set its
Authorization callback URL to the exact `TASKPILOT_GITHUB_CALLBACK_URI` written
to `.env.local`. `pnpm bootstrap` also writes two explicit empty credential
fields; replace their empty values in that Git-ignored file:

```dotenv
TASKPILOT_GITHUB_CLIENT_ID=your-development-client-id
TASKPILOT_GITHUB_CLIENT_SECRET=your-development-client-secret
```

`pnpm bootstrap` generates the independent 32-byte federated HMAC and AEAD keys
and the exact callback URI. Do not copy the example placeholders as credentials,
reuse either key for the other purpose, put secrets on command lines, or commit
`.env.local`. Incomplete, invalid, or reused-key configuration fails closed
rather than preventing Core API health.

### Lifecycle commands

```bash
pnpm dev:api          # PostgreSQL + Redis + Gradle/Spring Boot Core API, no Desktop
pnpm dev:desktop      # Desktop only; requires this checkout's healthy Core API
pnpm dev:doctor       # read-only tools, ports, ownership, and stale-state diagnosis
pnpm dev:status       # process/container ownership, health, URLs, auth capability
pnpm dev:logs         # Core API log; add --follow or --service postgres
pnpm dev:restart      # stop this checkout, then start the complete local stack
pnpm dev:stop         # stop owned processes/containers; keep database data
pnpm dev:smoke        # health + disabled GitHub capability; never contacts GitHub
pnpm check            # launcher, Desktop, and Core API quality gates
```

### Commit quality gates

`pnpm bootstrap` installs the versioned hooks for the current checkout. To
install or repair only the hooks, run:

```bash
pnpm hooks:install
```

The installer enables Git's worktree-specific configuration and sets
`core.hooksPath` to the relative `.githooks` directory for this worktree only.
Each linked worktree must install its own hooks. If another effective hooks path
is already configured at the worktree, local, global, or system level, the
installer fails without overwriting it and reports the current value, source,
and expected value. Decide whether to keep, migrate, or compose that hook
manager, update Git configuration explicitly, and rerun the installer. The
only accepted value is the normalized relative path `.githooks`; even an
absolute path that resolves to this checkout's `.githooks` is treated as a
custom path and refused. Set the value explicitly to `.githooks` before
retrying. Git invokes the versioned hook entries through a POSIX-compatible
shell, and that hook environment must be able to find `node` on `PATH`.

Commit subjects use this format:

```text
<type>(<optional-scope>)<optional-!>: <description>
```

Allowed types are `feat`, `fix`, `refactor`, `docs`, `test`, `build`, `ci`,
`perf`, `chore`, and `revert`. A scope may contain lowercase letters, digits,
and hyphens. The non-empty description starts with a lowercase letter or digit
and has no trailing period. Only the first line is validated. Git's default
`Revert "..."` subject is deliberately rejected; edit it to repository format,
for example `revert(core-api): restore previous session behavior`.

`pre-commit` selects tests only from staged paths, deduplicates them, and runs
them in this order:

| Staged path | Quality gate |
| --- | --- |
| `.githooks/**`, `tools/git-hooks/**` | `pnpm hooks:test` |
| `tools/dev/**`, `compose.yaml`, `.env.local.example` | `pnpm dev:test` |
| `apps/desktop/**` executable/configuration paths | `pnpm --filter @taskpilot/desktop qualityCheck` |
| `services/core-api/**`, root Gradle files, `gradle/**` | `./gradlew --no-daemon :services:core-api:qualityCheck` |
| Root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Hook tooling, dev tooling, and Desktop gates |
| Markdown, OpenSpec, Agent instructions, known repository metadata | Explicitly exempt |

An unmapped executable path is rejected until its owner and quality command are
added to the mapping. Renames affect source and target modules; copies affect
the target module. Before running a selected gate, the hook also rejects
tracked unstaged or untracked files inside any selected module or its mapped
shared boundary, because module tests read the worktree rather than an isolated
index snapshot. Unrelated mapped modules do not block the commit. The hook does
not stash, restore, clean, or change the index; stage, restore, or move the
listed files yourself.

Use the stable commands below to reproduce a rejection:

```bash
pnpm hooks:test                              # test the hook implementation
pnpm hooks:pre-commit                        # evaluate the current staged index
pnpm hooks:commit-msg -- <message-file>      # validate a Git message file
```

Gate output identifies the failed rule or quality gate, reason, triggering
paths, command, and next step. These local hooks are fast feedback, not a
security boundary: Git's native `git commit --no-verify` can bypass them, and
CI/release checks remain independently responsible for enforced quality.

`dev:desktop` refuses to start unless the Core API is healthy and recorded as
owned by this checkout. The controller waits for a replaced launcher to exit
before starting its successor, and never takes over or stops an unrecognized
process. Runtime ownership state and Core API logs live in Git-ignored
`.taskpilot/dev/` and contain no credentials; all local services bind to
loopback.

Each checkout gets a deterministic Compose project, separate disposable local
PostgreSQL and Redis volumes, and distinct loopback ports. When Core API startup proves a
Flyway schema-history incompatibility against that exact loopback database,
`pnpm dev` and `pnpm dev:api` verify both the checkout-owned Compose project and
the standard Compose volume labels, stop the failed Core API, rebuild only that
local volume, and retry once. Startup also removes orphan containers belonging
to the same Compose project.

Automatic recovery does not run for connection failures, ordinary migration SQL
errors, external databases, non-loopback JDBC targets, unknown containers, or
volumes whose ownership labels do not match. It never runs Flyway repair and
never retries recovery more than once; an unrecognized or repeated failure is
reported with the Core API log path for manual diagnosis. Local development data
must therefore be treated as disposable rather than as a backup or shared
database.

`pnpm dev:smoke` starts a temporary Core API on an isolated loopback port with
GitHub credentials disabled only in that child process. It reuses the
checkout-owned PostgreSQL and Redis containers, never rewrites `.env.local`,
does not stop an existing Core API or Desktop, and never contacts GitHub. The
smoke proves infrastructure/Core API health, the fail-closed capability response,
and removal of the old email-login route.

The real Provider journey was manually accepted on macOS in the local development
environment on 2026-10-12: first registration, repeat login to the same account,
Desktop activation after browser authorization, GitHub denial, Desktop
cancellation, and logout/session invalidation all passed. Browser close and
operating-system focus remain manual platform evidence rather than unit-test
claims. No OAuth codes, state, tokens, client secrets, email, account alias, or
personal screenshots are stored as evidence.
