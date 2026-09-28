#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s <change-name> <review-report.json-or-markdown>\n' "$0" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
change_name="$1"
report_path="$2"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
change_root="$repo_root/openspec/changes/$change_name"
policy_path="$change_root/verification-policy.json"
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

fingerprint="$($repo_root/tools/openspec/workspace-fingerprint.sh "$change_name")"
mkdir -p "$(dirname "$receipt_path")"
temporary="$receipt_path.tmp.$$"
trap 'rm -f "$temporary"' EXIT

python3 - "$change_name" "$report_path" "$policy_path" "$fingerprint" "$temporary" <<'PY'
from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path

change_name, source_path, policy_path, fingerprint, output_path = sys.argv[1:]
text = Path(source_path).read_text()
try:
    source = json.loads(text)
except json.JSONDecodeError:
    blocks = re.findall(r"```verification-report\s*\n(.*?)\n```", text, flags=re.DOTALL)
    if len(blocks) != 1:
        raise SystemExit(
            "Review report must be pure JSON or Markdown containing exactly one verification-report JSON block."
        )
    try:
        source = json.loads(blocks[0])
    except json.JSONDecodeError as error:
        raise SystemExit(f"verification-report block is not valid JSON: {error}") from error

if not isinstance(source, dict):
    raise SystemExit("Review report top level must be an object.")

policy = {
    "schemaVersion": 1,
    "riskLevel": "standard",
    "mode": "independent-required",
    "rationale": "Default policy when no verification-policy.json is present.",
}
policy_file = Path(policy_path)
if policy_file.is_file():
    try:
        policy = json.loads(policy_file.read_text())
    except json.JSONDecodeError as error:
        raise SystemExit(f"Malformed verification policy: {error}") from error
if not isinstance(policy, dict) or policy.get("schemaVersion") != 1:
    raise SystemExit("Malformed verification policy: schemaVersion must be 1.")
risk_level = policy.get("riskLevel")
policy_mode = policy.get("mode")
if risk_level not in {"low", "bootstrap", "standard", "high", "critical"}:
    raise SystemExit("verification policy riskLevel is invalid.")
if policy_mode not in {"independent-required", "owner-acceptance-allowed"}:
    raise SystemExit("verification policy mode is invalid.")
if policy_mode == "owner-acceptance-allowed" and risk_level not in {"low", "bootstrap"}:
    raise SystemExit("Owner acceptance policy is allowed only for low or bootstrap risk.")

required = {"attestation", "reviewedAt", "commands", "findings", "notVerified", "verdict"}
missing = sorted(required - source.keys())
if missing:
    raise SystemExit(f"Review report is missing fields: {', '.join(missing)}")

attestation = source["attestation"]
if not isinstance(attestation, dict):
    raise SystemExit("attestation must be an object.")
mode = attestation.get("mode")
identity = attestation.get("identity")
if mode not in {"independent-review", "owner-acceptance"}:
    raise SystemExit("attestation.mode must be independent-review or owner-acceptance.")
if not isinstance(identity, str) or not identity.strip():
    raise SystemExit("attestation.identity must be a non-empty string.")
if mode == "owner-acceptance":
    if policy_mode != "owner-acceptance-allowed" or risk_level not in {"low", "bootstrap"}:
        raise SystemExit("Verification policy does not allow owner acceptance for this Change.")
    for field in ("reason", "scope"):
        if not isinstance(attestation.get(field), str) or not attestation[field].strip():
            raise SystemExit(f"owner-acceptance attestation requires a non-empty {field}.")

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
    if finding["severity"] == "WARNING" and not isinstance(finding.get("acceptedNonBlocking"), bool):
        raise SystemExit("Each WARNING must declare acceptedNonBlocking true or false.")

not_verified = source["notVerified"]
if not isinstance(not_verified, list):
    raise SystemExit("notVerified must be an array.")
for check in not_verified:
    if not isinstance(check, dict) or not isinstance(check.get("check"), str) or not check["check"].strip():
        raise SystemExit("Each notVerified entry needs a check string.")
    if not isinstance(check.get("applicable"), bool):
        raise SystemExit("Each notVerified entry must declare applicable true or false.")
    if not isinstance(check.get("reason"), str) or not check["reason"].strip():
        raise SystemExit("Each notVerified entry needs a reason.")

if source["verdict"] not in {"ready", "not_ready"}:
    raise SystemExit("verdict must be ready or not_ready.")

receipt = {
    "schemaVersion": 2,
    "change": change_name,
    "workspaceFingerprint": fingerprint,
    "policy": {
        "riskLevel": risk_level,
        "mode": policy_mode,
        "rationale": policy.get("rationale", ""),
    },
    "attestation": attestation,
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
