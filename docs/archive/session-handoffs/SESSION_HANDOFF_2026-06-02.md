# Session Handoff: 2026-06-02

> **READ FIRST.** Supersedes `SESSION_HANDOFF_2026-06-01.md`. Full memory: `~/.claude/projects/-home-jameson/memory/project_keepance_v2_1_release.md`.

---

## TL;DR

The product is **structurally complete**. The CRM outreach machine is live. 7 personalized reviewer drafts are queued and waiting for Jameson's approval. The site has a 4th vertical (financial advisors). The test suite is green. The bottleneck is now 100% sales and validation: we need Jameson to approve those drafts, do the bio verification, and eventually route one warm advisor intro. Nothing in my hands is blocking launch.

**Operating directives:**
- **No autonomous public posting.** Jameson posts from his accounts.
- **No autonomous app release** without explicit go.
- **Never change LS store slug** (`projelli`).
- **Never remove** `LEMONSQUEEZY_API_KEY` or `LEMONSQUEEZY_API_KEY_2` from the validator env (two-key scoped setup).
- **CRM sends are gated.** All cold outreach queues as drafts at `crm.jameworld.com` for Jameson's approval. `--auto` only for cleared flows.

---

## DONE this session

### App + revenue infrastructure
- **v2.1.2 published** (legal/tax packs de-gated; all platforms signed; windows-x86_64 in latest.json). Live at keepance.com/releases.
- **Practice → $499/yr** (LS product 1101967 is now subscription/year; site + subpages updated; API-verified).
- **LS webhook fixed:** old webhook 89126 was `test_mode:true` (never fired for real orders). New live webhook `106297` created (`test_mode:false`, all 9 events, same signing secret). **Verified with a real live delivery** — patched the test license's activation_limit, validator logged `[webhook] revoked ...` within 5s. Push revocation now works for refunds and subscription cancellations.
- **Full funnel proven** (real $49 purchase, order #3403942): activate → unlock → restart → refund all green. Refunded; token manually revoked.
- **`Keepcance` typo fixed** across 10 source files — this was a real production bug (marketplace manifests couldn't validate). Cleared 69 failing tests.
- **Test suite green:** 178 files, 1806 passed.

### Site
- **`/financial-advisors/` live** (4th vertical): honest data-path framing only, advisor pack "in the works," compliance claims deliberately softened until a securities-compliance reviewer signs off. In homepage nav + a card.
- **5 UX fixes deployed:** (1) subpage pricing now shows all 3 tiers consistently (fixed critical bug: advisors page "Buy Personal ($49)" was linked to the Practice checkout URL); (2) download trial is a real visible button; (3) favicon replaced (Projelli jellybean → Advisor Prep Hero folder/shield icon + SVG for modern browsers); (4) vertical cards in a clean 2×2 grid; (5) hero video ~55% wider.
- **Site-wide accuracy pass:** "your data never leaves your machine" was overclaiming for cloud-AI use. Fixed across all pages to the honest framing: "Advisor Prep Hero never sees your work; files stay local; AI requests go to the provider you chose."
- **Plausible analytics fixed:** site was registered as `projelli.com` in Plausible since the rebrand — all events were being dropped. Fixed and added Buy Click + Download goals.
- **Packs claim softened:** changed from "reviewed by practicing attorneys/CPAs" → "maintained and current" until advisors actually sign off.
- **PIVOT-16 shipped:** profession picker now surfaces the user's pack first in the workflow picker (wires the previously-dead `getOnboardingProfession()`).

### GTM strategy + CRM
- **Jameworld CRM fully operational.** `jameson@keepance.com` is the live founder sender (Brevo-authenticated, keepance.com DKIM verified, replies route to CRM inbox + Outlook copy). CRM CLAUDE.md: `~/services/crm/CLAUDE.md`.
- **22 reviewer/design-partner contacts loaded** across 3 verticals (legal: 7, tax: 7, advisor: 8). Tagged by confidence (email-verified / unverified / needs-LinkedIn-approach).
- **7 first-wave personalized gated drafts queued** (drafts #8-14): 3 legal (Elefant, Jennifer Case, Sharon Nelson), 2 tax (Jeremy Wells, Brian Tankersley), 2 advisor (Derek Tharp/Kitces, Emma Foulkes). All awaiting Jameson's approval at `crm.jameworld.com`.
- **3 CRM email templates loaded:** `reviewer-attorney-cold`, `reviewer-cpa-cold`, `reviewer-advisor-cold`.
- **GTM plan written:** `docs/strategy/GO_TO_MARKET_2026-06.md`. Reviewer-first strategy (a reviewer makes the pack trustworthy + becomes the first named reference). No warm ICP network. Public tech channels (Show HN/Reddit) are NOT the ICP — demoted to optional.
- **Financial advisor vertical foundation:** `docs/strategy/VERTICAL_FINANCIAL_ADVISORS_2026-06.md` — 25 adversarially-verified claims from primary SEC/CFR/FINRA sources (Reg S-P 2024, books-and-records, AI-washing enforcement, PDA withdrawal). Hard do-not-overclaim list. Claims to verify with a compliance attorney before marketing.
- **Reviewer kit:** `docs/marketing/campaigns/2026-06-reviewer-program/REVIEWER_KIT.md` — the 25-minute review package that turns an advisor's "yes" into actual feedback.
- **Design-partner program:** `docs/marketing/campaigns/2026-06-design-partners/` — program + recruiting copy (3 variants). Journey Beyond Wealth approach drafted but held until Jameson has social proof.
- **First-dollar copy:** `docs/marketing/campaigns/2026-06-first-dollar/` — Show HN, r/LocalLLaMA, r/privacy, warm DM. Still valid but lower priority than the reviewer-first path.

---

## PENDING — next session (priority order)

1. **Jameson: approve the 7 reviewer drafts at `crm.jameworld.com`** (domain warming: a few per day, not all at once). These are the highest-leverage action. Nothing else matters as much.
2. **Warm contacts.** Jameson: any warm contacts (even non-ICP personal friends) → send them over and I'll queue warm-outreach drafts.
3. **Founder-bio verification.** "Eight years at Samsung, AstraZeneca, Tesla, University College London" is live on the homepage + press kit, unverified. A lawyer will Google it. Jameson verifies; I update copy to match.
4. **Custom checkout domain** (`checkout.keepance.com`): blocked on LS dashboard (no API, domains settings path redirects, store had "under review" banner). Runbook: `docs/operations/CHECKOUT_DOMAIN_RUNBOOK.md`. Do when LS dashboard is clear.
5. **Compliance attorney review of the advisor framing** — before we market to advisors with the Reg S-P "service-provider oversight" angle. Once done, restore the stronger language on the `/financial-advisors/` page.
6. **Journey Beyond Wealth intro** — hold until Jameson has social proof (his wife's career depends on that firm being our second or third reference, not first).
7. **v2.1.3 release** — PIVOT-16 (profession-picker workflow ordering) is on master but not yet released. Bundle with the next meaningful app change.

---

## Never
- No autonomous app release or `infra/deploy.sh` without explicit go.
- Never change LS store slug (`projelli`).
- Never remove either LEMONSQUEEZY_API_KEY or _2 from the validator env.
- Never send a cold CRM email without Jameson approving the draft at `crm.jameworld.com`.
- No autonomous public posting (Jameson posts from his accounts).

---

## Key IDs / quick reference
- LS store: `#340394` (slug: `projelli`, display: "Advisor Prep Hero")
- Products: Personal `1101937`, Professional `1101955`, Practice `1101967`
- Checkout URLs: Personal `4df43939`, Professional `78ee592e`, Practice `b4c6865f`
- Founding discount: `FOUNDING` code on Professional → $99/yr (100-redemption cap)
- Validator: `https://licenses.projelli.com/webhook` (port 5181), two API keys in `/etc/license-validator.env`
- Live webhook: `106297` (test_mode:false, 9 events)
- CRM: port 5191, `crm.jameworld.com`, sender `jameson@keepance.com` (sender id 89)
- Pending reviewer drafts: #8-14 at `crm.jameworld.com`
