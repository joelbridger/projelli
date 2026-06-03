# Keepance Vertical Persona Audit

**Date:** 2026-06-03
**Author:** Claude (acting CEO), at Jameson's request
**Status:** Findings of record. Feeds directly into the [Keepance V2 Overhaul Proposal](./2026-06-03-keepance-v2-overhaul.md).
**Companion document:** The overhaul proposal turns every finding below into a concrete, sequenced fix.

---

## Why this document exists

Before scaling outreach to named reviewers (attorneys, CPAs, advisors), we needed to know what those exact people will think when they land on the site and open the app. So I role-played each target vertical, taking each one seriously as a practitioner with years of real experience in that field, and did a full pass over the live website (every page, full scroll), the application UI (screenshots plus source), and all three practice-pack template sets.

This document records everything I found, persona by persona, plus the deeper cross-cutting analysis and a set of "reality checks" where the underlying software turned out to be better than a visitor could perceive. Nothing here is theoretical: every finding is something a real reviewer would hit.

The single most important takeaway is at the end of this file under [The core diagnosis](#the-core-diagnosis). Read that even if you read nothing else.

---

## How to read this

Each persona section has four parts:

1. **Who I am** (the practitioner I became)
2. **What lands well** (what would make me lean in)
3. **Major problems** (what would stop me from trying or buying, numbered by severity)
4. **Template and product gaps** (what is missing for my specific work)

Where a problem is really about how something is *communicated* rather than whether the software *can do it*, I flag a **Reality check** with what the codebase actually contains. That distinction matters enormously for the overhaul: a communication gap is a copy-and-screenshot fix, while a capability gap is a build. A surprising amount of what these personas complain about is communication, not capability.

---

## Methodology and what I reviewed

- **Website, live:** homepage (full scroll, all sections), `/download/`, `/legal-practice/` and `/legal/`, `/tax/`, `/consulting/`, `/financial-advisors/`, `/tour/`, pricing, and the trust bar.
- **Application:** the marketing screenshots plus the actual source for onboarding, API-key setup, export, the browser demo, telemetry, cost tracking, and AI context assembly.
- **Templates:** all seven Legal Practice templates, all seven Tax Practice templates, and the Consulting set, read in source at `src/modules/workflow/templates/{legal,tax,consulting}/`.
- **Personas:** five practitioner lenses (I split "attorney" into general practice and patent, because their AI fears are different).

---

## Persona 1: Solo / small-firm attorney (general practice and litigation)

### Who I am
Twenty years in solo practice. Family law, civil litigation, some estate planning. I run my practice on [Clio](https://www.clio.com/) for matter management and Microsoft Word for everything I write. I am not technical. I have never written a line of code or "set up an API" for anything in my life.

### What lands well
- "Work that can't leave your machine" lands instantly. That is exactly my fear with ChatGPT.
- The [ABA Formal Opinion 512](https://www.americanbar.org/news/abanews/aba-news-archives/2024/07/aba-issues-first-ethics-guidance-ai-tools/) and *United States v. Heppner* references signal you did real homework. That buys credibility.
- The Deposition Contradiction Finder and Evidence Gap Analyzer are the first AI features I have seen that map to actual litigation work, not generic chat.
- "Privilege log entries" tells me this was not built by someone who Googled "legal software" yesterday. You know what a privilege log is.

### Major problems

**1. The hero screenshot shows raw Markdown.** The deposition-notes mockup on the homepage shows `## Testimony to remember` and asterisk formatting. In twenty years I have never typed `**bold**`. My instant read is: developer tool, not for me. *(See Reality check below: a rendered Preview mode exists; it is simply not what the screenshots show.)*

**2. I do not know what an API key is, and the site does not tell me.** "Bring your own API key" is treated as self-explanatory. I use Word, Clio, Adobe, and Zoom. I have never obtained an "API key." This one phrase will stop most attorneys before they ever open the app.

**3. The real cost is hidden.** I read "$149/yr" and assume that is what I pay. I do not learn that I also pay Anthropic or OpenAI per message until I am already inside. Even if it is disclosed somewhere, I feel misled, and trust is the entire product here.

**4. Outputs are Markdown files; my work product is Word and PDF.** Case timelines go to clients. Privilege logs go to opposing counsel. Deposition summaries go into my brief. None of those leave my desk as `.md`. If the answer to "how do I get a formatted Word document out" is "copy and paste," that is worse than my current workflow. *(See Reality check: DOCX and PPTX export utilities exist in the code but are not surfaced in the editor, and there is no in-app PDF export.)*

**5. Nothing explains where this fits next to Clio.** Every attorney has a practice-management system. Does Keepance replace it, supplement it, or force me to run two parallel file systems? This is the first question I would ask, and the site never addresses it.

**6. The Client Intake Synthesizer generates "Boolean search strings" for conflict checks, then stops.** My conflicts database is in Clio. A search string I have to run somewhere else does the easy part and leaves the hard part. An attorney will notice the gap immediately.

**7. The compliance disclaimer comes after three paragraphs of specific legal claims.** Most readers never reach "verify with your bar counsel." The caveat should lead, not trail.

**8. Zero social proof.** I will not try software that no attorney I trust has publicly vouched for. One named testimonial, with a real firm and bar number, would outweigh every compliance citation on the page.

### Template and product gaps
- The Legal pack is litigation-only: deposition, discovery, privilege, evidence, case timeline, intake, patent. There is nothing for transactional work, estate planning, family law, or real estate, which are the bread and butter of most solo practices. A solo doing wills and closings sees a pack that does not match the work.
- No help with legal citation formatting ([Bluebook](https://www.legalbluebook.com/)) for the writing I would actually hand up.
- No mention of the malpractice-insurance angle, which is becoming a real lever: carriers increasingly ask about AI use, and a local-first, privilege-preserving posture is a selling point with insurers.

---

## Persona 2: Patent attorney / patent agent

### Who I am
Ten years at a boutique IP firm. Mostly prosecution (utility, design, PCT), some portfolio management and freedom-to-operate work. My single biggest AI fear is novelty destruction.

### What lands well
- "EU absolute-novelty rule: premature disclosure to cloud AI can destroy patent rights worldwide. Keepance prevents it." This is the only line on the site that speaks to my specific professional catastrophe, and it is the exact reason I have not touched AI for prosecution work.
- The Patent Disclosure Draft template is genuinely useful. Structuring an invention disclosure is real work, and AI can help if the data stays local.
- "Point it at a local model and nothing leaves your machine at all" is the gold standard for prosecution work, where I want zero network egress.

### Major problems

**1. "Premature disclosure to cloud AI can destroy patent rights worldwide" is overstated, and I will catch it.** The reality is more nuanced. [OpenAI Enterprise](https://openai.com/enterprise-privacy/) and ChatGPT Team explicitly disclaim training on inputs. The genuine risk is not "the model trains on my invention," it is the harder question of whether cloud transmission of an invention disclosure could be construed as disclosure bearing on novelty, especially under European absolute-novelty doctrine. If you state the catastrophic version, a patent attorney flags it as fear-mongering and then distrusts everything else on the page. State the actual mechanism precisely.

**2. The local-model capability, which is my answer, is buried.** "Point it at a local model" is dangled with no path to doing it: no [Ollama](https://ollama.com/) guide, no local-model comparison, nothing. You are hiding the one feature that wins my entire vertical.

**3. No mapping from output to filing format.** My disclosure goes into our internal system, then into a filing. The template produces a Markdown document. Is it claim-formatted? Spec-formatted? Just prose? I need to see how it maps to USPTO / EPO structure before I trust it with prosecution work.

**4. Seat economics are unaddressed.** Our firm has four attorneys. Professional is per-seat; Practice is five seats at $499/yr. Patent firms bill by the hour, and a colleague reviewing my disclosure needs their own seat. None of this is discussed.

**5. Workflow integration is unaddressed.** I live in USPTO Private PAIR, a docketing system ([Anaqua](https://www.anaqua.com/) or similar), and occasionally Espacenet. If the workflow is "manually copy data in, run a template, copy output back," that is a lot of friction for a tool I would adopt on a ten-year horizon.

### Template and product gaps
- No claim-drafting or claim-chart support, no specification scaffolding tied to filing structure.
- No prior-art organization (likely intentional, since external search conflicts with the privacy story, but worth an explicit position).

---

## Persona 3: Tax preparer / CPA / EA

### Who I am
Solo Enrolled Agent. Tax prep and planning only, around 180 clients, 70% individual and 30% small business. From January through October I live in [Drake Software](https://www.drakesoftware.com/) and do not touch anything new. The off-season is the only time I would try a tool.

### What lands well
- "§6713/§7216-aware" in the trust bar tells me you understand my world. Correctly separating §6713 (civil, strict-liability) from §7216 (criminal) is not obvious, and getting it right signals real research.
- The [FTC Safeguards Rule](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know) mention is the one thing on the site I had not already connected to AI use. Genuinely informative.
- "Keepance never sees your clients' SSNs, returns, or financial statements" is the exact promise I need, stated plainly.
- Audit Defense File Builder and Tax Research Memo are the two highest-value templates for me. Audit defense is genuinely hard, and research memos could save real hours.

### Major problems

**1. The API-key setup will end my trial in January.** I will try Keepance in July. I will read "bring your own API key," go to the Anthropic console, get confused by a billing dashboard, maybe create a key, then not open Keepance again until January, when I have zero time and abandon it. The seasonality of my practice means the onboarding friction is fatal unless it is removed almost entirely.

**2. Outputs do not go anywhere useful.** My deliverables reach clients through [SafeSend](https://safesend.com/) or the Drake portal as PDFs. A research memo in Markdown that I have to copy into Word, reformat, and export to PDF is more work than typing it. I need a "generate PDF" or Word export. *(See Reality check below.)*

**3. "Local-first AI simplifies [§6713, §7216, and the Safeguards Rule] all three" is an overclaim.** Local-first addresses the AI-transmission risk for one slice of Safeguards compliance. It does nothing for my [Written Information Security Program](https://www.irs.gov/pub/irs-pdf/p5708.pdf), risk assessment, vendor inventory, employee training, or incident-response plan. A sophisticated CPA reads "simplifies all three" as false advertising.

**4. Research-output reliability is my central question, and it is not addressed anywhere.** Does the Tax Research Memo cite real IRC sections, Revenue Procedures, and PLRs, or does it write confident prose that might be hallucinated? An EA who relies on a hallucinated memo and advises a client wrongly faces [Circular 230](https://www.irs.gov/tax-professionals/circular-230-tax-professionals) exposure. This is the number-one thing I need to know before using AI for tax research, and the site is silent.

**5. The §7216 Consent Template solves a problem I have already solved.** I generate engagement letters and consent forms from my practice-management software (TaxDome, Canopy). A second source of the same document means version drift. Compelling only for someone building a practice from scratch.

**6. The Quarterly Estimate Reminder template is trivially solved by every PMS.** It adds nothing over what I have and makes the pack look padded.

**7. There is no screenshot of tax output anywhere.** The entire site shows legal content (Halvorsen Estate, deposition notes). Before I give you money and an API key, I need to see what a Keepance tax research memo actually looks like for my work.

### Template and product gaps
- No representation-engagement workflow ([Form 2848](https://www.irs.gov/forms-pubs/about-form-2848) context), no notice-response drafting (CP2000 and similar), which are high-frequency real tasks.
- No tax-specific sample workspace.

---

## Persona 4: Independent strategy consultant

### Who I am
Twelve years independent, mid-market operations strategy. Engagements run four to six months, every one under an NDA. Three clients in the past year specifically asked whether I use AI and what I do with their data.

### What lands well
- "Your NDAs say client data stays confidential. Your workflow depends on AI. Keepance is where those two facts coexist." This is the best single sentence on the site. It is my exact situation, in plain language, no jargon.
- "Many client contracts now explicitly prohibit uploading work product to AI services. Keepance sidesteps the clause entirely." Also excellent, and increasingly true in the master service agreements I sign.

### Major problems

**1. My deliverable is PowerPoint, not Markdown.** Consulting output is decks and Word documents. The site lists "prepare presentations" as a use case, but the app produces Markdown, which is not a presentation. It is text I still have to rebuild as slides. *(See Reality check: a Markdown-to-PPTX path exists in code but is not exposed where I would find it.)*

**2. The consulting templates are invisible on the site.** The legal page at least names its templates by category in passing. For consulting I could not find a single named template. I am about to make a $149/yr decision and cannot see what I am buying.

**3. No example of my kind of work.** Every screenshot is a deposition file. There is no client-discovery synthesis, no competitive-landscape memo, no workshop prep. The product looks legal-only, so I assume it was not built for me.

**4. Multi-client separation is unexplained, and it is my single biggest risk.** I run three to five clients at once, each under NDA. How do I keep them separated so that working on Client A never exposes Client B to the AI? *(See Reality check: this concern is well-founded. The current AI context can include files from multiple clients at once.)*

### Template and product gaps
- No deck-oriented output, no executive-summary-to-slides flow.
- No engagement-scoping or statement-of-work template, which is the first artifact of every engagement.

---

## Persona 5: Financial advisor / RIA

### Who I am
Independent RIA, comprehensive financial planning. Client data (net worth, account numbers, plans) is some of the most sensitive that exists, and I am a fiduciary.

### What lands well
- "Client financials, plans, and account details are some of the most sensitive data there is. Keepance keeps them on your machine and never sees them" is the right promise for a fiduciary.

### Major problems

**1. The homepage tells me the product is not ready for me.** The homepage "Financial advisors and RIAs" block says "an advisor-specific template pack is in the works." I came to the page for my vertical and learned the product is not built for me yet, so I leave.

**Reality check (important inconsistency):** there is in fact a complete, checkout-wired landing page at `/financial-advisors/`, while there is no advisor template pack in the codebase (`src/modules/workflow/templates/` has `legal/`, `tax/`, and `consulting/`, no advisor folder). So the messaging is contradictory: the homepage undersells (says "in the works"), while a full landing page implies a pack experience that does not exist. **Decision (2026-06-03): build the advisor pack** so the vertical has a real, complete solution. Note also that Keepance has zero users today, so "advisors can use the core app now" was never a real position: nobody is using it, and without the pack it is not a complete advisor offering. Until the pack ships, the site should state plainly that it is forthcoming.

**2. Regulatory specificity is thin compared to legal and tax.** Legal gets ABA 512 and Heppner; tax gets §6713/§7216 and the Safeguards Rule. Advisors get general "sensitive data" language. My world has its own rules ([SEC Regulation S-P](https://www.sec.gov/rules-regulations/2024/05/s7-05-23), the amended safeguards and breach-notification requirements). Speak to them or I assume you did not do the homework you clearly did for the other two.

**3. Same deliverable problem.** Financial plans go to clients as branded PDFs. Markdown does not fit.

---

## Reality checks: where the software is better than it looks

This is the most actionable section, because it tells us which complaints are cheap to fix. Findings here come from reading the actual codebase (see the [V2 Overhaul Proposal](./2026-06-03-keepance-v2-overhaul.md) for exact file paths).

1. **A rendered Preview mode exists.** The raw-Markdown look in every screenshot is a choice, not a limitation. Switching marketing screenshots to the rendered view is a content fix, not a build. (Affects every persona's first impression.)

2. **DOCX and PPTX export already exist in code.** There are working utilities for Word and PowerPoint generation (`src/utils/docx-io.ts`, `src/utils/pptx-io.ts`), and a Markdown-to-PowerPoint converter. They are simply not surfaced as a format choice in the editor. The "outputs are Markdown only" complaint from the attorney, the tax pro, and the consultant is largely a *wiring and surfacing* problem, not a capability problem. PDF is the one true gap (no in-app PDF export today).

3. **The onboarding wizard already has a profession picker and an API-key step with deep links.** `FirstRunWizard.tsx` asks Legal / Tax / Consulting / Other, offers a workspace-folder chooser, and walks through getting an Anthropic key with numbered steps and a console link. The gaps are narrower than the website implies: there is no plain-English "what is an API key," no "test this key works" button, the profession choice is not yet wired to load matching templates or samples, and the sample files are generic rather than profession-specific.

4. **The browser demo is a rich, preloaded legal scenario, not a blank workspace.** "Try it in your browser" seeds a fictional matter (Halvorsen Estate) with a deposition file, a pre-saved AI chat showing the contradiction-finding "magic moment," a privilege log, and a timeline, all behind a rate-limited proxy. The real gap is that it is legal-only regardless of which vertical the visitor came from, and the desktop app has no equivalent rich sample.

5. **Telemetry is genuinely opt-in.** The app never sends anything until the user explicitly enables it (tri-state consent that defaults to "off"). No file or chat content is ever collected. The website's "no telemetry by default" phrasing actually *undersells* a strong, defensible privacy posture. This is a copy fix that turns a trust liability into a trust asset.

6. **In-app cost tracking already exists.** There is a per-chat and per-day cost chip. The gaps are that the website pricing page hides the API-cost reality entirely, and the in-app view lacks a pre-prompt estimate, spend alerts, and any week or month history.

7. **The vertical landing pages are real and checkout-wired.** `/legal/`, `/tax/`, `/consulting/`, and `/financial-advisors/` all exist with working LemonSqueezy links. They just do not name their templates or show sample output.

The pattern across all seven: **capability exists; communication does not.** That is the cheapest, highest-leverage kind of problem to have.

---

## Cross-cutting issues (all verticals)

These affect every persona and are the highest-severity conversion killers. The first eight were in my initial read; the rest are deeper findings added on reflection and after reading the code.

1. **API-key setup is the number-one drop-off, full stop.** None of these professionals has ever set up an API key. "Bring your own API key" is jargon to all of them, and the in-app guidance, while present, assumes console familiarity and offers no validation. This single barrier likely loses the majority of trial users at the first launch.

2. **Raw-Markdown screenshots are the wrong first impression.** Every marketing image shows the code view. Professionals use Word; they see hash marks and line numbers and conclude "developer tool." Preview mode exists. Use it everywhere.

3. **The true cost of use is hidden.** Everyone reads "$149/yr" and thinks that is the bill. The per-token API cost is mentioned nowhere on the pricing page. The first provider invoice, however small, reads as betrayal.

4. **No sample output before commitment.** The product asks for download, install, API-key setup, and a trial before showing any value. Even the (good) browser demo is legal-only, so a CPA or consultant sees someone else's work.

5. **Zero social proof.** No named testimonials, case studies, firm names, or reviews. These are trained skeptics. One named practitioner saying "this saved me six hours on a 2,000-document production" beats every citation on the site. This is precisely why the current reviewer-outreach effort matters so much: it is the input to the one thing that unlocks every channel.

6. **"No telemetry by default" reads as a hedge.** "By default" implies an opt-out path and invites the question "what is collected when I am not in default mode?" The reality (opt-in, nothing collected until enabled) is stronger than the phrasing. Say it without the hedge.

7. **No answer to "what if my machine dies."** Local-first is a selling point and a liability story. Every professional's next thought after "files stay on your machine" is "what happens when my hard drive fails." There is no backup messaging, and the in-app tour literally says "back up with git," which is developer-speak the ICP will not parse.

8. **The advisors vertical contradicts itself.** Homepage says "pack in the works"; a full checkout-wired landing page says otherwise; no advisor pack exists in code. Pick one honest story.

9. **No "how it fits your existing stack" positioning.** Every persona already runs a system of record (Clio, Drake, PowerPoint, a CRM). The site never says whether Keepance replaces or complements it. Ambiguity here reads as "I now manage two of everything."

10. **The deliverable pipeline gap is existential, not cosmetic.** If professionals cannot get a properly formatted Word, PDF, or PowerPoint file out, Keepance produces drafts of drafts. It does not fit into any actual professional output pipeline, which caps it at "scratchpad" no matter how good the AI is. Because the export utilities already exist, closing this gap is mostly surfacing work, which makes the low cost-to-impact ratio one of the best in the whole overhaul.

11. **Research-output trust is a liability landmine for legal and tax.** A hallucinated case cite or IRC section is not a UX annoyance; it is a malpractice or Circular 230 exposure. The product needs visible source citation, confidence signaling, and "verify before relying" framing for research outputs, or sophisticated users will (correctly) refuse to trust it.

12. **The killer privacy feature (fully local models) is buried.** For the most paranoid users (patent, anyone adjacent to a big-firm security review), "nothing leaves the machine, ever" via a local model is the whole ballgame, and there is no path to it on the site.

13. **Client-data separation is a real architectural risk that undercuts the core promise.** The AI context currently includes every open editor tab, and the workspace-search command can pull from the entire workspace, with no folder or matter scoping and no warning when files from different clients are combined. For a product whose entire pitch is confidentiality, the scenario "I had Client B's file open in another tab while chatting about Client A" is exactly the failure mode the buyer is paying to avoid. This is arguably the most important software finding in the whole audit.

14. **Support expectations are unclear.** Email support is listed only on the Practice tier. A solo professional on Professional, trusting this tool with privileged data, will ask "who do I call when it breaks." Silence here reads as risk for a confidential-data tool.

15. **No longevity or sustainability story.** "Founding pricing" signals early-stage startup, which makes a careful professional wonder whether the product will exist in eighteen months. Their files would survive (local), but their workflow would not. One honest line about the business model would defuse this.

---

## Deeper strategic analysis

### The competitive frame
These professionals are already being pitched AI by their incumbents: Clio is adding AI, [Thomson Reuters CoCounsel](https://legal.thomsonreuters.com/en/c/cocounsel) targets lawyers, Drake and the big tax suites are adding assistants, and Microsoft 365 Copilot is in their Office. Every one of those has native workflow integration that Keepance does not. Keepance's wedge is privacy, and privacy alone. That wedge is real and defensible, but it only wins if two things are true: the privacy advantage is made overwhelming and unmistakable, and the workflow friction (API keys, export, integration) is driven as close to zero as possible. Today the privacy advantage is undersold and the friction is high. The overhaul has to invert both.

### The trust paradox
Keepance asks for the deepest possible trust (handle my most confidential data) by promising the opposite of trust (we never see it). That is a strong story, but it is fragile: every hedge word, every unverified claim, every missing testimonial, and every "by default" chips at it. A confidentiality product cannot afford even small trust leaks, and the site currently has several easy-to-fix ones.

### The BYOK onboarding tension
Bring-your-own-key is excellent for the privacy story and terrible for non-technical onboarding, and it creates bill-shock risk. The tempting "fix" is a managed key (Keepance proxies the AI calls), which would erase the onboarding friction. **That fix would violate the product's own founding principle** ("BYOK forever, Keepance never holds AI keys, never sees user data") documented in `CLAUDE.md`, and it would gut the privacy wedge that is the entire reason this product exists. So the onboarding fix must come from radically better guidance and validation *within* BYOK, not from abandoning it. A managed-key option is a genuine board-level strategic question, not a tactical change, and the overhaul treats it as such (it does not recommend it).

### Seasonality (tax)
The tax vertical has a hard usage window: nobody adopts a new tool from January to October. Outreach and onboarding for tax pros should be timed to the off-season, and the onboarding itself must be fast enough to survive a distracted July evaluation.

### The capability-communication gap (the meta-insight)
The software is consistently *more capable* than the website shows (export, profession picker, cost tracking, opt-in telemetry, a rich demo), and the website is consistently *more sophisticated* than the onboarding assumes (deep legal and tax citation work sitting on top of a setup flow that presumes the user knows what an API key is). V2 is fundamentally about closing that gap from both ends: surface and wire what already exists, and lower the floor so a non-technical professional can actually get to the value.

---

## The core diagnosis

**Keepance is a developer-grade tool wearing a professional's suit.**

The positioning, the legal and tax research, the brand, and the value proposition are all aimed squarely at sophisticated, non-technical professionals. But the experience underneath (Markdown as the native format, "bring your own API key," a file-system mental model, "back up with git") assumes the habits of a developer. The target customer is precisely the person least equipped to cross that gap.

Almost every individual finding in this document is a symptom of that one mismatch. The good news, confirmed by reading the code, is that the foundation is real and more complete than it appears: the fix is less "build a new product" and more "finish translating the one you have into the language your customer actually speaks." That translation, end to end, is the [Keepance V2 Overhaul](./2026-06-03-keepance-v2-overhaul.md).

---

## Severity-ranked highlights

The full, sequenced fix list lives in the overhaul proposal. The ten highest-leverage items, roughly ordered:

1. In-app API-key onboarding: plain-English explainer, validation/test button, first-run made foolproof.
2. Replace every raw-Markdown screenshot with the rendered Preview view.
3. True-cost transparency on the pricing page and in the app.
4. One profession-aware demo that loads the visitor's vertical with real sample output.
5. One named reviewer testimonial (the entire reason current outreach matters).
6. Surface the existing DOCX/PPTX export and add PDF; make professional deliverables a first-class output.
7. Fix the client-data separation risk in the AI context (the core-promise integrity fix).
8. Reconcile and de-hedge the trust copy (advisors story, "no telemetry by default," disclaimer placement, backup story, longevity).
9. Surface the local-model path (wins the most security-conscious users outright).
10. Add research-output citation and verification framing for legal and tax (liability protection).
