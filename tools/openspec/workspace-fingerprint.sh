#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <change-name>\n' "$0" >&2
  exit 2
fi

change_name="$1"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
change_root="$repo_root/openspec/changes/$change_name"
policy_path="$change_root/verification-policy.json"

[[ -d "$change_root" ]] || {
  printf 'Change not found: %s\n' "$change_name" >&2
  exit 1
}

python3 - "$repo_root" "$change_name" "$policy_path" <<'PY'
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
change_name = sys.argv[2]
policy_path = Path(sys.argv[3])
change_relative = Path("openspec") / "changes" / change_name
ignored_dirs = {
    ".git", ".gradle", ".idea", ".pnpm-store", ".pytest_cache", ".turbo",
    "build", "coverage", "dist", "node_modules", "out", "target",
}
ignored_files = {".DS_Store"}


def ignored(relative: Path) -> bool:
    parts = relative.parts
    if any(part in ignored_dirs for part in parts):
        return True
    if relative.name in ignored_files:
        return True
    if len(parts) >= 3 and parts[:3] == ("openspec", "changes", "archive"):
        return True
    if (
        len(parts) >= 4
        and parts[0] == "openspec"
        and parts[1] == "changes"
        and parts[2] == change_name
        and parts[3] == "evidence"
    ):
        return True
    return False


def safe_relative(raw: object) -> Path:
    if not isinstance(raw, str) or not raw.strip():
        raise SystemExit("verification-policy fingerprintPaths entries must be non-empty strings")
    candidate = Path(raw)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise SystemExit(f"verification-policy fingerprint path must stay inside the repository: {raw}")
    resolved = (root / candidate).resolve()
    try:
        relative = resolved.relative_to(root)
    except ValueError as error:
        raise SystemExit(f"verification-policy fingerprint path escapes the repository: {raw}") from error
    if not resolved.exists() and not resolved.is_symlink():
        raise SystemExit(f"verification-policy fingerprint path does not exist: {raw}")
    return relative


explicit_paths: list[Path] | None = None
if policy_path.is_file():
    try:
        policy = json.loads(policy_path.read_text())
    except json.JSONDecodeError as error:
        raise SystemExit(f"Malformed verification policy: {error}") from error
    if not isinstance(policy, dict) or policy.get("schemaVersion") != 1:
        raise SystemExit("Malformed verification policy: schemaVersion must be 1")
    raw_paths = policy.get("fingerprintPaths")
    if raw_paths is not None:
        if not isinstance(raw_paths, list) or not raw_paths:
            raise SystemExit("verification-policy fingerprintPaths must be a non-empty array when present")
        explicit_paths = [safe_relative(item) for item in raw_paths]

files: set[Path] = set()


def add_path(relative: Path) -> None:
    path = root / relative
    if ignored(relative):
        return
    if path.is_symlink() or path.is_file():
        files.add(relative)
        return
    if not path.is_dir():
        return
    for directory, dirnames, filenames in os.walk(path, topdown=True):
        base = Path(directory)
        traversable: list[str] = []
        for name in sorted(dirnames):
            child = base / name
            child_relative = child.relative_to(root)
            if ignored(child_relative):
                continue
            if child.is_symlink():
                files.add(child_relative)
            else:
                traversable.append(name)
        dirnames[:] = traversable
        for name in sorted(filenames):
            child = base / name
            child_relative = child.relative_to(root)
            if not ignored(child_relative) and (child.is_file() or child.is_symlink()):
                files.add(child_relative)


# The selected Change is always bound, including its policy and planning artifacts.
add_path(change_relative)
if explicit_paths is not None:
    for relative in explicit_paths:
        add_path(relative)
else:
    # Conservative fallback: bind the repository, but never bind sibling active Changes.
    for child in sorted(root.iterdir(), key=lambda value: value.name):
        relative = child.relative_to(root)
        if relative == Path("openspec"):
            for openspec_child in sorted(child.iterdir(), key=lambda value: value.name):
                openspec_relative = openspec_child.relative_to(root)
                if openspec_relative == Path("openspec/changes"):
                    continue
                add_path(openspec_relative)
            continue
        add_path(relative)

fingerprint = hashlib.sha256()
for relative in sorted(files, key=lambda value: value.as_posix()):
    path = root / relative
    fingerprint.update(relative.as_posix().encode("utf-8"))
    fingerprint.update(b"\0")
    if path.is_symlink():
        fingerprint.update(b"symlink\0")
        fingerprint.update(os.readlink(path).encode("utf-8"))
    else:
        fingerprint.update(b"file\0")
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                fingerprint.update(chunk)
    fingerprint.update(b"\0")

print(fingerprint.hexdigest())
PY
