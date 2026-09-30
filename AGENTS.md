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
development. The workflow Skills under `.agents/skills/` own the detailed
procedures, while the repository-local schema and configuration own TaskPilot's
project policy. Generated Skills must not be edited manually; use the official
OpenSpec commands appropriate to the Agent integration instead of repository
wrapper scripts or changes to a user's global OpenSpec profile.

Create or update an OpenSpec Change before implementation only when the intended
outcome is a product or system change and it does any of the following:

- adds or changes user-visible behavior, business rules, or acceptance
  scenarios;
- changes architecture or module boundaries, API contracts, persisted data,
  authorization, security, build, deployment, or cross-project test strategy;
- spans more than one subproject or needs an explicit migration or rollout
  decision; or
- the user explicitly asks to create or update an OpenSpec Change, proposal, or
  specification for that product or system change.

Merely mentioning OpenSpec, discussing its workflow, invoking an existing
Change, or asking to repair repository development instructions is not a request
to create another Change. Changes whose subject is OpenSpec itself—including
repository governance, Agent routing, configuration, schema, templates,
workflow Skills, or helper scripts—are edited directly after the intended
policy is agreed; never create a nested OpenSpec Change to modify the OpenSpec
process. Validate those edits with official OpenSpec commands.

A separate OpenSpec Change is also not required for read-only investigation,
typo or link corrections, generated-instruction refreshes, or a small local
correction whose expected behavior is already unambiguously owned by an approved
spec and whose public contracts do not change.

Identifying a possible OpenSpec-sized change does not authorize creating or
updating Change artifacts. The default discovery path is:

1. Start in `openspec-explore` without creating a Change or writing proposal
   artifacts.
2. Inspect existing code and source-of-truth documents before asking questions.
3. For substantial ambiguity, competing designs, or high-impact decisions, use
   `grill-with-tree` when that capability is available. Show a concise decision
   tree, batch independent high-risk questions, recommend defaults, and make
   scope, decisions, risks, and non-goals explicit. Agents without that Skill
   must follow the same interaction pattern rather than skipping the analysis.
4. Present the resulting scope, decisions, non-goals, and remaining risks as a
   proposal-readiness checkpoint.
5. Create or update an OpenSpec Change only after the user explicitly confirms
   that checkpoint and authorizes proposal/Change creation. Agreement to explore,
   investigate, or discuss options is not proposal authorization.

A user who explicitly invokes `openspec-propose` or directly asks to create a
proposal may skip extended exploration only when the material decisions are
already resolved. Before writing artifacts, still show the compact readiness
checkpoint and obtain explicit confirmation unless that exact scope and
proposal action were already confirmed in the current conversation. If product
scope or behavior remains uncertain, continue exploration instead of guessing.

### Business Modeling and Documentation Feedback

Every future feature that adds or changes product behavior must include a
proportionate business-modeling pass before its implementation plan is treated
as complete. This is a semantic design gate, not a requirement to adopt
tactical DDD or to produce a fixed set of diagrams.

1. Inspect the current code, tests, main specs, active Change artifacts, and
   owning documents before asking the user to repeat known facts.
2. State the feature's actors, goal, scope, non-goals, and affected canonical
   terms. Analyze the dimensions that can change correctness: stable identity;
   ownership, references, and cardinality; lifecycle and transitions;
   invariants and uniqueness; authorization and tenant scope; versioning and
   history; synchronous and asynchronous boundaries; and important rejection,
   failure, recovery, concurrency, and abuse scenarios.
3. Use the smallest useful modeling methods for the risk. Preferred tools
   include lightweight Event Storming for facts and policies, concrete
   scenario/example mapping for behavior, relationship maps for identity and
   cardinality, state machines for lifecycles, decision trees for ambiguous
   choices, and threat modeling for trust boundaries. Do not mechanically turn
   analysis artifacts into aggregates, repositories, commands, events,
   listeners, modules, or tables.
4. Resolve every decision that would change observable behavior, the logical
   model, security, data ownership, acceptance scenarios, or implementation
   ordering before proposal readiness. A deliberately deferred detail must name
   why it is safe to defer and what later feature or gate must resolve it.
5. Record the resulting model impact in the Change. A feature with no change to
   product terms, relationships, lifecycles, or invariants must say so and
   identify the already-approved rule it implements; silence is not a model
   assessment.

Modeling depth is proportional to novelty, ambiguity, reversibility cost, and
risk. A small correction implementing an unambiguous approved rule needs only
an evidence-backed no-model-change statement. A new core concept, relationship,
lifecycle, authorization rule, persisted invariant, or cross-boundary workflow
requires explicit model artifacts and concrete scenarios before implementation.

Implementation is also a source of evidence. When a slice reveals a missing or
incorrect business assumption, do not hide the decision in code or defer all
documentation until the end: pause that slice, update and re-approve the
Change's affected proposal/spec/design/test-plan artifacts, update the owning
source-of-truth document when the stable rule has changed, and then continue.

Before sync or archive, perform a model-drift and documentation-feedback audit
against the implemented code, migrations, APIs, tests, and operational
evidence. Feed stable conclusions back to their owners:

- product vocabulary, identities, relationships, lifecycles, and business
  invariants to [`docs/business-model.md`](docs/business-model.md);
- cross-project boundaries and confirmed technical contracts to
  [`docs/architecture.md`](docs/architecture.md);
- delegated implementation responsibilities and verification commands to the
  nearest child documents;
- observable capability behavior to the applicable main OpenSpec specs through
  delta-spec sync.

Update `Current`, `Target`, `Proposed`, and `Deprecated` statements to match the
evidence. Documentation owed by one implementation slice should be updated in
that slice; the final audit detects drift and reconciles cross-slice conclusions
rather than postponing all documentation work. If no owning document changes,
record the evidence-backed reason in the Change. Structural validation or
passing tests alone do not prove semantic alignment.

This policy applies prospectively to features proposed after its adoption. An
already in-flight Change continues under its approved artifacts and does not
gain new modeling headings, tasks, or archive conditions solely because this
policy or schema changed, unless the user explicitly chooses to migrate it.
This grandfathering does not authorize silently changing that Change's already
approved behavior or contracts in code.

Use the OpenSpec Skills by phase:

| Situation | Skill |
| --- | --- |
| Default starting point for a possible Change: inspect evidence, clarify the problem, and reduce ambiguity without creating artifacts | `openspec-explore`, plus `grill-with-tree` for material decisions when available |
| Turn an agreed goal into a complete proposal, specs, design, and task plan | `openspec-propose` |
| Revise an existing change's planning artifacts or reconcile inconsistencies among them | `openspec-update-change` |
| Implement or continue the tasks of a selected, planning-complete change | `openspec-apply-change` |
| Optionally perform an independent read-only review for high-risk work or when explicitly requested | `openspec-verify-change` |
| Merge an active change's delta specs into main specs without archiving it | `openspec-sync-specs` |
| Sync applicable delta specs and finalize a fully implemented, tested change | `openspec-archive-change` |

For Codex CLI or IDE, invoke a Skill with its `$` form, for example
`$openspec-propose`; in the Codex desktop app, select the corresponding Skill.
Do not start `openspec-propose` merely because a request matches a routing
trigger; proposal creation requires the human confirmation checkpoint above. Do
not start `openspec-apply-change` merely because planning artifacts exist:
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

TDD is a development strategy for business-feature behavior with clear,
automatable boundaries; use Red-Green-Refactor when the Change's test plan finds
it appropriate. Documentation, workflow, configuration, generated-file,
dependency, and exploratory work must use verification proportionate to their
actual risks and must not manufacture failing tests, fixtures, or Red/Green
phases for process compliance. Product behavior changes still require focused
automated tests unless the owning test strategy records a justified exception.

Use OpenSpec's official validation commands for repository-owned artifacts:
`openspec schema validate taskpilot-sdd --verbose` for the project schema and
`openspec validate --all --strict --no-interactive` for active Changes and
specs. Do not add repository wrappers that duplicate OpenSpec's own workflow,
state-machine, generation, or validation behavior.

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

## Code Review Scope

A request to review, inspect, audit, or re-review code is read-only unless the
user explicitly asks to modify files. Do not turn review into implementation,
refactoring, cleanup, dependency changes, or redesign. A broader audit or
redesign scope must be explicitly requested; do not infer it from an ordinary
code-review request.

Review the selected diff and only the directly affected call paths, contracts,
tests, trust boundaries, and owning documentation needed to judge that diff.
Do not require unrelated pre-existing issues to be fixed unless the reviewed
change makes them reachable, depends on them, or materially worsens them. An
independently critical security, privacy, or data-loss issue may be reported
separately, but must be identified as pre-existing and must not silently expand
the current change's scope.

A blocking finding must satisfy all of the following:

1. It is introduced, worsened, or made reachable by the reviewed change.
2. It conflicts with current executable behavior, an approved requirement, or
   an applicable current architecture or contract.
3. It includes a concrete reachable trigger or failure path, not only a
   theoretical possibility.
4. It has material correctness, security, data, compatibility, reliability,
   performance, or maintainability impact beyond personal style preference.
5. It identifies a specific location and the smallest safe repair direction.

If an item does not meet that admission gate, do not present it as a blocking
finding. A useful nearby issue may be listed as an adjacent observation only
when it is clearly marked as pre-existing or non-blocking; it must not become an
implicit task for the current change. Omit formatting concerns handled by
automated tools, merge duplicate findings, and limit non-blocking suggestions
to the few highest-value items. Finding count is not a quality metric, and zero
findings is a valid review result.

Do not use Target or Proposed documentation as evidence that unimplemented
behavior is currently required. Do not recommend a new abstraction, shared
package, service, dependency, framework, or cross-project mechanism when a
local correction is complete and safe. Structural redesign requires an
approved architecture decision, multiple demonstrated use cases, repeated
defects caused by the current structure, or explicit user authorization.

Every review must state its review target and scope. For a Git diff, report the
base and head when available. Report in-scope and out-of-scope areas, blocking
findings, the few material non-blocking suggestions or adjacent observations,
checks actually run, and remaining unverified risks. Never imply that an
unexecuted check passed.

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
