// @draft — Tax Practice Pack v2.2
// Requires CPA/EA advisor review before shipping. Do not expose to users without review.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'firmName',
    question: 'Firm name',
    description: 'Legal name of the tax preparation firm.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Meridian Tax Services LLC',
  },
  {
    id: 'numberOfStaff',
    question: 'Number of staff',
    description: 'Total number of people with access to client data, including the owner, employees, contractors, and seasonal staff.',
    type: 'text',
    required: true,
    placeholder: 'e.g., 4 (1 owner/preparer, 2 full-time staff, 1 seasonal)',
  },
  {
    id: 'systemTypes',
    question: 'Systems used to process client data',
    description: 'Describe the systems used to access, store, or transmit client tax information. Include tax software, cloud storage, email, remote access, and devices.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Drake Tax (desktop install, server-based); Google Workspace (Gmail + Drive) for email and document sharing; Windows 10 and 11 workstations; personal laptops for remote work; client portal: Canopy; no on-premises server',
  },
  {
    id: 'dataTypesHandled',
    question: 'Types of client data handled',
    description: 'List the categories of sensitive taxpayer information the firm processes.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., SSNs and TINs; W-2s and 1099s; bank account numbers; IRS transcripts; Social Security income records; state ID / passport copies; business financial statements',
  },
  {
    id: 'physicalSecurityMeasures',
    question: 'Physical security measures currently in place',
    description: 'Describe how physical access to the office, devices, and paper files is controlled.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Office is in a locked suite; paper files in locking cabinets; shredder on premises; no client access to back office; no server room',
  },
  {
    id: 'existingPolicies',
    question: 'Existing security policies or practices (optional)',
    description: 'Describe any existing security practices, training, or policies already in place that the WISP should document.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Staff required to use strong passwords; MFA enabled on email and portal; staff signs confidentiality agreement at hire; no existing written security policy',
  },
  {
    id: 'priorIncidents',
    question: 'Any prior security incidents or data breaches? (optional)',
    description: 'If the firm has experienced a prior breach, unauthorized access, or security incident, note it here. The WISP should reflect lessons learned.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., No prior incidents — or — 2023: phishing email opened by staff; no data confirmed exposed; email credentials reset',
  },
  {
    id: 'designatedPOID',
    question: 'Designated person responsible for data security (POID)',
    description: 'IRS Pub 5708 requires every firm to designate a "person of interest for data security" (POID) responsible for maintaining the WISP. Name and title.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Patricia Weems, Owner / Managing Partner',
  },
];

const wispBuilderPrompt = `You are assisting a licensed tax preparer in drafting a Written Information Security Plan (WISP) outline following IRS Publication 5708's template for tax preparers. This document is a customizable starting outline — the practitioner must adapt every section to reflect their firm's actual systems, personnel, and safeguards before finalizing. You are producing a framework, not a completed compliance document.

Firm name: {{firmName}}
Number of staff: {{numberOfStaff}}
Systems used: {{systemTypes}}
Data types handled: {{dataTypesHandled}}
Physical security measures: {{physicalSecurityMeasures}}
Existing policies: {{existingPolicies}}
Prior incidents: {{priorIncidents}}
Designated POID: {{designatedPOID}}

Produce a WISP outline in Markdown following the structure in IRS Publication 5708. Begin with the draft notice.

> **Draft document — Starting outline only.** This template requires firm-specific customization. Every section includes placeholders for information only your firm knows. Have a qualified IT or compliance professional review your completed WISP before finalizing. A WISP that does not reflect your actual systems and practices provides no meaningful protection and may not satisfy the FTC Safeguards Rule or IRS expectations.

---

# Written Information Security Plan (WISP)
**Firm:** {{firmName}}
**Effective Date:** [Date — complete when finalizing]
**Version:** 1.0 — Draft
**Designated Person of Interest for Data Security (POID):** {{designatedPOID}}

---

> ### About This Document
>
> The IRS requires all professional tax preparers to maintain a Written Information Security Plan under the Gramm-Leach-Bliley Act (GLB) and the FTC Safeguards Rule (16 CFR Part 314). IRS Publication 5708 provides a template specifically for small tax preparation firms. Failure to maintain a WISP exposes the firm to FTC enforcement, state AG action, and reputational harm in the event of a breach.
>
> This outline was generated using firm information you provided. It follows the Pub 5708 section structure. Every section marked [FIRM-SPECIFIC] requires you to replace the placeholder text with your firm's actual practices, system names, and procedures. A WISP with inaccurate or generic text is not materially better than no WISP.
>
> **Annual review required:** The WISP must be reviewed and updated at least annually and whenever a significant operational change occurs (new software, new staff, office move, new service provider).

---

## Section 1 — Designation of Person of Interest for Data Security (POID)

**POID:** {{designatedPOID}}

**Responsibilities of the POID:**
- Maintain, update, and enforce this WISP
- Serve as the primary contact for any data security incident
- Conduct or coordinate annual WISP review
- Ensure all staff complete required security awareness training
- Evaluate new service providers and vendors for security compliance
- Report any security incident to the appropriate authorities (IRS, FTC, state AG) as required

**Backup POID (if applicable):** [Name and title — designate a backup who can act if the primary POID is unavailable during an incident]

---

## Section 2 — Inventory of Sensitive Client Data

The firm handles the following categories of sensitive taxpayer information (Personally Identifiable Information / Federal Tax Information):

{{dataTypesHandled}}

**Data lifecycle:**
- **Collection:** [Describe how data is received — e.g., client portal upload, email, in-person delivery, fax]
- **Storage:** [Describe where data is stored — e.g., tax software server, cloud drive, locked paper files]
- **Transmission:** [Describe how data is transmitted — e.g., encrypted portal, secure email, no unencrypted email attachments]
- **Retention:** [Describe how long data is kept and the retention schedule — e.g., 7 years per IRS guidance]
- **Disposal:** [Describe how data is destroyed — e.g., cross-cut shredding for paper; secure deletion / drive wipe for digital]

[FIRM-SPECIFIC: Review this section carefully. List every location — physical and digital — where client data resides. Incomplete inventories are a leading cause of undetected breaches.]

---

## Section 3 — Risk Assessment

The firm has identified the following foreseeable risks to client data security:

### Technical Risks

- [ ] Unauthorized access to tax software due to weak or shared passwords
- [ ] Phishing emails targeting staff credentials
- [ ] Malware or ransomware on workstations
- [ ] Unencrypted data transmitted via email
- [ ] Unpatched software with known vulnerabilities
- [ ] Remote access tools with inadequate authentication
- [ ] Cloud storage misconfiguration exposing client files

### Physical Risks

- [ ] Unauthorized physical access to office or filing areas
- [ ] Paper files left unattended in common areas
- [ ] Unshredded documents in regular trash
- [ ] Lost or stolen laptops or portable drives
- [ ] Visitor access to areas with visible client data

### Administrative Risks

- [ ] Former employee retaining system access after separation
- [ ] Staff not trained on phishing or social engineering
- [ ] Vendor or contractor with overly broad data access
- [ ] No documented incident response procedure

**Current systems:** {{systemTypes}}

[FIRM-SPECIFIC: Check every applicable risk above. Add firm-specific risks not listed. For each checked risk, the safeguards in Section 4 must address mitigation or acceptance. Document your rationale for any accepted (unmitigated) risk.]

---

## Section 4 — Safeguards

### 4A — Technical Safeguards

- **Passwords and authentication:** [FIRM-SPECIFIC: Describe password policy — minimum length, complexity, rotation, no sharing. Note which systems have MFA enabled and which do not.]
  - Current status: [e.g., MFA enabled on email ({{systemTypes}}); tax software password policy: TBD]
  - Action item if gaps exist: [e.g., Enable MFA on Drake portal by [date]]

- **Encryption:** [FIRM-SPECIFIC: Describe encryption in transit and at rest for all systems listed in Section 2.]
  - Client portal encryption: [e.g., TLS in transit via Canopy portal]
  - Workstation encryption: [e.g., BitLocker enabled on all Windows workstations — or — not yet enabled (action item)]
  - Email: [e.g., Encrypted attachment policy for sensitive documents]

- **Software patching and updates:** [FIRM-SPECIFIC: Describe how operating systems, tax software, and browsers are kept current.]
  - Policy: [e.g., Windows Update set to automatic; tax software updated at start of each season]

- **Antivirus and endpoint protection:** [FIRM-SPECIFIC: Name the product and update frequency.]
  - Current: [e.g., Windows Defender on all workstations; updated automatically]

- **Remote access:** [FIRM-SPECIFIC: Describe how staff access firm systems remotely and what controls are in place.]
  - Current: [e.g., Staff use personal laptops via RDP to firm server; RDP requires MFA; — or — no remote access permitted]

- **Backups:** [FIRM-SPECIFIC: Describe backup schedule, storage location, and recovery testing.]
  - Current: [e.g., Drake software database backed up nightly to external drive; drive stored off-site weekly; last restore test: TBD]

### 4B — Physical Safeguards

- **Office access control:** {{physicalSecurityMeasures}}
  - [FIRM-SPECIFIC: Add any specifics not listed above — key card, alarm, visitor log, etc.]

- **Clean desk policy:** [FIRM-SPECIFIC: Describe requirements for securing paper files and locking screens when away from workstations.]

- **Device security:** [FIRM-SPECIFIC: Describe policies for laptops, phones, and portable drives — full-disk encryption, cable locks, no sensitive data on personal devices, etc.]

- **Shredding and disposal:** [FIRM-SPECIFIC: Describe shredding policy for paper and secure wiping for digital media.]

### 4C — Administrative Safeguards

- **Staff training:** [FIRM-SPECIFIC: Describe annual security awareness training. IRS recommends the free resources at IRS.gov/securitysummit.]
  - Schedule: [e.g., Annual training each October before filing season; new staff trained within 30 days of hire]
  - Topics: phishing recognition, password hygiene, physical security, incident reporting

- **Access controls and least privilege:** [FIRM-SPECIFIC: Describe how system access is granted on a need-to-know basis and revoked upon departure.]
  - Onboarding: [e.g., Access granted by POID; documented in access log]
  - Offboarding: [e.g., Accounts disabled same day as separation]

- **Confidentiality agreements:** [FIRM-SPECIFIC: Note whether staff sign confidentiality agreements at hire and where signed copies are kept.]

- **Acceptable use policy:** [FIRM-SPECIFIC: Describe rules for using firm systems — no personal use for sensitive systems, no storing client data on personal devices, etc.]

---

## Section 5 — Vendor and Service Provider Oversight

The following vendors and service providers have access to, or process, client data:

| Vendor | Service | Data Accessed | Security Agreement on File? |
|--------|---------|---------------|-----------------------------|
| [Tax software vendor] | Tax preparation | Client tax data | [Yes / No / TBD] |
| [Cloud storage provider] | File storage and sharing | Client documents | [Yes / No / TBD] |
| [Client portal provider] | Secure document exchange | Client data | [Yes / No / TBD] |
| [IT support vendor] | Technical support | System access | [Yes / No / TBD] |
| [Other] | [Describe] | [Describe] | [Yes / No / TBD] |

[FIRM-SPECIFIC: Complete the table for every vendor. The FTC Safeguards Rule requires written agreements with service providers who access covered data. Review each vendor's privacy policy and data processing agreement. Do not use vendors who cannot provide documentation of their security practices.]

---

## Section 6 — Incident Response Plan

### What Constitutes a Security Incident

A security incident includes: unauthorized access to client data (physical or digital); lost or stolen device containing client data; ransomware or malware infection; phishing email where credentials may have been compromised; unauthorized disclosure of client information to a third party.

### Immediate Response Steps

1. **Contain:** Isolate the affected system, device, or account immediately. Disconnect from network if malware is suspected. Do not delete logs.
2. **Assess:** Determine what data was accessed or exposed, for how long, and by whom.
3. **Notify POID:** {{designatedPOID}} is the incident lead. If POID is unavailable, [backup POID — complete above].
4. **Document:** Begin an incident log immediately. Record the date/time of discovery, nature of incident, systems involved, data potentially affected, and response steps taken.
5. **Notify:** Determine notification obligations (see below) and act within required timeframes.

### Notification Obligations

[FIRM-SPECIFIC: Notification requirements depend on state law, the nature of the data, and the number of affected individuals. Consult with a legal or compliance advisor to determine specific obligations for your state.]

- **IRS:** Report data theft or breach via the IRS Stakeholder Liaison (number on IRS.gov/securitysummit — verify current contact). The IRS Identity Theft Tax Refund Fraud may also require notification.
- **FTC:** Report breaches affecting 500 or more customers at ftc.gov/databreachreport (verify current requirement thresholds).
- **State AG / state law:** Most states have breach notification laws. [FIRM-SPECIFIC: Identify your state's notification requirements, timelines, and covered data definitions — {{dataTypesHandled}}.]
- **Affected clients:** Notify affected clients promptly. Provide guidance on steps they can take to protect themselves (credit freeze, IRS Identity Protection PIN, etc.).

### Post-Incident Review

After any incident, the POID will conduct a root-cause review and update this WISP to prevent recurrence. Review within 30 days of incident closure.

---

## Section 7 — Employee Training

**Training schedule:** Annual, before the start of each filing season. New staff within 30 days of hire.

**Training topics:**
- [ ] Recognizing phishing and spear-phishing emails
- [ ] Password hygiene and multi-factor authentication
- [ ] Physical security — clean desk, visitor protocols, shredding
- [ ] Acceptable use of firm systems and devices
- [ ] Incident reporting procedures — who to contact and how fast
- [ ] Client confidentiality and IRC §7216 restrictions on disclosure

**Training resources:**
- IRS Security Summit materials (free): IRS.gov/securitysummit
- FTC Small Business resources: ftc.gov/business-guidance/small-businesses/cybersecurity
- NIST Small Business Cybersecurity resources: nist.gov/cybersecurity

**Training log:** [FIRM-SPECIFIC: Maintain a log of completed training by staff member and date. Store in firm records.]

---

## Section 8 — Annual Review Schedule

This WISP must be reviewed and updated at least annually and whenever a significant change occurs.

**Scheduled annual review date:** [e.g., Each October, before filing season begins]

**Triggers for interim review:**
- Addition of new software or systems that handle client data
- New staff with data access
- Departure of staff with data access (access audit)
- New service provider or change in service provider
- Security incident (post-incident review, see Section 6)
- Material change in firm operations (office move, remote work expansion, merger)
- New IRS or FTC guidance on WISP requirements

**Review checklist:**
- [ ] Sections 1-3: Are the data inventory, systems list, and risk assessment still current?
- [ ] Section 4: Are all safeguards still in place and operating?
- [ ] Section 5: Are vendor agreements current? Any new vendors?
- [ ] Section 6: Was the incident response plan tested or updated after any incidents?
- [ ] Section 7: Did all staff complete training this year?
- [ ] Section 8: Is the review date set for next year?

**POID sign-off:** By signing below, the POID confirms that this WISP has been reviewed, is accurate as of the date below, and reflects the firm's actual security practices.

POID Signature: _________________________ Date: _____________

---

*This WISP outline was produced using IRS Publication 5708 as a structural guide. It is a starting point — not a completed compliance document. Every firm's WISP must reflect its specific systems, personnel, and safeguards. The FTC Safeguards Rule (16 CFR Part 314) and applicable state laws impose specific requirements that may not be fully captured in this outline. Have a qualified IT security or compliance professional review your completed WISP before finalizing.*`;

export const WISPBuilder: WorkflowTemplate = {
  id: 'wisp-builder',
  name: 'WISP Builder (IRS Pub 5708)',
  description: 'Structures a Written Information Security Plan following IRS Publication 5708\'s template for tax preparers. Produces a customized WISP outline you adapt for your firm and review with a compliance consultant.',
  version: '1.0.0',
  category: 'tax',
  requiresVerification: true,
  verificationNote: 'A WISP must reflect your firm\'s actual systems, personnel, and safeguards. This template produces a starting outline — have a qualified IT or compliance professional review your completed WISP before finalizing.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Firm Security Profile',
      description: 'Provide firm details, systems, data types, and existing security measures',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-wisp',
      type: 'generate',
      name: 'Generate WISP Outline',
      description: 'Draft the full WISP outline following IRS Publication 5708\'s structure',
      config: {
        outputFile: 'WISP_DRAFT.md',
        promptTemplate: wispBuilderPrompt,
        systemPrompt: 'You are a tax practice assistant helping a small tax preparation firm draft a Written Information Security Plan (WISP) following IRS Publication 5708. You understand the Gramm-Leach-Bliley Act Safeguards Rule requirements for tax preparers and the IRS Security Summit recommendations.\n\nCRITICAL HONESTY REQUIREMENT: You are producing a starting outline, not a completed or legally sufficient WISP. Every section must include explicit placeholders for firm-specific information. Do not produce generic boilerplate that appears complete but lacks actual firm-specific content — a WISP that does not reflect the firm\'s real systems and practices provides no real protection. Always include the prominent disclaimer that a qualified IT or compliance professional must review the completed document before finalizing. Every regulatory citation (FTC Safeguards Rule, state breach notification laws, IRS Publication 5708) must be flagged for verification against current requirements, as these change.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['WISP_DRAFT.md'],
  namedOutputs: [
    { id: 'poid_designation', name: 'POID designation', schema: 'string' },
    { id: 'data_inventory', name: 'Sensitive data inventory', schema: 'string' },
    { id: 'risk_assessment', name: 'Risk assessment', schema: 'string' },
    { id: 'safeguards', name: 'Technical, physical, and administrative safeguards', schema: 'string' },
    { id: 'incident_response', name: 'Incident response plan', schema: 'string' },
    { id: 'training_schedule', name: 'Employee training schedule', schema: 'string' },
    { id: 'annual_review', name: 'Annual review schedule', schema: 'string' },
  ],
};

export default WISPBuilder;
