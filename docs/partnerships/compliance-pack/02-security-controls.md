# 02 - Security Controls Memo

Draft date: 2026-07-09
Audience: CCO, RIA compliance consultant, security reviewer
Status: Draft for review. This is not legal or compliance advice.

## Executive summary

Advisor Prep Hero reduces central vendor risk by keeping client work local. The security program still needs ordinary controls: encrypted devices, OS account security, approved storage, approved AI providers, patching, logs, support limits, and a deletion/retention process.

Reg S-P requires written administrative, technical, and physical safeguards designed to protect customer information. This memo maps Advisor Prep Hero's product controls to those safeguards and flags the firm-side controls the product cannot replace.

## Security control inventory

| Control area | Advisor Prep Hero control | Firm control needed | Reg S-P safeguard mapping |
|---|---|---|---|
| Local storage | Workspace files live in a user-selected local folder. The product does not upload the workspace to Advisor Prep Hero servers. | Require firm-approved storage locations and backups. Turn on full-disk encryption. | Protects confidentiality by limiting vendor access; device safeguards still matter. |
| Optional vault encryption | Workspace vault can encrypt file contents with AES-256-GCM. File names/folder structure may remain visible. | Decide whether vault is required. Store recovery phrase and key escrow according to firm policy. | Technical safeguard for local records. |
| Email store | Imported email is stored locally in an encrypted database. | Approve email import, mailbox access, and email retention schedule. | Technical safeguard for local customer information. |
| Audit log | AI and privacy events are stored in a local encrypted, append-only, tamper-evident audit database. | Review/export logs on a schedule and archive them in the firm's official system. | Administrative and technical support for supervision and records. |
| Local search index | Search data remains on device. Passage text and paths are protected locally; some metadata may remain readable so search isolation works. | Treat index files as customer information. Include them in device/storage protection. | Technical safeguard; not a substitute for disk encryption. |
| AI key storage | Cloud AI API keys are stored in the OS keychain: macOS Keychain, Windows Credential Manager, or Linux Secret Service. | Require firm-owned provider accounts for firm work. Remove keys during offboarding. | Access-control safeguard. |
| AI egress controls | A visible mode picker and egress indicator show whether the next AI request stays local, goes direct to provider, or uses firm Assured relay. Local-only blocks cloud AI sends. | Train users to check the mode. Set firm policy on approved modes. | Administrative and technical safeguard against unauthorized disclosure. |
| Client/matter isolation | AI retrieval is scoped by client/matter, with explicit controls for cross-client/all-matters use. | Train users. Review all-matters searches if permitted. | Access-control and confidentiality safeguard. |
| Privileged/sensitive exclusions | Sensitive material can be excluded from retrieval by default, and inclusion can require explicit action. | Define firm tagging rules and review exceptions. | Administrative safeguard for sensitive customer information. |
| Connector write-backs | CRM-style writes are intended to be shown in a review card and require user approval before anything is sent. | Approve each connector and require pre-send review. | Administrative safeguard and supervision control. |
| Update process | Desktop updater uses signed update artifacts and a public release manifest. Current update endpoint: GitHub release manifest for `lanternplatform/lantern`. | Require timely updates and define who may install. Confirm platform code-signing status: [Windows/macOS signing status]. | Technical safeguard for patching and vulnerability management. |
| Network allow-list | The desktop app's content security policy limits outbound browser-layer connections to approved endpoints: AI providers, Advisor Prep Hero license/forms/API endpoints, local model ports, and local IPC. | Review connector-specific domains before enabling new integrations. | Technical safeguard limiting data paths. |
| Telemetry | Anonymous lifecycle telemetry is off by default and sends no content, prompts, email, client names, file names, or search queries. Local-only mode suppresses it. | Decide whether telemetry is allowed. Default recommendation: disable for regulated firms unless approved. | Disclosure minimization. |
| Diagnostics/error reporting | Optional design-partner diagnostics are off by default and structure-only. No free-text content fields are permitted by the event type. Local-only mode suppresses it. | Decide whether diagnostics are allowed. Default recommendation: disable unless in a controlled pilot. | Disclosure minimization. |
| Support access | Advisor Prep Hero has no remote admin access to browse a user's workspace. Support sees only what the user voluntarily sends. | Prohibit support uploads with client information unless approved and logged. | Administrative safeguard and least-access rule. |
| Firm collaboration | Firm sync relay stores encrypted blobs if enabled. The server should not hold plaintext workspace content. | Review key management, offboarding, and DPA before enabling. | Service-provider safeguard and oversight. |
| Assured relay | If enabled, the relay forwards AI requests using the firm's managed key and claims no prompt/completion retention. | Approve only after DPA, provider agreement, and technical evidence are current. | Service-provider oversight and incident-response contract review. |
| Backup/deletion | No Advisor Prep Hero cloud backup of local workspace data. Local deletion removes local records but not copies in firm backups or third-party storage. | Use the firm's backup, archive, legal-hold, and disposal rules. | Reg S-P disposal and Rule 204-2 retention support. |

## Encryption at rest

Advisor Prep Hero uses multiple layers:

- Device or firm storage encryption: the firm should require BitLocker, FileVault, LUKS, or equivalent full-disk encryption.
- Optional workspace vault: AES-256-GCM encryption for workspace file contents when enabled.
- Imported email store: local encrypted database.
- Audit log: local SQLCipher-encrypted append-only database.
- Local search index: local protections for indexed content, with some readable metadata where needed for isolation and search.
- OS keychain: stores AI API keys and local encryption keys.

Important limitation: plain workspace files are protected by the device and chosen storage unless the vault is enabled. Local-first does not equal encrypted by default for every file.

## Encryption in transit

- Direct cloud AI calls use HTTPS/TLS to the selected AI provider.
- License, telemetry, diagnostics, support, firm sync, and Assured relay endpoints use HTTPS/TLS.
- Local model calls use localhost by default, such as Ollama on `127.0.0.1`.
- Firm collaboration data should be end-to-end encrypted before it reaches the relay.

## Access controls

Advisor Prep Hero's access boundary starts with the operating system:

- The user must be signed into the device/OS account.
- The workspace folder is controlled by OS file permissions and firm storage permissions.
- AI keys are controlled by the OS keychain.
- Firm seats and entitlements can limit licensed access and updates, but a lapsed or revoked license should not block access to local files.
- Firm use should pair Advisor Prep Hero with SSO/firm admin controls when available: [SSO status / firm admin status].

## Logging and audit

Advisor Prep Hero maintains a local audit log designed to record:

- AI model calls.
- Retrieval/search actions.
- Egress destination: local, provider-direct, demo proxy, or Assured relay.
- Citation verification outcomes.
- Privilege/sensitive-material handling.
- Approved or blocked external writes.
- Integrity status for the audit log itself.

The audit log supports supervision, but it is not the firm's official archive by itself. The firm should export or preserve it according to Rule 204-2 policy.

## Vulnerability management and update process

Advisor Prep Hero should be reviewed as desktop software with local data access:

- Updates are delivered through the desktop update process and signed update artifacts.
- Release artifacts are hosted through GitHub releases.
- The firm should define an update cadence and emergency patch path.
- Security reports should go to [security contact].
- Current independent penetration test status: [pen-test status/date/provider].
- Current SOC 2 status: [SOC 2 status/date/scope].
- Current software bill of materials or dependency scan evidence: [SBOM/dependency-scan status].

## Backup and deletion

Advisor Prep Hero does not back up client work to Advisor Prep Hero servers. That means:

- The firm must decide where workspaces live.
- The firm must decide how workspaces are backed up.
- The firm must decide how long records are retained.
- The firm must decide how legal holds are applied.
- The firm must decide how deletion/disposal is documented.

Deletion in Advisor Prep Hero does not delete copies already captured by firm backup, email archive, CRM, cloud drive, or other third-party systems.

## Support/admin access limits

Advisor Prep Hero should be described this way in questionnaires:

- Vendor personnel do not have remote access to browse customer workspaces.
- Vendor personnel do not have access to direct BYOK prompts or responses.
- Vendor personnel do not have direct access to customer AI provider API keys.
- Vendor personnel may see license records, support messages, optional telemetry/diagnostic events, and any files the user voluntarily sends to support.
- For firm sync, vendor infrastructure may store encrypted blobs and metadata, but should not hold plaintext content.
- For firm Assured, vendor infrastructure may process prompt content transiently if that mode is enabled. Approval depends on the DPA and technical evidence for no retention.

## Reg S-P safeguards mapping

17 CFR 248.30 requires written safeguards that address administrative, technical, and physical safeguards. Advisor Prep Hero supports those safeguards in the following ways:

- Administrative: visible AI mode choice, firm policy language, support limits, human approval rules, audit logs, user training.
- Technical: local-first storage, OS keychain, encrypted stores, egress controls, signed updates, network allow-list, client/matter isolation.
- Physical: relies on firm device controls, locked offices, endpoint management, full-disk encryption, and lost-device procedures.

## Open items for Jameson

- [SOC 2 status/date/scope]
- [Pen-test status/date/provider]
- [Cyber insurance carrier/limits]
- [Legal entity name]
- [Security contact]
- [DPA template status/date]
- [Windows/macOS code-signing status]
- [Firm SSO/admin feature status]
- [BCP/DR summary owner]

## Sources

- 17 CFR 248.30, safeguards and incident response: https://www.ecfr.gov/current/title-17/chapter-II/part-248
- SEC Reg S-P 2024 final rule release: https://www.sec.gov/files/rules/final/2024/34-100155.pdf
- SEC 2026 Examination Priorities: https://www.sec.gov/files/2026-exam-priorities.pdf
