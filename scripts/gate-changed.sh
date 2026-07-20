#!/usr/bin/env bash
# Fast, conservative local gate for ordinary edits and pushes. It never
# replaces scripts/gate.sh: the complete suite remains the merge/release gate.
set -uo pipefail
cd "$(dirname "$0")/.."
# Fresh-worktree insurance: stub the platform sidecars cargo's build script expects (mirrors gate.sh)
mkdir -p src-tauri/binaries
touch src-tauri/binaries/piper-x86_64-unknown-linux-gnu src-tauri/binaries/llama-server-x86_64-unknown-linux-gnu

plan_file="$(mktemp)"
trap 'rm -f "$plan_file"' EXIT
node scripts/gate-plan.mjs --json >"$plan_file" || exit 1
node scripts/gate-plan.mjs

fail=0
step () { echo ""; echo "===== $1 ====="; shift; "$@" || { echo "❌ FAILED: $*"; fail=1; }; }
read_plan () { local code="$1"; shift; node -e "const fs=require('node:fs'); const p=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); $code" "$plan_file" "$@"; }
selected () { read_plan "process.exit(p[process.argv[2]] ? 0 : 1)" "$1"; }
rust_packages () { read_plan "console.log(p.rustPackages.join(' '))"; }
merge_base () { read_plan "process.stdout.write(p.mergeBase)"; }

step "Build assets" node scripts/copy-build-assets.mjs
step "Tauri version parity" node scripts/check-tauri-parity.mjs
step "Tauri TS/Rust command contracts" node scripts/check-tauri-contracts.mjs
step "Provider front door" node scripts/check-provider-construction.mjs
step "Consent-gate wiring" node scripts/check-consent-gate-wiring.mjs
step "Case-only filename collisions" node scripts/check-case-collisions.mjs
step "TypeScript" npm run typecheck
step "TypeScript (tests)" npm run typecheck:tests
# Always run wire contracts: the helper fails closed if any Intake wire exists
# without its canonical real producer → route → consumer test.
step "Wire-contract suite" npm run test:contracts
step "Brand sync" npm run brand:check
step "Identity check" npm run identity:check
step "ESLint gate" npm run lint:gate

if selected fullVitest; then
  step "Unit tests (full; conservative trigger)" npx vitest run
elif selected changedVitest; then
  step "Unit tests (changed)" npx vitest run --changed "$(merge_base)"
else
  echo ""
  echo "===== Unit tests ====="
  echo "No frontend impact selected. Full suite remains required in CI."
fi

if selected backend; then
  if command -v bun >/dev/null 2>&1; then
    # ONE canonical script, not a subset. The structural guards used to run only
    # in scripts/gate.sh, so a backend change could be "proven" here by tsc and
    # bun test alone while the boundary checker never ran at all.
    step "Canonical backend gate" npm run backend:gate
  else
    echo "❌ Backend changed but Bun is unavailable; cannot safely skip backend proof."
    fail=1
  fi
fi

for package in $(rust_packages); do
  step "Rust tests ($package)" bash -c "cd src-tauri && CI=1 cargo test -p '$package' --locked"
done

echo ""
[ "$fail" -eq 0 ] && echo "✅ CHANGED GATE GREEN" || echo "❌ CHANGED GATE RED — see failures above"
exit "$fail"
