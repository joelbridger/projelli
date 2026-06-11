# Next-session handoff — Keepance, 2026-06-11

**Read this first.** Branch `keepance-3.0`, everything committed + pushed (`HEAD == origin/keepance-3.0 == 165499d`, working tree clean). This session ran a long autonomous push toward **100% of the north-star vision** (board mandate Q7-revised: zero exceptions). Plan of record: `docs/strategy/2026-06-10-vision-gap-closure-plan.md`. Project memory: `~/.claude/projects/-home-jameson/memory/project_keepance_3_0.md` (updated this session).

## The single most important next action
**Wave 2 has TWO items left before it closes:**
1. **Review Tasks 12 + 13** (committed, pushed, gate-green, but the combined spec+quality review was cut off at the start when the session paused). Commits `165499d` (VG-4c letterhead) and `d20844f` (VG-3d issue spotter). Re-dispatch the combined review (the prompt is reconstructable from the wave pattern; key things to verify: letterhead `merge_into_template` reconciles the GENERATED content's own relationships — hyperlinks/images/numbering — not just the sectPr drop, i.e. does a merged deliverable with a hyperlink keep it or dangle; and the opt-in/fail-open branches).
2. **Run the finale, Task 14** of `docs/superpowers/plans/2026-06-11-wave2-ingest-everything.md`: full gates + the **leg-3 native re-run** with everything in (OCR over the scanned fixtures, office-content citations, "Tr. N:M" transcript citations, the matter-scoped **capped** finder run — this is where F-510's rubric should recover to ≥3/5 with the per-source cap live — the hardened token store, letterhead) + RESULTS §F addendum + the consolidated CHANGELOG + strategy STATUS ticks. Check `free -h` before native launches (box is memory-tight); the harness is `scripts/wedge-proof-native.sh` (preflight/up/seed-localstorage/launch/shot/assert/down).

## What shipped this session (all on keepance-3.0, all pushed)
- **v3.1.0 PUBLISHED + keepance.com DEPLOYED** (signed installers live, updater serving 3.1.0, site smoke-tested; SSO claim + email leak gone, Firm self-serve checkout live).
- **Option B** (visible resumable model download) — 7 tasks, real 465MB download proven; the original silent-stall is fixed.
- **VG-1 wedge proof** — the flagship moment OBSERVED end-to-end on the real machine for the first time (cited answer → verify → click-through → contradiction finder → .docx). 9 findings logged (F-501..F-509). Evidence: `docs/quality/2026-06-11-wedge-proof/`.
- **Wave 1 fix wave** — 14 tasks; F-501..F-509 ALL fixed + re-verified on the machine (incl. the indexing-crash now bounded at ~2.5GiB, local-only workflows resolving product-side, citations verifying green on the local tier, scroll-to-passage, the xlsx formula-loss data bug). New finding F-510 logged. RESULTS §E.
- **Wave 2 (ingest everything) — Tasks 1-13 done, 14 (finale) pending:**
  - **VG-2b office content into the index** (docx/xlsx/pptx/rtf) — Word contracts now retrieve with verifying citations. Bonus: fixed a pre-existing **silent data-loss bug** in the docx engine (ampersands in firm names dropped on every save) + the attribute-escape-growth sibling.
  - **F-510 per-source diversity cap** (finder retrieval precision) + **verifier canonicalization** (case/curly-quote, not fuzzy — clears the 14 stranded textMismatch sides).
  - **VG-2 OCR** — scanned filings searchable (tesseract-wasm, fully local; spike decision in `spikes/ocr-engine/DECISION.md`; the planted ruling came back verbatim at 95+ confidence, noisy fax honestly <60). Caught a production-killer: pdfjs buffer-transfer (DataCloneError) + a pdfjs worker leak (both fixed).
  - **VG-3c transcript page:line citations** ("Tr. 2:14"). Fixed a lost-page-header locator-drift defect found in review.
  - **VG-6e vector-store hardening** — path/source_id tokenized (HMAC), path encrypted at rest; raw-disk scan proves zero plaintext paths incl. txn logs.
  - **VG-6b Assured mode** — exercised LIVE against api.keepance.com; **zero-retention PROVEN** (sentinel absent from all 16 DB tables + journal). "Coming soon" removed (it's real now).
  - **VG-4c letterhead** + **VG-3d issue spotter** (legal pack now 19/19 .docx).
  - INDEX_VERSION ladder: now at **10** (one re-index on update covers all of Wave 2's schema changes).

## ⚠️ SECURITY — fixed live this session, one follow-up queued
`api.keepance.com/admin/org` was internet-reachable, **unauthenticated**, and could mint Firm orgs + license keys (the `@firmapi` Caddy block had no path filter). **CLOSED at the edge** (`/admin/*` → 403; backup `/etc/caddy/Caddyfile.bak-admin-block-20260611-115444`; verified: admin blocked, webhook/claim/health still live). Full detail: `backend/deploy/RUNBOOK.md` §K. **Follow-up WAVE2-FU-02** (in `BACKLOG.md`): add an in-app guard to `handleCreateOrg` so the backend doesn't rely on the edge rule alone — keep `/webhooks/lemonsqueezy` (HMAC) + `/org/claim` (key-as-secret) public; the Assured exercise script uses the loopback admin route so it must keep working (pass the secret / run from loopback).

## Needs Jameson (cannot automate)
- **A valid Anthropic API key** in the off-repo env (`~/.local/share/jameworld/keepance-assured-test.env`) to finish the ONE remaining Assured sub-step (a clean 200 + completion). Every Anthropic key on the server is revoked/stale (the local-model gateway made them go cold) — this likely affects other server tools that call Anthropic directly, worth a broader look.
- The standing **proof moat** (VG-7): formed legal entity → executed DPA → SOC 2 → named-attorney references; the ~5-min Windows spot check; one real-card test purchase; one attorney reviewing a contradiction-finder .docx. None block the build.

## Vendor access track (VG-9, for Wave 5 connectors — all filed, awaiting their humans)
`docs/operations/2026-06-10-vendor-access-track.md`. Clio (trial submitted; SDR thread replied — awaiting dev-program routing), NetDocuments (Customer Care escalation pending), iManage (partner application receipted). All reply to `developers@keepance.com` (readable via the `outlook` CLI). Jameson's cell 650-513-9986 is authorized for signups.

## After Wave 2: remaining waves to 100%
Per the gap-closure plan: **Wave 3** = SSO (OIDC: Entra ID → Google → generic) + the real encrypted workspace vault (both committed, "functional to sell"; the vault needs its own brainstormed design doc + destructive-failure test suite before code). **Wave 4** = live multi-user .docx co-editing (spike gate overridden; rigor moves into verification). **Wave 5** = Clio/Office-add-ins/DMS connectors as vendor access lands. Plus the F-510 leg-3 confirmation and the small carried follow-ups in RESULTS §E/§F.

## Working rhythm that worked this session
Subagent per task → independent spec review → independent quality review → fix-round → re-review; tripwire tests as done-signals; the orchestrator applies small review-found fixes directly and commits/pushes. Reviews caught real bugs at nearly every step (the silent data-loss bugs, the security hole, the pdfjs killers, the locator drift). Keep that bar.
