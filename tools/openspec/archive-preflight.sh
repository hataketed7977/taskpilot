#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <change-name>\n' "$0" >&2
  exit 2
fi

change_name="$1"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
receipt_path="$repo_root/openspec/changes/$change_name/evidence/verification-report.json"
policy_path="$repo_root/openspec/changes/$change_name/verification-policy.json"

[[ -f "$receipt_path" ]] || {
  printf 'Archive blocked: verification receipt is missing for %s.\n' "$change_name" >&2
  exit 1
}

current_fingerprint="$($repo_root/tools/openspec/workspace-fingerprint.sh "$change_name")"
python3 - "$change_name" "$receipt_path" "$policy_path" "$current_fingerprint" <<'PY'
from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path

change_name, receipt_path, policy_path, current_fingerprint = sys.argv[1:]
try:
    receipt = json.loads(Path(receipt_path).read_text())
except (OSError, json.JSONDecodeError) as error:
    raise SystemExit(f"Archive blocked: malformed verification receipt: {error}") from error

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
        raise SystemExit(f"Archive blocked: malformed verification policy: {error}") from error

errors: list[str] = []
if not isinstance(policy, dict) or policy.get("schemaVersion") != 1:
    errors.append("malformed verification policy")
    effective_policy: dict[str, object] = {}
else:
    effective_policy = policy
    risk_level = policy.get("riskLevel")
    policy_mode = policy.get("mode")
    if risk_level not in {"low", "bootstrap", "standard", "high", "critical"}:
        errors.append("verification policy riskLevel is invalid")
    if policy_mode not in {"independent-required", "owner-acceptance-allowed"}:
        errors.append("verification policy mode is invalid")
    if policy_mode == "owner-acceptance-allowed" and risk_level not in {"low", "bootstrap"}:
        errors.append("owner acceptance policy is allowed only for low or bootstrap risk")

if not isinstance(receipt, dict):
    errors.append("malformed verification receipt: top level must be an object")
else:
    if receipt.get("schemaVersion") != 2:
        errors.append("unsupported or missing schemaVersion")
    if receipt.get("change") != change_name:
        errors.append("receipt change does not match requested change")

    fingerprint = receipt.get("workspaceFingerprint")
    if not isinstance(fingerprint, str) or re.fullmatch(r"[0-9a-f]{64}", fingerprint) is None:
        errors.append("workspaceFingerprint is malformed")
    elif fingerprint != current_fingerprint:
        errors.append("relevant workspace fingerprint changed after attestation")

    receipt_policy = receipt.get("policy")
    if not isinstance(receipt_policy, dict):
        errors.append("receipt policy is malformed")
    elif isinstance(policy, dict) and (
        receipt_policy.get("riskLevel") != effective_policy.get("riskLevel")
        or receipt_policy.get("mode") != effective_policy.get("mode")
    ):
        errors.append("verification policy changed after attestation")

    attestation = receipt.get("attestation")
    if not isinstance(attestation, dict):
        errors.append("attestation is malformed")
    else:
        mode = attestation.get("mode")
        identity = attestation.get("identity")
        if mode not in {"independent-review", "owner-acceptance"}:
            errors.append("attestation mode is invalid")
        if not isinstance(identity, str) or not identity.strip():
            errors.append("attestation identity is missing")
        if mode == "owner-acceptance":
            if effective_policy.get("mode") != "owner-acceptance-allowed" or effective_policy.get("riskLevel") not in {"low", "bootstrap"}:
                errors.append("verification policy does not allow owner acceptance")
            for field in ("reason", "scope"):
                if not isinstance(attestation.get(field), str) or not attestation[field].strip():
                    errors.append(f"owner acceptance {field} is missing")
        elif mode == "independent-review" and effective_policy.get("mode") not in {"independent-required", "owner-acceptance-allowed"}:
            errors.append("verification policy does not allow independent review")

    for field in ("reviewedAt", "recordedAt"):
        value = receipt.get(field)
        try:
            parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except (AttributeError, ValueError):
            errors.append(f"{field} is not a valid ISO-8601 timestamp")
        else:
            if parsed.tzinfo is None:
                errors.append(f"{field} must include a timezone")

    commands = receipt.get("commands")
    if not isinstance(commands, list) or not commands:
        errors.append("verification commands are missing")
    else:
        malformed_commands = any(
            not isinstance(item, dict)
            or not isinstance(item.get("command"), str)
            or not item["command"].strip()
            or item.get("result") not in {"pass", "fail"}
            for item in commands
        )
        if malformed_commands:
            errors.append("verification commands are malformed")
        elif any(item["result"] != "pass" for item in commands):
            errors.append("one or more verification commands did not pass")

    findings = receipt.get("findings")
    if not isinstance(findings, list):
        errors.append("findings are malformed")
    else:
        malformed_findings = any(
            not isinstance(item, dict)
            or item.get("severity") not in {"CRITICAL", "WARNING", "SUGGESTION"}
            or not isinstance(item.get("message"), str)
            or not item["message"].strip()
            or (item.get("severity") == "WARNING" and not isinstance(item.get("acceptedNonBlocking"), bool))
            for item in findings
        )
        if malformed_findings:
            errors.append("findings are malformed")
        else:
            if any(item["severity"] == "CRITICAL" for item in findings):
                errors.append("CRITICAL findings remain")
            if any(item["severity"] == "WARNING" and item["acceptedNonBlocking"] is not True for item in findings):
                errors.append("one or more WARNING findings are not accepted as non-blocking")

    not_verified = receipt.get("notVerified")
    if not isinstance(not_verified, list):
        errors.append("notVerified entries are malformed")
    else:
        malformed_not_verified = any(
            not isinstance(item, dict)
            or not isinstance(item.get("check"), str)
            or not item["check"].strip()
            or not isinstance(item.get("applicable"), bool)
            or not isinstance(item.get("reason"), str)
            or not item["reason"].strip()
            for item in not_verified
        )
        if malformed_not_verified:
            errors.append("notVerified entries are malformed")
        elif any(item["applicable"] is True for item in not_verified):
            errors.append("applicable checks remain Not verified")

    verdict = receipt.get("verdict")
    if verdict not in {"ready", "not_ready"}:
        errors.append("verdict is malformed")
    elif verdict != "ready":
        errors.append("verdict is not ready")

if errors:
    print("Archive blocked:", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    raise SystemExit(1)
print(f"Archive preflight passed for {change_name}.")
PY
