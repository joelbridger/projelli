# Vision Gap Closure Plan

**Date:** 2026-06-10 · **Owner:** autonomous build (Claude) + Jameson where marked · **Status:** approved direction, workstreams execute in sequence below

**Board decision 2026-06-10 (Jameson, recorded as Q7 in `KEEPANCE_BUSINESS_PLAN.md`):** target is **100% completion of the vision document**. SSO and the real encrypted vault are COMMITTED builds (moved out of demand-gated; "functional to sell"). Clio/DMS/add-ins stay deferred until a design partner asks. This version of the plan reflects that decision.

**What this is.** The full plan for closing every gap in the North-Star Vision Coverage Audit (`docs/quality/2026-06-10-v3-usability-campaign/VISION-COVERAGE-AUDIT.md`). Each workstream names the audit gap it closes, the approach, how we verify it, a relative size (S/M/L), and dependencies. Detailed per-workstream implementation plans (file-level, TDD) get written at build time under `docs/superpowers/plans/`, the same way Option B was planned.

**The audit in one line:** about two-thirds of the vision is real and proven (and it is the hard two-thirds: the Word engine, cited retrieval + verification, refuse-rather-than-hallucinate, encryption at rest, the E2EE firm tier). The unproven third is concentrated in five places: the wedge has never been observed end to end on a real machine, scanned PDFs are invisible to search, two website claims outran the product, and the social-proof moat is empty.

---

## 1. Scoreboard (what the audit found)

| Area | Verdict | The gap that matters |
|---|---|---|
| Job 1: find anything, privately (the wedge) | Built, unverified | Cited AI answer over a populated index never observed on a real machine (embedder model not bundled, download fragile) |
| Job 2: the litigation associate | Built, unverified | Contradiction finder never completed a real run; no attorney has judged output quality |
| Job 3: real Word deliverables | Built + verified | PDF export silently requires LibreOffice; no letterhead manager |
| Six non-negotiables | 5 of 6 substantively met | PDF (above) and "fits beside Clio" (positioning only) |
| Pillar 1: ingest everything | Partial | No OCR: scanned filings (court stamps, faxes) are invisible to search |
| Pillar 5: trust layer | Partial (strong) | Assured mode real but never exercised; document files rely on OS disk encryption (no vault) |
| Pillar 6: firm tier | Partial (stronger than expected) | SSO was advertised but does not exist; key handshake choreography; assurance docs are templates, not instruments |
| Pillar 7: integrations | Mostly gap | Clio: zero integration code behind the positioning |
| Moat | Partial, proof leg empty | No named attorneys, no entity, no executed DPA/SOC 2 |

## 2. Already closed (this session, before this plan)

| Audit gap | Status |
|---|---|
| #3 false "SSO" claim on site + in-app pricing | Removed (commit c0454da); goes live with the v3.1.0 site deploy. Re-claiming SSO is gated on actually building it (VG-6c) |
| #4 personal email leak in the site contact form | Fixed in the same commit; live with the deploy |
| #1 fragile first-run model download | Option B IN FLIGHT right now: visible, resumable download with progress + retry; search/indexing honestly say "not ready yet" instead of silently stalling. Plan: `docs/superpowers/plans/2026-06-10-option-b-model-download.md` |
| #9 key-handshake looks broken on first open | The honest "waiting for your firm admin to grant this device access" state shipped in v3.1.0. The remaining half (auto-publish so the wait mostly disappears) is VG-6a |
| "licence" typo (F-103) | Already gone from the codebase |

---

## 3. Workstreams

### VG-1: Prove the wedge end to end (audit gap #1, the audit's top priority)
**Why.** The single product promise (ask a question, get a cited answer from your own files, click the citation, see the source) has never been watched working end to end on a real machine. Everything else is downstream of this.
**Approach.**
- After Option B lands: on this Linux rig, run the full happy path against a populated index: ingest the campaign's fixture corpus (docs + PDFs + the planted-contradiction deposition fixtures), ask natural-language questions, assert a cited answer renders, the citation verifies, and click-through opens the right passage. Script it as a repeatable e2e harness (Playwright against the dev build with the real model already cached on this rig) so it runs in every future campaign instead of being a one-off.
- Matter isolation assertion in the same harness: a Matter-A query never returns Matter-B content (the roadmap's own exit gate).
- The real-Windows half is Jameson's existing 5-minute spot check (VG-7), now made meaningful because Option B removes the first-run stall that blocked it.
**Verify.** Harness green on the rig + Jameson's Windows spot check returns a clickable citation. The harness also picks up two small unverified-in-campaign items for 100% coverage: an xlsx/pptx round-trip assertion, and confirmation that live audit events are captured on a real (keychain-bearing) machine as part of the Windows spot check.
**Size.** M. **Depends on:** Option B complete.

### VG-2: OCR for scanned PDFs (audit gap #2)
**Why.** Litigation runs on scanned paper: court-stamped filings, faxed exhibits, service copies. Today `src/lib/pdf-extract.ts:23` detects a scanned PDF and then ignores it, so it is invisible to search. The vision names OCR explicitly; this is the biggest remaining build.
**Approach.**
- Local OCR per roadmap WS-B, evaluated in this order: (a) Tesseract as a Tauri sidecar binary per platform (fast, proven, ~20 MB per platform with English traineddata), (b) tesseract-wasm in-process as fallback if sidecar packaging fights us (slower, zero packaging risk). Decision recorded at implementation-plan time with a spike if needed.
- Pipeline: scanned-page detection (exists) routes pages to OCR; OCR text feeds the SAME chunk/index path as native text with a `source: ocr` flag on chunks; page-level citations preserved; confidence below a threshold marks the chunk "low-confidence scan" so citations can disclose it (propose-don't-decide discipline extends to OCR quality).
- All local, nothing leaves the machine (consistent with the egress story; the data map gains an OCR line).
**Verify.** Fixture pack of scanned filings (court stamp, fax artifact, skewed scan); assert search finds content, citations open the right page, low-confidence flagging fires; the indexing banner shows OCR progress honestly (it is slow on big filings).
**Size.** L. **Depends on:** nothing (parallel-safe with VG-1), but its end-to-end proof rides the VG-1 harness.

### VG-3: Litigation associate, run for real and hardened (audit gap #5, buildable half)
**Why.** The flagship contradiction finder has never produced its planted contradictions in a full run (it hard-requires matter-scoped retrieval, which was blocked by the empty index). Two design weaknesses also surfaced: it refuses entirely instead of falling back to materials the user pasted in, and transcript ingest is generic (no page:line awareness).
**Approach.**
- (a) Full planted-contradiction run on the rig as part of the VG-1 harness: the campaign fixtures exist; assert the finder surfaces the planted contradictions, cited, into a real .docx.
- (b) Honest fallback: when retrieval is unavailable or empty but the user pasted excerpts into the interview step, analyze the pasted material and SAY SO in the output header ("analyzed only the excerpts you provided; workspace retrieval was unavailable"). Refusal stays for the answer-from-nothing case.
- (c) Transcript-aware ingest: detect deposition transcript structure (the standard line-numbered format) at ingest and carry page:line into chunk metadata so citations read "Tr. 45:12-46:3" instead of a bare page. Generic chunking remains for everything else.
- (d) Add the dedicated issue-spotter template the vision names (small; the adjacent templates make this mostly configuration).
**Verify.** Harness assertions for (a) and (b); fixture transcript for (c) shows page:line citations; template renders for (d). Output-quality validation by a real attorney stays in VG-7 (cannot be coded).
**Size.** M ((a) and (b) small, (c) medium, (d) small). **Depends on:** VG-1 harness for (a).

### VG-4: PDF export that never silently fails (audit gap #6)
**Why.** `convert_docx_to_pdf` needs an installed LibreOffice; a lawyer without it gets nothing. The vision promises PDF deliverables.
**Approach.**
- (a) Detect-and-explain now: before offering PDF export, run the existing `detect_libreoffice`; when absent, show exactly what to install and why ("Keepance converts Word to PDF locally using LibreOffice, a free program; nothing leaves your machine"), with a copyable link. No silent failure path remains.
- (b) Bundling evaluation, honestly scoped: full LibreOffice is too big to bundle (hundreds of MB); pure-Rust DOCX→PDF is not filing-grade yet. Likely verdict is "explain, don't bundle," recorded with evidence so the decision is closed rather than lingering.
- (c) Letterhead: a small template-management affordance (pick a firm .docx template; new documents and workflow outputs start from it). This is the vision's "on letterhead" without building a designer.
**Verify.** Export attempt without LibreOffice shows the explanation (test by PATH-masking in dev); with it, produces the PDF. Letterhead template applies to new docs and workflow output.
**Size.** S for (a), S for (b) (a written evaluation), M for (c). **Depends on:** nothing.

### VG-5: Trust polish batch (audit table-level findings)
**Why.** Four small honesty/comprehension items the persona flagged; cheap, and the trust story is the moat.
**Approach.**
- (a) F-120: positive egress signal in Direct mode (status bar shows a quiet "sending to your provider" state when cloud egress happens, not just the loud green when local). Loud when safe, visible when not.
- (b) F-121: privilege exclusion explained in-product where the toggle lives: one sentence + a "see it work" link that runs the adversarial demo query against the user's own index (the withheld-top-hit proof the campaign already scripted).
- (c) Surface the per-message mail privilege UI the engine already supports (tag a single email privileged from the mail viewer).
- (d) Clio copy precision: keep the philosophy ("the private AI layer beside Clio, not a replacement"), drop any phrasing that reads as a connector ("sits on top of the tools you already live in" gets tightened); no integration implied until one exists.
**Verify.** Unit/e2e per item; copy reviewed against the voice rules.
**Size.** S each. **Depends on:** nothing.

### VG-6: Firm tier completion (audit gaps #3 build-half, #8, #9 remainder, Pillar 5/6 residuals)
**Why.** The firm cryptography is built and verified; what remains is choreography, exercise, and two deliberate scope decisions.
**Approach.**
- (a) Key-handshake auto-publish (F-123/F-010 remainder): when a member registers a device, notify the admin client (or poll on the admin console) and auto-republish wrapped keys, so the member's wait state usually resolves without a human dance. The honest waiting state stays as the fallback.
- (b) Exercise Assured mode end to end against the LIVE backend (org with a managed key, chat routed through the zero-retention proxy, egress indicator showing Assured, sentinel guard verified). It is the differentiating rung of the confidentiality spectrum and has never been run for real. Also remove the stale "Coming soon" comment.
- (c) **SSO, COMMITTED (board 2026-06-10): build it now, functional to sell.** OIDC authorization-code flow against the firm backend: per-org identity-provider configuration in the firm admin console (Microsoft Entra ID first because law firms live on M365, Google Workspace second, generic OIDC third; SAML explicitly out of v1), member sign-in through the system browser, exchanged into the existing Ed25519 seat-token session, walls/seat semantics unchanged. Verified against a self-hosted test IdP (Authentik on this server) plus a real Entra ID tenant when available. The site and pricing re-claim "SSO" ONLY in the release that ships it (the honesty rule that got us here).
- (d) **Encrypted workspace vault, COMMITTED (board 2026-06-10): build the real thing.** Two stages, both committed: v1 immediately = unmissable disk-encryption guidance (onboarding step + data map line with the OS-specific "check it is on" instructions) so users are protected while v2 is built. v2 = optional per-workspace encrypted vault: document files encrypted at rest (AES-256-GCM, the same primitives the mail store already uses), master key in the OS keychain, an explicit recovery phrase generated at vault creation (with a "Keepance cannot recover this for you" ceremony), firm-tier admin escrow reusing the existing ECDH escrow machinery, transparent open/edit through the app, and a decrypt-everything escape hatch so "your files are always yours" stays true. LARGE and data-loss-sensitive: gets its own brainstormed design doc + implementation plan + a destructive-failure test suite (kill the app mid-write, wrong key, lost keychain) before any code ships.
- (e) Vector-store residual hardening: encrypt the remaining plaintext columns (`path`, `source_id`) the same way `chunk_text` already is, and document the embedding-vector residual in the data map (vectors are not meaningfully reversible but the data map should say they exist). Closes the re-identification note honestly.
**Verify.** (a) two-client test extends the existing 8/8 convergence suite; (b) a scripted live-backend session with artifacts; (c) OIDC against a test IdP (Authentik on this server) + a live IdP when a firm appears; (d) onboarding + data map tests; (e) store tests + a raw-sqlite inspection assertion.
**Size.** (a) M, (b) S, (c) L, (d) S now / L later, (e) S-M. **Depends on:** nothing technical; (c) and (d)-v2 are demand-gated.

### VG-7: The proof moat + real-machine validation (audit gaps #5 attorney-half, #10; Jameson-owned)
**Why.** The research and the persona agree: firm adoption gates on people and instruments, not features. None of it can be coded.
**The list (in leverage order):**
1. The 5-minute Windows spot check (already on your plate; VG-1 makes it meaningful: icons, type in a new Word doc, upload a doc with spaces, Open on Desktop, firm sign-in, one matter-scoped search returning a clickable citation).
2. One real-card Solo purchase end to end.
3. One attorney reviews the contradiction-finder .docx output (the un-drafting gate for the legal templates). One person, one sitting, after VG-3a produces the artifact.
4. Live email import on a real mailbox (your Outlook; needs your interactive sign-in approval once; I drive the rest).
5. The slow leg, sequenced: formed legal entity → executed DPA capability → SOC 2 engagement → named attorney advocates (design partners) → CLE/content presence. The entity gates the instruments; the briefs for DPA/SOC 2 already exist in `docs/legal/` and `docs/trust/`. The financial repository's milestone framework (`~/financial/08-recommendations/minimum-viable-launch.md`) is the template for sequencing this without overcommitting.

### Deliberately deferred (named so they stop haunting audits; ratified by the board 2026-06-10)
- **Clio connector, DMS (NetDocuments/iManage), Word/Outlook add-ins (roadmap WS-H):** deferred until a design partner asks (Jameson's explicit call for Clio; same logic extended to the rest of WS-H). The honest positioning (VG-5d) covers coexistence claims meanwhile. These are the ONLY vision items outside the 100% target, and each has a named re-entry trigger.
- **Live multi-user .docx co-editing:** stays gated on design-partner validation per `spikes/firm-sync/DECISION.md`. Shared matter notes converge today; that is the shipped story.
- **Bundling the embedder model in installers:** rejected by decision 2026-06-10 (Option B instead).

---

## 4. Sequencing

```
NOW (in flight)     v3.1.0 publish + site deploy ........ closes #3, #4 live
                    Option B visible model download ...... closes #1 (path)
WAVE 1              VG-1 wedge proof harness ............. the audit's top ask
(after Option B)    VG-3a/b finder run + honest fallback
                    VG-4a PDF detect-and-explain
                    VG-5 trust polish batch (a-d)
                    VG-6a handshake auto-publish
                    VG-6d-v1 disk-encryption guidance
WAVE 2              VG-2 OCR (the big ingest build)
                    VG-3c transcript-aware citations
                    VG-6b Assured exercised live
                    VG-6e vector-store hardening
                    VG-4c letterhead, VG-3d issue spotter
WAVE 3 (firm-sale   VG-6c SSO (OIDC: Entra ID, Google, generic)
 builds, committed) VG-6d-v2 encrypted workspace vault
                    -> site re-claims SSO + vault claims ONLY when shipped
DESIGN-PARTNER-GATED  WS-H integrations (Clio/DMS/add-ins), .docx co-editing
PARALLEL (Jameson)  VG-7 items 1-5, any order; entity unlocks the instruments
```

Waves 2 and 3 touch disjoint subsystems (ingest vs firm backend/auth), so Wave 3 may start while Wave 2 is in flight if orchestration capacity allows; the order above is the default. Each wave gets its own implementation plan + subagent-driven execution + verification artifacts under `docs/quality/`, and the coverage ledger gets updated rows so the next audit diffs cleanly against this one. **Definition of done for this plan: a re-run of the vision coverage audit returns 100% of in-scope commitments BUILT + verified, with the three design-partner-gated items as the only named exceptions.**
