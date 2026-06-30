# Next session handoff — Advisor Prep Hero v3.1.0 publish + what's next

> **⚠️ SUPERSEDED (2026-06-10 evening).** STEP 1 below is DONE: v3.1.0 is published (signed installers live, updater serving 3.1.0) and keepance.com is deployed + smoke-tested. STEP 2 (Option B) is IN FLIGHT via `docs/superpowers/plans/2026-06-10-option-b-model-download.md`. STEP 3 is replaced by the board-ratified plan of record: **`docs/strategy/2026-06-10-vision-gap-closure-plan.md`** (100% vision completion, zero exceptions, board Q7 revised — includes SSO, encrypted vault, .docx co-editing, and all connectors; vendor access applications already filed, see `docs/operations/2026-06-10-vendor-access-track.md`). Start from the project memory + that plan, not this file.

**Read this first.** Branch `keepance-3.0`, all work committed + pushed. This session ran the full-vision quality campaign (leak fix, P0s, firm tier completion, persona study, sweep, native pass, fix wave) and cut the v3.1.0 release. One thing is mid-flight: the signed installer build.

## STEP 1 (do this first): publish v3.1.0, then deploy the website

The v3.1.0 tag is pushed; the signed CI build (`gh run view 27290737774`, workflow `release.yml`) was still **in_progress** at handoff and produces a **draft** release. When it's green:

1. `gh run view 27290737774 --json status,conclusion` → confirm `completed / success`. If it failed, read the failing job logs (signing/cert issues are the usual suspect) and fix before publishing.
2. `gh release view v3.1.0 --json isDraft,assets` → confirm the draft has all signed artifacts (Win .exe, mac .dmg arm+intel, Linux .deb/.rpm/.AppImage, `latest.json`).
3. **Cross-check the download-page asset filenames** in `website/download/index.html` (bumped to `Advisor Prep Hero_3.1.0_*`) against the ACTUAL published asset names (`gh release view v3.1.0 --json assets -q '.assets[].name'`). The .rpm/.dmg naming scheme can differ; fix the page if so before deploying.
4. Edit the release notes from `CHANGELOG.md` `[3.1.0]`, then publish: `gh release edit v3.1.0 --draft=false`. Confirm the auto-update endpoint serves 3.1.0 (`releases/latest/download/latest.json`).
5. Deploy the website (it has uncommitted-to-prod changes: SSO/email integrity fixes, 3.1.0 download links, Firm self-serve checkout, new og-image, Advisor Prep Hero favicons): `~/keepance/infra/deploy.sh` (rsync website/ → /var/www/keepance.com + CF cache purge). Do NOT deploy the site before the release is published (download links would 404).
6. Smoke-test: keepance.com loads, download buttons resolve to real v3.1.0 assets, no "Jameson"/"SSO" on the live Firm card.

(Commercial deploy is pre-authorized by Jameson 2026-06-10 for publish + site. The firm backend is ALREADY deployed live, see below.)

## What shipped this session (all committed on keepance-3.0)
- **Memory leak FIXED** (was OOM-freezing the host): `rag_index_workspace` indexed once-per-activation instead of every workspace open. Proven flat ~283MB vs pre-fix OOM-in-35s. (`src-tauri/src/commands/rag/mod.rs`)
- **Two P0s FIXED + regression-locked:** workflows no longer present mock output as success; a local-pinned workflow can never fall back to cloud (`resolveWorkflowProvider`, controlled-revert proven). AI refuses rather than answering from a failed/empty search (the Avianca trap). All 8 founder-reported bugs fixed (icons, onboarding copy, data-map, docx editable, os-error-3, Open-on-Desktop, workflow overflow).
- **Firm tier COMPLETED + backend DEPLOYED** to api.keepance.com: claim-org, LS webhook provisioning, cross-member ECDH key distribution, live shared notes (8/8 two-client convergence), ethical walls by key-denial, seat revoke. Backend grants exactly the seats purchased (`seat_limit = quantity`; pricing policy fixed 2026-06-10).
- **Firm self-serve checkout** wired on the website (prefilled quantity-3; the soft min-3 floor). Firm card no longer "Talk to us".
- **Trust-copy + integrity fixes:** name/email leak removed (app + live site), false "SSO" claim removed from site + `src/config/pricing.ts`, markdown→Word tables, legal templates → .docx, matters sidebar entry, honest desktop-only disclosure on email cards.
- Gates at handoff: tsc clean, 2747 vitest, cargo 7/7, backend 152.

## STEP 2 (decided, build next): Option B — robust embedder-model download
**Decision locked (Jameson, 2026-06-10):** do NOT bundle the 930MB model into the installer (it would make installers ~950MB). Instead make the first-run model download **visible and reliable**: a clear "downloading your private search engine (~465MB), one time" progress screen with retry/resume, replacing today's silent/fragile download. This removes the "search silently does nothing on first run" failure (the flagship-wedge risk) without a giant installer.
- Groundwork already committed (don't redo): `src-tauri/src/bin/prefetch_model.rs`, `resolve_cache_dir()` in `embedder.rs` already prefers a bundled path, model blobs gitignored. The release.yml prefetch step was intentionally NOT activated (reverted) — leave it off for Option B.
- Build: surface fastembed download progress from `embedder.rs` (the `with_show_download_progress` / a Tauri event) to a first-run UI; handle offline/failure with a retry and a clear message; ensure the AI search degrades to an honest "search isn't ready yet" state until the model is present. Consider option C (a ~110MB quantized e5-small) as a follow-up if you want offline-on-install cheaply.

## STEP 3+: the vision-coverage gaps (full audit: `docs/quality/2026-06-10-v3-usability-campaign/VISION-COVERAGE-AUDIT.md`)
~2/3 of the north-star vision is real. Prioritized remaining gaps:
- `[blocks-the-wedge]` OCR for scanned PDFs (detected then ignored, `src/lib/pdf-extract.ts:23`) — add a Tesseract sidecar (roadmap WS-B).
- `[blocks-a-website-claim]` "Fits beside Clio" is positioning only, no connector — keep the philosophy, don't imply a connector.
- `[firm-tier]` SSO/SAML (now removed from copy; build OIDC against the firm backend before re-claiming), optional encrypted document vault, the firm key-handshake auto-publish (F-123/F-010).
- `[nice-to-have]` PDF export silently needs LibreOffice (`fs.rs`) — detect-and-explain or bundle a converter.

## Jameson-owned (cannot be automated)
1. **~5-min Windows spot-check** (the headless Linux rig couldn't drive these; none known-broken): tray/title icon, type in a new .docx, upload a .docx with spaces, Open-on-Desktop, a firm sign-in, and one matter-scoped search returning a clickable citation (needs the model downloaded).
2. **Real-card test purchase** (Solo) end to end.
3. **The proof moat** — named-attorney references, a formed legal entity, executed DPA/SOC 2. The research says this is what actually gates the firm sale. Slow, board-level, can't be coded.

## Campaign artifacts (all under `docs/quality/2026-06-10-v3-usability-campaign/`)
LAUNCH-READINESS-REPORT.md, VISION-COVERAGE-AUDIT.md, FIX-WAVE-PLAN.md, findings.md, persona-findings.md, persona-study-transcript.md, sweep-findings.md, native-findings.md, leak-investigation.md, coverage-ledger.md (222 rows). Plans: `docs/superpowers/plans/2026-06-10-*`. Firm ops: `docs/operations/2026-06-10-firm-provisioning.md`.
