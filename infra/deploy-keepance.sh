#!/usr/bin/env bash
# DISABLED 2026-05-29. This script targeted website-keepance/ (a 2-file source
# dir) with `rsync --delete` and would have wiped the live site down to those
# 2 files. The correct deploy script is infra/deploy.sh (targets website/).
echo "ERROR: deploy-keepance.sh is disabled. Use:  bash infra/deploy.sh --skip-demo" >&2
exit 1
