# Advisor Prep Hero: Vertical Competitive Landscape (Legal, Tax, Consulting, Financial Advisors)

**Date:** 2026-06-06
**Author:** Independent competitive-intelligence pass commissioned by Jameson. Four parallel analysts (one per vertical) did live web research in June 2026 against a named competitor list, then this was synthesized into one strategic view.
**Why it exists:** Advisor Prep Hero's prior competitive work (`docs/reference/COMPETITIVE_LANDSCAPE.md`, the April `market-assessment-2026-04/` deep dive) benchmarks against the PKM / general-AI-note world (Notion, Obsidian, ChatGPT, Reflect). That work largely predates the pivot to the four professional verticals. This document fills the missing piece: **what the four verticals are already using or being sold for AI, what they get bundled for free, and where the real gaps are.**
**Companion docs:** the 2026-06-04 [independent four-vertical review](./2026-06-04-independent-four-vertical-review.md) (what deters these buyers on our own site). Several recommendations there are reinforced by the competitive data below.

> **Accuracy note.** AI product pricing and features move fast. Figures are mid-2026 best-effort, many cross-checked against vendor pages, some from third-party aggregators (flagged). Verify any specific number before using it in public marketing. Full source links are in each section and the appendix.

---

## 1. Executive summary: the one picture

Every one of our four verticals now has incumbents actively pushing AI at them. Those incumbents fall into three buckets, and the middle one is our real problem:

1. **Bundled AI, already paid for** (the biggest threat): Clio Duo for lawyers, Intuit Assist for tax, eMoney/MoneyGuidePro AI for advisors, Microsoft 365 Copilot for everyone. Cheap or free add-ons to tools they already own, with zero new-vendor friction. This is the "good enough and already here" competition.
2. **Expensive purpose-built vertical AI:** CoCounsel, Harvey, Lexis+ Protégé (legal); Blue J, TaxGPT, Thomson Reuters CoCounsel Tax (tax); Jump, Zocks, Zeplyn, FP Alpha (advisor); Gamma (consulting decks). Genuinely capable, but $1,200 to $3,000+ per user per year, and cloud-only.
3. **The consumer baseline:** free/Plus ChatGPT and Claude. What most practitioners *actually* use today, the cheapest, and the riskiest from a confidentiality standpoint.

**The single most important finding:** across all four verticals, **essentially every serious competitor is cloud SaaS, and their entire privacy story is contractual** ("we don't train on your data," "zero retention," "SOC 2"). Not one of the category leaders offers a true local, nothing-leaves-the-machine option. The only tools that do are generic local-AI runners (Ollama, GPT4All, Msty, Jan, and one Mac-only legal note app, Elephas) that have no profession-specific structure.

**That gap is Advisor Prep Hero's wedge, and it is getting more valuable right now because of regulatory forcing functions landing in 2026:**
- **Legal:** *United States v. Heppner* (S.D.N.Y., Judge Rakoff, Feb 17 2026) held that consumer cloud-AI use without attorney direction destroyed privilege. The defendant was convicted May 7 2026. It is real, heavily covered, and it is the single best argument we have. (Note: later courts are already diverging toward a fact-specific approach, so cite it as a cautionary leading case, not settled black-letter law.)
- **Advisor:** the SEC Reg S-P amendments' compliance deadline for smaller RIAs **passed June 3, 2026** (three days before this doc). Every small RIA now must document and monitor every vendor that touches client data. With Advisor Prep Hero on a local model, there is no vendor to monitor.
- **Tax:** IRC §7216/§6713 and the FTC Safeguards Rule. A cloud key is still a third-party disclosure of return data; only a local model removes it.
- **Consulting:** NDAs increasingly carry explicit "no uploading work product to AI services" clauses. Only a local model honors that literally.

**The durable point:** "contractual no-training" is not the same as "the data never left the building." Advisor Prep Hero plus a local model is the only product in any of these four markets that makes the absolute claim true.

**But Advisor Prep Hero has the same gaps in every vertical, and we should be honest about them:**
- No proprietary research database (legal case law / Shepard's-KeyCite; tax primary authority). CoCounsel, Lexis+, Blue J win this outright. We cannot.
- No deep system-of-record integration (Clio, Drake, eMoney, a CRM). The bundled incumbents own the workflow context.
- No meeting-notes + CRM-sync workflow, which is the #1 thing advisors are actually buying (Jump, Zocks).
- Weaker finished-deliverable output (consulting decks vs Gamma; branded advisor PDFs).
- BYOK onboarding friction, and no SOC 2 / signed DPA / brand / track record, which formal vendor-approval processes ask for.

**Strategic conclusion:** Do not position Advisor Prep Hero as a replacement for the incumbents. Position it as **the private workspace that sits beside them**, own the local/zero-egress + own-your-files + regulatory-forcing-function story, lead the most sensitive buyers with the local model, anchor price against the $1,200 to $3,000/yr incumbents, and refuse the battles we cannot win (research databases, meeting-notes/CRM sync). Close the trust-signal gaps (SOC 2, the gatekeeper one-pagers from the 2026-06-04 review, branded output).

---

## 2. The four markets at a glance

| | What they already pay for | The bundled AI threat | The hot purpose-built tool | What most actually use | The 2026 regulatory lever | Advisor Prep Hero's wedge | Our biggest gap |
|---|---|---|---|---|---|---|---|
| **Legal** | Clio, Westlaw/Lexis, M365 | **Clio Duo / Manage AI** ($49-59/mo add-on) | CoCounsel ($225-428/mo), Harvey (enterprise) | Free ChatGPT/Claude | **US v. Heppner** (privilege) | Local zero-egress; own files; $149/yr; post-Heppner story | No case-law DB / citation check |
| **Tax** | Drake or Lacerte/ProConnect, TaxDome, SafeSend | **Intuit Assist** (free in Lacerte/ProConnect) | Blue J ($1,498/yr), TaxGPT, CoCounsel Tax | Consumer ChatGPT (52% of AI users) | **§7216/§6713 + Safeguards** | §7216-clean local model; Drake users have nothing; §7216+WISP templates | No primary-authority research; no prep integration |
| **Consulting** | M365 / Google, a CRM, PowerPoint | **M365 Copilot** ($18-30/mo) | Gamma decks ($9-18/mo) | ChatGPT Plus / Claude Pro | **NDA no-AI-upload clauses** | Only local model truly honors a no-upload clause; per-client isolation | Deck output (Gamma wins); web research |
| **Advisor** | eMoney/MoneyGuidePro, Redtail/Wealthbox, M365 | **eMoney/MGP AI + M365 Copilot** | **Jump** (27k advisors, $75-175/mo), Zocks | Shadow ChatGPT/Claude | **Reg S-P deadline (Jun 3 2026)** | Zero Reg S-P vendor surface; local zero-egress; own files | Not a meeting-notes/CRM tool; no SOC 2/DPA |

---

## 3. Legal (solo and small-firm attorneys)

### Adoption reality
69% of legal professionals now use generative AI (up from 31% a year earlier); 71% of solos and 75% of small firms report some use, but only ~4% have adopted it widely. The #1 barrier is data security (46%), followed by ethics and privilege concerns. The honest baseline: **most solo/small-firm lawyers who use AI at all are pasting into free ChatGPT or Claude** (the exact Heppner risk), a second cohort uses whatever is embedded in Clio, and a minority pays separately for CoCounsel or Paxton. Harvey is irrelevant to this segment (enterprise-only).

### The field

| Tool | Deployment | Data posture | Price (solo) | Strength / where it beats us | Where Advisor Prep Hero wins |
|---|---|---|---|---|---|
| **Clio Duo / Manage AI** (the key one: most already pay for Clio) | Cloud | Zero-retention with LLMs; no training; SOC 2 | **$49-59/mo add-on** to existing Clio (or bundled in Elite ~$159/mo) | Already in the workflow; knows the matter/client/deadline/billing; one click, no setup | Local zero-egress; own files; far deeper legal templates; 1/4 the price |
| **CoCounsel** (Thomson Reuters) | Cloud | Contractual no-training; zero retention at LLM; SOC 2 | ~$225-428/mo (≈$2,700-5,000/yr) | Westlaw-grounded, **citeable research**; deep litigation coverage; brand | Price; zero-egress; own files; no vendor cloud holding client data |
| **Harvey** | Cloud (Azure) | Enterprise-grade; ZDR; SOC 2 + ISO 27001 | Enterprise only; **$30k+/yr min, 25+ seats** | Most powerful for BigLaw M&A/due diligence; custom-trained | Inaccessible to solos; we serve the segment Harvey ignores |
| **Lexis+ AI / Protégé** | Cloud (now offers **BYOK encryption**) | No training; **Shepard's citation verification**; customer-held keys (AmLaw) | ~$128-494/mo + Lexis sub | Shepard's verify; agentic drafting grounded in primary law; BYOK encryption | Still cloud-only even with BYOK; price; local option; own files |
| **Spellbook** | Cloud (Word add-in) | SOC 2; less explicit no-training claim | ~$500+/mo (undisclosed) | Best-in-class contract drafting/redline in Word | Litigation/IP/estate breadth; price; local; own files |
| **Paxton AI** | Cloud | SOC 2; **admits privilege does not attach** | ~$250-500/mo | Case-law DB incl. PTAB/TTAB for patent/TM; solo-marketed | Price; local; their own privilege disclaimer is our talking point |
| **Robin AI** | Cloud (private AWS per customer) | Strong; private instances; SOC 2/ISO | $100/mo Pro | Private-cloud architecture; clause analysis | Contracts-only; still cloud; local option |
| **M365 Copilot** | Cloud (tenant) | No training (enterprise); consumer tier risky | $30/mo add-on | Already in Word/Outlook; productivity | Zero legal depth; no local; consumer tier = Heppner risk |
| **Free ChatGPT / Claude** | Cloud | **Consumer tier trains by default** | $0-20/mo | Zero friction; capable | The Heppner scenario itself; no templates; nothing saved locally |
| **Elephas** (watch: closest analogue) | **Local (Mac, Ollama)** | Zero egress | $10-30/mo | The only marketed local-AI app for lawyers; per-matter local RAG | Generic, not a legal pack; Mac-only; we have legal-specific templates + Win/Linux |

### The regulatory lever: *US v. Heppner*
A federal court just held that putting your work into consumer cloud AI, without attorney direction, defeats privilege (no attorney involved; no confidentiality once shared with a third-party platform under its privacy policy; not at counsel's direction). The Kovel-style exception: it can be different if counsel *directs* the use. This is the strongest tailwind any of our verticals has, and it points directly at the local-model path. Cite it as a leading cautionary case (later courts are diverging to fact-specific analysis).

### Where Advisor Prep Hero wins / loses, and the white space
- **Wins:** price (4x-20x cheaper than the purpose-built tools), the only zero-egress local option in the segment except generic Elephas, own-your-files longevity, and the cleanest post-Heppner privilege posture (local model = nothing left the machine).
- **Loses:** no case-law database and no citation verification (CoCounsel/Lexis+/Paxton win this and it is table stakes for *research*), no Clio-grade practice-management context, BYOK onboarding friction, and brand.
- **White space to own:** the privileged-local-AI slot is nearly empty (only Elephas, which is Mac-only and generic). A purpose-built, legal-template-equipped, local-capable desktop app is a defensible niche, and it is the literal instantiation of Heppner's attorney-directed-use carve-out.
- **Table stakes we must respect:** be explicit that Advisor Prep Hero is **not** a legal-research tool. It sits beside Westlaw/Lexis. Burying that invites churn and bar complaints.

### Talking points
- vs free ChatGPT/Claude: "Heppner shows that's a privilege waiver waiting to happen. With Advisor Prep Hero on a local model, nothing leaves your machine, and your files stay yours forever."
- vs Clio Duo: "Clio's AI is great for what Clio knows: matters, billing, deadlines. It's shallow on the actual legal work and your documents live on Clio's cloud. Advisor Prep Hero does the privilege log, the deposition contradiction finder, the evidence-gap analysis, for $149/yr, beside Clio, not instead of it."
- vs CoCounsel: "Excellent if you need Westlaw-grounded research, and $2,700+/yr. If you already pay for Westlaw, you don't need CoCounsel just to draft a privilege log. Advisor Prep Hero is $149/yr and your data never leaves your machine."
- **Use the incumbent instead when:** you need citation-verified case-law research (CoCounsel/Paxton), deep Clio matter integration (Clio Duo), or you're a 10+ attorney firm with IT (Harvey/CoCounsel).

---

## 4. Tax (solo and small-firm CPAs / EAs)

### Adoption reality
AI adoption among tax firms roughly quadrupled (≈9% to ≈41%) in a year, but **52% of AI-using tax firms use consumer tools (ChatGPT/Claude)** rather than purpose-built ones; only ~17% use purpose-built tax AI. Only ~34% of solos use AI regularly. The hard constraint: **January to mid-April is a blackout** for adopting anything new; the real evaluation window is May to November. Software split: Drake dominates small/solo by unit count (~30-35%), Intuit (Lacerte/ProSeries/ProConnect) next, CCH at the top end.

### The field

| Tool | Deployment | Data posture | Price | Strength / where it beats us | Where Advisor Prep Hero wins |
|---|---|---|---|---|---|
| **Intuit Assist** (bundled in Lacerte/ProConnect/ProSeries) | Cloud | Return data on Intuit cloud; **AI-training disclaimer unclear** | **$0 extra** (bundled) | Already paid for; pulls 60+ data points from the return; advisory planning | Privacy (their training policy is murky); breadth (it's planning-only); Drake users get nothing |
| **Drake** (market leader, small firm) | Desktop/cloud | n/a | ~$1,800-2,600/yr | — (has **no** generative AI) | **Drake users have no AI at all**: our single largest, most underserved segment |
| **Thomson Reuters CoCounsel Tax / Checkpoint** | Cloud (AWS GovCloud) | Best-in-class: zero-retention API calls; no training; SOC 2 | ~$180-280/user/mo | Real primary authority (Checkpoint); agentic "Ready to Review" 1040 prep; brand | Price; zero-egress local; §7216 still implicates the cloud transmission |
| **Blue J ("Ask Blue J")** | Cloud (AWS) | No training; 24-hr file deletion; SOC 2; abuse-monitoring opt-out | **$1,498/yr** (CPA.com ~$998 promo) | Genuine primary-authority research + predictive confidence scoring | Price; research-only (no notices/engagement/WISP); local option |
| **TaxGPT** | Cloud | SOC 2; no training; PII redaction | ~$133/user/mo (est., opaque) | Full workflow: research + return review ("Agent Andrew") + comms | Cloud-only; opaque pricing/sales call; no §7216 tooling; local option |
| **CCH Expert AI / AnswerConnect** (Wolters Kluwer) | Cloud | "Never train on customer data" | AnswerConnect ~$890+/yr | Native for CCH firms (big-firm standard); expert content | Irrelevant to Drake/Lacerte solos; cloud; no §7216/WISP tooling |
| **CPA Pilot** (watch: cheap + purpose-built) | Cloud | SOC 2 referenced | **$19-29/mo** | Purpose-built tax research, cites, support docs for Drake/Lacerte/UltraTax; cheap | Cloud-only; no §7216/WISP; no local; no own-files |
| **M365 Copilot** | Cloud (tenant) | No training (enterprise) | $30/mo | Drafting/Excel; in their stack | No tax depth; no §7216 tooling; no local |
| **Consumer ChatGPT/Claude** | Cloud | Consumer tier trains by default | $0-20/mo | What 52% already use | §7216 exposure; hallucinated Code sections; no templates |
| **DIY Ollama (Qwen) for tax** (watch) | **Local** | Zero egress | ~$999 hardware | A real solo-CPA community runs this for §7216-clean work | No commercial product exists here: **pure white space for us** |

### The regulatory lever
IRC §7216 (criminal) and §6713 (civil strict-liability) govern disclosure of return information; the FTC Safeguards Rule requires a WISP. The key point most vendors blur: a **cloud API key is still a disclosure to a third party** (the provider). Only a local model removes it. **No competitor markets a §7216-clean architecture, and none offers a §7216 consent template or a WISP builder.** Advisor Prep Hero can own all three.

### Where Advisor Prep Hero wins / loses, and the white space
- **Wins:** the §7216-clean local model (no competitor can claim this), Drake compatibility (a third of the small-firm market has no AI from their vendor), transparent solo pricing, and §7216-consent + WISP templates no one else ships.
- **Loses:** no primary-authority research (Blue J/CoCounsel/CCH win), no return-prep integration (TaxGPT/Black Ore/TR Ready-to-Review), and BYOK setup friction is fatal during filing season.
- **White space to own:** the productized §7216-clean local workflow + the WISP/Safeguards module + Drake-companion positioning. The DIY-Ollama-for-tax community proves the demand; no commercial product serves it.

### Talking points
- "Every other AI tax tool, even the best, routes your client's return data through a vendor cloud and an LLM API call. Under §7216 that's a third-party disclosure. With Advisor Prep Hero on a local model, nothing leaves your machine. It's the only §7216-clean architecture sold today."
- "On Drake? Your vendor gives you zero AI. The research tools are $1,500-3,000/yr; ChatGPT is free but risky. Advisor Prep Hero is $149/yr with CP2000-response, §7216-consent, and research-memo templates built in."
- **Use the incumbent instead when:** you need citation-grounded research (Blue J/CoCounsel), you're already on Lacerte and just want advisory planning (Intuit Assist, free), or you want AI return prep (TaxGPT/Black Ore).
- **Timing:** market and onboard tax pros in the May-November off-season; make BYOK setup near-frictionless or lead with local Ollama.

---

## 5. Consulting (independent strategy + boutique agencies)

### Adoption reality
Very high AI use, very low governance. Most independent consultants use **ChatGPT Plus or Claude Pro and hope for the best**, not realizing those consumer tiers train on inputs by default (Claude consumer: 5-year retention as of Sept 2025; opt-out required). NDAs increasingly add explicit AI provisions; sophisticated clients now distinguish "no training on our data" from "no upload at all," and the strictest clauses are blanket no-upload. The deliverable is a board-ready deck.

### The field

| Tool | Deployment | Data posture (key tiers) | Price | Strength / where it beats us | Where Advisor Prep Hero wins |
|---|---|---|---|---|---|
| **ChatGPT** | Cloud | Free/Plus/Pro **train by default**; Business/Enterprise no-training | $0-20 indiv; $20-30/seat Business | Most capable; zero friction; what they already use | Plus/Pro can't honestly claim no-upload; no local; no per-client isolation |
| **Claude** | Cloud | Free/Pro/Max train by default; Team/Enterprise no-training | $20 Pro; $25/seat Team | Long-context document analysis; same engine Advisor Prep Hero can BYOK | Consumer tiers risky; no local; no isolation |
| **M365 Copilot** | Cloud (tenant) | No training; tenant-isolated | $18-30/mo add-on | In Word/PowerPoint/Outlook; **generates real PPTX files** | Still leaves the machine; output needs heavy cleanup; no local; no isolation |
| **Notion AI** | Cloud (sends to OpenAI/Anthropic) | No training (all tiers); Enterprise zero-retention | $20/seat (Business) | Embedded in their KM; structured docs | **Routes data to external AI every call** (fails no-upload); no local |
| **Gamma** (the deck king) | Cloud | Free/Plus train (opt-out); Team/Business no-training | $9-18/mo indiv | **Polished designed decks in minutes** (decisively beats our PPTX) | Cloud-only (fails no-upload); no per-client isolation; not a research/writing env |
| **Beautiful.ai / Plus AI** | Cloud | No-training (contractual) | $12-40/mo | Branded slide design; Plus AI works inside PPT/Slides | Cloud; data leaves machine; deck-only |
| **Perplexity** | Cloud | Enterprise Pro no-training | $20-40/mo | Real-time cited web research | Cloud; no local; research-only |
| **Glean** | Cloud (single-tenant; on-prem option) | ZDR; permission-aware | ~$50/seat, ~100-seat min | Enterprise search across all data; on-prem option | Priced out of the boutique segment entirely |
| **Local tools** (Msty, GPT4All/LocalDocs, Jan, Ollama) (watch) | **Local** | Zero egress | Free-$ | The privacy-purist alternative; GPT4All/Msty do local-folder RAG | Raw infrastructure with no consulting structure: **the gap Advisor Prep Hero fills** |

Note: **Tome shut down its presentation product in 2025**, so it is no longer a competitor.

### The regulatory/contract lever
The NDA "no uploading work product to AI services" clause. The honest reading: a cloud key (even ChatGPT Enterprise or M365 Copilot) still uploads to a vendor; only a **local model** truly satisfies a strict no-upload clause. This is the precise wedge, and it is also the place our own site currently overclaims ("sidesteps the clause entirely"), per the 2026-06-04 review. Fix the claim to be local-model-specific and it becomes both accurate and more persuasive.

### Where Advisor Prep Hero wins / loses, and the white space
- **Wins:** the only tool where a consultant can truthfully tell a client "nothing was uploaded to anyone's servers" (local model); per-client folder isolation (no competitor has this as a primitive); own-your-files; cost.
- **Loses, badly, on the deliverable:** Gamma and Copilot-in-PowerPoint produce real, designed decks; Advisor Prep Hero produces an outline plus a basic PPTX. For a persona whose product *is* the deck, this is the gating gap.
- **White space to own:** (1) the client-facing "how I handle your data with AI" one-pager (the exact recommendation from the 2026-06-04 review, and a true differentiator: it turns AI use into a sales asset); (2) per-client isolation as a marketed feature; (3) wrapping local models in consulting-specific structure that raw Msty/GPT4All lack.

### Talking points
- "ChatGPT Plus is paying $20/mo to train OpenAI on your client's strategy. The tools consultants actually use are the worst for confidentiality."
- "Only a local model can truthfully honor a 'no AI upload' clause. Advisor Prep Hero is the only consulting tool with that architecture."
- "Use Gamma for the final deck; use Advisor Prep Hero for everything that happens before it." (Honest, and it neutralizes our weakest point.)
- **Use the incumbent instead when:** you need a polished deck fast (Gamma/Copilot), real-time web research (Perplexity), or you have no sensitive data and want zero setup (ChatGPT Business).

---

## 6. Financial advisors (independent RIAs)

### Adoption reality
~63% of RIAs use AI in some capacity, but only ~1 in 10 have integrated it strategically; "shadow AI" (advisors pasting client data into ChatGPT/Claude without firm governance) is rampant and is the top CCO worry. The market has bifurcated into two hot purchase categories: **AI meeting-notes / operating systems** (the dominant category) and **document-analysis planning** tools.

### The field

| Tool | Deployment | Data posture | Price | Strength / where it beats us | Where Advisor Prep Hero wins |
|---|---|---|---|---|---|
| **Jump** (category leader) | Cloud (AWS) | No training; SOC 2 Type II + HIPAA; **no public DPA** | **$75-175/advisor/mo** | Purpose-built meeting notes; 30+ CRM integrations; 27,000 advisors; T3 #1 | Client data in cloud; no local; no zero-egress; 6-14x our price |
| **Zocks** (privacy-positioned) | Cloud | **No audio/video stored** (notes only); SOC 2 Type II; Smarsh/Global Relay archive integration | $67-184/mo | No-recording architecture; eMoney sync; books-records archiving | Still cloud (notes leave machine); no local; no DPA published |
| **Zeplyn** | Cloud | SOC 2 Type II; recording-free option | ~$60-120/mo | Agentic "Agent Nexus" across the stack | Small vendor ($3M raised); cloud; no local |
| **FP Alpha** | Cloud | SOC 2; training policy undisclosed | **$1,995/yr** | Reads tax returns/wills/trusts → planning insights (we can't do this) | Uploads the most sensitive docs to a cloud; no local; training policy unclear |
| **eMoney / MoneyGuidePro** (bundled) | Cloud | Envestnet enterprise security | bundled (~$100-300/mo) | Already in the stack; AI data-import + note summarize | Narrow to planning data; no local; not general-purpose |
| **Conquest Planning** | Cloud | "Compliance-first," auditable engine | per-plan/unlimited | Auditable planning AI; MCP server | Planning-only; cloud |
| **M365 Copilot** | Cloud (tenant) | No training; **but a DLP-bypass bug (Jan-Feb 2026)** | $30/mo | In their Office stack | The DLP bug is a CCO red flag; no advisor depth; no local |
| **Shadow ChatGPT/Claude** | Cloud | Consumer tier trains | $0-20/mo | What advisors already do ad hoc | The governance gap Advisor Prep Hero can close; no local |
| **Smarsh / Global Relay** | Cloud | WORM archiving | quote | Books-records archiving (complementary, not a competitor) | Advisor Prep Hero local files sidestep archiving for non-shared content |
| **(No local advisor tool exists)** | — | — | — | — | **The entire zero-egress slot is empty: our biggest white space** |

(Morgan Stanley's "AI @ Morgan Stanley Debrief" proves advisor meeting-AI works at scale, but it is wirehouse-only and unavailable to independent RIAs. It is a benchmark, not a competitor.)

### The regulatory lever (strongest of all four, and time-sensitive)
The **SEC Reg S-P amendments' compliance deadline for smaller RIAs passed June 3, 2026** (a written incident-response program, 30-day breach notification, and **service-provider oversight**, the duty to vet and monitor every vendor that touches client data). Plus books-and-records (Rule 204-2) retention questions around AI outputs, and active SEC **AI-washing** enforcement. The Advisor Prep Hero argument writes itself: **on a local model there is no AI vendor to vet, no covered data leaving the firm, and the files are plain records the firm already controls.**

### Where Advisor Prep Hero wins / loses, and the white space
- **Wins:** zero Reg S-P vendor surface (with a local model there is no service provider to oversee), zero-egress for the most sensitive documents, own-your-files as latent 204-2 support, much lower cost, and general-purpose drafting beyond meeting notes.
- **Loses:** Advisor Prep Hero is **not** a meeting-notes / CRM-sync tool, which is the #1 thing advisors are buying; no SOC 2 / signed DPA (a hard blocker in formal RIA vendor approval); no branded-PDF plan output; and no track record against Jump's 27,000-advisor "no one got fired for buying Jump" status.
- **White space to own:** there is **no local, zero-egress advisor AI tool on the market at all.** Pair that with a CCO-facing "how Advisor Prep Hero fits your Reg S-P program" one-pager (the 2026-06-04 review's recommendation) and Advisor Prep Hero can own the "AI for advisors who won't put client data in someone else's cloud" position outright, especially for HNW/UHNW, family-office, and estate-heavy practices.

### Talking points
- "You just became obligated to vet every AI vendor for Reg S-P. With Advisor Prep Hero on a local model, there is no vendor to vet. The vendor surface is zero."
- "Every advisor AI tool, even the privacy-positioned ones, is a cloud vendor receiving your clients' most sensitive financial data. Advisor Prep Hero on a local model routes nothing through anyone's server."
- "Your files are Markdown on your disk. When Jump raises prices or your firm changes CRMs, your records don't disappear."
- **Use the incumbent instead when:** the primary pain is meeting-notes + CRM sync (Jump/Zocks, purpose-built, and we are not), you need document-to-planning analysis (FP Alpha), or your vendor-approval process strictly requires SOC 2 + a DPA (which we do not yet have).

---

## 7. Cross-cutting synthesis

**1. The real competition is "good enough and already paid for."** In three of four verticals, the most dangerous competitor is not the impressive purpose-built tool, it is the AI bundled into the system of record the practitioner already owns (Clio Duo, Intuit Assist, eMoney/MGP AI) plus M365 Copilot. These are cheap or free, frictionless, and have decent contractual privacy. Advisor Prep Hero cannot beat them on convenience or integration. It beats them on architecture (local/zero-egress), depth of profession-specific templates, and price-vs-the-premium-tier.

**2. "Contractual privacy" vs "architectural privacy" is the one durable moat.** Every cloud competitor's privacy pitch is a promise (no training, zero retention, SOC 2). Advisor Prep Hero with a local model is the only one offering a *fact* (nothing leaves the machine). That distinction is abstract until a regulator or a court makes it concrete, and in 2026 they are: Heppner, Reg S-P, §7216, NDA clauses. This is the spine of the whole positioning.

**3. The regulatory tailwind is real and time-sensitive.** Heppner (Feb 2026), the Reg S-P small-RIA deadline (June 3 2026), and rising NDA AI clauses are all landing now. The local-model story should be the hero of every vertical page, not a footnote. (The 2026-06-04 review found we currently bury it and sometimes overclaim the cloud-key case; both should be fixed.)

**4. Advisor Prep Hero has the same five gaps everywhere. Decide which to close and which to concede.**
- *Concede (do not try to win):* proprietary research databases (legal case law, tax primary authority). Position around them ("sits beside Westlaw/Checkpoint"), never against them.
- *Concede for now:* the advisor meeting-notes/CRM-sync category (Jump/Zocks own it) and the consulting designed-deck category (Gamma owns it). Position as the upstream private workspace, and integrate/handoff rather than compete.
- *Close (these are winnable and gating):* (a) trust signals: SOC 2, a signed DPA, named reviewer testimonials; (b) the gatekeeper one-pagers (malpractice carrier / client GC / CCO Reg S-P / §7216), which the 2026-06-04 review already recommended and the competitive data strongly reinforces; (c) branded/letterhead output (advisor PDFs, tax letters, legal filings); (d) BYOK onboarding friction, ideally by leading the most sensitive buyers straight to local Ollama.

**5. Price is a genuine advantage, used carefully.** Advisor Prep Hero at $149/yr + a few dollars of API is 4x to 20x cheaper than the purpose-built tools ($1,200-5,000/yr). Anchor against those, not against the $0 bundled tools or free ChatGPT (where price is not our edge, architecture is).

**6. Closest direct threats to watch:**
- **Elephas** (Mac-only local AI for lawyers via Ollama): the only marketed local competitor in any vertical. Generic, no profession packs, Mac-only. If it adds profession templates and Windows, it is the most direct threat. Monitor.
- **Generic local-AI apps** (Msty, GPT4All's LocalDocs, Jan): a technical practitioner can self-assemble a local RAG workflow. Our answer is profession-specific structure + templates + no-assembly-required.
- **Incumbents adding private/local or BYOK options:** Lexis+ already shipped BYOK encryption (still cloud). If Clio, Intuit, or Jump ship a genuine local/zero-egress mode, our core wedge narrows. Watch for it; our durable edge is then own-your-files + price + profession depth.

---

## 8. What this means for Advisor Prep Hero (recommendations)

**Positioning, per vertical:**
- *Legal:* "Private, local-capable AI for the work that has to stay privileged, beside Clio and Westlaw, not instead of them." Lead with Heppner and the local model.
- *Tax:* "The only §7216-clean AI workspace, and the AI companion Drake never gave you." Lead with the local model + §7216/WISP templates; market in the off-season.
- *Consulting:* "The only way to truthfully honor a no-AI-upload clause. Do your thinking here; finish the deck in Gamma/PowerPoint." Ship the client one-pager.
- *Advisor:* "AI for advisors who won't put client data in someone else's cloud, and the one with zero Reg S-P vendor surface." Lead with the June 2026 deadline + the CCO one-pager.

**Product gaps to close (priority order), informed by both this and the 2026-06-04 review:**
1. SOC 2 (Type II) and a standard DPA. Repeatedly cited as a hard blocker for formal vendor approval, especially RIAs and multi-lawyer firms. The single biggest credibility unlock for the regulated verticals.
2. The gatekeeper one-pager family (carrier / client GC / CCO / §7216). Cheap, high-leverage, reinforced by every vertical's research.
3. Branded/letterhead output (advisor plan PDFs, tax letters, legal filings).
4. Frictionless BYOK onboarding + a prominent local-Ollama "no key, no account, nothing leaves" path for the most sensitive/least technical buyers.
5. Named, credentialed reviewer testimonials per vertical (the trust flywheel; also the 2026-06-04 review's top ask).
6. Honest "sits beside [Clio/Drake/eMoney/PowerPoint]" round-trip content, not "replaces."

**Battles to refuse:** building a legal/tax research database, a meeting-notes/CRM-sync product, or a designed-deck engine. Integrate, hand off, and position around these instead.

**Marketing:** lead with the regulatory forcing functions (they are doing our selling for us right now), anchor price against the premium tier, and make the local-model story the hero everywhere.

---

## 8.5 Activation: how we turn this into assets (the plays)

This assessment is only worth the use we make of it. Concrete plays, by priority and owner (`auto` = Claude builds; `deploy-gate` = built then your go; `Jameson`/`board` = your call):

| # | Play | What it is | Why now | Owner |
|---|---|---|---|---|
| 1 | **Per-vertical comparison sections** on /legal/, /tax/, /consulting/, /financial-advisors/ | "How Advisor Prep Hero compares to the AI you already have" block + honest matrix on each landing page | Highest-conversion: the prospect is already on the page, already wondering "how is this different from Clio Duo / Jump / what I have?" | `auto` build, `deploy-gate` |
| 2 | **A comparison hub + per-incumbent pages** under /vs/ | New /vs/ section for profession tools + dedicated pages (vs CoCounsel, Clio Duo, Jump, Intuit Assist, Gamma, etc.) | SEO capture for "private alternative to [incumbent]" intent; the /vs/ pattern already exists | `auto` build, `deploy-gate` |
| 3 | **Regulatory-hook blog posts** | "What US v. Heppner means for your AI," "Is your AI tax tool §7216-clean?," "Reg S-P just changed your AI vendor list," "Your NDA probably bans the AI tool you're using" | The regulatory tailwind is time-sensitive and is the exact wedge; strong SEO + thought leadership + cold-outreach fuel | `auto` draft, `deploy-gate` |
| 4 | **Sales / outreach battlecards** | Objection-handling: "I already have Clio Duo / Jump / Intuit Assist / ChatGPT" → the honest response, per vertical | Powers reviewer + cold outreach (the GTM motion); turns this doc into reps | `auto` |
| 5 | **Lead-with-local-model messaging** on homepage + vertical heroes | Make the zero-egress local story the hero, fix the cloud-key overclaims | The single durable wedge; also a 2026-06-04 review finding | `auto` build, `deploy-gate` |
| 6 | **Gatekeeper one-pagers** (carrier / client GC / CCO Reg S-P / §7216) | Now armed with competitive + regulatory ammo | Converts users into advocates; recommended by both this doc and the 06-04 review | `auto` build, `deploy-gate` |
| 7 | **Trust signals: SOC 2 (Type II) + a standard DPA** | The recurring hard blocker for RIA / multi-lawyer-firm vendor approval | Without it, the regulated verticals can't formally approve us no matter how good the pitch | `Jameson` / `board` (spend + process) |
| 8 | **Competitor-watch + quarterly refresh** | A living watch list (Elephas, Lexis+ BYOK, incumbents adding local/BYOK) and a quarterly price/feature re-check | Pricing and features move fast; this doc decays | `auto` (scheduled) |

All of these plays are now handed to the Advisor Prep Hero build session in one place: **[Competitive Activation Master Handoff, 2026-06-08](./2026-06-08-competitive-activation-master-handoff.md)** (which references the build-ready website spec in [Competitive Build Handoff, 2026-06-06](./2026-06-06-competitive-build-handoff.md)). Play 7 (SOC 2 + DPA) stays a Jameson/board decision; the master handoff specs the buildable parts and a decision brief.

---

## 9. Confidence and caveats

- **High confidence:** the deployment model (essentially all leaders are cloud), the consumer-tier training defaults (ChatGPT/Claude train on free/Plus/Pro by default; Team/Enterprise do not), the regulatory facts (Heppner ruling + conviction; Reg S-P June 3 2026 deadline; §7216/§6713 structure; SEC AI-washing fines), and the existence/traction of the category leaders (Jump 27k advisors/$105M; Zocks 5k firms/$65M; Gamma scale; Drake has no genAI; Intuit Assist bundled).
- **Medium confidence:** specific monthly pricing for tools that don't publish rate cards (CoCounsel, Harvey, TaxGPT, Zeplyn, Spellbook, Paxton). Treat the dollar figures as directional and verify before any public comparison.
- **Lower confidence / verify:** whether specific vendors offer a standard signed Reg S-P DPA vs negotiated-only; exact training-data policies for FP Alpha and Intuit on uploaded client documents (both ambiguous in public materials); and Paxton's current headline price (a recent page showed $499/mo vs older $199/mo reports).
- This complements, and does not replace, the PKM-focused `COMPETITIVE_LANDSCAPE.md`; that doc still covers the Notion/Obsidian/general-AI angle for the rare prospect who frames Advisor Prep Hero that way.

---

## Appendix: key sources by vertical

**Legal:** Harvard Law Review on Heppner; Gibson Dunn / McDermott / Akin Gump (privilege analyses); Clio 2026 Legal Trends + Clio AI pages; Thomson Reuters CoCounsel pages; Harvey security/DPA; LexisNexis Protégé (LawNext, May 2026); Spellbook; Paxton.ai/pricing; Robin AI security; Elephas (local AI for lawyers). Full URLs in the legal research record.

**Tax:** Intuit ProConnect AI features + Responsible AI governance; Drake Workflow announcement + GenAI blog; Thomson Reuters CoCounsel Tax security; Wolters Kluwer CCH Expert AI; Blue J pricing/security + CPA.com; TaxGPT FAQs; CPA Pilot; IRS §7216 center + Pub 5708 (WISP); local-AI-for-accountants guide. Full URLs in the tax research record.

**Consulting:** OpenAI/Anthropic enterprise privacy + tier training terms; Microsoft 365 Copilot privacy + pricing; Notion AI security; Gamma trust center + pricing; Beautiful.ai; Plus AI; Glean security; Perplexity Enterprise; local tools (Ollama/Jan/GPT4All/Msty); NDA-AI-clause legal commentary (Roth Jackson, Avantia). Full URLs in the consulting research record.

**Advisor:** Reg S-P amendments (Federal Register) + Holland & Knight deadline note; Jump pricing/security + Series B; Zocks pricing/platform + Series B + Cetera; Zeplyn (WealthManagement/InvestmentNews); FP Alpha pricing; Conquest (T3 2026); Envestnet/eMoney Elevate 2026; Microsoft Copilot compliance; Smarsh/Global Relay; SEC AI-washing (Harvard Law/Latham); Kitces AdvisorTech; XY Planning notetaker comparison. Full URLs in the advisor research record.
