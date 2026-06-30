# Reviewer Kit: the review package (what you send AFTER they say yes)

**Why this exists.** Recruiting a practicing reviewer is the critical path to launching any vertical (a reviewer makes the pack trustworthy, becomes the first named reference, and refers peers). The recruitment emails already exist (`../2026-legal-launch/ADVISOR_OUTREACH_*.md`, `../2026-tax-q4/`, `../2026-consulting/`). The gap this fills: **once a busy attorney/CPA/consultant says "ok, send it over," what do you actually hand them so the review takes 25 minutes instead of never happening?** This is that package.

**The principle:** make the review async, frictionless, and specific. No install required (they *can* try the app, but they shouldn't have to). A short read, a few sharp questions, a place to react. Reviewers don't bounce on a 25-minute favor; they bounce on vague ones.

---

## The universal process (same for every vertical)

**The ask, in one sentence:** "Read [N] one-paragraph template descriptions for [profession], and tell me two things per template: does this reflect how you actually work, and is anything inaccurate or risky? Plus one gut-check on the compliance framing."

**Time:** ~25 minutes, async, on their schedule. Offer a 15-minute call first if they'd rather see it live.

**What they get (the offer, state it plainly):**
- Advisor Prep Hero free for life (a comped Practice license).
- Named credit: "[Pack] reviewed by [Name], [credential]" on the site and in-app, only with their explicit okay on the exact wording.
- Real influence: their feedback shapes what ships, and they get first look at new packs.
- Founding-reviewer standing: they were here before the launch.
- No money, and the named credit is never a condition. They give it only if the pack earns it.

**How they give feedback:** reply to the email, mark up the doc, or a 15-minute call, whichever is least friction for them. Capture it verbatim into the CRM contact's timeline.

**The boundary (say this so they relax):** this is not legal/tax advice and not a formal engagement. It's a practitioner gut-check. We are not asking them to certify anything or take on liability; we're asking "does this hold up to someone who does this for a living."

---

## Legal review package

**Pack:** 7 templates for solo / small-firm attorneys.
1. Case Timeline Builder
2. Deposition Contradiction Finder
3. Discovery Document Triage
4. Evidence Gap Analyzer
5. Privilege Log Drafter
6. Client Intake Synthesizer
7. Patent Disclosure Draft *(patent attorneys only; route via `../2026-legal-launch/ADVISOR_OUTREACH_PATENT_ATTORNEY.md`)*

**Per-template, ask two questions:** (a) Does this reflect how you actually work? (b) Anything inaccurate, missing, or risky?

**The compliance gut-check (the part that most needs a bar-active read):**
- Does our framing of **ABA Formal Opinion 512** (a lawyer's GenAI duties of competence, confidentiality, and supervision) accurately describe how a local-first / BYOK tool *reduces* the confidentiality-and-disclosure surface without overclaiming that it discharges the duty?
- Is our use of **United States v. Heppner** (S.D.N.Y., Kovel-theory framing) characterized correctly as to dicta vs. holding, or are we leaning on it too hard?
- Fair to say "your work never enters our servers and your API key goes direct to the provider," while being clear the *provider* still sees prompt content unless a local model is used?

**Reviewer profile to target:** practicing solo/small-firm litigator or general practitioner; bonus if they've thought about cloud/AI ethics. Patent disclosures need an actual patent attorney.

---

## Tax review package

**Pack:** 7 templates for tax preparers / CPAs / EAs.
1. Engagement Letter Builder
2. Pre-Review Checklist
3. §7216 Consent Template
4. Tax Research Memo
5. Client Document Inventory
6. Audit Defense File Builder
7. Quarterly Estimate Reminder

**Per-template:** same two questions (reflects your work? / inaccurate, missing, risky?).

**The compliance gut-check (most needs a license-active read):**
- Is our framing of **IRC §7216** (criminal) and **§6713** (civil, strict-liability, $250/disclosure) accurate, and does the **§7216 Consent Template** actually meet the consent requirements, or would you not rely on it as written?
- Is the **Circular 230 §§10.35-10.37** language current and correctly characterized (Competence / Procedures / Written Advice, post-T.D. 9668)?
- Same data-path honesty check: "client return info never touches our servers" is true, but the AI provider still sees what you send it unless you run a local model. Is that framed honestly?

**Reviewer profile:** practicing CPA, EA, or experienced preparer who handles individual + small-business returns and has opinions about §7216.

---

## Consulting review package

**Pack:** 5 templates for independent strategy consultants / boutique agencies.
1. Client Discovery Synthesizer
2. Confidential Research Memo
3. Stakeholder Map Generator
4. NDA-Safe Slide Outliner
5. Engagement Retrospective Builder

**Per-template:** same two questions.

**The gut-check (no statutory claims here, so it's about credibility + fit):**
- Does the **NDA-safe** positioning hold up: would these templates actually keep you on the right side of a typical client NDA, and is "your client materials never leave your machine" the thing you'd care about?
- Would you, a working consultant, actually use these, or do they read like a non-consultant's idea of consulting?

**Reviewer profile:** independent strategy consultant or small-agency owner doing confidential client work.

---

## Financial-advisor review package (PENDING)

The advisor vertical's foundation (SEC Reg S-P, books-and-records, fiduciary, the honest trust case) is in deep research now; the review package + the advisor pack itself get built from it, with Journey Beyond Wealth as the design partner who co-shapes and reviews. See `docs/strategy/GO_TO_MARKET_2026-06.md` §1.6 and `../2026-06-design-partners/JOURNEY_BEYOND_WEALTH.md`.

---

## After the review

1. **Thank them concretely** and tell them what you changed because of their feedback. This is what turns a reviewer into a repeat ally.
2. **Ask for the named reference** only after the pack genuinely earned it, with explicit permission on the exact wording (name + credential). Log the permission durably.
3. **Ask for one intro.** A reviewer who liked it is the best source of the next reviewer and the next customer: "is there one other [attorney/CPA/advisor] who'd find this useful?"
4. **Badge it.** Once a vertical's pack has a real named reviewer, restore the "reviewed by a practicing [profession]" language on that pack's page (we softened it to "maintained" until this happens) and put the reference on the site.
