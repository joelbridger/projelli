# Advisor Prep Hero — Strategic Advisor Memo

**An elite, skeptical founder/operator/investor read of the real Advisor Prep Hero — built to test whether this becomes a real company that creates meaningful wealth in five years.**

*Date: 2026-06-28 · Author: strategy session (Claude, with an independent Codex adversarial pass) · Audience: Jameson (Board) · Status: internal, private*

> **How this was built.** Grounded in the live code (`/home/jameson/kp-coord`, branch `keepance-3.0`, v3.3.5), the dated strategy docs in `~/keepance/docs/strategy/`, the project memory, and fresh competitive + market + compliance research (sources cited inline). Conclusions were pressure-tested by an independent Codex pass instructed to argue the opposite. Where the older planning docs and the running code disagree, the **code wins**, and I flag the conflict. Nothing here is flattery. Where an honest answer is weak, I say so.

---

## 1. One-sentence verdict

**Advisor Prep Hero is an unusually good product chasing an unproven need: the advisor pivot is the soundest of its five re-aims, but it rests on a single anecdotal pain signal and a privacy wedge that is a trust-accelerator, not a must-buy — so the only correct move is to NARROW to one bulletproof job and run a hard 60-day demand test (10–15 advisor conversations → 5 live demos → 3 real-data pilots → 3–5 weekly-active, 1–2 paying or signed LOIs, zero speculative features); if that fails, do NOT re-pivot to a sixth ICP — park it or convert to a services/concierge motion.**

*An independent Codex adversarial pass (instructed to argue the opposite) reached the same call — NARROW, not kill and not proceed-harder — and sharpened it: lead with pain (privacy is the permission to try, not the reason to buy), say "less to vet" not "nothing to vet," and keep one sales-enabling integration in scope even during the feature freeze.*

---

## ★ First-principles gut-check — "is this a real business?"

*The blunt test, answered before any framework. If these answers are weak, no amount of strategy saves it.*

**1) What's the real problem?** The real job is **"walk into every client meeting already knowing the whole household, without spending Sunday night digging through scattered files and a search box that doesn't work."** The pain underneath is *retrieval and recall*, not drafting: an advisor's knowledge about a family is spread across a financial plan, statements, meeting notes, emails, and beneficiary forms, and none of it is searchable in one place. The single real pain signal on record is exactly this — a CFP saying "Outlook search basically doesn't work." That is a true, felt, recurring job. **The honest caveat: it's a painful annoyance, not a bleeding wound.** Advisors have lived with it for 20 years using assistants, sticky notes, and CRM fields. "Annoying but survivable" is the hardest kind of pain to sell against, because the current workaround is "cope."

**2) Who's affected?** The sharp answer is **the small independent/fee-only RIA (roughly 1–20 people) where client context is scattered and nobody owns it** — the solo who is their own paraplanner, OR the 3–20 person firm where several people touch a household and context falls through the cracks. (Codex's pushback, which I accept: do not define the buyer as a "privacy purist solo." The real buyer is *drowning in scattered client context and likes that privacy lets them try it* — pain first, privacy as the permission. The 3–20 person firms may feel the synthesis/coordination pain *more* acutely than solos, while still having a short decision path.) The buyer is on Windows, and at the small end is the buyer + user + compliance owner in one person (a one-day cycle). NOT "financial advisors" broadly; NOT wirehouse advisors (their firm dictates the stack); NOT big RIAs (staff + enterprise tools). The market backs the small end: **76% of state-registered RIAs have 0–2 employees and 98.5% have ≤10** ([NASAA 2025](https://www.nasaa.org/wp-content/uploads/2025/09/IA-Section-2025-Report-FINAL.pdf)). The micro-and-small-RIA tail is large and genuinely under-served.

**3) How much do they currently pay?** A small RIA spends **~3.8–6% of revenue on technology** ([Kitces / InvestmentNews benchmarks](https://www.kitces.com/blog/kitces-wealthtech-advisortech-trends-adoption-satisfaction-disruption/)), which builds up to roughly **$300–600 per advisor per month (~$3,600–7,200/yr)** for the core stack: a CRM (Wealthbox $59–99/mo, Redtail), planning software (eMoney/RightCapital/MoneyGuide, the "big three" ≈ 80% share), portfolio/reporting (Orion), and increasingly an AI notetaker (Jump/Zocks **$75–120/advisor/mo**; Wealthbox's native notetaker just **$49/mo**). **The honest read: there IS a real budget, and Advisor Prep Hero at ~$468–1,548/yr is cheap inside it — but that budget is already fully allocated, and "AI that knows my client" is starting to arrive bundled into tools they already pay for at $49/mo.** Advisor Prep Hero is competing for net-new budget against a falling price floor.

**4) What's the unique promise?** **"One private, cited brief of everything you know about a household — built automatically from your own files, that never leaves your computer."** Two words carry it: **synthesis** (across document types, not per-document like Holistiplan/Vanilla, not just-the-meeting like Jump/Zocks) and **local** (the data physically stays on the machine). No competitor today credibly says both. FutureVault says the first in the cloud; Jump says a narrower version in the cloud; nobody leads with "on your own machine." **That is a real, defensible sentence.** The risk is that "synthesis + local" is a *founder's* favorite sentence, not yet proven to be a *buyer's* deciding sentence.

**5) What's the unfair advantage?** Real but narrow: **(a)** a product designer with genuine UX/research instinct building at AI-leveraged speed (the product quality is visibly above what a solo normally ships); **(b)** a live, in-household advisor (the wife, a CFP) as a permanent design partner and translator; **(c)** a hard-to-copy *architecture* (true local-first + an in-house Word/OOXML engine + the Client Map synthesis) that funded cloud incumbents won't quickly replicate because it cuts against their cloud business model. **The honest limit: none of these is a *distribution* advantage, and distribution is the entire game here.** Speed and taste don't get you in front of advisors; Kitces, T3, XYPN, custodians, and peer referrals do — and Jameson has none of those yet.

**6) Can this scale?** **Be honest: the base case is a cash-flow / lifestyle business, not a venture rocket — but "venture is impossible" is too strong (a fair Codex correction).** The math: BYOK means ~95% gross margin, so 150–350 paying customers ≈ $300K/yr; ~1,000 customers ≈ $1M/yr. That is a *fantastic* solo-founder outcome and entirely achievable inside a ~33,000-firm market. Winning venture-scale ($50M+) by becoming *the* standalone advisor-AI app would mean a capital war against a $105M Jump, a $200M-funded Wealthbox, and Orion/Salesforce — which an unfunded solo loses. **But there is a narrower venture path: become the local/private client-intelligence *layer* that other tools embed — license the Client-Map + local-first + OOXML engine to a CRM, custodian, or network (Wealthbox/XYPN/Altruist) rather than competing with them.** That's infrastructure, not a self-serve app, and it's the one route where the unique tech (not distribution) is the asset. Realistic ranking: **cash-flow $300K–1M/yr (likely) → strategic acquisition/acqui-hire (possible) → infrastructure-licensing venture (low, but real). Plan for cash-flow; treat the rest as upside.**

**Gut-check bottom line:** real problem (mild), real person (narrow), real budget (already spent), real promise (unproven), real advantage (not in distribution), real-but-modest scale. **This clears the bar for a 60-day test. It does not clear the bar for another year of building.**

---

## 2. The strongest version of the idea

Sharpened, the strongest Advisor Prep Hero is **not** "a private AI workspace for advisors." It is: **"The thing that reads the pile of files you already have on a household and hands you back one cited brief you can trust in a meeting — and because it runs on your machine, your compliance officer has nothing to vet."** One person, one job, one trust story. It wins by being the *deepest* at synthesis-across-documents (the least-crowded angle in the whole landscape) and the *only* one that is truly local. It expands later — from "knows the client" to "drafts the client's review note" to "the firm's shared brain" — but only after one advisor can't live without the first job.

The strongest version is **demo-led and founder-sold**, priced as a serious tool ($1,500–3,000/yr, not $99), aimed at the solo RIA who is their own staff, distributed through Kitces/XYPN/peer-referral, and ruthlessly NOT a notetaker.

## 3. The weakest version (the one that fails)

The version that fails is **"a privacy-first AI assistant for financial advisors."** It fails because: (a) "AI assistant" is the most crowded sentence in the category — ChatGPT (41% of advisors), Copilot (20%), Jump, Zocks, every CRM; (b) "privacy-first" is now claimed by everyone (Zocks and Zeplyn both say it) and maps to no compliance *mandate*; (c) it's a horizontal tool a non-technical advisor has to learn, set up (BYOK keys, local models), and *change their workflow* for, with no integration into the hub they live in. This version is "yet another login," and advisors drop those. **Today's keepance.com is dangerously close to this weak version**, except worse — it still says "law practice."

## ★ Reconciliation: where the prompt, the docs, and the code disagree

My brief, the planning docs, and the running code do not agree, and the gaps matter:
- **Prompt vs. reality:** the original analysis prompt treats *lawyers* as the ICP. **Reality: Advisor Prep Hero pivoted to financial advisors ~2026-06-23.** Reality wins.
- **"Staged connectors" overstated:** the brief lists Box/ShareFile/Jotform/Zocks/Addepar as "staged." In code (`keepance-3.0`), **only Addepar is even a placeholder logo; the other four do not exist at all.** OneDrive and Wealthbox are genuinely built; Salesforce/Redtail/DocuSign are code-complete but gated on missing credentials.
- **Source-of-truth drift (the most important conflict):** advisor is **real in the app engine** (`professionStore.ts` defaults to `'advisor'`; the Client Map, label facade, advisor demo + sample household are built), and the *live* keepance.com is reportedly already advisor-positioned (the re-aim deployed the public site from a separate worktree). But several surfaces still disagree: `src/config/pricing.ts` audience strings still say "a single attorney," "litigator," "5 to 50 attorneys"; the **in-repo** `website/index.html` still reads "The private intelligence layer for your law practice"; `docs/reference/FEATURES.md` is two pivots stale (describes a "founder tool"). **The risk isn't only first-impression credibility — it's that the app, the repo website, the live website, the pricing config, and the docs tell different stories. And `pricing.ts` is the one that reaches the in-app checkout — so the law copy + the $99-vs-$948 inconsistency are live where it counts.**
- **Nothing advisor-polished has shipped.** The Client Map + advisor re-aim are finished in code but **not packaged into an installer a customer can download.** The last published build predates the advisor work.

---

## 4. Market diagnosis & ICP ranking

**The market is real but flat and a share-shift game, not a growth wave.** ~33,000 RIA firms (16,544 SEC-registered + ~16,575 state) and ~426,000 IARs, but total advisor headcount (~283,000) has been **flat for a decade and is projected flat** ([Cerulli](https://www.cerulli.com/press-releases/the-financial-advisor-industry-has-a-headcount-problem)). You win by taking share, not by riding growth. The one real tailwind is AI adoption itself (advisor gen-AI use jumped **41%→52% in a single year**, [T3 2026](https://t3technologyhub.com/live-from-t3-key-wealthtech-and-ai-findings-from-the-2026-t3-inside-information-software-survey/)).

**Best→worst first wedge (ranked on: real urgent pain · budget · shortest path to purchase · easiest to reach · least compliance-blocked · most likely to pay early):**

| Rank | ICP | Why | Verdict |
|---|---|---|---|
| 1 | **Solo / 2–3p independent fee-only RIA (own paraplanner)** | Buyer=user=CCO (1-day cycle); no staff to mask the pain; owns their stack; local-first lands hardest; warm access exists (the design partner's world) | **First wedge** |
| 2 | **Small fee-only RIA, 4–10 advisors (XYPN-type)** | Reachable via XYPN/NAPFA; real budget; still founder-sellable; slightly longer cycle | Fast-follow |
| 3 | **Estate-planning-heavy / multi-doc advisors** | Most documents per household = most synthesis pain; but Vanilla/FP Alpha already there | Niche expansion |
| 4 | **Solo CPAs / tax pros / EAs** | Adjacent, doc-heavy, privacy-minded; but Holistiplan owns tax-doc reading | Adjacent later |
| 5 | **Multi-family offices / larger RIAs** | Real money, real synthesis pain | **Avoid early** — demands SOC 2/DPA/entity Advisor Prep Hero lacks |
| 6 | **Wirehouse / BD advisors** | Largest headcount | **Avoid** — firm dictates the stack; can't buy |
| — | **Solo attorneys / estate / family-law / immigration / PI attorneys** | The old ICP | **Deprioritized** — never validated; legal AI is 10x more capitalized (Harvey $11B) |

**The honest tension:** the #1 wedge (privacy-caring + tiny + acutely feels synthesis pain) is a *triple intersection* that may be small. Sizing that intersection is the single most important unknown the 60-day test must resolve.

## 5. Core customer pain — sorted honestly

- **Real, urgent, recurring:** "I can't quickly find what I know about this household before a meeting" (the retrieval/recall job — the validated signal). This is the beachhead.
- **Real but nice-to-have:** "Auto-draft my review note / Reg BI rationale." Useful, but ChatGPT already does the blank-page job; not a switch-driver alone.
- **Fake-but-sounds-good:** "Advisors are desperate for a privacy-first AI." They are *cautious* about cloud AI (real), but desperation is the founder's projection — most are adopting cloud Copilot/ChatGPT and accepting the SOC-2-plus-contract model.
- **Already solved (don't fight):** meeting capture/notes (Jump/Zocks/Wealthbox own it), tax-return reading (Holistiplan), estate-doc reading (Vanilla).
- **Won't-trust-AI-with-yet:** anything that *acts* on client data autonomously, or that touches account/custodial systems. Advisor Prep Hero's "AI proposes, human decides, everything cited" posture is correctly conservative here.

## 6. Wedge recommendation

**Narrowest initial wedge:** *the solo fee-only RIA's pre-meeting prep.* Target user: a 1–3 person RIA on Windows who does their own prep. Painful job: "be fully prepared for tomorrow's review in 5 minutes, not Sunday night." Trigger event: an annual-review meeting on the calendar. Existing workaround: re-reading the plan + scrolling the CRM + a broken Outlook search. Why Advisor Prep Hero is 10x better: it *reads the household's own files* and produces a **cited** brief plus answers any pre-meeting question with a clickable source — no migration, point it at the folder they already have. Why it expands: once it "knows the client," drafting the review note, then the Reg BI rationale, then a shared firm brain are natural next jobs. **The wedge is the Client Map. Everything else is later.**

## 7. Product strategy — what to be FIRST

**Be the Client Map, on local data, bulletproof — and nothing else for 60 days.**

- **Essential v1 (the one loop):** point at a client folder → Client Map builds itself (cited, gaps flagged) → ask a pre-meeting question, click the citation → draft one review note. This loop is REAL today (`src/platform/clientMap/generator.ts`, the RAG stack in `src-tauri/src/commands/rag/`, the OOXML redline engine) — the work is *reliability and onboarding*, not new capability.
- **Distractions to freeze:** the firm/team E2EE tier, live multi-user co-editing (CRDT), SSO, the embedded local model (today Ollama-external only), every connector beyond OneDrive + Wealthbox, and any new vertical. These are impressive and have near-zero current willingness-to-pay.
- **Impressive-but-no-WTP:** the cryptographic ethical-walls / firm escrow machinery, the privacy "spectrum" UI subtleties. Keep them; don't sell on them.
- **Fix before any advisor sees it (not features — credibility):** the source-of-truth drift — `pricing.ts` audience strings (still "attorney/litigator," and they reach the in-app checkout) plus the $99/yr-vs-$948/yr inconsistency; the stale in-repo homepage and FEATURES doc; the dev email account still wired into the demo machine. This is cleanup, not building.

## 8. Trust & adoption barriers

| Barrier | Severity | Read |
|---|---|---|
| No SOC 2, no DPA, no formed legal entity | **Fatal for firms / manageable for solos** | A CCO asks for these first. Solos often *are* the CCO and can self-approve. Form the LLC now; defer SOC 2 until a deal demands it. |
| The "private" claim has a cloud asterisk | **Manageable → selling point if honest** | True only in local mode; BYOK-cloud sends query text to the provider (but never to a Advisor Prep Hero server). The trust sheet already states this; keep it scrupulously honest (SEC is fining "AI-washing"). |
| Reg S-P vendor oversight (small-RIA deadline **June 3, 2026**) | **Selling point (stated honestly)** | Frame as "**less to vet**," not "nothing to vet": in BYOK-cloud mode the query still goes to the AI provider the advisor chose (never to a Advisor Prep Hero server); only in local-model mode does literally nothing leave. Either way it's a genuine *diligence-reducer* for no-CCO firms — but a *convenience*, not a legal mandate (Reg S-P assumes vendors and the SEC's predictive-analytics/cyber proposals were withdrawn June 2025; [SEC](https://www.sec.gov/newsroom/press-releases/2024-58)). |
| Recordkeeping Rule 204-2 (5-yr retention of AI work) | **Manageable, must-address** | Local must still log/retain/export AI work product ~5 yrs, or it trades one gap for another. Make export/audit first-class. |
| "Looks like a one-person app" | **Real** | A fiduciary equates a polished, certified vendor with safety. Counter with design polish (already strong) + the design-partner case study + the entity. |
| Fear of changing workflow | **Real** | Mitigated by "point at your existing folder / your Wealthbox" — no migration. This is why integration-first matters. |
| Hallucination / liability | **Manageable (already handled)** | Cited answers + the "refuse rather than bluff" guard (the "Avianca trap" protection in the RAG layer) is the right posture; lead with it. |

## 9. Positioning & messaging

**Current positioning is broken in two ways:** the public surface still says *law*, and the advisor framing leans too hard on "private/AI." Fix both.

- **Category:** *private client-intelligence* (not "AI assistant," not "notetaker," not "document vault"). Own "knows your whole household, on your machine."
- **Homepage headline:** **"Walk into every meeting already knowing the whole household."**
- **Subheadline:** "Advisor Prep Hero reads the files you already have and builds one cited brief of each client — on your own computer, so there's far less for compliance to vet (and in local mode, nothing leaves at all)."
- **10-sec pitch:** "It turns the pile of files on a client into one trustworthy, cited brief you can ask anything — and it all stays on your machine."
- **30-sec pitch:** add the trigger + proof: "Before a review, you used to dig through the plan, the CRM, and a useless email search. Point Advisor Prep Hero at the client's folder and it builds a cited map of the whole household — people, goals, accounts, what's open — and answers any question with a link to the exact source. No client data ever goes to us or to an AI vendor unless you choose it."
- **Skeptical-advisor pitch:** "You already have the documents. You already pay for a CRM. This isn't another system to migrate into — it reads what you have, runs on your machine, and your CCO has nothing new to approve."
- **Language to avoid:** "compliant," "guaranteed," "secure" as a bare claim, "revolutionary/seamless/transform," "AI assistant," and anything implying it gives financial advice. (Per the voice guide and SEC AI-washing risk.)

## 10. Competitive landscape — where Advisor Prep Hero can win, and can't

- **Do-nothing / ChatGPT-or-Copilot by hand** *(the real default competitor)*: 41% use ChatGPT, ~20% Copilot. **Win** on: cited, source-linked answers over *their own* files with no copy-paste, and local privacy. **Lose** if the advisor's firm already standardized on M365 Copilot with enterprise data protection (erodes the privacy argument).
- **Notetakers (Jump ~$105M/~27k advisors; Zocks ~$65M; Zeplyn):** **Do not fight.** They own meeting capture and are becoming "agentic OS." Position as complementary (they capture the meeting; Advisor Prep Hero is the standing brief). The race for notes is over.
- **CRMs embedding AI (Wealthbox AI $49/mo, 25k advisors, $200M raised; Orion Denali; Practifi; Salesforce FSC+Agentforce):** **The most dangerous trend.** "Already in your stack, compliance done." **Win** only on depth-of-synthesis + local; **do not** duplicate Wealthbox's $49 notetaker. The Wealthbox *connector* is smart (ride the hub); competing with Wealthbox's *AI* is not.
- **Doc-intelligence specialists (Holistiplan tax 20k advisors; Vanilla estate $85M+; FP Alpha; Powder):** They own *per-document-type*. **Win** on cross-document *synthesis into one brief* (the gap none of them fill). Powder marketing "data stays in the firm" proves residency sells.
- **FutureVault (closest competitor):** same "documents → cited intelligence" promise (their "AI Advisor Insights Engine," launched ~March 2026), but **cloud, enterprise-only, SOC 2, blue-chip logos, ~$31M raised.** **Advisor Prep Hero's wedge vs. them:** runs on the advisor's own machine (privacy by architecture, not contract) and is solo-buyable today vs. their slow enterprise sale. **The one-sentence answer Jameson must be able to say:** *"FutureVault puts your clients' lives in their cloud; Advisor Prep Hero keeps them on your machine — and a solo can start this afternoon."*
- **Honest "can't win":** any enterprise/multi-advisor deal that hinges on SOC 2 + signed DPA, and any race that's won with capital.

## 11. Defensibility — graded honestly

- **Trust/architecture moat (the real one, moderate):** true local-first + in-house OOXML engine + the Client Map synthesis is genuinely hard for cloud incumbents to copy *because it fights their business model*. Real, but a moat of *positioning*, not patents.
- **Workflow lock-in (weak today, strong later):** once an advisor's institutional memory of their book lives in Advisor Prep Hero's Client Maps, switching cost is high. Doesn't exist until they use it weekly.
- **Data moat (none):** the data is the *customer's* and stays local — by design Advisor Prep Hero never aggregates it. Privacy and data-network-effects are in tension; accept it.
- **Distribution moat (none — the gap):** no Kitces presence, no XYPN, no custodian integration, no brand. This is the weakness that decides everything.
- **Switching cost / integrations (emerging):** the Wealthbox + OneDrive connectors start "fits your stack" lock-in.
- **Founder insight (real):** an in-household CFP + a designer who can ship. Durable while it's a solo effort.

**Net: defensibility is a 2–3 out of 5 — enough for a cash-flow niche business, not enough to hold off a funded land-grab if one targets the local-first wedge.**

## 12. Business model & pricing

- **Current state is a self-inflicted wound:** `pricing.ts` says Solo $468 / Pro $948 / Firm $1,548 per-seat-yr with *attorney* audience copy, while the advisor web page floats **$99/yr "founding."** A 10x inconsistency on the public surface, for a *trust* product. Fix first.
- **Recommended first-wedge pricing (test, don't assume):** **Solo $1,800/yr** (~$150/mo), **Small-firm $1,200/seat/yr** (3+ seats), **a premium "with-onboarding" pilot at $2,500–3,000** for design partners. Rationale: advisors spend $3,600–7,200/yr on the core stack and $900–1,440/yr on a *single* notetaker; ~$1,800 reads as a serious tool, not a toy. Too-low ($99) signals "not for real practices."
- **Model:** per-seat **annual** (matches advisor budgeting and the ~95% BYOK margin), **founder-led pilots first** (paid, 90-day, $500–1,500), no self-serve funnel until the demo is reliable and a price is validated. Free *guided* trial, not free self-serve.
- **The margin truth:** BYOK = customer pays inference = ~95% gross margin. This is the model's best feature; it means break-even is ~150 customers, not thousands.

## 13. Go-to-market (low-budget, founder-led)

- **First 20 conversations:** NOT the wife's firm first (see §16). Start with arms-length solo RIAs via **XYPN member forums, NAPFA, fee-only advisor Facebook/LinkedIn groups, and FinTwit**, plus 5–10 warm intros the design partner can make to *peers at other firms*. Use Mom-Test discovery (workflow questions, not demos).
- **First 5 pilots:** convert the most pained 5 into **paid 90-day pilots** ($500–1,500). The wife's firm can be pilot #2–3 (weekly use + case study), but a paying *stranger* must be in the first five or the signal is contaminated.
- **First 3 paying:** the test that matters — would they be genuinely upset if it vanished?
- **Distribution kingmakers:** **Kitces** (get on the AdvisorTech map; pitch a guest angle on local-first + Reg S-P), **XYPN** (apply to XYPN LIVE FinTech), **T3**, and **custodian marketplaces** (Altruist/Schwab/Fidelity integration listings) once there's a reference customer.
- **Founder-led sales script:** discovery → "show me how you prep for a review today" → demo on a *controlled sample* (never a prospect's live data on stage) → paid pilot ask.
- **Services-first on-ramp (an angle the memo was underweighting — Codex's flag):** early buyers often don't want *software*, they want the *outcome done for them*. Offer a paid "private client-intelligence setup": you (or an agent) clean their client folders, connect Outlook/OneDrive/Wealthbox, build their first batch of Client Maps, and hand back ready-to-use review prep — charge a setup fee **plus** the subscription. This converts the "won't change my workflow" objection into a done-for-you yes, produces real-data proof fast, and the concierge work *is* the validation. It can also be the whole business if the software-only motion stalls.
- **Trust-building:** the LLC, the forwardable "where your data goes" one-pager (drafted), the design-partner case study, scrupulous honesty about what's not built.
- **Local-Utah angle:** the design partner's firm + the local FPA/NAPFA chapter for warm, in-person first demos.
- **Tie to the mandate:** every one of these serves the 2026-06-25 CEO call — *3–5 weekly-active + 1–2 paying in ~60 days.*

## 14. Validation plan (a sprint, before any more building)

**Hypotheses → tests → kill/keep evidence:**

| # | Hypothesis | Test | Validating | Invalidating |
|---|---|---|---|---|
| H1 | The retrieval/recall pain is acute enough to pay for | 10 Mom-Test discovery calls with arms-length solo RIAs | They describe the pain unprompted + ask "when can I have it" | Polite interest, no urgency |
| H2 | The Client Map "wows" on *their* messy files, not just the Webb/Hendricks demo | Build a map live from a pilot's real (sanitized) folder | "It found things I forgot" | Map is thin/wrong on real-world docs |
| H3 | Local-first is a *reason to buy*, not just a nice-to-have | A/B the pitch: lead-with-outcome vs lead-with-privacy | Privacy framing closes faster | Privacy gets nods but no urgency |
| H4 | They'll pay ~$1,500+/yr | Direct paid-pilot ask at $500–1,500/90 days | A signed pilot from a stranger | Only "if it were free/$99" |
| H5 | Weekly use sticks | Track real logins over 4 weeks of a pilot | 3–5 advisors use it weekly | Use decays after week 1 |

- **Mom-Test questions:** "Walk me through how you prepped for your last annual review." "What's the most annoying part of getting ready for a client meeting?" "Last time you couldn't find something about a client, what did you do?" "What have you tried to fix this? What did you pay?" (Never: "Would you use an AI tool that…")
- **Landing-page test:** a single advisor-framed page with the new headline + a "request a demo" capture; measure real demo requests, not visits.
- **Concierge/manual MVP:** for one pilot, *you* build their first 5 Client Maps by hand from their files — prove the value before trusting the automation.
- **Pricing test:** quote $1,800; watch the flinch.
- **Demo test:** the 4-beat demo on a clean Windows build; the metric is "did they ask to try it on their own clients."

## 15. Five-year wealth path

| Path | Probability | Upside | Revenue / customers needed | Founder trade-off | Main failure mode |
|---|---|---|---|---|---|
| **Bootstrapped cash-flow** (recommended) | **Medium-High** | **$300K–1M/yr** | 150–1,000 customers @ ~$1.8K | Stays solo-ish; needs sales habit | Never builds distribution; stays at 0 |
| **Services-wedge** (paid setup/concierge → product) | Medium | $150–400K/yr near-term | 10–30 high-touch clients | Trades scale for proof + cash now | Becomes a consultancy, not a product |
| **Strategic acquisition / acqui-hire** | Low-Medium | $1–10M (tech + team) | A real reference base + the tech | Loses independence | No traction = nothing to buy |
| **Venture: standalone advisor-AI app** | **Very Low** | $50M+ | Becoming *the* advisor-AI app | Capital war, full-time, fundraising | Outgunned by Jump/Wealthbox/Orion |
| **Venture: infrastructure/licensing** | Low (but real) | $20–100M | License the local-first Client-Map engine to a CRM/custodian/network | Becomes a B2B tech-partner, not a brand | No reference traction = no partner wants it |
| **Lifestyle (1–2 anchor firms)** | Medium | <$150K/yr | 2–5 firms | Comfortable, capped | Single-customer dependency |

**The honest path: bootstrap to cash-flow, keep the services-wedge as the on-ramp and the acquisition as an unplanned bonus. Do not raise venture for this; the unit economics are great but the TAM and competitive intensity don't support a rocket.**

## 16. Founder-specific strategy

- **Unfair advantage:** design/UX taste + AI-leveraged build speed + a live in-household CFP. Jameson ships product quality a normal solo can't, and has a permanent translator for the customer.
- **Biggest weakness (name it):** **the build trap.** Five re-aims is the tell — each pivot was a *new build*, not a new set of customers. A designer's instinct under uncertainty is to make the thing better; the job now is to make *someone buy it*. Codex named this pattern bluntly: "write a compelling new story, find no traction, rewrite the story."
- **The structural risk in the warm path:** the wife is design partner #1, but her firm "can't be first to buy" (her career depends on it). So the warmest asset is *compromised as a validation source* — she'll be kind, and her firm can't be the proof. **The first paying customer must be a stranger.** That said (Codex's fair point), she is far from useless: she's the right source for *workflow truth, the real vocabulary, realistic sample data, and warm introductions to peers at other firms*. Use her for discovery and demo calibration; do not count her as validation.
- **The fix:** Jameson commits ≥50% of Advisor Prep Hero time to *customers* (discovery, demos, pilots) and lets Claude/Codex do the building. The one thing only he can do is sell; the one thing he'll be tempted to do instead is build.

## 17. Brutal risks — top 10

| # | Risk | Severity | Likelihood | Leading warning sign | Mitigation |
|---|---|---|---|---|---|
| 1 | The pain is real but not acute enough to pay | High | High | Discovery calls = polite interest, no urgency | The 60-day paid test; kill fast if no |
| 2 | The build trap recurs (6th pivot instead of selling) | High | High | New positioning doc appears before 3 paying customers | ≥50% time on customers; this memo as the line |
| 3 | The privacy wedge doesn't drive purchase | High | Medium | Privacy gets nods, outcome closes | Lead 70% outcome; treat local as the closer |
| 4 | The Client Map underwhelms on real messy files | High | Medium | Maps thin/wrong outside the demo sample | Test on real pilot data before scaling |
| 5 | A funded incumbent ships true local (FutureVault down-market / Wealthbox local) | High | Low-Med | Competitor announces on-prem / self-serve small-RIA tier | Speed; deepen synthesis + workflow lock-in |
| 6 | Source-of-truth drift (app/site/pricing/docs disagree) | Medium | High (today) | A demo, the checkout price, and the docs tell different stories | Reconcile `pricing.ts` + repo site + docs to one advisor story before any advisor sees it |
| 7 | No distribution; never gets in front of advisors | High | Medium | Months pass, conversation count flat | Kitces/XYPN/custodian + referral engine |
| 8 | Trust gap blocks every firm deal | Medium | Medium | "Send me your SOC 2" ends conversations | Sell solos first; entity now; SOC 2 on demand | 
| 9 | Wealthbox paste-key premise is unverified | Medium | Medium | Paid account can't self-create an API token | Test on the design partner's real paid Wealthbox |
| 10 | Founder burnout / divided attention (full-time job) | Medium | Medium | Cadence slips for weeks | Tight weekly rhythm; scope to the one loop |

## 18. Decision memo

- **Decision: NARROW + TEST.** Not kill (the product and the in-household signal are too good to walk away unproven). Not proceed-harder-with-building (no evidence justifies it). **Narrow to the one loop, fix the surface, and let arms-length advisors prove or disprove demand in 60 days.**
- **Best first ICP:** solo / 2–3 person independent fee-only RIA on Windows who is their own paraplanner.
- **Best first workflow:** pre-meeting prep → the cited Client Map → ask-a-question → draft one review note.
- **Best first product shape:** the existing desktop app, advisor-default, the one loop bulletproof, OneDrive + Wealthbox as the only connectors.
- **Best pricing hypothesis:** $1,800/yr solo (test the flinch); kill the $99 line.
- **The 60-day funnel (the scoreboard):** 10–15 advisor conversations → 5 live demos → 3 real-data pilots → 3–5 weekly-active users → 1–2 paying or signed LOIs. Measure your *selling behavior* (conversations booked, demos run) as closely as the market's response.
- **If the test fails:** do NOT re-pivot to a sixth ICP. Either **park** Advisor Prep Hero (it's a strong asset to return to) or **convert to the services/concierge motion** (sell the outcome done-for-you). A new positioning doc is the failure mode, not the answer.
- **Next 7 days:** fix the source-of-truth drift; form the LLC; line up 10 discovery calls. **Next 30:** run discovery + 2–3 paid real-data pilots (≥1 stranger). **Next 90:** hit 3–5 weekly-active + 1–2 paying/LOI, or park/services.

## 19. Concrete action plan

- **Today:** (1) Write the one-sentence FutureVault answer. (2) Open the LLC formation (Utah). (3) Draft the new advisor homepage headline/subhead. (4) Disconnect the dev email from the demo machine.
- **This week:** (5) Fix `pricing.ts` audience strings + resolve the $99-vs-$948 inconsistency to one advisor price. (6) Replace the law homepage with the advisor framing; demote legal pages. (7) Book 10 Mom-Test discovery calls with arms-length solo RIAs (XYPN/NAPFA/FinTwit). (8) One clean end-to-end demo rehearsal on a fresh Windows build.
- **Next 2 weeks:** (9) Run the 10 discovery calls; log pain/urgency/spend. (10) Build one Client Map live from a real (sanitized) advisor folder. (11) Make the paid-pilot ask to the 3 most-pained — offer either a software pilot OR a done-for-you "private client-intelligence setup" (concierge); get ≥1 stranger to a $500–1,500 commitment. (12) Stand up the single advisor landing page + demo-request capture.
- **Next 30 days:** (13) 2–3 paid pilots live and used weekly. (14) Draft the design-partner case study. (15) Get listed/known on the Kitces AdvisorTech map; apply to XYPN LIVE. (16) Verify the Wealthbox paste-key on the design partner's real paid account.
- **Next 90 days:** (17) 3–5 weekly-active advisors, 1–2 paying. (18) Decide go/stop on real usage data, not feelings. (19) Only if validated: pour into referrals + Kitces/XYPN; build only what paying users demand.

## 20. The 10 questions to answer before investing months more

1. **Is the retrieval/recall pain acute enough that an arms-length advisor pays $1,500+ for it** — or is it "annoying but survivable"?
2. **Does the Client Map actually wow on a real advisor's messy files**, or only on the curated demo household?
3. **Is "local-first" a reason a buyer *chooses* you**, or just a comfort they nod at while buying on outcome?
4. **Can you get 5 arms-length advisors into the room at all** — i.e., do you have, or can you build, distribution? (If not, nothing else matters.)
5. **Will a stranger pay before the wife's firm does?** (The first paying customer must be arms-length.)
6. **Does the Wealthbox paste-key actually work on a paid account** — does the "fits your stack" story hold?
7. **What's the real price?** Does $1,800/yr close, or only $99 — and what does that tell you about perceived value?
8. **Are you willing to spend 50%+ of your time selling, not building** — and to stop at the 6th-pivot temptation?
9. **What's the honest 5-year goal** — a $300K–1M/yr cash-flow business (likely) or a venture rocket (unlikely)? Strategy follows the answer.
10. **If, in 60 days, 3–5 advisors are *not* using it weekly with 1–2 paying, will you actually stop** — or rewrite the story again?

---

*This memo is intentionally hard on the idea because the product is good enough to deserve a real test, not another build cycle. The single most important sentence: let customers, not another strategy document, decide whether this is the one.*
