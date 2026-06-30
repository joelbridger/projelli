# Advisor Prep Hero: Independent Four-Vertical Review (Post-V2-Overhaul)

**Date:** 2026-06-04
**Reviewer:** Independent expert pass, role-playing each of the four target verticals as a seasoned practitioner (attorney, tax pro, consultant, financial advisor), commissioned by Jameson.
**Scope:** The live website (which I confirmed is byte-identical to the `v2-overhaul` branch source on every page reviewed) plus the actual application templates and export code.
**Companion documents:** [Vertical Persona Audit, 2026-06-03](./2026-06-03-vertical-persona-audit.md) and the [V2 Overhaul Proposal, 2026-06-03](./2026-06-03-keepance-v2-overhaul.md). This document is the **post-overhaul re-review**: it assumes that earlier work shipped and looks for what a real practitioner would *still* reject and what high-value additions remain.

> **Important framing.** The 2026-06-03 audit diagnosed Advisor Prep Hero as "a developer-grade tool wearing a professional's suit," where capability existed but communication did not. The V2 overhaul largely fixed that. This review finds a **different and, for a trust product, more dangerous** problem class introduced by shipping the overhaul quickly: **internal contradictions and overclaims that the exact buyers you are targeting are professionally trained to catch.** Every finding below was verified against the real files, not taken on a reviewer's word. Where a reviewer was wrong, I say so (see the Heppner correction).

---

## 1. The core diagnosis (read this even if you read nothing else)

**Advisor Prep Hero's product is now more trustworthy than its website is consistent.**

The overhaul worked. The template *prompts* are genuinely literate in each profession (a privilege log that knows over-description waives privilege; a Section 7216 packet that cites the right Treasury Reg; advisor templates that strip SSNs and refuse to give investment advice). The data-path honesty (`/ai-workspace-privacy/`) and the "what we are not" positioning (`/fits-your-stack/`) are the best assets you have, and all four reviewers praised them unprompted. The foundation is real.

But the marketing layer now contains a cluster of **specific, checkable falsehoods and contradictions** sitting on top of that good foundation. Your buyers are trained skeptics with a license on the line: a lawyer pulls an unfamiliar citation, a CPA reads the statute, an RIA's whole job is "does what they say match what they do." For that audience, a single caught contradiction does not just lose the sale; it retroactively poisons every honest claim on the page, including the carefully correct ones. All four personas would **download and try** the product. **None** would pay $149/yr or attach their name to a public testimonial today, and in every case the blocker is one of these avoidable integrity defects, not a missing capability.

The good news, exactly as in the first audit: most of the highest-severity fixes are **copy and consistency**, not new engineering. The remaining build work (verification-banner coverage, real deck export, the "one-pager" trust artifacts, branded output, the per-vertical template gaps) is well-defined and high-leverage. Because the standing directive is "nothing goes to market until it is perfect," this review is, in effect, the definition of the remaining gap to "perfect."

---

## 2. The verdict at a glance

Each reviewer was asked three questions: would you try it, would you pay $149/yr, would you put your name and credential on a public testimonial?

| Vertical | Try it? | Pay $149/yr? | Put name + credential on a testimonial? | The single blocking condition |
|---|---|---|---|---|
| **Attorney** (legal) | **Yes** | Not yet | **No, not yet** | Reconcile pricing across the binding EULA; make "attorney-reviewed" literally true with a named reviewer; cite Heppner properly; downgrade "privilege intact" to an accurate risk statement |
| **Tax** (EA / CPA) | **Yes**, in the off-season | Not yet | **No** | Resolve the "CPA-reviewed" claim vs the "do not expose" code header; show real tax output; turn on the verification banner for the regulated tax templates; tell the truth that a cloud key is still a Section 7216 disclosure |
| **Consultant** | **Yes** | Only if the deck output becomes real | **No, not yet** | Fix the "sidesteps the clause entirely" overclaim; make multi-client isolation real and visible; produce an actual usable PowerPoint, not a text dump |
| **Financial advisor** (RIA) | **Yes** | **No** (pack reads as unshipped) | **No** | Resolve the "in development" claim vs the pack being built and shipping live in the app; do the advisor review; ship a CCO-facing one-pager |

The pattern is unmistakable: the product earns a trial from all four, and then a self-inflicted credibility problem stops the purchase and the endorsement.

---

## 3. Cross-cutting CRITICAL findings

These hit two or more verticals and are the highest-severity conversion killers. Each was verified against the actual source.

### C1. "Attorney-reviewed" / "CPA-reviewed" is claimed on the site; the code says "do not expose to users without review"

**Verified.** Every template file in the legal, tax, and advisor packs opens with a header like:
`// @draft ... Requires [attorney / CPA-EA / advisor] review before shipping. Do not expose to users without review.`
There are 32 such `@draft` markers across the packs, and the pack `index.ts` files repeat "do not expose ... without ... sign-off." Meanwhile the legal page sells the pack as "attorney-reviewed and kept current" and "reviewed by practicing attorneys," and the tax page says "CPA-reviewed and kept current."

**Why it deters (legal, tax, advisor):** "Reviewed by practicing attorneys/CPAs" is a specific representation these buyers rely on; it is part of why they would trust a Section 7216 form or a privilege log enough to put it in front of a client or opposing counsel. If the review has not happened, the website is making a false statement of fact to sell to the one audience trained to detect it, and the source code is open at github.com/keepance/keepance, so a diligence-minded buyer can find the contradiction directly. This is the cleanest example of the trust-poisoning dynamic in section 1.

**Fix:** Make the claim true before you make it. Either (a) have a licensed, practicing reviewer in each area sign off on every template, strip the `@draft` / "do not expose" headers, and then say "reviewed by [named credentialed reviewer]"; or (b) until that happens, change the copy to what is defensibly true today ("built with input from practicing [attorneys/CPAs]" or "drafted by the Advisor Prep Hero team, designed to produce work product you review"). This is the same advisor gate that paused outreach in the first place; the overhaul shipped the packs and the "reviewed" copy ahead of the gate.

### C2. Pricing is incoherent, and the binding legal documents contradict the checkout

**Verified.** This is a real contract conflict, not a typo:
- The **EULA** and **Terms** state: "**Practice ($499, one-time): A perpetual license for up to 5 seats**" and "Personal and Practice are one-time purchases (perpetual licenses). Professional is an annual subscription."
- The **homepage and vertical pages** sell Practice as a **yearly plan** ("Professional and Practice are yearly plans that keep your profession packs maintained"), and the LemonSqueezy product was flipped to **$499/yr** on 2026-06-01.
- So the documents that legally bind the customer say Practice is a one-time perpetual license, while the page that takes their money bills them annually. A buyer who purchases "Practice $499/yr" and then reads the EULA has a legitimate chargeback and consumer-protection grievance.
- Separately, the old **$129** Professional price still appears in **11 files** (the BYOK 60-day cost blog, whose entire three-year savings math is built on it; the press kit; the AI cost calculator; `/local-model-setup/`; the changelog; several SEO pages). The current price is $149/yr.
- The homepage JSON-LD lists Practice as a flat "499" offer with no recurrence, which search engines may surface as a one-time price, compounding the confusion.

**Why it deters (all four):** These buyers read contracts for a living. When the marketing page, the checkout, and the EULA disagree about whether they are buying a subscription or a perpetual license, they assume the vendor is either sloppy or hoping they will not notice, and they do not enter a card. It also directly undercuts the "we keep your packs current as the law changes" promise: if you cannot keep your own price current across your own site, why would they believe you are tracking the IRC or Reg S-P?

**Fix:** Pick one model per tier (the live pages and checkout are the source of truth: Personal $49 one-time, Professional $149/yr, Practice $499/yr, Founding $99/yr) and sweep every page, blog, vs-page, the FAQ, the Terms, and the **EULA** so they are identical. The EULA and Terms must match the checkout exactly. Add a plain-English "what you are buying" box (subscription vs perpetual; what lapses; what you keep).

### C3. The advisor pack is built and shipping live, but the site says it does not exist yet

**Verified.** The four advisor templates are real, complete, and wired into the live application: `src/modules/workflow/index.ts` spreads `...ADVISOR_TEMPLATES` into the array the workflow picker consumes, with no draft filter, preview gate, or feature flag (the old `markPreview()` gating was removed per the 2026-06-01 directive). Yet the homepage says "The Advisor Practice Pack is in development ... the advisor-specific templates are on the way," and `/financial-advisors/` repeats in five places that the templates are "planned, not yet shipped." On top of that, each advisor template carries the same `@draft / do not expose to users without review` header from C1.

So there are **three mutually contradictory states** in one product: the code comments say "unreviewed draft, do not ship," the build ships them live, and the website says "not built yet."

**Why it deters (advisor, and trust everywhere):** A fiduciary's core diligence reflex is "does what they say match what they do?" An advisor downloads the trial to evaluate the honest "in development" claim, opens the workflow picker, and finds four advisor templates the site swore were not shipped. That catches the company in an untrue statement about its own product, which poisons the (genuinely excellent) Reg S-P copy next to it. The irony is sharp: the page is so disciplined about not overstating AI capability that it ends up *understating its own product to the point of inaccuracy*.

**Fix:** Pick one true story and make code, build, and site agree. Since the pack is built and live, the likely right move is to (a) run the advisor review the headers demand, (b) strip the `@draft` headers, and (c) flip the homepage and `/financial-advisors/` from "in development / not shipped" to "four advisor templates, available today, shaped with practicing advisors, more coming." If you instead decide they are not ready, gate them out of the build until they are. Do not ship unreviewed drafts into a fiduciary's workflow picker while telling them the pack does not exist.

### C4. Every template count on every customer-facing surface is wrong

**Verified.** Page claim vs code reality:

| Pack | Page says | Code ships | vs-pages say |
|---|---|---|---|
| Legal | "7 workflow templates" | **10** | "15 built in" (9 files) |
| Tax | "7 workflow templates" | **8** | "15 built in" |
| Consulting | "5 templates" | **6** | "15 built in" |
| Advisor | "not shipped" | **4** (live) | (n/a) |

The homepage pricing card repeats 7 / 7 / 5. Worse, the newest and most useful templates are the ones hidden: the tax **Notice Response Drafter** (CP2000/CP2501/Letter 525) and the consulting **Statement-of-Work Drafter** are absent from the pages selling their packs.

**Why it deters (all four):** Small, but corrosive in a trust sale. A buyer who audits for a living notices "5 vs 6" on the page selling the pack, and quietly downgrades confidence in the high-stakes compliance claims they are being asked to take on faith. And undercounting means you are hiding work you already did and could be selling.

**Fix:** Reconcile every count to the real number (10 / 8 / 6 / 4), add the missing template cards, and kill "15 built in" everywhere unless 15 actually ship in a single pack.

### C5. The privacy promise overclaims for the cloud-key path that most users will actually use

**Verified, and this is the most important *accuracy* finding.** The product's honest position, stated correctly on `/ai-workspace-privacy/`, is: Advisor Prep Hero's servers never see your data; with a **cloud** key the prompt still goes to your chosen AI provider (so the provider sees it); only a **local** model means nothing leaves the machine. But three vertical pages quietly drop that nuance at the headline:

- **Legal:** the page title and hero claim "Privilege-safe by design" and "keeps attorney-client privilege intact." Privilege is not a property of software; it is waived by disclosure to third parties. On a cloud key you *are* transmitting to a third party. The honest sub-headline three lines down contradicts the hero.
- **Tax:** "Local-first eliminates the AI-transmission risk" and the homepage "Local-first AI simplifies all three [Section 6713, Section 7216, Safeguards]." A cloud key is still a disclosure of return information to a third party (Anthropic/OpenAI/Google becomes the recipient), which is exactly what Section 7216/6713 govern. Only the local model removes that disclosure. And local-first does almost nothing for the bulk of Safeguards (the WISP, risk assessment, training, incident response), as the tax page itself admits lower down.
- **Consulting:** "Advisor Prep Hero sidesteps the clause entirely / there's no upload." A client's "no uploading work product to AI services" clause is about whether the text reaches a third-party AI at all. With a cloud key, it does. Only a local model truly sidesteps that clause.

The **advisor page gets this right** consistently ("there is no Advisor Prep Hero server in the middle" kept carefully separate from "nothing leaves your machine," which it reserves for local models). Use the advisor page as the model for the other three.

**The Heppner reinforcement (see the correction box below):** the real Heppner ruling held that putting material into consumer cloud AI defeated confidentiality precisely *because* it went to a third-party platform under that platform's privacy policy. That logic applies to a cloud BYOK key too. So Heppner is the strongest possible argument for the **local-model** path and a caution against implying a cloud key fully preserves privilege.

**Why it deters (legal, tax, consulting):** These are the claims a sharp practitioner (or their opposing counsel, examiner, or client's GC) catches, and they are the claims that, if relied on, create real professional exposure. Overclaiming here is both a trust-killer and, for the advisor vertical specifically, the same family of problem the SEC fines people for (overstating a capability).

**Fix:** Make the local-vs-cloud distinction part of every privacy headline, not a footnote. Reserve absolutes ("nothing leaves," "sidesteps entirely," "privilege intact") for the local-model path and say so in the same breath. Promote the honest sub-headline language into the headline. This is also more persuasive, because it is precise.

### C6. The "verify before relying" safety banner fires on only 6 of 28 templates, and the most-regulated packs have the worst coverage

**Verified.** The non-dismissable in-app verification banner is driven by a single flag, `requiresVerification: true`. It is set on:
- Legal: **5 of 10** templates
- Tax: **1 of 8** (only the Tax Research Memo)
- Consulting: **0 of 6**
- Advisor: **0 of 4**

So the highest-risk regulated outputs ship with **no app-level guardrail**: the tax Notice Response Drafter (asserts facts and a Tax Court deadline posture to the IRS), the Audit Defense File Builder (asserts "substantial authority" legal positions), the Quarterly Estimate Reminder (does safe-harbor math and quotes a federal interest rate in a client-facing letter), the Section 7216 consent document, and every advisor and consulting template. This is a software gap, not just copy, and it directly contradicts the website's promise of "verify-before-relying banners on regulated research templates."

**Why it deters (tax, advisor, consulting):** The whole pitch to a regulated buyer is "use AI safely on regulated work." Shipping the advertised safety rail on the legal pack but turning it off for the tax, advisor, and consulting packs is the kind of gap that, discovered after a CPA recommended the tool to their study group, makes them look reckless.

**Fix:** Set `requiresVerification: true` on every template that asserts legal authority, regulatory positions, deadlines, or arithmetic, and tailor the banner copy per template (a math-checking banner for the estimate letter differs from a citation-checking banner for the research memo). Prioritize the tax notice/audit/estimate templates and all advisor templates.

### C7. Onboarding friction is unchanged at the moment of decision, and the Tour page is stale

**Verified.** The in-app "what is an API key" explainer and "Test this key" button exist (good), but the prospect reads the *website* before installing, and there the friction is untouched. The `/download/` page's entire key instruction is one line: "Go to Settings, API Keys and paste your key from Anthropic, OpenAI, or Google." For a non-technical lawyer, CPA, or advisor, "paste your key from Anthropic" is jargon and a genuine adoption cliff. Worse, the `/tour/` page is stale: it advertises the tax pack as "two templates" (a 1040 Pre-Review Checklist and a Section 7216 template), links to the dead `/tax-practice/` path, and uses the words "compliant" and "ensures" that the rest of the site carefully avoids ("Advisor Prep Hero ensures you capture each client's disclosure and consent").

**Why it deters (all four, acute for tax and advisor):** The single biggest historical drop-off is the API-key wall, and it is hit by the least-technical buyers, who are the ones most likely to pay. If evaluation starts with a billing-dashboard scavenger hunt, they abandon. And a diligent buyer who reads both `/tour/` and `/tax/` catches the count mismatch and the "compliant/ensures" overclaim.

**Fix:** (a) On the download page and the vertical pages, add a short, plain reassurance ("Never set up an API key? It is a one-time, five-minute step and we walk you through it, with a one-click Test button") linking the existing guide. (b) For the least-technical and most-sensitive buyers (advisors, patent), **lead with the local-Ollama path**: no key, no account, nothing leaves the machine. It is simultaneously the easiest onboarding and the strongest compliance story, and it is currently buried. (c) Rewrite the `/tour/` tax section to the real 8-template pack and strike "compliant" and "ensures."

### C8. There is no sample output for tax, consulting, or advisor; all proof is legal

**Verified by the reviewers and consistent with the handoff.** Every screenshot and worked example on the site is a litigation matter (Halvorsen/Chen depositions, a privilege log). A CPA, consultant, or advisor evaluating a $149/yr purchase has to imagine what a Advisor Prep Hero tax research memo, board deck, or client plan summary actually looks like. Output quality *is* the product for a research tool, and these buyers will not pay for it sight unseen.

**Why it deters (tax, consulting, advisor):** "Show me the deliverable" is the fastest skeptic-to-buyer conversion lever, and it is the one piece of proof these three verticals are denied.

**Fix:** Publish two to three full, redacted sample deliverables per vertical (a complete tax research memo with the verification footer visible; a CP2000 response letter; a consulting discovery synthesis and an actual designed slide; an advisor plan summary and a Reg S-P data inventory), as both screenshots and downloadable files, on the matching vertical page. This was already the one open item flagged in the 2026-06-04 handoff; it is more important than the handoff implies.

---

> ### Correction box: the Heppner citation is REAL. Do not delete it.
>
> My legal reviewer, reasoning without web access, concluded that **United States v. Heppner** was "almost certainly fabricated" because a February 2026 S.D.N.Y. ruling being treated as settled authority weeks later looked suspicious and he could not pull it. **I verified this directly and he was wrong.** The case is real, genuine, and remarkably on-point:
>
> - **United States v. Heppner**, S.D.N.Y., **Judge Rakoff**, opinion issued **February 17, 2026**, described as "a question of first impression nationwide."
> - Defendant Bradley Heppner was arrested in November 2025 on securities and wire fraud; agents seized roughly 31 documents he had generated with **Anthropic's Claude** before arrest. The court held those AI exchanges were **not** protected by attorney-client privilege or the work-product doctrine, because (1) Claude is not an attorney, (2) there was no confidentiality once he communicated with a third-party AI platform under its privacy policy, and (3) the material was not prepared for legal advice or at counsel's direction. The court noted the result could differ under the **Kovel** doctrine if counsel had directed the use.
> - It is covered by the **Harvard Law Review** and client alerts from Gibson Dunn, Paul Weiss, Akin, O'Melveny, Proskauer, Debevoise, Chapman, Covington, and the NYSBA.
>
> **Implications for the site, which are positive:**
> 1. **Keep Heppner everywhere it appears (9 files).** It is the single best authority for Advisor Prep Hero's entire thesis: a federal court just held that pouring your work into consumer cloud AI can destroy privilege.
> 2. **Cite it properly and link it.** Right now it appears as a bare "U.S. v. Heppner (S.D.N.Y. Feb. 2026)" with no docket, no judge, no link. My reviewer's reaction proves a careful attorney *will* try to pull it, and a bare cite to a brand-new case invites exactly the doubt he felt. Add the judge, the opinion date, and a link to the Harvard Law Review note or a major firm alert. That turns a doubt-trigger into a credibility anchor.
> 3. **Advisor Prep Hero's characterization ("consumer AI use without attorney direction may offer no privilege protection") is accurate and appropriately hedged** ("may," "without attorney direction" tracks the Kovel point). Keep it.
> 4. **Use Heppner to argue for the local-model path.** Its confidentiality reasoning applies to any third-party transmission, including a cloud BYOK key. That is the honest, powerful framing (ties directly to C5).
>
> This is exactly why agent findings get verified before they become recommendations. Acting on the reviewer's instinct would have deleted your strongest legal asset.

---

## 4. The four reviews, in each practitioner's voice

These are the synthesized first-person reviews, tightened and fact-checked. Cross-cutting items from section 3 are referenced, not repeated; what follows is each vertical's *specific* findings.

### 4A. The attorney (solo / small-firm general practice, with patent awareness)

**Who I am.** Twenty years solo: civil litigation, family law, estate planning, small transactional and real-estate work, and I quarterback patent matters to a boutique. I run on Clio plus Word plus Adobe. I have never set up an API key. I am bound by Model Rules 1.6 and 1.1, I carry malpractice insurance whose carrier now asks about AI, and my nightmares are blowing privilege, filing a hallucinated cite, and a malpractice claim.

**First thirty seconds.** "The AI workspace that keeps attorney-client privilege intact" makes me lean in and narrow my eyes at once: finally someone names my actual fear, but "keeps privilege intact" is a legal conclusion a vendor cannot make for me. The honest sub-headline buys it back. Then I hit the Heppner card; my litigator reflex is to pull the case (and per the correction box, you should make that one click, because I will try). I keep reading, but in audit mode.

**What genuinely lands.** The data-path honesty. "Files are just files, open the folder in Finder, there they are" (my longevity fear, answered). `/fits-your-stack/` telling me you are *not* a Clio replacement. And, reading the actual templates, they are real deliverables: the Privilege Log Drafter understands that over-description waives privilege, the Client Intake Synthesizer refuses to "run" a conflict check and instead produces a fillable record, the Patent Disclosure Draft flags inventorship as a legal determination. Your product is more trustworthy than your website.

**My specific problems (beyond the cross-cutting set):**
- **"Privilege-safe by design / keeps privilege intact" overclaims a legal conclusion** (C5). Demote it to a risk statement; reserve any absolute for the local-model path.
- **The hallucinated-cite trap is under-addressed exactly where I would get burned: legal research.** There is no legal-research-memo template, and no mention anywhere of citation verification, Bluebook, Shepardizing, or KeyCite (I checked). You avoid the highest-malpractice-risk task by not offering it, which also means you avoid my highest-value, highest-fear use case. Solve it with a *verification-first* design instead of avoiding it.
- **ABA Opinion 512 is slightly overstated.** "Built for ABA Opinion 512 duties" and "512 is favorable to local-first" imply the tool discharges the duties and that 512 endorses a category. 512 is technology-neutral and imposes duties software cannot satisfy for me (client consent/disclosure, competence, supervision). The legal page's own careful card ("aligns with its confidentiality analysis") is the right voice; standardize on it, and add the client-consent duty you are currently silent on.
- **Stale developer comments in the legal templates** ("must add 'legal' to the category union before this is registered") are already done; their presence signals a rushed final pass. Delete them, along with the `@draft` headers once review is real.

**Gaps and needs tied to my real week:** a verification-first **legal research memo**; a jurisdiction-aware **deadline/statute-of-limitations calculator** (the Case Timeline only flags SOL, it does not compute, and docketing math is where lawyers get sued); **engagement-letter and AI-disclosure-clause** drafting (ties to the 512 consent duty); **family-law** templates (parenting plan, financial affidavit, asset-division worksheet) and **residential real-estate closing** support, the two biggest solo segments the pack ignores; **discovery drafting and responses/objections**, not just triage; **Bluebook formatting and a table-of-authorities** builder; a documented **Clio round-trip** recipe; and **true local RAG** that cites only from a folder of statutes/cases I provide (directly defusing the hallucination fear).

**My single highest-leverage change:** bring the public legal claims into exact alignment with verifiable reality (cite Heppner properly, make "attorney-reviewed" true with a named reviewer, soften "privilege intact"). The credibility ceiling here is high precisely because the category is drowning in overclaim; be the one that is actually honest.

**My verdict.** Try it: yes (free trial, on a local model, against a sanitized matter). Pay $149/yr: yes, but only after the pricing/EULA is reconciled, Heppner is cited properly, and "attorney-reviewed" is true or softened. Put my bar number on a testimonial: not yet; I need every cite real and linked, "privilege" stated accurately, the templates genuinely reviewed (ideally I would be the reviewer), and a verification-first research workflow so I am not implicitly endorsing a path to a hallucinated cite. Get there, which is within reach, and I would bring this to my bar's tech-CLE as how to do AI right.

### 4B. The tax professional (solo Enrolled Agent / CPA)

**Who I am.** Solo EA, ~220 clients, 70% individual and 30% small-business. January to mid-October I am underwater; I only evaluate tools in the off-season. I live in Drake plus TaxDome plus SafeSend. I am bound by Circular 230, Section 7216 (criminal) and Section 6713 (civil strict-liability), and the FTC Safeguards Rule. My nightmares are an inadvertent Section 7216 disclosure, relying on a hallucinated authority, and wasting scarce off-season time.

**First thirty seconds.** The hero leads with Section 6713's strict-liability civil penalty, correctly distinguished from criminal Section 7216. Leading with the civil strict-liability statute, which most vendors botch, tells me someone read the actual Code, and that earns twenty seconds of goodwill. Then it leaks out: the hero is a wall of statute (I wake up with 40 returns in review and a CP2000 on my desk, not wanting a penalty lecture), the page says "7 templates" but ships 8 and hides the Notice Response Drafter (C4), and there is not one screenshot of tax output anywhere (C8).

**What genuinely lands.** The architecture is the right answer for my Section 7216 anxiety, and `/ai-workspace-privacy/` is the most honest data-flow explanation I have seen from any AI vendor. The Section 7216 Engagement Packet is genuinely well built (correct separate-document requirement, 12-point-type rule, per-use specificity, the right Treasury Reg). The Notice Response Drafter and Audit Defense File Builder are real practice work. The honest BYOK cost blog is refreshing.

**My specific problems (beyond the cross-cutting set):**
- **The verification banner is off on 7 of my 8 templates** (C6), including the one that does math in a client-facing letter (the Quarterly Estimate Reminder, which also bakes in a Section 6621 interest rate that changes quarterly, a stale-number risk in a client letter).
- **The cloud-key Section 7216 reality is soft-pedaled** (C5). The honest and stronger message: only the local Ollama path removes the Section 7216 disclosure entirely; with a cloud key you have removed Advisor Prep Hero from the path, but you still owe your client a Section 7216 analysis/consent before sending their data to the AI provider, which is exactly why this pack includes a consent template. Reframing this makes the local path the hero for SSN-level work and turns the consent template into the answer for cloud use.
- **The homepage "simplifies all three" overreaches on Safeguards.** Local-first barely touches the WISP, risk assessment, training, and incident-response obligations. The `/tax/` page is honest about this; the homepage should match it. ("No small-practitioner exemption" is also an oversimplification; the Safeguards program requirements scale below 5,000 consumers.)
- **The `/tour/` page advertises a two-template tax pack and uses "compliant/ensures"** (C7).

**Gaps and needs tied to my real work:** a **representation kit** (Form 2848/8821 plus a CAF checklist plus a representation engagement letter; in real life authorization is the first thing I do, before any notice response); **more notice types**, especially the collection family (CP14, CP501/503/504, LT11/Letter 1058 CDP rights) where small-business clients panic; **entity-specific work** for the 30% of my book that pays the bills (S-corp reasonable-compensation memo, S-corp vs Schedule C election analysis, PTE-elective-tax estimates); and the most on-brand miss of all, a **WISP / Safeguards builder** (IRS Pub 5708 literally provides a template every preparer must adapt; it is a recurring December task with no hallucination risk, and it is the obvious tie-in for a security-positioned product). Also: state plainly whether import OCRs a scanned CP2000 and a stack of 1099s, and acknowledge my seasonality (a season-aware or extendable trial, a December onboarding mode, a founding rate reserved through the off-season).

**My single highest-leverage change:** put real, complete, redacted tax deliverables on the page *and* make the verification banner actually fire on them. That proves the value and the guardrail at the same time, which is what flips a skeptical EA from "interesting architecture" to "I will try this in December."

**My verdict.** Try it: yes, in the off-season, and a real tax sample on the page is what would trigger it. Pay $149/yr: not yet; resolve the "CPA-reviewed" vs "do not expose" contradiction with a named reviewer, let me see actual tax output, turn on the verification banners, and fix the $129/$149 mess first. Name plus EA credential on a testimonial: no, until the cloud-key Section 7216 message is honest, the verification rails are complete, a named tax pro is on record as reviewer, and I have personally run a memo and a notice response and checked the citations and math. The bones are better than anything else aimed at my profession; the gap between promise and wiring is what stops me signing.

### 4C. The consultant (independent strategy, with agency awareness)

**Who I am.** Twelve years solo after a brand-name firm, 3 to 5 mid-market clients at a time, every one under an NDA/MSA, several with explicit no-AI-upload clauses. My deliverable is a board-ready PowerPoint. I live in PowerPoint and a CRM. My biggest risk is cross-contaminating Client A and Client B; my second is breaching a no-AI clause. Clients now ask me in writing how I use AI.

**First thirty seconds.** "The AI workspace your NDA actually allows" hits the exact nerve, and leading with the no-AI contract clause is the best decision on the page; almost no competitor speaks to it. Then the first compliance card says Advisor Prep Hero "sidesteps the issue: there is no upload," and my alarm fires, because I would use this with my OpenAI key, and a cloud key absolutely is an upload to an AI service from my contract's point of view. Thirty seconds in, I have gone from "finally" to "is that claim even true for how I would use it?"

**What genuinely lands.** The problem statement. The data-path page (the best asset you have; it treats me like an adult). The "what Advisor Prep Hero is not" section. And the Meridian demo content is legitimately good consulting thinking, not toy output (the discovery synthesis flags divergence across the CEO/CFO/VP Ops and notes which themes are not yet recommendation-ready). That sample, more than anything, made me believe the AI layer could do real work.

**My specific problems (beyond the cross-cutting set):**
- **The product does not make my deck; it makes a Markdown outline, and "export to PowerPoint" papers over that.** This is existential and I verified it in the export code: each heading becomes a slide, the title is dropped top-left at 36pt, bullets at 18pt, and the comment says "anything more complex (images, tables, code blocks) is intentionally skipped." No theme, no master, no layout, no logo, and the Markdown tables my templates generate are silently dropped. The Slide Outliner even generates per-slide speaker notes, and the exporter throws them away. What "export to PowerPoint" gives me is a stack of white slides with black left-aligned text that I would be embarrassed to let a client glimpse and would rebuild from scratch anyway. For a persona whose entire deliverable is the deck, this is the difference between a tool I adopt and a tool I try once.
- **"Sidesteps the clause entirely / there is no upload" is false for how I would use it** (C5), and a client's GC reading that on your site, then learning I sent their deal data to a provider's API, is a serious problem for both of us. Make the local-model path the hero of the NDA-clause story; it is the only path that truly satisfies an explicit no-AI-upload clause.
- **Multi-client isolation, my number-one risk, is barely addressed and the page admits it is not built.** The only mention is one line: "A stronger per-client folder safeguard is coming in V2; for now, the separation is by folder convention." That is the discipline I already maintain manually. If the scoping and cross-client warning actually shipped in the app (the brief says they did), the site is badly underselling it; if they did not, this is the most important thing to build for me. Either way, nowhere on the site answers the question my clients put in writing: "how do you keep our data separate from your other clients when you use AI?"
- **Several templates reformat rather than synthesize, and the conspicuous gap is a competitive-landscape template** (the page touts "competitive analyses" but none exists). The genuinely additive ones are the Discovery Synthesizer and Stakeholder Map; sell on those. The SOW Drafter also auto-generates contract language (a confidentiality clause and signature block) behind a thin "consult counsel if complex" caveat, which is a different kind of risk for a solo; let me paste my own lawyer-approved clauses instead.

**Gaps and needs:** real **deck output** (theme, tables-as-tables, speaker notes carried through, claim-title layout, generated from the outliner's structured output rather than re-parsed flat Markdown); a **competitive-landscape builder** and a **findings/pyramid-principle synthesizer**; **workshop/board-prep** (agenda, pre-read, 2x2/driver-tree); **multi-client isolation made real and visible** with a screenshot and a per-client AI activity log; and the highest-leverage addition of all, a **client-facing "how I handle your data with AI" one-pager** I can brand and hand to a prospect's GC (the data-path page is 80% of the raw material; it just is not packaged as a hand-to-client artifact). That single asset turns my AI usage from a liability into a sales asset and makes Advisor Prep Hero the thing that won me the work.

**My single highest-leverage change:** close the gap between "AI helps me think" and "I have my deliverable" by making the PowerPoint path real, and tell the truth about it until it is ("draft your thinking and your slide structure; you finish the deck in PowerPoint"). If the deliverable handoff stays broken, I never adopt it, so this is the gate. (Nearly tied: the client-facing data-handling one-pager, which is the cheapest to build and the thing that turns a user into an advocate.)

**My verdict.** Try it: yes. Pay $149/yr: yes, but only if the PowerPoint export becomes a real starting deck, or you stop implying finished presentations and sell the upstream synthesis honestly. Name plus firm on a testimonial: no, until the "sidesteps the clause" overclaim is made precise, per-client isolation ships and is demonstrable, and the deck output is something I would open in front of a client. Clear those three and I would not only testify, I would hand your data-handling one-pager to my own prospects, which is worth far more to you than a logo.

### 4D. The financial advisor (independent RIA / fiduciary)

**Who I am.** Principal of a small fee-only, SEC-registered RIA. I hold the most toxic data a criminal could want. I am a fiduciary and I am examined. My CCO (sometimes also me) loses sleep over a Reg S-P breach, a suitability failure from a wrong AI output, and an AI-washing problem from overstating what my tools do. I just passed the June 2026 Reg S-P deadline and I have read about the SEC's AI-washing fines. I want AI leverage without ever handing client data to a vendor I have to diligence.

**First thirty seconds.** "For advisors who won't put client data in someone else's cloud" is the most correct sentence anyone has put in front of me; it frames the value as data path, not magic, and the hero immediately distinguishes a cloud key from a local model, which is exactly the distinction my CCO would test you on. This is the rare AI page that sounds written by someone who read Reg S-P. But within the same thirty seconds the page tells me the product is not for me yet ("Advisor Practice Pack: In Development," "planned, not yet shipped") while still showing me a "Buy Professional $149/yr" button whose only marginal value is a pack that ships "when ready." So I have gone from "this person gets it" to "they are asking me to pre-pay yearly for a pack that does not exist." That is a hard stop for an evidence-driven buyer, and it is self-inflicted, because the pack actually does exist (C3).

**What genuinely lands.** The data-path framing is correct and honestly hedged. `/ai-workspace-privacy/` reads like a threat-model memo and is forwardable to my CCO. `/fits-your-stack/` names my actual stack (eMoney, MoneyGuidePro, Redtail, Salesforce) and the "what Advisor Prep Hero is not" section is disarming. And the four advisor templates, which I found shipping live, are conservatively and well built (they forbid specific investment recommendations and guaranteed returns, frame suitability items as conversation starters, strip account numbers and SSNs, and the data-inventory template correctly says it is not a WISP). The author understood the suitability and AI-washing minefields.

**My specific problems (beyond the cross-cutting set):**
- **The shipped-vs-"in development" contradiction** (C3) is the credibility bomb, and the irony is acute: the page is so careful not to overstate AI capability that it understates its own product to the point of inaccuracy. Once I catch it, the carefully correct Reg S-P language is collateral damage.
- **I am asked to start a yearly charge for an "unshipped" deliverable with no date** (a faint whiff, to my pattern-matcher, of selling on what a product *will* do). Either the pack is live, so sell it as live, or do not put a yearly buy button at the top of the page.
- **The advisor page is missing its own best evidence.** It does not link to `/fits-your-stack/` (which names my CRM and planning tools) or `/local-model-setup/` (my only true zero-egress Reg S-P escape hatch). Those are the two pages that would close me.
- **Regulatory specificity on the live page is thinner than your own homework.** Your strategy doc is excellent (sourced to the SEC releases, 17 CFR 248.30, 275.204-2), but the page distills it to one card. The service-provider-oversight lever (a cloud AI vendor that receives client data is a service provider I must diligence; a no-vendor-server tool removes that vendor from the path), the 30-day breach-notification rule, and the books-and-records retention angle are the points that would prove you did my homework. They are sitting in your doc, gated behind a compliance-attorney review that has not happened, which is defensible, but it means the page under-speaks to me.
- **`prioritizeByProfession` does not know advisors exist** (it types the profession set as legal/tax/consulting/other), so even the shipped pack is not floated to the top of the picker for an advisor who completes onboarding.

**Gaps and needs:** a **Reg S-P safeguards and incident-response outline** (the data inventory is a good first step, but the 2024 amendments require a written incident-response program; this is the template that maps to the regulatory event you are building the whole pitch around); a **books-and-records retention story** (your "every chat is a real file" differentiator is latent 204-2 support; operationalize it with a per-client folder convention and a retention export, honestly framed as supporting, not satisfying, the rule, with no WORM claim); **branded client-facing PDF output** (plan summaries go to clients as polished branded PDFs, not drafts I retype); a **Reg BI / suitability documentation** template for the dual-registered; and the highest-leverage addition, a **CCO-ready one-pager** ("how Advisor Prep Hero fits your Reg S-P program") addressed to my compliance officer, who is the actual gatekeeper.

**My single highest-leverage change:** make the product, the build, and the website tell one true story about whether the advisor pack exists, and make that story "it is here." Reconcile it and you simultaneously fix the credibility bomb, justify the $149/yr, and turn your honest "in development" voice back into the trust asset it was meant to be.

**My verdict.** Try it: yes, and I would immediately discover the four templates the site told me were not shipped, which helps my evaluation and hurts my trust in the marketing. Pay $149/yr: no, not for a pack the page says ships "when ready"; fix the contradiction so the fee buys four real, reviewed templates available today and it becomes a clear yes, especially at the $99 founding rate. Name plus RIA on a testimonial: no, until the contradiction is resolved and the templates genuinely reviewed, you ship the CCO one-pager and a Reg S-P safeguards template, and I have verified the local-Ollama zero-egress path myself. Meet those and I would send the CCO one-pager to three peers. The thinking is more rigorous than 95% of AI vendors courting my industry; the gap is execution discipline, not understanding.

---

## 5. The highest-value additions (seal-the-deal), consolidated

These recurred across the reviews and are ranked by impact on converting a skeptic into a paying advocate. The first two are the biggest unlocks and appeared in all four verticals.

**A. A named, credentialed reviewer per vertical.** A bar number, an EA/CPA, a CRD attached to a real quote. These buyers trust other practitioners, not vendors. This is the strongest single trust asset you could add, it is the literal precondition each persona set for being willing to be the *next* named reviewer, and it is the entire reason outreach was paused. It also resolves the C1 "reviewed-by" contradiction by making the claim true.

**B. The "hand-to-the-gatekeeper" one-pager family.** A brandable, downloadable one-pager per vertical, addressed to the person who actually approves the buyer's tools:
- Legal: a **malpractice-carrier one-pager** (where data goes, the local-only option, the audit log, the verify-before-rely design) the attorney hands their carrier at renewal.
- Tax: a **Section 7216 / Safeguards data-handling statement**.
- Consulting: a **client-facing "how I handle your data with AI" one-pager** the consultant hands a prospect's GC.
- Advisor: a **CCO-ready "how Advisor Prep Hero fits your Reg S-P program"** memo.
The raw material already exists on `/ai-workspace-privacy/`; it just needs to be repackaged as an artifact the *user* gives to *their* gatekeeper. This is what converts a user into an advocate, because it turns their AI usage into a sales-and-compliance asset. It was the single most-requested addition across all four reviews.

**C. Verification-first research everywhere.** Extend the `requiresVerification` banner to every regulated template (C6), and for the legal and tax research memos, architect the output so every AI-supplied citation is quarantined in a "to verify" table, marked UNVERIFIED until the professional confirms it against Westlaw/Lexis or primary authority. This converts the buyers' biggest fear (the hallucinated cite) into your biggest selling point.

**D. The real deliverable pipeline.** Branded letterhead/logo on exports for everyone (legal filings, tax letters on letterhead, advisor plan PDFs), and a genuine PowerPoint path for consulting (theme, tables-as-tables, speaker notes carried through, generated from the outliner's structured output). Without finished-format output, the tool is a scratchpad no matter how good the AI is.

**E. Lead with the local-model path for the most sensitive and least technical.** For advisors and patent work especially, make the zero-egress Ollama path the default recommendation. It is simultaneously the easiest onboarding (no key, no account) and the strongest compliance story (nothing leaves the machine, which is the only posture that cleanly clears Heppner, an explicit no-AI clause, and a Section 7216 disclosure). You are currently burying your best answer.

**F. Make multi-client isolation real and visible.** Surface the per-client scoping and cross-client warning on the consulting and legal pages with an actual screenshot, stop saying it is "coming in V2," and add a per-client audit-log export the user can drop into an engagement file. This directly answers the procurement questionnaire and the consultant's number-one fear.

**G. Per-vertical template depth** (consolidated from section 4): legal research memo, deadline/SOL calculator, engagement and AI-disclosure clauses, family-law and real-estate templates, discovery drafting; tax representation kit (2848), collection-notice family, S-corp reasonable comp and entity election, WISP builder; consulting competitive-landscape and findings synthesizer, workshop/board prep; advisor Reg S-P safeguards and incident-response outline, books-and-records retention mode, Reg BI documentation, branded plan PDF.

**H. Seasonality handling for tax.** A season-aware or extendable trial, a December onboarding mode, and a founding rate reserved through the off-season, so a tax pro who finds you in March is not forced to evaluate during the one month they cannot.

---

## 6. What the overhaul got right (so this is fair)

The foundation is strong and several pieces are genuinely best-in-class for the category:
- **`/ai-workspace-privacy/`** is the strongest asset on the site. All four reviewers called it honest, precise, and (for the advisor) forwardable to a CCO. It is the template for how the rest of the site should speak.
- **`/fits-your-stack/`** and the "what Advisor Prep Hero is not" framing earn trust by telling buyers what you do not do.
- **The template prompts are professionally literate** in every vertical. The legal pack understands privilege-log waiver and inventorship; the tax Section 7216 packet cites the right Treasury Reg; the advisor pack is fiduciary-aware and strips PII; the consulting Discovery Synthesizer and the Meridian demo do real work.
- **The Section 6713 vs Section 7216 framing is correct** and notably better than most vendors (leading with the strict-liability civil statute, with the cap stated).
- **The advisor page's local-vs-cloud discipline is exactly right** and should be copied to the legal, tax, and consulting pages.
- **The honest BYOK cost reporting** (the 60-day blog) builds trust by under-hyping.
- **The founder bio appears to have been updated** (the reviewers saw "a decade designing health products at Samsung and AstraZeneca," softer than the prior "eight years at Samsung, AstraZeneca, Tesla, University College London"), which addresses a longstanding open item, though it is worth a final confirmation that the current wording is accurate.

The overhaul did the hard part. What remains is consistency discipline and a handful of well-scoped builds.

---

## 7. The accuracy and credibility register (a checklist)

Every claim a real expert flagged, with a verified status. Fix the "false" and "overstated" rows before any outreach; these are the trust-killers.

| Claim / item | Where | Status | Action |
|---|---|---|---|
| "Attorney-reviewed" / "CPA-reviewed" packs | legal, tax pages | **False today** (code: "do not expose without review") | Make true with a named reviewer, or soften to "built with input from" |
| Practice tier billing | EULA/Terms say one-time perpetual; pages say yearly | **Contradiction (binding docs vs checkout)** | Reconcile to one model everywhere; fix the EULA |
| Stale $129 Professional price | 11 files incl. cost blog, press kit, calculator | **Outdated** | Sweep to $149/yr; redo the three-year math |
| Advisor pack "in development / not shipped" | homepage, /financial-advisors/ | **False** (built + wired live) | Flip to "available today" (after review) or gate it out |
| Template counts 7 / 7 / 5 | pages, homepage card | **Wrong** (10 / 8 / 6) | Correct to real numbers; add hidden template cards |
| "15 built in" | 9 vs-pages | **Wrong / inconsistent** | Reconcile |
| "Privilege-safe by design / privilege intact" | legal page title + hero | **Overstated** (legal conclusion; cloud-key contradicts) | Downgrade to a risk statement; reserve absolutes for local model |
| "Eliminates the AI-transmission risk" / "simplifies all three" | tax homepage card | **Overstated** for cloud keys and Safeguards | Match the honest `/tax/` page; reframe cloud vs local |
| "Sidesteps the clause entirely / there's no upload" | consulting page + homepage | **False** for cloud keys | Make local-model the hero of the clause story; state precisely |
| Verification banner "on regulated research templates" | site claim | **Overstated** (6 of 28; 1/8 tax, 0/6 consulting, 0/4 advisor) | Turn it on for all regulated templates |
| "/tour/" tax = "two templates," "compliant," "ensures" | /tour/ page | **Stale + overclaim** | Rewrite to 8-template pack; strike "compliant/ensures" |
| ABA Opinion 512 "favorable to local-first" / "built for 512 duties" | homepage, trust bar | **Overstated** (512 is technology-neutral) | Standardize on the legal page's careful wording; add the client-consent duty |
| "No small-practitioner exemption" (Safeguards) | tax/homepage | **Oversimplified** (scales below 5,000 consumers) | Tighten |
| Quarterly Section 6621 interest rate in a client letter | tax template | **Stale-number risk** | Add as-of-quarter caveat + verification banner |
| **U.S. v. Heppner** citation | 9 files | **REAL and on-point. Keep it.** | Add judge, opinion date, and a link; use it to argue for the local-model path |
| Reg S-P 2024 framing | advisor page | **Correct** (well hedged) | Keep; expand with service-provider-oversight + retention once counsel signs off |
| Section 6713 / 7216 framing | tax/homepage | **Correct** | Keep |
| Founder bio | homepage, press kit | Appears updated/softened | Final confirmation of accuracy |

---

## 8. Recommended sequence before any outreach

The standing directive is that nothing goes to market until it is "perfect." This review defines the remaining gap. Sequenced by leverage and dependency; most Tier 1 items are copy-only and cheap.

**Tier 1: integrity and consistency (mostly copy; do first, before anything else).**
1. Resolve the "reviewed-by" claim (C1): run the advisor/attorney/CPA review or soften the copy, and strip the `@draft` headers when review is real.
2. Reconcile all pricing including the EULA and Terms (C2); sweep the stale $129; fix the JSON-LD.
3. Resolve the advisor "in development" vs shipped-live contradiction (C3).
4. Correct every template count and add the hidden template cards (C4).
5. Make the local-vs-cloud distinction part of every privacy headline; fix "privilege intact," "eliminates the risk," "simplifies all three," and "sidesteps the clause entirely" (C5).
6. Cite Heppner properly and link it (correction box); use it to argue for the local-model path.
7. Rewrite the stale `/tour/` page (C7).

**Tier 2: last-mile trust and software (well-scoped builds).**
8. Turn on the verification banner for every regulated template (C6).
9. Publish per-vertical sample-output galleries (C8).
10. Fix onboarding at the decision moment: plain-English reassurance + lead the sensitive verticals with local Ollama (C7).
11. Ship the "hand-to-the-gatekeeper" one-pager family (Addition B).
12. Add branded/letterhead output (Addition D).
13. Make multi-client isolation real and visible on the site (Addition F).
14. Wire `prioritizeByProfession` to include advisors.

**Tier 3: depth and the trust flywheel (builds + people).**
15. Recruit and name a credentialed reviewer per vertical (Addition A); capture testimonials.
16. Verification-first legal and tax research memos (Addition C).
17. The per-vertical template gaps (Addition G).
18. A real PowerPoint deck path for consulting (Addition D).
19. The advisor Reg S-P safeguards/incident-response template, books-and-records retention mode, and the securities-compliance-attorney review that unlocks the deeper regulatory copy.
20. Seasonality handling for tax (Addition H).

---

## 9. Closing note

The most striking thing across all four reviews is consistent: **your engineering is more careful than your marketing.** The template prompts, the data-path honesty, and the "what we are not" positioning understand these professions better than almost anything else marketed to them. What is holding the product back from the four buyers it is built for is not capability; it is a set of avoidable contradictions and overclaims that the exact audience is trained to catch, plus a few well-defined last-mile builds. None of the Tier 1 work requires building anything. It requires making the rest of the site as honest as the parts that already are. Do that, add a named reviewer and the gatekeeper one-pager, and Advisor Prep Hero would have the most credible privacy-first pitch in a category that is otherwise drowning in exactly the kind of overclaim you are one editing pass away from eliminating.
