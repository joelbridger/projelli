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
TOKEN_FILE="$HOME/.cloudflare-projelli-token"
ZONE_ID="${PROJELLI_CF_ZONE_ID:-}"

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
rsync -rlD --delete \
  --no-perms --no-owner --no-group \
  --exclude='.DS_Store' \
  --exclude='*.swp' \
  --exclude='_*.html' \
  "$WEBSITE_DIR/" "$WEB_ROOT/"

echo "==> Verifying live file"
ls -la "$WEB_ROOT/index.html"

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
