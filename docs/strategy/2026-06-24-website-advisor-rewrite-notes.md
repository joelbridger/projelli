# Homepage Advisor Rewrite Notes
**Date:** 2026-06-24
**Branch:** feat/website-advisor-rewrite
**File rewritten:** website/index.html

---

## (a) New title, h1, and positioning spine

**Browser tab title:**
"The private client-intelligence layer for a financial-advisory practice | Keepance"

**Hero eyebrow:** "For financial advisors"

**H1:** "The private client-intelligence layer for your advisory practice."

**Hero sub (lead hook):**
"Ask about any client and get the exact answer back, with a citation from the actual file. Walk into every meeting already knowing the whole household. Draft the follow-up letter and the Reg BI note in real Word with tracked changes. Everything stays on your machine, and a client's financials never get pasted into a chatbot you don't control. Think of it as a private ChatGPT that actually knows your clients."

**Positioning spine (from 2026-06-23-reaim-to-financial-advisors.md):**
"The private client-intelligence layer for a financial-advisory practice. Every household's full context, on your own machine, answering you with cited facts."

**Value-prop balance:** approximately 70% outcome framing ("walk into every meeting already knowing the household," "draft the follow-up letter and Reg BI note in minutes"), 30% architecture ("your machine," "never through a server of ours," "local model or BYOK").

---

## (b) Section-by-section: kept + reframed vs. dropped

### Head (meta, OG, JSON-LD, Twitter)
**Reframed.** All titles, descriptions, and JSON-LD description updated from "law practice / attorneys" to "financial-advisory practice / financial advisors." Same structure, new copy.

### Nav
**Reframed.** Link order changed from [Attorneys, Tax pros, Consultants, Advisors] to [Advisors, Tax pros, Consultants, Attorneys]. Advisors is now first, matching the audience priority.

### Hero section
**Heavily reframed.** Eyebrow changed from "For attorneys" to "For financial advisors." H1 changed. Sub paragraph changed. Video aria-label updated from "deposition memo" to "client household at a glance." Email signup CTA text ("Lock in the founding rate") and founding-cohort note are unchanged -- the pricing math still applies.

### Trust bar
**Kept as-is.** All four items ("Every answer carries a citation," "Real Word and PDF, not Markdown," "Your client files stay on your machine," "Bring your own AI key, or run local") apply perfectly to advisors.

### Feature row 1 (Find anything)
**Reframed.** Kept the structure and the "cited answer from real files" value prop. Replaced "Chen v. Merritt" lawsuit example with "Henderson Household" client example. Changed "opposing counsel / indemnity cap / carve-out / defect" language to "Roth conversion / retirement age / rental property." Feature-list bullets updated from matter-scoped to client/household-scoped language.

### Feature row 2 (REPLACED -- was "The litigation associate")
**Replaced entirely.** The litigation associate (deposition contradiction finder, timeline builder, discovery triage, privilege-log drafter) has no analog for advisors. Replaced with the "Client Map" section: walk into every meeting already knowing the whole household. New copy explains that advisors currently open five or six tabs before a client call, and Keepance collapses that into one cited view. The visual mock changed from "Deposition Contradictions" to "Henderson Household Client Map at a glance" showing Roth conversion decision, open beneficiary item, and 529 plan status.

### Feature row 3 (Real deliverables / Word)
**Reframed.** Kept the Word-native tracked-changes value prop intact -- this applies strongly to advisors. Changed the example from an NDA redline to an annual-review letter with a retirement-age tracked change. Changed the Keepance AI callout from "Your standard NDA uses a 5-year term" to "Pulled the retirement-age goal from the March 2024 meeting notes." Feature-list bullets adapted: "Import an agreement from opposing counsel" dropped; "grounded in the client's actual file" added.

### Data story section (The honest data story)
**Lightly reframed.** Kept the three-tier model (local / BYOK / Assured) and the egress indicator copy. Changed "You read fine print for a living" to "You handle some of the most sensitive data there is." Changed "hand to a worried client" to "share with your CCO or show to a client who asks." Changed "Tag, segregate, and scrub privileged work, with an audit trail that reads as a defense file" to "Tag, segregate, and keep confidential client data organized, with an audit log your compliance team can review." Changed the Clio reference in "it fits beside..." to Wealthbox. Kept the Microsoft 365 Copilot comparison paragraph as-is (it applies equally to advisors).

### Who it's for section
**Reordered + reframed.** Card order changed: Advisors is now card 1 (was card 4). H2 changed from "Built for litigators, and the firms they grow into" to "Built for financial advisors, and the practices they grow into." Sub changed from "the solo who carries the whole caseload" to "the advisor who carries the whole book." The advisor card (now first) has a full rewrite. The attorney card (now last) is shortened significantly -- no Heppner reference, just a brief ABA 512 mention. Tax and consulting cards kept largely intact with minor copy tweaks.

### Pricing section
**Reframed.** H2 changed from "A fraction of CoCounsel" to "A fraction of Jump." Solo tier relabeled from "A single attorney" to "A single advisor." Professional tier relabeled from "The serious solo or small-firm litigator" to "The serious solo or small-team RIA." Professional feature bullet "The litigation associate: contradiction-finder, timelines, discovery triage, privilege-log drafter" replaced with "The Advisor Practice Pack: 7 templates for fiduciary work (Reg BI documentation, Reg S-P safeguards outline, client financial-plan summary, annual-review packet, meeting-prep and suitability notes)." Firm tier relabeled from "Firms of roughly 5 to 50 attorneys" to "Advisory firms, roughly 3 to 50 advisors." "Shared matters" changed to "Shared client files." "Ethical walls" changed to "Information barriers." Competitor comparison table replaced entirely (see section (c)).

### Compliance note section (was "Legal note section")
**Reframed.** CSS class name unchanged. H4 "A note on compliance claims" changed to "A note on regulatory references." ABA and IRC §7216 references removed. Reg S-P and Reg BI references inserted with proper hedging ("informational, not compliance or legal advice; verify with your CCO or compliance counsel"). The other two notes ("Where your data actually goes," "Already bought the old one-time license?") kept as-is.

### Built by section
**One sentence reframed.** "The AI tools that could help most were the ones a lawyer can't legally paste a client's name into" changed to "a financial advisor can't responsibly paste a client's financials into."

### Footer
**Unchanged.**

---

## (c) Legal elements removed and why they don't apply to advisors

| Removed element | Why it doesn't apply to advisors |
|---|---|
| "For attorneys" eyebrow | Advisors are not attorneys; wrong audience signal from the first word |
| "The private intelligence layer for your law practice" h1 | Wrong profession. Replaced with advisory practice framing. |
| "Tear through a deposition for contradictions" hero sub | Depositions are a litigation concept. Advisors do not take depositions. |
| "The litigation associate" feature section (entire) | Deposition contradiction finding, case timelines, discovery triage, and privilege-log drafting are litigation-specific tasks with no meaningful analog in advisory work. |
| "Deposition contradiction finder" | No depositions in advisory practice. |
| "Privilege-log drafter" | Privilege logs are a discovery/litigation deliverable. Advisors have no equivalent. |
| "Discovery triage" | Discovery is a litigation process. Advisors are not involved in litigation discovery as a core workflow. |
| "Redline the agreement from opposing counsel" | Advisors do not litigate against opposing counsel. |
| "Chen v. Merritt" case example | A litigation case name. Replaced with "Henderson Household" client example. |
| "Deposition_Vol_II.pdf · 142:8" citation style | Deposition transcript citations are a legal format. Replaced with financial-planning document citations. |
| "Meet-and-confer summary" | A litigation discovery process. No analog for advisors. |
| ABA Formal Opinion 512 as a primary proof point | ABA ethics opinions govern attorneys, not financial advisors. The ABA reference is retained only in the (now-last, shorter) attorney card in "Who it's for." |
| United States v. Heppner (Judge Rakoff, S.D.N.Y.) | A federal criminal case about attorney AI use. Completely irrelevant to advisors. Removed entirely. |
| "Attorney-client privilege" and "work-product" | Legal concepts. Replaced with "Reg S-P NPI safeguarding" and "confidential client data." |
| "Opposing counsel" | Litigation role with no advisory analog. |
| "Engage letter (ABA 512)" as a workflow | ABA engagement letters are attorney-specific. Replaced with Advisor Practice Pack templates (Reg BI, Reg S-P, etc.). |
| "Bar counsel" as compliance authority | Attorneys report to bar counsel; advisors report to their CCO. |
| "Built for litigators" section h2 | Wrong audience. |
| CoCounsel / Westlaw competitor table | Legal AI tools. Irrelevant to advisors. Replaced with Jump / eMoney / Microsoft Copilot / Wealthbox. |
| "A fraction of CoCounsel" pricing headline | CoCounsel is a legal AI product. Replaced with "A fraction of Jump." |
| "The litigation associate: contradiction-finder, timelines, discovery triage, privilege-log drafter" pricing feature | Litigation-specific. Replaced with Advisor Practice Pack description. |
| "Firms of roughly 5 to 50 attorneys" | Wrong profession label. |
| "Shared matters" | Legal terminology. Changed to "shared client files." |
| "Ethical walls" | Legal/law-firm concept. Changed to "information barriers," which is the advisor/financial-industry equivalent. |
| "Defense file" audit trail framing | Litigation language. Changed to "audit log your compliance team can review." |
| IRC §6713 / §7216 references as primary compliance frame | Tax-attorney-specific. These are relevant for CPAs but not the main regulatory frame for advisors. Retained only in the Tax pros card. |
| ABA/IRC compliance note at the bottom | Replaced with Reg S-P / Reg BI note with proper advisory-specific hedging. |

---

## (d) Regulatory claims that need a securities-compliance review before publish

Every regulatory claim on this page should be reviewed by a securities-compliance professional (or a securities attorney with RIA compliance expertise) before the page goes live. The specific claims are:

1. **Reg S-P framing throughout.** The page says Keepance's local-first architecture keeps the advisor out of the Reg S-P vendor-oversight requirement. Specifically: "Run a local model with Ollama and nothing leaves your machine, ever. There is no AI vendor in the data path to vet under Reg S-P." This is the central claim and needs confirmation that (a) Keepance in local-model mode does not constitute a "service provider" under Reg S-P's amended definition, and (b) the framing does not overstate what "no vendor in the data path" actually means for a firm's full Reg S-P obligations.

2. **"The SEC amended Regulation S-P in 2024, with safeguards and breach-notification requirements that took effect in 2025."** (in the Financial Advisors card). Confirm the exact effective dates for different firm sizes; the small-RIA deadline was June 2026 per the ecosystem doc but this claim says 2025. Reconcile before publish.

3. **Reg BI documentation framing.** The page implies that Keepance can help "document the basis for recommendations" for Reg BI purposes. This is stated as a drafting aid ("draft the follow-up letter and the Reg BI note"), not a compliance guarantee. Still, a securities reviewer should confirm this framing does not imply Keepance itself satisfies Reg BI recordkeeping requirements.

4. **Books-and-records language in the Advisor Practice Pack description.** The /financial-advisors/ page (our reference) already addresses this with proper hedging. The homepage references the pack but the full hedging language ("each produces drafts you review; none makes a determination for you") is on the /financial-advisors/ page, not repeated in full here. Consider whether a shorter version of that hedge belongs on the homepage.

5. **GLBA / Safeguards Rule.** Not mentioned on this page (it is on the /financial-advisors/ page). If added in a future revision, needs securities-compliance review.

6. **"Information barriers" (replacing "ethical walls").** Confirm this is the correct advisory-industry term for client-access restrictions and not a term of art with specific regulatory meaning that Keepance does not technically satisfy.

7. **"No AI vendor in the data path" claim for BYOK mode.** The page is careful to note that with a cloud key, "that provider does see the prompt." A reviewer should confirm the BYOK framing does not inadvertently suggest the AI provider is not a covered "service provider" under Reg S-P when the API key path is used.

All of these are marked as informational on the page with "This is informational, not compliance advice. Verify with your compliance counsel." That hedge is in place, but the page still should not go live without a human securities-compliance review given the SEC's active AI-washing enforcement posture.

---

## (e) Recommended plan for the rest of the site (advisor funnel)

### Promote to front and center (already advisor-correct, link from everywhere)

- `/financial-advisors/` -- the canonical advisor landing page; nav now links it first
- `/one-pagers/advisor-cco-reg-sp.html` -- the Reg S-P architecture memo for CCOs; ideal link from the compliance note section
- The Reg S-P blog post (`/blog/reg-s-p-changed-your-ai-vendor-list` or equivalent) -- link from the data story section and from the advisor card
- `/vs/jump` -- if this page exists or is built, it should be promoted in the advisor funnel; the homepage competitor table now frames Jump as complementary, not a competitor, which sets up the /vs/jump page correctly

### Keep but deprioritize (leave reachable, remove from primary advisor funnel)

- `/legal/` -- still reachable via nav (now last) and the attorney for-card; just no longer the hero destination
- `/legal-practice/` -- if this exists, keep for SEO but do not link from advisor-facing pages
- `/vs/cocounsel` -- legal AI comparison; keep for SEO and for attorneys who land on it, but remove from any advisor-facing link paths
- `/vs/clio-duo` -- same treatment as /vs/cocounsel

### Retire from the advisor funnel (consider redirecting or archiving)

- **Press kit "law practice" one-liner** -- the press kit currently describes Keepance as "the private intelligence layer for a law practice." This should be updated to an advisor-first or profession-neutral one-liner before any press outreach. The strategy doc flags this explicitly.
- **Legal blog posts** (ABA, Heppner, privilege) -- do not link these from the advisor funnel; let them be found via search if attorneys look for them, but remove from featured/recommended blog lists on advisor-facing pages
- **Legal malpractice one-pager** -- retire from the advisor funnel; not relevant to advisors and could confuse the positioning

### Build next for the advisor funnel

- `/vs/jump` -- an honest comparison page positioned around "Jump owns the meeting; Keepance owns the prep and the drafting" would convert advisors who already use Jump and are looking for the second-layer tool
- A Reg S-P deep-dive landing page or blog post linked from the data story section (the /financial-advisors/ page already has the compare table; a standalone Reg S-P explainer would make a strong SEO asset for "AI and Reg S-P" searches)
- An advisor demo / sample household walkthrough -- the ecosystem doc describes the ideal demo (Roth question, Client Map, annual review letter) and it does not exist as a public page yet

### Pricing page consistency

The homepage now shows the Advisor Practice Pack in Professional tier. The /financial-advisors/ page shows slightly different pricing copy (it says $99/yr founding rate in one place). Before publish, reconcile the two pages so the pricing story is identical across the funnel.
