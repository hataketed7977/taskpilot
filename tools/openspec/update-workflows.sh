#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
config_home="$(mktemp -d "${TMPDIR:-/tmp}/taskpilot-openspec-config.XXXXXX")"
cleanup() {
  rm -rf "$config_home"
}
trap cleanup EXIT

mkdir -p "$config_home/openspec"
cat > "$config_home/openspec/config.json" <<'JSON'
{
  "profile": "custom",
  "delivery": "skills",
  "workflows": [
    "propose",
    "explore",
    "apply",
    "update",
    "sync",
    "archive",
    "verify"
  ]
}
JSON

XDG_CONFIG_HOME="$config_home" openspec update "$repo_root" --force

openspec_version="$(openspec --version)"
skills=(
  openspec-propose
  openspec-explore
  openspec-apply-change
  openspec-update-change
  openspec-sync-specs
  openspec-archive-change
  openspec-verify-change
)

for skill in "${skills[@]}"; do
  skill_file="$repo_root/.agents/skills/$skill/SKILL.md"
  [[ -f "$skill_file" ]] || {
    printf 'Generated OpenSpec Skill is missing: %s\n' "$skill_file" >&2
    exit 1
  }
  generated_by="$(sed -n 's/^  generatedBy: "\([^"]*\)"$/\1/p' "$skill_file")"
  [[ "$generated_by" == "$openspec_version" ]] || {
    printf 'Generated OpenSpec Skill %s reports generatedBy=%s; expected %s.\n' \
      "$skill" "${generated_by:-<missing>}" "$openspec_version" >&2
    exit 1
  }
done

printf 'Verified %s repository OpenSpec workflows at generatedBy %s.\n' \
  "${#skills[@]}" "$openspec_version"
