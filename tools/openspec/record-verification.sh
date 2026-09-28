#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s <change-name> <review-report.json>\n' "$0" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
change_name="$1"
report_path="$2"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
change_root="$repo_root/openspec/changes/$change_name"
receipt_path="$change_root/evidence/verification-report.json"

[[ -d "$change_root" ]] || { printf 'Change not found: %s\n' "$change_name" >&2; exit 1; }
[[ -f "$report_path" ]] || { printf 'Review report not found: %s\n' "$report_path" >&2; exit 1; }

apply_json="$(cd "$repo_root" && openspec instructions apply --change "$change_name" --json)"
python3 -c '
import json, sys
value=json.load(sys.stdin)
progress=value.get("progress", {})
if progress.get("remaining") != 0 or value.get("state") != "all_done":
    raise SystemExit("Change tasks are not complete; refusing to record verification.")
' <<<"$apply_json"

fingerprint="$($repo_root/tools/openspec/workspace-fingerprint.sh)"
mkdir -p "$(dirname "$receipt_path")"
temporary="$receipt_path.tmp.$$"
trap 'rm -f "$temporary"' EXIT

python3 - "$change_name" "$report_path" "$fingerprint" "$temporary" <<'PY'
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

change_name, source_path, fingerprint, output_path = sys.argv[1:]
source = json.loads(Path(source_path).read_text())
if not isinstance(source, dict):
    raise SystemExit("Review report top level must be an object.")

required = {"reviewer", "reviewedAt", "commands", "findings", "notVerified", "verdict"}
missing = sorted(required - source.keys())
if missing:
    raise SystemExit(f"Review report is missing fields: {', '.join(missing)}")

reviewer = source["reviewer"]
if not isinstance(reviewer, dict) or reviewer.get("kind") != "independent":
    raise SystemExit("Only an independent reviewer report can create a verification receipt.")
if not isinstance(reviewer.get("identity"), str) or not reviewer["identity"].strip():
    raise SystemExit("reviewer.identity must be a non-empty string.")

try:
    reviewed_at = dt.datetime.fromisoformat(source["reviewedAt"].replace("Z", "+00:00"))
except (AttributeError, ValueError) as error:
    raise SystemExit("reviewedAt must be an ISO-8601 timestamp.") from error
if reviewed_at.tzinfo is None:
    raise SystemExit("reviewedAt must include a timezone.")

commands = source["commands"]
if not isinstance(commands, list) or not commands:
    raise SystemExit("commands must contain at least one verification command.")
for command in commands:
    if not isinstance(command, dict) or not command.get("command") or command.get("result") not in {"pass", "fail"}:
        raise SystemExit("Each command needs command text and result=pass|fail.")

findings = source["findings"]
if not isinstance(findings, list):
    raise SystemExit("findings must be an array.")
for finding in findings:
    if not isinstance(finding, dict) or finding.get("severity") not in {"CRITICAL", "WARNING", "SUGGESTION"}:
        raise SystemExit("Each finding needs severity CRITICAL|WARNING|SUGGESTION.")
    if not isinstance(finding.get("message"), str) or not finding["message"].strip():
        raise SystemExit("Each finding needs a non-empty message.")
    if finding["severity"] == "WARNING" and "acceptedNonBlocking" not in finding:
        raise SystemExit("Each WARNING must declare acceptedNonBlocking true or false.")

not_verified = source["notVerified"]
if not isinstance(not_verified, list):
    raise SystemExit("notVerified must be an array.")
for check in not_verified:
    if (
        not isinstance(check, dict)
        or not isinstance(check.get("check"), str)
        or not check["check"].strip()
    ):
        raise SystemExit("Each notVerified entry needs a check string.")
    if not isinstance(check.get("applicable"), bool):
        raise SystemExit("Each notVerified entry must declare applicable true or false.")
    if not isinstance(check.get("reason"), str) or not check["reason"].strip():
        raise SystemExit("Each notVerified entry needs a reason.")

if source["verdict"] not in {"ready", "not_ready"}:
    raise SystemExit("verdict must be ready or not_ready.")

receipt = {
    "schemaVersion": 1,
    "change": change_name,
    "workspaceFingerprint": fingerprint,
    "reviewer": reviewer,
    "reviewedAt": source["reviewedAt"],
    "recordedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
    "commands": commands,
    "findings": findings,
    "notVerified": not_verified,
    "verdict": source["verdict"],
}
Path(output_path).write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
PY

mv "$temporary" "$receipt_path"
trap - EXIT
printf 'Recorded verification receipt: %s\n' "$receipt_path"
