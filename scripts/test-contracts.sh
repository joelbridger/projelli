#!/usr/bin/env bash
# Fast, blocking wire-contract gate. A contract test must call the real
# producer and the real route/consumer — never recreate its request body.
set -euo pipefail
cd "$(dirname "$0")/.."

CANONICAL_TEST="backend/test/intake-e2e.test.ts"
INTAKE_PATHS=(
  "src/platform/intake"
  "intake-page/src"
  "backend/src/routes/intake.ts"
  "backend/src/intakeContract.ts"
)

intake_present=0
for path in "${INTAKE_PATHS[@]}"; do
  if [ -e "$path" ]; then
    intake_present=1
    break
  fi
done

if [ "$intake_present" -eq 1 ] && [ ! -f "$CANONICAL_TEST" ]; then
  echo "❌ Intake code is present but its canonical round-trip contract test is missing: $CANONICAL_TEST"
  exit 1
fi

npx tsc -p tsconfig.contract.json --noEmit

if [ ! -f "$CANONICAL_TEST" ]; then
  echo "✅ Contract type project is green (no Intake wire exists on this branch yet)"
  exit 0
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "❌ Bun is required to run the blocking Intake contract suite."
  exit 1
fi

tests=("test/intake-e2e.test.ts")
if [ -d "backend/test/contracts" ]; then
  tests+=("test/contracts")
fi

(cd backend && bun test "${tests[@]}")
echo "✅ Intake wire-contract suite is green"
