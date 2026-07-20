#!/usr/bin/env bash
# scripts/gate.sh — the canonical pre-merge / pre-release gate, in order.
# Usage:
#   scripts/gate.sh         # fast gate: typecheck + i18n + vitest + lint + cargo
#   scripts/gate.sh --full  # also runs L1 browser suite + L2 desktop harness (slow; for nightly/release)
set -uo pipefail
cd "$(dirname "$0")/.."
FULL=0; [ "${1:-}" = "--full" ] && FULL=1
fail=0
step () { echo ""; echo "===== $1 ====="; shift; "$@" || { echo "❌ FAILED: $*"; fail=1; }; }

step "Build assets"    node scripts/copy-build-assets.mjs
step "Module boundaries" npm run boundaries:check
step "Active CRM/client boundary" npm run crm:active-boundary
step "Selection writer retirement" npm run selection:writers:test
step "Union registry safety" node scripts/check-union-registry-preconditions.mjs
step "Union registry merge history" node scripts/check-union-registry-merge-history.mjs
step "Flag cap"         node scripts/check-flag-cap.mjs
# A test that reads the real wall clock is a SCHEDULED FAILURE: green today, red
# on a date nobody chose, and invisible until that date. One such test turned the
# merge tip red for every branch on 2026-07-20T10:00Z. Sits next to the flag-cap
# and flag-expiry checks because it is the same shape: a forgotten date, named.
step "Test clock discipline" node scripts/check-test-clock-bombs.mjs
step "Tauri version parity" node scripts/check-tauri-parity.mjs
step "Tauri TS/Rust command contracts" node scripts/check-tauri-contracts.mjs
step "Meeting voice bundle contract" npm run check:meeting-voice-bundle
# Run real cross-boundary contracts before the broad frontend and Rust suites.
# This is intentionally blocking: an Intake wire change without its canonical
# producer → route → consumer test must not wait for a final integration pass.
step "Wire-contract suite" npm run test:contracts
step "Provider front door" node scripts/check-provider-construction.mjs
step "Consent-gate wiring" node scripts/check-consent-gate-wiring.mjs
step "Case-only filename collisions" node scripts/check-case-collisions.mjs
step "TypeScript"      npm run typecheck
step "TypeScript (tests)" npm run typecheck:tests
step "Brand sync"      npm run brand:check
step "Identity check"  npm run identity:check
# i18n is deferred (KNOWN-I18N-01) — report drift but don't fail the gate.
# Re-add as a blocking `step` once the locale key drift is fixed (NOT via
# i18n:extract, which is destructive).
echo ""; echo "===== i18n key parity (report-only — KNOWN-I18N-01 deferred) ====="
npm run i18n:check || echo "⚠️  i18n key drift (KNOWN-I18N-01, deferred) — not blocking the gate"
# Separate from KNOWN-I18N-01 above: this checks that every key that DOES
# exist in en.json also exists (translated, non-empty) in de.json/es.json —
# the "ships English-only for non-English locales" class of bug. Blocking.
step "i18n locale completeness" npm run i18n:completeness
# Build the intake client page ONCE, serially, before the concurrent vitest run.
# tests/security/intake-hosting.test.ts verifies the hosting pipeline signs the
# COMPILED intake-page/dist; building it inside vitest (under ~N parallel workers)
# exhausts process/file handles (ERR_INSUFFICIENT_RESOURCES). Pre-building here
# lets that test reuse dist (buildPage:false) instead of spawning tsc+vite under load.
step "Intake page build (hosting test fixture)" npm --prefix intake-page run build
step "Unit tests"      npx vitest run
step "ESLint gate"     npm run lint:gate
# ── UI Iteration System guards (keep future UI rounds honest) ────────────────
# Permanent-handle guard: fails if a data-testid the tests/robot grip vanished
# without a migration entry. Design-token guard: fails if a NEW hard-coded colour
# leaked into component code (reskins must touch only the token/paint layer).
step "Permanent-handle guard" node scripts/ui-system/handle-guard.mjs
step "Design-token leak guard" node scripts/ui-system/token-guard.mjs
# ── Connector outcome-contract reviewer check (F2.1) ─────────────────────────
# A connector operation must NEVER fail silently: no network/IO Result that
# affects a user-visible sync outcome may be swallowed by `.unwrap_or_default()`,
# `.unwrap_or(...)`, or `let _ = <io>`. A repo-wide clippy `disallowed-methods`
# ban on `unwrap_or_default` is infeasible (80+ legitimate JSON/serde defaults),
# so this stays a REVIEW check, not an auto-gate. When touching a connector under
# src-tauri/src/commands/{mail,onedrive,boxc,calendly,addepar,connector,crm,...},
# scan new/changed swallows and confirm each is either (a) pure JSON/string
# defaulting, or (b) disconnect-time best-effort cleanup — NOT a network/IO
# result that decides whether the user's sync succeeded:
#   grep -rnE '\.unwrap_or_default\(\)|\.unwrap_or\(|let _ =' src-tauri/src/commands/
# Consciously-left sites (best-effort by design) are documented in the F2.1
# handoff. New load-bearing swallows must propagate or surface instead.
step "Rust tests"      bash -c "cd src-tauri && CI=1 cargo test --workspace --locked"
# The real desktop loop must use a binary built from this exact, clean source
# tip. Keep it after Rust tests so it reuses warm Cargo artifacts, while the
# outer `npm run gate` box slot continues to serialize Rust work on this host.
step "Golden loop" bash -c 'cd src-tauri && cargo build --locked && ../scripts/golden-loop-launch-app.sh --record-provenance .. target/debug/lantern && ../scripts/golden-loop.sh .. target/debug/lantern'

if [ "$FULL" -eq 1 ]; then
  step "L1 browser E2E (sharded)" bash ./scripts/run-e2e-suite.sh en 6
  step "L2 desktop harness"       npm run test:desktop
  step "Golden CRM app loop"      npm run test:goldenloop
fi

echo ""
[ "$fail" -eq 0 ] && echo "✅ GATE GREEN" || echo "❌ GATE RED — see failures above"
exit "$fail"
