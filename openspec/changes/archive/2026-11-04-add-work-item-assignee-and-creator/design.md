# Design

## Context

See `proposal.md` for motivation. Current executable state already stores `project.work_items.created_by_user_id`, and Project membership/User tables already contain the data needed to render creator and Project Members. Current checked-in canonical OpenAPI, generated Core HTTP interfaces, Gateway route manifest, and Desktop transport shapes (`WorkItemView`, `CardView`) omit creator and assignee; `CreateWorkItemCommand` and `EditWorkItemCommand` only carry title/description plus Board/Placement context. Current Project Membership role is only `OWNER`, and there is no member-list endpoint. Card remains a Work Item + Board Placement projection, and current Work Item has no lifecycle/status/history capability.

Desktop is Electron + React with typed Main/Preload contracts. Renderer UI work must keep the existing TaskPilot visual language and follow Desktop skill routing during Apply: use `frontend-design` before reshaping the detail/card experience, `vercel-react-best-practices` while implementing React changes, and `web-design-guidelines` for final UI/accessibility review.

## Goals / Non-Goals

**Goals:**

- Add creator display and current optional assignee to the authoritative Work Item contract and Card projection.
- Keep assignee extensible for future Project Agent Binding without exposing current Agent selection.
- Enforce membership eligibility in Core API, not only in Desktop UI.
- Give Desktop a stable, professional responsibility layout: low-noise Card avatar, editable assignee property, immutable creator/timestamp audit footer, capped searchable member picker, and accessible failure/retry states.
- Keep this slice compatible with a later revision-history Change by centralizing Work Item mutation paths and avoiding UI-only activity logs.

**Non-Goals:**

- No durable revision history, Activity timeline, point-in-time query, compare, or restore version.
- No Project member management, invitations, role editing, member removal, or Project outside-user search.
- No Agent picker, Project Agent Binding persistence, Agent assignment behavior, Workflow start, or AgentRun creation.
- No multiple assignees, watchers, labels, due dates, priority, lifecycle/status, comments, notification, or realtime sync.
- No generated public client SDK, external compatibility baseline, or Desktop-specific API surface; this slice updates the current canonical `/v1` contract only.

## Business Model

Methods used: relationship map for Work Item/Assignment/Card/Project Member, concrete examples for create/edit/read failures, a small decision tree for responsibility scope, and trust-boundary review for membership eligibility.

- **Identity and ownership:** Work Item owns responsibility. Card continues to reuse `workItemId` and combines Work Item content/current assignee with Board Placement. Project Membership remains the human target identity for current assignment; User summary is display data, not the assignment identity.
- **Cardinality:** exactly zero or one current assignee per Work Item in this slice. `null` is the only unassigned state. A Project Member can be assignee for many Work Items.
- **Target type invariant:** current target type is `PROJECT_MEMBER` only. API shapes include `targetType` so a future `PROJECT_AGENT_BINDING` can be added without renaming `assigneeUserId` fields. Current validation rejects unsupported target types.
- **Creator invariant:** `createdBy` is immutable and comes from existing `created_by_user_id`. Creator and assignee are separate: assigning the creator, replacing the assignee, or clearing assignee never changes creator.
- **Authorization and tenant scope:** existing OWNER-only mutation stays unchanged. Candidate reads use `GET /v1/projects/{projectId}/members`, and Core API derives Workspace/Project scope from persisted Project ownership; assignee writes validate the Work Item Project against the target membership Project. Non-member, inactive user, wrong Project, wrong Workspace, and unknown membership are rejected without leaking other Project membership.
- **Version/history:** assignee changes are Work Item mutations and increment Work Item version/`updatedAt`. They do not change Board/Placement version unless the same existing edit request also performs a Placement change. This Change intentionally does not create durable historical records.
- **Concurrency and recovery:** stale expected Work Item version rejects the entire mutation. Desktop keeps current detail open, does not write failed assignee into Card, and reconciles against authoritative Work Item/Board responses under existing session/Board generation fencing.
- **Picker scale:** Desktop does not render the full Project member list as a people wall. The default menu shows at most 6 Project Members plus an overflow hint; searched results show at most 8 matches plus a narrow-more-results hint. The menu remains scrollable only as a viewport safety fallback.

## Decisions

1. **Model assignee as a current Work Item target, not Card-local state.**
   - Decision: persist the current assignee on the Work Item side and project it into Board Card responses.
   - Rationale: Card has no independent identity; responsibility should not diverge across Boards containing the same Work Item.
   - Alternatives: Card-local assignee was rejected because it duplicates Work Item truth and creates inconsistent multi-Board behavior. Separate multi-row Assignment table was considered but is heavier than the current single-assignee slice and risks implying multiple assignments/slots.
   - Test seam: Core API application tests read the same Work Item through multiple Boards and verify assignee consistency while Placement versions remain independent.

2. **Use an extensible nullable target shape.**
   - Decision: transport uses `assignee: null | { targetType: 'PROJECT_MEMBER', projectMemberId, user }`. Persistence for this Change adds nullable `assignee_target_type` and `assignee_project_membership_id` columns on `project.work_items`; no separate current-assignment table is introduced. The valid current states are exactly: both columns `NULL` for unassigned, or `assignee_target_type = 'PROJECT_MEMBER'` with `assignee_project_membership_id NOT NULL` for a Project Member assignee. Database constraints must reject any other combination and reject unsupported target types. `assignee_project_membership_id` references the assignee's Project Membership through a Project-scoped relationship, using a composite FK from `(project_id, assignee_project_membership_id)` to `project.project_memberships(project_id, id)` and adding the required supporting unique constraint on `(project_id, id)` if PostgreSQL needs it. Current code must not expose `assigneeUserId` as the durable contract.
   - Future extension: a later Agent-assignment Change can add a nullable `assignee_project_agent_binding_id` column and extend the check/FK set so `PROJECT_MEMBER` requires membership id and no agent binding id, while `PROJECT_AGENT_BINDING` requires agent binding id and no membership id. This Change only reserves the typed target shape and rejects Agent targets.
   - Rationale: target type makes future Agent Binding explicit while keeping current UI simple. A membership id captures Project membership identity better than raw User id, and the composite FK prevents cross-Project assignment at the data boundary.
   - Alternatives: raw `assignee_user_id` was rejected because it cannot prove Project membership by FK and makes future Agent target awkward. A polymorphic target id without typed nullable columns was rejected because it weakens database constraints. A separate one-row current assignment table was rejected for this slice because the approved model has a single nullable current assignee and does not need assignment history yet.
   - Test seam: migration/schema tests verify FK/check constraints, the unassigned null/null state, unsupported target-type rejection, cross-Project membership rejection, and non-member rejection; OpenAPI tests freeze the union/null schema.

3. **Expose creator as `PersonSummary`, not as a mutable field.**
   - Decision: detail and mutation responses include `createdBy` with `userId`, `displayName`, optional `avatarUrl`; create/edit requests do not accept creator.
   - Rationale: DB already has the creator FK; UI needs readable attribution without allowing mutation.
   - Alternatives: exposing only `createdByUserId` was rejected as insufficient for UI and would force Desktop to fetch users separately.
   - Test seam: create/detail/edit HTTP tests assert creator remains stable after assignee changes.

4. **Add a canonical Project Member read API, not a general member management feature.**
   - Decision: add a canonical `GET /v1/projects/{projectId}/members` endpoint/use case for current Project members used by the assignee picker. It returns active Project Memberships with User summaries and roles, sorted deterministically by normalized display name ascending, then `projectMemberId` ascending; the contract requires stable ordering but does not promise locale-specific collation. It does not invite, remove, search outside the Project, or edit roles.
   - Rationale: picker needs authoritative candidates, and server must own eligibility. Current MVP may return only the OWNER, but the contract remains generic.
   - Alternatives: deriving candidates on Desktop from current user/session was rejected because it hard-codes single-user MVP and blocks future team Projects. Adding full member management was rejected as out of scope.
   - Test seam: Core API HTTP tests prove cross-Project users are absent; Desktop Renderer tests can mock the candidate API.

5. **Integrate assignment mutation with existing Work Item edit response.**
   - Decision: extend the current Work Item edit command/request to accept optional assignee intent in addition to title/description and existing optional Placement context, while preserving atomic rollback. The request must distinguish “leave unchanged” from “clear assignee”; use an explicit assignee patch object or field-presence semantics in the transport rather than overloading omitted/null ambiguously.
   - Rationale: one authoritative mutation path preserves versioning, board reconciliation, and pending-intent recovery. The UI can submit assignee-only edits by sending unchanged title/description plus explicit assignee patch, or by using a narrow endpoint if implementation finds the existing HTTP shape too ambiguous; either way response remains `WorkItem + Board`.
   - Alternatives: separate assignee endpoint simplifies payloads but risks duplicating version/conflict/Board reconciliation. It is acceptable only if it shares the same application service and test matrix.
   - Test seam: application tests cover assignee-only, content+assignee, and content+Placement+assignee atomicity.

6. **Default create to unassigned.**
   - Decision: create forms do not silently assign the creator. If a future UI chooses to preselect the current user, it must submit that explicit assignee and include it in idempotency payload.
   - Rationale: creator and responsible owner are different business facts; defaulting to creator hides that distinction.
   - Alternatives: default-to-creator was considered for personal MVP convenience but rejected because it creates misleading responsibility and makes “unassigned” less meaningful.
   - Test seam: create tests assert omitted assignee returns `null`.

7. **UI layout: low-noise Card, editable assignee property, immutable audit footer.**
   - Decision: Card face uses a fixed-height content frame: title and description each occupy bounded two-line slots, and an assigned member appears as an avatar-only marker fixed at the top-right without entering document flow; assigned, unassigned, short, and long-content Cards therefore keep identical geometry. Detail keeps the assignee as the only editable property row near the title/description, while immutable creator and compact created/updated timestamps share the bottom audit footer. Long titles/descriptions retain the existing stable editing behavior. If the user requests the assignee picker while a dirty title or description is active, Desktop records an assignee-open pending intent, saves the active draft once, and opens/focuses the picker only after the authoritative save succeeds; validation, temporary failure, or conflict keeps the picker closed and preserves the draft/recovery path.
   - Rationale: common card products keep Board cards scannable and put ownership controls in detail/sidebar. This avoids clutter and preserves the prior detail editing fixes.
   - Alternatives: showing creator and assignee on Card was rejected as noisy; putting assignee as another inline editable text field was rejected because it behaves like a selector with async candidates and errors.
   - Test seam: reducer, Renderer, and Cypress tests cover equal Card height across assigned/unassigned and short/long content, top-right avatar geometry, title/description clamping, keyboard picker flow, hover/focus affordance, creator/timestamp footer alignment, dirty-field save-first sequencing, failure recovery, and no regression to title/description edit geometry.

8. **No historical messages in this Change.**
   - Decision: no activity feed or synthetic local log is created. Implementation should keep mutation code cohesive so a future revision log can wrap old/new versioned state cleanly.
   - Rationale: history needs a separate revision-first design for field expansion and point-in-time query.
   - Alternatives: simple “Alice changed assignee” messages were rejected because they cannot support accurate future rollback/query and would create a misleading audit impression.
   - Test seam: OpenAPI/route tests ensure no history/versions endpoints are introduced by this Change.

## Risks / Trade-offs

- [Risk] DB cannot express “membership belongs to same Project as Work Item” with a simple nullable FK if using only membership id → use composite unique `(project_id, id)` on `project_memberships` and composite FK from Work Item assignee columns, or use a current-assignment table with composite FK; migration tests inspect constraints.
- [Risk] Nullable/union assignee payload blurs clear vs unchanged → define explicit request semantics and test assignee-only, clear, and no-change cases at HTTP and Desktop contract layers.
- [Risk] Current MVP has only OWNER member, so implementation may accidentally hard-code current user → candidate API and tests must insert multiple users/members in Project-scoped fixtures and assert ordering/eligibility.
- [Risk] Creator/assignee User display data can drift if a user later changes name/avatar → current response reads latest User summary; durable display snapshots are deferred to future audit/history design and not claimed here.
- [Risk] Detail metadata and picker could reintroduce layout jitter after prior Work Item detail fixes → frontend-design plan during Apply must reserve metadata area, and Cypress/Renderer tests verify opening picker, saving, errors, and reduced-motion states without title/description geometry regressions.
- [Risk] Assignee mutation and Card movement share existing edit path, increasing atomicity complexity → keep a single application transaction and add rollback tests for invalid assignee combined with content/Placement edits.
- [Risk] Future Agent support could be constrained by current naming → use `targetType` and target-specific fields in contracts and docs; reject unsupported target types now rather than silently ignoring them.

## Migration Plan

1. Planning phase: complete this Change's proposal/spec/design/test-plan/tasks and validate strictly.
2. Canonical contract slice: update `contracts/canonical-api/openapi.yaml` with assignee/person schemas, `GET /v1/projects/{projectId}/members`, and ingress metadata; verify generated Core interfaces and Gateway route manifest rather than hand-writing Gateway routes.
3. Persistence/API slice: add migration/schema changes for current assignee, expose `createdBy`, add Project Member list use case/API, and update Work Item create/edit/detail/Board queries.
4. Desktop contract slice: update Desktop Main transport types/parsers, shared TypeScript contracts and fixtures against the canonical HTTP shapes.
5. Renderer/UI slice: after `frontend-design`, implement Card avatar, assignee property, creator/timestamp audit footer, member picker states, i18n, and focused tests; use React best-practice guidance during component/query changes.
6. Documentation slice: update root business/architecture if Current statements change, plus Core API and Desktop local docs; run model/docs drift audit before archive.
7. Verification: run focused Core API, Desktop contract/renderer/Cypress checks, `openspec validate --all --strict --no-interactive`, and affected quality gates named in `test-plan.md`.

Rollback strategy: before release, ordinary Git revert and database reset are sufficient for local disposable data. After any release with persistent data, rollback requires a follow-up migration decision because dropping assignee columns/table would lose current responsibility assignments; do not claim automatic rollback for production data.

## Open Questions

None. 用户已确认先拆出历史版本能力；本 Change 的 defaults 是单责任人、默认未分配、当前只选 Project Member、Agent 只预留模型。
