#!/usr/bin/env bash
# One-time setup so Claude (running as jameson, no sudo) can deploy directly.
#
# What this does:
#   1. Adds jameson to the www-data group so it can write to /var/www/keepance.com/
#   2. Sets the setgid bit on /var/www/keepance.com/ so new files inherit www-data group
#   3. Ensures group-write permissions are correct
#
# After this runs ONCE (with sudo), Claude can run ~/keepance-marketing/infra/deploy.sh
# without sudo or password prompts.
#
# Usage (one time only):
#   sudo bash ~/keepance-marketing/infra/setup-claude-deploy.sh
#
# Then in YOUR current shell only, activate the new group:
#   newgrp www-data
# (Or log out and log back in.)

set -e

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: this script must run as root."
  echo "Try: sudo bash $0"
  exit 1
fi

WEB_ROOT=/var/www/keepance.com
USER=jameson

if [[ ! -d "$WEB_ROOT" ]]; then
  echo "ERROR: $WEB_ROOT does not exist."
  exit 1
fi

echo "==> Adding $USER to the www-data group"
usermod -aG www-data "$USER"

echo "==> Ensuring $WEB_ROOT is owned by www-data:www-data"
chown -R www-data:www-data "$WEB_ROOT"

echo "==> Setting group-rwx permissions on $WEB_ROOT (recursive)"
chmod -R g+rwX "$WEB_ROOT"

echo "==> Setting setgid bit on $WEB_ROOT (so new files inherit www-data group)"
find "$WEB_ROOT" -type d -exec chmod g+s {} +

echo ""
echo "==> Done. Verification:"
ls -ld "$WEB_ROOT"
echo ""
echo "==> Final step: run this in your current shell to activate the new group:"
echo "    newgrp www-data"
echo ""
echo "    (Or log out and back in.)"
echo ""
echo "After that, ~/keepance-marketing/infra/deploy.sh will work without sudo."
