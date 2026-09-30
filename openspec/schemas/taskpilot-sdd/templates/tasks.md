# Tasks

<!-- Create the smallest coherent task groups. If test-plan.md selects TDD for a
     business-feature slice, use Red/Green/Refactor tasks in that group. For all
     other work, list direct implementation and risk-matched verification tasks;
     do not manufacture TDD evidence. Update each slice's owning documents with
     that slice rather than deferring documentation. End with a model-drift and
     documentation-feedback reconciliation covering implemented evidence,
     Current/Target status, owner-document feedback, and delta-spec sync
     readiness. -->

## 1. <!-- Slice or Work Group Name -->

- [ ] 1.1 <!-- implementation step and its objective completion evidence -->
- [ ] 1.2 <!-- focused verification or next implementation step -->

## 2. <!-- Next Slice or Cross-Boundary Verification -->

- [ ] 2.1 <!-- implementation or broader risk-matched verification -->

## 3. Model and Documentation Reconciliation

- [ ] 3.1 Compare the approved model with implemented code, migrations, APIs,
  tests, and operational evidence; resolve or record every material drift.
- [ ] 3.2 Feed stable conclusions back to the owning business-model,
  architecture, child, and main-spec documents; reconcile Current/Target status
  or record the evidence-backed reason that no owner document changes.
- [ ] 3.3 Run the planned focused and affected checks and confirm delta-spec sync
  readiness before archive.
