# Tasks

## 1. Project-level OpenSpec schema

- [x] 1.1 Fork the installed `spec-driven` schema to project-local `taskpilot-sdd`, record the OpenSpec source version, and verify `openspec schema which taskpilot-sdd` resolves inside this repository.
- [x] 1.2 Add the `test-plan` artifact and dependency edges `proposal/specs/design → test-plan → tasks → apply`, then verify `openspec schema validate taskpilot-sdd --verbose` passes.
- [x] 1.3 Add a `test-plan.md` template and instructions covering risk-to-layer mapping, Red failure evidence, Green behavior, Refactor protection, focused/affected commands, and justified exceptions; verify `openspec templates --schema taskpilot-sdd --json` resolves every template from the project schema.
- [x] 1.4 Customize the design, tasks, and apply guidance so behavioral work is sliced as Red → Green → Refactor and tests land with their production behavior; verify schema validation still passes and the instructions do not mandate fake tests for non-behavioral work.
- [x] 1.5 Set `taskpilot-sdd` as the repository default in `openspec/config.yaml` and verify `openspec context --json` plus a disposable change report `schemaName: taskpilot-sdd` without changing this in-flight change's pinned schema.

## 2. Official review workflow

- [x] 2.1 Add `tools/openspec/update-workflows.sh` to generate the six core Codex Skills plus official `verify` using a temporary `XDG_CONFIG_HOME`, and verify the script leaves the user's real `openspec config path` content unchanged.
- [x] 2.2 Run the workflow update script and verify `.agents/skills/openspec-verify-change/SKILL.md` exists, identifies the installed OpenSpec version, and the existing core Skills remain present.
- [x] 2.3 Update root `AGENTS.md` so apply is followed by independent read-only `openspec-verify-change`, blocking findings loop back to apply, applicable `Not verified` results block archive readiness, and verify the documented Skill names resolve to repository-local files.

## 3. Architecture and template integration

- [x] 3.1 Update `docs/architecture.md` with the cross-project SDD quality flow and TDD/review gates, referencing rather than duplicating each subproject's testing strategy; verify every added local documentation link resolves.
- [x] 3.2 Create a disposable tooling-only change and verify its status graph contains `test-plan`, its generated tasks require TDD evidence or a justified exception, and `openspec instructions apply --change <smoke-change> --json` includes the test plan and custom apply guidance; remove the disposable change after the checks pass.
- [x] 3.3 Run `openspec schema validate taskpilot-sdd --verbose`, `openspec doctor`, and `openspec validate --all --strict --no-interactive`; record the commands and results for the review handoff without adding manual-check checkboxes to this task list.

## 4. Durable review evidence and regression gates

- [x] 4.1 Add `tools/openspec/test-workflow.sh` to create an isolated temporary OpenSpec root and assert the default schema, `test-plan` graph, tasks/apply TDD guidance, and strict validation; verify the script cleans its fixture and leaves active changes unchanged.
- [x] 4.2 Add a structured verification receipt recorder plus `tools/openspec/archive-preflight.sh` that binds an independent review to a conservative workspace fingerprint and rejects missing, malformed, stale, blocking, or applicable `Not verified` evidence; cover passing and rejection paths in the workflow test.
- [x] 4.3 Strengthen `tools/openspec/update-workflows.sh` so all six core Skills plus official verify must exist and report `generatedBy` equal to `openspec --version`; run its syntax and generated-file assertions without changing the user's global profile.
- [x] 4.4 Update root `AGENTS.md` and `docs/architecture.md` with the receipt-recording and archive-preflight contract while keeping official verify read-only and generated Skills unmodified; verify every new local documentation link resolves.
- [x] 4.5 Run `tools/openspec/test-workflow.sh`, schema validation, doctor, strict all-change validation, and archive-preflight negative checks for this change before handing off to a new independent review.
