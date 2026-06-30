# Deploy Manifest — Competitive-Landscape Activation (2026-06-08)

> ## ✅ DEPLOYED + LIVE on keepance.com (2026-06-08, 20:08 UTC)
> Jameson approved ("DEPLOY ALL"). Shipped via `infra/deploy.sh --skip-demo`; Cloudflare cache purged; new pages verified serving (homepage hero, the 6 `/vs/` pages, `/security`, blog posts, matrix; counts 18/13/9/7; Practice $499/yr). Branch `v2-overhaul` pushed to origin. The original staging detail is preserved below for the record; the post-review CEO decisions are in the "Post-review CEO decisions" section near the end.

All six workstreams are built, staged, and the full test suite is green (**2148 passed, 6 skipped, 0 failed**; the website content lint is **243 passed**). Branch `v2-overhaul`.

## What shipped (by workstream)

| WS | Deliverable | Status |
|----|-------------|--------|
| 0 | Pricing/counts canonical fix + 6 `/vs/` pages + 4 vertical comparison sections + hub + hero + one-pager competitive angles | Built, deploy-gated |
| 1 | 4 regulatory-hook blog posts (Heppner, §7216, Reg S-P, NDA) | Built, deploy-gated |
| 2 | Competitive battlecards (9 cards) + reviewer-kit condensed | Internal, done (no gate) |
| 3 | Public security/trust page + security FAQ + DPA draft + SOC 2 brief | Page deploy-gated; briefs escalated |
| 4 | Competitor-watch baseline + routine spec | Baseline done; recurring cron escalated |
| 5 | Press-kit "Advisor Prep Hero vs the field" matrix + reviewer-kit copy | Built, deploy-gated |

## Commits (in order)

```
ba7395b  fix(site): canonical pricing sweep + real template counts + consulting privacy precision
3c84935  feat(site): competitive surfaces — 6 /vs/ incumbent pages, vertical sections, hub, hero
06cc127  feat(content): regulatory blog posts (WS1) + battlecards (WS2) + press-kit matrix (WS5)
df59136  feat(trust): security/trust page + security FAQ + DPA draft + SOC2 brief (WS3); competitor-watch baseline (WS4)
a090039  feat(site): gatekeeper one-pager competitive angle + Heppner link (WS0 B5)
e237b78  docs: WS0/WS4 plan files + track master handoff + landscape update
```

---

## NEW customer-facing pages (review these claims before deploy)

Each `/vs/` page makes an honest comparison (states where the competitor wins), an email-local row, and competitor pricing as approximate "as of 2026" bands with vendor links.

| URL | Purpose | Key competitor claim | Regulatory citation |
|-----|---------|----------------------|---------------------|
| `/vs/copilot` | M365 Copilot, email-led | Copilot reads Outlook in Microsoft's cloud; Advisor Prep Hero imports/searches email locally. Copilot wins inside Office + real PPTX. | none |
| `/vs/clio-duo` | Clio Duo (legal) | Clio Duo wins on matter/billing context + SOC 2; Advisor Prep Hero = local zero-egress + price | Heppner (Gibson Dunn link) + "not legal advice" |
| `/vs/cocounsel` | CoCounsel (legal) | CoCounsel wins on Westlaw-grounded research; Advisor Prep Hero = local + price | Heppner (Gibson Dunn link) + "not legal advice" |
| `/vs/jump` | Jump (advisor) | Jump wins on meeting notes + CRM + SOC 2; Advisor Prep Hero = zero Reg S-P vendor surface w/ local model | Reg S-P (Federal Register link) + "not compliance advice" |
| `/vs/intuit-assist` | Intuit Assist (tax) | Intuit wins on return-data pull, bundled; Advisor Prep Hero = §7216-clean local + Drake companion | §7216 (IRS link) + "not tax advice" |
| `/vs/gamma` | Gamma (consulting) | Gamma wins decisively on deck output; Advisor Prep Hero = the private thinking before the deck | none |
| `/blog/what-us-v-heppner-means-for-your-ai` | Legal post | Heppner as evolving/leading case, not settled law | Gibson Dunn + ABA Op 512, "not legal advice" |
| `/blog/is-your-ai-tax-tool-7216-clean` | Tax post | cloud key = §7216 third-party disclosure; local model removes it | IRS §7216 center, "not tax advice" |
| `/blog/reg-s-p-changed-your-ai-vendor-list` | Advisor post | Reg S-P vendor-vetting; local model = no AI vendor in path | Federal Register + Holland & Knight, "not compliance advice" |
| `/blog/your-nda-probably-bans-your-ai-tool` | Consulting post | strict no-upload clauses; only local model honors literally | Anthropic consumer privacy policy, "not legal advice" |
| `/security` | Public trust page | honest posture; explicitly states no SOC 2, no signed DPA yet | n/a |
| `/press-kit/comparison-matrix` | Press/reviewer matrix | one-page "vs the field", where-each-incumbent-wins, print-friendly | n/a |

**Updated (not new):** `/` (hero: local-model lead + email proof), `/vs/index` (profession-tools hub section), `/legal/`, `/tax/`, `/consulting/`, `/financial-advisors/` (comparison sections + email row + pre-existing em-dash cleanup), the 4 one-pagers (competitive angle + Heppner link), and ~16 files in the pricing sweep.

## Pricing sweep (the #1 fix)

Canonical now consistent everywhere: **Personal $49 one-time / Professional $149/yr / Practice $499/yr (annual)**. Swept stale "$499 one-time" Practice claims (current claims → "$499/yr"; legitimate historical references reworded). A lint guard now fails the build on any future `$499…one-time` collocation. Template counts corrected to the real shipped numbers (**Legal 18, Tax 13, Consulting 9, Advisor 7**) on the homepage card + vertical pages, with the lint test now self-computing the count from the source so it cannot rot again.

## Competitor-watch accuracy follow-ups (from the WS4 baseline — optional pre-deploy tweaks)

- **Lexis+ Protégé** added BYOK-encryption (cloud + customer-held key, **not** zero-egress). Not on our pages today, but if a Lexis comparison is added later, draw the BYOK-vs-zero-egress line clearly.
- **CoCounsel** ceiling rose to ~$500/mo (our `/vs/cocounsel` band cites the older ~$428 upper bound; it's labeled approximate, so accurate-enough, but worth a one-number bump).
- **Blue J** now $300M+ valuation / 2,500+ customers (bigger than the landscape doc implied).
- Full detail + sources: `docs/strategy/competitor-watch-log.md`.

---

## Decisions applied (your call at review)

- **D1 — "available today" + "built with input from", never "reviewed by".** All packs are presented as available (they ship live) and "built with input from practicing X". The count was bumped to the real 18/13/9/7. The template source files still carry stale `@draft`/"do not expose" comment headers — I did **not** strip them autonomously. Recommendation: strip those stale source comments (the product ships them live), or tell me to gate the packs / get a named reviewer first.
- **D2 — hero direction.** Workspace + local-first core, hero led by the local-model zero-egress wedge, email featured as the headline NEW proof. One-line glance: is this the right front door, or do you want email more/less prominent?

## Escalations (briefs written; your decision)

- **SOC 2 spend** → `docs/strategy/2026-06-08-soc2-decision-brief.md` (recommends: don't start now; start when 3+ deals stall on it; ~$25k-65k all-in first year, 12-18 mo).
- **DPA legal review** → `docs/legal/dpa-template.md` (DRAFT, marked do-not-send until a lawyer reviews; 10 open questions listed).
- **Competitor-watch recurring cron cost** → not enabled. Say "go" and I'll wire the `schedule` routine (quarterly or monthly-light) per `docs/strategy/competitor-watch-log.md`.
- **Deploy approval** → this whole manifest.

---

## Go / no-go checklist

- [x] Full test suite green (`npm test`: 2148 passed, 6 skipped, 0 failed)
- [x] Website content lint green (243 passed) — em-dash, banned-words, canonical, pricing-collocation, local-vs-cloud guards
- [x] Internal link check passed (no dangling hrefs on new pages)
- [x] Every `/vs/` page + blog post: honest "where they win" + approximate competitor pricing + outbound vendor link
- [x] Every regulatory claim: "informational, not advice" caveat + a real, established source link (Heppner standardized on the Gibson Dunn alert already used site-wide)
- [x] No "reviewed by" drift anywhere; "built with input from" everywhere; advisor pack honest as "available today"
- [x] Pricing canonical and consistent; lint guard added
- [ ] **You review the competitive/legal claims above and the D1/D2 calls**
- [ ] D1 source-header reconciliation decided (strip `@draft` comments / gate / named reviewer)
- [ ] Escalations acknowledged (SOC 2, DPA, cron cost)
- [ ] **Deploy go-ahead given**

## How to deploy (after your go)

`infra/deploy.sh` rsyncs `website/` → `/var/www/keepance.com` and purges the Cloudflare cache. **Note:** its `--dry-run` flag still triggers the live CF cache purge (the purge block isn't gated by `--dry-run`), so I did not run a dry-run during staging. The git delta above (43 website files, 3515 insertions) is exactly what would sync. **Deployed 2026-06-08 with `--skip-demo`** (only static `website/` changed; skipping the unrelated `/try/` vite rebuild avoided a build failure leaving the cache unpurged).

---

## Post-review CEO decisions (2026-06-08, after "DEPLOY ALL")

Jameson delegated D1-D4 ("do what you think is best as my CEO"). Resolutions:

- **Deploy — DONE.** All six workstreams live + verified (see banner).
- **D1 (template `@draft` headers) — DONE.** Reconciled the stale "do not expose to users without sign-off / requires review before shipping" source comments to honest "shipped, built with practitioner input; outputs carry a review banner." All user-facing "requires professional review / not legal advice" output banners preserved. `tsc` clean, 243 lint tests green. Commit `6fedb9a`.
- **D2 (hero) — kept.** Workspace + local-first core, local-model-led, email as the headline proof. No change.
- **SOC 2 — deferred.** Per `2026-06-08-soc2-decision-brief.md`: don't start now; begin readiness when 3+ qualified deals stall specifically on SOC 2 in one quarter (~$25k-65k all-in first year, 12-18 mo). Brief is ready.
- **DPA — deferred.** Per `docs/legal/dpa-template.md`: have a startup contracts attorney review the draft ($500-$2k) when the first real deal asks. Draft is ready, marked do-not-send-until-reviewed.
- **Competitor-watch recurring — not automated (by design).** Baseline done, wedge intact. Decided against an unattended web-browsing agent (prompt-injection surface per our security policy; the cloud `schedule` skill also can't reach local `notify-jameson` and needs GitHub connected). Runs attended-quarterly instead; see `2026-06-08-ws4-competitor-watch.md`. Next check ~2026-09.

**Open (your call, when ready):** start SOC 2 / DPA review if a customer demands it; optionally add a pure-notification quarterly reminder for the competitor-watch. Nothing is blocking.
