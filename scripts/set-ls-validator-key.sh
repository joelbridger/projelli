#!/usr/bin/env bash
#
# set-ls-validator-key.sh
#
# Securely set the LemonSqueezy API key (and optionally the webhook signing
# secret) for the Keepance license-validator service, then restart it and
# VERIFY the new key can actually see the new product catalog.
#
# Why this exists: the key currently on the server (named "Guesslet server"
# in the LemonSqueezy dashboard) is scoped/limited — it 404s on the new
# Keepance products (Personal/Professional/Practice), so a buyer of those
# products could not activate. This script swaps in a fresh full-access key.
#
# How to use:
#   1. In LemonSqueezy (app.lemonsqueezy.com), as the projelli account:
#      Settings -> API -> create a new API key (name it e.g. "keepance-validator").
#      Copy the key it shows you ONCE.
#   2. On the server, run:   bash ~/keepance/scripts/set-ls-validator-key.sh
#      Paste the key at the hidden prompt. The script verifies it works
#      BEFORE writing anything, so a wrong/limited key is rejected safely.
#
# The secret is never echoed, never written to shell history, and never
# leaves this machine except in the request to the LemonSqueezy API.

set -euo pipefail

ENV_FILE=/etc/license-validator.env
# Keepance "Professional" product — the key MUST be able to read this, or it
# cannot validate the new tiers. (Confirmed live in store 340394.)
VERIFY_PRODUCT_ID=1101955

echo "== Keepance license-validator: set LemonSqueezy API key =="
read -rsp "Paste the new LemonSqueezy API key (hidden): " KEY; echo
[ -n "${KEY:-}" ] || { echo "No key entered. Aborting."; exit 1; }

echo -n "Verifying the key can see the new catalog... "
HTTP=$(curl -s -o /tmp/.lsverify.$$ -w '%{http_code}' \
  -H "Authorization: Bearer $KEY" -H "Accept: application/vnd.api+json" \
  "https://api.lemonsqueezy.com/v1/products/$VERIFY_PRODUCT_ID" || echo "000")
if [ "$HTTP" != "200" ]; then
  echo "FAILED (HTTP $HTTP)."
  echo "That key still can't read the new Professional product. Nothing was changed."
  echo "Make sure it's a FULL-ACCESS key created under the projelli account."
  rm -f /tmp/.lsverify.$$
  exit 1
fi
NAME=$(grep -o '"name":"[^"]*"' /tmp/.lsverify.$$ | head -1 | sed 's/.*:"//; s/"//')
rm -f /tmp/.lsverify.$$
echo "OK (key can read product: ${NAME:-Professional})."

read -rsp "Paste webhook signing secret (or press Enter to keep the current one): " WHSEC; echo

# Build the new env content as the current user (jameson can read the file via
# its group), then sudo-copy it into place. Keeps special chars intact and the
# secret out of process args where possible.
TMP=$(mktemp); chmod 600 "$TMP"
grep -v '^LEMONSQUEEZY_API_KEY=' "$ENV_FILE" > "$TMP"
printf 'LEMONSQUEEZY_API_KEY=%s\n' "$KEY" >> "$TMP"
if [ -n "${WHSEC:-}" ]; then
  grep -v '^LEMONSQUEEZY_WEBHOOK_SECRET=' "$TMP" > "$TMP.2" && mv "$TMP.2" "$TMP"
  printf 'LEMONSQUEEZY_WEBHOOK_SECRET=%s\n' "$WHSEC" >> "$TMP"
fi

sudo cp "$TMP" "$ENV_FILE"
sudo chown root:jameson "$ENV_FILE"
sudo chmod 640 "$ENV_FILE"
shred -u "$TMP" 2>/dev/null || rm -f "$TMP"

echo -n "Restarting license-validator... "
sudo systemctl restart license-validator.service
echo "done."

echo -n "Health check: "
curl -s --retry 6 --retry-connrefused --retry-delay 1 http://127.0.0.1:5181/healthz && echo "  <- validator is up"
echo ""
echo "✅ New API key is live for the validator and verified against the new catalog."
echo "   Next: a real (or test-mode) purchase -> activate is the final end-to-end confirmation."
