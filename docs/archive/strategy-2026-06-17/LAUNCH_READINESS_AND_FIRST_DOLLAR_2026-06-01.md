# Advisor Prep Hero — Launch Readiness Read + First-Dollar Plan
**Date:** 2026-06-01 · Author: Claude (operator) for Jameson (CEO)
**Companion:** `docs/operations/SESSION_HANDOFF_2026-05-31.md`, `~/.claude/.../memory/project_keepance_v2_1_release.md`

---

## Part 1 — Are we REALLY ready? (honest read)

**Bottom line: the machine is built; the trust isn't earned yet.** We can take money today and stand fully behind the *local-first product*. We are **not** ready to hard-launch at lawyers/CPAs with compliance claims. The remaining gap is **professional validation + proof**, almost all of it in Jameson's hands, not more engineering.

### What's genuinely ready
- Signed/notarized desktop app, Win/Mac/Linux, auto-updating (v2.1.1).
- Coherent site, subscription pricing ($49 one-time / $149-yr / $499 one-time), **working checkout**, capped $99/yr founding offer, license server validating old + new customers.
- The **local-first + BYOK confidentiality story** — true, demonstrable, our strongest *honest* differentiator. Shippable now.

### Gaps that matter, by risk
**Tier 1 — credibility / liability (block any law/tax push):**
1. **Practice packs are unreviewed drafts.** Professional's $149/yr value prop is "attorney/CPA-reviewed, maintained packs" — not true yet. Marked "Preview" (defensible), but we're selling the subscription on an unkept promise. **THE gate.**
2. **Compliance claims partially unvetted** — §7216/§6713 + Heppner framing corrected by research but not by a tax/bar-active attorney; EU patent-novelty claim has zero patent-attorney review. Getting a legal claim wrong *to a legal audience* is uniquely damaging.
3. **Founder bio live + unverified** — "Eight years at Samsung, AstraZeneca, Tesla" + "University College London" on the homepage/press-kit. A lawyer will Google it. Confirm accurate, publicly usable, free of Wheel Health/NDA exposure. (Wheel already scrubbed to "health-tech company.")

**Tier 2 — conversion (tank a launch even if all true):**
4. **Zero social proof.** Verified: not a single testimonial/named user/press signal on the site. Our ICP is the most risk-averse buyer alive; nobody wants to be the first stranger to put privileged data in an unknown tool.
5. **Money flow never run end-to-end.** Checkout + license keys + validator each verified in isolation; no real buy → email → activate → unlock has happened.

**Tier 3 — polish (soon, not blockers):**
6. **Brand leak at checkout:** customers pay at `projelli.lemonsqueezy.com` (store named "projelli"). Rename store / custom checkout domain. (3 stray `PROJELLI_` refs in dev docs — trivial.)
7. **Pricing coherence:** Personal $49 *one-time* gives the full app forever; Professional $149/*yr* adds only one (unvalidated) pack. A rational solo buys Personal once. Revisit after packs are validated.
8. Confirm `/try/` demo reflects the *pivoted* product.

### Recommendation: stage it, don't hard-launch
- **Now:** sell on the honest, shippable pitch (local-first + BYOK + general app). Lead with **consulting** (no statutory claims). Packs stay "preview." Recruit design partners for testimonials + pack dogfooding.
- **Before law/tax hard push:** close attorney + CPA + patent reviews, verify bio, run a real test purchase, land 2–3 testimonials → then go loud (Ambrogi / Above the Law / Product Hunt).

The critical path is now **outreach, not code.**

---

## Part 2 — The First-Dollar Plan

**Goal: one real paying customer, fast, on the honest local-first pitch — NOT gated on advisors.**

Key insight: the advisor/compliance gate blocks the *law/tax hard launch*. It does **not** block the first dollar. Dollar #1 comes from the **local-first/BYOK value, which is true and shippable today**, sold to people who already want local-first (privacy-conscious pros, consultants, technical/indie users, warm network). Lowest-friction tier: **Personal $49 one-time** (impulse-buyable, no subscription commitment).

### The sprint (sequenced)
**Step 0 — Prove the funnel (THE gate; nothing else matters until this is green).**
One real end-to-end transaction: buy → license email → activate in the app → unlocks → survives restart. Also confirm refund/cancel revocation. *Owner: shared — Claude drives a test-mode purchase + /activate check, or Jameson runs a real $49 + refund. We cannot ethically ask for money until this is proven.*

**Step 1 — Warm network (fastest, highest-trust dollars).**
Jameson personally messages 15–20 warm contacts (consulting-side colleagues, ex-coworkers, friends, IndieHackers DMs) with a personal note: *"I built a local-first AI workspace — your files never leave your machine, bring your own API key. $49. Would love your honest take."* Warm + local-first + low price = most likely source of dollar #1 **and** testimonial #1. *Owner: Jameson. Claude provides the DM/email template.*

**Step 2 — One honest public channel.**
A **Show HN** ("Local-first AI workspace where every chat becomes a real file on your disk, BYOK") and/or **r/LocalLLaMA + r/privacy** post. Framed PURELY on local-first/BYOK/chat-as-files — **no compliance claims** (that audience doesn't need them and won't scrutinize bar opinions). This audience pays for exactly this. *Owner: Jameson posts; Claude drafts the copy (channel packs already exist in `docs/marketing/channels/`).*

**Step 3 — Capture proof.**
The moment 1–3 people buy or actively use it, ask for a short testimonial + permission to name them. **This unlocks the law/tax launch.** *Owner: Jameson; Claude drafts the ask.*

### What unblocks the *bigger* money (parallel track, Jameson's hands)
Recruit attorney + CPA + patent advisors (packets + outreach emails already drafted: `docs/marketing/campaigns/`), verify the founder bio, then the law/tax push (Ambrogi/ATL/PH). This is the path from "first dollar" to "real revenue," but it should not block the first dollar.

### Claude can do now (no Jameson dependency)
- Drive the **funnel verification** (test-mode purchase + activation check).
- Draft the **warm-outreach template** + the **Show HN / Reddit copy** (honest local-first framing).
- Wire **Plausible conversion goals** (Download / Buy / GitHub click — the punted W1-13) so we can see the funnel.
- Fix the **checkout brand leak** (store rename / custom domain) if desired.

### Jameson-only (the actual first-dollar levers)
- The warm DMs/emails (his identity + network).
- Posting the public launch (per the no-autonomous-posting rule).
- Go on a real-card test purchase (or accept the test-mode proof).
- Advisor outreach + bio verification (for the bigger launch).
