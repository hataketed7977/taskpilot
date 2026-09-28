# Agent Instructions

## Scope

These instructions apply to the entire repository.

## Required Navigation

This file is the only required repository-level Agent entry point. Start with
the [`documentation map`](docs/README.md), then read by change type:

| Change | Mandatory root document |
| --- | --- |
| Business terminology, behavior, lifecycle, workflow, Board, Work Item, Agent, approval, custom field, or related API/data model | [`docs/business-model.md`](docs/business-model.md) |
| Architecture, project boundaries, dependencies, build, shared API policy, database technology, tests, deployment, or infrastructure | [`docs/architecture.md`](docs/architecture.md) |
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
| Independently and read-only verify implementation against the completed change before archive | `openspec-verify-change` |
| Merge an active change's delta specs into main specs without archiving it | `openspec-sync-specs` |
| Finalize a fully implemented change with current verification or allowed owner acceptance evidence | `openspec-archive-change` |

For Codex CLI or IDE, invoke a Skill with its `$` form, for example
`$openspec-propose`; in the Codex desktop app, select the corresponding Skill.
Do not start `openspec-apply-change` merely because planning artifacts exist:
confirm that scope and decisions are approved and that planning is complete.
OpenSpec validation proves artifact structure, not implementation correctness;
implementation still requires focused automated tests, source review, and any
owning architecture or contract updates. Proposed change artifacts describe a
future delta and must not be presented as current behavior.

The default completion sequence is `openspec-apply-change`, a separate
independent and read-only `openspec-verify-change`, verification receipt
recording, repository archive preflight, and only then
`openspec-archive-change`. Prefer a fresh context or reviewer for verification.
Verification itself never edits code, planning artifacts, or evidence. A
self-review may find defects but cannot represent itself as an independent
review.

A Change may opt into owner acceptance only through a committed
`verification-policy.json` whose risk is `low` or `bootstrap` and whose mode is
`owner-acceptance-allowed`. Missing policy defaults to independent review;
`standard`, `high`, and `critical` risk always require it. Owner acceptance must
identify the owner, reason, and accepted scope, and must remain visibly distinct
from independent review. It cannot waive failed commands, CRITICAL findings,
unaccepted WARNING findings, or applicable `Not verified` checks.

The coordinating agent records the attestation with
[`tools/openspec/record-verification.sh`](tools/openspec/record-verification.sh)
`<change> <review-report.json-or-markdown>`. A report intended for recording
must be pure JSON or, when it also contains the human-readable Verify report,
must append exactly one `verification-report` JSON fenced block. The
coordinator passes that report through without manually translating findings. Fix blockers through apply and rerun applicable checks;
independent-review Changes then require another independent review. Explicitly
accepted non-blocking WARNINGs and inapplicable checks remain visible in the
receipt.

Immediately before invoking `openspec-archive-change`, run
[`tools/openspec/archive-preflight.sh`](tools/openspec/archive-preflight.sh)
`<change>`. It rejects missing or malformed evidence, policy-ineligible
attestation, blocking results, and a relevant-content fingerprint that no
longer matches the attested state. The fingerprint always covers the selected
Change and its policy-declared impact paths and must not be invalidated by an
unrelated sibling Change. Any relevant content change after recording requires
fresh attestation; never bypass or hand-edit the receipt to make it pass.

Generated OpenSpec Skills must not be edited manually. Refresh and verify all
seven repository workflows with `tools/openspec/update-workflows.sh`; run
[`tools/openspec/test-workflow.sh`](tools/openspec/test-workflow.sh) after
changing the schema, workflow guidance, evidence format, preflight, or Skill
refresh logic.

For work under `apps/web/`, do not skip the mandatory design and React Skill
routing defined in [`apps/web/AGENTS.md`](apps/web/AGENTS.md#skill-routing):

- use `frontend-design` before creating or substantially reshaping a
  user-facing experience;
- use `vercel-react-best-practices` while implementing or materially
  refactoring React code; and
- use `web-design-guidelines` as the final UI/UX/accessibility review for
  changed user-facing interfaces.

The child `AGENTS.md` owns the detailed triggers, order, exceptions, and review
behavior. Documentation-only, backend-only, and non-visual changes do not
activate frontend Skills merely because the repository contains a Web project.

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
