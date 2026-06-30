# Session Record — 2026-05-28: Pivot Execution (Overnight)

> **Session type:** Overnight autonomous build
> **Duration:** ~8 hours (Jameson asleep)
> **Outcome:** All build-phase pivot work complete. Remaining blockers are on Jameson's side.

---

## What happened

The previous session (2026-05-27) locked the ICP pivot: solo attorneys + tax preparers/CPAs + independent consultants. This session executed the build.

Six concurrent agents ran overnight across three categories:

1. **Template packs** — Legal (7), Tax (7), Consulting (5) — all built and wired into the app
2. **Website** — Three vertical landing pages, homepage rewrite, blog rewrites, press kit, docs
3. **App internals** — Profession picker, in-app copy neutralization, sample workspace replacement

---

## What was built

### App changes

**Three profession template packs:**
- `src/modules/workflow/templates/legal/` — 7 templates (Deposition Contradiction Finder, Evidence Gap Analyzer, Case Timeline Builder, Privilege Log Drafter, Discovery Document Triage, Patent Disclosure Draft, Client Intake Synthesizer)
- `src/modules/workflow/templates/tax/` — 7 templates (Engagement Letter Builder, Pre-Review Checklist, §7216 Consent Template, Tax Research Memo, Client Document Inventory, Audit Defense File Builder, Quarterly Estimate Reminder)
- `src/modules/workflow/templates/consulting/` — 5 templates (Client Discovery Synthesizer, Confidential Research Memo, Stakeholder Map Generator, NDA-Safe Slide Outliner, Engagement Retrospective Builder)
- All three packs wired into `src/modules/workflow/index.ts` via `allWorkflows`
- `WorkflowTemplate` category union extended: `'legal' | 'tax' | 'consulting'` added to `src/types/workflow.ts`
- Stale `@ts-expect-error` directives removed from all 7 legal template files

**Onboarding:**
- First-run profession picker step added to `src/components/onboarding/FirstRunWizard.tsx`
  - 4 cards: Legal, Tax, Consulting, Other
  - Persists to `localStorage` as `keepance_profession`
  - Export `getOnboardingProfession()` for post-onboarding use
  - `data-testid="profession-card-{id}"` on each card for future test coverage

**In-app copy:**
- `src/locales/en.json`, `de.json`, `es.json`: 4 onboarding strings updated from founder framing to profession-neutral
- `ApiKeyWizard.tsx`: "Typical founder use" → "Typical professional use" (3 cost lines)
- `ProviderTutorialSteps.tsx`: "Most founders never exceed this" → "Most users never exceed this"
- `featureTourSteps.ts`: workflow templates step updated
- `WeeklyReviewWorkflow.ts`, `BoardMeetingPrep.ts`, `FirstHirePlaybook.ts`, `FinancialModel.ts`, `NewBusinessKickoff.ts`, `CustomerPersona.ts`, `PricingStrategy.ts`: all prompts and placeholder text updated from MRR/churn/investors/startup to billable hours/matters/professional practice
- `App.tsx`: file header comment updated
- `AIAssistantPane.tsx`: developer comment updated

**Sample workspace:**
- `src/onboarding/samples/Sample - Pitch Deck.md` → deleted
- `src/onboarding/samples/Sample - Client Intake.md` → created (Vasquez v. Meridian, Okafor Law, PLLC)
- `src/onboarding/samples/Sample - Weekly Review.md` → rewritten for solo law practice (billable hours, active matters, invoices)
- `src/onboarding/samples/Sample - Pricing Strategy.md` → rewritten as attorney fee structure

**Old founder templates:**
- `PitchDeck`, `InvestorUpdate`, `LandingPage`, `GoToMarketPlan`, `ContentStrategy`, `MVPScope`, `NewBusinessKickoff` removed from `allWorkflows` registry
- Files retained on disk (archived in place; can be restored or moved to an archive folder)

---

### Website changes

**New pages:**
- `website/legal-practice/index.html` (~1,172 lines) — attorney landing page. Headline: "AI for attorneys who can't afford a privilege waiver." ABA Opinion 512 cited; Heppner NOT cited (unverified).
- `website/tax-practice/index.html` (~1,127 lines) — tax practitioner landing page. Headline: "The §7216 question most tax professionals haven't asked." §7216 framed as open question; no definitive statutory claims.
- `website/consulting-practice/index.html` (~1,113 lines) — consultant landing page. Headline: "AI for consultants whose clients haven't asked about the NDA clause yet."
- All three pages: buy buttons use `href="#"` placeholders — **update after LemonSqueezy pricing is created**
- All three pages: Verticals footer column cross-linking all three profession pages

**Updated pages:**
- `website/index.html`: hero rewritten for confidential-client-work ICP; pricing section updated ($49/$129/$399); Founder's Launch section removed; footer Verticals column added
- `website/press-kit/index.html`: "founder bio" → "creator bio"; profession-specific framing; new pricing
- `website/docs/faq.html`: rewritten for new ICP and pricing
- `website/docs/getting-started.html`: minor fixes
- `website/sitemap.xml`: `/legal-practice/`, `/tax-practice/`, `/consulting-practice/` added

**Blog rewrites (9 posts):**
- `blog/index.html`: post titles and excerpts updated
- `blog/why-local-first-ai-for-founders.html`: FULL REWRITE for attorneys/CPAs/consultants. Added ABA Op 512 + §7216 sections.
- `blog/picking-the-15-founder-templates.html`: FULL REWRITE — renamed "How I built the workflow template packs"
- `blog/the-15-founder-templates-and-why-these.html`: major rewrite — profession-specific template walkthroughs replace founder examples
- `blog/chat-shouldnt-disappear-when-you-close-the-tab.html`: CTA + bio updated
- `blog/the-hidden-tokenizer-tax.html`: "founder-specific" section → "professional's case"
- `blog/why-i-built-keepance-on-markdown-not-a-database.html`: framing updated
- `blog/byok-actual-cost-after-60-days.html`: section heading updated
- `blog/the-mcp-play-indie-tools-are-missing.html`: already clean, no changes needed
- **Not rewritten (intentionally):** `how-i-built-keepance-in-8-weeks.html`, `keepance-v2-announce.html`, `keepance-1-5-announce.html` — origin story posts; "founder" is appropriate in autobiographical context

---

### Strategy + docs

- `docs/strategy/POSITIONING.md` — canonical umbrella statement, buyer psychologies, ICP table, statutory hooks with verification status, channels-by-vertical, ready-to-use competitive answers
- `CHANGELOG.md` — comprehensive entry for all v2.1 changes
- `BACKLOG.md` — PIVOT-08 through 15 marked done; PIVOT-16, 17, 18 added
- `KEEPANCE_BUSINESS_PLAN.md` — 2026-05-28 board record with complete status table

---

### Marketing campaign content

**Legal (`docs/marketing/campaigns/2026-legal-launch/`):**
- `ADVISOR_OUTREACH_ATTORNEY.md` — warm and cold versions; ready to send
- `ADVISOR_OUTREACH_PATENT_ATTORNEY.md`
- `ABA_TECHSHOW_PITCH.md` — session abstract + bio; co-presenter required
- `LAWYERIST_GUEST_POST_PITCH.md` — pitch email + proposed article structure
- `LAWYERIST_ARTICLE_DRAFT.md` — full 1,200-word article draft
- `ABOVE_THE_LAW_PITCH.md` — editorial pitch + sponsored content option
- `IPWATCHDOG_PITCH.md` — patent attorney sub-audience
- `REDDIT_LAWFIRM_POST.md`

**Tax (`docs/marketing/campaigns/2026-tax-q4/`):**
- `ADVISOR_OUTREACH_CPA.md` — ready to send
- `NAEA_AICPA_PITCH.md` — newsletter pitch + conference abstract + r/taxpros post
- `REDDIT_TAXPROS_POST.md`

**Consulting (`docs/marketing/campaigns/2026-consulting/`):**
- `ADVISOR_OUTREACH_CONSULTANT.md`
- `UMBREX_PITCH.md` — Will Bachman email
- `TOM_CRITCHLOW_PITCH.md` — guest post pitch
- `LENNYS_NEWSLETTER_PITCH.md`
- `REDDIT_CONSULTING_POST.md` — two options (soft and direct)

---

## TypeScript state at end of session

```
npx tsc --noEmit → zero errors
```

---

## Known open items (not blocking app function, blocking deployment)

| Item | Who | File / Location |
|---|---|---|
| LemonSqueezy Professional + Practice products not created | Jameson | LemonSqueezy dashboard |
| CTA buttons are `href="#"` on all 3 vertical pages | Jameson | After LemonSqueezy done |
| Heppner citation unverified | Jameson | CourtListener search |
| Website not deployed | Jameson | `infra/deploy.sh` |
| Attorney advisor not yet recruited | Jameson | Outreach email ready |
| CPA/EA advisor not yet recruited | Jameson | Outreach email ready |
| Template pre-installation from picker (PIVOT-16) | Claude | After advisor reviews done |
| Above the Law pitch not yet sent | Jameson | File ready |

---

## Citation status (CRITICAL — do not deploy marketing copy that uses these without verification)

| Citation | Status | Used where |
|---|---|---|
| **ABA Formal Opinion 512 (July 2024)** | ✅ VERIFIED — real, confirmed | All 3 landing pages, blog posts, POSITIONING.md |
| **U.S. v. Heppner (SDNY, Feb 2026)** | ❌ UNVERIFIED — do not use in public copy | POSITIONING.md (flagged), some campaign docs (flagged) |
| **IRC §7216** | ✅ STATUTE IS REAL — framing needs CPA/EA advisor read | Tax landing page (hedged), §7216ConsentTemplate.ts (flagged) |
| **EU absolute-novelty rule** | ✅ DOCTRINE IS REAL — framing needs patent attorney read | Patent Disclosure Draft template (flagged), POSITIONING.md (flagged) |

---

*Session record written: 2026-05-28. Template packs are drafts — marked `@draft` in file headers pending advisor review.*
