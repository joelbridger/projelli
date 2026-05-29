# Projelli — Expanded Market & Pivot Strategy

### Building on the Claude "Target Markets" and Gemini "Product Pivot" reports, with new research, fresh verticals, and unconventional plays

*Prepared May 2026 · Working strategy for Jameson Daines*

---

## 0. What this document adds

Your two existing reports are good, and they agree on the central thing: Projelli is not an indie-founder tool, it's **the AI workspace for people who legally or temperamentally cannot put their work in the cloud.** I'm not going to re-litigate that thesis — it's right, and both reports made the case well. The Claude report was sharper on *buyer psychology* and consumer/prosumer verticals; the Gemini report was sharper on *B2B/regulatory mechanics* and the Silicon Slopes regional angle.

This document does five things neither of them did:

1. **Adds a hard legal precedent that changes the pitch entirely.** A February 2026 federal ruling now means "use consumer AI and you may lose privilege" is no longer a best-practice warning — it's case law. This is a gift to your marketing and it postdates both reports. (§1)
2. **Opens three new high-value verticals** neither report covered: accountants/tax preparers (who face a *criminal* confidentiality statute), M&A and private-equity deal teams (whose own NDAs now ban cloud AI), and estate/elder-law attorneys (a softer, faster-moving slice of the legal market). (§3)
3. **Maps the real competition** — the local-LLM tool space (LM Studio, Jan, AnythingLLM, Msty, Open WebUI) — which both reports under-examined, and shows precisely where Projelli's whitespace is. (§4)
4. **Fixes the weakest part of both reports: distribution.** Both told you *who* to sell to but were thin on the actual mechanics of how a solo founder gets discovered and avoids the wrong customers. (§5)
5. **Proposes product and packaging moves** — not just marketing skins — that turn the privacy story from a claim into something a risk-averse buyer can verify. Plus a set of genuinely unconventional plays. (§6, §7)

The single most important new finding is in §1. If you read nothing else, read that.

---

## 1. The new fact that reframes everything: *U.S. v. Heppner*

Both your reports argued that using consumer AI *might* waive attorney-client privilege, and treated it as a sophisticated ethical risk. As of February 2026, it's no longer hypothetical.

In *United States v. Heppner* (S.D.N.Y., Feb. 17, 2026), Judge Jed Rakoff addressed what the court itself called a **"question of first impression nationwide"**: whether a defendant waived attorney-client privilege and work-product protection by entering case facts and legal strategy into a publicly available generative-AI tool. The defendant entered factual and legal prompts into a publicly available GenAI tool to analyze his potential legal exposure, later shared the AI-generated analyses with his defense counsel, and the court held that the AI-generated content was not protected by the attorney-client privilege or the work-product doctrine.

Commentary since has been blunt. A federal judge in New York ruled that documents generated using a publicly available AI tool are not protected by attorney-client privilege or the work product doctrine, finding that the use of a consumer-grade AI platform to draft legal documents compromised confidentiality — underscoring the importance of secure, attorney-directed AI platforms to maintain privilege protections. Crucially, the analysis leaves a door open for *local/supervised* tools: privilege may apply where GenAI is used under the direction and supervision of counsel similar to other nonlawyer assistants, but only where there is a reasonable expectation of confidentiality and that confidentiality is preserved.

**Why this matters for Projelli specifically:** the case names the exact products your competitors-by-default are — ChatGPT, Claude, Gemini — and the legal commentary explicitly contrasts them with confidentiality-preserving alternatives. Use of public generative AI models like ChatGPT, Claude, and Google Gemini by lawyers and their clients has long carried privacy concerns, but for the most part those concerns were theoretical and did not meaningfully deter attorneys seeking efficiency. *Heppner* is the moment the theoretical became concrete. A local-first tool where the prompt never leaves the device is the cleanest possible answer to "was there a reasonable expectation of confidentiality?"

This is a headline you can build a launch around: **"The AI workspace that doesn't waive privilege."** You're not making a claim a managing partner has to take on faith anymore — you're pointing at a docket number.

> **One discipline note, repeated throughout:** never claim Projelli *guarantees* privilege or compliance. Claim the precise, defensible thing: *because nothing leaves the device, there is no third-party disclosure to argue about.* Lawyers, accountants, and clinicians all respect a narrow, accurate claim and distrust an over-broad one. Precision is itself a selling point to these buyers.

---

## 2. The macro tailwind, updated

Your reports already named subscription fatigue, the True North Budgeting comp, and the NPR therapist story. All still valid. Three updates from current research strengthen the timing case:

**The local-AI category has crossed from "experiment" to "default infrastructure."** This cuts both ways — it means more competitors (see §4), but it also means your buyers no longer need to be convinced that local AI is *possible*. The bigger lesson is that local AI is real now; two years ago this conversation would have been theoretical, but now you can run models on a laptop that are as good as what ran in data centers a few years back, and that means privacy is possible. The market education is done; you inherit it for free.

**NDAs themselves are now weaponizing your value proposition.** This is the B2B parallel to the *Heppner* gift. Corporate legal departments are writing AI prohibitions directly into contracts: some sellers now include provisions that prohibit uploading confidential information into public or open-source AI platforms, restrict use of AI tools that retain data or use inputs for model training, and require prior written consent before use. The pressure is rising precisely because of how AI changes the risk surface: data rooms were designed to control documents, but AI changes the risk surface to include prompts, outputs, logs, plugins, and personal accounts. When a client contractually forbids cloud AI, a local-first tool isn't a nice-to-have — it's the only way the work gets done at all.

**Privilege/confidentiality is now a documented adoption barrier, not a vibe.** At the professional level, fear is measurably suppressing AI use — which means there's a large population of professionals who *want* AI but have been told (or have decided) they can't safely touch it. That's not a market you have to create; it's a dammed-up one you get to release.

The window remains the same 12–24 months your Claude report named: long enough to win a beachhead, short enough that incumbents will eventually bolt on "local mode." Move while the moat is real.

---

## 3. Three new verticals neither report covered

Your two reports between them covered therapists, novelists, lawyers (general), academics, journalists, genealogists, clergy, screenwriters, defense/ITAR engineers, prosumers, coaches, marketing agencies, architects, and patent attorneys. That's thorough. Here are three sharp, high-value segments that fell through the cracks — each with a confidentiality hook at least as strong as the best ones already on your list.

### 3A. Accountants, CPAs & tax preparers — the *criminal-statute* vertical

This is the one I'd add to Tier A immediately. The legal vertical's confidentiality duty is an *ethical* obligation enforced by a bar association. The accounting vertical's is, in part, a **federal crime**.

**The hook.** Internal Revenue Code Section 7216 makes it a federal crime for a tax return preparer to disclose or use a client's tax information for anything beyond preparing the return, backed by criminal fines up to $1,000 per offense (or up to $100,000 in aggravated cases), up to a year in prison, and separate civil penalties. And the bar for liability is low — there's no malicious-intent requirement: all that is required is for the tax return preparer to know that they released client tax return information to someone other than the taxpayer. Pasting a client's W-2 or K-1 into ChatGPT is, on a plain reading, a disclosure to "someone other than the taxpayer."

**Why Projelli fits uniquely.** The definition of who's bound is deliberately broad — software developers whose products are used to prepare or file returns qualify as tax return preparers, as do authorized IRS e-file providers, data processors, and other firms providing auxiliary services. The whole profession is primed to think hard about where client data goes. A tool where the data physically never leaves the preparer's machine sidesteps the disclosure question entirely. Drafting client memos, summarizing a stack of receipts, reconciling documents, drafting engagement letters, explaining a notice — all local, all under the preparer's sole control.

**Willingness to pay.** High and stable. This is a $14B+ industry — revenue for tax preparers in the United States has grown at a CAGR of 2.7% over the past five years, reaching $14.3 billion in 2025. Solo and small-firm preparers already pay for software stacks; $49–$99 once against the downside of a *criminal* penalty is trivial.

**The interesting twist on your "files-only-on-your-machine" pitch.** The Gemini report worried (correctly) about financial advisors having SEC *recordkeeping* obligations that fight a "nothing is retained" pitch. CPAs have the same tension, but milder, and you can turn it into a feature: because Projelli stores everything as **plain Markdown files the preparer owns and controls**, it satisfies "maintain control over the transfer of data" rather than fighting it. It is critical for CPAs to maintain control over the transfer of data to assure that their clients' confidential information is not compromised. Local files under the firm's own retention policy is *more* controllable than a vendor cloud, not less.

**How you reach them cheaply.** r/Accounting, r/taxpros (large, vocal, busy-season-anxious), AICPA channels, state CPA society CPE programs (a "Use AI without violating 7216" CPE session is the accounting analog of the legal CLE talk your reports already flagged as gold), and the dense ecosystem of accounting-firm-growth newsletters and LinkedIn voices. The seasonal rhythm is a gift: demand spikes hard Jan–April, so a Q4/January launch rides the busy-season tooling-purchase wave.

**Templates to ship.** Client memo drafter, engagement-letter generator, IRS-notice explainer, document/receipt summarizer, reconciliation note scaffold, "explain this tax concept to a client in plain English" helper, a 7216-consent-letter drafting aid.

**The catch.** Conservative, busy, and seasonally unavailable for half the year. But sticky and referral-heavy, exactly like the legal segment. **Fit: 9/10** — arguably the strongest single addition to your list.

### 3B. M&A advisors, private-equity deal teams & corporate-development professionals

This is the high-ceiling B2B wildcard. The Gemini report touched "regulated enterprise" abstractly; this is a specific, reachable, extremely-high-WTP slice where the demand signal is unusually concrete.

**The hook.** Deal professionals handle the most sensitive documents in the economy — and their *own contracts* are now banning the obvious AI tools. In M&A, buyers and their advisors increasingly use AI to review data rooms and summarize contracts, but not all AI platforms are compatible with traditional NDA obligations, and many publicly available AI tools operate under terms of service that conflict with standard M&A confidentiality provisions. The result is an explicit prohibition trend: there's a sharp rise in NDA and VDR clauses that prohibit uploading confidential information into AI systems that may retain, expose, or train on that data.

**Why Projelli fits uniquely.** A deal associate needs to interrogate a 400-page data dump — "what are the change-of-control provisions across these contracts," "summarize the customer-concentration risk," "build me a timeline of this company's financing history" — exactly the local-RAG-over-PDFs workflow Projelli is built for. But they're contractually forbidden from using the cloud tool that would do it. Projelli lets them run that analysis with a local model, on their own machine, with nothing transmitted. The strategic framing writes itself: the strategic response to an NDA AI-prohibition clause is to build an environment that deserves trust, then codify it contractually. Projelli *is* that environment.

**Willingness to pay.** The highest of any segment on any of these lists, full stop. These professionals bill at rates that make even a $499 license a rounding error, and the downside they're insuring against is blowing a nine-figure deal or breaching an NDA with a strategic acquirer. **This is the one segment where I'd seriously consider a separate, much higher-priced "Deal Team" tier** (see §6).

**The catch.** Distribution is harder — these people don't hang out in open subreddits. Reach is via deal-community newsletters (the kind that already sell $199 "boardroom-grade playbooks"), VDR-adjacent content, corp-dev Slacks, and direct outreach. This is a land-and-expand / founder-led-sales motion, not a community-marketing motion. Treat it as a high-value secondary, not your first beachhead — but a *very* lucrative one once you have a case study. **Fit: 8/10 on economics, 5/10 on reachability.**

### 3C. Estate-planning & elder-law attorneys — the fast, soft entry into the legal market

If general litigation feels too slow and conservative to be your *first* legal beachhead, this sub-segment is faster, warmer, and just as well-funded.

**The hook.** These attorneys handle uniquely intimate data (family conflicts, asset disclosures, capacity questions, end-of-life wishes) and the profession is openly wrestling with AI consent right now. Attorneys need to tell clients they're going to use AI and how, and get consent — and like any computer system, AI systems can be hacked, which could disclose confidential information; if the attorney didn't get consent, the client could have a claim. The recommended posture is striking: remember that the AI will remember whatever you tell it, so don't include any confidential information. That's a professor of estate law publicly advising attorneys *not to put client info into cloud AI* — which is precisely the constraint Projelli removes.

**Why it's a better first legal beachhead than litigation.** Estate/elder-law is a relationship-and-trust business where security is explicitly a client-facing differentiator: in estate planning and elder law especially, trust is not a marketing concept, it is the foundation of every client relationship, and clients judge how confidently a firm handles their personal data. Firms are also under direct financial pressure to improve security posture: firms with weak security practices may see insurance premiums rise or applications denied entirely, so law firm data security directly influences both operational and financial risk. A $99 tool that demonstrably reduces exposure is an easy yes against rising malpractice-insurance costs.

**WTP / reach.** High WTP, and reachable through estate-planning practice-management communities, elder-law listservs, the (very active) estate-planning CLE circuit, and bar elder-law sections. **Fit: 8/10**, and it's the legal-market door I'd knock on first.

---

## 4. The competitive map both reports skipped

This is the biggest analytical gap in your existing reports. Neither seriously examined the *local-LLM application* category — which is exactly the shelf Projelli sits on. Knowing it cold is the difference between "another local AI app" and a defensible position.

**The category has matured fast and is converging.** Running LLMs locally isn't a trend anymore; it's become essential infrastructure, and while Ollama remains a solid starting point, the local LLM ecosystem has matured dramatically. The runners and clients are blurring into each other: in 2026 both tools moved into each other's territory — LM Studio added a headless server mode, Ollama added a desktop interface — the products are converging, which happens when a category matures.

**Who's actually on the shelf, and what they are:**

- **LM Studio** — remains the top pick for desktop users. A polished model-runner and chat UI. *Not* a knowledge workspace; no wiki-links, no owned-files knowledge base, no vertical templates.
- **Ollama** — the backend infrastructure layer. The better local AI backend; if choosing only one for personal use, choose LM Studio. Projelli *uses* Ollama; it doesn't compete with it.
- **AnythingLLM** — the clear winner for document-centric RAG use cases. This is your closest functional competitor on the RAG axis. But it's positioned as a general developer/team tool, not a verticalized, own-your-files, trust-first product for a named profession.
- **Jan** — released under the MIT license with no telemetry or cloud dependency by default, all inference on-device — one of the safest options for air-gapped requirements. Jan has doubled down on agentic workflows with Project workspaces and Browser MCP. Strong privacy story, but developer/power-user-flavored and free/open-source — a different go-to-market entirely.
- **Msty / Msty Studio** — a privacy-first AI platform for running local and online models, whose free desktop plan includes local and online model chat, knowledge stacks, agent mode, personas, and prompt tools. The most "polished consumer workspace" competitor, aimed at non-technical users. Watch this one.
- **Open WebUI** — evolved into a near-standalone platform with built-in RAG, web search, and pipeline support, supporting workspace-based document management. Self-hosted, server-flavored, technical audience.
- **GPT4All** — the simplest privacy-first option, though it now also supports remote providers alongside local models.

**The whitespace, stated precisely.** Every product above competes on being a *better general-purpose local AI tool*: more models, faster inference, better RAG, more agentic features. They are racing each other on horizontal capability and most are free or open-source. **Not one of them is a verticalized, trust-first, own-your-files knowledge workspace sold to a specific confidentiality-bound profession with that profession's templates, language, and proof points.** That is Projelli's lane, and it's empty.

Your moat is therefore *not* "we run local models" — everyone does that now, and you'll lose a features race against free MIT-licensed tools. Your moat is the **combination** the Claude report identified for novelists and that generalizes to every vertical: own-it-once + never-trained + offline-capable + workspace-aware RAG + wiki-linked knowledge base + **a specific profession's trust story and templates**. Each competitor has two or three of these. None has the set *plus* the vertical focus. Pick a profession, own that combination for them, and the horizontal tools simply aren't in the consideration set — a tax preparer evaluating "AI that won't get me indicted under 7216" is not cross-shopping LM Studio.

**Implication for positioning:** stop describing Projelli as a "local AI workspace" (that's a crowded commodity category now) and start describing it as, e.g., "the AI workspace for tax season that keeps client data off the cloud." The category name is the trap; the vertical name is the moat.

---

## 5. Distribution: the part both reports were thin on

Both reports told you *which communities exist* but not *how the motion actually works* or *which channels to avoid.* Here's the operational layer.

### Avoid the lifetime-deal marketplaces (at least at first)

It will be tempting to launch on AppSumo for a fast cash injection. For a privacy-vertical product, it's a trap. The economics are brutal — AppSumo's model relies on a 70-30 revenue split, keeping 70% while software partners receive 30%, which creates immediate cash flow but often leads to sustainability issues long-term. Worse, it brings exactly the wrong customers: a successful AppSumo campaign can flood your inbox with support requests from deal hunters who are not your ideal customers, and weak post-campaign relationships mean poor data sharing and no real follow-up. Deal-hunters are the over-marketed, support-heavy, churn-prone crowd you specifically chose to leave behind when you abandoned indie founders. A therapist or tax preparer who needs a confidentiality tool is not browsing AppSumo for a 90%-off code.

Selling direct is also a *trust signal* in itself: direct deals on a company's own site provide better economics and can represent better sustainability signals — a company confident enough to sell on its own product page rather than needing a marketplace for customer acquisition. For a product whose entire pitch is "trust me with your most sensitive data," sustainability signaling matters more than a cash spike.

### The motion that actually fits each tier

- **Consumer/prosumer verticals (therapists, novelists, genealogists, clergy):** community-led. One genuinely useful flagship post or guest essay in the densest channel, then let the prosumer/local-LLM crowd amplify. The pattern that works: *teach the problem first* (a CLE/CPE/webinar on "the privilege/7216/NDA risk") and let the product be the obvious answer at the end. You are not selling software; you are answering a fear the audience already has.
- **High-WTP professional verticals (M&A, corp-dev, big-firm-adjacent):** founder-led sales and credibility content. These buyers are reached through paid newsletters and direct relationships, not subreddits. One marquee case study unlocks the rest.
- **Across all of them:** the thing that compounds is **proof, not reach.** A risk-averse buyer needs (a) a one-page, plain-English data-handling explainer a manager can read in 30 seconds, and (b) a credible third party they can point to. For lawyers that's now *Heppner*; for accountants it's §7216; for deal teams it's their own NDA's AI clause. Build one of these proof-pages per vertical and your community posts have something to land on.

### The "wedge community" insight

The Claude report nailed this and it's worth elevating: the privacy/local-LLM prosumer crowd (r/LocalLLaMA, r/ObsidianMD, r/selfhosted, the Ollama community) is your *first 100 customers regardless of which vertical you formally target*, because they're already looking for exactly this and they evangelize. Use them as the launch amplifier and the proving ground for the product, then layer a vertical on top for the *paying-at-scale* motion. They're the demand-gen flywheel; the vertical is the revenue engine.

---

## 6. Product & packaging moves (not just marketing skins)

Both reports correctly noted that swapping templates is the cheapest high-leverage change. True. But to win the high-WTP segments and to make the trust claim *verifiable*, a few product moves are worth more than any template.

**1. A one-click "Audit Mode" / data-handling proof.** The single biggest objection from every professional buyer is "prove it doesn't leak." Build a visible, exportable indicator: a panel that shows network activity (ideally: zero outbound while in local mode), a plain-English log of "what left this machine and when" (nothing, unless BYOK was explicitly invoked), and a one-page exportable "data-handling summary" the user can hand to a managing partner, IRB, or client. Modern compliance frameworks require provable auditing of data boundaries; a locally installed application provides a clear, mathematically defensible boundary versus the opaque retention policies of cloud providers. Make that boundary *visible*, not just real. This is the feature that converts the conservative buyer.

**2. Tiered pricing by vertical, not one global price.** The $49/$99 anchor is perfect for novelists (Scrivener is $49) and genealogists (DEVONthink is $99). It is *leaving money on the table* for attorneys, deal teams, and CPAs, where the Claude report already noted you could raise price without resistance. Consider:
   - **Personal / Creator** ($49 once) — writers, genealogists, students, prosumers.
   - **Professional** ($99–$149 once) — therapists, clergy, solo CPAs, solo/estate attorneys.
   - **Practice / Deal Team** ($299–$499 per seat, or a small-firm site license) — M&A/PE, multi-attorney firms, firms that want the audit-mode artifacts for their compliance file.
   The architecture is identical; only the price, templates, and proof-page differ. A one-time license read as *CapEx, not OpEx* is precisely what these markets want — it shifts the software from an unpredictable ongoing operational expense to a negligible fixed capital expenditure, and lawyers strongly resist paying ongoing vendor "AI premiums."

**3. Lean into the dormant localization as a real wedge, not an afterthought.** You already shipped Spanish and German UIs (421 strings) and do nothing with them. Germany's privacy culture is famously intense; a "local-first, nothing-leaves-your-Rechner" pitch in German, to German professionals, is a near-uncontested market most US indie tools never touch. This is sunk-cost optionality — test a German-language landing page for one vertical (clergy or academics translate cleanly) at essentially zero build cost.

**4. A "matter / case / client" container primitive.** All your high-value verticals share one structural need: segregating work by client/matter/case with a clean boundary (this is half of what data rooms and practice-management tools sell). A first-class "workspace per matter" concept — each its own folder, its own RAG index, exportable and archivable as plain Markdown — maps directly onto how lawyers, accountants, and deal teams already think, and it's a small extension of your existing folders-on-disk model.

**5. Resist the agentic-features arms race.** Jan, Open WebUI, and others are racing toward agents, browser tools, and pipelines. Don't chase them. Your buyer doesn't want a more autonomous agent touching their privileged data — they want a *contained, auditable, boring, trustworthy* tool. "Less magic, more control" is the correct product philosophy for this audience, and it's the opposite of where the horizontal tools are sprinting.

---

## 7. Unconventional plays (the genuinely out-of-the-box swings)

These are higher-variance ideas neither report raised. Each has a real thesis.

**7A. "Bring your own compliance officer" — sell to the gatekeeper, not the user.** In every regulated vertical there's a person whose job is saying *no* to risky tools: the law-firm risk partner, the practice compliance officer, the IRB administrator, the agency ops director. They are usually the *blocker*. Flip them into the *champion* by building a "for compliance reviewers" page and a downloadable security brief written in their language. The Gemini report's instinct to sell to CTOs/ops directors was right; sharpen it to "make the person who blocks AI the person who recommends Projelli." One approving compliance officer unlocks an entire firm.

**7B. The "post-incident" trigger.** Data breaches and AI mishaps are now regular news, and each one is a buying trigger for the affected profession. A lightweight content engine that responds to each new ruling/breach/enforcement action with a calm "here's how local-first would have prevented this" explainer turns the news cycle into your top-of-funnel. *Heppner* is the template; there will be more. You don't chase the news — you let the news deliver pre-frightened buyers to a standing explainer.

**7C. Sell the *category education*, get the product for free.** Run the CLE/CPE/webinar circuit as the actual product-led-growth motion. A solo founder who is also a credentialed-sounding educator on "AI without waiving privilege / violating 7216 / breaching your NDA" becomes the trusted voice, and the tool is just the natural conclusion. This plays directly to your background — two master's degrees, behavior-change/psychology, academic-writing context. You can credibly *teach* these audiences, which most indie founders can't. This is your unfair advantage and neither report used it as a *distribution* strategy (only as a credibility note).

**7D. The "second opinion / sanity check" wedge for solo practitioners.** Reframe Projelli for solos not as "do the work" but as "a private colleague to think out loud with." A solo therapist has no peer down the hall; a solo attorney has no associate to pressure-test a theory; a solo CPA has no second reviewer. The recommended way to use AI is to make it explain, ask for citations and references so you can verify, and provide context. Positioning Projelli as the *private sounding board that never tells anyone* — the colleague who's bound by the same confidentiality you are because it literally cannot leak — is an emotional pitch that no cloud tool can honestly make. This is the "negotiation shadow / ghost collaborator" idea from your own past research, pointed at a paying market.

**7E. Faith-community distribution as a genuine channel, not a soft market.** The Claude report treated clergy as a modest-economics segment with high personal leverage. Reframe: your active faith-community leadership role isn't just credibility, it's a *literal distribution channel* into a national network of denominational groups, ministry conferences, and pastor communities — and pastoral-counseling notes carry real confidentiality duties. A single well-received talk in that world reaches thousands of pastors who each buy their own tools. Low per-head revenue, but near-zero customer-acquisition cost *for you specifically*, and a warm, trust-first audience that's the opposite of deal-hunters. Treat it as a cheap, high-trust proving ground for the messaging you'll later sharpen for higher-WTP verticals.

**7F. "Air-gapped edition" as a premium SKU for the paranoid-by-mandate.** The defense/ITAR engineers your reports flagged as hard-to-reach are real, and so are government legal departments — government legal professionals must protect not just client confidentiality but national security information, classified data, and sensitive citizen information, and the risks of consumer AI in government legal operations extend far beyond typical privacy concerns. A documented, fully-offline "air-gapped edition" (with the audit-mode proofs from §6) is a high-price, low-volume, near-zero-competition SKU. Don't lead with it, but having it on the menu lets a single procurement officer buy a stack of seats. Distribution is the bottleneck, not demand.

---

## 8. The revised ranked recommendation

Folding the new verticals and research into the priority stack from your Claude report (willingness-to-pay first, cheap reach second, underserved gap third, your enjoyment last; "surprise me, ignore my background"):

| Rank | Market | WTP | Reach | Gap | New? | Verdict |
|---|---|---|---|---|---|---|
| **1** | **Tax preparers / CPAs (§3A)** | High | Easy (seasonal) | Wide | ✅ new | *Criminal-statute hook + clear channels + Q1 timing. Strongest addition.* |
| **2** | **Solo/estate attorneys (§3C)** | Very high | Medium | Wide | ✅ refined | *Heppner gives you case law; estate sub-segment is the fast door.* |
| **3** | **Patent / IP attorneys** | Highest | Medium | Wide | (Claude's #1) | *Still excellent; catastrophic-disclosure hook unchanged.* |
| 4 | **M&A / PE deal teams (§3B)** | Highest | Hard | Wide | ✅ new | *Best economics on the list; needs founder-led sales + one case study.* |
| 5 | Novelists | Good | Easy | Medium | — | *Fastest to first-100; perfect $49 anchor; fun.* |
| 6 | Therapists | High | Easy | Medium | — | *Great fit/background; compliance-tightrope messaging = support cost.* |
| 7 | Genealogists | Good | Easy | Medium | — | *Underrated; Utah backyard advantage; older paying demographic.* |
| 8 | Clergy (as a *channel*, §7E) | Low–Mod | Very easy *(for you)* | — | refined | *Treat as distribution + proving ground, not a revenue center.* |
| 9 | Academics / researchers | Moderate | Easy | Medium | — | *Natural expansion; free-tool competition; IRB hook is real.* |
| 10 | Prosumer / local-LLM | Low–Med | Easy | — | — | *Your first 100 + amplifiers regardless of vertical.* |
| 11 | Defense / gov / air-gapped (§7F) | High | Hard | Wide | refined | *Premium SKU; procurement-led; don't lead with it.* |
| 12 | Marketing/creative agencies | Mod (per seat) | Medium | Medium | (Gemini's) | *NDA-clause tailwind is real; B2B seat motion.* |

### The actual move

The advice from both your reports holds and I'd reinforce it: **pick ONE beachhead, reposition for 90 days, and make everything say the same specific thing to the same specific person.** The new research changes *which* one, not the strategy.

My recommendation, given your stated weights (WTP + cheap reach + underserved gap, enjoyment last):

- **Lead beachhead: tax preparers / CPAs.** It's the rare segment that's simultaneously high-WTP, cheaply reachable (dense pro communities + CPE circuit), sitting on a wide-open gap, *and* has a visceral, criminal-statute hook that needs zero education. Launch in Q4/January to ride busy-season tooling purchases. Build the §6 audit-mode proof and a one-page "7216 and where your client data goes" explainer.
- **Fast-follow: estate/elder-law attorneys**, using *Heppner* as the proof-page. Same architecture, swap templates and proof.
- **Keep the prosumer/local-LLM crowd as launch amplifiers** (they'll find you regardless).
- **Hold M&A/PE deal teams as the high-value B2B expansion** — pursue one marquee case study, then let it open the rest.
- **Use your faith-community network and the CLE/CPE circuit as distribution engines**, not as separate markets to serve.

If your priority were *fastest to first sales and most fun* instead of pure WTP, swap the lead to **novelists** — biggest, most online, perfectly $49-anchored, and pre-sold on every pillar.

---

## 9. One blunt closing thought

Your reports were right that you stopped selling to the only audience that had to be *convinced* your value proposition mattered. The new research sharpens that into something stronger: **the market is now actively manufacturing your buyers for you.** A federal judge just told every lawyer that consumer AI can waive privilege. A criminal statute already told every tax preparer that leaking client data is a federal crime. Corporate NDAs are now writing "no cloud AI" into the contract. IRBs forbid it. Estate-law professors advise against it.

You don't have to create demand. You have to *stand in the doorway* every one of these pre-frightened professionals is already walking toward — with a tool that does the one thing none of the horizontal local-AI apps bothered to do: speak their specific language, ship their specific templates, and prove, on their machine, that nothing ever left.

Pick the doorway. Build the proof. Say one specific thing to one specific person.

*— End of expanded report —*
