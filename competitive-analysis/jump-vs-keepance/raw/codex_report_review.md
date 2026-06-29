Reading additional input from stdin...
OpenAI Codex v0.141.0
--------
workdir: /home/jameson/kp-jump
model: gpt-5.5
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: high
reasoning summaries: detailed
session id: 019f10ac-5fda-74d2-bfd7-a90c5a9f0897
--------
user
READ-ONLY MODE: investigate and report only. Do NOT create, edit, move, or delete any files, and do not mutate any external state. Output your findings and recommended changes as text/diff only.

READ-ONLY adversarial review. Read these two files:
1. /home/jameson/kp-jump/competitive-analysis/jump-vs-keepance/jump_vs_keepance_competitive_report.md (the report)
2. /home/jameson/kp-jump/competitive-analysis/jump-vs-keepance/raw/codex_jump_findings.md (your own earlier Jump investigation, for fact-checking)

You are a brutally skeptical reviewer. The report concludes Keepance should NARROW + REPOSITION away from head-on advisor competition with Jump, toward local-first + document-pile synthesis + Word-native authoring, because Jump (cloud, $105M, #1, cited client briefs) largely owns the advisor-AI category but is cloud-only and document-shallow.

Critique HARD and specifically. Output ONLY:
(A) FACTUAL ERRORS or OVERCLAIMS about Jump (anything stated more confidently than the evidence supports, any number/date/claim that is wrong or unverified-but-stated-as-fact). Cite the report's line/claim.
(B) Where the report is TOO SOFT on Keepance (overstates its differentiation/moat) or TOO HARSH (understates a real Keepance strength).
(C) LOGICAL GAPS in the KEY QUESTION answer — is 'narrow + reposition' actually the right call, or is there a stronger counter-argument (e.g. 'just kill the advisor angle entirely' or 'compete head-on is fine because Jump is shallow')? Steelman the strongest objection.
(D) The single most important thing the report gets WRONG or MISSES.
Be concise, specific, and cite evidence. This is your deliverable to stdout.
codex
I’ll only read the two files and report back. I’m going to pull line numbers so the critique can point to exact claims instead of vague sections.
exec
/bin/bash -lc 'nl -ba /home/jameson/kp-jump/competitive-analysis/jump-vs-keepance/jump_vs_keepance_competitive_report.md' in /home/jameson/kp-jump
 succeeded in 0ms:
     1	# Jump vs Keepance — Competitive Intelligence Report
     2	
     3	*Prepared 2026-06-28 for Jameson (Board). Author: competitive-analysis worker session (Claude Opus 4.8), with an independent Codex (gpt-5.5) investigation run in parallel and two independent web-research passes. Internal & private. Brutally honest by design — this report defaults skeptical and does not reassure.*
     4	
     5	---
     6	
     7	## THE KEY QUESTION (answered first, bluntly)
     8	
     9	> **Should Keepance AVOID direct financial-advisor competition (because Jump may already own it) and reposition around a narrower wedge Jump does NOT own?**
    10	
    11	**Mostly YES — with a precise correction to how you frame the wedge.**
    12	
    13	Keepance should **stop trying to be "an AI assistant / client-intelligence platform for financial advisors."** That sentence is Jump's home field, and Jump owns it: ~10% of all U.S. advisors (the clear #1), $105M raised, enterprise distribution through LPL/Osaic/Cetera, 39 live integrations, SOC 2 Type II, a 4.9-star app, and — critically — it already markets the exact thing you thought was your moat: a **cited, multi-source client brief** ("AI Associate… surfaces the answer with the source attached… synthesizes into a single coherent brief"). Head-on, that fight is near-unwinnable for an unfunded solo.
    14	
    15	**But "avoid advisors entirely" is too strong, and "synthesis is our moat" is now wrong.** Jump has two genuine, architecturally-hard-to-copy gaps:
    16	
    17	1. **It is cloud-only.** No local-first, no on-device, no BYOK option exists anywhere in Jump's public footprint. Its data lives in its cloud (US/Iowa). "We don't train on your data" and "you can set retention" is **not** the same promise as "your client files never leave your machine."
    18	2. **Its "synthesis" is meeting- and CRM-derived, not a deep read of your existing document pile.** Jump's document feature is **intake/extraction/form-filling** (account opening), not building a cited knowledge base over a messy folder of plans, statements, beneficiary forms, and emails. Its "Ask Anything" is mostly over **past meetings**.
    19	
    20	So the move is **NARROW + REPOSITION**, not "compete directly" and not "abandon the space." Reposition Keepance from *"advisor AI assistant"* (Jump's category) to **"the private place your client documents live and answer you back — on your own machine, without putting another cloud platform at the center of your practice."** Lead with the three things Jump genuinely lacks: **(a) local-first / private-by-architecture, (b) synthesis of the existing document + email pile (not meetings), (c) Word-native drafting with tracked-change AI redline.** Sell it to the narrow buyer for whom a cloud AI platform is a non-starter or who is **document-heavy rather than meeting-heavy** — and keep **attorneys** alive as a parallel option, because legal privilege is a real, structural reason to refuse the cloud (Jump does not serve law at all).
    21	
    22	**This sharpens the 2026-06-28 strategic memo and corrects one thing in it.** The memo said: don't fight notetakers, win on "synthesis + local." Correct on "local." **But "synthesis" is no longer an open field** — Jump says it loudly, is #1, and is racing up-market into exactly that language. Keepance must **not lead with "synthesis" or "client intelligence" generically**; those are Jump's words now. Lead with **local + document-pile + authoring**, the parts Jump cannot easily say.
    23	
    24	**Scores (detail + justification at the end):** Jump threat overall **8/10**; threat if Keepance targets advisors **9/10**; threat if Keepance targets attorneys **3/10**; Keepance differentiation today **5/10**; differentiation potential **7/10**; urgency to reposition **8/10**; confidence in analysis **7/10**.
    25	
    26	---
    27	
    28	## 1. Executive summary (plain language)
    29	
    30	Here's the whole thing in everyday words.
    31	
    32	**Jump is a real, well-funded competitor — not a toy, and not "just a meeting-notes app" anymore.** A company called Jump (jump.ai, based in Salt Lake City, the same area as you) makes AI software for financial advisors. It started by taking notes during client meetings. Now it does a lot more: it preps the advisor before a meeting, writes the follow-up emails, updates the advisor's contact system, and has an "assistant" you can ask questions like *"what's the Hendersons' asset allocation?"* and it answers **with a link to where it found the answer.** That last part is almost exactly what your "Client Map" and "Ask" features do. So the thing you thought was uniquely yours, Jump already advertises.
    33	
    34	**Jump is winning.** An independent industry researcher (Kitces) says about **1 in 10 U.S. financial advisors** already use Jump — making it the clear leader. It has raised about **$105 million**, big firms (LPL, Cetera, Osaic) push it to tens of thousands of their advisors, and its phone app has a **4.9-star rating**. That's a freight train. Trying to beat it head-on at "AI for advisors" would be like opening a coffee shop across the street from a beloved Starbucks that the whole town already loves.
    35	
    36	**But Jump has two real soft spots you can stand in.** First, **everything Jump does lives in Jump's cloud.** There is no version where your files stay on your own computer. Keepance's whole design — files and AI key never leave your machine — is the opposite, and Jump can't copy it without breaking its own business. Second, **Jump's "reading" is mostly of meetings and connected apps, not of a messy pile of documents.** When it handles documents, it's mostly to fill out account-opening forms, not to read a client's whole folder of plans, statements, and old emails and tell you what's in there. Keepance does exactly that, on your machine, with citations. Plus Keepance can actually **write and edit Word documents** (tracked changes) — Jump can't do that at all.
    37	
    38	**So the honest recommendation:** don't fight Jump as "AI for advisors." Re-aim Keepance as **"the private place your client documents live and answer you back, on your own computer"** — and sell it to the small slice of people who either *can't* put client data in someone else's cloud, or who are drowning in documents rather than meetings. Keep the door open to **lawyers** too, because their privacy rules give them a real reason to refuse the cloud, and Jump doesn't serve lawyers at all. And before you show this to a single advisor, fix the embarrassing problem that your own website and checkout still say "law practice" in places — a trust product can't contradict itself.
    39	
    40	**The catch (don't skip this):** even your two soft spots are *narrow*. "I want it to stay on my machine" is a comfort most advisors will nod at but few will switch for. "I have a document pile, not meetings" describes some advisors, not most. So this isn't "you found a safe corner" — it's "you found a *small* corner, and you still have to prove anyone will pay to stand in it." The 60-day demand test in the strategic memo is still the right next move. This analysis tells you **how to aim** that test, not that you can skip it.
    41	
    42	---
    43	
    44	## 2. Source coverage, method & limitations
    45	
    46	**Date/time of research:** 2026-06-28 (US). **Robots.txt:** `jump.ai/robots.txt` allows general crawling (`Allow: /`), disallowing only three partner landing paths (`/lpl`, `/sei`, `/osaic`). We respected that. No auth, paywall, CAPTCHA, or bot-protection was bypassed.
    47	
    48	**What we crawled directly (WebFetch + curl status + Chrome screenshots):** homepage, `/pricing`, `/integrations`, `/tour`, `/operating-system/ai-associate`, `/blog/security-and-compliance`, `/advisor-trends/artificial-intelligence/jump-vs-zocks`, `/blog/introducing-AI-associate`, `/blog/jump-unveils-new-ai-powered-account-opening…` (June 2026), `/blog/updates-may-2026`, `/company`. We status-checked ~28 key URLs (all returned **200**) and pulled the full sitemap (~135 URLs). See `jump_page_inventory.csv` for the full discovered set and `jump_claims_extracted.json` for structured claims.
    49	
    50	**Independent corroboration:** two separate web-research passes (funding/company; reviews/competitors) and one **independent Codex (gpt-5.5) investigation** that reached the **same** strategic conclusion via different sources (Jump help center, Kitces, WealthManagement.com, investor sites). Raw outputs saved under `competitive-analysis/jump-vs-keepance/raw/`.
    51	
    52	**Screenshots captured:** homepage, pricing, integrations, tour, AI Associate, company, security-and-compliance (`jump_screenshots/01–07`).
    53	
    54	**Discovered-but-not-fully-readable / blocked / failed (stated honestly):**
    55	- **`security.jump.ai` (Jump's trust center) is JavaScript/Vanta-gated** — returned only a title via public fetch. SOC 2 Type II, Iowa hosting, Vanta, and pen-testing facts therefore come from Jump's **help-center FAQ** and the **jump-vs-zocks** page, **not** the gated portal. Treat them as Jump-stated, lightly corroborated.
    56	- **Reddit (r/CFP, r/financialplanning) hard-blocked** automated access (400/refused). **G2 / Capterra star counts were not directly retrievable.** Both need a **manual logged-in pass** for real unfiltered advisor sentiment.
    57	- **T3 Inside Information survey primary + some head-to-head comparison tables are paywalled.** Numbers cited (market share 22.68%, T3 scores 8.61/8.64, Ezra 8.63) originate with Jump or gated reports.
    58	- One blog slug (`jump-expands-ai-operating-system…`) **404'd**; the live equivalent is the June 25 account-opening release.
    59	
    60	**Assumptions made:** sitemap URLs not individually re-checked are assumed 200 (they're in Jump's live sitemap). Jump's adoption numbers are treated as **self-reported** unless a third party (Kitces/App Store) corroborates.
    61	
    62	**Manual-verify list for Jameson (highest value first):**
    63	1. Jump **churn / retention** and **add-on (Grow/Onboard) attach rate** — the single most important missing numbers; both non-public.
    64	2. Real **Reddit / G2 / Capterra** advisor sentiment (logged-in).
    65	3. Whether Jump's "Ask Anything / Client Profile" can, in a live demo, **read a folder of arbitrary PDFs/statements** and synthesize them (vs only meetings/CRM). Book a Jump demo and ask directly.
    66	4. Jump's **actual SOC 2 report + sub-processor list** (request via security.jump.ai portal).
    67	
    68	---
    69	
    70	## 3. What Jump appears to be
    71	
    72	| Dimension | Finding | Confidence |
    73	|---|---|---|
    74	| **Category** | A **cloud "AI operating system / workflow platform for financial advisors."** Started as a meeting notetaker; now spans prep → meeting → follow-up → CRM sync → onboarding → firm-level revenue intelligence. | High |
    75	| **Target customer** | RIAs, enterprise broker-dealers/IBDs, independent advisors; also insurance, accounting, asset managers, banks. **Real center of gravity = enterprise advisor networks** (LPL/Osaic/Cetera) + independents via self-serve free trial. | High |
    76	| **Buyer** | Enterprise: the firm/BD's tech committee (top-down rollout). Independent: the advisor themselves (bottom-up, $100/mo free trial). | High |
    77	| **Core pain solved** | Time lost to meeting admin, manual notes, CRM data entry; scattered client data; missed growth opportunities. | High |
    78	| **Promise** | "Save time, increase revenue, elevate the client experience with compliant AI." "10 hrs saved/advisor/week." | High (claim) |
    79	| **Modules** | **Operating System** (AI Associate, Client Profiles, Email Assistant, 39 integrations) · **Meet** (notetaker, pre-meeting prep, post-meeting CRM sync, follow-up, scheduling) · **Grow** (Signals, Playbooks, Scorecards, Dashboards, revenue intelligence) · **Onboard** (AI intake forms, Document Intelligence, account opening). | High |
    80	| **Pricing** | **Meet $100/advisor/mo** (core; cut from $120, $75 for small firms) **+ Onboard $50 + Grow $50**; Enterprise = contact sales. Annual saves ~20%. Free trial. Fully-loaded ≈ $200/seat/mo. | High |
    81	| **Platform** | Cloud SaaS + web + iOS + Outlook add-in + embedded-in-Redtail. **No desktop-local / on-device / self-hosted option.** | High |
    82	| **Security posture** | SOC 2 Type II, encryption in transit/at rest, MFA, Vanta monitoring, pen-tested, **US/Iowa hosting**, **no training on customer data**, human-review-before-actions, configurable retention/consent/redaction/attestation. | Med-High (help-center sourced; portal gated) |
    83	| **Social proof** | "35,000+ advisors/users" (self-reported; was 27,000+ Feb 2026); Kitces ~10% of US advisors (**independent**); App Store **4.9/5 (~1,100)**; 2025 T3 top honors; LPL/Osaic/Cetera logos. | High (mixed: some independent) |
    84	| **Integrations** | ~39 across CRM, planning, portfolio, custodian (only Schwab), meeting/VoIP, calendar, tax, estate, doc storage, workflow. | High |
    85	| **Compliance** | Explicitly RIA + broker-dealer compliance workflows; attestation, supervision, disclosure/consent. | High |
    86	| **Funding/scale** | ~**$105M** total ($4.6M seed → $20M A/Battery 2025 → **$80M B/Insight Partners Feb 2026**); ~220-230 staff; Salt Lake City; CEO **Parker Ence**; acquired Mobile Assistant (Oct 2025). No valuation disclosed. | High (trade press + investors) |
    87	
    88	---
    89	
    90	## 4. Jump capability map
    91	
    92	*Legend: **M** = marketing-only claim · **3P** = third-party-verified · conf = high/med/low.*
    93	
    94	| Capability | Jump status | Evidence (URL) | Quote / note | Verify | Conf |
    95	|---|---|---|---|---|---|
    96	| Meeting prep (auto brief) | **Strong, core** | jump.ai/tour, /pricing | "Auto-generated meeting brief," pulls CRM/portfolio/plans/tax/email/past-meetings into a **cited** briefing | M (heavily used 3P) | High |
    97	| Meeting capture / transcription | **Owns it** | T3 survey 8.61 | Zoom/Teams/Meet/Webex/phone/in-person/mobile | 3P | High |
    98	| Note accuracy / reliability | **Good but imperfect** | XYPN review; advisor complaints | "Dropped recordings… failure rate unacceptable"; XYPN note-accuracy 3.5/5 (below FinMate) | 3P | Med |
    99	| CRM sync (Wealthbox/Redtail/Salesforce…) | **Strong, core** | /integrations | Post-meeting structured data → CRM, human-approved | M (3P breadth) | High |
   100	| Email drafting / assistant | **Strong** | homepage, /tour | "Faster drafting and rewrites, right in your inbox"; auto follow-up emails | M | High |
   101	| Task creation | **Strong** | /pricing | Follow-up action items auto-generated, matched to CRM fields | M | High |
   102	| **Client intelligence (unified profile)** | **Claimed strong** | homepage, /tour | "**Evergreen client profiles that pull data across all data sources**" | M | High |
   103	| **AI search across client data (cited)** | **Claimed strong** | /operating-system/ai-associate | "reads your transcripts and meeting notes and **surfaces the answer with the source attached**"; ex: "Which clients over 60 don't have a beneficiary on file?" | M | High |
   104	| **Cross-DOCUMENT synthesis (arbitrary folder)** | **Shallow / not proven** | /blog/…account-opening; Codex | Document Intelligence = "upload, parse, and sync" = **intake/form-filling**, not deep folder reasoning | M (gap) | Med-High |
   105	| Doc intelligence (intake/account-opening) | **Real** | Onboard add-on | Field extraction → forms → CRM | M | High |
   106	| Planning + portfolio integration | **Real** | /integrations | eMoney, RightCapital, Orion, Black Diamond | 3P | High |
   107	| Custodian integration | **Thin** | /integrations | **Only Schwab** is a true custodian; others are BDs/IBDs | 3P | High |
   108	| Book-of-business intelligence (Grow) | **Claimed** | /tour, jump-vs-zocks | Signals: held-away assets, consolidation, referral intent, sentiment | M (attach rate unproven) | Med |
   109	| Compliance review / supervision | **Real, enterprise-grade** | /blog/security-and-compliance | Attestation, supervision, disclosure/consent, redaction | M (3P logos) | High |
   110	| Retention controls | **Real** | help center | Summary-only, auto-delete, zero-transcript-retention | M | Med-High |
   111	| Human review before action | **Real (constrains autonomy)** | /operating-system/ai-associate | "Every action requires your approval" | M | High |
   112	| Audit trail | **Real** | homepage | "Enterprise-grade audit trails" | M | Med |
   113	| Agentic "AI Associate" | **Live but early-access** | help.jumpapp.com | Acts across CRM/email/planning/tasks; **chat history "coming soon"**; no efficacy data | M (immature) | Med |
   114	| Admin / firm config | **Real** | /pricing Enterprise | SSO, SCIM/SAML, compliance dashboard | M | High |
   115	| ROI dashboards | **Claimed** | Grow | Dashboards/Scorecards | M | Med |
   116	| Mobile | **Real, expanding** | /blog/updates-may-2026 | AI Associate + Contacts on iOS | M | High |
   117	| Enterprise deployment | **Strong (the real moat)** | Series B; Cetera/LPL | Top-down BD/IBD rollout | 3P | High |
   118	| **Document AUTHORING / editing (Word redline)** | **Absent** | — | Jump moves data; it does not write/edit documents | — (gap) | High |
   119	| **Local-first / on-device / BYOK** | **Absent** | Codex; site | No local/self-hosted/customer-key option found anywhere | — (gap) | High |
   120	
   121	---
   122	
   123	## 5. Keepance capability map
   124	
   125	*(Grounded in the repo at `/home/jameson/kp-jump`; full detail in `keepance_current_state.md`.)*
   126	
   127	| Capability | Keepance status |
   128	|---|---|
   129	| **Does today (real, shipped v3.0)** | Client Map (cited per-client brief built from the **local document/email pile**); Ask (cited Q&A over docs+email); Workflows (profession packs); **Word-native OOXML editing + tracked-change AI redline**; email intelligence (Outlook/Gmail/IMAP, encrypted, indexed); local RAG (LanceDB + e5-small); **BYOK-direct** (keys in OS keychain, no Keepance content server); Ollama local-model support; OneDrive + Wealthbox connectors. |
   130	| **Claims (true but with an asterisk)** | "Private" = fully true only in **local-model (Ollama)** mode; in BYOK-cloud mode the query still goes to the user's chosen AI provider (never to a Keepance server). Must be sold as "far less to vet," not "nothing leaves." |
   131	| **Intends (planned, not built)** | Embedded/bundled local model; SOC 2 + DPA; formed legal entity; deeper advisor workflow pack; firm-tier hardening; 5-yr audit/retention export. |
   132	| **Not yet / weak** | ~2 polished connectors only (vs Jump's 39); **no meeting capture/transcription at all**; **no CRM-grade integrations breadth**; no mobile; **zero outside/paying users**; positioning drift (law copy still on checkout + repo homepage). |
   133	| **Weaker than Jump** | Distribution (none vs LPL/Osaic/Cetera); funding; integration breadth; brand/awards; meeting capture; enterprise compliance certs (no SOC 2); reliability proof at scale; sales motion. |
   134	| **Stronger than Jump** | **Local-first / private-by-architecture / BYOK**; **synthesis of an existing document+email pile** (not meetings/CRM); **Word-native authoring + AI redline** (Jump has none); **no-CRM-required** (works for a stack-light solo); **price** (BYOK ~$39–79/mo vs Jump $100–200); single-buyer self-approval (solo = own CCO). |
   135	
   136	---
   137	
   138	## 6. Feature-by-feature comparison
   139	
   140	*Advantage = who wins that cell today for the target buyer. "Tie/unclear" flagged honestly.*
   141	
   142	| Capability | Jump status | Keepance current | Keepance planned | Advantage | Evidence | Strategic implication |
   143	|---|---|---|---|---|---|---|
   144	| Onboarding / time-to-value | Free trial, guided; but a whole platform to adopt | Point at a folder; **no migration** | Bundled local model | **Tie** (different friction) | /pricing; repo | Keepance "no migration" is a real wedge for the stack-light |
   145	| Connect AI / BYOK | No BYOK (Jump-managed cloud AI) | **BYOK-direct, OS keychain** | — | **Keepance** | redline.ts; Codex | The clean architectural seam |
   146	| Local / private storage | Cloud (US/Iowa) | **On-device** | Embedded model | **Keepance** | Codex; repo | "Never leaves your machine" — uncopyable for Jump |
   147	| Local-first desktop app | None | **Tauri desktop** | — | **Keepance** | repo | Different product shape entirely |
   148	| Cloud platform | **Mature, multi-surface** | Browser demo only | — | **Jump** | jump.ai | Jump wins anyone who wants cloud convenience |
   149	| Data import | 39 integrations | Files + OneDrive + email | More connectors | **Jump** | /integrations | Breadth race Keepance should sidestep, not enter |
   150	| File indexing / search | "Ask Anything" over **meetings** | **Semantic RAG over docs+email** | — | **Keepance** (for documents) | repo; help center | Keepance reads what Jump can't (the file room) |
   151	| Email ingestion | Inbox assistant (cloud) | **Local import + index (Outlook/Gmail/IMAP)** | — | **Keepance** (privacy) / **Jump** (drafting) | repo | Split: Keepance reads privately, Jump drafts |
   152	| CRM integration | **Deep, many** | Wealthbox + Salesforce | More | **Jump** | /integrations | Don't out-integrate Jump |
   153	| Meeting notes / transcription | **Owns it** | **None** | — | **Jump** | T3 | Do NOT build this; it's table-stakes Jump owns |
   154	| Unified client profile / "Client Map" | "Client Profiles" (meeting/CRM-sourced) | **Client Map (document/email-sourced), cited** | — | **Tie/unclear** | both | The collision point — differentiate on SOURCE (files vs meetings) + local |
   155	| Cited answers / source retrieval | **Yes (over meetings)** | **Yes (over docs+email)** | — | **Tie** | both | Citations are now table-stakes; not a differentiator alone |
   156	| Drafting / follow-up emails | **Strong** | Possible via Ask, not a focus | — | **Jump** | jump.ai | Jump owns meeting→email; not Keepance's fight |
   157	| **Word-native editing / AI redline** | **None** | **Real (tracked changes)** | — | **Keepance** | redline.ts | Uncontested capability — lean on it |
   158	| Workflow automation / task creation | **Strong (Signals/Playbooks)** | Workflow packs (templates) | Advisor pack depth | **Jump** | jump.ai | Jump's Grow is deeper; don't compete here |
   159	| Compliance / audit trail | **Enterprise-grade, SOC 2 II** | Local audit log; **no SOC 2** | SOC 2 on demand; 5-yr export | **Jump** | both | Fatal for firms; manageable for solos (self-CCO) |
   160	| Human-review posture | Yes | Yes (AI proposes, user decides) | — | **Tie** | both | Both conservative; neutral |
   161	| Consent / disclosure / retention | **Built-in** | Local by nature; export TBD | First-class export | **Jump** (features) / **Keepance** (by architecture) | both | Jump has the controls; Keepance has the architecture |
   162	| Firm / multi-user deployment | **Mature** | E2EE firm tier (built, unproven) | Hardening | **Jump** | both | Avoid firm deals early |
   163	| Integrations marketplace | **39** | ~2 polished | — | **Jump** | /integrations | Sidestep |
   164	| Pricing | $100–200/seat/mo | **$39–79/mo BYOK** | Test $150/mo | **Keepance** (cost) | both | Cheaper, but cost isn't a moat |
   165	| Target market fit | **Enterprise + independents** | Stack-light solo / privacy-bound | — | depends | both | Keepance must pick the slice Jump serves worst |
   166	| Time-to-value | Adopt a platform | Open a folder | — | **Keepance** | repo | Real for the document-heavy solo |
   167	| Trust posture | Certs + logos | **Architecture + design** | + entity/case study | **Tie/unclear** | both | Jump = "certified vendor"; Keepance = "nothing leaves" |
   168	| Sales motion | Self-serve + enterprise | Founder-led only | — | **Jump** | both | Jump's machine vs your one founder |
   169	| Demo quality | Polished, multi-surface | Strong design, pre-packaged installer pending | Clean Win build | **Jump** today | both | Fix the installer/demo before any advisor sees it |
   170	| Website clarity | Clear, single story | **Inconsistent (law vs advisor)** | Reconcile surfaces | **Jump** | repo | Fix immediately — trust product can't contradict itself |
   171	
   172	---
   173	
   174	## 7. Strategic overlap analysis
   175	
   176	**Now table-stakes because Jump has it (do NOT build/lead with these):**
   177	- Meeting capture/transcription, follow-up email drafting, CRM data sync, "cited answers," and even "a unified client profile / Ask-anything." **Citations and unified profiles are no longer differentiators** — Jump shouts them. Leading with "cited client intelligence" walks straight into Jump's strongest marketing.
   178	
   179	**Still genuinely differentiated (Jump cannot easily say these):**
   180	- **Local-first / private-by-architecture / BYOK-direct.** Architecturally opposed to Jump's cloud model — copying it would cannibalize Jump's business.
   181	- **Synthesis of the existing document + email pile** (the messy file room), not meetings/CRM. Jump's document layer is intake/extraction.
   182	- **Word-native authoring + tracked-change AI redline.** Jump has nothing here.
   183	- **No-CRM / no-meetings required.** Keepance works for someone with a folder and no stack; Jump's value compounds with the stack.
   184	
   185	**What Keepance should NOT build because Jump owns it:** meeting notetaking/transcription, a 39-integration marketplace, revenue-intelligence dashboards (Grow), account-opening/intake automation, and a cloud multi-surface platform. Every hour spent here is an hour lost to a $105M company that is already #1.
   186	
   187	**Jump capabilities that are strategically dangerous to Keepance:**
   188	- **"Client Profiles" + "AI Associate" with cited briefs** — they directly occupy Keepance's hero narrative. Most dangerous.
   189	- **Document Intelligence** — if Jump deepens it from intake → true folder synthesis, the document seam narrows. **Watch this closely.**
   190	- **Enterprise distribution** — not a feature, but it's why Jump wins regardless of feature parity.
   191	
   192	**Likely shallow marketing vs real depth:**
   193	- **Shallow/early:** "AI Operating System" language (it's a workflow layer); AI Associate (early-access, chat history "coming soon," no efficacy data); Grow add-on attach (analysts doubt advisors pay); "35,000 advisors" softened to "35,000 users."
   194	- **Real depth:** meeting capture, integrations, enterprise compliance, distribution. These are not bluffs.
   195	
   196	**Hard for Keepance to catch:** distribution, funding, integration breadth, meeting capture, brand. **Don't matter for Keepance's best beachhead:** meeting features, Grow dashboards, account-opening — irrelevant to a document-heavy, privacy-bound solo.
   197	
   198	---
   199	
   200	## 8. Segment-by-segment threat assessment
   201	
   202	| Segment | Jump threat | Why | Keepance opportunity / positioning |
   203	|---|---|---|---|
   204	| **Independent RIAs / advisors** | **High → existential (head-on)** | Jump's home field; ~10% penetration; enterprise + self-serve; owns the cited-brief narrative | Only via the **narrow** slice: privacy-bound or document-heavy, stack-light solos who won't put files in a cloud platform. Position **local + file-pile + authoring**, never "advisor AI" |
   205	| **Broker-dealers / IBD enterprises** | **Existential** | Jump's core distribution (LPL/Osaic/Cetera) | **Avoid.** Keepance has no SOC 2/DPA/entity; firm dictates the stack |
   206	| **Insurance professionals** | **High** | Jump explicitly targets them | Avoid unless a privacy-document niche appears |
   207	| **Tax / accounting pros** | **Med** | Jump integrates Holistiplan/TaxStatus + targets accounting; but Holistiplan owns tax-doc reading | Adjacent later; document-heavy + privacy-minded, but Holistiplan + Jump both present |
   208	| **Attorneys (solo/small)** | **Low (3/10)** | **Jump does not serve law at all** | **Real open door** — privilege = structural cloud-aversion; Word-native redline fits legal drafting. BUT legal-AI is its own crowded, well-capitalized space (Harvey $11B+). Low *Jump* threat ≠ easy market |
   209	| **Estate planning** | **Med** | Document-heavy = synthesis pain; Jump integrates Wealth.com | Niche; Vanilla/FP Alpha also present |
   210	| **Family law** | **Low (Jump)** | Not Jump's space | Document + privacy heavy; but consumer-grade tools + legal-AI compete |
   211	| **Consultants / other high-trust** | **Low (Jump)** | Not Jump's space | Possible local-first/document niches; unvalidated |
   212	
   213	**Pattern:** Jump's threat is **near-total inside the financial-advisor world** and **near-zero outside it**. The clean-air segments (attorneys, estate, consultants, document-heavy professionals) are exactly where Jump isn't — but they bring *other* competitors and remain unvalidated for Keepance. The lowest-Jump-threat path is **not necessarily the lowest-overall-threat path.**
   214	
   215	---
   216	
   217	## 9. Positioning analysis
   218	
   219	**Head-to-head positioning (Jump vs Keepance):**
   220	
   221	| Axis | Jump | Keepance (today) | Keepance (recommended) |
   222	|---|---|---|---|
   223	| Headline | "The #1 AI platform for advisors!" | (drifting: law vs advisor) | "Walk into every meeting already knowing the whole household — on your own machine." |
   224	| Category | AI operating system for advisors | "private intelligence layer" | **Private client-document intelligence (local-first)** |
   225	| Promise | Save time, grow revenue (across your stack) | Cited private intelligence | "Your client's whole file room, read and answerable — privately, on your computer" |
   226	| Emotional | "Don't get left behind" (FOMO, growth) | Trust/control | **Control + relief** ("nothing leaves; nothing to vet") |
   227	| Trust | Certs + enterprise logos | Architecture + design | **Architecture** ("private by design, not by promise") |
   228	| Compliance | SOC 2 II + attestation features | Local by nature | "Far less for compliance to vet" (honest) |
   229	| CTA | "Try for free" / "Book a demo" | Mixed | Founder-led guided demo / paid pilot |
   230	| Buyer | Firm tech committee + advisor | Advisor | The privacy-bound / document-heavy solo (or attorney) |
   231	| Demo clarity | High | Pre-installer, drift | Must be a clean Windows build, one loop |
   232	| Information architecture | Single clear story | **Contradicts itself (law/advisor)** | One reconciled advisor (or pro) story |
   233	
   234	**What Keepance should STOP saying:** "AI assistant," "AI for financial advisors" (generic), "client intelligence" / "cited answers" as the *lead* (those are Jump's words now), anything law-flavored on advisor surfaces, and "$99" (signals toy).
   235	
   236	**What Keepance should say INSTEAD:** "**The private place your client documents live and answer you back — on your own computer.**" Lead with **(1) on your machine, (2) reads the files you already have (no CRM, no meetings, no migration), (3) and you can edit the Word docs right there with tracked changes.** Frame Jump implicitly: *"Jump is the cloud assistant that runs your meetings and your CRM. Keepance is the private vault that reads your files — and never leaves your computer."*
   237	
   238	**The four positioning decisions, answered:**
   239	- **Avoid advisors for now?** **Partially.** Avoid the *head-on advisor-AI* frame. Pursue the *narrow privacy/document slice* of advisors, and treat it as one of two beachheads.
   240	- **Focus attorneys?** **Keep as a live parallel option, not the sole bet.** Jump threat there is ~zero and Word-native redline fits, but legal-AI is crowded and well-funded, and Keepance never validated law either. Test both wedges in the 60-day sprint; let demand pick.
   241	- **Focus local-first private desktop AI?** **Yes — this is the spine.** It's the one thing Jump structurally cannot copy.
   242	- **Become "client memory," not "advisor AI assistant"?** **Yes, with a tweak:** become **"private client-document memory"** — emphasize *documents + local*, because plain "client memory / client intelligence" is now Jump's territory.
   243	- **Strongest wedge if Jump owns advisor AI:** **"Local-first, private, reads your existing file room (not your meetings), and writes your documents."** That sentence has zero overlap with Jump.
   244	
   245	---
   246	
   247	## 10. Moat & defensibility (graded bluntly)
   248	
   249	| Moat type | Keepance | Grade |
   250	|---|---|---|
   251	| **Local-first / architecture** | True local + BYOK + in-house OOXML engine + document-pile synthesis. Hard for cloud Jump to copy (cuts against its model). The **real** moat. | **3.5/5** |
   252	| Data moat | None — data is the customer's and stays local by design (privacy vs data-network-effects are in tension). | 1/5 |
   253	| Workflow lock-in | Emerges once an advisor's institutional memory lives in Client Maps; zero until weekly use. | 1.5/5 |
   254	| Integration / switching cost | OneDrive + Wealthbox start it; thin vs Jump's 39. | 1.5/5 |
   255	| Compliance moat | None today (no SOC 2/DPA/entity); Jump is far ahead. | 0.5/5 |
   256	| **Distribution moat** | **None — the gap that decides everything.** Jump has LPL/Osaic/Cetera; Keepance has nobody. | 0/5 |
   257	| UX / design | Genuinely strong; founder is a product designer. Durable while solo. | 3/5 |
   258	| Trust posture | "Private by architecture" is a real, ownable trust story — if sold honestly. | 2.5/5 |
   259	| Vertical depth | Shallow post-pivot (label facade, not deep advisor build). | 1.5/5 |
   260	
   261	**Net defensibility ≈ 2/5.** Enough for a cash-flow niche; **not** enough to hold off a funded land-grab if Jump (or FutureVault, or Wealthbox) targets the local-first/document wedge. The honest truth: **Keepance's only durable moat is the local-first architecture + authoring, and a moat means nothing without a single channel to reach the buyer.** Distribution, not features, is the unsolved problem — and Jump has already solved distribution.
   262	
   263	---
   264	
   265	## 11. Product recommendations (prioritized)
   266	
   267	**MUST build / fix now (credibility, not features):**
   268	1. **Reconcile the surface drift** — `pricing.ts` audience strings, the in-repo homepage, FEATURES.md — to **one** story (advisor *or* pro), kill the $99-vs-$948 inconsistency. A trust product cannot contradict itself. *(Highest urgency, lowest effort.)*
   269	2. **Package a clean installer + a 4-beat demo on a fresh Windows build.** Nothing advisor-polished has shipped; you cannot sell a download that doesn't exist.
   270	3. **Make the Client Map bulletproof on a real, messy folder** (PDF indexing on by default for the demo path) — the "wow on real files" moment is the entire pitch.
   271	
   272	**SHOULD build (sharpen the wedge Jump lacks):**
   273	4. **Lean into Word-native AI redline as a first-class selling moment** — it's the cleanest Jump-can't-do-this capability.
   274	5. **A crisp "where your data goes" one-pager** (Local / BYOK-direct / Assured) — turn the privacy architecture into a forwardable artifact.
   275	6. **5-year audit/retention export** — needed the moment any firm conversation gets real.
   276	
   277	**SHOULD AVOID (Jump owns it — building here is lighting money on fire):**
   278	- Meeting capture/transcription, a 39-integration marketplace, Grow-style revenue dashboards, account-opening/intake automation, a cloud multi-surface platform, mobile.
   279	
   280	**FAKE-DEMO / validate before building:**
   281	- The "firm shared brain" / multi-user E2EE tier — impressive, near-zero current willingness-to-pay; keep, don't sell.
   282	- Any new vertical pack — mock it before coding it.
   283	
   284	**REMOVE from roadmap (for now):** embedded-model bundling as a priority (Ollama-external is enough to prove local), SSO, CRDT co-editing — all Jump-irrelevant distractions during the demand test.
   285	
   286	**Prioritization logic:** differentiation (local/document/authoring) + urgency (drift, installer) + speed-to-demo first; revenue features and Jump-overlap features last or never.
   287	
   288	---
   289	
   290	## 12. Demo / sell / build implications
   291	
   292	- **Who to demo to:** a **document-heavy, privacy-bound solo** — a fee-only RIA who is their own paraplanner and distrusts cloud AI, **or** a solo estate/small-firm attorney. NOT an enterprise advisor (Jump's there) and NOT a meeting-heavy advisor (Jump wins).
   293	- **Which use case:** **pre-meeting prep from the client's existing folder** → cited Client Map → ask a question, click the source → **edit the review note in Word with tracked changes.** That last beat is the un-Jump-able moment.
   294	- **Jump-overlap features to de-emphasize:** anything that sounds like "notetaker," "CRM sync," "follow-up emails," or generic "AI assistant / client intelligence."
   295	- **Differentiated Keepance moments to show clearly:** (1) "this all ran on your machine — watch the egress indicator stay dark in local mode," (2) "it read your actual folder of PDFs, not a meeting," (3) "now I'll redline the Word doc — Jump can't touch your documents."
   296	- **What the demo must prove:** it **wows on the advisor's own messy files** (not the curated Webb/Hendricks sample) and the privacy claim is **literally inspectable**.
   297	- **Buying questions to ask the prospect:** "Walk me through how you prepped for your last review." "Would your compliance person let you put client files in a cloud AI tool?" "Do you use Jump or a notetaker today — what does it *not* do?" "What's in your client folders that no system can see right now?"
   298	
   299	---
   300	
   301	## 13. Risk register — top 20 Jump-created risks
   302	
   303	| # | Risk | Type | Severity | Likelihood | Evidence | Mitigation |
   304	|---|---|---|---|---|---|---|
   305	| 1 | Jump already owns "cited client intelligence," so Keepance's hero pitch sounds like a Jump knockoff | Positioning | **High** | High | AI Associate page | Re-lead with local + document-pile + authoring; never "client intelligence" generically |
   306	| 2 | Head-on advisor competition is unwinnable vs Jump's distribution | Competitive | **Existential** | High | Kitces 10%; LPL/Cetera | Narrow to privacy/document slice; don't fight distribution |
   307	| 3 | Jump deepens Document Intelligence intake → true folder synthesis, closing the document seam | Product | **High** | Medium | June 2026 Onboard push | Move fast; deepen synthesis + add authoring lock-in |
   308	| 4 | Jump (or FutureVault/Wealthbox) ships a local/on-prem tier | Competitive | **High** | Low-Med | none yet | Speed; make local + authoring + workflow lock-in the moat |
   309	| 5 | "Local-first" is a nod, not a purchase driver | Market | **High** | Med-High | memo H3 | Lead with outcome+document pain; local as closer, not opener |
   310	| 6 | The document-heavy + privacy-bound + tiny intersection is too small to be a business | Market | **High** | Medium | memo §4 | The 60-day test must size it before more building |
   311	| 7 | No distribution channel exists to reach the niche at all | Distribution | **High** | Medium | moat=0 | Kitces/XYPN/NAPFA + founder-led; attorney channels in parallel |
   312	| 8 | Surface drift (law vs advisor) kills trust on first impression | Trust | **High** | High (today) | repo | Reconcile before any demo (this week) |
   313	| 9 | Jump's price cut ($120→$100, $75 small-firm) compresses the whole category's willingness-to-pay | Pricing | **Med** | High | InvestmentNews | Don't compete on price; sell a different job (private/document) |
   314	| 10 | Buyers expect SOC 2; Keepance has none | Trust | **Med** | Med | repo gap | Sell solos (self-CCO); entity now; SOC 2 on demand |
   315	| 11 | Attorney pivot escapes Jump but lands in Harvey/legal-AI's $11B field | Market | **Med** | Med | legal-AI funding | Test, don't commit; lean on local+privilege+authoring |
   316	| 12 | Jump's brand ("#1, T3/Kitces") makes Keepance look like a hobby | Trust | **Med** | Med | awards | Design polish + entity + design-partner case study |
   317	| 13 | Keepance's "private" claim has a cloud asterisk (BYOK-cloud sends query out) → AI-washing risk | Trust/Legal | **Med** | Med | repo | Scrupulous honesty: "far less to vet," not "nothing leaves" |
   318	| 14 | The build trap recurs (a 6th pivot instead of selling) | Product | **High** | High | memo §16 | This report + memo as the line; ≥50% time on customers |
   319	| 15 | Jump adds Word/Office authoring (Outlook add-in already shipped) | Product | **Med** | Low-Med | May 2026 add-in | Deepen redline/OOXML lead while it's uncontested |
   320	| 16 | Meeting-derived intelligence proves "good enough," document synthesis seen as redundant | Product | **Med** | Med | Jump prep page | Demo on files Jump literally cannot see (private archives) |
   321	| 17 | Jump's enterprise motion eventually trickles down to small RIAs via BD free tiers | Distribution | **Med** | Med | LPL/Cetera | Own the off-network, privacy-bound solo Jump under-serves |
   322	| 18 | Jump churn is actually low (sticky) → niche shrinks further | Market | **Med** | Unknown | undisclosed | Manual-verify churn; target non-adopters, not switchers |
   323	| 19 | Founder bandwidth (full-time job) can't out-execute a 220-person company | Competitive | **Med** | Med | memo §16 | Tight scope; AI-leveraged build; sell, don't out-build |
   324	| 20 | Keepance copies Jump features reactively and loses its identity | Product | **Med** | Med | — | Hold the line: local + document + authoring; ignore Jump's roadmap |
   325	
   326	---
   327	
   328	## 14. Final recommendation + 7-day action plan
   329	
   330	**Recommendation: NARROW + REPOSITION (do not continue head-on; do not fully pivot away from advisors; do not stop building the core — re-aim it).**
   331	
   332	- **Continue:** the local-first desktop product, the Client Map / Ask / Word-redline engine. It's genuinely good and genuinely differentiated *where it differs* (local, document-pile, authoring).
   333	- **Narrow:** from "AI for financial advisors" to **"private client-document intelligence, on your own machine,"** sold to the privacy-bound / document-heavy solo (advisor or attorney).
   334	- **Change the use case** shown in the demo: from "AI assistant" to **"read my existing file room privately + write the doc"** — the two beats Jump can't match.
   335	- **Change the demo + the market message** accordingly; **stop building** anything Jump owns.
   336	- **Validate before more building** via the memo's 60-day test — now **aimed** by this analysis (test the privacy/document slice *and* the attorney slice; let demand pick).
   337	- **Sell now** only via founder-led paid pilots to that narrow buyer; **no self-serve** until the demo is bulletproof.
   338	
   339	**One-page next-7-days action plan:**
   340	1. **Day 1:** Reconcile the surface drift — fix `pricing.ts` audience strings, the in-repo homepage, FEATURES.md — to one story; kill the $99/$948 split. *(Trust, before anything else.)*
   341	2. **Day 1–2:** Rewrite the homepage hero to the new line: *"The private place your client documents live and answer you back — on your own computer."* Demote any "AI assistant / client intelligence" lead language.
   342	3. **Day 2–3:** Build a **clean Windows installer + a 4-beat demo** (folder → cited Client Map → click a source → Word redline) on a fresh build; make the egress/local indicator visibly part of the demo.
   343	4. **Day 3:** Draft the one-sentence Jump answer: *"Jump is the cloud assistant for your meetings and CRM; Keepance is the private vault that reads your files and never leaves your computer."* Plus the forwardable "where your data goes" one-pager.
   344	5. **Day 3–4:** **Book a Jump demo yourself** and confirm (manual-verify item) whether its Client Profile can read an arbitrary PDF folder vs only meetings/CRM — this de-risks the whole thesis.
   345	6. **Day 4–6:** Line up **10 discovery calls** split across the two wedges: privacy/document-heavy solo RIAs (XYPN/NAPFA/FinTwit) **and** solo estate/small-firm attorneys. Mom-Test questions; no pitching.
   346	7. **Day 7:** Manual sentiment pass on Reddit/G2/Capterra for Jump (logged-in) to find what advisors say Jump *can't* do — that list is your wedge copy.
   347	
   348	---
   349	
   350	## Scoring (1–10, with justification)
   351	
   352	| Metric | Score | Justification |
   353	|---|---|---|
   354	| **Jump threat — overall** | **8/10** | Funded ($105M), #1 (Kitces ~10%), enterprise distribution, directly overlaps Keepance's hero (cited client briefs). Not a 9-10 only because it's cloud-only and document-shallow, leaving a real (narrow) seam. |
   355	| **Jump threat — if Keepance targets advisors** | **9/10** | Jump's home field; overwhelming distribution + brand + the same pitch. Head-on, near-existential. Only the narrow privacy/document slice survives. |
   356	| **Jump threat — if Keepance targets attorneys** | **3/10** | Jump does not serve law at all; privilege favors local. Not lower because the *market itself* is contested by well-funded legal-AI (Harvey) — low Jump threat ≠ easy win. |
   357	| **Keepance differentiation — today** | **5/10** | Real, ownable seams (local/BYOK, document-pile synthesis, Word redline) — but pre-traction, inconsistent surfaces, ~2 connectors, no entity/SOC 2, label-facade-deep advisor build. |
   358	| **Keepance differentiation — potential** | **7/10** | Local-first + document synthesis + authoring is genuinely hard for a cloud incumbent to copy (it fights their model). Defensible *if* a buyer who needs it is found and the surfaces are fixed. |
   359	| **Urgency to reposition** | **8/10** | Jump is racing up-market into "client intelligence / operating system," adding mobile + embed + deeper prep. The window to claim "local + document-pile + authoring" is now; the surface drift is an active trust wound today. |
   360	| **Confidence in analysis** | **7/10** | High on Jump's public posture, funding, category position (two independent passes + Codex + third-party sources converge). Tempered by JS-gated trust center, blocked Reddit/G2, paywalled surveys, undisclosed Jump churn/attach-rate, and Keepance's still-untested real demand. |
   361	
   362	---
   363	
   364	*Bottom line: Jump is a serious, category-leading, well-funded competitor that already occupies Keepance's hero narrative in the cloud. Do not fight it there. Keepance's honest, defensible ground is the one place Jump structurally is not: private, local-first, reading the existing document + email pile (not meetings), and writing the documents. Narrow to that, fix the contradictory surfaces this week, and let a 60-day demand test — aimed at the privacy/document-heavy solo and the solo attorney — decide whether anyone will pay to stand in that corner.*

exec
/bin/bash -lc 'nl -ba /home/jameson/kp-jump/competitive-analysis/jump-vs-keepance/raw/codex_jump_findings.md' in /home/jameson/kp-jump
 succeeded in 0ms:
     1	Reading additional input from stdin...
     2	OpenAI Codex v0.141.0
     3	--------
     4	workdir: /home/jameson/kp-jump
     5	model: gpt-5.5
     6	provider: openai
     7	approval: never
     8	sandbox: danger-full-access
     9	reasoning effort: high
    10	reasoning summaries: detailed
    11	session id: 019f10a0-7763-7403-93e3-853c7f5408c5
    12	--------
    13	user
    14	READ-ONLY MODE: investigate and report only. Do NOT create, edit, move, or delete any files, and do not mutate any external state. Output your findings and recommended changes as text/diff only.
    15	
    16	You are an independent competitive-intelligence engineer with web access. Investigate the company Jump (https://jump.ai), an AI platform for financial advisors, and produce a BLUNT, skeptical, evidence-based briefing. PUBLIC INFO ONLY — respect robots.txt/paywalls; if blocked, say so; never fabricate. Cite source URLs.
    17	
    18	Cover: (1) What Jump actually IS (category, target customer, core product modules — meeting notes, CRM sync, email drafting, task automation, the 'AI Associate' agentic layer, ask-across-client-data). (2) Funding/scale/adoption — verify total raised, investors, advisor-count claims; flag marketing vs verified. (3) Integrations breadth (CRMs, planning tools, custodians). (4) Security/compliance posture (cloud, SOC 2, data retention, human-review-before-actions). (5) The SHARPEST honest assessment: where is Jump genuinely deep vs shallow marketing? What are its WEAKNESSES and blind spots a small competitor could exploit? (6) Specifically: does Jump do cross-document SYNTHESIS of a client's whole document set (financial plan + statements + beneficiary forms + emails) into one cited brief, or is it primarily a meeting-notes-to-CRM tool? Is it cloud-only (no local/on-device/BYOK option)? These two are the key competitive seams for a rival called Keepance (local-first, BYOK, cross-document client synthesis). Assess honestly whether those seams are real and defensible, or whether Jump already covers them.
    19	
    20	Be concise but specific. Output your full briefing to stdout as markdown — this is your deliverable.
    21	codex
    22	I’ll only read public web pages and report back. I’m checking Jump’s own site first, then outside sources so we can separate their marketing claims from things other people have verified.
    23	web search: 
    24	web search: Jump AI financial advisors funding total raised investors advisor count integrations SOC 2
    25	**Exploring deeper pages**
    26	
    27	I need to look for deeper pages. I'm thinking about the Jump home and checking out product pages, which might include information about AI associates, integrations, and security. There’s a lot to consider, and I want to make sure I gather comprehensive information. Let’s explore these areas thoroughly to get a complete understanding of what’s available!
    28	web search: 
    29	web search: site:jump.ai "AI Associate" "Ask" "client data" Jump
    30	**Looking into integrations**
    31	
    32	I’m trying to gather a complete list of integrations. I think just opening the integration page might help, but it feels like I need more specific details too. It's a bit overwhelming to ensure I capture everything! I want to make sure I have all the right options and features, so I don't miss anything important. Let's see if I can find a comprehensive breakdown of all available integrations to get a clear view.
    33	web search: 
    34	web search: https://jump.ai/integrations/
    35	web search: 
    36	web search: https://jump.ai/products/operate/document-intelligence
    37	web search: 
    38	web search: https://security.jump.ai/
    39	web search: 
    40	web search: security.jump.ai Jump SOC 2 HIPAA subprocessors AWS retention
    41	web search: 
    42	web search: https://help.jumpapp.com/en/articles/10055503-jump-security-and-data-privacy-faqs
    43	web search: 
    44	web search: Jump AI "AWS" "Iowa" "Jump" "financial advisors"
    45	web search: 
    46	web search: https://help.jumpapp.com/en/articles/12738978-using-ask-anything-in-jump-meetings
    47	web search: 
    48	web search: https://help.jumpapp.com/en/articles/12738978-using-ask-anything-in-jump-meetings
    49	web search: 
    50	web search: https://jump.ai/pricing
    51	**Searching for adoption info**
    52	
    53	I need to find information on independent adoption, and it looks like I should check the T3 survey and perhaps the Kitces report if it's available. Maybe I can search to see what the latest press coverage says. There seems to be a lot to explore here! Gathering more details will help ensure I have the most accurate and relevant information for what I need. Let’s see what I can uncover!
    54	web search: 
    55	web search: 2025 T3 Inside Information Software Survey Jump advisor AI market share satisfaction
    56	**Planning competitive analysis**
    57	
    58	I need to open Kitces April for a competitive analysis. It seems like an important step to evaluate the market. I’ll gather insights and data from this resource to get a clearer picture of how my competitors are performing. It’s all about understanding the landscape better and making informed decisions. I’m curious to see what interesting findings I might come across that could help shape my approach. Let’s dive into that!
    59	web search: 
    60	web search: https://www.kitces.com/blog/the-latest-in-financial-advisortech-april-2026-wealthbox-ai-agents-tools-jump-rightcapital-wealthstream/
    61	web search: 
    62	web search: https://jump.ai/products/meet/notetaker
    63	web search: 
    64	web search: https://jump.ai/products/meet/follow-up
    65	**Evaluating marketing strategies**
    66	
    67	I’m thinking about the differences between marketing and verification. WealthManagement reported a $27k based CEO/announcement, but there’s no independent audit available. The T3 survey user ratings are somewhat independent, which is good to note. I need to define my target customer category, focusing on financial advisors, RIAs, broker-dealers, and banks. The pricing model of $100/month per advisor seems reasonable. I also want to verify total funding and integration breadth for better adoption.
    68	codex
    69	Jump is not just selling “AI notes” anymore. The clearest public evidence says they are trying to own the whole advisor workflow around meetings, client records, prep, follow-ups, onboarding, and firm-level insights.
    70	**Citing funding sources**
    71	
    72	I need to find and cite the funding press and independent wealth management sources. I think it’s important to use exact URLs and maybe include citations from the web with titles. In the end, I could reference something like the "Jump Series B press release" with the URL. Also, I should note that the homepage mentions “35,000 advisors,” while a June 25 press release states “35,000 users worldwide.” It seems using "advisors" is best if I reference the homepage, but "users" is what I need for the June release.
    73	codex
    74	# Jump.ai Competitive Briefing
    75	
    76	## 1. What Jump Actually Is
    77	
    78	Jump is a **cloud AI workflow platform for financial advisors**, not just a notetaker anymore.
    79	
    80	Its core buyer is RIAs, broker-dealers, enterprise advisory firms, insurance/financial-services teams, and independent advisors. The product started around meeting admin, but now markets itself as an “AI operating system” for advisors.
    81	
    82	Core modules:
    83	
    84	- **AI Notetaker:** captures Zoom, Teams, Google Meet, Webex, phone, in-person, and mobile meetings; generates notes, tasks, emails, and CRM-ready outputs. Source: https://jump.ai/products/meet/notetaker
    85	- **Pre-meeting prep:** pulls from CRM, portfolio/custodian data, financial plans, tax records, emails, and past meetings into a cited briefing. This is more serious than basic meeting notes. Source: https://jump.ai/products/meet/pre-meeting-prep
    86	- **Post-meeting sync:** drafts CRM notes, tasks, and financial-planning updates, then waits for human review before syncing. Source: https://jump.ai/products/meet/post-meeting-data-sync
    87	- **Follow-up emails/tasks:** generates client recap emails and structured tasks matched to CRM fields. Source: https://jump.ai/products/meet/follow-up
    88	- **AI Associate:** assistant/agent layer that answers questions across Jump, CRMs, planning software, email, meetings, and tasks. It is “early access,” so treat it as live but still maturing. Source: https://help.jumpapp.com/en/articles/11824817-how-to-use-ai-associate
    89	- **Document Intelligence / Onboard:** document intake and structured extraction, mainly to turn uploaded documents into reviewable updates and downstream system sync. Source: https://jump.ai/products/onboard/document-intelligence
    90	
    91	## 2. Funding, Scale, Adoption
    92	
    93	Jump is well-funded and moving fast.
    94	
    95	Verified public claims:
    96	
    97	- **$80M Series B** announced February 20, 2026, led by Insight Partners.
    98	- **$105M total raised** after the Series B.
    99	- Investors include Insight Partners, F-Prime, Allianz Life Ventures, TIAA Ventures, Peterson Partners, Battery Ventures, Sorenson Capital, Pelion Venture Partners, Citi Ventures, plus angels Hans Tung, Ryan Anderson, and Aaron Skonnard.
   100	- February 2026 claim: **27,000+ advisors**, adding **2,000+ advisors/month**, nearly 1 in 10 U.S. advisors.
   101	- June 25, 2026 claim: **35,000+ users worldwide**.
   102	
   103	Sources:
   104	- Jump Series B release: https://jump.ai/press/series-b-announcement
   105	- WealthManagement.com coverage: https://www.wealthmanagement.com/artificial-intelligence/jump_secures_series_b
   106	- June 2026 Jump release: https://jump.ai/press/jump-unveils-new-ai-powered-account-opening-and-workflow-innovations-for-advisors
   107	
   108	Blunt read: the funding is real. The investor list is real. The usage numbers are still mostly **company-reported**, even when repeated by trade press. The strongest independent signal is not exact user count, but category recognition: Jump cites strong T3/Inside Information survey ratings, including 8.61 in transcription/text capture and 8.64 in onboarding/proposal generation. Source: https://jump.ai/blog/jumps-ai-powered-tools-take-top-honors-in-the-2025-t3-inside-information-software-survey
   109	
   110	## 3. Integrations Breadth
   111	
   112	This is one of Jump’s real strengths.
   113	
   114	They publicly list **39-40+ integrations** across CRM, planning, meetings, calendar, portfolio, custodian, estate, tax, document storage, VoIP, and workflow tools.
   115	
   116	Named examples:
   117	
   118	- **CRMs:** Salesforce, Redtail, Wealthbox, HubSpot, Dynamics 365, AdvisorEngine, Advyzon, XLR8, LeadCenter, Quivr, SmartOffice
   119	- **Planning:** eMoney, RightCapital
   120	- **Portfolio/custodian:** Black Diamond, Orion, Schwab
   121	- **Estate/tax:** Wealth.com, Holistiplan, TaxStatus
   122	- **Meetings/phone:** Zoom, Teams, Google Meet, Webex, GoTo, Dialpad, RingCentral, Intulse, Vonage
   123	- **Docs/calendar/email:** Google Drive, Box, Google Calendar, Microsoft Calendar, Exchange
   124	- **Workflow:** Karbon, Hubly
   125	
   126	Source: https://jump.ai/integrations/
   127	
   128	Blunt read: this is not shallow. The integrations are central to their moat. Keepance should assume Jump can keep expanding integration coverage quickly.
   129	
   130	## 4. Security / Compliance Posture
   131	
   132	Jump’s public posture is strong for normal enterprise SaaS, but it is still cloud SaaS.
   133	
   134	Publicly stated:
   135	
   136	- SOC 2 Type II audits.
   137	- Encryption in transit and at rest.
   138	- MFA.
   139	- Vanta monitoring.
   140	- Third-party penetration testing.
   141	- Data hosted on servers in the U.S., specifically Iowa.
   142	- No firm/client data used to train AI models.
   143	- Human review before AI outputs are synced, saved, or sent.
   144	- Configurable consent, disclosure, retention, redaction, downloads, and attestation controls.
   145	- Summary-only mode can avoid storing audio/video, but transcripts may still be generated temporarily to create outputs.
   146	- Zero-transcript retention disables some features like Ask Anything.
   147	
   148	Sources:
   149	- Security FAQ: https://help.jumpapp.com/en/articles/10055503-jump-security-and-data-privacy-faqs
   150	- Summary-only mode: https://help.jumpapp.com/en/articles/10209840-an-overview-of-summary-only-mode
   151	- Compliance settings: https://help.jumpapp.com/en/articles/11526343-compliance-settings
   152	- Auto-delete media/transcripts: https://help.jumpapp.com/en/articles/9072064-how-to-get-jump-to-automatically-delete-media-transcripts
   153	- Zero transcript retention: https://help.jumpapp.com/en/articles/12452440-tips-for-using-jump-with-zero-transcript-retention
   154	
   155	Caveat: Jump’s Trust Center page at `security.jump.ai` loaded with no readable text through my public fetch, likely because it is JavaScript/Vanta-gated. I relied on Jump’s public Help Center instead.
   156	
   157	## 5. Sharp Assessment
   158	
   159	Where Jump is genuinely deep:
   160	
   161	- **Advisor-specific workflow design.** It understands meetings, notes, tasks, CRM fields, planning updates, consent, attestations, and compliance review.
   162	- **Integrations.** This is their biggest practical advantage.
   163	- **Enterprise compliance controls.** Retention, consent, redaction, attestation, admin policy, and parent-child account restrictions are real buyer-facing controls.
   164	- **Distribution momentum.** Funding + enterprise logos + 35k user/advisor claims make them hard to dismiss.
   165	
   166	Where it is still marketing-heavy:
   167	
   168	- **“AI Operating System” is inflated language.** The real product is an advisor workflow layer around meetings, client data, and system updates.
   169	- **“Agentic” is constrained.** Public docs repeatedly show human review before actions. That is good for compliance, but it means this is not a fully autonomous associate.
   170	- **AI Associate is early access.** Jump’s own help doc says it is still rolling out and evolving.
   171	- **Chat/history maturity looks limited.** AI Associate help says chat history is “coming soon.”
   172	- **It is not a CRM.** Kitces bluntly notes Jump may be trying to become everything except the one thing advisors may actually want next: a better CRM. Source: https://www.kitces.com/blog/the-latest-in-financial-advisortech-april-2026-wealthbox-ai-agents-tools-jump-rightcapital-wealthstream/
   173	
   174	Weaknesses a smaller competitor could exploit:
   175	
   176	- **Cloud trust gap:** no public local-first, on-device, or customer-BYOK option found.
   177	- **Data-control gap:** “delete/retain” is not the same as “your data never leaves your machine.”
   178	- **Document-depth gap:** document intelligence appears focused on extraction, intake, and syncing fields, not deep legal/financial document reasoning across arbitrary folders.
   179	- **Advisor-tool dependency:** Jump’s strength is connected SaaS systems. A competitor can win where the truth lives in messy PDFs, Word docs, statements, emails, folders, exports, and private local archives.
   180	- **Enterprise drag:** Jump’s large-firm motion may make it slower or less attractive for privacy-obsessed solos/small firms who want control over every file and model call.
   181	
   182	## 6. Key Keepance Seams
   183	
   184	### Seam A: Cross-document synthesis
   185	
   186	This seam is **real, but narrower than hoped**.
   187	
   188	Jump already claims cross-source synthesis. Their pre-meeting prep page says it connects CRM, portfolio accounting, custodians, financial plans, tax records, emails, and past meetings into a structured, cited briefing. That directly overlaps with “client brief from many sources.”
   189	
   190	But public evidence suggests Jump’s **document** layer is more about extracting fields from uploaded paperwork and syncing updates, not building a private, cited knowledge base over a client’s entire document set.
   191	
   192	So:
   193	
   194	- If Keepance says “Jump is only meeting-notes-to-CRM,” that is false.
   195	- If Keepance says “Jump does not publicly prove deep, local, arbitrary cross-document synthesis across a whole client file room,” that is fair.
   196	- The strongest Keepance wedge is not just “synthesis.” It is **local-first cited synthesis over the messy full client record**, including documents that are not cleanly inside CRM/planning systems.
   197	
   198	### Seam B: Cloud-only / no local / no BYOK
   199	
   200	This seam looks **real and defensible based on public info**.
   201	
   202	Jump publicly describes cloud hosting in Iowa, cloud service providers, AI distributors, and secure infrastructure. I found no public local-first, on-device, offline, self-hosted, customer-held-key, or BYOK model option.
   203	
   204	Important nuance: Jump says it does not train models on customer data and supports strong retention controls. That reduces risk, but it does not equal Keepance’s stronger claim: client data can stay local and AI can be BYOK-direct.
   205	
   206	## Bottom Line
   207	
   208	Jump is a serious competitor. Do not frame them as a glorified notetaker. They are building a cloud workflow layer for advisors with strong integrations, compliance controls, and fast adoption.
   209	
   210	Keepance’s best honest positioning is:
   211	
   212	> Jump is excellent when an advisor wants cloud AI to automate meetings, prep, CRM updates, and follow-ups across an existing SaaS stack. Keepance should win when the buyer wants private, local-first, BYOK-controlled synthesis across the full client document record, with citations, without making a cloud AI platform the center of gravity.
   213	tokens used
   214	134,496
   215	# Jump.ai Competitive Briefing
   216	
   217	## 1. What Jump Actually Is
   218	
   219	Jump is a **cloud AI workflow platform for financial advisors**, not just a notetaker anymore.
   220	
   221	Its core buyer is RIAs, broker-dealers, enterprise advisory firms, insurance/financial-services teams, and independent advisors. The product started around meeting admin, but now markets itself as an “AI operating system” for advisors.
   222	
   223	Core modules:
   224	
   225	- **AI Notetaker:** captures Zoom, Teams, Google Meet, Webex, phone, in-person, and mobile meetings; generates notes, tasks, emails, and CRM-ready outputs. Source: https://jump.ai/products/meet/notetaker
   226	- **Pre-meeting prep:** pulls from CRM, portfolio/custodian data, financial plans, tax records, emails, and past meetings into a cited briefing. This is more serious than basic meeting notes. Source: https://jump.ai/products/meet/pre-meeting-prep
   227	- **Post-meeting sync:** drafts CRM notes, tasks, and financial-planning updates, then waits for human review before syncing. Source: https://jump.ai/products/meet/post-meeting-data-sync
   228	- **Follow-up emails/tasks:** generates client recap emails and structured tasks matched to CRM fields. Source: https://jump.ai/products/meet/follow-up
   229	- **AI Associate:** assistant/agent layer that answers questions across Jump, CRMs, planning software, email, meetings, and tasks. It is “early access,” so treat it as live but still maturing. Source: https://help.jumpapp.com/en/articles/11824817-how-to-use-ai-associate
   230	- **Document Intelligence / Onboard:** document intake and structured extraction, mainly to turn uploaded documents into reviewable updates and downstream system sync. Source: https://jump.ai/products/onboard/document-intelligence
   231	
   232	## 2. Funding, Scale, Adoption
   233	
   234	Jump is well-funded and moving fast.
   235	
   236	Verified public claims:
   237	
   238	- **$80M Series B** announced February 20, 2026, led by Insight Partners.
   239	- **$105M total raised** after the Series B.
   240	- Investors include Insight Partners, F-Prime, Allianz Life Ventures, TIAA Ventures, Peterson Partners, Battery Ventures, Sorenson Capital, Pelion Venture Partners, Citi Ventures, plus angels Hans Tung, Ryan Anderson, and Aaron Skonnard.
   241	- February 2026 claim: **27,000+ advisors**, adding **2,000+ advisors/month**, nearly 1 in 10 U.S. advisors.
   242	- June 25, 2026 claim: **35,000+ users worldwide**.
   243	
   244	Sources:
   245	- Jump Series B release: https://jump.ai/press/series-b-announcement
   246	- WealthManagement.com coverage: https://www.wealthmanagement.com/artificial-intelligence/jump_secures_series_b
   247	- June 2026 Jump release: https://jump.ai/press/jump-unveils-new-ai-powered-account-opening-and-workflow-innovations-for-advisors
   248	
   249	Blunt read: the funding is real. The investor list is real. The usage numbers are still mostly **company-reported**, even when repeated by trade press. The strongest independent signal is not exact user count, but category recognition: Jump cites strong T3/Inside Information survey ratings, including 8.61 in transcription/text capture and 8.64 in onboarding/proposal generation. Source: https://jump.ai/blog/jumps-ai-powered-tools-take-top-honors-in-the-2025-t3-inside-information-software-survey
   250	
   251	## 3. Integrations Breadth
   252	
   253	This is one of Jump’s real strengths.
   254	
   255	They publicly list **39-40+ integrations** across CRM, planning, meetings, calendar, portfolio, custodian, estate, tax, document storage, VoIP, and workflow tools.
   256	
   257	Named examples:
   258	
   259	- **CRMs:** Salesforce, Redtail, Wealthbox, HubSpot, Dynamics 365, AdvisorEngine, Advyzon, XLR8, LeadCenter, Quivr, SmartOffice
   260	- **Planning:** eMoney, RightCapital
   261	- **Portfolio/custodian:** Black Diamond, Orion, Schwab
   262	- **Estate/tax:** Wealth.com, Holistiplan, TaxStatus
   263	- **Meetings/phone:** Zoom, Teams, Google Meet, Webex, GoTo, Dialpad, RingCentral, Intulse, Vonage
   264	- **Docs/calendar/email:** Google Drive, Box, Google Calendar, Microsoft Calendar, Exchange
   265	- **Workflow:** Karbon, Hubly
   266	
   267	Source: https://jump.ai/integrations/
   268	
   269	Blunt read: this is not shallow. The integrations are central to their moat. Keepance should assume Jump can keep expanding integration coverage quickly.
   270	
   271	## 4. Security / Compliance Posture
   272	
   273	Jump’s public posture is strong for normal enterprise SaaS, but it is still cloud SaaS.
   274	
   275	Publicly stated:
   276	
   277	- SOC 2 Type II audits.
   278	- Encryption in transit and at rest.
   279	- MFA.
   280	- Vanta monitoring.
   281	- Third-party penetration testing.
   282	- Data hosted on servers in the U.S., specifically Iowa.
   283	- No firm/client data used to train AI models.
   284	- Human review before AI outputs are synced, saved, or sent.
   285	- Configurable consent, disclosure, retention, redaction, downloads, and attestation controls.
   286	- Summary-only mode can avoid storing audio/video, but transcripts may still be generated temporarily to create outputs.
   287	- Zero-transcript retention disables some features like Ask Anything.
   288	
   289	Sources:
   290	- Security FAQ: https://help.jumpapp.com/en/articles/10055503-jump-security-and-data-privacy-faqs
   291	- Summary-only mode: https://help.jumpapp.com/en/articles/10209840-an-overview-of-summary-only-mode
   292	- Compliance settings: https://help.jumpapp.com/en/articles/11526343-compliance-settings
   293	- Auto-delete media/transcripts: https://help.jumpapp.com/en/articles/9072064-how-to-get-jump-to-automatically-delete-media-transcripts
   294	- Zero transcript retention: https://help.jumpapp.com/en/articles/12452440-tips-for-using-jump-with-zero-transcript-retention
   295	
   296	Caveat: Jump’s Trust Center page at `security.jump.ai` loaded with no readable text through my public fetch, likely because it is JavaScript/Vanta-gated. I relied on Jump’s public Help Center instead.
   297	
   298	## 5. Sharp Assessment
   299	
   300	Where Jump is genuinely deep:
   301	
   302	- **Advisor-specific workflow design.** It understands meetings, notes, tasks, CRM fields, planning updates, consent, attestations, and compliance review.
   303	- **Integrations.** This is their biggest practical advantage.
   304	- **Enterprise compliance controls.** Retention, consent, redaction, attestation, admin policy, and parent-child account restrictions are real buyer-facing controls.
   305	- **Distribution momentum.** Funding + enterprise logos + 35k user/advisor claims make them hard to dismiss.
   306	
   307	Where it is still marketing-heavy:
   308	
   309	- **“AI Operating System” is inflated language.** The real product is an advisor workflow layer around meetings, client data, and system updates.
   310	- **“Agentic” is constrained.** Public docs repeatedly show human review before actions. That is good for compliance, but it means this is not a fully autonomous associate.
   311	- **AI Associate is early access.** Jump’s own help doc says it is still rolling out and evolving.
   312	- **Chat/history maturity looks limited.** AI Associate help says chat history is “coming soon.”
   313	- **It is not a CRM.** Kitces bluntly notes Jump may be trying to become everything except the one thing advisors may actually want next: a better CRM. Source: https://www.kitces.com/blog/the-latest-in-financial-advisortech-april-2026-wealthbox-ai-agents-tools-jump-rightcapital-wealthstream/
   314	
   315	Weaknesses a smaller competitor could exploit:
   316	
   317	- **Cloud trust gap:** no public local-first, on-device, or customer-BYOK option found.
   318	- **Data-control gap:** “delete/retain” is not the same as “your data never leaves your machine.”
   319	- **Document-depth gap:** document intelligence appears focused on extraction, intake, and syncing fields, not deep legal/financial document reasoning across arbitrary folders.
   320	- **Advisor-tool dependency:** Jump’s strength is connected SaaS systems. A competitor can win where the truth lives in messy PDFs, Word docs, statements, emails, folders, exports, and private local archives.
   321	- **Enterprise drag:** Jump’s large-firm motion may make it slower or less attractive for privacy-obsessed solos/small firms who want control over every file and model call.
   322	
   323	## 6. Key Keepance Seams
   324	
   325	### Seam A: Cross-document synthesis
   326	
   327	This seam is **real, but narrower than hoped**.
   328	
   329	Jump already claims cross-source synthesis. Their pre-meeting prep page says it connects CRM, portfolio accounting, custodians, financial plans, tax records, emails, and past meetings into a structured, cited briefing. That directly overlaps with “client brief from many sources.”
   330	
   331	But public evidence suggests Jump’s **document** layer is more about extracting fields from uploaded paperwork and syncing updates, not building a private, cited knowledge base over a client’s entire document set.
   332	
   333	So:
   334	
   335	- If Keepance says “Jump is only meeting-notes-to-CRM,” that is false.
   336	- If Keepance says “Jump does not publicly prove deep, local, arbitrary cross-document synthesis across a whole client file room,” that is fair.
   337	- The strongest Keepance wedge is not just “synthesis.” It is **local-first cited synthesis over the messy full client record**, including documents that are not cleanly inside CRM/planning systems.
   338	
   339	### Seam B: Cloud-only / no local / no BYOK
   340	
   341	This seam looks **real and defensible based on public info**.
   342	
   343	Jump publicly describes cloud hosting in Iowa, cloud service providers, AI distributors, and secure infrastructure. I found no public local-first, on-device, offline, self-hosted, customer-held-key, or BYOK model option.
   344	
   345	Important nuance: Jump says it does not train models on customer data and supports strong retention controls. That reduces risk, but it does not equal Keepance’s stronger claim: client data can stay local and AI can be BYOK-direct.
   346	
   347	## Bottom Line
   348	
   349	Jump is a serious competitor. Do not frame them as a glorified notetaker. They are building a cloud workflow layer for advisors with strong integrations, compliance controls, and fast adoption.
   350	
   351	Keepance’s best honest positioning is:
   352	
   353	> Jump is excellent when an advisor wants cloud AI to automate meetings, prep, CRM updates, and follow-ups across an existing SaaS stack. Keepance should win when the buyer wants private, local-first, BYOK-controlled synthesis across the full client document record, with citations, without making a cloud AI platform the center of gravity.

**Looking for report sections**

I’m trying to find out if I need to get the full specific line references for the report. It seems like I might be missing some relevant sections between lines 138 to 214. I'll need to check if those sections will provide the information I'm looking for. So, I’ll pay close attention to the line numbers to ensure I get everything I need.
codex
I have the main claims now. I’m checking the middle of the report because the feature comparison is where overclaims often hide.
exec
/bin/bash -lc "sed -n '138,214p' /home/jameson/kp-jump/competitive-analysis/jump-vs-keepance/jump_vs_keepance_competitive_report.md | nl -ba -v138" in /home/jameson/kp-jump
 succeeded in 0ms:
   138	## 6. Feature-by-feature comparison
   139	
   140	*Advantage = who wins that cell today for the target buyer. "Tie/unclear" flagged honestly.*
   141	
   142	| Capability | Jump status | Keepance current | Keepance planned | Advantage | Evidence | Strategic implication |
   143	|---|---|---|---|---|---|---|
   144	| Onboarding / time-to-value | Free trial, guided; but a whole platform to adopt | Point at a folder; **no migration** | Bundled local model | **Tie** (different friction) | /pricing; repo | Keepance "no migration" is a real wedge for the stack-light |
   145	| Connect AI / BYOK | No BYOK (Jump-managed cloud AI) | **BYOK-direct, OS keychain** | — | **Keepance** | redline.ts; Codex | The clean architectural seam |
   146	| Local / private storage | Cloud (US/Iowa) | **On-device** | Embedded model | **Keepance** | Codex; repo | "Never leaves your machine" — uncopyable for Jump |
   147	| Local-first desktop app | None | **Tauri desktop** | — | **Keepance** | repo | Different product shape entirely |
   148	| Cloud platform | **Mature, multi-surface** | Browser demo only | — | **Jump** | jump.ai | Jump wins anyone who wants cloud convenience |
   149	| Data import | 39 integrations | Files + OneDrive + email | More connectors | **Jump** | /integrations | Breadth race Keepance should sidestep, not enter |
   150	| File indexing / search | "Ask Anything" over **meetings** | **Semantic RAG over docs+email** | — | **Keepance** (for documents) | repo; help center | Keepance reads what Jump can't (the file room) |
   151	| Email ingestion | Inbox assistant (cloud) | **Local import + index (Outlook/Gmail/IMAP)** | — | **Keepance** (privacy) / **Jump** (drafting) | repo | Split: Keepance reads privately, Jump drafts |
   152	| CRM integration | **Deep, many** | Wealthbox + Salesforce | More | **Jump** | /integrations | Don't out-integrate Jump |
   153	| Meeting notes / transcription | **Owns it** | **None** | — | **Jump** | T3 | Do NOT build this; it's table-stakes Jump owns |
   154	| Unified client profile / "Client Map" | "Client Profiles" (meeting/CRM-sourced) | **Client Map (document/email-sourced), cited** | — | **Tie/unclear** | both | The collision point — differentiate on SOURCE (files vs meetings) + local |
   155	| Cited answers / source retrieval | **Yes (over meetings)** | **Yes (over docs+email)** | — | **Tie** | both | Citations are now table-stakes; not a differentiator alone |
   156	| Drafting / follow-up emails | **Strong** | Possible via Ask, not a focus | — | **Jump** | jump.ai | Jump owns meeting→email; not Keepance's fight |
   157	| **Word-native editing / AI redline** | **None** | **Real (tracked changes)** | — | **Keepance** | redline.ts | Uncontested capability — lean on it |
   158	| Workflow automation / task creation | **Strong (Signals/Playbooks)** | Workflow packs (templates) | Advisor pack depth | **Jump** | jump.ai | Jump's Grow is deeper; don't compete here |
   159	| Compliance / audit trail | **Enterprise-grade, SOC 2 II** | Local audit log; **no SOC 2** | SOC 2 on demand; 5-yr export | **Jump** | both | Fatal for firms; manageable for solos (self-CCO) |
   160	| Human-review posture | Yes | Yes (AI proposes, user decides) | — | **Tie** | both | Both conservative; neutral |
   161	| Consent / disclosure / retention | **Built-in** | Local by nature; export TBD | First-class export | **Jump** (features) / **Keepance** (by architecture) | both | Jump has the controls; Keepance has the architecture |
   162	| Firm / multi-user deployment | **Mature** | E2EE firm tier (built, unproven) | Hardening | **Jump** | both | Avoid firm deals early |
   163	| Integrations marketplace | **39** | ~2 polished | — | **Jump** | /integrations | Sidestep |
   164	| Pricing | $100–200/seat/mo | **$39–79/mo BYOK** | Test $150/mo | **Keepance** (cost) | both | Cheaper, but cost isn't a moat |
   165	| Target market fit | **Enterprise + independents** | Stack-light solo / privacy-bound | — | depends | both | Keepance must pick the slice Jump serves worst |
   166	| Time-to-value | Adopt a platform | Open a folder | — | **Keepance** | repo | Real for the document-heavy solo |
   167	| Trust posture | Certs + logos | **Architecture + design** | + entity/case study | **Tie/unclear** | both | Jump = "certified vendor"; Keepance = "nothing leaves" |
   168	| Sales motion | Self-serve + enterprise | Founder-led only | — | **Jump** | both | Jump's machine vs your one founder |
   169	| Demo quality | Polished, multi-surface | Strong design, pre-packaged installer pending | Clean Win build | **Jump** today | both | Fix the installer/demo before any advisor sees it |
   170	| Website clarity | Clear, single story | **Inconsistent (law vs advisor)** | Reconcile surfaces | **Jump** | repo | Fix immediately — trust product can't contradict itself |
   171	
   172	---
   173	
   174	## 7. Strategic overlap analysis
   175	
   176	**Now table-stakes because Jump has it (do NOT build/lead with these):**
   177	- Meeting capture/transcription, follow-up email drafting, CRM data sync, "cited answers," and even "a unified client profile / Ask-anything." **Citations and unified profiles are no longer differentiators** — Jump shouts them. Leading with "cited client intelligence" walks straight into Jump's strongest marketing.
   178	
   179	**Still genuinely differentiated (Jump cannot easily say these):**
   180	- **Local-first / private-by-architecture / BYOK-direct.** Architecturally opposed to Jump's cloud model — copying it would cannibalize Jump's business.
   181	- **Synthesis of the existing document + email pile** (the messy file room), not meetings/CRM. Jump's document layer is intake/extraction.
   182	- **Word-native authoring + tracked-change AI redline.** Jump has nothing here.
   183	- **No-CRM / no-meetings required.** Keepance works for someone with a folder and no stack; Jump's value compounds with the stack.
   184	
   185	**What Keepance should NOT build because Jump owns it:** meeting notetaking/transcription, a 39-integration marketplace, revenue-intelligence dashboards (Grow), account-opening/intake automation, and a cloud multi-surface platform. Every hour spent here is an hour lost to a $105M company that is already #1.
   186	
   187	**Jump capabilities that are strategically dangerous to Keepance:**
   188	- **"Client Profiles" + "AI Associate" with cited briefs** — they directly occupy Keepance's hero narrative. Most dangerous.
   189	- **Document Intelligence** — if Jump deepens it from intake → true folder synthesis, the document seam narrows. **Watch this closely.**
   190	- **Enterprise distribution** — not a feature, but it's why Jump wins regardless of feature parity.
   191	
   192	**Likely shallow marketing vs real depth:**
   193	- **Shallow/early:** "AI Operating System" language (it's a workflow layer); AI Associate (early-access, chat history "coming soon," no efficacy data); Grow add-on attach (analysts doubt advisors pay); "35,000 advisors" softened to "35,000 users."
   194	- **Real depth:** meeting capture, integrations, enterprise compliance, distribution. These are not bluffs.
   195	
   196	**Hard for Keepance to catch:** distribution, funding, integration breadth, meeting capture, brand. **Don't matter for Keepance's best beachhead:** meeting features, Grow dashboards, account-opening — irrelevant to a document-heavy, privacy-bound solo.
   197	
   198	---
   199	
   200	## 8. Segment-by-segment threat assessment
   201	
   202	| Segment | Jump threat | Why | Keepance opportunity / positioning |
   203	|---|---|---|---|
   204	| **Independent RIAs / advisors** | **High → existential (head-on)** | Jump's home field; ~10% penetration; enterprise + self-serve; owns the cited-brief narrative | Only via the **narrow** slice: privacy-bound or document-heavy, stack-light solos who won't put files in a cloud platform. Position **local + file-pile + authoring**, never "advisor AI" |
   205	| **Broker-dealers / IBD enterprises** | **Existential** | Jump's core distribution (LPL/Osaic/Cetera) | **Avoid.** Keepance has no SOC 2/DPA/entity; firm dictates the stack |
   206	| **Insurance professionals** | **High** | Jump explicitly targets them | Avoid unless a privacy-document niche appears |
   207	| **Tax / accounting pros** | **Med** | Jump integrates Holistiplan/TaxStatus + targets accounting; but Holistiplan owns tax-doc reading | Adjacent later; document-heavy + privacy-minded, but Holistiplan + Jump both present |
   208	| **Attorneys (solo/small)** | **Low (3/10)** | **Jump does not serve law at all** | **Real open door** — privilege = structural cloud-aversion; Word-native redline fits legal drafting. BUT legal-AI is its own crowded, well-capitalized space (Harvey $11B+). Low *Jump* threat ≠ easy market |
   209	| **Estate planning** | **Med** | Document-heavy = synthesis pain; Jump integrates Wealth.com | Niche; Vanilla/FP Alpha also present |
   210	| **Family law** | **Low (Jump)** | Not Jump's space | Document + privacy heavy; but consumer-grade tools + legal-AI compete |
   211	| **Consultants / other high-trust** | **Low (Jump)** | Not Jump's space | Possible local-first/document niches; unvalidated |
   212	
   213	**Pattern:** Jump's threat is **near-total inside the financial-advisor world** and **near-zero outside it**. The clean-air segments (attorneys, estate, consultants, document-heavy professionals) are exactly where Jump isn't — but they bring *other* competitors and remain unvalidated for Keepance. The lowest-Jump-threat path is **not necessarily the lowest-overall-threat path.**
   214	

**Evaluating objections to advisors**

I need to steelman the strongest objection: completely eliminate the advisor approach because the wedge is too narrow and unverified. Jump already connects with privacy-aware companies that have proper retention controls and compliance documentation. Plus, the local-first aspect isn’t a pressing issue. The document management problem can be handled by Jump or file-vault. So, I’m considering if I should focus on working with attorneys for 60 days instead of pursuing advisors at all.
codex
(A) FACTUAL ERRORS or OVERCLAIMS about Jump

- Lines 13, 34, 83, 204, 354: “~10% of all U.S. advisors,” “independent Kitces says,” “clear #1.” The Codex findings say the 27,000+/nearly-1-in-10 number is mostly company-reported and repeated by trade press, not independently audited. Raw lines 100-108 and 241-249 explicitly warn the usage numbers are mostly company-reported. The report states this too confidently.

- Lines 13, 34: “clear #1” / “Jump is winning.” Plausible, but not proven from the provided Codex findings. T3 ratings and adoption claims show strong momentum, not definitive category ownership across all advisor AI.

- Lines 18, 36, 150, 181: “Ask Anything is mostly over past meetings” / Jump reads “what Keepance can’t.” This understates Jump. Codex found Jump’s AI Associate claims access across Jump, CRMs, planning software, email, meetings, and tasks, and pre-meeting prep pulls CRM, portfolio/custodian, plans, tax, email, and past meetings. Raw lines 88-89, 188-190, 329-331. Safer claim: Jump has not publicly proven arbitrary local folder synthesis.

- Lines 36, 118, 157, 182, 293, 295: “Jump can’t do Word-native authoring / has none / can’t touch your documents.” Public evidence only supports “not publicly offered as a core capability.” “Can’t” is too absolute.

- Lines 80, 164, 313: pricing specifics including $75 small-firm, 20% annual savings, and price cut are not supported in the Codex findings provided. They may be true from other research, but in this review set they are unverified and should be footnoted or softened.

- Lines 82, 86: SOC 2/Iowa/security and staff count are treated as high-confidence. Codex explicitly caveats the trust center was unreadable and relied on Jump help docs. Raw lines 148-155, 289-296. Security posture should stay “Jump-stated, not independently inspected.”

- Lines 193: “35,000 advisors softened to 35,000 users.” Good catch, but the report elsewhere still says “35,000+ advisors/users” and line 13 leans on category ownership. Keep “users,” not “advisors,” unless citing a page that says advisors.

(B) Where the report is TOO SOFT or TOO HARSH on Keepance

- Too soft: Lines 129, 134, 332, 357 overstate Keepance’s “does today” strength. “Real, shipped v3.0” sounds market-ready, but the report also says there are zero paying users, inconsistent positioning, installer/demo gaps, and unproven real-file performance. That is not just polish debt; it is product-risk debt.

- Too soft: Lines 146, 180, 251 call local-first hard or “uncopyable.” It is hard for Jump’s current model, but not impossible. Jump could offer customer-managed encryption keys, private cloud, zero-retention modes, desktop sync, or enterprise-controlled storage without becoming truly local. Buyers may accept those substitutes.

- Too soft: Lines 134, 164 treat price as a Keepance advantage. In a compliance-heavy advisor market, lower price can signal “less vetted vendor,” not value. Jump at $100-200/mo may be easier to buy if it saves admin time and has firm approval.

- Too soft: Lines 162 and 281 mention E2EE firm tier as built/unproven or fake-demo, but the strategic recommendation still lets it linger. If it is unvalidated and Jump-irrelevant, it should be cut from near-term positioning entirely.

- Too harsh: Lines 196 and 205 may over-dismiss advisor-adjacent work. If Keepance truly has strong Word redline plus local document synthesis, there may be a wedge in estate planning, tax planning, or compliance documentation where advisors produce documents, not just attend meetings.

- Too harsh: Lines 259 and 357 call advisor build “label facade” and differentiation 5/10. If Word-native tracked changes and local document/email RAG really work, that is more than a label. The weak part is not feature uniqueness; it is proof, packaging, and distribution.

(C) LOGICAL GAPS in the KEY QUESTION answer

- The report jumps from “Jump owns advisor AI broadly” to “narrow + reposition inside advisors plus attorneys.” The stronger counter-argument is: kill the advisor angle entirely for now. Advisor buyers already have Jump, Zocks, FinMate, CRM vendors, planning tools, compliance workflows, and firm-approved stacks. Keepance’s wedge requires a tiny overlap: document-heavy, privacy-bound, stack-light, self-approving, willing to install desktop software, and dissatisfied with cloud tools. That may be too small.

- The report treats “cloud-only” as a structural weakness, but for many advisors cloud plus SOC 2 plus firm approval is the desired answer. Local-first may create new worries: backups, device loss, updates, support, retention, supervision, and “where is the official record?” The report names this risk but still builds the strategy around local as the spine.

- The report assumes “document pile” is a separate job from Jump. But Jump’s strongest direction is exactly pulling more systems into the advisor workflow. If arbitrary document synthesis matters, Jump, FutureVault, Wealthbox, Box/Google Drive AI, or planning platforms can move there faster than Keepance can build distribution.

- Steelman objection: “Compete head-on is fine because Jump is shallow” is weaker than “do not compete in advisors at all.” Jump is not shallow in the workflows advisors already pay for: meetings, CRM sync, compliance controls, integrations, and distribution. Keepance’s strongest features solve a different problem. That points away from advisor AI, not merely to narrower advisor copy.

(D) The single most important thing the report gets WRONG or MISSES

It treats Jump’s cloud-only architecture as Keepance’s strongest opening, but does not prove that enough buyers see cloud as a dealbreaker. For advisors, “cloud with SOC 2, retention controls, and firm approval” may beat “local desktop with fewer certifications” in actual buying. The decisive unknown is not whether Keepance is more private on paper. It is whether privacy-bound, document-heavy buyers exist in enough numbers and will pay despite weaker integrations, weaker compliance proof, and no distribution.
tokens used
60,089
(A) FACTUAL ERRORS or OVERCLAIMS about Jump

- Lines 13, 34, 83, 204, 354: “~10% of all U.S. advisors,” “independent Kitces says,” “clear #1.” The Codex findings say the 27,000+/nearly-1-in-10 number is mostly company-reported and repeated by trade press, not independently audited. Raw lines 100-108 and 241-249 explicitly warn the usage numbers are mostly company-reported. The report states this too confidently.

- Lines 13, 34: “clear #1” / “Jump is winning.” Plausible, but not proven from the provided Codex findings. T3 ratings and adoption claims show strong momentum, not definitive category ownership across all advisor AI.

- Lines 18, 36, 150, 181: “Ask Anything is mostly over past meetings” / Jump reads “what Keepance can’t.” This understates Jump. Codex found Jump’s AI Associate claims access across Jump, CRMs, planning software, email, meetings, and tasks, and pre-meeting prep pulls CRM, portfolio/custodian, plans, tax, email, and past meetings. Raw lines 88-89, 188-190, 329-331. Safer claim: Jump has not publicly proven arbitrary local folder synthesis.

- Lines 36, 118, 157, 182, 293, 295: “Jump can’t do Word-native authoring / has none / can’t touch your documents.” Public evidence only supports “not publicly offered as a core capability.” “Can’t” is too absolute.

- Lines 80, 164, 313: pricing specifics including $75 small-firm, 20% annual savings, and price cut are not supported in the Codex findings provided. They may be true from other research, but in this review set they are unverified and should be footnoted or softened.

- Lines 82, 86: SOC 2/Iowa/security and staff count are treated as high-confidence. Codex explicitly caveats the trust center was unreadable and relied on Jump help docs. Raw lines 148-155, 289-296. Security posture should stay “Jump-stated, not independently inspected.”

- Lines 193: “35,000 advisors softened to 35,000 users.” Good catch, but the report elsewhere still says “35,000+ advisors/users” and line 13 leans on category ownership. Keep “users,” not “advisors,” unless citing a page that says advisors.

(B) Where the report is TOO SOFT or TOO HARSH on Keepance

- Too soft: Lines 129, 134, 332, 357 overstate Keepance’s “does today” strength. “Real, shipped v3.0” sounds market-ready, but the report also says there are zero paying users, inconsistent positioning, installer/demo gaps, and unproven real-file performance. That is not just polish debt; it is product-risk debt.

- Too soft: Lines 146, 180, 251 call local-first hard or “uncopyable.” It is hard for Jump’s current model, but not impossible. Jump could offer customer-managed encryption keys, private cloud, zero-retention modes, desktop sync, or enterprise-controlled storage without becoming truly local. Buyers may accept those substitutes.

- Too soft: Lines 134, 164 treat price as a Keepance advantage. In a compliance-heavy advisor market, lower price can signal “less vetted vendor,” not value. Jump at $100-200/mo may be easier to buy if it saves admin time and has firm approval.

- Too soft: Lines 162 and 281 mention E2EE firm tier as built/unproven or fake-demo, but the strategic recommendation still lets it linger. If it is unvalidated and Jump-irrelevant, it should be cut from near-term positioning entirely.

- Too harsh: Lines 196 and 205 may over-dismiss advisor-adjacent work. If Keepance truly has strong Word redline plus local document synthesis, there may be a wedge in estate planning, tax planning, or compliance documentation where advisors produce documents, not just attend meetings.

- Too harsh: Lines 259 and 357 call advisor build “label facade” and differentiation 5/10. If Word-native tracked changes and local document/email RAG really work, that is more than a label. The weak part is not feature uniqueness; it is proof, packaging, and distribution.

(C) LOGICAL GAPS in the KEY QUESTION answer

- The report jumps from “Jump owns advisor AI broadly” to “narrow + reposition inside advisors plus attorneys.” The stronger counter-argument is: kill the advisor angle entirely for now. Advisor buyers already have Jump, Zocks, FinMate, CRM vendors, planning tools, compliance workflows, and firm-approved stacks. Keepance’s wedge requires a tiny overlap: document-heavy, privacy-bound, stack-light, self-approving, willing to install desktop software, and dissatisfied with cloud tools. That may be too small.

- The report treats “cloud-only” as a structural weakness, but for many advisors cloud plus SOC 2 plus firm approval is the desired answer. Local-first may create new worries: backups, device loss, updates, support, retention, supervision, and “where is the official record?” The report names this risk but still builds the strategy around local as the spine.

- The report assumes “document pile” is a separate job from Jump. But Jump’s strongest direction is exactly pulling more systems into the advisor workflow. If arbitrary document synthesis matters, Jump, FutureVault, Wealthbox, Box/Google Drive AI, or planning platforms can move there faster than Keepance can build distribution.

- Steelman objection: “Compete head-on is fine because Jump is shallow” is weaker than “do not compete in advisors at all.” Jump is not shallow in the workflows advisors already pay for: meetings, CRM sync, compliance controls, integrations, and distribution. Keepance’s strongest features solve a different problem. That points away from advisor AI, not merely to narrower advisor copy.

(D) The single most important thing the report gets WRONG or MISSES

It treats Jump’s cloud-only architecture as Keepance’s strongest opening, but does not prove that enough buyers see cloud as a dealbreaker. For advisors, “cloud with SOC 2, retention controls, and firm approval” may beat “local desktop with fewer certifications” in actual buying. The decisive unknown is not whether Keepance is more private on paper. It is whether privacy-bound, document-heavy buyers exist in enough numbers and will pay despite weaker integrations, weaker compliance proof, and no distribution.
