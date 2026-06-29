# SOC 2 readiness and gap mapping

> **This is a readiness and gap-analysis document. It is NOT a SOC 2 report and Keepance is NOT SOC 2 certified.**
>
> A SOC 2 examination is performed only by a licensed, independent CPA firm. A **SOC 2 Type II** report additionally requires an **observation period (commonly 3 to 6 months)** during which the auditor tests that controls operated effectively over time. Neither the architecture described here nor this document satisfies that. Product architecture provides some of the *technical* controls a SOC 2 examination looks for; it does not provide the *policies, governance, monitoring, vendor management, or independent attestation* that a report requires. This document maps what exists today to the Trust Services Criteria (TSC) and states the gaps honestly so the work to become audit-ready is visible.

---

## What SOC 2 actually requires (so expectations are set)

- An **independent CPA firm** conducts the examination and issues the report. A vendor cannot self-certify.
- **Type I** attests that controls are *suitably designed* at a point in time. **Type II** attests they *operated effectively* across an observation window (typically 3 to 6 months of evidence). Type II is what enterprise and law-firm buyers usually ask for.
- The report covers a defined **scope** (which system, which TSC categories) and a stated **service organization** (a real legal entity).
- All five categories exist, but only **Security (the Common Criteria)** is mandatory; **Availability, Confidentiality, Processing Integrity, and Privacy** are included only if in scope.
- A real examination expects **written policies, evidence of consistent operation, change management records, vendor/sub-processor management, monitoring and alerting, incident response, and risk assessment**: organizational controls, not only product features.

Keepance's situation is unusual and works in its favor on substance: because the product is local-first and the vendor holds essentially no customer content (see `docs/trust/security-overview.md`), the *blast radius* of the service organization is small. But "small blast radius" is an architectural argument, not a SOC 2 report, and buyers who require SOC 2 will still require the report.

---

## Trust Services Criteria mapping

For each category: what the architecture already provides, and the gap that remains before an auditor could opine. "Have" means it exists in the product or repo and is verifiable; "Gap" means it must be created or formalized.

### Security (Common Criteria, CC). Mandatory category

| Area | Have (verifiable today) | Gap to audit-ready |
|---|---|---|
| Logical access (CC6.1) | AI provider keys and store-encryption keys held in the OS keychain (`keychain.rs`); no shared cloud datastore of customer content to access. Firm-tier identity (SSO via OIDC — Entra/Google/generic) and per-seat access **are built and shipped** (`backend/src/routes/sso.ts`, `backend/src/lib/oidc.ts`; per-seat tokens + ethical-wall key release). | No written access-control policy; no formal access reviews; the technical controls exist but the governance/policy layer around them does not. |
| Encryption (CC6.1, CC6.7) | At rest: SQLCipher for email and audit stores; AES-256-GCM for vector chunk text; three independent keys (`mail/crypto.rs`, `audit/crypto.rs`, `rag/crypto.rs`). In transit: TLS to provider and license endpoints. | Honest residual that an auditor will note: workspace files are plaintext on disk by design; vector `matter_id`/privilege labels are plaintext for query. No formal key-management/rotation policy document. |
| Boundary / data egress (CC6.6) | Local-first; the only routine outbound calls are the license check (key + machine id, no content) and update manifest fetch. In-app egress indicator and data map (`EgressIndicator.tsx`, `DataMapDialog.tsx`). Privileged Matter Mode blocks network extensions for privileged matters. | No network-security policy or firewall/segmentation documentation for the (minimal) license service infrastructure. |
| Audit logging (CC7.2) | Append-only on-device audit log with provenance events: retrieval scope, privilege exclusion, citation verification, egress destination, blocked network-extension writes (`src/types/audit.ts`, `AuditService.ts`). | The log is the *customer's* defense file on their device, not centralized security monitoring of the *service*. No SIEM, no alerting on the license/update infrastructure. |
| Change management (CC8.1) | Source under version control; CI build pipeline (`.github/workflows/release.yml`); code-signed releases (Azure Trusted Signing, Apple Developer ID). | No written change-management policy, no formal approval/segregation-of-duties record, no documented release-approval gate tied to evidence. |
| Risk assessment (CC3.x) | Architecture decision records and a de-risked firm-platform decision doc with an explicit risk register (`spikes/firm-sync/DECISION.md`). | No periodic, documented enterprise risk assessment process. |
| Vendor management (CC9.2) | Sub-processors are few and listed (LemonSqueezy, GitHub) in `docs/legal/DPA-template.md`. | No formal vendor risk-review process or signed sub-processor agreements on file. |
| Monitoring (CC4.x) | n/a meaningfully: little service-side surface to monitor. | No control-monitoring program; no evidence of ongoing operating effectiveness (the core of Type II). |

### Confidentiality: likely in scope (this is Keepance's strongest story)

| Area | Have | Gap |
|---|---|---|
| Confidential data identification and handling | Matter as a first-class confidentiality scope; matter isolation enforced by a pre-search database prefilter; privilege/work-product excluded from retrieval by default (`rag/store.rs`). | No written data-classification and handling policy mapping these controls to the criterion. |
| Confidential data protection | Encrypted-at-rest stores; keychain-held keys; Privileged Matter Mode exfiltration guardrail. | Same key-management policy gap as above. |
| Disposal | Customer deletes their own data on-device; vendor holds no customer content to dispose of. | No written retention/disposal policy for the license/account data the vendor does hold. |

### Availability: in scope only if committed to a firm

| Area | Have | Gap |
|---|---|---|
| App availability | Local-first: the app runs offline for everything except cloud AI calls; a vendor outage does not stop the user working. This is a genuine architectural strength. | The license/update services and (future) firm sync relay / inference proxy have no documented SLA, no backup/restore plan, no capacity or uptime monitoring, no tested DR. If a firm contract commits availability, these must exist. |

### Processing Integrity: partially supported, in scope if claimed

| Area | Have | Gap |
|---|---|---|
| Output correctness/traceability | Citation verification against the local store with a recorded verdict; provenance log of what was retrieved and the matter scope; tamper-detecting AEAD on the vector store (GCM tag) and SQLCipher integrity on email/audit stores. | No formal definition of processing-integrity commitments; AI outputs are inherently probabilistic and Keepance does not (and cannot) warrant model correctness: only that retrieval/citations are traceable and checkable. State this boundary explicitly to any auditor. |

### Privacy: in scope only if personal-information commitments are made

| Area | Have | Gap |
|---|---|---|
| Collection / use limitation | No usage telemetry without explicit opt-in (`telemetry.ts`); vendor collects only license key + machine id for normal operation. | No published privacy notice mapped to the AICPA Privacy criteria specifically (a marketing privacy policy exists but is not the same artifact). |
| Choice / consent | Telemetry is opt-in; BYOK means the user chooses the AI provider and its terms. | No documented consent-management and data-subject-request process beyond what the DPA sketches. |
| Disclosure to third parties | BYOK provider is the customer's own processor, not Keepance's; sub-processors are limited and listed. | Privacy-criteria-specific documentation and notice not yet produced. |

---

## Summary of gaps to reach audit-readiness

Technical controls are in reasonable shape because the architecture does a lot of the work. The gaps are predominantly **organizational and evidentiary**:

1. **A real service organization (legal entity)** named as the subject of the report. The current sole-proprietor status (see the EULA and the DPA open questions) should be resolved first.
2. **Written policies**: information security, access control, key management and rotation, change management, incident response, risk assessment, vendor management, data retention/disposal, and (if Privacy is in scope) a privacy notice mapped to the criteria.
3. **Scoping decision**: which system boundary and which TSC categories. A sensible first scope is **Security + Confidentiality** (and **Availability** only once a firm-tier service with an SLA exists).
4. **Evidence of operating effectiveness over time** (the heart of Type II). This requires the controls to run and be logged across the observation window before an auditor can test them.
5. **Monitoring and alerting** for the (small) service-side infrastructure: the license service, update hosting, and any future firm sync relay or inference proxy.
6. **Vendor/sub-processor agreements** on file (LemonSqueezy, GitHub, and any proxy host).
7. **An independent CPA firm engaged**, plus the budget and the **3 to 6 month observation period** for Type II.
8. **Honest scoping of residuals** the auditor will see anyway: plaintext workspace files by design, plaintext vector metadata for query, and the fact that cloud AI providers see prompts in BYOK mode (this is the customer's processor, not Keepance's, and should be documented as such).

---

## Recommended sequence (if pursuing SOC 2)

1. Form the legal entity and define the report scope (start with Security + Confidentiality).
2. Engage a SOC 2 readiness assessor (often cheaper and faster than going straight to a CPA examination) to confirm scope and pre-test design.
3. Write the policy set and stand up minimal monitoring for the license/update services.
4. Optionally obtain a **Type I** (design-only, point-in-time) report first to satisfy near-term buyers while the Type II clock runs.
5. Begin the **Type II observation window**, collect evidence, then have the independent CPA issue the report.

A useful interim move for skeptical firms, available now: point them to `docs/trust/security-overview.md` (with the source-file references), the DPA template, and (for the firm-tier inference path) the open design and intended independent audit in `spikes/firm-sync/DECISION.md`. "Here is the architecture and the code that backs each claim" is a credible bridge while a formal report is in progress, but it is **not a substitute** for the report itself, and it should never be described as one.

---

*This is a readiness/gap document, not a SOC 2 report. Keepance holds no SOC 2 certification as of this writing. Becoming SOC 2 Type II compliant requires an external CPA auditor and a multi-month observation period that the architecture alone does not satisfy.*
