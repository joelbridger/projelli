# SOC 2 and DPA: Decision Brief for Jameson

**Date:** 2026-06-08
**For:** Jameson Daines (founder, Advisor Prep Hero)
**Status:** Decision brief -- your call. This document gives you the information; it does not make the decision.

---

## What this brief covers

Two questions that are coming up in regulated-vertical sales (RIA compliance, multi-lawyer firm IT review, and malpractice carriers):

1. Should we pursue SOC 2 Type II certification?
2. What does a "real" DPA require, and where does the draft template leave off?

Neither of these is something a build session can complete for you. Both are spend decisions and strategic calls. This brief gives you the plain-language version of what each involves so you can decide.

---

## Part 1: SOC 2

### What is it?

SOC 2 is an audit standard created by the American Institute of CPAs (AICPA). An independent CPA firm examines a company's controls around security, availability, processing integrity, confidentiality, and privacy, then issues a report.

- **Type I** -- a point-in-time report: your controls are designed correctly as of a specific date. Cheaper and faster. Less trusted by enterprise buyers.
- **Type II** -- a report covering a period of time (typically 6-12 months): your controls actually operated effectively across that period. This is what enterprise buyers, enterprise IT, and compliance-heavy organizations ask for. The only version worth pursuing if the goal is closing regulated-vertical deals.

The trust categories you would include in scope are your choice. Security (CC) is the most common and typically the minimum. You can add Availability, Confidentiality, etc.

### What it actually involves

1. **Readiness work.** Before the audit, you scope what systems are in-scope, document your controls (who does what, what logs exist, what policies are written), and close any gaps. This is 2-4 months of work even with automation tools.

2. **Audit observation period.** The auditor watches your controls operate for 6-12 months. This means the controls have to actually run during that period: access reviews happen on schedule, incident response procedures are followed, change management is documented, etc.

3. **Audit report.** At the end of the observation period, the auditor issues the Type II report. It is issued annually thereafter (most buyers want a current report, typically less than 12 months old).

4. **Ongoing maintenance.** Controls have to keep running. You need someone responsible for this quarterly at minimum.

### Cost and timeline bands (approximate; verify with vendors)

These are rough market bands as of mid-2026. Actual quotes will vary by scope and vendor.

**Automated compliance platforms (recommended starting point for a small company):**

| Platform | Approximate annual cost | Notes |
|---|---|---|
| **Vanta** | $15,000-$25,000/yr | Widely used; integrates with AWS, GCP, GitHub, etc.; automates evidence collection; helps close gaps faster; includes automated testing and a trust portal |
| **Drata** | $15,000-$30,000/yr | Similar feature set to Vanta; slightly heavier enterprise focus; audit partner network |
| **Secureframe** | $10,000-$20,000/yr | More affordable starting point; good for early-stage; similar automation |

These costs cover the platform only. The audit itself is additional.

**Audit firm cost (separate from the platform):**

| Scope | Approximate cost |
|---|---|
| Type II, Security only, small company, 6-month period | $12,000-$25,000 |
| Type II, Security + Confidentiality, 12-month period | $20,000-$40,000 |

**Total first-year cost estimate:** Platform + audit. Roughly $25,000-$65,000 all-in, depending on scope and vendor. Year two is lower (no readiness ramp; audit renewal is typically $12,000-$25,000).

**Timeline to first Type II report:**
- Month 1-3: readiness assessment and gap remediation (with a platform, this is faster)
- Month 4-16: observation period (minimum 6 months; 12 is more credible)
- Month 16-18: audit fieldwork and report issuance

Realistically, you will not have a Type II report to hand a customer for 12-18 months from when you start, assuming you start now.

### The Advisor Prep Hero-specific complication

Advisor Prep Hero's architecture reduces the audit surface. Most SOC 2 Type II controls focus on server-side data processing: who can access user data, how is it encrypted in transit and at rest on the server, what are your backup and recovery controls. Because workspace data is not on our servers, most of that surface doesn't exist.

The audit surface that does exist: the license validation server, the update-check server, and the web demo proxy. A competent auditor would scope appropriately once they understood the architecture.

This could actually make the audit cheaper and faster than a typical SaaS company. But it also means a SOC 2 report from us would come with an unusual scope description that a buyer's IT team might not know how to interpret. Worth discussing with an auditor before committing.

### Who is actually asking for it?

Based on the gatekeeper one-pagers and reviewer feedback collected so far:

- **RIA compliance departments** are the most likely to hard-block on SOC 2 for a multi-advisor firm deal.
- **Multi-lawyer-firm IT** -- some firms have a hard requirement; many solo and small-firm buyers do not.
- **Malpractice carriers** are not asking for SOC 2 today. They are asking the architectural questions our one-pager already answers.
- **CPAs and EAs** in solo/small practices are not asking for SOC 2. Enterprise accounting firms might be, but that is not our current ICP.

**Rough read:** SOC 2 is a blocker for the larger-firm segment (5+ advisors, 5+ attorney firms, enterprise accounting). It is not a blocker for the solo-to-small segment we are targeting in the launch phase.

---

## Part 2: The DPA

### What a "real" DPA needs (beyond the draft template)

The draft template at `docs/legal/dpa-template.md` gives you a skeleton. For a real, signable DPA you need:

1. **A legal entity.** The DPA has to be between a real named entity and the customer. You need an LLC or corporation in a real jurisdiction to execute a contract. The draft has `[Entity legal name, jurisdiction]` as a placeholder. This is a prerequisite.

2. **A lawyer's review.** The template flags 10 open questions that need legal answers (GDPR applicability, CCPA thresholds, Controller vs Processor classification, governing law). These are not questions an AI assistant should decide. A one-time review by a contracts attorney would resolve most of them. Rough cost: $500-$2,000 for a startup-focused attorney to review and mark up the template.

3. **Standard Contractual Clauses (if you want EU customers).** If you want to offer a DPA to EU/UK customers, you need the right SCCs attached. These are standardized EU template documents. A lawyer selects and attaches the right module.

4. **An entity to sign it.** Someone has to sign on behalf of Advisor Prep Hero. That is you, as the authorized representative of whatever entity you form.

### The honest framing

A DPA is really a contract about a cloud SaaS processor handling customer data on its servers. Advisor Prep Hero's local-first architecture doesn't fit that model cleanly. Most of what a typical DPA says (how the vendor protects data on its servers, what sub-processors it uses, how it handles deletion requests) doesn't apply to us in the normal way.

The right answer for a customer asking for a DPA is probably a disclosure document that explains the architecture and the actual data relationship honestly, rather than a standard processor DPA with most of the clauses modified to say "not applicable." Our lawyer can advise on the right framing.

The draft template takes a crack at this with the "Architectural note" in Section 2.2, but a lawyer should review whether that framing holds up.

---

## Recommendation

**For SOC 2:** Don't start the audit process now. The solo-to-small segment we're targeting in the launch phase is not blocked on SOC 2. The cost and timeline do not make sense until you have evidence that you're consistently losing enterprise-segment deals specifically because of the missing cert. A reasonable trigger: if 3 or more qualified deals in the $5,000+ range stall at the "we need SOC 2 to proceed" stage in the same quarter, that's the signal to start the readiness work. If and when you do start, begin with Secureframe or Vanta for the platform and a short-list of two auditor firms for quotes.

**For the DPA:** The simpler version of this is forming the entity first (you were planning to do this anyway), then having a startup contracts attorney do a one-time review of the template draft. That is a $500-$2,000 spend that gets you a signable document. Do that when the first customer asks for one and it becomes a blocker for a real deal. Not before.

**Both of these are your call.** I'm not in a position to make a spend decision for you, and both involve legal commitments outside the scope of what I should decide on your behalf. The framework above should give you enough to decide when the time comes.

---

## What I've built that doesn't require these decisions

While this brief sits with you:

- The public trust page (`website/security/index.html`) is live in staging. It honestly describes the current posture, states that we don't have SOC 2 or a signed DPA, and gives a CCO or IT reviewer enough to evaluate the architecture. Many buyers in our ICP will find this sufficient.
- The security FAQ (`docs/marketing/security-faq.md`) feeds the gatekeeper one-pagers and gives your reviewers a ready-made questionnaire response.
- The DPA draft template (`docs/legal/dpa-template.md`) is ready for legal review when you want to move on it.

These three assets cover most of the actual reviewer friction without requiring the cert or the signed DPA. The cert and the DPA are the right next step for the enterprise segment; they are not required to close the solo-to-small segment today.
