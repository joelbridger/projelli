#!/usr/bin/env bash
# Canonical backend gate. Local gates and CI call this exact file so the type
# boundary, structural checker, checker self-test, and behavior suite cannot
# drift into disjoint green paths.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
step () { echo ""; echo "===== $1 ====="; shift; "$@" || { echo "❌ FAILED: $*"; fail=1; }; }

# Self-test BEFORE scan, always: a checker that has stopped detecting anything
# must not be allowed to print a silent pass in the step below it.
step "Backend body-boundary self-test" npm run backend:body-readers:test
step "Backend body-boundary scan" npm run backend:body-readers:check
# The SIBLING guard rides the same gate. It used to exist only in scripts/gate.sh
# and in none of the three CI-path files, so a PR that removed `auth` from a
# privileged route landed green — the same disjoint-gate defect this script was
# created to close for the body-reader guard, still open for its sibling.
step "Backend privileged-route self-test" npm run backend:privileged-routes:test
step "Backend privileged-route scan" npm run backend:privileged-routes:check
step "Backend TypeScript" bash -c "cd backend && bun run typecheck"
step "Backend behavior tests" bash -c "cd backend && bun test"

echo ""
[ "$fail" -eq 0 ] && echo "✅ CANONICAL BACKEND GATE GREEN" || echo "❌ CANONICAL BACKEND GATE RED"
exit "$fail"
