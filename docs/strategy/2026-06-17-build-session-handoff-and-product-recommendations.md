# Keepance Evaluation — Handoff & Product Recommendations for the Build Session

**Date:** 2026-06-17
**From:** A separate Claude Code instance that ran a full, evidence-backed evaluation of Keepance (the business + product + keepance.com) at Jameson's request, Claude-only, no local models.
**For:** The main Keepance build session (you) — the instance that actually ships the product.
**Status of this doc:** Advisory strategic input. It does **not** override `KEEPANCE_BUSINESS_PLAN.md` (your operating contract). Where the two conflict, surface it to Jameson — and note up front that I found the business plan's financial model is **stale** (§2), so part of the conflict is that the contract itself needs updating.

**Companion memos (full cited evidence lives here — read them for depth):**
- `docs/strategy/2026-06-17-keepance-evaluation-path-to-traction.md`
- `docs/strategy/2026-06-17-email-search-standalone-viability.md`

---

## 0. TL;DR for you, the builder

1. **The product is mature; the business has ~zero traction.** Verified server-side: 0 real license activations, empty firm DB, 225 keepance.com visitors in 10 weeks (~all direct), 0 real sales.
2. **The binding constraint is distribution + trust, not engineering.** This is the single most important conclusion. More features will not move the needle; trust and reach will.
3. **This conflicts with your standing "complete the vision autonomously" mandate.** Do not silently keep building net-new vision features, and do not silently ignore this either. **Recommend: reorient your build effort toward the traction-unblocking product work in §5, pause net-new vision scope, and confirm the priority shift with Jameson.** This is the one place to check in, because it changes your default.
4. **The thesis (local-first private AI for law) is real but a tiebreaker, not a category-killer, and narrowing.** Sell/build the *outcome*, prove it with local. Never lean on "the cloud is unsafe" — lawyers are moving to the cloud and cloud-with-assurances is the default answer.
5. **Highest-leverage product work is trust-as-a-surface + hallucination-hardening + finishing/foregrounding email.** Details in §5.
6. **Fix the credibility contradictions first (P0, days not weeks).** Your Firm tier sells "DPA, trust center, SOC 2 readiness" (`src/config/pricing.ts:125`) while your /vs/ pages, press-kit matrix, and /security page candidly say you have none yet. That contradiction reads as unreliability to the exact buyer you want.
7. **Email search is a feature, not a standalone venture** — keep it inside Keepance and make it your headline wedge (§7).
8. **Stop deepening the Firm tier and Wave 5 connectors** until you have solo customers (§6).

---

## 1. What this evaluation was

Jameson asked for (a) a full evidence-backed evaluation of Keepance through a "shortest path to traction" lens, and (b) whether the email-search capability could be its own product (mass-market lens). Method: server-side data pulls (license validator, firm DB, GitHub Releases, Plausible/ClickHouse), a read of the canonical pricing + strategy + UX-research docs, and four cited Claude web-research streams (legal-tech competition, legal GTM, prosumer email market, ethics/confidentiality). Everything below is grounded in that.

## 2. The situation, in evidence (what I found server-side)

| Signal | Reality | Where |
|---|---|---|
| Product maturity | High — v3.2.0, signed Win/Mac/Linux, auto-update, deep features, polished site + demo | repo |
| Real paying customers | **0** | — |
| Real license activations | **0** — all 3 records are the founder; one machine ID is literally `funnel-proof-…` | `services/license-validator/data/*.jsonl` |
| Firm backend | **Empty** — 0 orgs/users/seats/matters across all 17 tables | `services/keepance-firm-backend/…sqlite` |
| Downloads | 310 all-time (inflated by `.sig` + auto-updater `latest.json` polls), **17 for v3.2.0** | GitHub Releases API |
| Website | **225 unique visitors / 10 weeks**, ~all direct, ~54 Google pageviews *ever*, ~5 buy-clicks, **0 sales** | Plausible site_id 6 (ClickHouse) |
| Signups | Empty charter list; only synthetic + founder entries | `sign-ups/` |
| Financial model | **Stale** — models the retired one-time $49/$99 pricing + a $10K-MRR target; **no model for current per-seat pricing; no CAC/LTV** | `KEEPANCE_BUSINESS_PLAN.md` |

**What it means:** a finished product meeting an untested market. The landing page is good and converts fine in principle (the demo even gets hammered — `demo_limit_hit` is the top event). The failure is *upstream*: almost nobody arrives, and the few lawyers who would can't yet trust a sole proprietor with no references, no entity, no DPA, no SOC 2, and a $100 liability cap.

## 3. The strategic verdict (read this before you write any code)

**The binding constraint is distribution and trust, not engineering.** You (the build session) are very good at shipping features, and that has produced an impressive product. But the next unit of product effort has near-zero marginal value *unless it directly removes a trust blocker or makes the wedge more sellable*. The structural risk right now is the **build-treadmill**: building is the comfortable, controllable activity; selling is uncomfortable and uncontrollable, so the default keeps being "build more." Months of deep work (3.0 vision, vault, co-editing) have shipped with zero customer contact.

**The honest tension with your mandate:** your CLAUDE.md and `feedback_keepance_autonomous_vision` tell you to complete the vision autonomously and take every recommendation. This evaluation's central recommendation is that *completing more vision is no longer the priority* — trust-unblocking product work + GTM is. Those can't both be the default. **Recommended resolution: treat §5 (traction-unblocking product work) as your build backlog, treat §6 as a stop-list, and explicitly confirm with Jameson before continuing the net-new vision roadmap (Wave 5, etc.).** Don't resolve it silently in either direction.

## 4. The thesis, honestly (so your product decisions are grounded)

**Local-first private AI for law is a real wedge — but a trust-multiplier/tiebreaker, not the thing that closes the deal, and it is narrowing.**

In your favor (well-evidenced):
- Confidentiality anxiety is the **#1-2 barrier to legal AI adoption in every major survey** (ABA 2024: security 47.2%, reliability 56%; Thomson Reuters 2023: 62% of lawyers / 80% of partners concerned; TR 2024: 68%). 79% of lawyers use AI but only ~10% of firms have a policy.
- **Florida Bar Op. 24-1**: if AI involves *no disclosure to a third party*, the lawyer needs **no client consent** — so a local/no-egress tool *removes* the informed-consent burden ABA Op. 512 imposes on cloud AI. This is your single strongest, most product-specific ethics line.
- **U.S. v. Heppner (SDNY, Rakoff, 2026-02-17)**: consumer GenAI exchanges aren't privileged → local = no third party to subpoena, no waiver risk. (Already on file as real per project memory; don't delete it.)
- Hardest-to-copy specifics: **indexes everything across silos including email** (vs. siloed Clio Duo / Copilot), **Windows + litigation-specific** (vs. Mac-only, uncertified Elephas), **verifiable by architecture** (vs. NDA-gated SOC 2 reports — CoCounsel's is even contradicted by Microsoft's own app-cert registry).

The honest counter (this is where the *marketing* over-reaches, and where your *product* must be careful):
- The market's default answer is **cloud-with-assurances** (no-training + AES-256 + SOC 2 + zero-retention + BYOK), resting on Azure's documented "data stays in your tenant / not used to train / customer-managed keys" posture. A small firm on M365 already has a credible privacy story without you.
- **BYOK is no longer unique to local** — LexisNexis Protégé shipped customer-held keys to AmLaw-100 firms (2026-05-07).
- Lawyers are migrating **to** the cloud (~75%), and 20-30 bars have blessed it under "reasonable efforts."
- **Local AI has real downsides you must design around:** a model-quality/hallucination gap (local models ~"80% as good"; hallucination is *the* malpractice risk), IT burden / no SLA, the "DIY box is less secure" paradox, and **no SOC 2 on a self-hosted rig makes the "reasonable efforts" defense harder, not easier.**

**The product implication of all this:** your privacy story and your quality story are in tension. "Nothing leaves the machine" is only literally true in **local-model mode**, which underperforms on legal work. The **BYOK-direct frontier path** (data goes only to the user's own provider under their key, no-training, no Keepance server) is the right *default* — frontier quality + no third-party-Keepance — and you already frame this correctly as the Local-only / BYOK-direct / Assured spectrum (`pricing.ts` `BYOK_FRAMING`). Keep that honesty; it's an asset. Build accordingly (§5).

## 5. PRODUCT RECOMMENDATIONS (your build backlog, by priority)

These are the things worth building *because they unblock customers*. Each ties to a finding above.

### P0 — Trust & credibility (the #2 blocker, and much of it is buildable)

**5.1 Reconcile every public-facing claim. (Days. Highest ROI build task you have.)**
- The Firm tier feature list sells *"The assurance package: DPA, trust center, SOC 2 readiness"* (`src/config/pricing.ts:125`) while `website/vs/jump.html`, `website/press-kit/comparison-matrix.html` (line ~707), and the one-pagers + `/security` say plainly you have **none of these yet**. Either remove the claim from the Firm tier or label it explicitly as roadmap ("planned," not delivered).
- Your own attorney-UX research (`docs/research/2026-06-08-ux-attorney-v2.5.1/`) already found public docs contradict each other on **pricing, licensing (perpetual vs annual), version numbers, and template counts (15 vs 18 vs 28)**. Sweep and reconcile all of them. To a lawyer, inconsistency reads as unreliability — and it's bleeding trust right now, for free.
- **Enforce single-source-of-truth.** `pricing.ts` is meant to be canonical but the contradiction proves surfaces have drifted. Add a check/lint (or at least an audit pass) so every price/tier/claim surface reads from one source. The same discipline should cover version numbers and template counts.

**5.2 Make the trust story a *visible, demo-able, screenshot-worthy* product surface.**
- You already have the egress indicator and the printable Data Map. Elevate them from "feature" to "the thing a prospect screenshots." Consider an in-app **"Where your data is" / confidentiality center** screen that is unmistakable in a 10-minute demo and as a marketing asset.
- Build a **one-click "Confidentiality Report"** artifact the lawyer can keep in the client file or show a client — turning Florida 24-1 + Heppner from a talking point into a tangible deliverable ("this matter's AI ran locally / under your own key; nothing was disclosed to a third party"). That is a buildable, differentiated, *sales-closing* artifact no cloud competitor can credibly produce.

### P0 — Hallucination hardening (this is the live malpractice risk; it's existential for the legal buyer)

**5.3 Double down on cited recall; make uncited claims impossible to miss.**
- "Every answer carries a citation" is exactly the right instinct — it directly answers the 17-33% legal-AI hallucination problem the ABA itself cites. Invest here above almost everything else.
- Make citation-clicking frictionless; make **uncited or low-confidence assertions visually distinct** (e.g., a clear "unverified" treatment); consider a lightweight "verify against source" affordance. For a litigator, a confidently wrong answer is a sanction risk (Mata v. Avianca etc.) — your product's defensibility hinges on never quietly hallucinating.

### P1 — The email wedge (your daily-use beachhead; the email research says this is the engine's real home)

**5.4 Finish and foreground email intelligence.**
- Email is the highest-frequency, most-shared pain (broken Outlook search). The standalone-viability research independently concluded the engine's only defensible home is privacy-bound *professional* search — i.e. exactly this. Make "import your Outlook/Gmail/IMAP and actually find anything, with a citation" a **first-run, time-to-value moment** — the faster a prospect runs a search their own Outlook failed, the faster they convert.
- **Lean into cross-provider search** (Gmail + Outlook + IMAP in one index). No single platform offers this, and they structurally won't — it's a real differentiator.
- Phase 2 ("chat over mail") is designed but not built (`docs/strategy/2026-06-06-email-*.md`). When you build it, the **prompt-injection envelopes are non-negotiable** — email is attacker-controlled content, and the Superhuman zero-click exfiltration is the cautionary tale. Also revisit the flagged residual (mail-index Tauri event passes decrypted body to the renderer — same-process, but document the trust boundary).

### P1 — Kill the adoption-friction objection

**5.5 Turnkey setup, hardened defaults, zero config.**
- "Local-first" invites the IT-burden and "DIY is less secure" objections. Neutralize them in the product: one-click install → first value, sensible hardened security defaults out of the box, no setup homework. Your "Try it in your browser" demo is great for top-of-funnel; make the desktop install→first-search path equally frictionless.

### P2 — Model strategy & honest positioning

**5.6 Default to BYOK-frontier; position local-model honestly.**
- Make the **BYOK-direct frontier-model path the recommended default experience** (best quality + data only to the user's own provider, no-training, no Keepance server). Present local-model mode as the "maximum-paranoia, accept-the-quality-tradeoff" option. Don't let UI or copy imply local-model is the main experience if it underperforms on legal work — that sets up the hallucination risk you can't afford.

### P2 — A learning loop without breaking the no-telemetry promise

**5.7 Opt-in, transparent, design-partner diagnostics.**
- You currently have **zero feedback loop** (no telemetry by design — keep that; it's a selling point). But you need to learn from the first users. Build an **explicitly opt-in, user-visible** feedback/diagnostic mode (especially a consented "design-partner build") so you can see what real lawyers do, without compromising the trust story. Frame it as opt-in + transparent so it reinforces, rather than contradicts, the privacy positioning.

### Pricing/packaging (product config)

**5.8 Consider solo-first simplification.** GTM (§8) says win solo before firm. That implies leading the pricing presentation with Solo/Professional and de-emphasizing (not removing) the Firm tier until you can back its assurance claims. At minimum, make the Firm tier's claims honest (5.1). And get the financial model rebuilt around actual subscription pricing — the current one is fiction and can't steer decisions.

## 6. What to STOP / deprioritize building

- **Firm-tier depth (multi-user, SSO, vault, co-editing extensions).** Built and impressive, but premature: you have zero solo customers, and the firm motion requires the assurance package (SOC 2/DPA) you don't have. Don't add more here until a solo base exists.
- **Wave 5 connectors (Clio / iManage / NetDocuments / Office add-ins).** Vendor-gated, outside your control, and not needed for the first 10 customers. Keep the vendor *applications* warm (those are Jameson's), but don't write speculative integration code now.
- **The feature-first reorg.** It's refactoring, not customer value. If it's nearly done, finish and stop; otherwise time-box it hard.
- **Net-new "vision" features generally** — see §3. Confirm with Jameson before continuing the vision roadmap.

## 7. The email-search-as-product question (cross-ref Memo B)

For the mass market, standalone email search is a **feature, not a venture**, and it isn't close: 30+ years of standalone email search produced zero consumer businesses; incumbents are absorbing it for free (Apple shipped free on-device semantic Mail search at WWDC 2026); a search "layer" on Gmail/Outlook is the weakest position in software; even funded, 2M-user, encrypted Skiff died. **Conclusion: do not spin it out. Keep email intelligence inside Keepance and make it the headline wedge (§5.4).** Full reasoning in `2026-06-17-email-search-standalone-viability.md`.

## 8. GTM context you should build toward

Your product decisions should serve the actual sales motion (which is hand-sold, not self-serve):
- **Niche down to one litigation job-to-be-done** (and consider the CPA/§7216 angle in parallel — cleanest regulatory fit; the only real pain signal came from a CFP, not a litigator). Build the onboarding/demo around that one job, not the whole "private intelligence layer."
- **Sell the outcome, prove with local** (~70/30). Anchor on Florida 24-1 (skip the consent paperwork) and Heppner (no waiver). Pre-empt the four objections: model quality → BYOK frontier (5.6); IT burden → turnkey (5.5); DIY-less-secure → hardened defaults + SOC 2 roadmap; no cert → verifiability (5.2) + roadmap.
- **Credibility before money:** earned media (Bob Ambrogi/LawSites, Lawyerist), ABA TECHSHOW Startup Alley, bar CLEs, and owning the empty "private by architecture, not by promise" thought-leadership lane. Design-partner lawyers → testimonials → the references firms require.
- Build to make a **10-20 minute founder-led demo on the prospect's own matter** land hard. That's the conversion event; optimize the product for it.

## 9. Caveats & confidence

- **Internal numbers are hard and verified** (direct server-side reads).
- **External findings are well-cited Claude research with flagged estimates:** the *Heppner* opinion text was corroborated across secondary sources (and matches project records) but not independently retrieved; some survey %s are secondary; all competitor SOC 2/ISO claims are verified as *claimed*, not audited; Apple's WWDC-2026 on-device-search specifics are tech-press summaries with shipped quality unproven.
- **Time-sensitive:** legal-AI pricing and the cloud privacy stack are moving fast (LexisNexis BYOK, monthly Copilot/Gemini changes). Re-check before major decisions.

## 10. Pointers

- Full evaluation: `docs/strategy/2026-06-17-keepance-evaluation-path-to-traction.md`
- Email viability: `docs/strategy/2026-06-17-email-search-standalone-viability.md`
- Trust/contradiction evidence: `docs/research/2026-06-08-ux-attorney-v2.5.1/`, `src/config/pricing.ts:125`, `website/vs/`, `website/press-kit/comparison-matrix.html`, `website/security/`
- Email design: `docs/strategy/2026-06-06-email-*.md`
- Project memory: `~/.claude/projects/-home-jameson/memory/project_keepance_evaluation_2026_06.md`

**One-line summary for the top of your next session:** *Product is built; traction is ~zero; the constraint is distribution + trust, not features. Reorient build effort to trust-as-a-surface + hallucination-hardening + finishing/foregrounding email, fix the public-doc contradictions first, stop deepening firm/connectors, and confirm the build-vs-sell priority shift with Jameson.*
