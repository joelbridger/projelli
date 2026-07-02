I kept this fully read-only. I did **not** write `/home/jameson/lantern-plus/feasibility/research/codex-advisor-pain-discovery.md` because your first instruction said not to create or edit files.

Below is the markdown content I would put there.

```md
# Advisor Pain Discovery: Evidence-First Ranked List

## Short Take

Best bets for a local-first document-intelligence desktop app:

1. Compliance/audit-prep evidence gathering
2. Client document chaos across email, drives, portals, and CRMs
3. Onboarding paperwork and NIGO prevention
4. Tax-season document coordination
5. Marketing-content compliance review and substantiation
6. Aging-client/diminished-capacity protocols
7. Held-away asset visibility from documents, not live account aggregation
8. Fee-billing/disclosure reconciliation
9. Estate-document collection and gap spotting

Local-first means the advisor’s sensitive client files stay on their own computer by default. That is meaningfully different from another cloud workflow tool, especially after Reg S-P.

---

## 1. Compliance / Audit-Prep Evidence Binder

**Pain:** Advisors need to prove what happened: policies, client communications, marketing materials, substantiation, incident-response steps, disclosures, client files, and books-and-records evidence.

**Evidence:**
- SEC’s 2024 Reg S-P amendments require written incident-response programs, customer-notification procedures, vendor oversight, and service-provider breach notice within 72 hours. Smaller entities hit compliance in June 2026. Source: Federal Register / SEC Reg S-P amendments: https://www.federalregister.gov/documents/2024/06/03/2024-11116/regulation-s-p-privacy-of-consumer-financial-information-and-safeguarding-customer-information
- SEC marketing-risk alert found missing social-media records, missing support for performance claims, and inaccurate Form ADV reporting. Source: SEC Risk Alert PDF: https://www.sec.gov/files/exams-risk-alert-marketing-observation-2024.pdf
- T3 2026 says compliance tools are moving toward AI assembling compliance information in real time, monitoring messages, and suggesting policy language. Source: T3 2026 survey: https://t3technologyhub.com/wp-content/uploads/2026/03/2026-T3_Inside-Information-Software-Survey.pdf
- Kitces says admin burden hurts advisor wellbeing; more tech by itself does not reliably reduce admin time. Source: https://www.kitces.com/blog/financial-advisor-technology-wellbeing-research-hiring-efficiency-automation/

**Severity:** High  
**Frequency:** High for SEC/state-regulated firms; spikes during exams, marketing review, annual review, incidents.

**Existing-tools-gap:** Smarsh, RIA in a Box, Comply, Orion Compliance, Greenboard, Hadrius exist. They focus on compliance workflows, archiving, supervision, or policy. They do not fully solve “pull every client-specific document/email/citation into an examiner-ready packet from my real messy files.”

**Our angle:** “Exam Binder”: per-client or firm-wide evidence packs built from local docs + email, with citations, source files, timestamps, redlines, and audit log. Strong fit for local-first because exam prep touches sensitive client data.

**Impact:** High  
**Effort:** L

---

## 2. Client Document Chaos Across Drives, Email, CRM, Portals

**Pain:** Advisors store key facts in too many places: email attachments, Google Drive, OneDrive, SharePoint, CRM notes, planning software, tax PDFs, estate docs, custodian statements.

**Evidence:**
- T3 2026 says document management is mostly generic “computer filing cabinet” software; top tools are OneDrive, SharePoint, Google Drive, Box, Dropbox. Advisor-specific tools are not dominant. Source: T3 2026 survey.
- T3 2026 says document management became more important to small and midsize firms. Source: T3 2026 survey.
- Kitces 2025 says integrations are the biggest driver of tech-stack satisfaction, but have little relationship to productivity. Advisors still re-enter and reconcile data across tools. Source: https://www.kitces.com/blog/the-latest-in-financial-advisortech-august-2025-nitrogen-ai-meeting-notes-tool-notetaker-tech/
- XYPN tells RIAs to map workflows for document onboarding, planning, meetings, trading, billing, and reviews before choosing tools. Source: https://www.xyplanningnetwork.com/answer-hub/the-essential-wealth-management-tools-for-independent-fee-only-rias

**Severity:** High  
**Frequency:** Daily.

**Existing-tools-gap:** Generic storage is liked but dumb. CRM vaults are structured but incomplete. Planning tools hold outputs, not the full evidence trail. Data warehouses are still low-adoption; T3 2026 shows only 3.27% market penetration.

**Our angle:** Local “Client Map”: connect folders + email, OCR everything, isolate by client, answer with citations, and produce Word-native summaries. Do not replace CRM. Become the private search and reasoning layer over the messy client record.

**Impact:** High  
**Effort:** M/L depending connectors

---

## 3. Onboarding Paperwork, NIGO, and Handoff Friction

**Pain:** New-client onboarding breaks when docs are missing, forms are wrong, signatures are missing, or sales-to-service handoff is unclear.

**Evidence:**
- Reddit r/CFP onboarding thread: former CSA says priority after close is gathering statements, tax returns, personal info, then account apps, transfer paperwork, contracts, IPS, and setup in reporting/CRM/planning software. Source: https://www.reddit.com/r/CFP/comments/1s3vkt5/onboarding_process/
- Same thread says sloppy onboarding creates tension between sales advisors and service advisors because service wants everything upfront while sales wants less friction. Source: same Reddit thread.
- T3 2025 added client onboarding/proposal generation as a new category; Jump made a splash there. Source: T3 2025 survey: https://t3technologyhub.com/wp-content/uploads/2025/03/T3Inside-Information-2025-Software-Survey.pdf
- Docupace markets NIGO reduction through automated form checks and compliance checks, proving the pain is real. Source: https://www.docupace.com/new-account-opening/

**Severity:** High  
**Frequency:** Every new household; worse during breakaways/transitions.

**Existing-tools-gap:** Docupace, PreciseFP, Jump, OnBord, Feathery exist. They tend to be cloud workflow/form systems. They help forms, but not always the messy “what do we already have in email/drive, what is missing, what contradicts the CRM?” layer.

**Our angle:** “Onboarding Readiness Check”: scan client packet, statements, tax returns, IDs, agreements, transfer forms; flag missing signatures, mismatched names/addresses, old statements, missing beneficiaries, missing trusted contact, missing ADV/CRS evidence.

**Impact:** High  
**Effort:** L

---

## 4. Tax-Season Document Coordination

**Pain:** Tax is valuable for advisors, but coordinating tax documents, CPAs, client questions, and post-filing review is painful.

**Evidence:**
- Reddit r/CFP tax thread: advisors describe tax returns and tax documents as more painful than financial planning, hard to staff, and easy to fall behind on. Source: https://www.reddit.com/r/CFP/comments/1qntfr7/inhouse_tax_prep_planning/
- IRS tells taxpayers to keep tax documents together to avoid errors and delays. Source: https://www.irs.gov/filing/gather-your-documents
- Holistiplan’s fast adoption shows tax-return review is a proven advisor workflow. Kitces says Holistiplan reached 42% adoption among advisors in about five years. Source: https://www.kitces.com/blog/the-latest-in-financial-advisortech-february-2025-news-fp-alpha-right-capital-holistiplan-tax-return-extraction/
- Holistiplan tax-prep-letter positioning focuses on reducing back-and-forth with CPAs. Source: https://t3technologyhub.com/holistiplan-expands-product-to-help-advisors-maximize-year-round-tax-planning-opportunities/

**Severity:** High  
**Frequency:** Seasonal, annual for many clients.

**Existing-tools-gap:** Holistiplan is strong at tax-return extraction and tax planning. It is less obviously a full client-document command center across email, CPA messages, custodian docs, prior-year events, and advisor notes.

**Our angle:** “Tax Season Packet”: gather expected 1099s/K-1s/charitable/Roth/conversion/DAF/tax-loss-harvest evidence from local docs + email, compare against prior-year return and advisor actions, generate CPA letter and client checklist in Word.

**Impact:** High  
**Effort:** M/L

---

## 5. Marketing Content Compliance and Substantiation

**Pain:** Advisors want to market more, but every post, testimonial, rating, claim, and performance statement can create compliance work.

**Evidence:**
- SEC marketing-risk alert found failures around keeping social posts, third-party-rating evidence, and support for performance claims. Source: SEC Risk Alert: https://www.sec.gov/files/exams-risk-alert-marketing-observation-2024.pdf
- SEC lists general prohibitions: no misleading statements, unsupported material claims, unbalanced benefit/risk claims, or unfair performance presentation. Source: same SEC alert.
- XYPN says the SEC marketing rule gives more flexibility but adds complexity, especially social media and testimonials. Source: https://www.xyplanningnetwork.com/advisor-blog/your-guide-to-social-media-compliance-and-the-new-sec-marketing-rules
- Hadrius and Greenboard growth in T3 shows demand for AI compliance review. Sources: https://www.hadrius.com/ and T3 2026 survey.

**Severity:** Medium/High  
**Frequency:** Weekly/monthly for growth-minded RIAs; daily for firms publishing heavily.

**Existing-tools-gap:** Hadrius, Greenboard, Smarsh, Archive Intel, Saifr exist. But many are compliance platforms, not advisor writing surfaces. They may not connect each claim to the exact substantiating document in the firm’s files.

**Our angle:** Word-native “Marketing Claim Checker”: draft/redline content, flag risky phrases, attach proof for each factual claim, keep an archive packet with citations and approvals.

**Impact:** High  
**Effort:** M

---

## 6. Aging-Client / Diminished-Capacity Protocols

**Pain:** Advisors face messy, sensitive situations: cognitive decline, trusted contacts, family pressure, exploitation risk, privacy limits, and documentation duties.

**Evidence:**
- Kitces says no single law tells advisors exactly what to do; advisors face SEC rules, privacy limits, and inconsistent state reporting laws. Source: https://www.kitces.com/blog/cognitive-decline-regulations-compliance-risk-diminished-capacity-clients-financial-advisor/
- Kitces says advisors need documented steps, not just good intentions. Source: same Kitces article.
- FINRA Rule 4512 requires reasonable effort to get trusted contact info; Rule 2165 permits temporary holds for suspected exploitation and requires trusted-contact notice when available. Source: https://www.finra.org/rules-guidance/guidance/reports/2024-finra-annual-regulatory-oversight-report/trusted-contact-persons

**Severity:** Very high when it happens  
**Frequency:** Medium; rises with retiree-heavy books.

**Existing-tools-gap:** CRM notes and compliance manuals exist, but they do not guide an advisor through “what did we observe, who can we contact, what documents support this, what did we do next?”

**Our angle:** “Vulnerable Client Protocol”: per-client trusted-contact tracker, POA/estate-doc inventory, observed-concern log, escalation checklist, letter templates, and evidence bundle.

**Impact:** High  
**Effort:** M

---

## 7. Held-Away Asset Visibility Without Fragile Aggregation

**Pain:** Advisors need a full picture of outside 401(k)s, HSAs, bank accounts, inherited accounts, and unmanaged brokerage accounts. Live account aggregation is useful but unreliable and regulated.

**Evidence:**
- T3 2026 says account aggregation is above 50% penetration, but some major providers have poor ratings: Morningstar ByAllAccounts 5.85, Plaid/Quovo 6.08, Envestnet/Yodlee 6.72. Source: T3 2026 survey.
- Kitces May 2026 says account aggregation tools had the lowest satisfaction score among common AdvisorTech categories. Source: https://www.kitces.com/blog/the-latest-in-financial-advisortech-may-2026-morningstar-byallaccounts-data-aggregation-finny-advisor360-wealth/
- Kitces 2024 says held-away asset-management tech is under state-regulator scrutiny. Source: https://www.kitces.com/blog/401k-held-away-asset-management-data-aggregation-pontera/
- SmartAsset notes data accuracy and client reluctance are challenges for held-away assets. Source: https://smartasset.com/advisor-resources/assets-held-away

**Severity:** Medium/High  
**Frequency:** Common in planning, reviews, rollover moments.

**Existing-tools-gap:** eMoney/RightCapital/Pontera/Plaid/Yodlee solve live aggregation or management. But they can break, require credentials, raise security worries, and may be too heavy for “just read the statements clients already sent me.”

**Our angle:** “Held-Away Snapshot from Documents”: OCR statements and emails, build a dated outside-asset map, show stale items, cite source statements, avoid storing client portal credentials.

**Impact:** Medium/High  
**Effort:** M

---

## 8. Fee-Billing and Disclosure Reconciliation

**Pain:** Advisory fee mistakes are boring but dangerous: wrong fee rate, excluded assets billed, cash billed incorrectly, breakpoints missed, refunds missed, agreements not matching Form ADV.

**Evidence:**
- SEC June 2026 risk alert found undisclosed or incomplete economic-conflict disclosures and practices inconsistent with agreements/disclosures. Source: https://www.sec.gov/files/observations-ia-obligations-related-economic-conflicts-interest-060926.pdf
- SEC specifically flagged cash balances subject to asset-based fees, higher-cost money market share classes, and incomplete disclosure. Source: same SEC alert.
- SEC 2021 fee-calculation risk alert says exams often lead to client refunds due to fee errors. Source: https://www.sec.gov/files/exams-risk-alert-fee-calculations.pdf

**Severity:** High  
**Frequency:** Quarterly billing; review burden varies by firm.

**Existing-tools-gap:** Orion, Black Diamond, Envestnet BillFin, AdvicePay, Panoramix, AdvisorBOB exist. They calculate bills, but a local document tool can compare contracts, ADV, billing files, cash policies, and exceptions.

**Our angle:** “Billing Evidence Check”: read advisory agreement + ADV + fee schedule + billing export; flag mismatches and produce an internal review memo.

**Impact:** Medium/High  
**Effort:** L/XL depending data exports

---

## 9. Estate Document Collection and Gap Spotting

**Pain:** Advisors need to know whether clients have wills, trusts, POAs, healthcare directives, beneficiary designations, trustee/executor details, and whether documents conflict with the financial plan.

**Evidence:**
- FP Alpha and Holistiplan both now support estate-document extraction, showing market demand. Sources: https://fpalpha.com/ and https://www.kitces.com/blog/the-latest-in-financial-advisortech-november-2024-holistiplan-new-estate-planning-document-tool-quivr-currentclient-news/
- Kitces is skeptical that estate-document extraction has as much demand as tax-return extraction because estate docs update less often than tax returns. Source: same Kitces article.
- FINRA trusted-contact and position-of-trust rules make estate/trust roles operationally sensitive. Source: FINRA trusted contacts page above.

**Severity:** Medium/High  
**Frequency:** Lower than tax; high importance for HNW/older clients.

**Existing-tools-gap:** FP Alpha, Vanilla, Wealth.com, EncorEstate, Holistiplan. They are stronger for estate analysis/prep than for private firm-wide document inventory.

**Our angle:** Do not compete head-on as “estate planning software.” Build “Estate Document Inventory”: what docs exist, date, parties, missing items, beneficiary mismatch notes, and source citations.

**Impact:** Medium  
**Effort:** M

---

## Overall Recommendation

Do not position as another AI notetaker or CRM-sync tool. The stronger wedge is:

**“Private client-file intelligence for RIAs: find, cite, review, and package the evidence buried across documents and email.”**

Best first product slice:

1. Connect local folders + email.
2. Create per-client isolated file maps.
3. OCR and cite everything.
4. Produce three high-value packets:
   - Exam Binder
   - Onboarding Readiness Check
   - Tax Season Packet

This fits the current Keepance strengths: cited RAG, per-client isolation, Word-native redlines, OCR, audit log, templates, and a privacy-first desktop story.
```
