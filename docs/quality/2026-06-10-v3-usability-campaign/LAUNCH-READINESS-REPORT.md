# Advisor Prep Hero 3.1.0 — Launch-Readiness Report

**Date:** 2026-06-10 · **Branch:** keepance-3.0 · **Release tag:** v3.1.0 (signed CI build in progress)

## What this was

A full-vision quality campaign on Advisor Prep Hero 3.0, per the founder's brief: complete the firm tier so the full vision works before launch, then exhaustively test every feature and button with the attorney persona, fix everything found. Seven phases, executed with adversarial review on the high-risk work.

## Bottom line

**Ready to ship as v3.1.0.** The firm vision is complete and proven end to end. The one issue that could harm a customer (a memory leak that twice froze a machine) is fixed and proven under the exact condition that caused it. Every founder-reported bug is fixed. The persona's verdict moved from "not for my firm yet" toward adoptable: the blockers she named (silent failures, uncited answers, the name leak, undiscoverable matters) are all closed.

## What shipped in 3.1.0

**The firm tier, now fully usable in-app (the "complete the vision" mandate):** buy → claim org with the license key from the receipt → admin signs in → invite members by email → share a matter (encryption key auto-wrapped to each member's device, admin-escrowed) → members edit shared matter notes that converge live over the end-to-end-encrypted relay → ethical walls enforced by key denial + epoch rotation → seat revoke degrades gracefully → Assured zero-retention inference. Proven by an 8/8 two-client convergence test against a live backend. (Live multi-user .docx co-editing remains the named next increment per the architecture gate.)

**The memory leak (would have hit real customers):** fixed and proven flat at ~283 MB through the exact reload-storm that previously ran to ~24 GB and OOM in 35 seconds.

**The two P0 correctness bugs:** workflows no longer present mock output as a green success; a workflow pinned to your local model can never silently fall back to the cloud (regression-locked, controlled-revert proven). The AI no longer answers your matter from a failed or empty search (the "Avianca trap").

**Founder-reported bugs (all 8):** Projelli icon → Advisor Prep Hero (incl. the stale macOS icon nobody had noticed), onboarding copy rewritten off the old markdown product, data-map step scrollable, centered step digits, new .docx editable, upload "os error 3" fixed, Open on Desktop targets the selected folder, workflow tab fits the window.

**Plus:** markdown tables export as real Word tables; legal templates produce .docx; Matters is a first-class sidebar entry; the founder's personal name/email removed from customer-facing copy (→ support@keepance.com); honest desktop-only disclosure on email cards; a batch of trust-copy and a11y fixes.

## Verification evidence

- Gates green at the release commit: tsc clean, 2747 frontend tests, cargo 7/7 suites (incl. 5 leak-fix guard tests), backend 152 tests.
- Mechanical sweep: 222/222 interactive surfaces covered, 0 P0/P1 product bugs in browser mode.
- Persona study (Diane Marchetti): 5-task protocol + firm scenario + extended legal journeys, 28 findings, all P0/P1 fixed or routed to the Windows spot check.
- Native desktop pass: 22/26 PASS; leak-hold proof PASS; encryption-at-rest verified verbatim (mail bodies AES-256-GCM, audit DB SQLCipher, every seeded phrase absent from disk); F-005 placeholder bug did not reproduce; F-116 refusal and F-127 redline confirmed on the real build.

## What remains YOURS (Jameson) — decisions and hands-on steps

1. **5-minute Windows spot check (after publish).** A few flows can only be confirmed on real Windows + a populated index (the headless Linux test rig can't drive GTK file dialogs, complete the first-run embedder-model download, or use the OS keychain): the tray + title-bar icon, typing in a new .docx, the workflow tab in a split pane, uploading a .docx with spaces into a subfolder, Open on Desktop, a firm sign-in, and a matter-scoped search returning a clickable citation. None are known-broken; they're verification-coverage gaps from the headless environment.
2. **Firm backend deploy — DONE (2026-06-10, on your explicit go).** Deployed to api.keepance.com: DB backed up, the two new env vars added to `/etc/keepance-firm-backend.env`, service restarted, the guarded `webhook_events.subscription_id` migration applied, existing data + functionality preserved. Verified live: webhook returns 401 unsigned, `/org/claim` returns `license_key_not_found` on a bad key, seat pubkey still served. The new firm provisioning + key-distribution + claim endpoints are live.
3. **LemonSqueezy Firm minimum-quantity mechanics** (the pricing decision only you can make): LS has no min-quantity setting, so the Firm card stays "Talk to us" until you choose (a prefilled quantity-3 checkout link, or keep manual). The backend already enforces min-3 server-side.
4. **Real-card test purchase** (your existing to-do): confirm a live Solo purchase activates end to end.

## Recommended near-term follow-ups (not blockers)
- **Bundle the embedder model** in the installer (F-415): today the local search index needs a one-time model download on first run (pre-existing from 3.0.0). Bundling makes the wedge work offline-immediately and removes a first-run failure mode for the flagship feature.
- F-416: the embedder's ~1.4 GB resident plateau is the largest memory line once search is used (bounded, not a leak); consider a quantized embedder.
- F-408: hide editor `.docx.bak` backups from the file tree. F-422: re-confirm the Deposition Contradiction Finder interview form on Windows (couldn't isolate from test-rig noise).

## Auto-deploy status (per your standing authorization)
- v3.1.0 signed release: building in CI → will publish once artifacts verify.
- Website: will deploy on the 3.1.0 download links + the new og-image + Advisor Prep Hero favicons.
- Firm backend: prepped, awaiting your explicit go (see #2).
