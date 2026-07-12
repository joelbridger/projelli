# Schwab Advisor Services — Integration Partner Application (DRAFT)

*Draft prepared by Fable for Jameson to review, personalize, and submit. This is the narrative you'd bring to Schwab Advisor Services' third-party integration / digital-onboarding program. Fill the [brackets]; the security specifics are in `schwab-security-posture.md`.*

---

## 1. Company & product
- **Product:** Advisor Prep Hero — a local-first AI workspace for financial advisors. Client documents, email, and files stay on the advisor's own machine; the product answers questions across them with verifiable citations, and drafts client-ready documents.
- **Company / applicant:** [Jameson S Daines / legal entity — sole proprietor, 1694 S Main St, Orem UT 84058].
- **Website:** advisorprephero.com
- **Stage / traction:** [pre-launch / early users — fill in honestly].

## 2. What we want to integrate
We want to let advisors **open Schwab custodian accounts** (Individual, Joint, Roth/Traditional/Rollover/Inherited IRA, Living Trust, Custodial) directly from their post-meeting workflow, with the application **prefilled** from the advisor's meeting notes and CRM — then handed into Schwab's **Digital Account Opening** for client eAuthorization. Specifically we're requesting access to:
- Schwab's Digital Account Opening / partner data-passing (the "up to 50 data points" prefill capability).
- eAuthorization for client approval.
- (If available) status callbacks so the advisor sees account-open progress in-app.

## 3. Why this is good for Schwab & advisors
- Removes the biggest friction in onboarding a new household — retyping data that already exists in the advisor's notes/CRM.
- Fewer NIGO (not-in-good-order) applications because the advisor reviews every prefilled field before eAuthorization.
- Deepens Schwab's stickiness with RIAs who use modern AI tooling.

## 4. Our security & data posture (summary — full doc attached)
- **Local-first:** confidential client data lives on the advisor's machine, not our servers. We are structurally low-risk as a data custodian because we hold very little.
- **BYOK AI:** AI runs on the advisor's own provider key or fully on-device; we never see prompts or client content.
- **Firm collaboration** is end-to-end encrypted (our relay stores only ciphertext).
- Data passed to Schwab would flow **from the advisor's machine to Schwab** for account opening, reviewed by the advisor first, audited in an append-only log.
- SOC 2: [current status — see security posture doc; state readiness honestly].

## 5. What we're asking Schwab for
- Entry into the appropriate integration / digital-onboarding partner track for Schwab Advisor Services.
- The technical + compliance requirements checklist and timeline.
- A sandbox / test environment to build against.

## 6. Contacts / next steps (to fill during outreach)
- Schwab Advisor Services integration team contact: [find via advisorservices.schwab.com / rep].
- Our technical lead: [Jameson]. Security contact: [Jameson].
- Target: submit application, get requirements checklist, scope timeline.

---
*Note: this is a multi-quarter relationship, not a sign-up. The value of drafting it now is so the application goes out early — the clock is the constraint, not the writing.*
