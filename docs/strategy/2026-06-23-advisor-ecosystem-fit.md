# Where Keepance Fits in a Financial Advisor's Software Stack

**Date:** 2026-06-23 (revised after an independent Codex accuracy/compliance review)
**Audience:** Jameson (board) + future Claude sessions building the advisor re-aim.
**Purpose:** Map the real software a financial-advisory firm runs, how those tools work together, where a client's knowledge actually lives, and exactly where Keepance fits and adds value. This is the strategic foundation for the advisor pivot and for which integrations we build first.

> Plain-language note: a few terms. **RIA** = the advisory firm itself (Registered Investment Advisor). **CFP** = the planner's credential (Certified Financial Planner). **Custodian** = the institution that actually holds the client's money (here, Schwab); the advisor manages it, the custodian safeguards it. **CRM** = the contact database meant to be the firm's central memory. **NPI** = nonpublic personal information (a client's private financial data). **Reg S-P** = the SEC privacy rule that says an advisor must take *reasonable steps* to safeguard that data and oversee outside tools that touch it. **BYOK** = "bring your own key": Keepance sends AI requests using the advisor's own AI account, straight from their machine to the AI provider, never through a Keepance server.

---

## 1. The one-line answer

A financial advisor's knowledge about any single client is scattered across roughly **eight separate systems plus their email inbox.** No tool today holds *all* of a client's context in one place and answers questions about it with citations, and the most capable AI most advisors have (consumer ChatGPT) is one they generally should not feed raw client data into without firm review.

**Keepance is the private "client-intelligence + drafting" layer that sits underneath that stack.** It reads from the tools the advisor already uses, keeps the working copy of client content on the advisor's own machine, answers any question about a household with cited facts, and drafts the Word documents. It does not replace the CRM, the planner, the note-taker, or the custodian. It is the one place where everything about a client comes together and answers back.

**Lead hook:** *"A private ChatGPT that actually knows your clients."* The honest version: a workspace built for client data, that answers from the client's own files with citations and drafts your documents, where you control where the data goes.

---

## 2. The real stack (what advisors actually run)

Built from the actual tool list of one real CFP firm, cross-checked against the two authoritative industry surveys. To avoid mixing years (a mistake the first draft made), the table separates them:
- **T3 2026** = the T3 / Inside Information Software Survey, March 2026 (largest sample, skews established firms).
- **Kitces signal** = Kitces Research on Advisor Technology (skews independent RIAs / younger advisors); where it meaningfully disagrees, it is noted.

| Category | This firm uses | T3 2026 share | Kitces / independent-RIA signal | Role |
|---|---|---|---|---|
| **CRM (the intended hub)** | **Wealthbox** | Redtail ~42.5%, **Wealthbox ~17.5%** | Wealthbox ranks **#1 among independent RIAs** and is the fastest-growing | Contacts, notes, tasks, workflows: the firm's central memory |
| **Financial planning** | **RightCapital** | eMoney ~35.6%, MoneyGuidePro ~24.2%, **RightCapital ~21.4%** | RightCapital fastest-growing + highest satisfaction | Builds the plan: retirement, Roth-conversion modeling, "will the money last" |
| **Tax planning** | **Holistiplan** | category leader (~39% in recent surveys) | Dominant; highest satisfaction | Reads the client's 1040 by OCR and finds tax-saving moves |
| **Portfolio / reporting / portal** | **Tamarac** (Envestnet) | Orion leads (~16%), **Tamarac ~9.1%** | Orion also owns Redtail | Trading/rebalancing, performance reports, secure client portal |
| **Custodian** | **Schwab** | custodian for a majority of RIA firms; >$5T assets | Schwab dominant, Altruist fastest-growing | Holds the accounts, moves money, official statements |
| **AI meeting note-taker** | **Jump AI** | **Jump ~22.7%, Zocks ~10.2%**; AI note-taking now ~43% of firms | Adoption exploded in ~12 months | Records meetings, writes notes/actions, pushes them to the CRM |
| **Risk tolerance** | **DataPoints** | Nitrogen leads (~17%) | DataPoints = niche, psychometric | Measures how a client behaves in a downturn |
| **E-sign / forms / scheduling** | DocuSign / Jotform / Calendly | category leaders | near-universal | Signatures, intake, self-booking |
| **Marketing / comms** | **Levitate** | fast-growing | watch-list | Email, texting, website, keep-in-touch outreach |
| **Meetings** | **Zoom** | ~56% (video leader) | near-universal | The meeting itself |
| **Office + files + email** | **Microsoft 365 / OneDrive / Outlook** | near-universal | near-universal | Where documents are written, files stored, email lives |
| **General AI** | **ChatGPT** | **~52% of advisors now use generative AI** (ChatGPT ~41%) | rising fast | Ad-hoc drafting/Q&A, but walled off from real client data (see §5) |

Sources: [T3 2026 survey](https://t3technologyhub.com/wp-content/uploads/2026/03/2026-T3_Inside-Information-Software-Survey.pdf), [Kitces AdvisorTech report](https://www.kitces.com/kitces-report-independent-financial-advisor-technology-fintech-software-tools-research/), [RightCapital in T3](https://www.rightcapital.com/blog/rightcapital-in-the-t3-software-survey/), [Holistiplan share](https://www.newswire.com/news/holistiplan-leads-tax-planning-software-category-with-39-market-share-22746279), [Jump/Zocks funding](https://www.investmentnews.com/advisor-tech/jump-and-zocks-raise-dueling-series-b-funding-rounds/).

---

## 3. How it all fits together (the client-meeting lifecycle)

Everything revolves around the client meeting.

**Before.** Calendly books the slot off the Outlook calendar, creates a Zoom link, and logs it to Wealthbox. New info comes in via Jotform; the risk profile via DataPoints. To prep, the advisor opens five or six tools at once: Wealthbox (history), RightCapital (the plan), Holistiplan (tax), Tamarac (performance), plus re-reads Outlook threads and OneDrive documents.

**During.** Zoom or in person. Jump listens and transcribes. The advisor references the plan, tax findings, and performance reports live.

**After.** Jump pushes the summary and action items into Wealthbox. Follow-through fans back out: DocuSign for signatures (status back to Wealthbox), Schwab for account changes, Tamarac for trades and to post reports to the portal, RightCapital to update the plan, Levitate for ongoing outreach. ChatGPT might help draft an email, but only with client details stripped out.

**The hubs:** Wealthbox is the *coordination* hub (notes/tasks/activity converge there). Schwab is the *data-source* hub (the money system of record Tamarac and RightCapital both read). Everything else is a spoke that hands a *summary* to Wealthbox.

Verified handoffs: [Jump to Wealthbox](https://www.wealthbox.com/jump-supercharges-wealthbox-integration-to-expand-meeting-automation-capabilities/), [RightCapital to Wealthbox](https://www.wealthbox.com/rightcapital-enhances-wealthbox-integration-with-real-time-notes-and-tasks-sync/) and [RightCapital from Schwab](https://help.rightcapital.com/integrations/asset-custodians/schwab-api), [Holistiplan to Wealthbox](https://www.wealthbox.com/holistiplan-partners-with-wealthbox-to-streamline-tax-return-analysis/), [Tamarac on Schwab](https://advisorservices.schwab.com/provider-solutions/Tamarac-Reporting).

---

## 4. The core insight: where the client's knowledge actually lives

Even though Wealthbox is "the hub," **it mostly holds summaries and metadata, not the substance.** The real picture is fragmented:

- **Numbers / holdings:** Schwab + Tamarac + RightCapital.
- **The plan logic:** RightCapital.
- **The tax reality:** Holistiplan (and the raw returns).
- **What was said and decided:** Jump's notes inside Wealthbox.
- **The real documents** (returns, trusts, statements, agreements): split across OneDrive, Tamarac's portal, DocuSign, and email attachments.
- **The relationship history and nuance:** buried in **Outlook email threads, which no tool truly indexes.**

So an advisor's full picture of any client is a mental reassembly across about eight systems plus their inbox. Wealthbox can tell you *that* something happened. It rarely contains the *content* needed to answer a real question like *"What did we decide about the kids' 529 plans, and where is that in writing?"*

---

## 5. The three gaps none of these tools fill

**Gap A. No single place holds all of a client's context and answers with citations.** Every tool answers about its own slice. None answers *across* documents + emails + plan + tax + notes, with a link back to the source. The richest source (email history) is essentially un-queryable.

**Gap B. Most advisors cannot put real client data into the AI they actually have.** Consumer/personal ChatGPT accounts are generally *not approved* for client NPI without firm review, because Reg S-P and the GLBA Safeguards Rule require reasonable safeguards, vendor due diligence, privacy notices, and recordkeeping, and an unsanctioned consumer chat satisfies none of those (the industry calls this **"Shadow AI"**). This is not a blanket "ChatGPT is illegal" rule: enterprise or API AI tools *can* be usable after a firm reviews them, turns off training on its data, and adds retention and access controls. But in practice the everyday advisor's most capable AI is walled off from the data that would make it useful. Sources: [Kitces on AI compliance](https://www.kitces.com/blog/artificial-intelligence-ai-tools-regulation-compliance-regulatory-ria-chatgpt-records-client-data-risk/), [Shadow AI + GLBA](https://natlawreview.com/article/when-your-productivity-tools-become-regulatory-problem-shadow-ai-and-glba), [OpenAI data-use](https://help.openai.com/en/articles/5722486-how-your-data-is-used-to-improve-model-performance).

**Gap C. No deep, Word-native drafting grounded in the client's real file.** Holistiplan and RightCapital produce their own templated PDFs; DocuSign signs documents. But nothing *drafts* a real, editable Word document (a review summary, an Investment Policy Statement, a meeting-recap letter, a Reg BI basis-of-recommendation note) grounded in that specific client's numbers, plan, tax return, notes, and emails. Today the advisor hand-assembles these by copying from six tools.

**Why local-first helps (stated precisely).** Gaps A and C require the AI to read *everything* about a client, which is exactly the data Gap B says you must be careful with. Keepance's design keeps the working copy of client content on the advisor's machine and gives two clear AI modes:
- **Local-model mode:** the AI runs on the device, so client content does not leave it at all.
- **BYOK cloud mode:** content goes *directly from the advisor's device to the AI provider they chose* (OpenAI, Anthropic, etc.), under the advisor's own account and contract. Keepance never sees or stores it on a Keepance server.

Either way there is no Keepance content server in the path, which is the part of the Reg S-P vendor-oversight story Keepance can honestly stand behind. (We are careful never to claim Keepance makes a firm "compliant"; compliance is the firm's call with its CCO.)

---

## 6. Where Keepance fits and what it is worth

**Keepance is the private client-intelligence + drafting layer underneath the stack.** For any household:

1. **Knows the client.** Point it at the client's documents (the OneDrive folder, the exported RightCapital plan and Holistiplan report, the Schwab/Tamarac statements) and connect Outlook (and, as an add, Wealthbox). Ask anything and get a cited answer drawn from the actual sources.
2. **The Client Map.** A living, auto-built profile: members and key people, goals, accounts at a high level, risk tolerance, life events, prior advice, open items, next review.
3. **Drafts the documents.** Generate the annual-review letter or the Reg BI note as a real, editable Word document grounded in that client's verified file.
4. **You control where data goes.** Local-model or BYOK-cloud mode; an always-visible egress indicator and a data map show what left and what did not.

**It is complementary, not competitive.** Keepance is not a CRM (it reads from Wealthbox), not a planner (it reads RightCapital's output), not a note-taker (Jump captures the meeting; Keepance is the deep prep and the drafting around it), and not a custodian. The clean division of labor: *Jump owns the meeting workflow; Keepance owns the client-file intelligence and the Word drafting outside the meeting.*

**Value as outcomes (the pitch is ~70% outcome, ~30% architecture):**
- Walk into every meeting already knowing the whole household, in minutes instead of an hour of tab-juggling.
- Put a real AI to work on your actual client files, with the data staying under your control.
- Draft the follow-up letter and the basis-of-recommendation note in minutes, grounded in the file.
- Make years of client email and documents actually searchable and answerable, with citations.

---

## 7. Competition, and what could break this thesis

**The category is hot.** Jump (~$80M raised) and Zocks (~$45M) are no longer just note-takers; they market themselves as advisor "AI operating systems" that sit *above* the CRM and automate the whole meeting workflow (prep, recap email, financial-data extraction, CRM updates, compliance documentation, follow-up tasks). Keepance should not try to win the meeting-capture lane. The honest division: **Jump/Zocks own the meeting; Keepance must own the client-file intelligence and Word drafting outside the meeting.** ([Jump AI associate](https://jump.ai/blog/introducing-AI-associate))

**The strongest counter-arguments (what could break us):**
1. **Microsoft 365 Copilot + Purview.** Most advisors already pay for Microsoft 365. Microsoft has a financial-services compliance story (a Cohasset assessment, Purview records/retention). If a firm's compliance team blesses Copilot over their own data, that is a powerful default. *How Keepance wins:* deeper reach into the actual client files + email with verifiable citations, true Word-native tracked-changes drafting, a local-model option, and a lighter vendor-review burden. ([MS Copilot financial-services compliance](https://www.microsoft.com/en-us/microsoft-cloud/blog/financial-services/2025/01/30/new-compliance-assessment-builds-financial-services-confidence-in-microsoft-365-copilot/))
2. **Wealthbox AI.** Wealthbox is adding AI Agents, Playbooks, and an Assistant that can query CRM data, draft communications, and log actions. If the CRM becomes the in-place AI, the hub gets stickier. *How Keepance wins:* the CRM holds summaries, not the documents/email substance; Keepance answers across the *whole* file, cited, and drafts Word. ([Wealthbox AI](https://www.prnewswire.com/news-releases/wealthbox-announces-early-access-to-new-ai-features-for-financial-advisors-302707692.html))
3. **Planning tools (eMoney/RightCapital) embedding AI** over their own data. *How Keepance wins:* it spans *all* sources, not one tool's slice.

The takeaway: our defensibility is **depth across the whole client file + email, Word-native cited drafting, and a data-control story (local or BYOK-direct) that lowers the firm's vendor-review burden.** "We are private" alone is no longer differentiated (Zocks/Zeplyn claim privacy too); lead with the client-intelligence depth and the drafting, with data-control as the closer.

---

## 8. The integration strategy (what we build, and in what order)

Jameson's directive: build real integrations, the biggest ones most firms have. The research plus the Codex review point to this order. The key correction from the review: **the core value is files + email + citations, and that foundation already mostly exists** (Outlook is built; OneDrive files are just local files once synced). So the foundation comes first, and the CRM is the differentiated add on top.

**Build order:**

1. **Local client-folder + Outlook foundation (mostly already built).** Point Keepance at the folder where the advisor already keeps a client's documents (RightCapital/Holistiplan exports, Schwab/Tamarac statements, signed PDFs); OneDrive's desktop sync means those are local files the existing engine already indexes. Add a guided "point this client at their folder" flow. Outlook email ingestion already exists. This is the demo's backbone and works for *every* firm regardless of CRM.

2. **Wealthbox (CRM) read connector, local-first.** The flagship "fits your stack" add. The advisor pastes a personal access token (stored in the OS keychain); Keepance calls the Wealthbox REST API **directly from the advisor's machine, never through a Keepance server.** Read the core objects we need first (contacts/households, notes, tasks, events, activity, workflows) into a client's Client Map. (We will prove "households, files, pagination, rate limits, custom permissions" against a real account before claiming full coverage; Wealthbox has no document API, so files still come from OneDrive.) Same REST API the leading note-takers build on, so the pattern is proven. [Wealthbox API](https://dev.wealthbox.com/).

3. **Redtail (the other big CRM): apply now, build when granted.** Redtail's firm-only API tier needs a short application; start it in parallel so access lands while we build. Covers the established-firm half of the CRM market.

**Deeper / later (fast-follow):** a Microsoft Graph OneDrive *cloud* file connector (for files not synced locally; this needs an app registration and permissions, possibly admin consent, so it is not "free" like reading synced folders); and Wealthbox *write-back* (push a drafted summary or Reg BI note into the CRM as a note, the way Jump does), plus OAuth so other advisors connect without a manual token.

**Defer (position as "on the roadmap"):** Schwab (custodian: data-access contracts + compliance, hardest), Tamarac (enterprise sales-gated), RightCapital and eMoney (partner-gated), Holistiplan (API access is case-by-case, request-based, not strictly Enterprise). For all of these the demo already works: *export their PDF report into the client's folder and Keepance reads it.* Build the APIs later, customer-demand-first.

---

## 9. What this means for the demo and for pricing

**The demo** mirrors the most common stack so it resonates with most firms (and closely matches Jameson's wife's firm): a realistic sample household seeded with a RightCapital plan, a Holistiplan report, Schwab/Tamarac statements, a DataPoints risk profile, meeting-note summaries, and an email thread. Then ask the Roth-conversion question and get a cited answer, build the Client Map, draft the review letter, and show it pulled from Outlook + the local/OneDrive folder + Wealthbox, with the data-control indicator visible.

**Pricing.** The advisor software budget is real (roughly $6,000-$12,000 per advisor per year across the stack). The current in-app pricing config and the advisor web page disagree (one shows $468+/yr, the other a $99/yr founding rate); these get reconciled into one coherent advisor-first price. (Pricing is now set autonomously per Jameson's 2026-06-23 grant.)

**Public-copy guardrail (from the review).** In anything customer-facing, avoid "allowed," "safe," "compliant," "guaranteed," and "without breaking Reg S-P." Use the honest framing: *Keepance is designed to reduce vendor exposure: the working copy of client content stays on your machine, Keepance never hosts it, and you choose a local-model or your-own-provider AI mode, with an audit log your compliance team can review.* Any regulatory page passes a securities-compliance review before publishing.

---

## Appendix — confidence and caveats

- **Well-sourced:** the T3 2026 + Kitces adoption numbers; the Wealthbox open REST API; the Reg S-P / GLBA "Shadow AI" framing (stated as "review required," not "banned"); the verified tool-to-tool handoffs; the competitor AI moves (Microsoft Copilot, Wealthbox AI, Jump's AI associate).
- **Verify before relying:** whether Wealthbox personal-token creation is open to every user vs. admins on some plans (check one real account); exact Wealthbox object coverage (households/files/pagination/rate limits); whether a small firm gets Holistiplan API access; exact advisor-specific share for Calendly/DocuSign (category leaders, not isolated in the surveys).
- **Review trail:** drafted 2026-06-23; revised the same day after an independent Codex accuracy + compliance review (10 issues, all addressed: softened the Reg S-P/ChatGPT claims, split the privacy story into local-model vs BYOK-cloud modes, de-blended the market numbers to T3 2026, added the "what could break this" competitor section, and reordered the build to foundation-first).
