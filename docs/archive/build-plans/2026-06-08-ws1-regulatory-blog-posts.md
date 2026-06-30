# WS1: Regulatory-Hook Blog Posts — Execution Plan

**Date:** 2026-06-08
**Workstream:** 1 of 5 (from `docs/strategy/2026-06-08-competitive-activation-master-handoff.md`)
**Status:** In progress

---

## What this workstream is

Four SEO/thought-leadership blog posts, one per vertical, each riding the regulatory lever that is doing our selling right now. Target: attorneys, CPAs, RIAs, and independent consultants who are asking "is the AI I use compliant?" These posts are also cold-outreach fuel and link assets for the vertical landing pages.

**Blog-index insertion is handled centrally by Jameson.** This plan covers only the four post files. Do not edit `website/blog/index.html`.

All four posts are deploy-gated: files are built and ready; Jameson approves before deploy.sh runs.

---

## The 4 posts

| # | Title | Slug | Vertical | Regulatory lever |
|---|---|---|---|---|
| 1 | What US v. Heppner Means for Using AI in Your Practice | `what-us-v-heppner-means-for-your-ai` | Legal | Attorney-client privilege waiver |
| 2 | Is Your AI Tax Tool §7216-Clean? | `is-your-ai-tax-tool-7216-clean` | Tax | IRC §7216 (criminal) + §6713 (civil) |
| 3 | Reg S-P Just Changed Your AI Vendor List | `reg-s-p-changed-your-ai-vendor-list` | Advisor / RIA | SEC Reg S-P amendments (June 2026) |
| 4 | Your NDA Probably Bans the AI Tool You're Using | `your-nda-probably-bans-your-ai-tool` | Consulting | NDA no-AI-upload clauses |

---

## Shared structure and patterns

### 6-section outline (every post follows this)
1. The regulatory/legal event and who it affects
2. The mechanism (why the common practice is the problem)
3. What the rule/ruling does NOT mean (the important carve-out or nuance)
4. The practical alternatives (from worst to best)
5. The architectural solution (local model as the cleanest answer)
6. Soft Advisor Prep Hero tie-in (honest, no overclaims)

### Shared caveat (every post ends with this paragraph, before the CTA)
> "This is informational, not legal, tax, or compliance advice. Verify any regulatory question with your own counsel or compliance officer."

### CTA block (every post ends with this, after the caveat)
The coral-gradient `.cta` block linking to keepance.com (matches existing blog template).

### Pricing if mentioned
- $49 one-time Personal
- $149/yr Professional (includes one profession pack)
- $499/yr Practice (all four packs, up to five seats)
- Never "$499 one-time"

### Template claim
Say "built with input from practicing [attorneys/CPAs/advisors/consultants]" — not "reviewed by" professionals.

---

## Post-by-post outlines

### Post 1: Legal — `what-us-v-heppner-means-for-your-ai.html`

**Meta description:** A federal court held that using consumer AI without attorney direction can waive privilege. Here's what the ruling actually said, what it didn't, and how to use AI without the risk.

**Outline:**
1. What happened: Rakoff, S.D.N.Y., opinion Feb 17 2026; defendant used consumer Claude; ~31 documents; court found no privilege protection; defendant convicted May 7 2026.
2. The three reasons the court found no privilege: no attorney involved in the AI use; no confidentiality once shared with a third-party platform under its privacy policy; not at counsel's direction.
3. The Kovel analogy: attorney-directed use is a different analysis.
4. What Heppner does NOT mean: later courts are diverging to a fact-specific approach; enterprise/zero-retention tiers are factually different from consumer; this is a cautionary leading case, not settled black-letter law.
5. Practical steps: avoid consumer tiers for client work; prefer tools where client data never reaches a vendor at all; local model as the cleanest answer.
6. Soft Advisor Prep Hero tie-in.

**Sources:**
- Gibson Dunn alert: `https://www.gibsondunn.com/ai-privilege-waivers-sdny-rules-against-privilege-protection-for-consumer-ai-outputs/`
- ABA Formal Opinion 512: `https://www.americanbar.org/content/dam/aba/administrative/professional_responsibility/aba-formal-op-512.pdf`

**Internal links:** `/legal/`, `/local-model-setup/`, `/vs/clio-duo`

---

### Post 2: Tax — `is-your-ai-tax-tool-7216-clean.html`

**Meta description:** A cloud AI key still sends your client's return information to a third party. Here's what IRC §7216 actually requires, and the one setup that removes the disclosure entirely.

**Outline:**
1. What §7216 (criminal) and §6713 (civil, strict-liability) govern: disclosure or use of return information; brief note on the FTC Safeguards Rule.
2. Why a cloud AI key is a third-party disclosure: the provider receives the prompt; "no training" contractual promises do not change the fact that data left your machine.
3. The consent path: it exists, but most preparers do not want to manage per-tool §7216 consents.
4. The local-model alternative: nothing leaves the machine, so there is no third-party disclosure to consent around.
5. The WISP / Safeguards Rule angle in one paragraph.
6. Soft Advisor Prep Hero tie-in; note it works with Drake (which ships no AI of its own).

**Sources:**
- IRS §7216 information center: `https://www.irs.gov/tax-professionals/section-7216-information-center`
- AICPA §7216 guidance: `https://www.aicpa-cima.com/resources/landing/section-7216-guidance-and-resources` (well-known AICPA page)

**Internal links:** `/tax/`, `/local-model-setup/`, `/vs/intuit-assist`

---

### Post 3: Advisor — `reg-s-p-changed-your-ai-vendor-list.html`

**Meta description:** The SEC's Reg S-P amendments now require you to vet every vendor that touches client data. The smaller-firm deadline passed in June 2026. Here's what that means for the AI you use.

**Outline:**
1. What changed: written incident-response program; 30-day customer breach notification; service-provider oversight obligation; the June 3 2026 smaller-firm deadline.
2. The shadow-AI problem: most advisors are already pasting client data into ChatGPT/Claude without governance.
3. Service-provider oversight in practice: Jump, Zocks, ChatGPT all become vendors you must vet, monitor, and document.
4. The zero-vendor-surface option: with a local model there is no AI vendor in the data path.
5. The books-and-records angle: plain Markdown files the firm already controls.
6. Soft Advisor Prep Hero tie-in.

**Sources:**
- Federal Register Reg S-P amendments: `https://www.federalregister.gov/documents/2024/05/16/2024-07367/regulation-s-p-privacy-of-consumer-financial-information-and-safeguarding-customer-information`
- Holland & Knight Reg S-P deadline note: `https://www.hklaw.com/en/insights/publications/2024/05/sec-adopts-significant-amendments-to-regulation-s-p`

**Internal links:** `/financial-advisors/`, `/local-model-setup/`, `/vs/jump`

---

### Post 4: Consulting — `your-nda-probably-bans-your-ai-tool.html`

**Meta description:** Client NDAs increasingly prohibit uploading work product to AI services. Even the enterprise tiers still upload. Here's the only setup that honors a strict no-AI clause.

**Outline:**
1. The rise of explicit no-AI-upload clauses in MSAs and NDAs.
2. The distinction that matters: "no training on our data" vs. "no upload at all"; why the strictest clauses mean the latter.
3. Why ChatGPT Plus and Claude Pro train by default, and why enterprise tiers and Copilot still upload to a vendor cloud.
4. The local-model answer: nothing leaves the machine; a strict clause is honored literally.
5. Per-client isolation as the second NDA risk: cross-contamination between client contexts.
6. Soft Advisor Prep Hero tie-in; honest note that the final deck still gets built in PowerPoint or Gamma.

**Sources:**
- Roth Jackson NDA-AI commentary: `https://www.rothjackson.com/blog/ai-confidentiality-clauses-in-nda-agreements`
- Anthropic consumer privacy terms (training defaults reference): `https://www.anthropic.com/legal/consumer-privacy-policy`

**Internal links:** `/consulting/`, `/local-model-setup/`, `/vs/gamma`

---

## HTML template

Clone structure from `website/blog/byok-math-for-professionals-2026.html`:
- Same `<head>` meta pattern (charset, viewport, canonical, OG tags, author)
- Same nav: `/styles/keepance-nav.v2.css` + `/scripts/keepance-nav.v4.js`
- Same inline `<style>` block (variables, body, headings, `.meta`, `.cta`, `blockquote`, etc.)
- Same favicon block
- Same Plausible analytics snippet
- Same footer / `.cta` coral button
- Font: Inter (existing template uses Inter; site uses Satoshi via nav stylesheet)
- Light theme only

---

## Guardrails checklist (before marking done)

- [ ] No em dashes (`—` or `&mdash;`) anywhere in any post
- [ ] No AI-tell words: leverage, seamless(ly), empower(s/ing), unlock(s/ing), "transform your", elevate(s)/elevated, delve(s), tapestry
- [ ] No "It's not X, it's Y" parallelism
- [ ] Local-vs-cloud precision: only "local model" gets the "nothing leaves your machine" absolute; cloud BYOK key still sends to the provider
- [ ] Heppner cited as evolving cautionary case, not settled law; Gibson Dunn source link present
- [ ] §7216: IRS source link present
- [ ] Reg S-P: Federal Register source link present
- [ ] Each post has canonical tag, caveat paragraph, CTA block, and its 3 internal links
- [ ] Pricing if mentioned: $49 Personal / $149/yr Professional / $499/yr Practice (never "$499 one-time")
- [ ] Every legal/tax/compliance claim links a real authoritative URL

---

## Definition of done

Four `.html` files exist under `website/blog/` with slugs above, passing all guardrail checks. Blog-index cards (title + dek + href) delivered to Jameson for manual insertion. Files deploy-gated pending Jameson's review.
