# Demo recommendations — implementation tracker

**Branch:** `feat/demo-recs` (worktree `/home/jameson/kp-demo-recs`, off `keepance-3.0`)
**Source of recs:** `~/keepance-coordination/DEMO-RECOMMENDATIONS.md`
**Surface:** the REAL app / web demo (`src/`), per `docs/operations/SURFACES.md` — NOT the recorded video.
**Scope:** implement ALL recs EXCEPT #4 (privacy-artifact removals) and #10 (local-AI line) — Jameson opted out of those two. #14 is roadmap, not demo edits — skipped.

Status legend: ⬜ todo · 🟦 in-progress · ✅ done · 🚩 done-with-flag · ⏭️ skipped (out of scope)

| # | Rec (short) | Status | Notes / evidence |
|---|---|---|---|
| 1 | Demo client files `.md`/`.aichat` → realistic **PDFs + Word docs** | ✅ | Webb folder is now `Webb Financial Plan.docx`, `Annual Review Notes - June 2026.docx`, `Beneficiary Designations.pdf`, `Client Intake.pdf` (+ root README/About .md = demo chrome). `.docx` generated at seed time from markdown (`markdownToDocxBytes`); `.pdf` are committed assets (headless-Chrome from `src/web-demo/sample-docs/*.html`, regen `node scripts/build-demo-pdfs.mjs`). Retriever still indexes the text. **Live-verified:** OPFS holds the 4 real binaries (no .md/.aichat), `.docx` renders in docx-preview, 0 console errors. `Plan review.aichat` removed (see flags). |
| 2 | Show safety behaviors: Ask **refusing** + **click a citation through to the real source** | ✅ | Refusal already real (BUG-016 gate → "I couldn't find anything about that in your documents."); added a calm "this is on purpose — I only answer from your files" note (TurnBlock) instead of the red "verify" warning. Added a deliberately out-of-scope demo question ("Do the Webbs have any life insurance?") so the refusal is one click. **Live-verified:** clicking the stale-beneficiary chip opens `Beneficiary Designations.pdf`; clicking a plan chip opens & renders `Webb Financial Plan.docx`; all 4 Webb question chips render. (Live-model refusal needs the demo proxy — governed by the existing tested gate + askPrompt.) |
| 3 | Reframe connect-data: "bring your files however they live — connectors are a bonus" | 🚩 | **FLAGGED — not yet edited.** Lives in `src/features/onboarding/v2/scenes/ConnectScene.tsx` + `copy.ts` — **collision risk with the `feat/onboarding-journey` session.** Needs coordinator go-ahead before I touch onboarding. |
| 4 | REMOVE privacy-contradicting artifacts | ⏭️ | **OPTED OUT by Jameson.** |
| 5 | One-line coverage caveat near beneficiary catch | ✅ | Added to the Client Map "What I'm still missing" completeness panel (`ClientMapPanel.tsx`): "Built from the files Keepance can read — a head-start for your review, not a guarantee the whole record is complete." **Live-verified** rendering. |
| 6 | Open-the-folder data-ownership proof | 🚩 | The "show the real Word/PDF files" half is delivered by #1 (file tree now shows real binaries) + existing copy (README + `DataMapDialog`: "a normal folder on your own hard drive… opens and edits those files in place"). **FLAGGED:** a literal OS "Reveal in folder" is desktop-only (web-demo OPFS can't be revealed) and no such affordance exists — recommend a desktop follow-up + recording that beat on the desktop app for the video. |
| 7 | Visible client boundary ("Webb household only") | ✅ | Persistent neutral badge in the Client Map header (`MatterHub.tsx`): "👥 Webb Household only" (generic `{matter.name} only`, with a tooltip about matter isolation). **Live-verified.** Renders for every client (desktop too) — flagged for Codex/desktop-safety review. |
| 8 | Two-trust-modes line (Ask cited vs Workflows drafted) | ✅ | Demo-only intro on the empty Ask surface: "Answers here are cited to your files… For drafting documents, use Workflows, and check current-year figures before you send." Gated `IS_DEMO` so desktop's clean empty Ask is untouched. **Live-verified.** |
| 9 | Close: lead ROI with risk-avoidance | ✅ | `DemoExitModal` retitled "What's one caught mistake worth?" + body leads with the caught stale-beneficiary risk before productivity. (Shows on demo limit; copy verified by typecheck/lint; not force-opened in live run.) |
| 10 | Keep ONE line that private/on-device AI exists | ⏭️ | **OPTED OUT by Jameson.** |
| 11 | Lead Workflows with ~3 advisor workflows | ✅ | **Built by Codex**, reviewed by me: Advisors category leads with Annual Review Packet · Meeting Prep & Suitability Notes · Reg S-P Safeguards, then "Show all (7)". 18 workflow tests pass. **Live-verified.** Flag: advisor view still lists Tax/Consulting packs below (separate decision — see flags). |
| 12 | Connector honesty matrix + read-only labels | 🚩 | **FLAGGED — not yet edited.** Same surface as #3 (ConnectScene/connector components) — collision risk with `feat/onboarding-journey`. OneDrive already has a read-only label; needs coordinator go-ahead. |
| 13 | Negative-space line (not a CRM/note-taker/planning tool) | ✅ | Demo-only Ask intro (with #8): "Keepance isn't a CRM or a note-taker. It sits beside your tools and reads across your files." **Live-verified.** Wording is brand-adjacent — flagged for brand alignment. |
| 14 | Roadmap items | ⏭️ | Roadmap, not demo edits. |

## Decisions made (flagged to coordinator)
- **`Plan review.aichat` removed** from the seeded Webb folder. Rationale: rec #1 explicitly lists `.aichat`; it's a techie artifact, not a "brought-in" client file; and the live Ask demo (rec #2) shows the AI conversation behavior better. Easily reversible.
- **README.md / About this demo.md kept** as root-level demo chrome (.md). They're navigation notes, not client documents; the Webb *folder* is now 100% Word/PDF. README updated to reference the new docs + the live-Ask refusal beat.
- **#7 badge is generic** (`{matter.name} only`) so it renders on every client on desktop too — intended as an honest, always-on isolation indicator. Confirm this is wanted app-wide.

## Lane / collision notes
- Design system = design session (MERGED) — added content/UX/copy only, no restyle (reused Badge/Chip/tokens).
- Web-demo Ask wiring = `demo-live-ai` (MERGED) — built on it.
- `feat/branding-system` owns global brand strings — #13 (and #8/#9 marketing-ish copy) wording flagged for brand alignment; no global product-name/tagline hardcoded.
- **`feat/onboarding-journey` overlaps #3 + #12 (ConnectScene/onboarding) — deferred pending coordinator.**

## Observations for coordinator
- **#11 follow-up:** the advisor Workflows view leads with the 3 advisor templates but still shows full Tax/Consulting sections below. Hiding non-advisor verticals for the advisor profession would make it more focused (board direction: simple, AI-first) but touches shared `prioritizeByProfession` + its tests — recommend as a separate scoped change.
- **PDF pixel-rendering** can't be screenshotted in headless Chromium (no bundled PDFium); the PDFs themselves are valid (verified via pdftoppm) and open in the real PDF viewer. Recommend a final live-model + PDF smoke in a real browser before the video.

## Independent Codex review — done, all findings fixed
Codex (gpt-5.5) reviewed the full diff and raised **3 P2 findings, all valid, all now fixed** (re-verified green):
1. **Returning visitors kept stale Client Map citations** — the persisted Client Map store (localStorage) made `seedWebDemoClientMap` skip `setMap`, so old `.md` source paths survived after the rename. **Fix:** always re-seed the demo map at boot (`seedWebDemoClientMap.ts`).
2. **Seeder wiped + regenerated on every reload** — `readSeedProfession()` didn't recognize `'advisor'`, so the already-seeded check never matched and the new `clearDirectory()` ran every load. **Fix:** recognize `'advisor'` (`WebDemoSeeder.ts`).
3. **Partial seed marked complete** — a failed binary write still set the seed flag, so the retriever/Client Map could cite an unwritten file. **Fix:** only mark complete when every file wrote; otherwise retry next load (`WebDemoSeeder.ts`).

## Gate status (TS/JSON-only changes; no Rust touched)
- `npm run typecheck` → **0 errors** ✅
- `npm run lint:gate` → **green** (no regression vs baseline) ✅
- `npx vitest run` → **4586 passed / 6 skipped / 0 failed** ✅ (updated 1 decline-test to match the new calm-decline note)
- `cargo test` → not run (zero Rust changes); coordinator's pre-merge gate covers it.

## Live verification (real browser, fresh build)
Driven with Playwright against the built `dist-web-demo` (screenshots in the session scratchpad):
- #1 OPFS holds the 4 real binaries (`*.docx` 9.5KB, `Beneficiary Designations.pdf` 47KB, `Client Intake.pdf` 37KB); no `.md`/`.aichat` client files; 0 console errors.
- #2 clicking the stale-beneficiary chip opens `Beneficiary Designations.pdf`; clicking a plan chip opens & renders `Webb Financial Plan.docx` (docx-preview, with an honest "read-only preview; editing in the desktop app" banner).
- #5 caveat, #7 "Webb Household only" badge, #8/#13 Ask intro, #9 exit-modal copy, #11 three advisor workflows leading — all render correctly.
- (PDF *pixel* rendering can't be screenshotted headless — no bundled PDFium — but the PDFs are valid and open in the real viewer; recommend a final live-model + PDF smoke in a real browser before recording the video.)

**Do NOT merge — coordinator reviews + merges.**
