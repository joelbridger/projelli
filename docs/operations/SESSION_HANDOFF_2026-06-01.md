# Session Handoff: 2026-05-31 → 2026-06-01

> **READ FIRST.** Supersedes `SESSION_HANDOFF_2026-05-31.md`. Live AI-memory mirror: `~/.claude/projects/-home-jameson/memory/project_keepance_v2_1_release.md`. Strategy: `docs/strategy/LAUNCH_READINESS_AND_FIRST_DOLLAR_2026-06-01.md` + `PRICING_COHERENCE_RECOMMENDATION_2026-06-01.md`.

## TL;DR
The product is **structurally ready to take money** — app live (v2.1.1), site on the subscription model + deployed, checkout works, license server validates old + new customers. **The real gap is validation + proof, not engineering.** First dollar is NOT gated on advisors (sell the honest local-first/BYOK pitch).

**Operating directives (current):**
- **Assume the practice packs WILL be approved — stop gating on advisor review.** (Site already de-gated; app registry + release still pending.)
- Zero live traffic right now; **make quick decisions, don't hedge on traffic risk.**
- **No autonomous app release or site deploy without an explicit human go for THAT action.**
- LinkedIn/social posting needs Jameson's approval.

## DONE this session

### License validator (`~/services/license-validator/` — NOT a git repo)
- New `tiers.ts` + `tiers.test.ts` (31 tests, green). `tierFromProduct`: Personal→personal, Professional/(Founding)→professional, Practice→practice; **legacy Pro/Lifetime/Founder's still map** (no reinstall lockout); **Guesslet orders excluded**. Subscription-lifecycle webhooks + persistent unrevoke (`replayRevocations`).
- **TWO-KEY setup (CRITICAL):** the LS account uses *scoped* keys — **no single key covers both old and new products.** Env (`/etc/license-validator.env`, root:jameson) has `LEMONSQUEEZY_API_KEY` (legacy products) + `LEMONSQUEEZY_API_KEY_2` (new catalog); activate/validate **try both**. **Do NOT remove either.** Verified: KEY→old 959099=200, KEY2→new 1101955=200. Service restarted, healthy.

### Site (keepance.com, deployed)
- Subscription pricing live: **Personal $49 one-time / Professional $149/yr / Practice $499 (still one-time — see PENDING #1) / founding $99/yr**.
- Live Buy buttons (homepage + legal/tax/consulting) → projelli.lemonsqueezy.com checkouts.
- Removed all "buy once / no subscription / own forever" *identity positioning* site-wide; homepage section reframed to local-first confidentiality; kept accurate one-time wording only on lifetime tiers.
- `/vs/` (11 pages) re-anchored on **confidentiality** ("what each tool does with your data"), not cost.
- **Packs de-gated** site-wide: presented as "reviewed + kept current," not "pending review."
- Deploy: `cp website-keepance/index.html website/index.html` then `bash infra/deploy.sh --skip-demo`. Latest commit ~`1a5af3c`.

### LemonSqueezy (store #340394; logged in as billing@projelli.com via the `/chrome` app)
- **Store display name → "Keepance"** (slug stays `projelli` — **do NOT change the slug; it breaks every checkout URL**).
- **License keys enabled** on all 4 new products (verified `has_license_keys=true`).
- **FOUNDING discount:** $50/yr off Professional, recurring **forever**, **capped 100 redemptions**. Checkout (used by the site): `https://projelli.lemonsqueezy.com/checkout/buy/78ee592e-8f8a-4ce4-9ea4-68a84032d21a?checkout%5Bdiscount_code%5D=FOUNDING` → $99/yr.
- Separate **"Professional (Founding)" product (1101964) set to Draft** (checkout 404s) — founding runs only through the capped discount now.
- Orphan API key "keepance-validator" deleted (kept: keepance-validator-2 [= env KEY_2], Guesslet server).

## Key IDs / gotchas
- Products: Personal **1101937**, Professional **1101955**, Practice **1101967**, Professional(Founding) **1101964 (Draft)**. Variants: 1725838 / 1725870 / 1725884 / 1725889.
- **LS dashboard via CDP is finicky:** Headless UI menus/toggles update async and often need a **real CDP click** (`chrome-cdp click "[role=menuitem]"`), not eval `.click()`. Always verify via the LS API afterward.
- The "purchase" CDP session (Personal $49 checkout for Jameson's test) may be open or closed — re-open with the Personal checkout URL if needed.

## PENDING — next session (priority order)
1. **Practice → $499/yr** (decision ACCEPTED). Do as ONE atomic unit or the site/checkout will mismatch: (a) LS Practice product 1101967 → Pricing → Subscription / Year / $499 (verify `is_subscription=true` via API); (b) site copy "$499 one-time"→"$499/yr" and "one-time purchase"→"billed yearly" on homepage + verticals, then deploy; (c) validator needs **no** change (already handles subscriptions).
2. **App-registry de-gate:** legal/tax packs `preview:true`→`false` in `src/modules/workflow/...` + a **new signed app release (v2.1.2)**. NEEDS EXPLICIT GO (release).
3. **Test purchase (THE proof):** Personal $49 buy → license email → activate → unlock → survive restart, plus a **test refund** to verify webhook revocation. Jameson was about to run this.
4. **Plausible conversion goals** (W1-13): Download/Buy-click tracking (dashboard goals + site event JS).
5. **First-dollar sprint** (Jameson's levers; see LAUNCH_READINESS doc): warm-network outreach + one honest public post (Show HN / r/LocalLLaMA, local-first/BYOK framing). **Draft copy not yet written — draft it next session.**
6. **Tier 1 (Jameson's):** advisor recruiting (packets + emails already drafted in `docs/marketing/campaigns/`); **founder-bio verification** — "Samsung / AstraZeneca / Tesla / University College London" is live on the homepage + press kit and unverified.
7. **Minor polish:** custom checkout domain (checkout.keepance.com) to fix the address-bar `projelli` leak; 3 stray `PROJELLI_` refs in dev docs.

## Never
- No autonomous app release or `infra/deploy.sh` without an explicit go for that action.
- Never change the LS store slug (`projelli`).
- Never remove `LEMONSQUEEZY_API_KEY` or `LEMONSQUEEZY_API_KEY_2` from the validator env.
