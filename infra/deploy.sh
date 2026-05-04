#!/usr/bin/env bash
# Sudo-free deploy. Requires: jameson is in www-data group AND /var/www/projelli.com
# has the setgid bit on directories. Run setup-claude-deploy.sh ONCE to set both up.
#
# What this does:
#   1. rsync website/ → /var/www/projelli.com/  (no sudo; jameson can write because
#      jameson is in www-data group and the dir is group-writable)
#   2. New files inherit www-data group via setgid, so Caddy can still serve them
#   3. Optional Cloudflare cache purge if token + zone are configured
#
# Usage:
#   ~/projelli-marketing/infra/deploy-noroot.sh
#
# Replaces deploy.sh for routine deploys. Original deploy.sh is preserved as fallback.

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBSITE_DIR="$REPO_DIR/website"
WEB_ROOT="/var/www/projelli.com"
WEB_DEMO_DIR="$REPO_DIR/dist-web-demo"
WEB_DEMO_ROOT="$WEB_ROOT/try"
TOKEN_FILE="$HOME/.cloudflare-projelli-token"
ZONE_ID="${PROJELLI_CF_ZONE_ID:-}"

# --dry-run previews rsync output without touching disk; useful for CI sanity.
DRY_RUN_FLAG=""
SKIP_DEMO=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN_FLAG="--dry-run" ;;
    --skip-demo) SKIP_DEMO="1" ;;
  esac
done

if [[ ! -d "$WEBSITE_DIR" ]]; then
  echo "ERROR: $WEBSITE_DIR does not exist"
  exit 1
fi

if [[ ! -d "$WEB_ROOT" ]]; then
  echo "ERROR: $WEB_ROOT does not exist (expected the live web root)"
  exit 1
fi

if [[ ! -w "$WEB_ROOT" ]]; then
  echo "ERROR: $WEB_ROOT is not writable by $(whoami)."
  echo "Run setup-claude-deploy.sh once (with sudo) to fix permissions, then re-run this."
  exit 1
fi

echo "==> Syncing $WEBSITE_DIR/ → $WEB_ROOT/"
# `_*.html` are source templates (underscore prefix is the convention).
# `_detail_template.html` in /templates/ contains unrendered {{SLUG}}
# placeholders that would leak if served. Exclude them from deploy.
# --no-perms / --no-owner / --no-group: don't try to preserve file ownership
# from the source (we run as jameson; the dest is owned by www-data via setgid).
# Exclude /try/ here — the web-demo build owns that path.
rsync -rlD --delete $DRY_RUN_FLAG \
  --no-perms --no-owner --no-group \
  --exclude='.DS_Store' \
  --exclude='*.swp' \
  --exclude='_*.html' \
  --exclude='/try/' \
  --exclude='/try/**' \
  "$WEBSITE_DIR/" "$WEB_ROOT/"

if [[ -z "$DRY_RUN_FLAG" ]]; then
  echo "==> Verifying live file"
  ls -la "$WEB_ROOT/index.html"
fi

# Build + deploy the /try/ web demo sandbox (Stream D-web).
# Idempotent: vite rebuild always runs; rsync syncs the result.
if [[ -z "$SKIP_DEMO" ]]; then
  if [[ ! -d "$WEB_DEMO_ROOT" ]]; then
    if [[ -n "$DRY_RUN_FLAG" ]]; then
      echo "==> Would create $WEB_DEMO_ROOT (first deploy)"
    else
      echo "==> Creating $WEB_DEMO_ROOT (first deploy)"
      mkdir -p "$WEB_DEMO_ROOT"
    fi
  fi

  echo "==> Building web demo (npm run build:web-demo)"
  if [[ -n "$DRY_RUN_FLAG" ]]; then
    echo "    (skipped under --dry-run)"
  else
    (cd "$REPO_DIR" && npm run build:web-demo)
  fi

  if [[ -d "$WEB_DEMO_DIR" ]]; then
    echo "==> Syncing $WEB_DEMO_DIR/ → $WEB_DEMO_ROOT/"
    rsync -rlD --delete $DRY_RUN_FLAG \
      --no-perms --no-owner --no-group \
      --exclude='.DS_Store' \
      "$WEB_DEMO_DIR/" "$WEB_DEMO_ROOT/"
  elif [[ -z "$DRY_RUN_FLAG" ]]; then
    echo "ERROR: build:web-demo did not produce $WEB_DEMO_DIR"
    exit 1
  else
    echo "    (web demo dist not present yet; --dry-run skipped build)"
  fi
else
  echo "==> SKIPPING web demo build/sync (--skip-demo)"
fi

if [[ -f "$TOKEN_FILE" && -n "$ZONE_ID" ]]; then
  echo "==> Purging Cloudflare cache for projelli.com"
  TOKEN=$(cat "$TOKEN_FILE")
  curl -sX POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{"purge_everything":true}' | grep -o '"success":[^,]*' || echo "  (no response from CF API)"
elif [[ ! -f "$TOKEN_FILE" ]]; then
  echo "==> SKIPPING Cloudflare cache purge: $TOKEN_FILE not found"
  echo "    To enable: write your CF API token to $TOKEN_FILE and chmod 600"
elif [[ -z "$ZONE_ID" ]]; then
  echo "==> SKIPPING Cloudflare cache purge: PROJELLI_CF_ZONE_ID not set"
  echo "    To enable: export PROJELLI_CF_ZONE_ID=<zone-id-from-cloudflare>"
fi

echo "==> Done. Live at https://projelli.com"
