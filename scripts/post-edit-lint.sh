#!/usr/bin/env bash
# Claude Code PostToolUse hook (matcher: Edit|Write|MultiEdit).
#
# Lints ONLY the just-edited TS/TSX file for fast (~2-3s) feedback, so lint debt
# is caught at edit time instead of piling up until the gate. NON-BLOCKING
# (always exits 0) and QUIET on success — it only prints when there are findings.
#
# A whole-project typecheck/lint per edit would be far too slow on a repo this
# size (tsc ~10s, eslint . ~37s), which is why this is single-file only. The
# authoritative pass/fail signal is still `npm run gate` + the pre-push hook.
#
# Enabled via .claude/settings.json -> hooks.PostToolUse. Disable by removing
# that hook block. Only fires on .ts/.tsx — .md/.json/etc. edits are untouched.
set -o pipefail
input="$(cat)"
file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
case "$file" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null)}"
[ -d "$root" ] || exit 0
out="$(cd "$root" && npx eslint --cache --cache-location node_modules/.cache/.eslint-postedit "$file" 2>&1)"
if [ -n "$out" ]; then
  printf '⚠ post-edit lint — %s\n%s\n' "$file" "$(printf '%s' "$out" | tail -15)"
fi
exit 0
