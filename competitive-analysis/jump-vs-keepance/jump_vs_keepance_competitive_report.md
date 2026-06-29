# Jump vs Keepance — Competitive Intelligence Report

*Prepared 2026-06-28 for Jameson (Board). Author: competitive-analysis worker session (Claude Opus 4.8), with an independent Codex (gpt-5.5) investigation run in parallel and two independent web-research passes. Internal & private. Brutally honest by design — this report defaults skeptical and does not reassure.*

> **Adversarial-review note.** A separate, independent Codex pass was instructed to attack this report (find overclaims, steelman the opposite call). Its critique is saved at `raw/codex_report_review.md` and has been folded in: language was softened where it outran the evidence (Jump's adoption count is mostly self-reported with Kitces as the one independent anchor; "Jump can't" became "no public capability"; "uncopyable" became "hard to copy, but cloud half-measures exist"), the strongest counter-argument (kill the advisor angle entirely) is steelmanned below, and the decisive unknown (does the paying buyer actually exist?) is elevated. The reviewer reached the **same** core call — narrow/reposition away from head-on advisor AI — and argued it should lean even harder toward the document/attorney wedge.

---

## THE KEY QUESTION (answered first, bluntly)

> **Should Keepance AVOID direct financial-advisor competition (because Jump may already own it) and reposition around a narrower wedge Jump does NOT own?**

**Mostly YES — with a precise correction to how you frame the wedge.**

Keepance should **stop trying to be "an AI assistant / client-intelligence platform for financial advisors."** That sentence is Jump's home field, and Jump owns it: it is the **most-adopted standalone advisor-AI tool** (Kitces' adoption survey puts it near ~10% of U.S. advisors — the one *independent* anchor; Jump's own "35,000+" headline is self-reported), $105M raised, enterprise distribution through LPL/Osaic/Cetera, 39 live integrations, SOC 2 Type II (Jump-stated), a 4.9-star app, and — critically — it already markets the exact thing you thought was your moat: a **cited, multi-source client brief** ("AI Associate… surfaces the answer with the source attached… synthesizes into a single coherent brief"). Head-on, that fight is near-unwinnable for an unfunded solo.

**But "avoid advisors entirely" is too strong, and "synthesis is our moat" is now wrong.** Jump has two genuine, hard-to-copy gaps:

1. **It is cloud-only.** No local-first, no on-device, no BYOK option exists anywhere in Jump's public footprint. Its data lives in its cloud (US/Iowa, Jump-stated). "We don't train on your data" and "you can set retention" is **not** the same promise as "your client files never leave your machine." *(Honest caveat: Jump could ship cloud half-measures — customer-held keys, a private-cloud / zero-retention tier — that many buyers accept as "private enough." True local is hard for Jump to copy because it fights its cloud business model, not because it's impossible.)*
2. **Its synthesis spans connected systems, not an arbitrary local file room.** Jump's cited briefs really do pull from CRM, planning, custodian, portfolio, email, and meetings (broader than "just notes" — don't understate this). What it has **not** publicly shown is synthesis over a messy folder of documents and emails that *isn't already wired into those systems*; its document feature is **intake/extraction/form-filling** (account opening), not a cited knowledge base over a client's whole file pile. That specific job is Keepance's opening.

So the move is **NARROW + REPOSITION**, not "compete directly" and not "abandon the space." Reposition Keepance from *"advisor AI assistant"* (Jump's category) to **"the private place your client documents live and answer you back — on your own machine, without putting another cloud platform at the center of your practice."** Lead with the three things Jump genuinely lacks: **(a) local-first / private-by-architecture, (b) synthesis of the existing document + email pile (not meetings), (c) Word-native drafting with tracked-change AI redline.** Sell it to the narrow buyer for whom a cloud AI platform is a non-starter or who is **document-heavy rather than meeting-heavy** — and keep **attorneys** alive as a parallel option, because legal privilege is a real, structural reason to refuse the cloud (Jump does not serve law at all).

**This sharpens the 2026-06-28 strategic memo and corrects one thing in it.** The memo said: don't fight notetakers, win on "synthesis + local." Correct on "local." **But "synthesis" is no longer an open field** — Jump says it loudly, is #1, and is racing up-market into exactly that language. Keepance must **not lead with "synthesis" or "client intelligence" generically**; those are Jump's words now. Lead with **local + document-pile + authoring**, the parts Jump cannot easily say.

**The strongest objection (steelmanned), and why the call still holds.** The hardest counter is not "compete head-on" (that's clearly wrong — Jump is *not* shallow in the workflows advisors already pay for). The hardest counter is **"kill the advisor angle entirely, now."** The argument: Keepance's wedge requires a *stack* of conditions to all be true at once — document-heavy AND privacy-bound AND stack-light AND self-approving (own CCO) AND willing to install desktop software AND already dissatisfied with cloud tools. That intersection may be too small to be a business, and meanwhile cloud-plus-SOC-2-plus-firm-approval is the answer *most* advisors actually want — with local-first bringing its **own** new objections (backups, device loss, "where's the official record of supervision?", update/support burden). This objection is strong, and the report concedes it: that is precisely why the recommendation is **narrow + TEST, not narrow + build** — and why **attorneys are kept as a co-equal parallel wedge, not an afterthought** (the reviewer's push is to lean *harder* toward law/document work, where Jump is absent and the privilege driver is structural rather than a preference). If the advisor-slice discovery comes back as polite-but-no-urgency, the answer is **not** a sixth pivot; it is **attorneys-only, or park**, exactly as the strategy memo's kill-criteria say.

**The decisive unknown (the one thing this whole report turns on).** This analysis proves Keepance is *more private and more document-native on paper*. It does **not** prove the buyer exists. The single question that decides everything is: **do privacy-bound, document-heavy professionals exist in paying numbers, and will they buy despite Keepance's weaker integrations, weaker compliance proof, and zero distribution?** "Local-first" is the spine of the repositioning *only if* that buyer is real — and that is unproven. Treat the entire "reposition onto local + documents" thesis as a **hypothesis to be killed or confirmed by the 60-day demand test**, not a settled conclusion. The report tells you where to aim; the market, not this document, decides if the corner is worth standing in.

**Scores (detail + justification at the end):** Jump threat overall **8/10**; threat if Keepance targets advisors **9/10**; threat if Keepance targets attorneys **3/10**; Keepance differentiation today **5/10**; differentiation potential **7/10**; urgency to reposition **8/10**; confidence in analysis **7/10**.

---

## 1. Executive summary (plain language)

Here's the whole thing in everyday words.

**Jump is a real, well-funded competitor — not a toy, and not "just a meeting-notes app" anymore.** A company called Jump (jump.ai, based in Salt Lake City, the same area as you) makes AI software for financial advisors. It started by taking notes during client meetings. Now it does a lot more: it preps the advisor before a meeting, writes the follow-up emails, updates the advisor's contact system, and has an "assistant" you can ask questions like *"what's the Hendersons' asset allocation?"* and it answers **with a link to where it found the answer.** That last part is almost exactly what your "Client Map" and "Ask" features do. So the thing you thought was uniquely yours, Jump already advertises.

**Jump is winning.** An independent industry researcher (Kitces) says about **1 in 10 U.S. financial advisors** already use Jump — making it the most-adopted standalone tool of its kind. (Jump's own bigger "35,000+" number is self-reported, so lean on the Kitces figure.) It has raised about **$105 million**, big firms (LPL, Cetera, Osaic) push it to tens of thousands of their advisors, and its phone app has a **4.9-star rating**. That's a freight train. Trying to beat it head-on at "AI for advisors" would be like opening a coffee shop across the street from a beloved Starbucks that the whole town already loves.

**But Jump has two real soft spots you can stand in.** First, **everything Jump does lives in Jump's cloud.** There is no version where your files stay on your own computer. Keepance's whole design — files and AI key never leave your machine — is the opposite, and Jump can't easily copy it without undercutting its own cloud business (though it could meet buyers part-way with things like letting them hold the keys). Second, **Jump's "reading" pulls from meetings and the apps it's connected to (CRM, planning, email), but not from a loose pile of documents on your computer.** When it handles documents, it's mostly to fill out account-opening forms, not to read a client's whole folder of plans, statements, and old emails and tell you what's in there. Keepance does exactly that, on your machine, with citations. Plus Keepance can actually **write and edit Word documents** (tracked changes) — Jump doesn't offer that at all.

**So the honest recommendation:** don't fight Jump as "AI for advisors." Re-aim Keepance as **"the private place your client documents live and answer you back, on your own computer"** — and sell it to the small slice of people who either *can't* put client data in someone else's cloud, or who are drowning in documents rather than meetings. Keep the door open to **lawyers** too, because their privacy rules give them a real reason to refuse the cloud, and Jump doesn't serve lawyers at all. And before you show this to a single advisor, fix the embarrassing problem that your own website and checkout still say "law practice" in places — a trust product can't contradict itself.

**The catch (don't skip this):** even your two soft spots are *narrow*. "I want it to stay on my machine" is a comfort most advisors will nod at but few will switch for. "I have a document pile, not meetings" describes some advisors, not most. So this isn't "you found a safe corner" — it's "you found a *small* corner, and you still have to prove anyone will pay to stand in it." The 60-day demand test in the strategic memo is still the right next move. This analysis tells you **how to aim** that test, not that you can skip it.

---

## 2. Source coverage, method & limitations

**Date/time of research:** 2026-06-28 (US). **Robots.txt:** `jump.ai/robots.txt` allows general crawling (`Allow: /`), disallowing only three partner landing paths (`/lpl`, `/sei`, `/osaic`). We respected that. No auth, paywall, CAPTCHA, or bot-protection was bypassed.

**What we crawled directly (WebFetch + curl status + Chrome screenshots):** homepage, `/pricing`, `/integrations`, `/tour`, `/operating-system/ai-associate`, `/blog/security-and-compliance`, `/advisor-trends/artificial-intelligence/jump-vs-zocks`, `/blog/introducing-AI-associate`, `/blog/jump-unveils-new-ai-powered-account-opening…` (June 2026), `/blog/updates-may-2026`, `/company`. We status-checked ~28 key URLs (all returned **200**) and pulled the full sitemap (~135 URLs). See `jump_page_inventory.csv` for the full discovered set and `jump_claims_extracted.json` for structured claims.

**Independent corroboration:** two separate web-research passes (funding/company; reviews/competitors) and one **independent Codex (gpt-5.5) investigation** that reached the **same** strategic conclusion via different sources (Jump help center, Kitces, WealthManagement.com, investor sites). Raw outputs saved under `competitive-analysis/jump-vs-keepance/raw/`.

**Screenshots captured:** homepage, pricing, integrations, tour, AI Associate, company, security-and-compliance (`jump_screenshots/01–07`).

**Discovered-but-not-fully-readable / blocked / failed (stated honestly):**
- **`security.jump.ai` (Jump's trust center) is JavaScript/Vanta-gated** — returned only a title via public fetch. SOC 2 Type II, Iowa hosting, Vanta, and pen-testing facts therefore come from Jump's **help-center FAQ** and the **jump-vs-zocks** page, **not** the gated portal. Treat them as Jump-stated, lightly corroborated.
- **Reddit (r/CFP, r/financialplanning) hard-blocked** automated access (400/refused). **G2 / Capterra star counts were not directly retrievable.** Both need a **manual logged-in pass** for real unfiltered advisor sentiment.
- **T3 Inside Information survey primary + some head-to-head comparison tables are paywalled.** Numbers cited (market share 22.68%, T3 scores 8.61/8.64, Ezra 8.63) originate with Jump or gated reports.
- One blog slug (`jump-expands-ai-operating-system…`) **404'd**; the live equivalent is the June 25 account-opening release.

**Assumptions made:** sitemap URLs not individually re-checked are assumed 200 (they're in Jump's live sitemap). Jump's adoption numbers are treated as **self-reported** unless a third party (Kitces/App Store) corroborates.

**Manual-verify list for Jameson (highest value first):**
1. Jump **churn / retention** and **add-on (Grow/Onboard) attach rate** — the single most important missing numbers; both non-public.
2. Real **Reddit / G2 / Capterra** advisor sentiment (logged-in).
3. Whether Jump's "Ask Anything / Client Profile" can, in a live demo, **read a folder of arbitrary PDFs/statements** and synthesize them (vs only meetings/CRM). Book a Jump demo and ask directly.
4. Jump's **actual SOC 2 report + sub-processor list** (request via security.jump.ai portal).

---

## 3. What Jump appears to be

| Dimension | Finding | Confidence |
|---|---|---|
| **Category** | A **cloud "AI operating system / workflow platform for financial advisors."** Started as a meeting notetaker; now spans prep → meeting → follow-up → CRM sync → onboarding → firm-level revenue intelligence. | High |
| **Target customer** | RIAs, enterprise broker-dealers/IBDs, independent advisors; also insurance, accounting, asset managers, banks. **Real center of gravity = enterprise advisor networks** (LPL/Osaic/Cetera) + independents via self-serve free trial. | High |
| **Buyer** | Enterprise: the firm/BD's tech committee (top-down rollout). Independent: the advisor themselves (bottom-up, $100/mo free trial). | High |
| **Core pain solved** | Time lost to meeting admin, manual notes, CRM data entry; scattered client data; missed growth opportunities. | High |
| **Promise** | "Save time, increase revenue, elevate the client experience with compliant AI." "10 hrs saved/advisor/week." | High (claim) |
| **Modules** | **Operating System** (AI Associate, Client Profiles, Email Assistant, 39 integrations) · **Meet** (notetaker, pre-meeting prep, post-meeting CRM sync, follow-up, scheduling) · **Grow** (Signals, Playbooks, Scorecards, Dashboards, revenue intelligence) · **Onboard** (AI intake forms, Document Intelligence, account opening). | High |
| **Pricing** | **Meet $100/advisor/mo** (core; cut from $120, $75 for small firms) **+ Onboard $50 + Grow $50**; Enterprise = contact sales. Annual saves ~20%. Free trial. Fully-loaded ≈ $200/seat/mo. | High |
| **Platform** | Cloud SaaS + web + iOS + Outlook add-in + embedded-in-Redtail. **No desktop-local / on-device / self-hosted option.** | High |
| **Security posture** | SOC 2 Type II, encryption in transit/at rest, MFA, Vanta monitoring, pen-tested, **US/Iowa hosting**, **no training on customer data**, human-review-before-actions, configurable retention/consent/redaction/attestation. | Med-High (help-center sourced; portal gated) |
| **Social proof** | "35,000+ advisors/users" (self-reported; was 27,000+ Feb 2026); Kitces ~10% of US advisors (**independent**); App Store **4.9/5 (~1,100)**; 2025 T3 top honors; LPL/Osaic/Cetera logos. | High (mixed: some independent) |
| **Integrations** | ~39 across CRM, planning, portfolio, custodian (only Schwab), meeting/VoIP, calendar, tax, estate, doc storage, workflow. | High |
| **Compliance** | Explicitly RIA + broker-dealer compliance workflows; attestation, supervision, disclosure/consent. | High |
| **Funding/scale** | ~**$105M** total ($4.6M seed → $20M A/Battery 2025 → **$80M B/Insight Partners Feb 2026**); ~220-230 staff; Salt Lake City; CEO **Parker Ence**; acquired Mobile Assistant (Oct 2025). No valuation disclosed. | High (trade press + investors) |

---

## 4. Jump capability map

*Legend: **M** = marketing-only claim · **3P** = third-party-verified · conf = high/med/low.*

| Capability | Jump status | Evidence (URL) | Quote / note | Verify | Conf |
|---|---|---|---|---|---|
| Meeting prep (auto brief) | **Strong, core** | jump.ai/tour, /pricing | "Auto-generated meeting brief," pulls CRM/portfolio/plans/tax/email/past-meetings into a **cited** briefing | M (heavily used 3P) | High |
| Meeting capture / transcription | **Owns it** | T3 survey 8.61 | Zoom/Teams/Meet/Webex/phone/in-person/mobile | 3P | High |
| Note accuracy / reliability | **Good but imperfect** | XYPN review; advisor complaints | "Dropped recordings… failure rate unacceptable"; XYPN note-accuracy 3.5/5 (below FinMate) | 3P | Med |
| CRM sync (Wealthbox/Redtail/Salesforce…) | **Strong, core** | /integrations | Post-meeting structured data → CRM, human-approved | M (3P breadth) | High |
| Email drafting / assistant | **Strong** | homepage, /tour | "Faster drafting and rewrites, right in your inbox"; auto follow-up emails | M | High |
| Task creation | **Strong** | /pricing | Follow-up action items auto-generated, matched to CRM fields | M | High |
| **Client intelligence (unified profile)** | **Claimed strong** | homepage, /tour | "**Evergreen client profiles that pull data across all data sources**" | M | High |
| **AI search across client data (cited)** | **Claimed strong** | /operating-system/ai-associate | "reads your transcripts and meeting notes and **surfaces the answer with the source attached**"; ex: "Which clients over 60 don't have a beneficiary on file?" | M | High |
| **Cross-DOCUMENT synthesis (arbitrary folder)** | **Shallow / not proven** | /blog/…account-opening; Codex | Document Intelligence = "upload, parse, and sync" = **intake/form-filling**, not deep folder reasoning | M (gap) | Med-High |
| Doc intelligence (intake/account-opening) | **Real** | Onboard add-on | Field extraction → forms → CRM | M | High |
| Planning + portfolio integration | **Real** | /integrations | eMoney, RightCapital, Orion, Black Diamond | 3P | High |
| Custodian integration | **Thin** | /integrations | **Only Schwab** is a true custodian; others are BDs/IBDs | 3P | High |
| Book-of-business intelligence (Grow) | **Claimed** | /tour, jump-vs-zocks | Signals: held-away assets, consolidation, referral intent, sentiment | M (attach rate unproven) | Med |
| Compliance review / supervision | **Real, enterprise-grade** | /blog/security-and-compliance | Attestation, supervision, disclosure/consent, redaction | M (3P logos) | High |
| Retention controls | **Real** | help center | Summary-only, auto-delete, zero-transcript-retention | M | Med-High |
| Human review before action | **Real (constrains autonomy)** | /operating-system/ai-associate | "Every action requires your approval" | M | High |
| Audit trail | **Real** | homepage | "Enterprise-grade audit trails" | M | Med |
| Agentic "AI Associate" | **Live but early-access** | help.jumpapp.com | Acts across CRM/email/planning/tasks; **chat history "coming soon"**; no efficacy data | M (immature) | Med |
| Admin / firm config | **Real** | /pricing Enterprise | SSO, SCIM/SAML, compliance dashboard | M | High |
| ROI dashboards | **Claimed** | Grow | Dashboards/Scorecards | M | Med |
| Mobile | **Real, expanding** | /blog/updates-may-2026 | AI Associate + Contacts on iOS | M | High |
| Enterprise deployment | **Strong (the real moat)** | Series B; Cetera/LPL | Top-down BD/IBD rollout | 3P | High |
| **Document AUTHORING / editing (Word redline)** | **Absent** | — | Jump moves data; it does not write/edit documents | — (gap) | High |
| **Local-first / on-device / BYOK** | **Absent** | Codex; site | No local/self-hosted/customer-key option found anywhere | — (gap) | High |

---

## 5. Keepance capability map

*(Grounded in the repo at `/home/jameson/kp-jump`; full detail in `keepance_current_state.md`.)*

| Capability | Keepance status |
|---|---|
| **Does today (real, shipped v3.0)** | Client Map (cited per-client brief built from the **local document/email pile**); Ask (cited Q&A over docs+email); Workflows (profession packs); **Word-native OOXML editing + tracked-change AI redline**; email intelligence (Outlook/Gmail/IMAP, encrypted, indexed); local RAG (LanceDB + e5-small); **BYOK-direct** (keys in OS keychain, no Keepance content server); Ollama local-model support; OneDrive + Wealthbox connectors. |
| **Claims (true but with an asterisk)** | "Private" = fully true only in **local-model (Ollama)** mode; in BYOK-cloud mode the query still goes to the user's chosen AI provider (never to a Keepance server). Must be sold as "far less to vet," not "nothing leaves." |
| **Intends (planned, not built)** | Embedded/bundled local model; SOC 2 + DPA; formed legal entity; deeper advisor workflow pack; firm-tier hardening; 5-yr audit/retention export. |
| **Not yet / weak** | ~2 polished connectors only (vs Jump's 39); **no meeting capture/transcription at all**; **no CRM-grade integrations breadth**; no mobile; **zero outside/paying users**; positioning drift (law copy still on checkout + repo homepage). |
| **Weaker than Jump** | Distribution (none vs LPL/Osaic/Cetera); funding; integration breadth; brand/awards; meeting capture; enterprise compliance certs (no SOC 2); reliability proof at scale; sales motion. |
| **Stronger than Jump** | **Local-first / private-by-architecture / BYOK**; **synthesis of an existing document+email pile** (not meetings/CRM); **Word-native authoring + AI redline** (Jump has none); **no-CRM-required** (works for a stack-light solo); **price** (BYOK ~$39–79/mo vs Jump $100–200); single-buyer self-approval (solo = own CCO). |

---

## 6. Feature-by-feature comparison

*Advantage = who wins that cell today for the target buyer. "Tie/unclear" flagged honestly.*

| Capability | Jump status | Keepance current | Keepance planned | Advantage | Evidence | Strategic implication |
|---|---|---|---|---|---|---|
| Onboarding / time-to-value | Free trial, guided; but a whole platform to adopt | Point at a folder; **no migration** | Bundled local model | **Tie** (different friction) | /pricing; repo | Keepance "no migration" is a real wedge for the stack-light |
| Connect AI / BYOK | No BYOK (Jump-managed cloud AI) | **BYOK-direct, OS keychain** | — | **Keepance** | redline.ts; Codex | The clean architectural seam |
| Local / private storage | Cloud (US/Iowa) | **On-device** | Embedded model | **Keepance** | Codex; repo | "Never leaves your machine" — hard for Jump to match without abandoning its cloud model (could offer half-measures) |
| Local-first desktop app | None | **Tauri desktop** | — | **Keepance** | repo | Different product shape entirely |
| Cloud platform | **Mature, multi-surface** | Browser demo only | — | **Jump** | jump.ai | Jump wins anyone who wants cloud convenience |
| Data import | 39 integrations | Files + OneDrive + email | More connectors | **Jump** | /integrations | Breadth race Keepance should sidestep, not enter |
| File indexing / search | "Ask Anything" over **meetings** | **Semantic RAG over docs+email** | — | **Keepance** (for documents) | repo; help center | Keepance reads what Jump can't (the file room) |
| Email ingestion | Inbox assistant (cloud) | **Local import + index (Outlook/Gmail/IMAP)** | — | **Keepance** (privacy) / **Jump** (drafting) | repo | Split: Keepance reads privately, Jump drafts |
| CRM integration | **Deep, many** | Wealthbox + Salesforce | More | **Jump** | /integrations | Don't out-integrate Jump |
| Meeting notes / transcription | **Owns it** | **None** | — | **Jump** | T3 | Do NOT build this; it's table-stakes Jump owns |
| Unified client profile / "Client Map" | "Client Profiles" (meeting/CRM-sourced) | **Client Map (document/email-sourced), cited** | — | **Tie/unclear** | both | The collision point — differentiate on SOURCE (files vs meetings) + local |
| Cited answers / source retrieval | **Yes (over meetings)** | **Yes (over docs+email)** | — | **Tie** | both | Citations are now table-stakes; not a differentiator alone |
| Drafting / follow-up emails | **Strong** | Possible via Ask, not a focus | — | **Jump** | jump.ai | Jump owns meeting→email; not Keepance's fight |
| **Word-native editing / AI redline** | **Absent (no public capability)** | **Real (tracked changes)** | — | **Keepance** | redline.ts | Uncontested today — lean on it (watch Jump's Outlook add-in as a toe in the water) |
| Workflow automation / task creation | **Strong (Signals/Playbooks)** | Workflow packs (templates) | Advisor pack depth | **Jump** | jump.ai | Jump's Grow is deeper; don't compete here |
| Compliance / audit trail | **Enterprise-grade, SOC 2 II** | Local audit log; **no SOC 2** | SOC 2 on demand; 5-yr export | **Jump** | both | Fatal for firms; manageable for solos (self-CCO) |
| Human-review posture | Yes | Yes (AI proposes, user decides) | — | **Tie** | both | Both conservative; neutral |
| Consent / disclosure / retention | **Built-in** | Local by nature; export TBD | First-class export | **Jump** (features) / **Keepance** (by architecture) | both | Jump has the controls; Keepance has the architecture |
| Firm / multi-user deployment | **Mature** | E2EE firm tier (built, unproven) | Hardening | **Jump** | both | Avoid firm deals early |
| Integrations marketplace | **39** | ~2 polished | — | **Jump** | /integrations | Sidestep |
| Pricing | $100–200/seat/mo | **$39–79/mo BYOK** | Test $150/mo | **Keepance** (cost) | both | Cheaper, but cost isn't a moat |
| Target market fit | **Enterprise + independents** | Stack-light solo / privacy-bound | — | depends | both | Keepance must pick the slice Jump serves worst |
| Time-to-value | Adopt a platform | Open a folder | — | **Keepance** | repo | Real for the document-heavy solo |
| Trust posture | Certs + logos | **Architecture + design** | + entity/case study | **Tie/unclear** | both | Jump = "certified vendor"; Keepance = "nothing leaves" |
| Sales motion | Self-serve + enterprise | Founder-led only | — | **Jump** | both | Jump's machine vs your one founder |
| Demo quality | Polished, multi-surface | Strong design, pre-packaged installer pending | Clean Win build | **Jump** today | both | Fix the installer/demo before any advisor sees it |
| Website clarity | Clear, single story | **Inconsistent (law vs advisor)** | Reconcile surfaces | **Jump** | repo | Fix immediately — trust product can't contradict itself |

---

## 7. Strategic overlap analysis

**Now table-stakes because Jump has it (do NOT build/lead with these):**
- Meeting capture/transcription, follow-up email drafting, CRM data sync, "cited answers," and even "a unified client profile / Ask-anything." **Citations and unified profiles are no longer differentiators** — Jump shouts them. Leading with "cited client intelligence" walks straight into Jump's strongest marketing.

**Still genuinely differentiated (Jump cannot easily say these):**
- **Local-first / private-by-architecture / BYOK-direct.** Architecturally opposed to Jump's cloud model — copying it would cannibalize Jump's business.
- **Synthesis of the existing document + email pile** (the messy file room), not meetings/CRM. Jump's document layer is intake/extraction.
- **Word-native authoring + tracked-change AI redline.** Jump has nothing here.
- **No-CRM / no-meetings required.** Keepance works for someone with a folder and no stack; Jump's value compounds with the stack.

**What Keepance should NOT build because Jump owns it:** meeting notetaking/transcription, a 39-integration marketplace, revenue-intelligence dashboards (Grow), account-opening/intake automation, and a cloud multi-surface platform. Every hour spent here is an hour lost to a $105M company that is already #1.

**Jump capabilities that are strategically dangerous to Keepance:**
- **"Client Profiles" + "AI Associate" with cited briefs** — they directly occupy Keepance's hero narrative. Most dangerous.
- **Document Intelligence** — if Jump deepens it from intake → true folder synthesis, the document seam narrows. **Watch this closely.**
- **Enterprise distribution** — not a feature, but it's why Jump wins regardless of feature parity.

**Likely shallow marketing vs real depth:**
- **Shallow/early:** "AI Operating System" language (it's a workflow layer); AI Associate (early-access, chat history "coming soon," no efficacy data); Grow add-on attach (analysts doubt advisors pay); "35,000 advisors" softened to "35,000 users."
- **Real depth:** meeting capture, integrations, enterprise compliance, distribution. These are not bluffs.

**Hard for Keepance to catch:** distribution, funding, integration breadth, meeting capture, brand. **Don't matter for Keepance's best beachhead:** meeting features, Grow dashboards, account-opening — irrelevant to a document-heavy, privacy-bound solo.

---

## 8. Segment-by-segment threat assessment

| Segment | Jump threat | Why | Keepance opportunity / positioning |
|---|---|---|---|
| **Independent RIAs / advisors** | **High → existential (head-on)** | Jump's home field; ~10% penetration; enterprise + self-serve; owns the cited-brief narrative | Only via the **narrow** slice: privacy-bound or document-heavy, stack-light solos who won't put files in a cloud platform. Position **local + file-pile + authoring**, never "advisor AI" |
| **Broker-dealers / IBD enterprises** | **Existential** | Jump's core distribution (LPL/Osaic/Cetera) | **Avoid.** Keepance has no SOC 2/DPA/entity; firm dictates the stack |
| **Insurance professionals** | **High** | Jump explicitly targets them | Avoid unless a privacy-document niche appears |
| **Tax / accounting pros** | **Med** | Jump integrates Holistiplan/TaxStatus + targets accounting; but Holistiplan owns tax-doc reading | Adjacent later; document-heavy + privacy-minded, but Holistiplan + Jump both present |
| **Attorneys (solo/small)** | **Low (3/10)** | **Jump does not serve law at all** | **Real open door** — privilege = structural cloud-aversion; Word-native redline fits legal drafting. BUT legal-AI is its own crowded, well-capitalized space (Harvey $11B+). Low *Jump* threat ≠ easy market |
| **Estate planning** | **Med** | Document-heavy = synthesis pain; Jump integrates Wealth.com | Niche; Vanilla/FP Alpha also present |
| **Family law** | **Low (Jump)** | Not Jump's space | Document + privacy heavy; but consumer-grade tools + legal-AI compete |
| **Consultants / other high-trust** | **Low (Jump)** | Not Jump's space | Possible local-first/document niches; unvalidated |

**Pattern:** Jump's threat is **near-total inside the financial-advisor world** and **near-zero outside it**. The clean-air segments (attorneys, estate, consultants, document-heavy professionals) are exactly where Jump isn't — but they bring *other* competitors and remain unvalidated for Keepance. The lowest-Jump-threat path is **not necessarily the lowest-overall-threat path.**

---

## 9. Positioning analysis

**Head-to-head positioning (Jump vs Keepance):**

| Axis | Jump | Keepance (today) | Keepance (recommended) |
|---|---|---|---|
| Headline | "The #1 AI platform for advisors!" | (drifting: law vs advisor) | "Walk into every meeting already knowing the whole household — on your own machine." |
| Category | AI operating system for advisors | "private intelligence layer" | **Private client-document intelligence (local-first)** |
| Promise | Save time, grow revenue (across your stack) | Cited private intelligence | "Your client's whole file room, read and answerable — privately, on your computer" |
| Emotional | "Don't get left behind" (FOMO, growth) | Trust/control | **Control + relief** ("nothing leaves; nothing to vet") |
| Trust | Certs + enterprise logos | Architecture + design | **Architecture** ("private by design, not by promise") |
| Compliance | SOC 2 II + attestation features | Local by nature | "Far less for compliance to vet" (honest) |
| CTA | "Try for free" / "Book a demo" | Mixed | Founder-led guided demo / paid pilot |
| Buyer | Firm tech committee + advisor | Advisor | The privacy-bound / document-heavy solo (or attorney) |
| Demo clarity | High | Pre-installer, drift | Must be a clean Windows build, one loop |
| Information architecture | Single clear story | **Contradicts itself (law/advisor)** | One reconciled advisor (or pro) story |

**What Keepance should STOP saying:** "AI assistant," "AI for financial advisors" (generic), "client intelligence" / "cited answers" as the *lead* (those are Jump's words now), anything law-flavored on advisor surfaces, and "$99" (signals toy).

**What Keepance should say INSTEAD:** "**The private place your client documents live and answer you back — on your own computer.**" Lead with **(1) on your machine, (2) reads the files you already have (no CRM, no meetings, no migration), (3) and you can edit the Word docs right there with tracked changes.** Frame Jump implicitly: *"Jump is the cloud assistant that runs your meetings and your CRM. Keepance is the private vault that reads your files — and never leaves your computer."*

**The four positioning decisions, answered:**
- **Avoid advisors for now?** **Partially.** Avoid the *head-on advisor-AI* frame. Pursue the *narrow privacy/document slice* of advisors, and treat it as one of two beachheads.
- **Focus attorneys?** **Keep as a live parallel option, not the sole bet.** Jump threat there is ~zero and Word-native redline fits, but legal-AI is crowded and well-funded, and Keepance never validated law either. Test both wedges in the 60-day sprint; let demand pick.
- **Focus local-first private desktop AI?** **Yes — this is the spine.** It's the one thing Jump structurally cannot copy.
- **Become "client memory," not "advisor AI assistant"?** **Yes, with a tweak:** become **"private client-document memory"** — emphasize *documents + local*, because plain "client memory / client intelligence" is now Jump's territory.
- **Strongest wedge if Jump owns advisor AI:** **"Local-first, private, reads your existing file room (not your meetings), and writes your documents."** That sentence has zero overlap with Jump.

---

## 10. Moat & defensibility (graded bluntly)

| Moat type | Keepance | Grade |
|---|---|---|
| **Local-first / architecture** | True local + BYOK + in-house OOXML engine + document-pile synthesis. Hard for cloud Jump to copy (cuts against its model). The **real** moat. | **3.5/5** |
| Data moat | None — data is the customer's and stays local by design (privacy vs data-network-effects are in tension). | 1/5 |
| Workflow lock-in | Emerges once an advisor's institutional memory lives in Client Maps; zero until weekly use. | 1.5/5 |
| Integration / switching cost | OneDrive + Wealthbox start it; thin vs Jump's 39. | 1.5/5 |
| Compliance moat | None today (no SOC 2/DPA/entity); Jump is far ahead. | 0.5/5 |
| **Distribution moat** | **None — the gap that decides everything.** Jump has LPL/Osaic/Cetera; Keepance has nobody. | 0/5 |
| UX / design | Genuinely strong; founder is a product designer. Durable while solo. | 3/5 |
| Trust posture | "Private by architecture" is a real, ownable trust story — if sold honestly. | 2.5/5 |
| Vertical depth | Shallow post-pivot (label facade, not deep advisor build). | 1.5/5 |

**Net defensibility ≈ 2/5.** Enough for a cash-flow niche; **not** enough to hold off a funded land-grab if Jump (or FutureVault, or Wealthbox) targets the local-first/document wedge. The honest truth: **Keepance's only durable moat is the local-first architecture + authoring, and a moat means nothing without a single channel to reach the buyer.** Distribution, not features, is the unsolved problem — and Jump has already solved distribution.

---

## 11. Product recommendations (prioritized)

**MUST build / fix now (credibility, not features):**
1. **Reconcile the surface drift** — `pricing.ts` audience strings, the in-repo homepage, FEATURES.md — to **one** story (advisor *or* pro), kill the $99-vs-$948 inconsistency. A trust product cannot contradict itself. *(Highest urgency, lowest effort.)*
2. **Package a clean installer + a 4-beat demo on a fresh Windows build.** Nothing advisor-polished has shipped; you cannot sell a download that doesn't exist.
3. **Make the Client Map bulletproof on a real, messy folder** (PDF indexing on by default for the demo path) — the "wow on real files" moment is the entire pitch.

**SHOULD build (sharpen the wedge Jump lacks):**
4. **Lean into Word-native AI redline as a first-class selling moment** — it's the cleanest Jump-can't-do-this capability.
5. **A crisp "where your data goes" one-pager** (Local / BYOK-direct / Assured) — turn the privacy architecture into a forwardable artifact.
6. **5-year audit/retention export** — needed the moment any firm conversation gets real.

**SHOULD AVOID (Jump owns it — building here is lighting money on fire):**
- Meeting capture/transcription, a 39-integration marketplace, Grow-style revenue dashboards, account-opening/intake automation, a cloud multi-surface platform, mobile.

**FAKE-DEMO / validate before building:**
- The "firm shared brain" / multi-user E2EE tier — impressive, near-zero current willingness-to-pay; keep, don't sell.
- Any new vertical pack — mock it before coding it.

**REMOVE from roadmap (for now):** embedded-model bundling as a priority (Ollama-external is enough to prove local), SSO, CRDT co-editing — all Jump-irrelevant distractions during the demand test.

**Prioritization logic:** differentiation (local/document/authoring) + urgency (drift, installer) + speed-to-demo first; revenue features and Jump-overlap features last or never.

---

## 12. Demo / sell / build implications

- **Who to demo to:** a **document-heavy, privacy-bound solo** — a fee-only RIA who is their own paraplanner and distrusts cloud AI, **or** a solo estate/small-firm attorney. NOT an enterprise advisor (Jump's there) and NOT a meeting-heavy advisor (Jump wins).
- **Which use case:** **pre-meeting prep from the client's existing folder** → cited Client Map → ask a question, click the source → **edit the review note in Word with tracked changes.** That last beat is the un-Jump-able moment.
- **Jump-overlap features to de-emphasize:** anything that sounds like "notetaker," "CRM sync," "follow-up emails," or generic "AI assistant / client intelligence."
- **Differentiated Keepance moments to show clearly:** (1) "this all ran on your machine — watch the egress indicator stay dark in local mode," (2) "it read your actual folder of PDFs, not a meeting," (3) "now I'll redline the Word doc with tracked changes — Jump has no document-editing capability."
- **What the demo must prove:** it **wows on the advisor's own messy files** (not the curated Webb/Hendricks sample) and the privacy claim is **literally inspectable**.
- **Buying questions to ask the prospect:** "Walk me through how you prepped for your last review." "Would your compliance person let you put client files in a cloud AI tool?" "Do you use Jump or a notetaker today — what does it *not* do?" "What's in your client folders that no system can see right now?"

---

## 13. Risk register — top 20 Jump-created risks

| # | Risk | Type | Severity | Likelihood | Evidence | Mitigation |
|---|---|---|---|---|---|---|
| 1 | Jump already owns "cited client intelligence," so Keepance's hero pitch sounds like a Jump knockoff | Positioning | **High** | High | AI Associate page | Re-lead with local + document-pile + authoring; never "client intelligence" generically |
| 2 | Head-on advisor competition is unwinnable vs Jump's distribution | Competitive | **Existential** | High | Kitces 10%; LPL/Cetera | Narrow to privacy/document slice; don't fight distribution |
| 3 | Jump deepens Document Intelligence intake → true folder synthesis, closing the document seam | Product | **High** | Medium | June 2026 Onboard push | Move fast; deepen synthesis + add authoring lock-in |
| 4 | Jump (or FutureVault/Wealthbox) ships a local/on-prem tier | Competitive | **High** | Low-Med | none yet | Speed; make local + authoring + workflow lock-in the moat |
| 5 | "Local-first" is a nod, not a purchase driver | Market | **High** | Med-High | memo H3 | Lead with outcome+document pain; local as closer, not opener |
| 6 | The document-heavy + privacy-bound + tiny intersection is too small to be a business | Market | **High** | Medium | memo §4 | The 60-day test must size it before more building |
| 7 | No distribution channel exists to reach the niche at all | Distribution | **High** | Medium | moat=0 | Kitces/XYPN/NAPFA + founder-led; attorney channels in parallel |
| 8 | Surface drift (law vs advisor) kills trust on first impression | Trust | **High** | High (today) | repo | Reconcile before any demo (this week) |
| 9 | Jump's price cut ($120→$100, $75 small-firm) compresses the whole category's willingness-to-pay | Pricing | **Med** | High | InvestmentNews | Don't compete on price; sell a different job (private/document) |
| 10 | Buyers expect SOC 2; Keepance has none | Trust | **Med** | Med | repo gap | Sell solos (self-CCO); entity now; SOC 2 on demand |
| 11 | Attorney pivot escapes Jump but lands in Harvey/legal-AI's $11B field | Market | **Med** | Med | legal-AI funding | Test, don't commit; lean on local+privilege+authoring |
| 12 | Jump's brand ("#1, T3/Kitces") makes Keepance look like a hobby | Trust | **Med** | Med | awards | Design polish + entity + design-partner case study |
| 13 | Keepance's "private" claim has a cloud asterisk (BYOK-cloud sends query out) → AI-washing risk | Trust/Legal | **Med** | Med | repo | Scrupulous honesty: "far less to vet," not "nothing leaves" |
| 14 | The build trap recurs (a 6th pivot instead of selling) | Product | **High** | High | memo §16 | This report + memo as the line; ≥50% time on customers |
| 15 | Jump adds Word/Office authoring (Outlook add-in already shipped) | Product | **Med** | Low-Med | May 2026 add-in | Deepen redline/OOXML lead while it's uncontested |
| 16 | Meeting-derived intelligence proves "good enough," document synthesis seen as redundant | Product | **Med** | Med | Jump prep page | Demo on files Jump literally cannot see (private archives) |
| 17 | Jump's enterprise motion eventually trickles down to small RIAs via BD free tiers | Distribution | **Med** | Med | LPL/Cetera | Own the off-network, privacy-bound solo Jump under-serves |
| 18 | Jump churn is actually low (sticky) → niche shrinks further | Market | **Med** | Unknown | undisclosed | Manual-verify churn; target non-adopters, not switchers |
| 19 | Founder bandwidth (full-time job) can't out-execute a 220-person company | Competitive | **Med** | Med | memo §16 | Tight scope; AI-leveraged build; sell, don't out-build |
| 20 | Keepance copies Jump features reactively and loses its identity | Product | **Med** | Med | — | Hold the line: local + document + authoring; ignore Jump's roadmap |

---

## 14. Final recommendation + 7-day action plan

**Recommendation: NARROW + REPOSITION (do not continue head-on; do not fully pivot away from advisors; do not stop building the core — re-aim it).**

- **Continue:** the local-first desktop product, the Client Map / Ask / Word-redline engine. It's genuinely good and genuinely differentiated *where it differs* (local, document-pile, authoring).
- **Narrow:** from "AI for financial advisors" to **"private client-document intelligence, on your own machine,"** sold to the privacy-bound / document-heavy solo (advisor or attorney).
- **Change the use case** shown in the demo: from "AI assistant" to **"read my existing file room privately + write the doc"** — the two beats Jump can't match.
- **Change the demo + the market message** accordingly; **stop building** anything Jump owns.
- **Validate before more building** via the memo's 60-day test — now **aimed** by this analysis (test the privacy/document slice *and* the attorney slice; let demand pick).
- **Sell now** only via founder-led paid pilots to that narrow buyer; **no self-serve** until the demo is bulletproof.

**One-page next-7-days action plan:**
1. **Day 1:** Reconcile the surface drift — fix `pricing.ts` audience strings, the in-repo homepage, FEATURES.md — to one story; kill the $99/$948 split. *(Trust, before anything else.)*
2. **Day 1–2:** Rewrite the homepage hero to the new line: *"The private place your client documents live and answer you back — on your own computer."* Demote any "AI assistant / client intelligence" lead language.
3. **Day 2–3:** Build a **clean Windows installer + a 4-beat demo** (folder → cited Client Map → click a source → Word redline) on a fresh build; make the egress/local indicator visibly part of the demo.
4. **Day 3:** Draft the one-sentence Jump answer: *"Jump is the cloud assistant for your meetings and CRM; Keepance is the private vault that reads your files and never leaves your computer."* Plus the forwardable "where your data goes" one-pager.
5. **Day 3–4:** **Book a Jump demo yourself** and confirm (manual-verify item) whether its Client Profile can read an arbitrary PDF folder vs only meetings/CRM — this de-risks the whole thesis.
6. **Day 4–6:** Line up **10 discovery calls** split across the two wedges: privacy/document-heavy solo RIAs (XYPN/NAPFA/FinTwit) **and** solo estate/small-firm attorneys. Mom-Test questions; no pitching.
7. **Day 7:** Manual sentiment pass on Reddit/G2/Capterra for Jump (logged-in) to find what advisors say Jump *can't* do — that list is your wedge copy.

---

## Scoring (1–10, with justification)

| Metric | Score | Justification |
|---|---|---|
| **Jump threat — overall** | **8/10** | Funded ($105M), #1 (Kitces ~10%), enterprise distribution, directly overlaps Keepance's hero (cited client briefs). Not a 9-10 only because it's cloud-only and document-shallow, leaving a real (narrow) seam. |
| **Jump threat — if Keepance targets advisors** | **9/10** | Jump's home field; overwhelming distribution + brand + the same pitch. Head-on, near-existential. Only the narrow privacy/document slice survives. |
| **Jump threat — if Keepance targets attorneys** | **3/10** | Jump does not serve law at all; privilege favors local. Not lower because the *market itself* is contested by well-funded legal-AI (Harvey) — low Jump threat ≠ easy win. |
| **Keepance differentiation — today** | **5/10** | The differentiating features (local/BYOK, document-pile RAG, Word redline) are **real and work in code** — this is not vaporware. The 5 (not higher) reflects that they're **unproven with real users, packaged behind law-flavored surfaces, thin on advisor-specific depth, and undistributed**. The weakness is proof/packaging/distribution, not feature reality. |
| **Keepance differentiation — potential** | **7/10** | Local-first + document synthesis + authoring is genuinely hard for a cloud incumbent to copy (it fights their model). Defensible *if* a buyer who needs it is found and the surfaces are fixed. |
| **Urgency to reposition** | **8/10** | Jump is racing up-market into "client intelligence / operating system," adding mobile + embed + deeper prep. The window to claim "local + document-pile + authoring" is now; the surface drift is an active trust wound today. |
| **Confidence in analysis** | **7/10** | High on Jump's public posture, funding, category position (two independent passes + Codex + third-party sources converge). Tempered by JS-gated trust center, blocked Reddit/G2, paywalled surveys, undisclosed Jump churn/attach-rate, and Keepance's still-untested real demand. |

---

*Bottom line: Jump is a serious, category-leading, well-funded competitor that already occupies Keepance's hero narrative in the cloud. Do not fight it there. Keepance's honest, defensible ground is the one place Jump structurally is not: private, local-first, reading the existing document + email pile (not meetings), and writing the documents. Narrow to that, fix the contradictory surfaces this week, and let a 60-day demand test — aimed at the privacy/document-heavy solo and the solo attorney — decide whether anyone will pay to stand in that corner.*
