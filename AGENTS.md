# Agent Instructions

## Scope

These instructions apply to the entire repository.

## Required Navigation

This file is the only required repository-level Agent entry point. Start with
the [`documentation map`](docs/README.md), then read by change type:

| Change | Mandatory root document |
| --- | --- |
| Business terminology, behavior, lifecycle, workflow, Board, Work Item, Agent, approval, custom field, or related API/data model | [`docs/business-model.md`](docs/business-model.md) |
| Architecture, Desktop, Agent Runtime, project boundaries, dependencies, build, shared API policy, database technology, tests, deployment, or infrastructure | [`docs/architecture.md`](docs/architecture.md) |
| Both business behavior and its implementation | Both documents, business model first |
| Documentation inventory, ownership, navigation, move, or rename | [`docs/README.md`](docs/README.md) |

When working inside a subproject:

1. Read the nearest child `AGENTS.md`.
2. Follow its links to that subproject's architecture, responsibilities, and
   testing documents as applicable.
3. Apply root and child constraints together; the business model owns product
   meaning, the root architecture owns cross-project boundaries, and the
   narrower engineering document owns local implementation detail.

Do not infer project rules from directory names alone.

## Skill Routing

Skills provide task-specific working methods but do not override repository
source-of-truth documents, approved technology choices, security boundaries, or
the user's requested scope. Read an applicable Skill's `SKILL.md` before using
it and apply only the parts compatible with this repository.

### OpenSpec / SDD Routing

TaskPilot uses the repository-local OpenSpec installation for spec-driven
development. The generated workflow Skills under `.agents/skills/` own the
detailed procedures; refresh the repository workflow set with
[`tools/openspec/update-workflows.sh`](tools/openspec/update-workflows.sh)
rather than copying their instructions into this file or changing the user's
global OpenSpec profile.

Create or update an OpenSpec change before implementation when work does any of
the following:

- adds or changes user-visible behavior, business rules, or acceptance
  scenarios;
- changes architecture, process or module boundaries, API contracts, persisted
  data, authorization, security, build, deployment, or cross-project test
  strategy;
- spans more than one subproject or needs an explicit migration or rollout
  decision; or
- is explicitly requested as OpenSpec, SDD, a specification, or a proposal.

A separate OpenSpec change is not required for read-only investigation, typo or
link corrections, generated-instruction refreshes, or a small local correction
whose expected behavior is already unambiguously owned by an approved spec and
whose public contracts do not change. If scope or behavior is uncertain, use
OpenSpec rather than silently treating the work as a small correction.

Use the OpenSpec Skills by phase:

| Situation | Skill |
| --- | --- |
| Clarify a problem, investigate options, or reduce ambiguity before committing to a change | `openspec-explore` |
| Turn an agreed goal into a complete proposal, specs, design, and task plan | `openspec-propose` |
| Revise an existing change's planning artifacts or reconcile inconsistencies among them | `openspec-update-change` |
| Implement or continue the tasks of a selected, planning-complete change | `openspec-apply-change` |
| Optionally perform an independent read-only review for high-risk work or when explicitly requested | `openspec-verify-change` |
| Merge an active change's delta specs into main specs without archiving it | `openspec-sync-specs` |
| Sync applicable delta specs and finalize a fully implemented, tested change | `openspec-archive-change` |

For Codex CLI or IDE, invoke a Skill with its `$` form, for example
`$openspec-propose`; in the Codex desktop app, select the corresponding Skill.
Do not start `openspec-apply-change` merely because planning artifacts exist:
confirm that scope and decisions are approved and that planning is complete.
OpenSpec validation proves artifact structure, not implementation correctness;
implementation still requires focused automated tests, source review, and any
owning architecture or contract updates. Proposed change artifacts describe a
future delta and must not be presented as current behavior.

The default completion sequence is `openspec-apply-change`, the focused and
affected automated checks declared by the Change's test plan, applicable delta
spec sync, and then `openspec-archive-change`. Task completion and OpenSpec
validation are structural signals; they do not replace passing tests or the
archive workflow's spec-sync assessment.

`openspec-verify-change` is optional. Use it when the user requests an
independent review or when the change's security, data, authorization,
deployment, or business risk warrants a second read-only pass. Verification
findings loop back to apply, but routine completion does not require a receipt,
workspace fingerprint, verification policy, or repository archive preflight.

Generated OpenSpec Skills must not be edited manually. Refresh and verify all
seven repository workflows with `tools/openspec/update-workflows.sh`; run
[`tools/openspec/test-workflow.sh`](tools/openspec/test-workflow.sh) after
changing the schema, workflow guidance, or Skill refresh logic.

For Renderer UI work under `apps/desktop/`, do not skip the mandatory design
and React Skill routing defined in
[`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md#skill-routing):

- use `frontend-design` before creating or substantially reshaping a
  user-facing experience;
- use `vercel-react-best-practices` while implementing or materially
  refactoring React code; and
- use `web-design-guidelines` as the final UI/UX/accessibility review for
  changed user-facing interfaces.

The child `AGENTS.md` owns the detailed triggers, order, exceptions, and review
behavior. Documentation-only, backend-only, and non-visual changes do not
activate frontend Skills merely because the repository contains a Desktop project.
Local execution work under `apps/agent-runtime/` instead follows
[`apps/agent-runtime/AGENTS.md`](apps/agent-runtime/AGENTS.md).

## Source-of-Truth Order

1. Executable code and tests describe current implemented behavior.
2. [`docs/business-model.md`](docs/business-model.md) defines approved product
   vocabulary, behavior, lifecycles, and business rules, including target
   behavior not yet implemented.
3. The nearest existing subproject documentation defines delegated local
   implementation constraints.
4. [`docs/architecture.md`](docs/architecture.md) defines cross-project
   architecture and owns confirmed technical design not yet delegated.
5. This file defines repository-wide working and navigation rules.
6. The root README provides human-facing project orientation.

When code and documentation disagree, identify the mismatch before changing
either. Never silently rewrite documentation to justify an unrelated code
change.

## Working Rules

- Keep changes within the user's requested scope.
- State explicit non-goals before substantial changes.
- Prefer the smallest complete implementation over speculative abstractions.
- Add shared packages or services only after a real ownership or reuse boundary
  exists.
- Keep secrets and environment-specific credentials out of the repository.
- Update the owning architecture document when an architectural contract
  changes.
- Add or update focused tests for behavior changes.
- Never describe planned components as already implemented.

## Documentation Rules

- [`docs/README.md`](docs/README.md) is the authoritative documentation map;
  update it whenever an engineering document is added, moved, renamed, deleted,
  or changes ownership.
- [`docs/business-model.md`](docs/business-model.md) owns product language and
  business rules. Engineering documents may describe implementation but must
  not redefine that model.
- Root `docs/` is the initial home for business modeling, overall architecture,
  and confirmed cross-project constraints.
- Keep a concern in the root architecture until a real subproject exists and
  has enough local detail to own it.
- When delegating a concern, create the child `AGENTS.md` and child `docs/`,
  move the detailed rules there, and replace root detail with a summary and
  link in the same change.
- Every subproject must add its own `AGENTS.md` when the subproject is created.
- Do not create a README merely because a directory exists.
- Use Mermaid for architecture, dependency, workflow, sequence, and state
  diagrams. Reserve plain-text trees for filesystem layouts and literal text
  examples.
- Prefer source pointers for facts visible in code and explicit prose for rules
  that must be understood before changing code.
- Do not maintain the same detailed rule in both root and child documentation.
- Every engineering document must be reachable from the documentation map,
  declare its ownership and status, and link to its prerequisites.
- Event Storming artifacts are business-analysis inputs; do not mechanically
  turn every named command/event into a code type, listener, module, aggregate,
  or repository.

## Documentation Status

- **Current:** Verified against files that exist in the repository.
- **Target:** Approved design for code that has not been implemented.
- **Proposed:** Unresolved and not approved for implementation.
- **Deprecated:** Retained only for migration context.

Never present target or proposed behavior as current behavior.
