#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/taskpilot-openspec-workflow.XXXXXX")"
before_changes="$(cd "$repo_root" && openspec list --json)"
cleanup() {
  rm -rf "$fixture"
}
trap cleanup EXIT

mkdir -p "$fixture/openspec/schemas" "$fixture/tools/openspec"
cp "$repo_root/openspec/config.yaml" "$fixture/openspec/config.yaml"
cp -R "$repo_root/openspec/schemas/taskpilot-sdd" "$fixture/openspec/schemas/taskpilot-sdd"
cp "$repo_root/tools/openspec/workspace-fingerprint.sh" "$fixture/tools/openspec/"
cp "$repo_root/tools/openspec/record-verification.sh" "$fixture/tools/openspec/"
cp "$repo_root/tools/openspec/archive-preflight.sh" "$fixture/tools/openspec/"
chmod +x "$fixture/tools/openspec/"*.sh

cd "$fixture"
openspec new change workflow-smoke --goal '验证 TaskPilot SDD workflow' --json > new-change.json
cat > openspec/changes/workflow-smoke/.openspec.yaml <<'YAML'
schema: taskpilot-sdd
created: 2026-09-28
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

使用 OpenSpec JSON 输出和仓库工具作为自动化结构证据。

## Risks / Trade-offs

- **[fixture 残留]** → shell trap 自动清理。

## Migration Plan

无需迁移。
MARKDOWN
cat > openspec/changes/workflow-smoke/test-plan.md <<'MARKDOWN'
# Test Plan

## Scope and Risk

仅验证 schema、instructions 和 review evidence 门禁。

## Scenario-to-Test Mapping

| Requirement / Scenario / Risk | Test Layer | Planned Automated Test | Why This Layer |
| --- | --- | --- | --- |
| workflow 语义 | tooling | `tools/openspec/test-workflow.sh` | 直接检查 CLI JSON 和门禁退出码 |

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

- [ ] 1.1 Run the isolated structural and evidence verification.
MARKDOWN

openspec status --change workflow-smoke --json > status.json
openspec instructions tasks --change workflow-smoke --json > tasks-instructions.json
openspec instructions apply --change workflow-smoke --json > apply.json
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
assert "test-plan" in apply["contextFiles"]
assert apply["state"] == "ready"
for token in ("Red:", "Green:", "Refactor:", "TDD-not-applicable"):
    assert token in apply["instruction"], token
for token in ("Red", "Green", "Refactor", "automated structural evidence"):
    assert token in tasks["instruction"], token

path = Path("openspec/changes/workflow-smoke/tasks.md")
path.write_text(path.read_text().replace("- [ ] 1.1", "- [x] 1.1", 1))
PY

openspec instructions apply --change workflow-smoke --json > apply-complete.json
python3 - <<'PY'
import json
from pathlib import Path

apply = json.loads(Path("apply-complete.json").read_text())
assert apply["state"] == "all_done"
assert apply["progress"]["remaining"] == 0
PY

receipt="openspec/changes/workflow-smoke/evidence/verification-report.json"
if output="$(tools/openspec/archive-preflight.sh workflow-smoke 2>&1)"; then
  echo 'Expected missing-receipt preflight to fail.' >&2
  exit 1
fi
grep -q 'verification receipt is missing' <<<"$output"

mkdir -p "$(dirname "$receipt")"
printf '{broken json\n' > "$receipt"
if output="$(tools/openspec/archive-preflight.sh workflow-smoke 2>&1)"; then
  echo 'Expected malformed-receipt preflight to fail.' >&2
  exit 1
fi
grep -q 'malformed verification receipt' <<<"$output"
printf '[]\n' > "$receipt"
if output="$(tools/openspec/archive-preflight.sh workflow-smoke 2>&1)"; then
  echo 'Expected structurally malformed receipt preflight to fail.' >&2
  exit 1
fi
grep -q 'top level must be an object' <<<"$output"
rm -f "$receipt"

cat > self-review-report.json <<'JSON'
{
  "reviewer": {"kind": "self", "identity": "workflow-test-implementer"},
  "reviewedAt": "2026-09-28T00:00:00Z",
  "commands": [{"command": "openspec validate workflow-smoke --strict --no-interactive", "result": "pass"}],
  "findings": [],
  "notVerified": [],
  "verdict": "ready"
}
JSON
if output="$(tools/openspec/record-verification.sh workflow-smoke self-review-report.json 2>&1)"; then
  echo 'Expected self-review receipt recording to fail.' >&2
  exit 1
fi
grep -q 'Only an independent reviewer report' <<<"$output"

cat > failed-command-report.json <<'JSON'
{
  "reviewer": {"kind": "independent", "identity": "workflow-test-reviewer"},
  "reviewedAt": "2026-09-28T00:00:00Z",
  "commands": [{"command": "fixture verification command", "result": "fail"}],
  "findings": [],
  "notVerified": [],
  "verdict": "ready"
}
JSON
tools/openspec/record-verification.sh workflow-smoke failed-command-report.json > /dev/null
if output="$(tools/openspec/archive-preflight.sh workflow-smoke 2>&1)"; then
  echo 'Expected failed verification command preflight to fail.' >&2
  exit 1
fi
grep -q 'verification commands did not pass' <<<"$output"

cat > blocking-report.json <<'JSON'
{
  "reviewer": {"kind": "independent", "identity": "workflow-test-reviewer"},
  "reviewedAt": "2026-09-28T00:00:00Z",
  "commands": [{"command": "openspec validate workflow-smoke --strict --no-interactive", "result": "pass"}],
  "findings": [{"severity": "CRITICAL", "message": "fixture blocker"}],
  "notVerified": [],
  "verdict": "not_ready"
}
JSON
tools/openspec/record-verification.sh workflow-smoke blocking-report.json > /dev/null
if output="$(tools/openspec/archive-preflight.sh workflow-smoke 2>&1)"; then
  echo 'Expected blocking finding preflight to fail.' >&2
  exit 1
fi
grep -q 'verdict is not ready' <<<"$output"
grep -q 'CRITICAL findings remain' <<<"$output"

cat > not-verified-report.json <<'JSON'
{
  "reviewer": {"kind": "independent", "identity": "workflow-test-reviewer"},
  "reviewedAt": "2026-09-28T00:00:00Z",
  "commands": [{"command": "openspec validate workflow-smoke --strict --no-interactive", "result": "pass"}],
  "findings": [],
  "notVerified": [{"check": "fixture check", "applicable": true, "reason": "fixture evidence intentionally absent"}],
  "verdict": "ready"
}
JSON
tools/openspec/record-verification.sh workflow-smoke not-verified-report.json > /dev/null
if output="$(tools/openspec/archive-preflight.sh workflow-smoke 2>&1)"; then
  echo 'Expected applicable Not verified preflight to fail.' >&2
  exit 1
fi
grep -q 'applicable checks remain Not verified' <<<"$output"

cat > warning-report.json <<'JSON'
{
  "reviewer": {"kind": "independent", "identity": "workflow-test-reviewer"},
  "reviewedAt": "2026-09-28T00:00:00Z",
  "commands": [{"command": "openspec validate workflow-smoke --strict --no-interactive", "result": "pass"}],
  "findings": [{"severity": "WARNING", "message": "unaccepted fixture warning", "acceptedNonBlocking": false}],
  "notVerified": [],
  "verdict": "ready"
}
JSON
tools/openspec/record-verification.sh workflow-smoke warning-report.json > /dev/null
if output="$(tools/openspec/archive-preflight.sh workflow-smoke 2>&1)"; then
  echo 'Expected unaccepted WARNING preflight to fail.' >&2
  exit 1
fi
grep -q 'WARNING findings are not accepted' <<<"$output"

cat > ready-report.json <<'JSON'
{
  "reviewer": {"kind": "independent", "identity": "workflow-test-reviewer"},
  "reviewedAt": "2026-09-28T00:00:00Z",
  "commands": [{"command": "openspec validate workflow-smoke --strict --no-interactive", "result": "pass"}],
  "findings": [{"severity": "SUGGESTION", "message": "non-blocking fixture suggestion"}],
  "notVerified": [{"check": "product behavior", "applicable": false, "reason": "tooling-only fixture"}],
  "verdict": "ready"
}
JSON
tools/openspec/record-verification.sh workflow-smoke ready-report.json > /dev/null
output="$(tools/openspec/archive-preflight.sh workflow-smoke)"
grep -q 'Archive preflight passed' <<<"$output"

echo 'fingerprint mutation' > tracked-after-review.txt
if output="$(tools/openspec/archive-preflight.sh workflow-smoke 2>&1)"; then
  echo 'Expected stale-fingerprint preflight to fail.' >&2
  exit 1
fi
grep -q 'workspace fingerprint changed after review' <<<"$output"

cd "$repo_root"
after_changes="$(openspec list --json)"
[[ "$before_changes" == "$after_changes" ]] || {
  printf 'Active repository changes were modified by the workflow test.\n' >&2
  exit 1
}

printf '%s\n' \
  'PASS default schema and test-plan graph' \
  'PASS tasks/apply TDD guidance and strict fixture validation' \
  'PASS missing, malformed, self-review, failed-command, blocking, warning, Not verified, ready, and stale receipt paths' \
  'PASS fixture cleanup is armed and active repository changes are unchanged'
