# Tasks

## 1. Core API Work Item assignee and creator contract

- [x] 1.1 Red: add focused Core API application/HTTP tests for Work Item `createdBy`, default `assignee = null`, valid Project Member assignee on create, idempotent replay including assignee, and creator stability after assignee changes; evidence: tests fail only because behavior/schema is missing.
- [x] 1.2 Red: add rejection/concurrency tests for non-project member, cross-Project membership, unknown membership, inactive User, unsupported target type, stale Work Item version, and assignee+content+Placement atomic rollback; evidence: focused tests fail on missing validation/contract.
- [x] 1.3 Green: implement the persistence migration/schema by adding `assignee_target_type` and `assignee_project_membership_id` to `project.work_items`, adding the Project-scoped composite FK to `project.project_memberships(project_id, id)` plus any required supporting unique constraint, and adding check constraints that allow only null/null unassigned or `PROJECT_MEMBER` + membership id; expose `PersonSummary`/`AssigneeTarget`, update Work Item create/detail/edit and Board projection use cases, and keep unsupported target types rejected; evidence: focused Core API tests from 1.1/1.2 pass.
- [x] 1.4 Refactor: consolidate creator/assignee summary mapping and Work Item mutation transaction paths without changing external behavior; evidence: rerun `./gradlew --no-daemon :contracts:canonical-api:qualityCheck`, `./gradlew --no-daemon :services:core-api:test --tests "*ProjectWorkApplicationIntegrationTest"` and relevant HTTP focused tests.
- [x] 1.5 Update `services/core-api/docs/architecture.md`, `services/core-api/docs/responsibilities.md`, and `services/core-api/docs/testing-strategy.md` for the implemented assignee/creator persistence/API/test ownership; evidence: docs diff matches implemented Current behavior.

## 2. Canonical contract, Project Member API, and Gateway manifest

- [x] 2.1 Red: update canonical contract tests/OpenAPI assertions for `PersonSummary`, nullable `assignee`, `PROJECT_MEMBER` target, `GET /v1/projects/{projectId}/members`, `x-taskpilot-ingress: canonical`, assignee validation/conflict Problem Details, and absence of member-management/history/Agent picker endpoints; evidence: tests fail only because schema/operation is missing.
- [x] 2.2 Green: update `contracts/canonical-api/openapi.yaml` with the new schemas, Project Member list operation, response/error contracts, and ingress metadata; evidence: `./gradlew --no-daemon :contracts:canonical-api:qualityCheck` passes and generated Gateway route manifest includes the new canonical operation without hand-written Gateway routes.
- [x] 2.3 Add Core HTTP/OpenAPI tests for scoped Project Member reads, active-member filtering, absence of other Project members, bearer/path requirements, response schema, and no member-management or Agent picker endpoints; evidence: tests fail only because Core API behavior is missing, not because the canonical contract is absent.
- [x] 2.4 Implement the Project Member list use case/controller/DTO and deterministic ordering, reusing existing OWNER authorization and not-found semantics; evidence: candidate API tests and `./gradlew --no-daemon :services:core-api:test --tests "*OpenApiIntegrationTest"` pass.
- [x] 2.5 Run Gateway focused verification after the route manifest changes; evidence: `./gradlew --no-daemon :services:gateway:qualityCheck` passes and source review confirms no manual route catalog or `/v1/**` catch-all was added.

## 3. Desktop Main, Preload, and shared contracts

- [x] 3.1 Update `apps/desktop/src/shared/contracts.ts` and Main transport/parser fixtures for `PersonSummary`, `AssigneeTarget`, `createdBy`, Card/WorkItem assignee, Project Member list, and explicit assignee patch/clear semantics; evidence: TypeScript compile identifies all call sites updated.
- [x] 3.2 Add/update Desktop Main contract tests for nullable assignee, assigned member summary, Project Member list API, invalid/unknown target shape fail-closed behavior, and no history/versions capabilities; evidence: `corepack pnpm --filter @taskpilot/desktop test:main` passes.
- [x] 3.3 Update Main/Preload project-work adapters to call the new Core API fields/endpoints and preserve session/Board generation fencing; evidence: focused Main tests and `corepack pnpm --filter @taskpilot/desktop typecheck` pass.

## 4. Renderer Card/detail/picker UI

- [x] 4.1 Apply Desktop UI skill routing before code: record the `frontend-design` plan for Card avatar, editable assignee property, creator/timestamp audit footer, picker loading/empty/error/keyboard/reduced-motion states, and verify it preserves the approved title/description layout grammar; evidence: design notes are reflected in the implementation diff or linked in self-review.
- [x] 4.2 Implement Renderer state/query support for Project Member list, assignee display, assignee set/replace/clear mutation, authoritative response reconciliation, stale response handling, and conflict/error recovery; evidence: focused Renderer tests for state transitions pass.
- [x] 4.3 Implement fixed-height Card content slots with a top-right avatar-only assignee marker and Work Item detail assignee-property/picker plus immutable creator audit-footer UI with i18n strings, accessible names, keyboard flow, loading/empty/error states, and no creator editing; evidence: Renderer tests for assigned/unassigned Card and detail interactions pass.
- [x] 4.4 Run `vercel-react-best-practices` while implementing React changes and address material state/rendering findings; evidence: self-review lists any relevant finding/fix or deliberate non-applicability.
- [x] 4.5 Run final `web-design-guidelines` review for the changed Card/detail/picker UI and fix material accessibility/layout findings; evidence: self-review lists findings/fixes and `corepack pnpm --filter @taskpilot/desktop test:renderer` passes.
- [x] 4.6 Add/update Cypress component coverage for equal-height assigned/unassigned and short/long Cards, real Chromium top-right avatar geometry, title/description clamping, picker hover/focus/keyboard, detail property/footer layout stability, dirty-field save-before-picker sequencing, error state, and reduced-motion behavior; evidence: `corepack pnpm --filter @taskpilot/desktop test:e2e -- --component` or the current documented equivalent passes.
- [x] 4.7 Update `apps/desktop/docs/architecture.md`, `apps/desktop/docs/responsibilities.md`, and `apps/desktop/docs/testing-strategy.md` for assignee UI/contract ownership and verification; evidence: docs diff matches implemented UI boundaries.

## 5. Business, architecture, and main contract documentation

- [x] 5.1 Update `docs/business-model.md` to mark current Work Item creator display and single Project Member responsibility slice as Current while leaving Agent assignment/history/lifecycle as Target/future; evidence: model text matches implemented behavior and non-goals.
- [x] 5.2 Update `docs/architecture.md` if cross-project Desktop/Core API contract or Project Membership/Work Item boundary statements need Current wording; otherwise record evidence-backed no-change reason in self-review; evidence: root architecture drift audit completed.
- [x] 5.3 Review `docs/README.md`, root `AGENTS.md`, `apps/desktop/AGENTS.md`, `services/core-api/AGENTS.md`, and related child docs for navigation/ownership drift; evidence: either targeted docs updates or explicit no-change rationale.

## 6. Final verification and model-drift reconciliation

- [x] 6.1 Run focused contract/Core API gates: `./gradlew --no-daemon :contracts:canonical-api:qualityCheck`, `./gradlew --no-daemon :services:core-api:test --tests "*ProjectWorkApplicationIntegrationTest" --tests "*AuthenticationHttpIntegrationTest" --tests "*OpenApiIntegrationTest"` and `./gradlew --no-daemon :services:core-api:test --tests "*WorkspaceProjectMigrationIntegrationTest"`; evidence: commands pass or failures are fixed/re-run.
- [x] 6.2 Run affected Core API, Gateway, and Desktop gates: `./gradlew --no-daemon :services:core-api:qualityCheck`, `./gradlew --no-daemon :services:gateway:qualityCheck`, `corepack pnpm --filter @taskpilot/desktop qualityCheck`, and `git diff --check`; evidence: commands pass or any documented exceptions are resolved before handoff.
- [x] 6.3 Run `openspec validate --all --strict --no-interactive`; evidence: active Change and specs validate strictly.
- [x] 6.4 Compare approved model/spec/design/test-plan with implemented code, migrations, APIs, tests, UI and docs; resolve or record every material drift, including explicit confirmation that history/version/activity and Agent picker remain unimplemented; evidence: self-review section names the audit result.
- [x] 6.5 Confirm delta-spec sync readiness: each implemented stable behavior has an owning main spec/doc target and no proposed-only behavior is presented as Current before archive; evidence: self-review states sync/archive readiness but does not run sync/archive without explicit user authorization.
