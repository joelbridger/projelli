# Keepance Competitive Battlecards

**Purpose:** Sales and outreach ammunition for reviewer recruiting and cold outreach. One card per competitor, structured for quick retrieval mid-conversation. Internal use only.

**Last updated:** 2026-06-08
**Source:** `docs/strategy/2026-06-06-vertical-competitive-landscape.md` + `docs/reference/COMPETITIVE_LANDSCAPE.md`
**Honesty bar:** every card includes where the competitor genuinely wins and when to send the prospect to them instead. That honesty is what makes the rest credible.

> **Regulatory disclaimer (say this or include it in writing):** References to *US v. Heppner*, IRC §7216/§6713, and SEC Reg S-P are informational only, not legal, tax, or compliance advice. Verify with your own counsel.

> **Local-vs-cloud precision:** Only running a local AI model (Ollama, LM Studio) means the prompt never leaves the machine. Bringing your own API key to Claude/OpenAI/Gemini routes the prompt to that provider's cloud, not through Keepance's servers, but the provider still receives it. These are different things; don't conflate them.

---

## Legal vertical

---

### Card 1: Clio Duo

**What it is:** AI add-on to Clio Manage, the dominant cloud practice-management platform for solo and small-firm attorneys. Approximately $49-59/month on top of the existing Clio subscription, or bundled in the Elite tier.

**When the prospect raises it:** "I already pay for Clio. Why would I pay for anything else?"

**Where Clio Duo genuinely wins:**
- Deep integration with matters, clients, billing, deadlines, and the full Clio workflow the attorney already lives in
- Zero setup for existing Clio users (one-click activation)
- Familiar context: the AI knows the matter name, the client, the open tasks
- SOC 2 Type II certified; contractual zero-retention with its LLM provider
- Big-brand trust for bar associations and malpractice carriers reviewing vendor lists

**Keepance's wedge:**
Clio Duo knows your practice-management data well. What it doesn't do is help you draft the privilege log, run the deposition contradiction search, or produce the evidence-gap analysis on documents you'd rather not store on any vendor's server. Clio is a cloud SaaS and your documents live there. With Keepance on a local model, nothing leaves your machine, your drafts don't live on Clio's servers, and the total annual cost is a fraction of what Clio adds up to. The two tools do different jobs.

**One-liner rebuttal:**
"Clio Duo is excellent for AI that knows your matters and your billing. Keepance handles the confidential drafting you'd rather not keep on any vendor's cloud, and it's the only option that can run fully local."

**Proof point:**
*US v. Heppner* (S.D.N.Y., Judge Rakoff, opinion Feb 17 2026; defendant convicted May 7 2026) held that using consumer cloud AI without attorney direction can defeat privilege. Clio Duo's contractual no-retention policy addresses training. It does not address the transmission of prompt content to the LLM provider. With Keepance on a local model, there is no transmission. (Informational only, not legal advice.)

**When to concede:**
If the attorney's primary AI need is around matters, billing, deadlines, drafting within the Clio ecosystem, and they're already in the Elite tier where it's bundled, Clio Duo is probably the right tool and the path of least resistance. Keepance is worth considering alongside it, not instead of it, for the most sensitive drafting work.

---

### Card 2: CoCounsel (Thomson Reuters)

**What it is:** Purpose-built legal AI from Thomson Reuters, grounded in Westlaw's case law database and capable of citation-verified research, contract review, and litigation drafting. Approximately $225-428/month ($2,700-5,000/year) for solo/small-firm access.

**When the prospect raises it:** "Our firm already uses Westlaw. CoCounsel seems like the obvious upgrade."

**Where CoCounsel genuinely wins:**
- Westlaw-grounded responses with Shepard's citation verification (the thing Keepance cannot do and should not pretend to do)
- Deep litigation coverage built by a legal publisher; answers grounded in primary authority
- SOC 2; zero retention at the LLM layer; contractual no-training; Thomson Reuters brand and track record for bar association vendor approval
- Agentic workflows for contract review and deposition prep that are farther ahead of what Keepance ships today

**Keepance's wedge:**
CoCounsel is the right tool for research that needs to be citation-verified. It is not designed around the "I have a client file I need to keep private and I want to produce a privilege log / engagement letter / matter memo without it ever reaching a vendor server" use case. Keepance is $149/year versus CoCounsel's $2,700-5,000/year. It runs locally, so your documents and drafts touch no vendor cloud if you choose a local model. The two tools have different jobs: CoCounsel for researching the law, Keepance for the work product that needs to stay local.

**One-liner rebuttal:**
"CoCounsel is the right choice if you need Westlaw-grounded citation-verified research. If you already have Westlaw, you don't need CoCounsel just to draft a privilege log or run a deposition contradiction search. Keepance is $149 a year and your files never leave your machine."

**Proof point:**
Keepance's local model path removes the data-path entirely (no vendor receives the prompt). CoCounsel routes through Thomson Reuters' cloud and its LLM partner, with contractual no-training protections. Both are honest positions; they reflect different architectures. The post-Heppner argument for the absolute local path is strongest when privilege is the concern. (Informational only, not legal advice.)

**When to concede:**
Any attorney who regularly needs citation-verified primary-authority research as a core workflow should have CoCounsel or a comparable tool. Keepance does not compete on legal research databases. If research is the primary need, send them to CoCounsel or Paxton. If drafting, templates, and local privacy are the need, that's where Keepance fits.

---

## Tax vertical

---

### Card 3: Intuit Assist

**What it is:** Built-in AI for Intuit's professional tax software (Lacerte, ProConnect, ProSeries). Bundled at no additional cost for subscribers, focused on advisory planning workflows.

**When the prospect raises it:** "It's already in my Lacerte. Why would I pay for something separate?"

**Where Intuit Assist genuinely wins:**
- Zero additional cost for existing Lacerte/ProConnect/ProSeries subscribers
- Pulls 60+ data points directly from the return in the system (context Keepance can't match)
- No new vendor, no new setup, no new contract
- Useful for advisory planning summaries and client-facing explanations

**Keepance's wedge:**
Intuit Assist's training and data-usage policy for uploaded return information is not transparent in public materials as of mid-2026 (their "responsible AI" page covers use of aggregate data but does not clearly commit on client-specific return data fed to the AI). The data path routes through Intuit's cloud. Under IRC §7216, a cloud API call that sends return information to a third party is a disclosure. A local model removes the third-party disclosure entirely. Keepance also gives Drake users, who make up roughly a third of the small-firm market and get zero AI from their vendor, a comparable workflow. Plus Keepance includes a §7216 consent template and a Safeguards Rule / WISP builder that Intuit Assist doesn't ship.

**One-liner rebuttal:**
"Intuit Assist is a good starting point if you're on Lacerte and just want planning help. If you want a §7216-clean setup where return data never reaches any vendor, a local model is the only architecture that achieves it, and that's what Keepance is built for."

**Proof point:**
IRC §7216 (criminal) and §6713 (civil, strict-liability, $250/disclosure, no-intent required) govern disclosure of return information to third parties. A cloud AI call that includes return data sends that data to the provider. A local model running on your machine has no third-party in the data path. No other tax AI product markets a §7216-clean architecture. (Informational only, not legal or tax advice. Verify with your own counsel and your state board.)

**When to concede:**
If the preparer is on Lacerte or ProConnect and their only AI need is advisory planning summaries from data already in Intuit's system, Intuit Assist is free, already there, and hard to beat for that specific task. Keepance adds value beside it for drafting, memos, WISP building, and §7216-sensitive workflows. Neither replaces the other.

---

### Card 4: Blue J

**What it is:** Purpose-built tax research AI, grounded in primary authority with predictive confidence scoring. Approximately $1,498/year (direct), or around $998/year through CPA.com's partner pricing. Cloud-hosted (AWS), SOC 2 certified, no training on customer data, 24-hour file deletion.

**When the prospect raises it:** "I use Blue J for tax research. That covers my AI needs."

**Where Blue J genuinely wins:**
- Genuine primary-authority research with predictive confidence scores; this is the thing Keepance does not do and cannot pretend to do
- Citations to actual Code sections, regulations, and rulings
- SOC 2; no-training policy; 24-hour file deletion; credible privacy posture for a cloud tool
- Purpose-built for tax research; not trying to be a general workspace

**Keepance's wedge:**
Blue J is a research tool. It is not designed for producing client-facing deliverables, drafting engagement letters, building §7216 consent templates, running a WISP, or organizing the client file as a local-first artifact. Blue J routes through AWS, so every research query and return data included in it travels to a cloud provider. Keepance fills the drafting-and-document side of the workflow and, on a local model, keeps that data on the preparer's machine. The two tools cover different parts of the day.

**One-liner rebuttal:**
"Blue J is excellent for citation-grounded primary-authority research. Keepance is for the drafting, the client memos, the engagement letters, and the §7216-clean workspace where you'd rather not route client data through a cloud. They do different things."

**Proof point:**
Blue J's research queries go to its cloud and its LLM. Even with a no-training, 24-hour-deletion policy, the query is transmitted. If the query includes return data, that is a disclosure under §7216. Keepance on a local model removes the transmission entirely. (Informational only, not legal or tax advice.)

**When to concede:**
Any CPA or EA who needs to research a tax position against primary authority should have Blue J or CoCounsel Tax or CCH AnswerConnect. Keepance is not a research database. If the primary need is "tell me what the Code says and cite it," send them to Blue J. If the need is "help me draft the memo explaining what I found, and keep it local," that's where Keepance fits.

---

## Consulting vertical

---

### Card 5: Microsoft 365 Copilot

**What it is:** AI add-on to Microsoft 365 business and enterprise subscriptions. Approximately $18-30/seat/month. Cloud-hosted (Microsoft Azure tenant-isolated), no training on enterprise-tier data, generates real PPTX and Word documents within the Office ecosystem.

**When the prospect raises it:** "We already pay for M365 and Copilot is included. Why use something separate?"

**Where M365 Copilot genuinely wins:**
- Generates real, editable PowerPoint files in the same workflow the consultant already uses to deliver to clients
- Deep integration with Outlook, Teams, and OneNote, things consultants live in
- Tenant-isolated data (enterprise tier): client data stays within the Microsoft tenant, not pooled across customers
- One vendor, already contracted and approved, versus adding a new one
- The DLP issue (a bypass bug in Jan-Feb 2026) was a CCO red flag but applies to edge configurations, not standard deployment

**Keepance's wedge:**
M365 Copilot still sends your prompt to Microsoft's Azure cloud. Even in a tenant-isolated configuration, the work product leaves the consultant's machine and reaches a vendor. Client NDAs that include explicit no-AI-upload clauses, which are increasingly common in 2026 MSAs, are not satisfied by a contractual no-training promise. Only a local model satisfies a strict no-upload clause literally. Keepance with a local model is the only consulting-focused tool where a consultant can truthfully tell a client "nothing from your engagement was uploaded to any AI service." Per-client folder isolation in Keepance also prevents cross-client data bleed that can occur when one tenant's context persists across sessions.

**One-liner rebuttal:**
"Copilot is the right tool for finishing the deck. Keepance is for the thinking, the research memos, and the client-specific work that a strict NDA no-upload clause would prohibit putting into any cloud, including Microsoft's."

**Proof point:**
Claude Pro and ChatGPT Plus train on user data by default (opt-out required as of mid-2026). M365 Copilot enterprise tier does not train, but still uploads to Microsoft Azure. Only a local model removes the upload entirely. NDA no-AI-upload clauses that legal commentary (Roth Jackson, Avantia) is beginning to read as "no upload at all, not just no training" are satisfied only by the local-model path. (Informational only, not legal advice.)

**When to concede:**
If the consultant's primary deliverable is a polished slide deck and they're already on M365 Business or Enterprise, Copilot is already there and produces real PPTX files that Keepance doesn't match. Use Gamma or Copilot for the final deck. Use Keepance for the work that happens before it. If there's no NDA clause and no sensitive client data, the productivity case for Copilot in Word/Excel is strong.

---

### Card 6: Gamma

**What it is:** Cloud-based AI presentation tool. Approximately $9-18/month for individuals (Team and Business tiers around $15-20/seat/month). Produces designed, branded slide decks in minutes from a prompt or outline. Free and Plus tiers train on user data by default; Team and Business do not.

**When the prospect raises it:** "I use Gamma for all my decks. It's incredible for fast delivery."

**Where Gamma genuinely wins:**
- Produces genuinely polished, designed slide decks faster than any alternative including Keepance's PPTX output (which is an outline, not a finished deck)
- Zero learning curve; the deck is the output, not a by-product
- Strong for pitches, client presentations, and internal updates where visual polish matters
- Team/Business tiers include a no-training policy

**Keepance's wedge:**
Gamma is a cloud tool. Every prompt and document you feed it travels to Gamma's servers and its AI providers. Team and Business tiers have contractual no-training, but the data leaves the machine regardless. For consultants under a strict no-AI-upload NDA clause, feeding the client brief or internal discovery into Gamma is a policy violation. Keepance handles everything upstream of the deck: the discovery synthesis, the research memo, the stakeholder map, the confidential analysis that the NDA protects. Then the consultant moves the clean, non-sensitive outline into Gamma for visual production.

**One-liner rebuttal:**
"Use Gamma for the final deck. It's better at that than Keepance is. Use Keepance for everything that happens before, the discovery synthesis, the confidential memos, the client-specific analysis you can't put in a cloud tool."

**Proof point:**
Gamma Free and Plus tiers train on user content by default; opt-out is available but buried. Team and Business tiers are contractual no-training but still upload to Gamma's cloud and its AI providers. A local model in Keepance is the only option where no upload occurs at all. The Gamma-to-Keepance handoff is the honest answer: use the right tool for each step. (Informational only, not legal advice.)

**When to concede:**
If the consultant's primary pain is "I need to produce a visually compelling deck quickly and I have no sensitive data restrictions," Gamma is probably the better tool for that specific task. Keepance and Gamma are complementary, not competing, for most consultants who work on both sensitive research and client-facing deliverables.

---

## Advisor vertical

---

### Card 7: Jump

**What it is:** Purpose-built AI meeting notes and operating system for financial advisors. Approximately $75-175/advisor/month. Cloud-hosted (AWS), no training on customer data, SOC 2 Type II + HIPAA compliant, 27,000+ advisor users as of 2026. Category leader in advisor meeting AI.

**When the prospect raises it:** "My whole team is on Jump. It's the standard at our firm."

**Where Jump genuinely wins:**
- Purpose-built for meeting notes, CRM sync, and the pre/post-meeting advisor workflow; nothing else in the market does this as well at scale
- 30+ CRM integrations (Redtail, Wealthbox, Salesforce, etc.); the notes flow automatically into the record
- SOC 2 Type II + HIPAA; compliance posture that RIA compliance officers recognize
- 27,000 advisors = "nobody got fired for buying Jump"; proven at the category level
- $105M raised; not a vendor that's going away

**Keepance's wedge:**
Jump is a meeting-notes and CRM-sync product. It does not help an advisor draft a custom financial planning memo, synthesize a client's estate documents, organize a research file on a specific HNW client's situation, or produce a written deliverable under a no-vendor-upload governance policy. And Jump is a cloud SaaS. Every meeting recording, note, and client mention transmitted through Jump travels to Jump's servers and its AI layer. The SEC Reg S-P service-provider oversight requirement (compliance deadline for smaller RIAs passed June 3, 2026) means every cloud AI vendor, including Jump, is now a service provider you must formally vet and monitor. With Keepance on a local model, there is no vendor in the data path to vet. Keepance serves the gap Jump leaves: general-purpose drafting, document synthesis, and written deliverables for advisors who want zero vendor surface for their most sensitive client materials.

**One-liner rebuttal:**
"Jump is the right tool for meeting notes and CRM sync. Keepance is for the written work, the planning memos, the document synthesis, the sensitive analysis that you'd rather not route through any vendor's server, and it's the only option where there is literally no AI vendor to vet for Reg S-P."

**Proof point:**
SEC Reg S-P amendments (compliance deadline for smaller broker-dealers and RIAs passed June 3, 2026) require a written incident-response program and service-provider oversight: advisors must identify, vet, and monitor every vendor that touches client data. Jump is such a vendor. With Keepance running a local model, there is no AI vendor in the data path to vet, document, or monitor. The files are plain Markdown on the advisor's own machine. (Informational only, not legal or compliance advice. Verify with your compliance officer and your own counsel.)

**When to concede:**
If the advisor's primary pain is capturing meeting notes and syncing them to their CRM automatically, Keepance does not do that and Jump does it better than anything else on the market. Send them to Jump for meeting notes. Keepance is for the drafting, the document synthesis, and the sensitive written work that advisors want to keep off vendor servers.

---

### Card 8: Zocks

**When the prospect raises it:** "I use Zocks because they don't record audio. I heard they're the privacy-first option."

**What it is:** AI meeting notes tool for financial advisors, positioned on privacy: it does not store audio or video recordings, only produces text notes. Approximately $67-184/month. Cloud-hosted, SOC 2 Type II, integration with eMoney and Smarsh/Global Relay for books-and-records archiving. Around 5,000 advisor firms as of 2026.

**Where Zocks genuinely wins:**
- No audio/video recording stored: a genuine and meaningful privacy distinction from most meeting-notes tools, which do store recordings
- SOC 2 Type II; Smarsh/Global Relay archive integration addresses books-and-records questions
- eMoney sync; purpose-built for the advisor meeting workflow
- Reasonable price vs Jump; genuinely privacy-attentive architecture for its category

**Keepance's wedge:**
Zocks' "no recording" architecture is a meaningful privacy step, and it's fair to say so. The notes themselves, the AI-generated transcript and summary, still travel through Zocks' cloud and its AI layer. The client data discussed in the meeting, captured in those notes, is still sent to a vendor's server. Under Reg S-P service-provider oversight, Zocks is still a vendor you must identify and monitor. A local model removes the vendor entirely. Keepance also covers the non-meeting drafting work: planning memos, document synthesis, client correspondence, research notes, which Zocks doesn't address.

**One-liner rebuttal:**
"Zocks is a thoughtful privacy choice for meeting notes. The notes still reach their cloud. With Keepance on a local model, nothing reaches any cloud at all, and it covers the written work that Zocks doesn't touch."

**Proof point:**
Zocks' SOC 2 and no-recording posture are genuine advantages over competitors that store audio. But the notes themselves are generated via a cloud LLM. Under Reg S-P's service-provider oversight, an advisor must still vet Zocks as a vendor. A local model in Keepance means there is no service provider to vet for the work Keepance handles. (Informational only, not legal or compliance advice. Verify with your compliance officer.)

**When to concede:**
If the advisor specifically needs meeting-notes capture and CRM integration, Zocks is a more privacy-attentive option than most, and it's purpose-built for the task. Keepance doesn't do meeting notes. An advisor who uses Zocks for meetings and Keepance for written work has a sensible two-tool stack. There's no reason to choose between them.

---

## Cross-vertical

---

### Card 9: "I already use ChatGPT"

**What it is:** OpenAI's consumer AI chat product. Free tier; Plus at $20/month; Pro at $200/month. Consumer free and Plus tiers train on user inputs by default (opt-out in Settings required). ChatGPT Business and Enterprise do not train on data; $20-30/seat/month, organization-wide agreement required.

**When the prospect raises it:** In any vertical: "I just use ChatGPT. It works fine."

**Where ChatGPT genuinely wins:**
- Best-in-class multimodal capabilities: image generation (DALL-E), video (Sora), voice (Advanced Voice Mode)
- Most capable model on several benchmarks; widely understood by users
- Zero setup for someone who already has an account
- The consumer tier is free; the Plus tier at $20/month is cheap
- The Business and Enterprise tiers are genuinely no-training with organization-wide controls
- Best mobile apps (iOS + Android), which Keepance doesn't match yet

**Keepance's wedge:**
The free and Plus tiers of ChatGPT train on user inputs by default. That means client details, matter facts, return data, or confidential business strategy that a professional types into ChatGPT Plus can be used to improve OpenAI's models unless the user has explicitly gone to Settings and disabled it. Most professionals who say "I use ChatGPT" are using the free or Plus tier. Beyond the training-default issue: ChatGPT is a chat interface. The output lives in ChatGPT's UI, in OpenAI's cloud. You can't search across six months of chats efficiently, the work product isn't portable, and it doesn't produce a local file. Keepance turns every conversation into a real Markdown file on your hard drive, gives you profession-specific templates built around how attorneys, CPAs, and consultants actually work, and on a local model routes nothing through anyone's server.

**One-liner rebuttal:**
"ChatGPT Plus trains on your inputs by default unless you've opted out, and your work lives on OpenAI's servers, not on your machine. Keepance puts the same AI conversation on your hard drive as a real file, with profession-specific templates, and a local model option where nothing leaves your machine."

**Proof point:**
Legal: *US v. Heppner* (S.D.N.Y., Feb-May 2026) held that using consumer AI tools without attorney direction can waive privilege. The consumer ChatGPT tier is exactly the scenario the court addressed. Tax: transmitting return information to OpenAI's servers is a third-party disclosure under IRC §7216 regardless of whether OpenAI trains on it. Consulting: consumer ChatGPT and Claude Pro train on inputs unless opted out. A strict NDA no-AI-upload clause is violated by any transmission, training or not. Advisor: every use of consumer ChatGPT with client data is "shadow AI" that the firm's CCO cannot monitor, vet, or include in the Reg S-P incident-response program. (Informational only, not legal or compliance advice.)

**When to concede:**
If the professional's work genuinely doesn't touch confidential client data, no NDA restricts AI use, and they just need a capable AI assistant for general tasks, ChatGPT (especially the Business or Enterprise tier) is hard to argue against on capability. The case for Keepance is strongest when confidentiality, local ownership of work product, and profession-specific structure are the priority. Keepance does not generate images or video and does not have a mobile app; ChatGPT wins those categories outright.

---

## Quick-reference index

| Competitor | Vertical | Their biggest strength vs us | Our wedge | When to send them there |
|---|---|---|---|---|
| Clio Duo | Legal | Matter/billing context; already in the stack | Local model for drafting; $149/yr | Primary AI need is matter/CRM integration |
| CoCounsel | Legal | Westlaw-grounded citation research | Price; zero-egress; own files | Citation-verified primary-authority research |
| Intuit Assist | Tax | Free; pulls from the return in Intuit stack | §7216-clean local model; Drake gap; WISP | Advisory planning only, already on Lacerte |
| Blue J | Tax | Primary-authority research with confidence scores | Drafting side; local model; price ($1,498 vs $149) | Citation-grounded tax research is the need |
| M365 Copilot | Consulting | Real PPTX output; already in the M365 stack | Strict NDA no-upload clause; local model | No sensitive data + deck is the deliverable |
| Gamma | Consulting | Polished deck output in minutes | Upstream work; NDA clause; local model | Visual deck is the primary need |
| Jump | Advisor | Meeting notes + CRM sync; 27k users; SOC 2 | Zero Reg S-P vendor surface; drafting/memos | Meeting notes + CRM automation is the need |
| Zocks | Advisor | No-recording architecture; SOC 2 | Notes still cloud; local model is zero-vendor | Meeting notes capture + eMoney sync |
| ChatGPT | Cross | Capability; image/video/voice; free/cheap | Files on disk; profession templates; local model | No client data risk + capability is the need |

---

*Voice note: every reply in a live conversation should feel like one honest person talking to another, not a corporate recitation. The one-liners above are meant as starting points; add one sentence of context specific to that prospect before you send.*
