#!/usr/bin/env bash
# Deploy the Projelli marketing website to the live server.
#
# Usage:  ~/projelli/infra/deploy.sh
#
# What it does:
#   1. rsync website/ → /var/www/projelli.com/
#   2. set ownership to www-data:www-data
#   3. purge Cloudflare cache for projelli.com so visitors see changes immediately
#
# Requires sudo for the file ownership step. The Cloudflare API token must be
# set in ~/.cloudflare-projelli-token (chmod 600).
#
# Same pattern as ~/jameson-daines-portfolio/infra/deploy.sh.

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

echo "==> Syncing $WEBSITE_DIR/ → $WEB_ROOT/"
sudo rsync -av --delete \
  --exclude='.DS_Store' \
  --exclude='*.swp' \
  "$WEBSITE_DIR/" "$WEB_ROOT/"

echo "==> Setting ownership to www-data:www-data"
sudo chown -R www-data:www-data "$WEB_ROOT"

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
