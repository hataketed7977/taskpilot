#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/taskpilot-openspec-workflow.XXXXXX")"
before_changes="$(cd "$repo_root" && openspec list --json)"
cleanup() {
  rm -rf "$fixture"
}
trap cleanup EXIT

mkdir -p "$fixture/openspec/schemas"
cp "$repo_root/openspec/config.yaml" "$fixture/openspec/config.yaml"
cp -R "$repo_root/openspec/schemas/taskpilot-sdd" "$fixture/openspec/schemas/taskpilot-sdd"

cd "$fixture"
openspec new change workflow-smoke --goal '验证 TaskPilot SDD workflow' --json > new-change.json
cat > openspec/changes/workflow-smoke/.openspec.yaml <<'YAML'
schema: taskpilot-sdd
created: 2026-09-29
goal: 验证 TaskPilot SDD workflow
skip_specs: true
YAML
cat > openspec/changes/workflow-smoke/proposal.md <<'MARKDOWN'
# Proposal

## Why

验证项目默认 SDD schema 的语义契约。

## What Changes

- 仅验证临时工具 fixture。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。

## Impact

无产品影响，fixture 会被自动删除。
MARKDOWN
cat > openspec/changes/workflow-smoke/design.md <<'MARKDOWN'
# Design

## Context

这是一次性工具 fixture。

## Goals / Non-Goals

**Goals:** 验证 workflow 语义。

**Non-Goals:** 不实现产品行为。

## Decisions

使用 OpenSpec JSON 输出作为自动化结构证据。

## Risks / Trade-offs

- **[fixture 残留]** → shell trap 自动清理。

## Migration Plan

无需迁移。
MARKDOWN
cat > openspec/changes/workflow-smoke/test-plan.md <<'MARKDOWN'
# Test Plan

## Scope and Risk

仅验证 schema、instructions 和严格校验。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Test Layer | Planned Automated Test | Why This Layer |
| --- | --- | --- | --- |
| workflow 语义 | tooling | `tools/openspec/test-workflow.sh` | 直接检查 CLI JSON 和退出码 |

## TDD Slices

无产品行为切片。

## Verification Commands

### Focused

- `tools/openspec/test-workflow.sh`: 验证 workflow。

### Affected and Cross-Boundary

- `openspec validate workflow-smoke --strict --no-interactive`: 严格结构校验。

## Exceptions and Manual Evidence

工具类 smoke test 不适用产品行为 TDD；使用自动化 fixture 作为替代证据，无人工验收。
MARKDOWN
cat > openspec/changes/workflow-smoke/tasks.md <<'MARKDOWN'
# Tasks

## 1. TDD-Not-Applicable Tooling Check

- [ ] 1.1 Run the isolated structural verification.
MARKDOWN

openspec status --change workflow-smoke --json > status.json
openspec instructions tasks --change workflow-smoke --json > tasks-instructions.json
openspec instructions apply --change workflow-smoke --json > apply.json
openspec schema validate taskpilot-sdd --verbose > schema-validation.txt
openspec validate workflow-smoke --strict --no-interactive > strict-validation.txt

python3 - <<'PY'
import json
from pathlib import Path

created = json.loads(Path("new-change.json").read_text())
status = json.loads(Path("status.json").read_text())
tasks = json.loads(Path("tasks-instructions.json").read_text())
apply = json.loads(Path("apply.json").read_text())
assert created["change"]["schema"] == "taskpilot-sdd"
assert status["schemaName"] == "taskpilot-sdd"
assert any(item["id"] == "test-plan" for item in status["artifacts"])
assert status["artifactPaths"]["specs"]["existingOutputPaths"] == []
assert "test-plan" in apply["contextFiles"]
assert apply["state"] == "ready"
for token in ("Red:", "Green:", "Refactor:", "TDD-not-applicable"):
    assert token in apply["instruction"], token
for token in ("Red", "Green", "Refactor", "automated structural evidence"):
    assert token in tasks["instruction"], token
assert "focused and affected automated checks" in apply["instruction"]
assert "delta spec sync and archive" in apply["instruction"]
assert "independent read-only openspec-verify-change review before archive" not in apply["instruction"]
PY

python3 - <<'PY'
from pathlib import Path
path = Path("openspec/changes/workflow-smoke/tasks.md")
path.write_text(path.read_text().replace("- [ ] 1.1", "- [x] 1.1"))
PY
openspec instructions apply --change workflow-smoke --json > apply-complete.json
python3 - <<'PY'
import json
from pathlib import Path
apply = json.loads(Path("apply-complete.json").read_text())
assert apply["state"] == "all_done"
assert apply["progress"] == {"total": 1, "complete": 1, "remaining": 0}
PY

cd "$repo_root"
after_changes="$(openspec list --json)"
[[ "$before_changes" == "$after_changes" ]] || {
  printf 'Active repository changes were modified by the workflow test.\n' >&2
  exit 1
}

printf '%s\n' \
  'PASS default schema and test-plan graph' \
  'PASS tasks/apply TDD guidance without mandatory verify handoff' \
  'PASS strict fixture and schema validation' \
  'PASS fixture cleanup is armed and active repository changes are unchanged'
