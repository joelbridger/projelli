# Competitive Landscape: Master Activation Handoff (for the Advisor Prep Hero build session)

**Date:** 2026-06-08
**From:** the strategy instance. **To:** the Claude Code instance that builds Advisor Prep Hero.
**Purpose:** This is the single handoff for everything we do with the June 2026 competitive landscape. It covers six workstreams: the website builds (already specced, referenced here) plus the five activation follow-ons (blog posts, battlecards, trust/compliance signals, competitor-watch routine, press-kit matrix). Execute all of them.

**Read first (source material):**
- `docs/strategy/2026-06-06-vertical-competitive-landscape.md` — the analysis, the per-vertical head-to-heads, the talking points, and Section 8.5 "Activation." This is your content well; most of what each workstream needs is already in here.
- `docs/strategy/2026-06-06-competitive-build-handoff.md` — the website build spec, with the comparison-page copy already drafted (Workstream 0 below).
- `docs/strategy/2026-06-04-independent-four-vertical-review.md` — the site review; several items overlap (fold, don't duplicate).

**Coordination:** the strategy instance is **not** editing `website/` or anything in the repo for this. All implementation is yours, so we don't race.

**How to execute:** treat this as a program. Use `superpowers:writing-plans` to turn it into per-workstream execution plans under `docs/superpowers/plans/2026-06-08-<workstream>.md`, then execute subagent-driven (the recommended mode; don't ask Jameson to choose). Everything customer-facing is **deploy-gate**: build it, then get Jameson's go before it goes live.

---

## Shared guardrails (apply to every workstream)

These are the same rules as the build handoff. They matter most because this is public, comparative, regulated-audience content, and honesty is Advisor Prep Hero's whole brand.

1. **Honesty and fairness about competitors.** Every comparison states where the competitor genuinely wins and when a prospect should pick them instead. Represent their privacy fairly: "cloud SaaS with a contractual no-training policy," never "they steal your data."
2. **Local-vs-cloud precision (the #1 thing to get right).** Only a **local model** means "nothing leaves your machine." A **cloud BYOK key** still sends the prompt to the provider (Advisor Prep Hero never sees it; the provider does). Never let copy imply a cloud key equals zero egress. Reserve absolutes for the local-model path.
3. **Regulatory framing.** Cite *US v. Heppner* (Rakoff, S.D.N.Y., opinion Feb 17 2026; defendant convicted May 7 2026) as a real but **evolving** leading case, not settled law (later courts are diverging to a fact-specific approach). Always pair regulatory claims (Heppner, IRC §7216/§6713, Reg S-P) with "informational, not legal/tax/compliance advice; verify with your own counsel." Link a credible source for every legal claim.
4. **Pricing.** Advisor Prep Hero's own price comes from the canonical source (don't hardcode). Resolve the open inconsistency first: `/vs/index.html` says "Practice $499 once" while the homepage moved Practice to yearly; make homepage, `/vs/`, and the EULA consistent. Competitor pricing is shown as approximate bands with an "approximate, as of 2026, check vendor" note and an outbound link.
5. **Voice.** No em dashes ever. First-person singular where natural, contractions, concrete nouns, no AI tells (no "leverage / seamless / transform / unlock / empower / elevate," no "it's not X, it's Y"). Match the existing site/blog voice.
6. **Design.** Light theme only. Satoshi. Reuse existing components (the `/vs/` styles, shared nav `/scripts/keepance-nav.v4.js` + `/styles/keepance-nav.v2.css`, the `kp-footer` block, the blog template).
7. **Deploy.** Nothing goes live on keepance.com until Jameson reviews the competitive/legal claims and gives the go. Handle all git yourself.

---

## Workstream 0: Website builds (already specced)

Build the four items in **`docs/strategy/2026-06-06-competitive-build-handoff.md`**. Recap so nothing is missed:
1. Per-vertical "How Advisor Prep Hero compares to the AI you already have" comparison sections on `/legal/`, `/tax/`, `/consulting/`, `/financial-advisors/` (copy drafted there).
2. A `/vs/` profession-tools hub section + per-incumbent pages (Clio Duo fully drafted as the template; build CoCounsel, Jump, Intuit Assist, Gamma, Copilot from the backlog table).
3. Lead-with-the-local-model messaging on the homepage + vertical heroes (fold with the 2026-06-04 cloud-key-overclaim fixes).
4. The gatekeeper one-pagers (fold with the 2026-06-04 plan; add the competitive angle).

Definition of done and full detail are in that doc. Do this first; the blog posts and battlecards below link into these pages.

---

## Workstream 1: Regulatory-hook blog posts (4)

Four posts, one per vertical, each riding the regulatory lever that is doing our selling for us right now. These are SEO, thought leadership, and cold-outreach fuel. Write each ~900-1,200 words, in the site blog voice, publish under `website/blog/`, and add to the blog index. Each must end with the "informational, not legal/tax/compliance advice" caveat and a soft CTA to the 30-day trial. Pull substance from the landscape doc's per-vertical sections; cite the sources listed there.

### Post 1 — Legal: "What US v. Heppner means for using AI in your practice"
- **Slug:** `what-us-v-heppner-means-for-your-ai`
- **Meta:** "A federal court held that using consumer AI without attorney direction can waive privilege. Here's what the ruling actually said, what it didn't, and how to use AI without the risk."
- **Reader:** solo / small-firm attorney.
- **Outline:** (1) What happened (Rakoff, SDNY, Feb 2026; defendant used consumer Claude; ~31 documents seized; not privileged; convicted May 2026). (2) The three reasons the court found no privilege (Claude isn't an attorney; no confidentiality once shared with a third-party platform under its privacy policy; not used at counsel's direction). (3) The carve-out that matters: attorney-directed use (the Kovel analogy). (4) What Heppner does NOT mean (later courts diverging to fact-specific; enterprise/zero-retention tiers differ from consumer; this is not a blanket ban). (5) Practical steps: avoid consumer tiers for client work; prefer tools where the work never reaches a vendor at all; the local-model option as the cleanest answer. (6) Soft Advisor Prep Hero tie-in.
- **Sources to link:** the Harvard Law Review note on Heppner; one major-firm alert (Gibson Dunn or McDermott).
- **Internal links:** `/legal/`, `/local-model-setup/`, `/vs/clio-duo`.

### Post 2 — Tax: "Is your AI tax tool §7216-clean?"
- **Slug:** `is-your-ai-tax-tool-7216-clean`
- **Meta:** "A cloud AI key still sends your client's return information to a third party. Here's what IRC §7216 actually requires, and the one setup that removes the disclosure entirely."
- **Reader:** EA / CPA / tax preparer.
- **Outline:** (1) What §7216 (criminal) and §6713 (civil, strict-liability) actually govern: disclosure/use of return information. (2) Why a cloud AI key is a third-party disclosure (the provider receives the prompt), even when the vendor promises no training. (3) The consent path (and why most preparers would rather not manage it per tool). (4) The local-model alternative: nothing leaves the machine, so there's no third-party disclosure to consent around. (5) The Safeguards Rule / WISP angle in one paragraph. (6) Soft Advisor Prep Hero tie-in; note it works with Drake (which ships no AI).
- **Sources to link:** the IRS §7216 information center; AICPA §7216 guidance.
- **Internal links:** `/tax/`, `/local-model-setup/`, `/vs/intuit-assist`.

### Post 3 — Advisor: "Reg S-P just changed your AI vendor list"
- **Slug:** `reg-s-p-changed-your-ai-vendor-list`
- **Meta:** "The SEC's Reg S-P amendments now require you to vet every vendor that touches client data. The smaller-firm deadline passed in June 2026. Here's what that means for the AI you use."
- **Reader:** independent RIA / CCO.
- **Outline:** (1) What changed (written incident-response program; 30-day customer breach notification; service-provider oversight; the June 2026 smaller-firm deadline). (2) The shadow-AI problem (advisors already pasting client data into ChatGPT without governance). (3) What service-provider oversight means for the AI tools advisors use (Jump, Zocks, ChatGPT all become vendors you must vet and monitor). (4) The zero-vendor-surface option: with a local model there's no AI vendor in the data path at all. (5) The books-and-records angle (plain files you control). (6) Soft Advisor Prep Hero tie-in.
- **Sources to link:** the Reg S-P amendments (Federal Register); a compliance-firm explainer (Holland & Knight).
- **Internal links:** `/financial-advisors/`, `/local-model-setup/`, `/vs/jump`.

### Post 4 — Consulting: "Your NDA probably bans the AI tool you're using"
- **Slug:** `your-nda-probably-bans-your-ai-tool`
- **Meta:** "Client NDAs increasingly prohibit uploading work product to AI services. Even the enterprise tiers still upload. Here's the only setup that honors a strict no-AI clause."
- **Reader:** independent consultant / boutique agency.
- **Outline:** (1) The rise of explicit no-AI-upload clauses in MSAs/NDAs. (2) The distinction that matters: "no training on our data" vs "no upload at all," and why the strictest clauses mean the latter. (3) Why ChatGPT Plus and Claude Pro train by default, and why even enterprise tiers and Copilot still upload to a vendor cloud. (4) The local-model answer: nothing leaves the machine, so a strict clause is honored literally. (5) Per-client isolation as the second NDA risk (cross-contamination). (6) Soft Advisor Prep Hero tie-in; honest note that the final deck still gets built in PowerPoint/Gamma.
- **Sources to link:** one or two of the NDA-AI-clause legal commentaries cited in the landscape doc.
- **Internal links:** `/consulting/`, `/local-model-setup/`, `/vs/gamma`.

**DoD for Workstream 1:** 4 posts live under `website/blog/`, indexed, in voice, no em dashes, each with sourced links + the caveat + a trial CTA, internal links wired, meta/OG set. Deploy-gated.

---

## Workstream 2: Sales / outreach battlecards (internal)

A single internal doc, `docs/marketing/competitive-battlecards.md`, plus a condensed version folded into the reviewer kit (`docs/marketing/campaigns/2026-reviewer-program/`). These turn the landscape into reps for reviewer + cold outreach. Most content already exists in the landscape doc's per-vertical "head-to-head," "talking points," and "when to pick the incumbent instead" sections; this workstream is formatting it into usable cards.

**One battlecard per competitor, grouped by vertical.** Cover at minimum: Clio Duo, CoCounsel (legal); Intuit Assist, Blue J (tax); Microsoft 365 Copilot, Gamma (consulting); Jump, Zocks (advisor); plus one cross-vertical card for "I already use ChatGPT."

**Each card uses this structure:**
- **Competitor + what it is** (one line).
- **When the prospect raises it** (the trigger).
- **Acknowledge honestly** (where it genuinely wins; do not dismiss it).
- **Pivot** (Advisor Prep Hero's wedge against it, in the prospect's language).
- **One-liner rebuttal** (the single sentence to say).
- **Proof point** (the regulatory lever or the architectural fact).
- **When to concede** (the honest case for telling the prospect to use the competitor; this builds trust and protects credibility).

Example one-liner (Clio Duo): "Clio Duo is great for AI that knows your matters and billing; Advisor Prep Hero is for the confidential drafting you'd rather not keep on any vendor's servers, and it's the only one that can run fully local." Use the landscape doc to write the rest in the same honest register.

**DoD for Workstream 2:** the battlecards doc exists with a card per competitor in the structure above, sourced from the landscape doc, in an honest internal-but-shareable register; condensed version added to the reviewer kit. Internal docs, no deploy gate, but keep the honesty bar.

---

## Workstream 3: Trust and compliance signals (SOC 2 + DPA)

This is the recurring hard blocker for the regulated verticals (RIA and multi-lawyer-firm vendor approval). The SOC 2 certification itself is a months-long audit and a spend decision, so it is **Jameson's / board-level call**, not something a build session can complete. Split it:

**Build now (you can do these):**
1. **A public "Security and data handling" / trust page** (`/security/` or extend `/ai-workspace-privacy/`). Honestly state the current posture: local-first, BYOK, API keys in the OS keychain, the append-only audit log, opt-in telemetry (nothing collected until enabled), no Advisor Prep Hero servers in the data path, and the local-model zero-egress option. This is forwardable to a CCO or IT reviewer and is the buildable substitute for a cert today. Honesty bar applies; do not claim certifications we don't have.
2. **A draft Data Processing Agreement (DPA) template** under `docs/legal/` or `website/legal/`, clearly marked "draft, pending legal review." A reviewer-side DPA is increasingly requested; having a draft ready shortens that conversation. Flag that it needs a lawyer's review before use (escalate to Jameson).
3. **A security FAQ** that feeds the gatekeeper one-pagers (Workstream 0, item 4): the questions a CCO/IT/carrier asks, answered honestly.

**Tee up for Jameson (decision brief):**
4. Write `docs/strategy/2026-06-08-soc2-decision-brief.md`: what SOC 2 Type II involves, the lighter-weight automated paths (Vanta / Drata / Secureframe and roughly what they cost/take), what a "real" DPA needs, and a recommended path. Keep it plain-language (Jameson is non-technical). End with a clear "your call" recommendation.

**DoD for Workstream 3:** trust page built (deploy-gated), DPA draft + security FAQ written (marked draft), SOC 2 decision brief written for Jameson. Explicitly flag the cert and the DPA legal-review as Jameson/board decisions.

---

## Workstream 4: Competitor-watch routine

Set up a scheduled remote agent (use the `schedule` skill) that keeps this landscape from decaying. Pricing and features in this space move fast (Lexis+ just shipped BYOK encryption; an incumbent could ship a local mode and narrow our wedge).

- **Cadence:** quarterly is enough; monthly-light is fine if cheap. (Flag to Jameson that this is a small recurring agent cost.)
- **What it does:** re-check the competitors in the landscape doc for material changes (pricing, a new local/zero-egress or BYOK option, a major funding/acquisition, a new entrant), append a dated "Competitor-watch log" section to `docs/strategy/2026-06-06-vertical-competitive-landscape.md` (or a sibling changelog file), and **notify Jameson via `notify-jameson` only if something material changed** (especially any incumbent moving toward local/private, which would threaten our core wedge).
- **Routine prompt (use this):** "Re-check the competitors in docs/strategy/2026-06-06-vertical-competitive-landscape.md against their current public pages (web search/fetch). Flag any material change: pricing, a new local/on-prem/zero-egress or BYOK option, major funding or acquisition, or a notable new entrant in legal/tax/consulting/advisor AI. Append a dated entry to the competitor-watch log with sources. If anything materially threatens Advisor Prep Hero's local-first wedge or changes a comparison page's accuracy, notify Jameson with a one-paragraph summary and the affected pages."

**DoD for Workstream 4:** the scheduled routine exists and has run once (a baseline log entry written). Flag the recurring nature to Jameson.

---

## Workstream 5: Press-kit / reviewer comparison matrix

A clean, single-page "Advisor Prep Hero vs the field" asset for the press kit and reviewer kit.
- **Build:** an HTML page under `website/press-kit/` (and a print-friendly version), plus a copy in `docs/marketing/campaigns/2026-reviewer-program/`.
- **Content:** the honest cross-vertical positioning matrix from the landscape doc (Advisor Prep Hero's wedge: local/zero-egress option, own-your-files, profession templates, price; and honestly where incumbents win: research databases, integrations, meeting-notes/CRM, deck polish). Group by vertical or use one matrix with the key incumbents.
- **Honesty:** as-of-2026 date, competitor pricing as bands with outbound links, "where they win" included. Same guardrails.

**DoD for Workstream 5:** the matrix asset is in the press kit and reviewer kit, on-brand, honest, sourced, deploy-gated for the public press-kit version.

---

## Sequencing and priority

1. **Workstream 0** (website builds) first; everything else links into those pages.
2. **Workstream 1** (blog posts) next; time-sensitive (the regulatory news is fresh) and high SEO value.
3. **Workstream 2** (battlecards) and **Workstream 5** (matrix) in parallel; both are mostly repackaging the landscape doc.
4. **Workstream 3** (trust page + DPA draft + decision brief) next; the trust page is high-value for the regulated verticals.
5. **Workstream 4** (competitor-watch) last; set-and-forget.

Plan each with `writing-plans`, execute subagent-driven, verify before claiming done, and stage everything for Jameson's deploy go.

## What needs Jameson (escalations, do not block on these)
- **Deploy approval** for all customer-facing pages and posts (Workstreams 0, 1, 3 trust page, 5).
- **SOC 2 certification** decision and spend (Workstream 3) — board-level.
- **DPA legal review** before the draft is used (Workstream 3).
- **The recurring competitor-watch agent** cost (Workstream 4) — minor, but his call.
- Any **pricing decision** that surfaces while reconciling the Practice "$499 once vs yearly" inconsistency (Guardrail 4) — if it's anything beyond making the existing model consistent, escalate.
