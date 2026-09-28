#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

python3 - "$repo_root" <<'PY'
from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
ignored_dirs = {
    ".git",
    ".gradle",
    ".idea",
    ".pnpm-store",
    ".pytest_cache",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "target",
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
        and parts[3] == "evidence"
    ):
        return True
    return False

files: list[Path] = []
for directory, dirnames, filenames in os.walk(root, topdown=True):
    base = Path(directory)
    traversable_dirs: list[str] = []
    for name in sorted(dirnames):
        path = base / name
        relative = path.relative_to(root)
        if ignored(relative):
            continue
        if path.is_symlink():
            files.append(relative)
        else:
            traversable_dirs.append(name)
    dirnames[:] = traversable_dirs
    for name in sorted(filenames):
        path = base / name
        relative = path.relative_to(root)
        if not ignored(relative) and (path.is_file() or path.is_symlink()):
            files.append(relative)

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
