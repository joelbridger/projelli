# Next Session Handoff Prompt

Copy this entire block as the first message of the next Claude Code session on the Advisor Prep Hero project.

---

Read first → ~/keepance/docs/operations/SESSION_HANDOFF_2026-06-04.md

You are CEO of Advisor Prep Hero. Here is the complete state:

**The V2 overhaul is substantially complete.** All 11 workstreams (A–K) from `docs/strategy/2026-06-03-keepance-v2-overhaul.md` have been executed across 13 commits on the `v2-overhaul` branch. 2024 tests passing, working tree clean. Nothing is deployed yet — deploy requires Jameson's explicit go.

**Standing directives (absolute, no exceptions):**
- No autonomous deploy (`infra/deploy.sh`) without explicit go from Jameson.
- No autonomous app release without explicit go.
- No outreach of any kind (no reviewer drafts, no cold sends, no launch) until Jameson says the site and app are ready and verified.
- Reviewer drafts #8-14 at crm.jameworld.com are queued and untouched. Do not raise them.
- Never change LS store slug `projelli`. Never remove either LEMONSQUEEZY_API_KEY or _2.

**The one Jameson-only item blocking full completion:**
Founder bio on the homepage and press kit reads "Eight years at Samsung, AstraZeneca, Tesla, University College London" — unverified and potentially inaccurate. A reviewer will Google it. Jameson needs to confirm the correct version so it can be updated everywhere before deploy.

**What the v2-overhaul branch contains (do not rebuild):**
- Homepage: Preview-mode hero screenshot, honest telemetry/advisors/patent copy, true-cost line, backup + longevity notes, pricing clarity with support tiers and seat economics.
- All 4 vertical pages rewritten: templates named, overclaims removed, caveat-first disclaimers.
- Blog: 5 new posts indexed, all em dashes gone, lint auto-discovers all future posts.
- 2 new pages: /fits-your-stack/ and /local-model-setup/ (Ollama guide).
- App: Export pipeline (Word/PDF/PPTX dropdown), client-data safeguard + matter scoping, API-key explainer + "Test this key" button, profession-aware onboarding, cost dashboard, research verification banners.
- 27 new templates: Advisor pack (4), Legal expanded to 10, Tax to 8, Consulting to 6.
- 214 new unit tests.

**If Jameson provides the corrected founder bio:**
1. Search for the current bio text in website/index.html, website/press-kit/, docs/marketing/, and any other site pages.
2. Replace all instances with the verified version.
3. Run `npx vitest run tests/unit/website-content-lint.test.ts` to confirm lint still passes.
4. Commit with `feat(site): update founder bio to verified version`.
5. Report what changed and where, then ask for deploy go.

**If Jameson says to deploy:**
1. Run `npm test` — confirm 2024 passing.
2. Run `~/keepance/infra/deploy.sh` (rsync website/ → /var/www/keepance.com + CF cache purge).
3. Verify keepance.com is live with spot checks (homepage loads, /download/ works, /legal/ shows template names).
4. Report done. The branch is NOT merged to master until Jameson reviews and says so.

**Key file locations:**
- Strategy docs: `docs/strategy/2026-06-03-{vertical-persona-audit,keepance-v2-overhaul}.md`
- Latest handoff: `docs/operations/SESSION_HANDOFF_2026-06-04.md`
- Deploy script: `~/keepance/infra/deploy.sh`
- LS store slug: `projelli` (NEVER change)
- CRM: crm.jameworld.com (port 5191)
- Validator: licenses.projelli.com/webhook (port 5181)
