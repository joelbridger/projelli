> ⚠️ **ARCHIVED / SUPERSEDED — kept for history.** Part of the 2026-06-17 "product is mature, stop building" cluster, overturned by 2026-06-20 Windows testing and the 2026-06-23/29 advisor re-aim. The traction analysis is still useful; the "stop building / retreat to a niche" conclusion is not. Current direction: `docs/strategy/2026-06-29-board-decision-leading-advisor-ai.md`. See this folder's `README.md`.

# Keepance — Evidence-Backed Evaluation & Shortest Path to Traction

**Date:** 2026-06-17
**Prepared by:** Claude (investment-committee lens, Claude-only research, no local models)
**Lens (chosen by Jameson):** Assume Keepance continues. Focus on the real blockers and the fastest credible route to the first paying customers.
**Companion memo:** `2026-06-17-email-search-standalone-viability.md`
**Evidence base:** the live repo + server data (license validator, firm DB, GitHub releases, Plausible), the canonical pricing config, the strategy/UX-research docs, and four cited Claude web-research streams (legal-tech competition, legal GTM, prosumer email market, ethics/confidentiality).

---

## Verdict up front

**The product is built and genuinely good. The business is pre-traction — effectively zero customers — and the binding constraint is no longer engineering. It is distribution and trust.**

Keepance has, for a solo-built effort, a remarkably mature product: v3.2.0, signed on three platforms, deep features (Word-native editing, AI redline, matter-scoped cited recall across email and documents, SSO, an encrypted vault, live co-editing), a polished website, and a working in-browser demo. And it has, by every server-side signal, **no market validation at all**: zero real license activations, an empty firm database, ~225 total website visitors in ten weeks (almost all direct), and only founder-test orders. Commercially this is pre-seed/idea-validation stage, regardless of how finished the product feels.

The thesis — "local-first, private AI for a law practice" — is **real but narrower and more contested than the marketing implies.** It is a genuine wedge, not a category-killer, and it is slowly narrowing as cloud vendors add BYOK and zero-retention.

**The recommendation is uncomfortable but clear: stop building and start hand-selling.** Pick one litigation niche, fix the credibility contradictions that are actively bleeding trust, manufacture proof (named attorneys, earned media, one conference), and sell the first ten customers by hand. The single biggest risk to Keepance right now is continuing to treat a go-to-market-and-trust problem as an engineering problem — polishing a product that no one has yet bought.

---

## 1. Where Keepance actually is (the hard evidence)

| Signal | Reality | Source |
|---|---|---|
| Product maturity | **High** — v3.2.0, signed Win/Mac/Linux, auto-update, deep feature set, polished site + live demo | repo + `docs/operations/2026-06-13-CURRENT-STATE.md` |
| Paying customers | **0** | — |
| Real license activations | **0** — all 3 records are the founder; one machine ID is literally `funnel-proof-…` | `services/license-validator/data/*.jsonl` |
| Firm backend | **Empty** — 0 orgs / users / seats / matters across all 17 tables | `services/keepance-firm-backend/…sqlite` |
| Downloads | **310 all-time** (inflated by `.sig` files + auto-updater polling), **17 for v3.2.0**; historical peak was v2.0.0 at 85 | GitHub Releases API |
| Website traffic | **225 unique visitors in 10 weeks** (since Apr 7), ~all **direct**; Google sent ~54 pageviews *ever*; ~5 "Buy click" events; **0 real sales** | Plausible (ClickHouse, site_id 6) |
| Email signups | Empty charter list; only synthetic + founder entries | `sign-ups/` |
| Financial model | **Stale** — still models the retired one-time $49/$99 pricing and a $10K-MRR / $72K-year-one target; **no model for the current per-seat subscription; no CAC/LTV** | `KEEPANCE_BUSINESS_PLAN.md` |

**Read:** a finished product meeting an untested market. The landing page is strong and the conversion surface (trial CTA, demo, founding-rate capture) is well-built — so the failure is *upstream of the page*. Almost nobody arrives. That is a distribution problem, not a conversion problem.

## 2. The thesis check: is the wedge real?

**Yes — but it is a trust-multiplier and tiebreaker, not the thing that closes the sale, and it is narrowing.**

**What's genuinely in Keepance's favor (well-evidenced):**
- The confidentiality anxiety is real and quantified: data security is the **#1-2 barrier to legal AI adoption in every major survey** (ABA 2024: 47.2%, second only to reliability at 56%; Thomson Reuters 2023: 62% of lawyers / 80% of partners concerned; TR 2024: 68%). 79% of lawyers used AI in 2024 but only ~10% of firms have a usage policy — a wide-open risk gap.
- **Florida Bar Op. 24-1 (Jan 2024)** is the single strongest, most product-specific ethics line available: *"If the use of a generative AI program does not involve the disclosure of confidential information to a third-party, a lawyer is not required to obtain a client's informed consent."* A fully-local/no-egress tool **removes the informed-consent burden that ABA Op. 512 imposes on cloud AI.** That is a true, citable, workflow-level advantage.
- **U.S. v. Heppner (SDNY, Rakoff, Feb 17, 2026):** exchanges with consumer-grade GenAI are not privileged. Local means **no third party to subpoena, no waiver risk.** (Opinion text corroborated across multiple secondary sources and consistent with the project's own records; not independently pulled.)
- Real bans (Mishcon de Reya banned staff ChatGPT) and the Samsung source-code leak make the fear concrete.
- Keepance's hardest-to-copy specifics: **indexes everything across silos including email** (vs. siloed Clio Duo / Copilot), **Windows + litigation-specific** (vs. Mac-only, uncertified Elephas), and **verifiable by architecture** rather than by a security report you can't read.

**The honest counter-argument (this is where the marketing over-reaches):**
- The market's default answer is **cloud-with-assurances, not local.** Every serious vendor now recites no-training + AES-256 + SOC 2 Type II + private/regional tenancy + zero-data-retention, increasingly plus **BYOK/customer-managed keys.** That stack rests on Azure's documented posture (data stays in the customer's tenant, not used to train, customer-managed-key option, ZDR opt-out) — so a small firm already on Microsoft 365 has a credible "our data stays in our tenant" story without Keepance.
- **BYOK is no longer unique to local-first.** LexisNexis Protégé shipped customer-held encryption keys + kill-switch in May 2026, "already deployed in AmLaw 100 firms." The high end of the privacy bar is being met by the cloud incumbents.
- **The bar blesses the cloud.** Under the same "reasonable efforts, not perfect security" standard, 20-30 state bars already approved cloud storage/computing. Lawyers are migrating *to* the cloud (~75% adoption, up from 69% in 2023), not away from it.
- **Local AI has real, conceded downsides:** a model-quality/hallucination gap (local models are ~"80% as good," and hallucination is *the* live malpractice risk), IT burden / no SLA, the "local LLM security paradox" (a DIY box can be *less* secure than hardened cloud), and **no SOC 2 on a self-hosted rig — which makes the "reasonable efforts" defense harder to demonstrate, not easier.**

**Net:** the wedge is real and defensible, but it wins deals as the *reason a nervous lawyer trusts you to do the job*, not as a standalone reason to buy. Weight the pitch ~70% outcome ("does your work and won't waive privilege or leak client data"), ~30% architecture proof. And note the internal tension you must handle honestly: "nothing leaves the machine" is only literally true in **local-model mode** (which has the quality gap); the **BYOK-direct** path sends data to the user's own AI provider (no-training, no Keepance server, but still a third party). Keepance already frames this correctly as the Local-only / BYOK-direct / Assured spectrum — keep that honesty; it's an asset.

## 3. The real blockers, in priority order

**1. Distribution / no top-of-funnel (the binding constraint).** 225 visitors in 10 weeks, overwhelmingly direct, ~54 Google pageviews ever, negligible social/referral. There is no acquisition engine. Nobody is arriving to convert. Everything else is secondary to this.

**2. The trust/proof-moat is empty *and self-contradicting*.** No named attorney references, no formed legal entity (sole proprietor "Jameson S Daines"), no DPA, no SOC 2, an EULA capping liability at the greater of fees or $100. For a **firm** risk committee that does diligence for a living, that is a hard stop; for a **solo** pilot it's acceptable *if stated plainly*. Worse, the public documents contradict each other:
   - The **Firm pricing tier sells "The assurance package: DPA, trust center, SOC 2 readiness"** (`src/config/pricing.ts:125`) — while `vs/jump.html`, the press-kit comparison matrix, and the one-pagers all state plainly that Keepance has **no SOC 2 and no signed DPA yet** ("pursuing… does not have it yet… a real blocker for some buyers today").
   - Your own attorney-UX research already flagged this class of problem: public docs contradict each other on pricing, licensing, version numbers, and template counts (15 vs 18 vs 28), and *"to a lawyer, inconsistency reads as unreliability."*
   This actively undermines the one thing the product sells — trust — with exactly the buyer you most want.

**3. The ICP has never been validated.** The strongest *real* pain signal in the entire record came from a CFP (Jameson's wife, an advisor), not a litigator. Keepance has never sold to, or seriously interviewed, the stated ICP (litigation solos/small firms). The pricing was set by a model built for a different, retired product.

**4. Single-operator concentration + the build-treadmill.** Months of deep engineering (3.0 vision, vault, co-editing) have happened with zero customer contact. The risk is structural: building is the comfortable, controllable activity; selling is uncomfortable and uncontrollable, so the default keeps being "build more." That default is the thing to break.

## 4. The shortest credible path to the first ~10 paying customers

Synthesized from the GTM and ethics research. This market buys on peer trust, referrals, and live demos — **not** advertising or paid lead-gen. The sequence:

**Step 0 — Stop building. Freeze the feature set.** The product is already far more than enough for ten customers. Wave 5 connectors are vendor-gated and out of your control anyway. Every engineering hour now is an hour not spent getting a customer. This is the hardest and most important step.

**Step 1 — Pick ONE niche and ONE job-to-be-done.** Not "the private intelligence layer." Something like "find any email or document across a matter in seconds, with a citation you can click — for solo and small-firm litigators." Strongly consider running the **CPA / IRC §7216 angle in parallel**: it is arguably the *cleanest* regulatory fit ("the AI must reside in a system you can control"), and it's where your only real pain signal actually came from. Vertical focus is the through-line of every bootstrapped legal-tech winner (Casetext, Smokeball, the 2026 Startup Alley cohort).

**Step 2 — Fix the credibility contradictions first (days, not weeks; it's bleeding now).** Reconcile every public surface on pricing, version, template counts, and assurances. Either remove "DPA / SOC 2 readiness" from the Firm tier or label it explicitly as roadmap. Decide solo-first vs. firm honestly and say so. This is cheap and it stops actively destroying trust.

**Step 3 — Manufacture credibility before asking for money.** In a market where trust is everything: pitch **Bob Ambrogi / LawSites** and **Lawyerist** for a product write-up or demo (Ambrogi is *the* person to send a new legal-tech product to); **apply to ABA TECHSHOW Startup Alley** (free application; stage + exhibit + audience vote — the single best concentrated exposure for an indie); guest on legal podcasts; speak a free CLE at a state/local bar's solo-small-firm section. And **own the "private by architecture, not by promise" narrative** — no neutral analyst champions local-first yet, and vendor SOC 2 claims are NDA-gated (CoCounsel's is even contradicted by Microsoft's own certification registry). That's a thought-leadership lane sitting empty.

**Step 4 — Recruit 3-5 design-partner lawyers (free pilots) for testimonials.** The proof-moat *is* named attorneys; each vouching lawyer lowers the cost of the next ten. Recruit via bar sections, targeted/useful LinkedIn outreach (Harvey's founder cold-DM'd thousands of lawyers, leading with value not features), your wife's professional network (the advisor/CPA parallel wedge), and referrals. Over-serve them; convert their words into the references firms require.

**Step 5 — Found-led demos; sell the outcome, prove it with local.** Run live 10-20 minute demos on the prospect's own matter. Lead ~70% with the protected outcome, ~30% with the architecture. Anchor on **Florida 24-1** (skip the client-consent paperwork) and **Heppner** (no privilege waiver). Pre-empt the four objections: model quality → **BYOK pointed at frontier Claude/GPT while data stays local** (your real edge over pure-local tools *and* over cloud tools: frontier quality + local data); IT burden → turnkey one-click packaging; "DIY is less secure" → hardened defaults + a SOC 2 roadmap; no certification → verifiability messaging + that roadmap.

**Step 6 — Be listed where they verify, not where you buy leads.** Claim free profiles on Clio App Directory, Capterra, G2, Software Advice so you exist when prospects check. **Defer paid PPC / pay-per-lead** (Capterra ~$500/mo minimum) until you have reviews and a proven demo-to-close motion to amplify.

**Step 7 — Rebuild the financial model** around actual subscription pricing and a real CAC sense from Steps 3-5. The current plan is fiction; you can't steer by it.

## 5. What to STOP doing

- **Building new features.** (See Step 0.)
- **Chasing the Firm tier before you have a single solo customer or any named references.** The firm motion needs the assurance package you don't have; the solo motion needs only "show me a lawyer and tell me where my data is." Win solo first.
- **The absolutist "reject the cloud" framing.** It alienates the ~75% of lawyers who are cloud-comfortable and reads as an IT/setup burden. Position as *"the most provably-private way to get AI's benefit,"* not *"the cloud is unsafe."*

## 6. The email question (cross-reference Memo B)

The standalone email-search research reached, independently, the same place this evaluation does: a mass-market consumer email-search product is a *feature, not a venture* (incumbents are absorbing it for free; Apple shipped free on-device semantic Mail search at WWDC 2026), and **the engine's only defensible home is privacy-bound *professional* search — i.e. inside Keepance.** So email intelligence is correctly placed. It is also your best daily-use beachhead (broken Outlook search is a real, shared pain). **Lean into email as the wedge; do not spin it out.** Full reasoning in `2026-06-17-email-search-standalone-viability.md`.

## 7. Honest risk & a real kill-criterion

Even with flawless execution, this is a narrow, time-sensitive wedge against well-funded incumbents giving away good-enough bundled AI, sold on a privacy angle that is a tiebreaker rather than a driver, by a single non-developer operator with no sales motion. That can work at solo/lifestyle scale; it is unproven at venture scale, and nothing in the data yet says litigators specifically will pay for local-first.

So set a test you'll actually honor, rather than letting "keep building" be the escape hatch: **commit to a fixed window of disciplined hand-selling to the stated ICP. If it yields no paying customers and no design-partner testimonials, the thesis (litigators will pay for local-first) is probably wrong** — and the live options are to pivot the wedge (CPAs/§7216, the cleanest regulatory fit and your strongest real signal) or to accept Keepance as a solo/lifestyle product rather than a company. Define that window and that bar explicitly; don't leave it implicit.

## 8. Confidence & caveats

- **Internal numbers are hard and verified** (server-side reads of the license validator, firm DB, GitHub Releases, and Plausible/ClickHouse).
- **External findings are well-cited Claude research with flagged estimates:** the *Heppner* opinion text was corroborated across multiple secondary sources (and matches the project's own records) but not independently retrieved; some survey percentages rest on secondary summaries; all competitor SOC 2/ISO claims are verified as *claimed*, not audited (their report contents are NDA-gated).
- **Time-sensitive:** legal-AI pricing and the cloud-vendor privacy stack are moving fast (LexisNexis BYOK, monthly Copilot/Gemini changes). Re-check before any major decision.
