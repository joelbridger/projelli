# Data Processing Addendum -- Template

> **DRAFT -- PENDING LEGAL REVIEW.**
> **Do not send this document to a customer, prospect, or counterparty until a lawyer licensed in the relevant jurisdiction has reviewed and approved it.**
>
> This template was prepared by an AI assistant as a starting point. It has not been reviewed by counsel. It is provided for internal planning purposes only. Key open questions requiring legal resolution are listed at the end of this document.

---

**DATA PROCESSING ADDENDUM**

This Data Processing Addendum ("DPA") is entered into between:

**Keepance** ("Processor"), a software product of [Entity legal name, jurisdiction], and

**[Customer legal name]** ("Controller"), located at [Customer address].

This DPA supplements and is incorporated into the End User License Agreement or other agreement between the parties ("Agreement") and applies where Processor processes Personal Data on behalf of Controller.

---

## 1. Definitions

For purposes of this DPA:

**"Personal Data"** means any information relating to an identified or identifiable natural person that is processed by Processor on behalf of Controller in connection with the Agreement.

**"Processing"** means any operation performed on Personal Data, whether automated or not, including collection, recording, organization, structuring, storage, adaptation, retrieval, consultation, use, disclosure, dissemination, restriction, erasure, or destruction.

**"Data Protection Laws"** means all applicable laws and regulations relating to the processing of Personal Data, including where applicable the EU General Data Protection Regulation (GDPR), the California Consumer Privacy Act (CCPA), and any other applicable national or state privacy laws.

**"Sub-processor"** means any third party engaged by Processor to process Personal Data on behalf of Controller.

---

## 2. Scope and roles

2.1 Controller determines the purposes and means of processing Personal Data. Processor processes Personal Data only on documented instructions from Controller.

2.2 **Architectural note.** Keepance is a local-first desktop application. Workspace documents, AI chat histories, imported email, and API keys are stored on Controller's own device and are not transmitted to or stored on Processor's servers. Processing of Personal Data by Processor's infrastructure is limited to: (a) license key validation (license key only, no workspace content); and (b) update-check requests (no user data). The parties acknowledge that the primary data processing relevant to Controller's use of Keepance occurs on Controller's own device, not on Processor's systems.

---

## 3. Processor obligations

3.1 **Instructions.** Processor shall process Personal Data only on Controller's documented instructions, unless required to do so by applicable law.

3.2 **Confidentiality.** Processor shall ensure that persons authorized to process Personal Data are subject to appropriate confidentiality obligations.

3.3 **Security.** Processor shall implement appropriate technical and organizational measures to protect Personal Data against unauthorized or unlawful processing and against accidental loss, destruction, or damage. Given the local-first architecture described in Section 2.2, the primary technical measures applicable to Processor's server infrastructure are limited to the license validation and update-check systems noted there.

3.4 **Sub-processors.** Processor shall not engage any sub-processor to process Personal Data on Controller's behalf without prior written authorization from Controller, except as set forth in Schedule A (Sub-processor List). Processor shall impose data protection obligations on any authorized sub-processor no less protective than those in this DPA.

3.5 **Data subject rights.** Processor shall assist Controller in responding to data subject requests to the extent technically feasible given Processor's limited role in data processing (see Section 2.2). Because workspace data is stored on Controller's device, most data subject requests will be fulfilled directly by Controller without Processor involvement.

3.6 **Breach notification.** Processor shall notify Controller without undue delay (and no later than 72 hours after becoming aware) of any confirmed breach of Processor's infrastructure involving Personal Data. Given the architecture described in Section 2.2, a breach of Processor's servers would not expose workspace content, AI chat histories, or API keys.

3.7 **Deletion or return.** Upon termination of the Agreement, Processor shall, at Controller's election, delete or return all Personal Data within Processor's control. Given the architecture in Section 2.2, Processor holds no workspace content to delete or return; any deletion obligation applies only to license account records held by Processor's payment processor (LemonSqueezy).

3.8 **Audits.** Processor shall make available to Controller such information as is reasonably necessary to demonstrate compliance with this DPA, and shall allow for and contribute to audits conducted by Controller or an auditor mandated by Controller, subject to reasonable notice and confidentiality obligations. Processor's source code is available at [github.com/keepance/keepance] as a supplement to audit rights.

---

## 4. Controller obligations

4.1 Controller represents that it has the legal basis required under applicable Data Protection Laws to disclose Personal Data to Processor for the purposes described in this DPA.

4.2 Controller is responsible for ensuring that its instructions to Processor comply with applicable Data Protection Laws.

4.3 Controller acknowledges that workspace data is stored and processed on Controller's own device under Controller's sole control and that Controller is responsible for the security of that data (including disk encryption, access controls, and backup).

---

## 5. International transfers

5.1 To the extent Processor transfers Personal Data outside of the European Economic Area or the United Kingdom, Processor shall ensure that such transfers are made in compliance with applicable Data Protection Laws, including by implementing appropriate transfer mechanisms (such as Standard Contractual Clauses) where required.

5.2 Given the architecture described in Section 2.2, international transfer obligations are limited to Processor's license validation system and apply only to license account data, not to workspace content.

---

## 6. Term and termination

6.1 This DPA is effective as of the date of the Agreement and continues until termination of the Agreement.

6.2 The provisions of this DPA that by their nature should survive termination (including breach notification and deletion obligations) shall survive.

---

## 7. Liability

The liability of each party under this DPA shall be subject to the limitations set forth in the Agreement.

---

## Schedule A: Current Sub-processors

| Sub-processor | Purpose | Location |
|---|---|---|
| LemonSqueezy | License key management and payment processing | United States |
| GitHub (Microsoft) | Update manifest hosting (read-only public repo) | United States |

---

## Schedule B: Description of processing

| Field | Description |
|---|---|
| Subject matter | Software license validation and update delivery |
| Duration | Term of the Agreement |
| Nature of processing | License key validation; version manifest requests |
| Purpose of processing | To verify software licenses and deliver software updates |
| Type of Personal Data | License key; no workspace content |
| Categories of data subjects | Licensed users of the Keepance desktop application |

---

## Open questions for legal review

The following questions must be resolved by a lawyer before this DPA is used with any customer:

1. **Entity name and jurisdiction.** What is the correct legal entity name, jurisdiction of formation, and registered address for Processor? This DPA cannot be executed without a real legal entity.

2. **GDPR applicability.** Does Keepance process Personal Data of EU/UK data subjects in a way that brings it within GDPR scope, given the local-first architecture? The answer affects whether standard GDPR DPA language is appropriate or whether a lighter disclosure is sufficient.

3. **CCPA applicability.** Does Keepance meet the CCPA thresholds? (Annual gross revenue, number of consumers, data sold to third parties.) If not, CCPA-specific language may not be needed.

4. **"Controller" vs "processor" classification.** Given that workspace data lives on the customer's device and Keepance's servers hold only license data, is Keepance best characterized as a Processor, a Controller (for license data), or something else? This classification affects the whole DPA structure.

5. **Sub-processor approval mechanism.** Should the DPA require individual written approval for each new sub-processor, or blanket approval for a listed category? The current draft says written authorization but leaves flexibility.

6. **Audit rights scope.** Is the open-source code reference a sufficient substitute for audit rights, or do enterprise customers need a more formal process?

7. **Applicable law and venue.** What governing law and jurisdiction should apply? (Depends on entity incorporation.)

8. **Standard Contractual Clauses.** If EU/UK customers require SCCs, the correct module (Controller-to-Processor or Controller-to-Controller) must be attached. This depends on the classification question in item 4.

9. **HIPAA.** The DPA as drafted explicitly excludes HIPAA BAA. Confirm this is the right call and that healthcare customers are screened out at sales.

10. **Pricing or license terms reference.** Should this DPA cross-reference the specific license tier (Personal / Professional / Practice) or apply uniformly?
