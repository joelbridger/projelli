# QA Campaign — ROUND 2 (planned; fires on a stable tip)

**Why:** Round 1 (QA-1..42, all fixed) tested the app BEFORE today's 23 merges + the trust tiers + Notice Kit + Notice Card. The product changed enormously; the new surfaces have never had a fresh-eyes campaign. Jameson's standing order (2026-07-04): "we'll definitely need to do that again."

**The one rule (why it's not running yet):** test a STABLE target. Round 2 launches when the current feature wave has settled — the TRIGGER below — so findings don't churn under the campaign.

## Trigger (all three)
1. Notice Card (lp/notice-card) merged.
2. Tier B (lp/trust-tier-b) merged.
3. The 3 in-flight bench lanes (regression, cloudreg, bench2fresh) have reported (so Round 2 starts from a known regression baseline, not a guess).
*(Tier C P1 need NOT be merged first — it's evidence infra; Round 2 can note it as in-progress.)*

## Scope — same relentless machine as Round 1, re-aimed
Personas across all 3 Windows benches (Legion + bench-1 + bench-2) IN PARALLEL, plus the browser build:
- **A — brand-new advisor, first 30 min** on the CURRENT tip (onboarding + honesty pass changes get fresh eyes).
- **B — daily driver**, a compressed week, heavy on the NEW features (record meeting → notice kit consent script → notes → CRM push with the new outbound guards → the provenance line).
- **C — the klutz** (mis-clicks, cancels mid-flow, double-clicks) on the new consent/notice/record flows specifically.
- **D — edge-case hunter**, extending the catalog with the NEW surfaces: Notice Card join failures, notice-verification false positives/negatives, the provable-record export bundle + offline verifier (tamper it — it MUST fail correctly), retention deletion + citation annotation, biometric-consent flow.
- **NEW focus areas Round 1 never had:** (1) the trust-honesty surfaces — hunt for any REMAINING overclaim the Tier A pass missed; (2) the outbound guards (Tier B) — try to get unreviewed AI text OUT to CRM/email; (3) the Notice Card — join/leave/lobby/failure across Teams + Zoom on real hardware; (4) whichever Tier C rungs have landed — attack the evidence bundle as an adversary.
- **Real call-recording:** Zoom + Meet (once Jameson finishes the Meet account) added to the confirmed Teams.

## Operating rules (same as Round 1)
Explorers TEST + REPORT, never fix. Findings → coordination/qa-campaign/BUG-DB-round2.md (fresh DB, IDs QA2-1+). Coordinator triages → scoped fix lanes → merge → re-verify on a bench. Pace explorers to coordinator review capacity. Evidence under coordination/qa-campaign/evidence/round2-*.

## Standing cadence (Jameson's intent: "we'll need to do that again")
After Round 2: a comprehensive campaign becomes a RECURRING gate before any release candidate and after any large feature wave — not a one-off. The trigger pattern (stabilize → full campaign → fix to zero → re-verify) repeats.

## Added hunt items (from bench2fresh + the swallow-sweep, 2026-07-04 night)
- **Transcription-can-never-run → honest error, not eternal pending?** bench2fresh saw notes stuck on "Notes are being written…" forever because the ASR engine never ran (bench-2 sidecar setup gap, not a product bug there). BUT the real edge to verify on a properly-staged machine: if TRANSCRIPTION itself can't run/complete (vs the notes provider call, which QA-31/41 already guards), does the meeting show an honest error + retry, or stick on "pending" forever? Force it and check.
- **The 8 swallow-sweep findings (QA-44..51)** are targeted hunt areas — verify each live: the privilege/isolation leak (QA-44) especially, plus stuck-loading, no-reconnect sync, calendar-fail-as-empty.

## ⚠️ Bench discipline lesson (enforce in Round 2)
bench2fresh rebuilt on a PRE-Tier-A tip and reported the (already-fixed) false Data Map claim as a finding. **Every Round-2 bench MUST confirm and RECORD its exact tip SHA and rebuild AFTER the stability trigger** — a bench on a stale tip produces false findings. This is why the "stable tip" trigger matters.
