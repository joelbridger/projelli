#!/usr/bin/env bash
# Deploy keepance.com marketing site.
# Usage: ~/keepance/infra/deploy-keepance.sh [--dry-run]
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBSITE_DIR="$REPO_DIR/website-keepance"
WEB_ROOT="/var/www/keepance.com"
TOKEN_FILE="$HOME/.cloudflare-keepance-token"
ZONE_ID="${KEEPANCE_CF_ZONE_ID:-b12c60acef16317a66994606f79792e2}"

DRY_RUN_FLAG=""
for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN_FLAG="--dry-run"
done

[[ ! -d "$WEBSITE_DIR" ]] && echo "ERROR: $WEBSITE_DIR not found" && exit 1
[[ ! -d "$WEB_ROOT" ]]    && echo "ERROR: $WEB_ROOT not found (run: sudo mkdir -p /var/www/keepance.com && sudo chown jameson:www-data /var/www/keepance.com && sudo chmod 2775 /var/www/keepance.com)" && exit 1
[[ ! -w "$WEB_ROOT" ]]    && echo "ERROR: $WEB_ROOT not writable" && exit 1

echo "==> Syncing $WEBSITE_DIR/ → $WEB_ROOT/"
rsync -rlD --delete $DRY_RUN_FLAG \
  --no-perms --no-owner --no-group \
  --exclude='.DS_Store' --exclude='*.swp' --exclude='_*.html' \
  "$WEBSITE_DIR/" "$WEB_ROOT/"

[[ -z "$DRY_RUN_FLAG" ]] && echo "==> Deployed:" && ls -la "$WEB_ROOT/index.html"

if [[ -f "$TOKEN_FILE" && -n "$ZONE_ID" ]]; then
  echo "==> Purging Cloudflare cache for keepance.com"
  TOKEN=$(cat "$TOKEN_FILE")
  curl -sX POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{"purge_everything":true}' | grep -o '"success":[^,]*' || true
else
  echo "==> Skipping CF cache purge (set KEEPANCE_CF_ZONE_ID and write token to $TOKEN_FILE)"
fi

echo "==> Done. Live at https://keepance.com"
