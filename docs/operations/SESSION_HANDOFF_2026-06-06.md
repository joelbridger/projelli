# Keepance — Session Handoff (2026-06-06)

Paste this whole file as the first message of the next session. It is self-contained.

---

You are CEO + head of marketing/sales for Keepance (local-first AI workspace for attorneys, CPAs, consultants, and RIAs). Repo: `~/keepance`, working branch `v2-overhaul`. Read `CLAUDE.md` first. Jameson is **not a developer** — talk in plain language, never dump stack traces.

## Where things stand (all verified this session)

**The full V2 integrity overhaul is DONE and the website is LIVE.** Three tiers from the independent four-vertical review (`docs/strategy/2026-06-04-independent-four-vertical-review.md`) were executed end-to-end:

- **Tier 1 (7 copy/integrity fixes), deployed:** reviewed-by claims softened to "built with input"; pricing reconciled (EULA/Terms now say Practice $499/yr annual; $129→$149/yr swept across 14 files); advisor pack flipped from "in development" to "available today"; template counts corrected (10/8/6/4); privacy overclaims replaced with honest local-vs-cloud framing; Heppner cited properly (Judge Rakoff, S.D.N.Y., Feb. 17 2026 + Gibson Dunn link) in all 7 files; stale `/tour/` rewritten.
- **Tier 2 (trust builds), deployed:** verification banners (`requiresVerification` + per-template `verificationNote`) on all regulated templates, wired into the in-app banner UI; plain-English API-key reassurance + local-Ollama lead on download/vertical pages; 4 "gatekeeper" one-pagers at `website/one-pagers/` (legal/malpractice, tax/§7216, consulting/client-GC, advisor/CCO Reg S-P); branded export (firm-name header in DOCX, persists to localStorage); advisor wired into `prioritizeByProfession`; stale "coming in V2" copy fixed.
- **Tier 3 (depth), deployed:** 15 new templates (legal: deadline calendar, engagement letter, discovery, family law, real estate, Bluebook; tax: rep kit, collection notices, S-corp comp, entity election, WISP builder; consulting: competitive landscape, findings synthesizer, workshop prep; advisor: Reg S-P outline, books-and-records, Reg BI); verification-first `LegalResearchMemo` + tax memo citation-quarantine table; real structured PPTX export (theme, tables, speaker notes); season-aware tax-page CTA.

**Totals:** 43 templates across 4 packs, all carrying verification banners. 2042 tests pass. `npx tsc -b` is clean. Founder bio confirmed accurate by Jameson ("a decade designing health products at Samsung and AstraZeneca, dual Master's from UCL") — that item is closed.

**Deploy authority:** Jameson granted blanket autonomous deploy this session ("just do it"). Site deploys and app releases are yours to run. The one boundary that remains: **no outreach is SENT** until Jameson confirms the marketing approach (see item 3).

## Loose ends, in priority order

### 1. Verify + PUBLISH the v2.4.1 desktop release (DO THIS FIRST)
The v2.3.0 and v2.4.0 CI builds **failed** on TypeScript errors (vitest passes because it uses esbuild; the production `tsc -b` does not — that gap let 21 type errors through: template `options` were written as `{value,label}` objects but the type is `string[]`, and `OnboardingProfession` was missing `'advisor'`). **I fixed all 21 errors this session** (commit `2d65f07`), bumped to **v2.4.1**, and pushed the tag — CI run `27049575907` was `in_progress` at session end.
- Check it: `gh run list --repo keepance/keepance --limit 3`
- If green: publish the release. `gh release list` shows **v2.2.0 is still marked Latest**, so the desktop installer people download today lacks the 15 new templates and the verification banners. Closing this is a site-vs-app consistency gap and matters before any heavy outreach. Publish with notes (see v2.2.0 release as the format template): `gh release edit v2.4.1 --repo keepance/keepance --draft=false --latest`.
- If it failed again: `gh run view <id> --log-failed`, but note the logs age out ~24h — reproduce locally with `npx tsc -b` (must report 0 errors) before re-tagging v2.4.2.

### 2. T2-2 sample galleries — STILL PENDING (Jameson's original ask this session)
Jameson asked me to "run the templates in the Linux version" to produce real sample outputs for the website (tax research memo, consulting discovery synthesis, advisor plan summary). These become proof-of-output galleries on `/tax/`, `/consulting/`, `/financial-advisors/` — the review flagged that all current proof is legal-only, and "show me the deliverable" is the fastest skeptic-to-buyer lever.
- **Blocker:** `scripts/generate-samples.mjs` is written and ready, but the `ANTHROPIC_API_KEY` in `~/jameworld/.env` is **EXPIRED (401 invalid x-api-key)**. The empty `website/samples/` dir exists.
- **Paths forward:** (a) get a fresh Anthropic key, put it in env, run `node scripts/generate-samples.mjs` — it writes `.md` + styled `.html` per sample; (b) have Jameson run the actual Linux desktop app and export real outputs; (c) write representative samples by hand (Jameson **rejected** this mid-session — he wants real template output, so prefer (a) or (b)).
- After samples exist: add a "See a real output" gallery section to each vertical page (screenshot/thumbnail + downloadable file), update `website/sitemap.xml`, deploy.

### 3. MARKETING — the main event, NOT yet started (this is why Jameson came in)
Jameson said he is **"finally over my fear of marketing/sales"** and wants me operating as **CEO + head of marketing and sales** to begin outreach. We were mid-`brainstorming` when he asked to wrap up, so **no approach is approved yet — do not send anything until he confirms.**
- **Hard constraints (now recorded at the top of `docs/marketing/README.md`):** marketing-led ONLY, **no personal network** (every tactic must work cold), **Jameson's name on everything**, outreach **sent from his personal email** (jamesondaines@outlook.com via the logged-in Outlook — autonomous + audit-logged per CLAUDE.md).
- **I proposed "Approach C" (full-spectrum, run in parallel):** cold community posts (r/legaltech, r/taxpros, r/consulting) for speed; cold editorial pitches (Lawyerist, Above the Law, Accounting Today, Umbrex/Lenny) for lead time; cold reviewer/design-partner outreach for the trust unlock. **Jameson did not approve it before wrapping up** — re-confirm with him, then run brainstorming → writing-plans → execute.
- **Reuse, don't rebuild:** campaign folders already hold real ICP-pivot content — `docs/marketing/campaigns/{2026-legal-launch, 2026-tax-q4, 2026-consulting, 2026-06-reviewer-program, 2026-06-design-partners, 2026-06-first-dollar}/`. The legal folder has a finished ABA TECHSHOW abstract; the reviewer-program folder has a ready async review kit. The old `MARKETING_PLAYBOOK.md` / `channels/` (PH/HN/IH, indie-founder) are **stale** — ignore for distribution.

### 4. T3-1 reviewer recruiting — highest-leverage trust unlock, now COLD outreach
A named credentialed reviewer per vertical is what turns "built with attorney input" into "reviewed by [Name, bar #]" — every persona in the review set this as their precondition for paying and testifying. With no network this is **cold prospecting** (LinkedIn → cold email from personal Outlook). Recruitment emails + the 25-minute async review kit already exist in the campaign folders. This is part of the marketing plan (item 3), not separate. Until a reviewer signs off, leave the `@draft` headers on templates and keep the softened "built with input" copy.

## Standing rules (unchanged)
- No em dashes, first-person singular, no AI-tells, hold the no-overclaim honesty bar in all copy.
- Never change the LemonSqueezy store slug `projelli`. Never remove `LEMONSQUEEZY_API_KEY` or `_2`.
- Heppner is REAL — never delete it; cite it properly.
- Deploy is autonomous; **sending outreach is gated** on Jameson confirming the marketing approach.

## Key pointers
- Master plan: `docs/superpowers/plans/2026-06-04-v2-integrity-review.md` (+ tier1/tier2/tier3 plans alongside).
- Review spec: `docs/strategy/2026-06-04-independent-four-vertical-review.md`.
- Deploy: `~/keepance/infra/deploy.sh` (rsync site + build web demo + CF purge).
- Release: push a `v*` tag → CI builds signed Win/Mac/Linux installers → publish the draft on GitHub.
- Tests: `npm test` (2042 pass). Build gate: `npx tsc -b` (must be 0 errors — vitest will NOT catch type errors).
