# Lantern Intake — Questions for Jameson
> **STATUS: ALL FIVE DECIDED — Jameson, 2026-07-10, every recommendation adopted.** Kept as the decision record; the decisions are propagated through PRODUCT-DESIGN.md, ARCHITECTURE.md, WAVE-PLAN.md, and RISKS.md, so nothing in the design reads as pending.

---

**1. Can a client re-view their own answers after submitting them?**
✅ **DECIDED 2026-07-10 (Jameson): recommendation adopted — no re-viewing of sensitive answers; the Replace-answer flow stands.**
My recommendation: **no for the sensitive ones**. Once a client submits their Social Security number or license photos, the page shows the "ending in 1234" confirmation only in that moment, and afterward just "Provided." Even they can't pull it back up. Why: if a link gets forwarded or leaks, whoever has it can see progress but can never read the SSN or download the license. It also makes our privacy story very easy to say out loud. Mistakes are covered by a designed path: every completed item has a clear "Replace this answer" button that reopens it, so a mistyped number is one tap to fix.

**2. Which pricing tier gets Intake?**
✅ **DECIDED 2026-07-10 (Jameson): recommendation adopted — all paid tiers; multi-advisor parts Firm-tier only.**
My recommendation: **all paid tiers**, with the multi-advisor parts (a whole firm sharing one client's onboarding) reserved for the Firm tier. Why: Intake is the front door of the whole product story and our best demo moment; gating it would starve adoption exactly where solo advisors feel the pain most. The board can revisit once real usage exists.

**3. What web address do clients see when they open the link?**
✅ **DECIDED 2026-07-10 (Jameson): recommendation adopted — one neutral Lantern-owned address with firm branding on the page; custom domains later.**
My recommendation: **one neutral, professional Lantern-owned address** (for example `intake.lanternplatform.app`) with the firm's name and logo big on the page itself, for v1. Custom firm addresses can come later. Why: one address keeps the security setup simple and auditable, and what actually builds client trust is the firm branding on the page plus the advisor personally sending the link. Flagging because the address is customer-visible brand surface, which is board territory.

**4. How long do we keep the license photos after onboarding finishes?**
✅ **DECIDED 2026-07-10 (Jameson): recommendation adopted — keep encrypted in the client folder; per-client one-click delete; optional firm-wide auto-delete, off by default.**
My recommendation: **keep them, encrypted, in the client's folder by default, with a one-click "delete scans" control per client and a firm-wide auto-delete setting** (for example, delete 90 days after onboarding completes) that firms can turn on. Why: firms differ here and some genuinely need the scans later, but a visible retention control is exactly the kind of honesty our IT-gatekeeper story is built on. I did not pick auto-delete as the default because silently disappearing client records is the scarier failure for an advisor.

**5. One link per household, or one per person?**
✅ **DECIDED 2026-07-10 (Jameson): recommendation adopted — one link per household for v1.**
My recommendation: **one link per household for v1.** Inside the checklist, items are labeled per person ("Lena's Social Security number"). Why: couples share the burden naturally ("you do the license photos, I'll do the numbers"), and one link means one thing to lose track of. The honest tradeoff to know about: anyone holding the household link (a spouse, an adult child helping out) can see which of the other person's items are done and can submit answers for them — including marking a still-open item done, which the real client would then see as done (every such submission from an unfamiliar device is chipped on the advisor's board, and the page distinguishes "provided by you just now" from plain "provided") — though they can never read anything submitted, not even partial digits (the design hides those from everyone after the moment of entry). Per-person links (for households that keep finances separate, which is real but rare at onboarding) can come later without redesign.

---

All five decided 2026-07-10; the design has no pending product calls.
