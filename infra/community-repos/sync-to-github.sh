#!/usr/bin/env bash
# infra/community-repos/sync-to-github.sh
#
# One-shot, idempotent sync from this keepance/keepance repo's source-of-truth
# files in infra/community-repos/ to the two live community GitHub repos:
#
#   - keepance/community-templates  (catalog of community template entries)
#   - keepance/community-plugins    (catalog of community plugin entries)
#
# What it does, per kind:
#   1. Creates the repo via `gh repo create` if it doesn't exist (idempotent;
#      if create fails because the repo already exists, treat as success and
#      proceed).
#   2. Clones the repo into /tmp/community-repos-sync/<name> (or pulls if a
#      previous run already cloned).
#   3. Replaces:
#        README.md
#        scripts/build-catalog.mjs
#        scripts/package.json   (declares zod dep so the Action can install it)
#        .github/workflows/build-catalog.yml
#        entries/                (full mirror from seed-templates / seed-plugins)
#        catalog.json            (initial empty array on first push so the
#                                 Action's first run produces a no-op diff)
#   4. Commits + pushes. The very first commit includes "[skip ci]" in the
#      message; this prevents the GitHub Action from running on the initial
#      seed push (we already include an empty catalog.json so the marketplace
#      can fetch a valid response immediately). Subsequent runs skip [skip ci]
#      so changes do trigger a rebuild.
#
# Why "[skip ci] on the first push"?
#   The Action commits the rebuilt catalog.json + tarballs back to main with
#   its own [skip ci] tag. If we let the Action run on the seed-import push,
#   the bot's commit lands on top of our seed history, which is fine but
#   noisy. Skipping CI on the seed push means a single human-readable initial
#   commit that already carries everything the marketplace needs to load.
#   The next seed/entry push (any) re-triggers the Action normally.
#
# Run from repo root:
#   ./infra/community-repos/sync-to-github.sh
#
# Optional env:
#   KEEPANCE_SYNC_KIND=templates  Sync only that one kind. Defaults to both.
#   KEEPANCE_SYNC_DRYRUN=1        Skip push step (still commits locally).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${REPO_ROOT}/infra/community-repos"
WORK_DIR="/tmp/community-repos-sync"
GH_OWNER="keepance"

KINDS_TO_SYNC=("${KEEPANCE_SYNC_KIND:-both}")
if [[ "${KINDS_TO_SYNC[0]}" == "both" ]]; then
  KINDS_TO_SYNC=("templates" "plugins")
fi

DRYRUN="${KEEPANCE_SYNC_DRYRUN:-0}"

mkdir -p "${WORK_DIR}"

log() { printf '\n[sync] %s\n' "$*"; }

# Check gh auth before doing anything destructive.
if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh CLI is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

# Verify source-of-truth files all exist before we touch the network.
required_files=(
  "${SRC_DIR}/build-catalog.mjs"
  "${SRC_DIR}/build-catalog.yml"
  "${SRC_DIR}/templates-readme.md"
  "${SRC_DIR}/plugins-readme.md"
)
for f in "${required_files[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: required source-of-truth file missing: $f" >&2
    exit 1
  fi
done

sync_one_kind() {
  local kind="$1"  # "templates" or "plugins"

  local repo_name readme_src seeds_src description
  case "$kind" in
    templates)
      repo_name="community-templates"
      readme_src="${SRC_DIR}/templates-readme.md"
      seeds_src="${SRC_DIR}/seed-templates"
      description="Community-contributed templates for Keepance. See README for submission process."
      ;;
    plugins)
      repo_name="community-plugins"
      readme_src="${SRC_DIR}/plugins-readme.md"
      seeds_src="${SRC_DIR}/seed-plugins"
      description="Community-contributed plugins for Keepance. See README for submission process."
      ;;
    *)
      echo "ERROR: unknown kind '$kind' (expected templates|plugins)" >&2
      return 1
      ;;
  esac

  local full_repo="${GH_OWNER}/${repo_name}"
  local clone_dir="${WORK_DIR}/${repo_name}"

  log "=== syncing ${full_repo} ==="

  # Step 1: ensure repo exists. `gh repo view` returns non-zero if missing.
  if gh repo view "${full_repo}" >/dev/null 2>&1; then
    log "repo ${full_repo} already exists"
  else
    log "creating ${full_repo}"
    # `gh repo create` will print the URL on success. If it fails for any
    # reason other than "name already exists" (e.g. permissions), let the
    # caller see the stderr and abort.
    if ! gh repo create "${full_repo}" --public --description "${description}"; then
      # Race / concurrent run: re-check existence and continue if found.
      if gh repo view "${full_repo}" >/dev/null 2>&1; then
        log "repo appeared during creation, continuing"
      else
        echo "ERROR: failed to create ${full_repo}" >&2
        return 1
      fi
    fi
  fi

  # Step 2: clone or refresh the local mirror.
  if [[ -d "${clone_dir}/.git" ]]; then
    log "refreshing existing clone at ${clone_dir}"
    git -C "${clone_dir}" fetch origin
    # Default branch may not exist yet on a brand-new empty repo; tolerate that.
    if git -C "${clone_dir}" rev-parse --verify --quiet origin/main >/dev/null; then
      git -C "${clone_dir}" checkout -B main origin/main
    fi
  else
    log "cloning ${full_repo} into ${clone_dir}"
    # Brand new repos may have no default branch yet; clone may print a warning
    # but still succeed.
    git clone "https://github.com/${full_repo}.git" "${clone_dir}" || {
      # gh-created empty repos sometimes need an init-style first push.
      mkdir -p "${clone_dir}"
      git -C "${clone_dir}" init -b main
      git -C "${clone_dir}" remote add origin "https://github.com/${full_repo}.git"
    }
  fi

  # Make sure we're on main locally even if HEAD doesn't yet exist on remote.
  git -C "${clone_dir}" checkout -B main 2>/dev/null || true

  # Step 3: sync source-of-truth files.
  log "syncing files into ${clone_dir}"

  # README
  cp "${readme_src}" "${clone_dir}/README.md"

  # scripts/build-catalog.mjs
  mkdir -p "${clone_dir}/scripts"
  cp "${SRC_DIR}/build-catalog.mjs" "${clone_dir}/scripts/build-catalog.mjs"

  # scripts/package.json (declares zod runtime dep for the Action)
  cat > "${clone_dir}/scripts/package.json" <<'PKG_EOF'
{
  "name": "keepance-community-catalog-build",
  "private": true,
  "type": "module",
  "description": "Catalog rebuild script vendored from keepance/keepance. Do not edit here.",
  "dependencies": {
    "zod": "^4.3.6"
  }
}
PKG_EOF

  # .github/workflows/build-catalog.yml
  mkdir -p "${clone_dir}/.github/workflows"
  cp "${SRC_DIR}/build-catalog.yml" "${clone_dir}/.github/workflows/build-catalog.yml"

  # entries/ (full mirror; remove any orphaned entries no longer in seed/)
  rm -rf "${clone_dir}/entries"
  mkdir -p "${clone_dir}/entries"
  if [[ -d "${seeds_src}" ]] && [[ -n "$(ls -A "${seeds_src}" 2>/dev/null)" ]]; then
    cp -a "${seeds_src}/." "${clone_dir}/entries/"
  fi

  # catalog.json: only seed an empty array on the very first push so the
  # marketplace can fetch a valid (if empty) response immediately. After the
  # first push, leave the file alone so the Action keeps managing it.
  if [[ ! -f "${clone_dir}/catalog.json" ]]; then
    log "no catalog.json yet; seeding empty array"
    printf '[]\n' > "${clone_dir}/catalog.json"
  fi

  # Step 4: commit + push.
  cd "${clone_dir}"
  git add -A

  if git diff --staged --quiet; then
    log "no changes to commit for ${full_repo}"
    cd "${REPO_ROOT}"
    return 0
  fi

  # Detect "first push": no commits yet on this clone.
  local commit_msg
  if ! git rev-parse --verify --quiet HEAD >/dev/null; then
    # First commit ever for this repo. Skip CI so the Action doesn't loop on
    # the initial seed import (we ship an empty catalog.json alongside seeds).
    commit_msg="chore: initial seed sync from keepance/keepance [skip ci]

Source-of-truth synced from infra/community-repos/ in keepance/keepance."
  else
    commit_msg="chore: sync from keepance/keepance

Source-of-truth synced from infra/community-repos/ in keepance/keepance."
  fi

  git -c user.name="keepance-catalog-bot" \
      -c user.email="bot@keepance.com" \
      commit -m "${commit_msg}"

  if [[ "${DRYRUN}" == "1" ]]; then
    log "DRYRUN: skipping push for ${full_repo}"
  else
    log "pushing to ${full_repo}"
    git push -u origin main
  fi

  cd "${REPO_ROOT}"
}

for kind in "${KINDS_TO_SYNC[@]}"; do
  sync_one_kind "${kind}"
done

log "all done"
