# Lantern Intake — Questions for Jameson
Only the calls that genuinely need you. One at a time is fine. Each comes with my recommendation so you can just react. Everything else in the design I decided and flagged in the docs for review.

---

**1. Can a client re-view their own answers after submitting them?**
My recommendation: **no for the sensitive ones**. Once a client submits their Social Security number or license photos, the page only ever shows "Provided, ending in 1234." Even they can't pull it back up. Why: if a link gets forwarded or leaks, whoever has it can see progress but can never read the SSN or download the license. It also makes our privacy story very easy to say out loud. The small cost: a client who mistypes can't check what they typed; they just resubmit (which is easy).

**2. Which pricing tier gets Intake?**
My recommendation: **all paid tiers**, with the multi-advisor parts (a whole firm sharing one client's onboarding) reserved for the Firm tier. Why: Intake is the front door of the whole product story and our best demo moment; gating it would starve adoption exactly where solo advisors feel the pain most. The board can revisit once real usage exists.

**3. What web address do clients see when they open the link?**
My recommendation: **one neutral, professional Lantern-owned address** (for example `intake.lanternplatform.app`) with the firm's name and logo big on the page itself, for v1. Custom firm addresses can come later. Why: one address keeps the security setup simple and auditable, and what actually builds client trust is the firm branding on the page plus the advisor personally sending the link. Flagging because the address is customer-visible brand surface, which is board territory.

**4. How long do we keep the license photos after onboarding finishes?**
My recommendation: **keep them, encrypted, in the client's folder by default, with a one-click "delete scans" control per client and a firm-wide auto-delete setting** (for example, delete 90 days after onboarding completes) that firms can turn on. Why: firms differ here and some genuinely need the scans later, but a visible retention control is exactly the kind of honesty our IT-gatekeeper story is built on. I did not pick auto-delete as the default because silently disappearing client records is the scarier failure for an advisor.

**5. One link per household, or one per person?**
My recommendation: **one link per household for v1.** Inside the checklist, items are labeled per person ("Lena's Social Security number"). Why: couples share the burden naturally ("you do the license photos, I'll do the numbers"), and one link means one thing to lose track of. Per-person links (needed if spouses keep secrets from each other, which is real but rare at onboarding) can come later without redesign.

---

That's it. Five calls. Everything else is designed and waiting on these plus your general read of PRODUCT-DESIGN.md.
