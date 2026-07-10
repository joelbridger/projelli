#!/usr/bin/env bash
# Seed one lane's private Cargo target directory from a warm target directory.
# Never copy debug/incremental: it is source-state-specific and not safely
# shareable. The shared sccache handles reusable compiler outputs instead.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/dev/seed-cargo-lane.sh <lane-name> [warm-target-dir]

Creates /mnt/devcache/cargo-targets/<lane-name>. The optional warm target
defaults to src-tauri/target in this worktree. Set CARGO_LANE_ROOT to use a
different cache volume. The script refuses unsafe lane names and never merges
into an existing target directory.
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then usage; exit 0; fi
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then usage >&2; exit 2; fi

lane="$1"
if [[ ! "$lane" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "❌ Lane names may contain only letters, numbers, dots, underscores, and dashes." >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
source_target="${2:-$repo_root/src-tauri/target}"
cache_root="${CARGO_LANE_ROOT:-/mnt/devcache/cargo-targets}"
destination="$cache_root/$lane"

if [ ! -d "$source_target" ]; then
  echo "❌ Warm target directory does not exist: $source_target" >&2
  exit 1
fi
if [ -e "$destination" ]; then
  echo "❌ Lane target already exists; refusing to merge build states: $destination" >&2
  exit 1
fi

mkdir -p "$cache_root"
rsync -a --delete --exclude '/debug/incremental/' --exclude '/debug/incremental' "$source_target/" "$destination/"

cat <<EOF
✅ Seeded Cargo lane: $lane
Target: $destination

Use it for this lane only:
  export CARGO_TARGET_DIR="$destination"
  export CARGO_BUILD_JOBS=3
  export SCCACHE_BASEDIRS="$(cd "$repo_root/src-tauri" && pwd)"
EOF
