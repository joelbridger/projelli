# UX fleet merge queue (coordinator ledger)
Merge order: found → chrome/ask/clientmap/documents/email/meetings/workflows (as reviewed) → copy LAST.
| Lane | State |
|---|---|
| copy | ✅ REVIEWED-PASS (e6e8a12d) — holds for last merge. NEED-ASSET: Lantern logo file (BRAND.assets.logo → /logo.svg swap point) |
| found (Opus) | 🔧 FIX ROUND 1 — Codex review NOT-MERGE-READY: 2 BLOCKER (stale mode/provider frame; Assured mode missing from resolver) + 3 MAJOR (local-only honesty, duplicate egress testids, lost AI-settings click path). Packet found-fix1-packet.md |
| meetings (Opus) | ✅ MERGE-READY (80013566) — 2 fix rounds complete: 5/5 review findings + unmount edge fixed, failing-first tests, 483 scoped tests green, unmount fix re-verified by coordinator |
| clientmap | ✅ REVIEWED-PASS (66ffbb57; full pre-push suite green minus env-only OCR asset; stale baseline entry clientmap-edit-history — clean at merge) |
| workflows | ✅ REVIEWED-PASS (e2c941c2; 181 tests green; no skips) |
| ask | ✅ REVIEWED-PASS (d0957c97 + my gate repair for e2e/bench-smoke scope grips) |
| email | ✅ REVIEWED-PASS (81ae6c5d; full-suite failures were env OCR asset + a starvation flake that passes on re-run) |
| documents | ✅ REVIEWED-PASS (070b9017 + comment fix; aliasTestIds keeps old handles; legacy DocumentBrowser removed cleanly) |
| chrome | ✅ MERGE-READY (4fe36204) — core + follow-up round (all 30 audit items), 339 settings/onboarding tests green |
