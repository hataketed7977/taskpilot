# Web Testing Strategy

- **Status:** Target
- **Owns:** Frontend test layers, browser-test boundaries, behavior coverage,
  and quality gates
- **Read after:** [`../../../docs/business-model.md`](../../../docs/business-model.md),
  [`architecture.md`](architecture.md),
  [`responsibilities.md`](responsibilities.md)
- **Mandatory before:** Implementing or changing frontend behavior

## Testing Principles

Use the cheapest realistic test that can reliably prove the behavior:

- Pure rules stay outside React and receive fast unit tests.
- A frontend module is normally integrated in Vitest with React Testing Library
  and MSW at the HTTP boundary.
- A real browser is used when browser behavior is material to the risk.
- Only a small set of business-critical journeys crosses the running Web,
  Gateway, Core API, and PostgreSQL boundaries.
- A broader test must not duplicate every assertion already owned by a narrower
  test.

Tests optimize for defect detection and diagnosis, not for maximizing a single
coverage percentage. Coverage may be recorded as a trend after initialization,
but generated code must not add low-value tests solely to reach a repository-wide
number.

## Browser Tool Decision

Cypress is the standard browser-test runner for TaskPilot and reflects the
team's preferred workflow. It is used for end-to-end tests and for the small
number of component or interaction tests that require a real browser.

Cypress does not replace Vitest, React Testing Library, or MSW. Most frontend
integration tests need a rendered module, Query and router providers, and a
controlled HTTP boundary; they do not need a deployed system or a real browser.
Keeping those tests in the fast default suite gives clearer failures and avoids
building two overlapping component-test suites.

Cypress Component Testing is therefore opt-in rather than the initial default.
Adopt it for a component or interaction when jsdom cannot faithfully exercise
layout, drag/drop, focus, portals, browser observers, or another browser API.
When it is enabled, reuse the application's real providers and avoid recreating
a second testing architecture.

The project follows Cypress's documented distinction between
[testing types](https://docs.cypress.io/app/core-concepts/testing-types) and its
[best practices](https://docs.cypress.io/app/core-concepts/best-practices).
Exact compatible packages and browser support are selected when the Web project
is initialized.

## Development Loop

Use RED-GREEN-REFACTOR for behavior changes:

1. Add the smallest failing test at the lowest layer that proves the behavior.
2. Implement the behavior.
3. Refactor without broadening the behavior.
4. Run the focused test, related page or module tests, then required project
   checks.
5. Add or update a Cypress test only when the change affects a browser-specific
   behavior or a declared critical journey.

Exact commands must be added here when the Web toolchain is initialized. Do not
invent commands before package scripts exist.

## Test Layers

| Layer | Planned tool | Covers |
| --- | --- | --- |
| Pure unit | Vitest | Models, schemas, policies, calculations, and DTO transformations that need no rendered UI |
| Module/component integration | Vitest, React Testing Library, and MSW | Components, Hooks, Query, router state, API adapters, and user-visible behavior through a controlled HTTP boundary |
| Browser interaction | Cypress Component Testing, by exception | Drag/drop, focus, portals, responsive layout, observers, and other behavior for which jsdom is not trustworthy |
| Contract | OpenAPI generation plus TypeScript check | Web client compatibility with the Web API |
| Architecture | ESLint boundaries plus cycle check | Forbidden imports, deep imports, and dependency cycles |
| System end-to-end | Cypress | A few critical workflows through the running Web, Gateway, Core API, and PostgreSQL |
| Accessibility | Semantic assertions plus targeted automated scans | Key components and journeys; automated checks complement rather than replace manual review |

“Integration test” must be qualified as module/component, browser interaction,
API, or system integration. It must not be used as a synonym for every Cypress
test.

## Required Behavioral Coverage

- Query loading, success, empty, error, and retry behavior.
- Mutation pending, validation failure, success, and cache invalidation.
- Session expiry and denied-access handling.
- Workspace or Project switching cancels obsolete work and never renders stale
  cross-scope data, including late responses and optimistic state.
- Board drag/drop resulting in the intended typed workflow or Work Item action.
- Board and Work Item Type definition editor validation, including mapping server
  diagnostics to the correct editor path.
- Version-conflict and idempotent retry behavior for affected mutations.
- Server-provided action capabilities hide or disable presentation controls
  without replacing negative authorization tests in the backend.
- Agent Run SSE updates are Workspace-scoped, reconnect through an
  authoritative reload, ignore stale run/attempt updates, and fall back to
  bounded backoff polling when streaming is unavailable.
- Dialog and Sheet focus, keyboard, and dismissal behavior.
- Responsive layouts at supported desktop and mobile widths.

These cases need not all exist at every layer. For example, the complete
permission matrix belongs to Core API integration tests; the Web proves how a
representative denied response is presented and a system E2E proves only the
critical trust path.

## Module and Component Test Rules

- Test observable behavior rather than component implementation details.
- Prefer queries by role, label, and accessible name.
- Keep fixtures small and owned by the relevant page or domain module.
- Pure tests run without React, a router, Query, or network mocks.
- API adapter tests prove meaningful DTO transformations and normalized error
  behavior; identity mapping does not require a duplicate frontend model or
  duplicate test.
- Render a cohesive module with its real internal Hooks and components. Mock the
  HTTP boundary with MSW rather than mocking internal Hooks or API functions.
- A component test may replace another module's public boundary but must not
  deep-mock the module under test.
- Do not use snapshots as the primary assertion for workflows.
- Control time, randomness, generated identifiers, and Query retry behavior.
- Failed mutations must prove that optimistic state is reverted when used.
- Test provider helpers must construct a fresh Query client, router state, and
  handlers per test so state cannot leak between cases.

## Cypress Rules

- Each test is independent and can run alone or in any order.
- Prepare scenario state through controlled APIs or test fixtures, not by
  repeating registration, Workspace creation, and Project creation through the
  UI in every test. Test-only setup capabilities must not be exposed in
  production.
- Use the UI for the action under test; setup through an API must not bypass the
  authorization or business rule being asserted.
- Prefer role, label, and accessible-name selectors. Add a stable `data-cy`
  selector only where no durable semantic selector exists. Never couple tests to
  generated CSS classes or DOM depth.
- Never use fixed sleeps. Wait for an intercepted request, URL, element state,
  or another observable condition and rely on Cypress's retry semantics.
- Use network interception to observe or control an owned boundary in browser
  interaction tests. A system E2E must not stub the Gateway or Core API behavior
  whose integration it claims to prove.
- Retries may reduce infrastructure flakiness but must not be used to hide a
  deterministic failure. Repeatedly flaky tests are fixed or quarantined with
  an owner and expiry, never silently ignored.
- CI retains useful failure evidence such as screenshots, video when enabled,
  browser console output, and relevant service logs without leaking secrets.

## Architecture Regression Tests

When the toolchain is initialized:

- Configure `eslint-plugin-boundaries` with deny-by-default policies for `app`,
  pages, domain modules, global infrastructure, and module internals.
- Boundary lint is blocking, not advisory.
- Treat page-to-page imports, module-to-page imports, cross-owner deep imports,
  model-to-React imports, Component-to-API imports, and direct `fetch` outside
  `api/client.ts` as lint errors.
- The architecture fixture set contains allowed and forbidden import examples.
- At minimum, fixtures prove that models cannot import React, Components cannot
  import module API adapters, pages cannot import other pages, modules cannot
  import pages, external owners cannot deep-import module internals, and the
  declared module-to-module dependency graph has no forbidden edge or cycle.
- The dependency graph must be cycle-free.
- Run boundary lint and cycle checks locally and in CI.
- Any intentional new dependency direction updates
  [`architecture.md`](architecture.md) and the lint fixtures in the same
  change.

Exact compatible package versions, the cycle-check implementation, and focused
commands are recorded here only after executable package scripts exist.

## System End-to-End Scope

Initial critical journeys:

1. Login and select a Project.
2. View a Board and open a Work Item.
3. Create or edit a Work Item.
4. Move a card through an allowed transition.
5. Assign a Work Item to a User or Agent.
6. Create or update a custom Agent.

Prefer composing related steps into a few meaningful journeys rather than one
large E2E test per requirement. Assertions focus on the cross-boundary outcome;
detailed validation, error matrices, pagination, and authorization combinations
remain in Web module, Gateway, and Core API integration suites.

Third-party identity, model, and Agent providers may be replaced at the owned
system boundary with deterministic test doubles. The running TaskPilot Web,
Gateway, Core API, and PostgreSQL are real for a system E2E unless the test name
and suite explicitly declare a narrower scope.

## Execution and Browser Matrix

- The local loop runs the focused unit or module test first; browser tests run
  when the risk requires them.
- Pull requests block on the fast Web suite, contract and architecture checks,
  and the relevant Cypress critical-path checks.
- Main and release validation run the complete critical-path suite against the
  supported browser matrix.
- Start pull-request E2E with one primary browser. Before release, cover critical
  journeys in at least Chromium and Firefox when both are in the product's
  declared support matrix.
- Safari or WebKit coverage is a product support decision. At initialization,
  verify Cypress's then-current stable support instead of assuming parity or
  adding another runner without an explicit decision.
- Nightly tests may broaden data or browser combinations, but no essential
  security, contract, migration, or critical-journey test may exist only in a
  nightly suite.

## Coverage and Defect-Detection Gates

The repository-wide coverage floors and exception policy are defined in the
[root architecture](../../../docs/architecture.md#coverage-and-effectiveness-policy).
For the Web specifically:

- Collect line and branch coverage from the Vitest unit and module/component
  integration suites over hand-written production TypeScript and TSX.
- Do not use Cypress execution coverage to justify missing Vitest integration
  tests or combine Cypress journey coverage into a misleading single number.
  Cypress is evaluated by declared critical journeys, browser risks, and pass
  evidence.
- Generated OpenAPI transport types and generated client code are excluded.
  Pages, domain modules, Hooks, API adapters with behavior, error boundaries,
  and cache coordination remain production code for coverage purposes.
- Changed authentication/session handling, Workspace or Project cache scoping,
  optimistic update and rollback, permission presentation, SSE reconnect/fallback termination,
  and definition-editor diagnostic mapping are critical branches under the
  higher repository threshold.
- Every important UI state machine has named success, empty, rejection/error,
  retry or recovery, and stale-response cases as applicable. Rendering the
  happy path alone is not adequate behavior coverage.
- A Cypress critical-journey inventory records the user outcome and owned
  boundaries each journey proves. Adding more E2E steps is not a substitute for
  missing branch or module behavior tests.
- Targeted mutation analysis may be applied to pure frontend policies and
  reducers with critical branching; it is not applied indiscriminately to
  generated code or presentational markup.

## Quality Gates

Once initialized, a frontend change is incomplete until:

- Focused tests and the affected module or page suite pass.
- Applicable changed-code coverage, critical-branch coverage, and whole-Web
  non-regression gates pass.
- TypeScript strict checks pass.
- Lint and formatting checks pass.
- Architecture boundary and cycle checks pass.
- Relevant accessibility assertions pass.
- Contract generation and type checks pass when the Web API changes.
- The relevant Cypress check passes when a browser-specific behavior or
  declared critical journey changes.
