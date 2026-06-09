# Data Processing Agreement: Template (Keepance for firms)

> **TEMPLATE, requires review by qualified counsel before use.**
>
> This document is a drafting starting point prepared by a non-lawyer. It is **not legal advice** and creates no obligations until a lawyer licensed in the relevant jurisdiction has reviewed, completed, and approved it. Do not send it to a customer, prospect, or counterparty in this state. Bracketed `[...]` fields and the open questions in the final section must be resolved by counsel first.

---

**DATA PROCESSING AGREEMENT**

This Data Processing Agreement ("DPA") is entered into between:

**Keepance** ("Vendor"), a software product operated by [entity legal name, form, and jurisdiction of formation], with registered address at [address]; and

**[Customer legal name]** ("Firm"), a [law firm / professional services entity] located at [address].

This DPA supplements and is incorporated into the End User License Agreement, order form, or other agreement between the parties (the "Agreement") and governs the processing of Personal Data in connection with the Firm's use of Keepance.

---

## 1. Definitions

**"Personal Data"** means any information relating to an identified or identifiable natural person that is processed in connection with the Agreement.

**"Client Data"** means the documents, email, notes, chat content, embeddings, and other material the Firm and its users create, import, or store in Keepance, which may contain Personal Data and material subject to legal professional privilege, the work-product doctrine, or professional confidentiality duties.

**"Processing"** means any operation performed on Personal Data, automated or not, including collection, recording, storage, retrieval, use, disclosure, transmission, erasure, or destruction.

**"Data Protection Laws"** means all laws applicable to the processing of Personal Data under the Agreement, including where applicable the EU General Data Protection Regulation (GDPR), the UK GDPR, and the California Consumer Privacy Act as amended (CCPA/CPRA).

**"Controller", "Processor", "Sub-processor", and "Data Subject"** have the meanings given under applicable Data Protection Laws.

**"AI Provider"** means a third-party large language model service (for example Anthropic, OpenAI, or Google) that the Firm chooses to send prompts to.

**"BYOK"** ("bring your own key") means the mode in which the Firm supplies its own AI Provider API credentials and Keepance sends the Firm's prompts directly from the user's device to that AI Provider.

**"Assured Inference Proxy"** means the optional Keepance-operated forwarding service described in Section 6 and Schedule C, available in the Firm tier, which is designed to be architecturally incapable of persisting request or response bodies.

**"Local Model"** means an AI model the Firm runs on its own hardware (for example via Ollama), where no prompt content leaves the device.

---

## 2. Roles of the parties

2.1 **The Firm is the Controller** of Client Data and Personal Data processed through Keepance. The Firm determines the purposes and means of that processing.

2.2 **Keepance's role depends on the operating mode**, and the parties acknowledge the following allocation:

| Mode | What Keepance (Vendor) processes on its servers | Vendor's role |
|---|---|---|
| **Local / BYOK direct** (default) | License key and machine identifier only. Vendor does not receive Client Data, prompts, responses, or AI Provider keys. | Processor for license data only; not a processor of Client Data. |
| **Local Model (Ollama)** | License key and machine identifier only. No prompt content leaves the device at all. | Processor for license data only. |
| **Assured Inference Proxy** (optional, Firm tier) | Prompt and response bodies pass through Vendor infrastructure in transient memory only, under the zero-retention design in Schedule C. License/seat data is also processed. | Processor of the prompt/response content for the duration of forwarding, plus Processor for license/seat data. |

2.3 **The AI Provider is the Firm's own Processor in BYOK mode.** When the Firm uses BYOK, prompts go directly from the user's device to the AI Provider under the Firm's own account and the AI Provider's terms. The AI Provider is engaged by, and is a sub-processor of, the Firm, not of Keepance. Keepance is not a party to that relationship and does not receive the prompt, the response, or the Firm's AI Provider credentials. The Firm is responsible for its own data processing terms with the AI Provider (for example a zero-data-retention / no-training arrangement on the Firm's provider account).

2.4 **Architectural basis for this allocation.** Keepance is a local-first desktop application. Client Data (workspace documents, AI chat histories, imported email, the search/retrieval (vector) store, the audit log, and AI Provider keys) is created and stored on the Firm's own devices and is not transmitted to or stored on Vendor servers, except where the Firm elects to use the Assured Inference Proxy for inference forwarding only. The technical measures in Section 5 and the data-flow and retention maps in the accompanying security overview (`docs/trust/security-overview.md`) describe this in detail.

---

## 3. Vendor obligations as Processor

3.1 **Processing on instructions.** Vendor processes Personal Data only on the Firm's documented instructions (including those given through the configuration and use of the software), unless required otherwise by applicable law, in which case Vendor will inform the Firm unless legally prohibited.

3.2 **Confidentiality of personnel.** Vendor ensures that personnel authorized to process Personal Data are bound by appropriate confidentiality obligations.

3.3 **Security.** Vendor maintains technical and organizational measures appropriate to its actual processing role, as described in Section 5. The parties acknowledge that because Client Data is held on the Firm's devices in the default modes, the measures most relevant to Vendor's own infrastructure are those protecting the license service and, where used, the Assured Inference Proxy.

3.4 **Sub-processors.** Vendor's current sub-processors are listed in Schedule A. Vendor will not engage a new sub-processor to process Personal Data on the Firm's behalf without giving the Firm prior notice and an opportunity to object, and will impose data protection terms on each sub-processor no less protective than those in this DPA. The AI Provider in BYOK mode is **not** a Vendor sub-processor (see Section 2.3).

3.5 **Assistance with data-subject rights.** Vendor will assist the Firm in responding to Data Subject requests to the extent technically feasible given Vendor's limited role. Because Client Data is stored on the Firm's devices, most requests (access, rectification, erasure, portability) are fulfilled directly by the Firm within the application; Vendor's assistance is limited to license-account records and, where applicable, Assured Inference Proxy metadata.

3.6 **Breach notification.** Vendor will notify the Firm without undue delay, and no later than 72 hours after becoming aware, of any confirmed Personal Data breach affecting Vendor's infrastructure. The parties acknowledge that a breach of Vendor's license service would expose license keys and machine identifiers, not Client Data; and that the Assured Inference Proxy is designed so that a compromise of it cannot yield persisted prompt or response bodies (Schedule C). Breaches of Client Data held on the Firm's own devices are the Firm's responsibility to assess and report.

3.7 **Deletion or return.** On termination of the Agreement, Vendor will delete or return Personal Data within Vendor's control at the Firm's election. The parties acknowledge that Vendor holds no Client Data to delete or return in the default modes; deletion obligations apply to license/seat account records (held with the payment processor, Schedule A) and to any Assured Inference Proxy billing metadata. Client Data on the Firm's devices remains under the Firm's sole control and is deleted by the Firm.

3.8 **Audit rights.** Vendor will make available information reasonably necessary to demonstrate compliance with this DPA and will allow for audits by the Firm or an auditor it mandates, on reasonable notice and subject to confidentiality. As supplementary assurance, Vendor will make available the security overview and SOC 2 readiness materials in `docs/trust/`, and the source of any Assured Inference Proxy data path, so that the no-retention design (Schedule C) can be inspected rather than merely asserted.

---

## 4. Firm obligations as Controller

4.1 The Firm warrants that it has the legal basis required under Data Protection Laws to process Personal Data through Keepance and to engage its chosen AI Provider in BYOK mode.

4.2 The Firm is responsible for ensuring its instructions to Vendor comply with Data Protection Laws.

4.3 The Firm acknowledges that Client Data is stored and processed on the Firm's own devices under the Firm's sole control, and that the Firm is responsible for device-level security (including full-disk encryption, operating-system access controls, device management, and backups) as the primary protection for Client Data. Keepance's at-rest encryption of certain stores (Section 5) supplements but does not replace these device-level measures.

4.4 In BYOK mode, the Firm is responsible for the terms governing its AI Provider account, including any data-retention, training, and regional-processing settings offered by that AI Provider.

4.5 The Firm is responsible for configuring matter membership, privilege tagging, ethical-wall screening, and Privileged Matter Mode (Section 5.6) consistent with its professional-responsibility obligations.

---

## 5. Technical and organizational measures

The following measures reflect the product as built. They are described precisely so the Firm can verify them and so this DPA does not overstate them. Residual exposures are stated honestly in Section 5.8 and in the security overview.

5.1 **Local-first storage.** Client Data lives in a folder the Firm chooses on the Firm's device. In the default modes nothing in that folder is transmitted to Vendor.

5.2 **API key storage.** AI Provider keys are stored in the operating-system keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux) and are never written to Vendor servers.

5.3 **Encryption in transit.** AI Provider calls and the single license call use TLS provided by the respective endpoint.

5.4 **Encryption at rest (selected stores).** Several stores are encrypted at rest on the Firm's device:
- **Imported email** is stored in a SQLCipher database (`<workspace>/.keepance/`), with the key in the OS keychain (`keepance-mail-enc`).
- **The audit log** is stored in a separate SQLCipher database (`<workspace>/.keepance/audit-enc.db`), with its own independent key (`keepance-audit-enc`).
- **Retrieval (vector) store chunk text** is encrypted with AES-256-GCM (12-byte random nonce, 16-byte authentication tag) under a third independent key (`keepance-vectors-enc`).
- The three keys are cryptographically independent; compromise or rotation of one does not affect the others.

5.5 **Matter isolation and privilege exclusion.** Retrieval is scoped to a single client matter using a database prefilter applied before the search runs; cross-matter retrieval is possible only through an explicit, audited all-matters path. Material tagged attorney-client privileged or work-product is excluded from retrieval by default and surfaces only on an explicit, deliberate opt-in.

5.6 **Privileged Matter Mode.** When a matter is designated privileged, network-capable extensions (external MCP servers and similar integrations) are blocked from writing to the workspace, and each blocked attempt is recorded in the audit log.

5.7 **Append-only audit log with provenance.** The audit log records AI actions and provenance events, what was retrieved, which matter it was confined to, whether privileged material was excluded, citation-verification verdicts, and where each request was sent (including whether any data left the device). It is append-only and stored on the Firm's device for the Firm's own defense and oversight, not transmitted to Vendor.

5.8 **No telemetry without consent.** Keepance sends no usage telemetry unless the Firm or user explicitly opts in. There is no default analytics call.

5.9 **Change management.** Source changes are version-controlled and built through continuous integration; releases are code-signed (Azure Trusted Signing on Windows, Apple Developer ID on macOS).

5.10 **Honest residual exposures.** The parties acknowledge:
- In **BYOK cloud mode**, the AI Provider receives the prompt content the user sends (this is inherent to using a cloud model and is governed by the Firm's own provider terms; Keepance is not in that path). The **Local Model** mode avoids this entirely.
- In the vector store, the **chunk text is encrypted, but `matter_id` and privilege labels are stored in plaintext** on the device because they must be queryable to enforce isolation; these labels can reveal the existence and names of matters to someone with raw access to the device file.
- Certain metadata in the encrypted stores may be unencrypted for indexing.
- These exposures are documented in `docs/trust/security-overview.md` and are the reason device-level full-disk encryption (Section 4.3) is required.

---

## 6. Optional Assured Inference Proxy (Firm tier)

6.1 The Firm tier may include the option to route inference through the Assured Inference Proxy instead of (or alongside) BYOK direct. The proxy is operated by Vendor and is described in Schedule C.

6.2 The proxy is designed to forward prompts and responses statelessly, holding bodies only in transient memory for the duration of the stream, and to be architecturally incapable of writing request or response bodies to disk, a database, a log, or a trace. Logging is metadata-only (Schedule C).

6.3 When the proxy is used, Vendor processes prompt and response content as a Processor for the limited purpose of forwarding it to the AI Provider, on the Firm's instructions, under the zero-retention terms in Schedule C. Vendor will not use Firm prompt or response content to train models.

6.4 If the Firm requires that **no** prompt content be exposed to any Vendor infrastructure at all, the appropriate configuration is BYOK direct or a Local Model, and the parties acknowledge this.

> **Status note for counsel:** the Assured Inference Proxy is a designed-and-de-risked architecture (see `spikes/firm-sync/DECISION.md`), not a generally available production service as of this draft. Do not represent it as live until it ships, and align the contractual no-retention warranty with what the deployed service and its independent audit actually support.

---

## 7. International transfers

7.1 To the extent Vendor transfers Personal Data outside the EEA or the UK, Vendor will rely on an appropriate transfer mechanism (such as the Standard Contractual Clauses) where required.

7.2 Given the architecture in Section 2, Vendor's own transfers are limited to license/seat data and, where the Assured Inference Proxy is used, the transient forwarding of prompts to the AI Provider region the Firm selects. In BYOK mode, the location where prompts are processed is determined by the Firm's AI Provider settings, not by Vendor.

---

## 8. Term, survival, liability

8.1 This DPA is effective on the date of the Agreement and continues until the Agreement terminates.

8.2 Provisions that by their nature should survive termination (including breach notification, deletion, and confidentiality) survive.

8.3 Each party's liability under this DPA is subject to the limitations in the Agreement.

---

## Schedule A: Sub-processors

| Sub-processor | Purpose | Location |
|---|---|---|
| LemonSqueezy | License/seat management and payment processing (merchant of record) | United States |
| GitHub (Microsoft) | Update manifest hosting (read-only public repository) | United States |
| [Assured Inference Proxy host, e.g. cloud provider] | Stateless inference forwarding, Firm tier only, if elected | [region selected by Firm] |

The AI Provider used in BYOK mode is the Firm's own sub-processor and is not listed here (Section 2.3).

---

## Schedule B: Description of processing

| Field | Default modes (Local / BYOK / Local Model) | Assured Inference Proxy (optional) |
|---|---|---|
| Subject matter | Software license validation and update delivery | Forwarding of AI prompts to the chosen AI Provider |
| Duration | Term of the Agreement | Duration of each forwarded request (transient) plus billing-metadata retention |
| Nature of processing | License/seat validation; version manifest requests | Stateless request/response forwarding |
| Purpose | Verify licenses; deliver updates | Provide single-vendor inference without each user holding provider keys |
| Personal Data types | License key; machine identifier | Whatever the user includes in a prompt (controlled by the Firm) plus billing metadata |
| Categories of data subjects | Licensed users of Keepance | The Firm's clients, contacts, and personnel referenced in prompts; Firm users |

---

## Schedule C: Assured Inference Proxy: zero-retention design summary

(See `spikes/firm-sync/DECISION.md` §5 and `docs/trust/security-overview.md` for the authoritative detail. Summarized here for the contract record.)

- **Stateless forwarding only.** The proxy authenticates a Firm seat, attaches the Firm's provider credential (held in a secret manager, never logged), streams the request to the AI Provider, and streams the response back. The body is held only in transient memory for the duration of the stream.
- **No body write path.** No request body, response body, prompt, or completion is written to disk, a database, a log line, a trace, or a queue. The intent is that this is a type-level invariant verified by a published test, not a policy promise.
- **Metadata-only logs.** Logs may contain `request_id`, `org_id`, `seat_id`, `provider`, `model`, token counts, latency, status, and timestamp: never content and never content hashes.
- **Ephemeral compute.** No persistent disk for request data; a crash leaves nothing to recover.
- **Verifiability.** Intended to be backed by published data-path source, a CI test asserting no body serialization, an independent audit scoped to the proxy, provider-side zero-data-retention configuration, and a per-request no-retention signal.

---

## Open questions for legal review

These must be resolved by a lawyer before this DPA is used with any Firm:

1. **Entity.** Correct legal entity name, form, jurisdiction of formation, and registered address for Vendor. The EULA currently identifies Keepance as operated by an individual sole proprietor; confirm whether a firm-facing DPA requires a formed entity first.
2. **Controller/Processor classification.** Confirm Keepance is correctly characterized as a Processor only for license data (and proxy content, if used), and that the Firm is the sole Controller of Client Data. This classification drives the whole structure and the correct SCC module.
3. **GDPR / UK GDPR applicability and lead authority.** Whether and how these apply given the local-first architecture; whether SCCs (and which module) are needed for EU/UK Firms.
4. **CCPA/CPRA applicability.** Whether Vendor meets the thresholds and whether "service provider" contract terms are required.
5. **AI Provider as the Firm's sub-processor.** Confirm the Section 2.3 framing is accurate for each supported provider and that the Firm, not Vendor, owns that DPA.
6. **Assured Inference Proxy warranty.** Align Section 6 and Schedule C with what the deployed service and its audit can actually support; do not warrant zero-retention contractually beyond what the architecture and audit prove. Do not present the proxy as available until it ships.
7. **Sub-processor approval mechanism.** Notice-and-object (current draft) versus prior written approval per sub-processor.
8. **Audit-rights scope.** Whether the source/readiness-doc transparency is sufficient or enterprise Firms need a formal audit process.
9. **Governing law and venue.** Depends on entity formation.
10. **HIPAA / sector rules.** This DPA does not include a HIPAA BAA. Confirm healthcare clients are screened out at sales, or add the appropriate addendum.
11. **Privilege and confidentiality interplay.** Whether any DPA language is needed to reinforce (and not inadvertently waive) legal professional privilege over Client Data, given that the architecture is specifically designed to keep privileged material on-device and excluded from retrieval by default.
