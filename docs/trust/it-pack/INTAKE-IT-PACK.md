# Advisor Prep Hero Intake IT Gatekeeper Pack

> Audience: outside IT, security, and compliance reviewers evaluating Advisor Prep Hero Intake for a financial advisory firm.
>
> Scope: this document covers the hosted intake link, the relay, the client browser page, and the advisor desktop app handling received intake submissions. Advisor Prep Hero is not SOC 2 certified. This is not a SOC 2 report, certification, legal opinion, or substitute for the firm's own Reg S-P, books-and-records, privacy, and vendor-review obligations.
>
> Source discipline: hidden HTML comments cite the intake architecture sections behind the security claims. Claims about what not to say also cite the intake risks document.

## 1. One-page architecture summary

Advisor Prep Hero Intake lets an advisor send a secure checklist link to a client or household. The link is a capability URL. The secret part of the link is in the URL fragment, which browsers do not send to the server in normal HTTP requests. <!-- Source: docs/plans/lantern-plus/intake/ARCHITECTURE.md §0 and §2. -->

The advisor's desktop app creates a new intake keypair for each intake request. The private key stays on the advisor's machine in the operating system keychain. The public key is placed in the link fragment. The client's browser uses that public key to encrypt each answer and document before upload. <!-- Source: ARCHITECTURE.md §2. -->

The hosted relay stores encrypted payloads and minimal routing metadata. It does not receive the private key and has no key that can decrypt answers, Social Security numbers, license images, statements, or other submitted files. A compromised relay should expose ciphertext and metadata, not readable client data. <!-- Source: ARCHITECTURE.md §3 and §8 T1. -->

The client page is a self-contained web page with no third-party origins, no CDN, and no analytics. It is designed with a restrictive Content Security Policy: `default-src 'none'`, its own bundle, and the relay API as the only network destination. <!-- Source: ARCHITECTURE.md §4 and §8 T3. -->

When the advisor desktop app syncs, it downloads the encrypted submissions, decrypts them locally with the keychain-held private key, and writes them into local advisor storage. Documents land in the client's folder. Restricted typed values, such as SSN and DOB, go into an encrypted facts store, not ordinary app state or browser storage. <!-- Source: ARCHITECTURE.md §5 and §9. -->

The relay behaves like a mailbox, not an archive. The relay deletes ciphertext when the advisor's app acknowledges a durable local save. Independently, a daily retention sweep (also run once at boot) deletes any intake row past its expiry, whether or not it was ever acknowledged, so unsynced ciphertext does not accumulate indefinitely — this sweep runs on an up-to-24-hour cadence, not the instant a link expires. Expired and revoked links also stop granting access immediately. <!-- Source: ARCHITECTURE.md §3 and §5. -->

The important boundary is page integrity. If the hosted intake page itself were compromised and served malicious JavaScript, that malicious page could read values typed from that session forward before encrypting them. Advisor Prep Hero treats that as a real residual risk and mitigates it with a self-contained static bundle, no third-party code, CSP, published build hashes, and a deploy-time integrity check. <!-- Source: ARCHITECTURE.md §8 T3. Also RISKS.md §3. -->

## 2. Honest relay metadata list

This is the exact data boundary reviewers should use. The relay cannot read encrypted payloads, but it does see some routing and network metadata. Advisor Prep Hero does not describe this as "zero knowledge" because that would hide the metadata below. <!-- Source: ARCHITECTURE.md §3. Also RISKS.md §2. -->

### The relay can see

- `intake_id`.
- The creating seat or organization identity.
- Creation, expiry, and revocation timestamps.
- Opaque item ids.
- Submission timestamps.
- Ciphertext sizes and chunk counts. This means traffic analysis may suggest that a file of a certain approximate size was uploaded.
- `checklist_version`.
- `HMAC(t_auth)`, not the raw link bearer secret.
- HTTP request metadata that the server layer receives, including IP address and user agent per request. The design keeps these out of durable intake records, retains access logs for 24 hours, and uses in-memory rate-limit buckets.

### The relay cannot see

- The client's name.
- The client's email address or phone number in v1, because links are sent from the advisor's own email or SMS tools.
- Checklist item labels.
- Answers, including Social Security numbers and dates of birth.
- File names or file contents.

The relay stores the encrypted bytes of every submission (it has to, to relay them) but has no key that can decrypt them into any of the above. It also does not receive the intake private key needed to decrypt a submission. <!-- Source: ARCHITECTURE.md §2 and §3. -->

### Important precision

The relay cannot prove that arbitrary bytes posted to it are encrypted. The precise claim is: the honest Advisor Prep Hero client page encrypts each submission before upload, and the relay stores opaque bytes plus the metadata listed above. <!-- Source: RISKS.md §2; supported by ARCHITECTURE.md §3 and §4. -->

## 3. Data retention and deletion story

### On the relay

The relay stores sealed checklist state, sealed resume state, routing metadata, and encrypted submission payloads while an intake is active. Submitted files are uploaded in encrypted chunks. The relay stores chunk metadata and ciphertext, not decrypted files. <!-- Source: ARCHITECTURE.md §3 and §4. -->

The advisor desktop app acknowledges a submission only after it has decrypted the payload and saved it locally. Once acknowledged, the relay deletes the acknowledged ciphertext. If the advisor is offline, submissions remain queued as ciphertext until the desktop app syncs. <!-- Source: ARCHITECTURE.md §3, §5, and §10. -->

Expired or revoked links stop accepting normal access immediately. Separately, a retention sweep (run once at boot and once every 24 hours) deletes any intake row past its expiry, whether or not it was ever acknowledged, so the relay does not become a permanent intake archive — this means there can be up to a 24-hour window between a link's expiry and its ciphertext actually being deleted. <!-- Source: ARCHITECTURE.md §5 and §6. -->

Access logs are minimized. The design states that IP address and user agent are kept out of durable intake storage, with access-log retention limited to 24 hours and rate-limit buckets kept in memory. <!-- Source: ARCHITECTURE.md §3 and §8 T10. -->

### In the client browser

The client page derives keys from the link fragment in browser memory, encrypts the payload, uploads ciphertext, then discards the per-item content key and plaintext. Submitted values are not written to browser localStorage. <!-- Source: ARCHITECTURE.md §2, §4, and §8 T5. -->

Resume state contains only non-sensitive display data, such as progress flags, generic confirmations, and the client's first name. It does not contain last-4 SSN, file names, or submitted values. <!-- Source: ARCHITECTURE.md §2 and §4. -->

### On the advisor machine

Documents are filed into the client's folder under `Requests/onboarding/`. File-level at-rest protection follows the Advisor Prep Hero vault setting for that workspace. Restricted typed values go into a SQLCipher encrypted facts store keyed to the client record. Ordinary app state stores item status, timestamps, references, and masked renderings, not the restricted values themselves. <!-- Source: ARCHITECTURE.md §5 and §9. -->

The intake private key is stored in the operating system keychain. Social Security numbers are masked by default. Revealing, exporting, or copying a restricted fact writes an audit event. <!-- Source: ARCHITECTURE.md §2 and §5. -->

Local retention is a firm policy decision. The architecture's intake default is to keep scans in the client folder, protected by the local vault when the vault is on, with a per-item purge control and optional firm-wide auto-delete off by default. Deletion actions write audit rows. <!-- Source: ARCHITECTURE.md §5; RISKS.md §1 and §4. -->

## 4. Threat model summary

| Threat | Mitigation | Residual risk |
|---|---|---|
| Relay compromise, subpoena, or insider access | Relay holds ciphertext, token hashes, and the metadata listed above. It has no decryption key. | Metadata such as size, timing, IP, and user agent can still exist. <!-- Source: ARCHITECTURE.md §8 T1 and T10. --> |
| Malicious relay tries to substitute encryption keys | The intake public key comes from the link fragment, not from the relay. | The user still has to receive and open the genuine link. <!-- Source: ARCHITECTURE.md §2 and §8 T2. --> |
| Hosted intake page serves malicious JavaScript | Self-contained static bundle, no third-party origins, CSP pinned to the relay, published hashes, deploy-time integrity check. | This is the main residual trust root. Malicious served code could read values typed in that session before encryption. <!-- Source: ARCHITECTURE.md §8 T3; RISKS.md §3. --> |
| Link leak or forwarding | Link secret is 256-bit. Wrong-token, expired, revoked, and unknown requests return the same neutral result. A link holder cannot read submitted values or files. | A link holder can see the firm name and branding, checklist labels, client first name, per-item done flags, generic confirmations, and later-wave advisor-approved outbound prefills that are never restricted facts. They can submit new values to open items. The advisor sees each submission with its provenance, including a new-device indicator based on a per-session marker; a known limitation currently causes the client's own first-ever submission on a link to sometimes flag as a new device even though only one real device was ever used. <!-- Source: ARCHITECTURE.md §2, §3, §8 T4, and §9a. --> |
| Client device malware or shoulder-surfing | Masked inputs, no answer localStorage, plaintext kept in memory only. | A compromised client device can still read what the client types, as with any web form. <!-- Source: ARCHITECTURE.md §8 T5. --> |
| Advisor machine compromise | Private key is in the OS keychain; received files and facts use the app's local storage protections and audit trail. | If the advisor machine or OS account is compromised, application-level controls cannot fully protect already-decrypted data. <!-- Source: ARCHITECTURE.md §5 and §8 T6. --> |
| Advisor sends the link to the wrong person | Page greets the intended client by first name. The wrong recipient cannot read previously submitted secrets. Advisor can revoke and regenerate. | A wrong recipient can still submit into open items. The advisor sees each submission with its provenance, including the same new-device indicator and its known first-submission limitation described above. <!-- Source: ARCHITECTURE.md §2, §6, and §8 T7. --> |
| Malicious file upload | Server never decrypts or parses files. Advisor side uses size caps, type sniffing, no auto-open, and existing extraction rails. | A malicious file can still be delivered to the advisor machine as an inert file and must be handled with endpoint security in mind. <!-- Source: ARCHITECTURE.md §8 T8. --> |
| Denial of service on public endpoints | Bearer token required before body read, rate limits per intake and IP, chunk caps, total-size caps, per-intake upload quota. | Availability still depends on the relay being reachable. <!-- Source: ARCHITECTURE.md §3 and §8 T9. --> |
| Traffic analysis | Metadata is minimized and disclosed. Access logs are limited and not treated as client content. | File sizes, timing, IP, and user agent are not hidden from the HTTP service layer. <!-- Source: ARCHITECTURE.md §3 and §8 T10. --> |
| Email fallback confusion | Email fallback is labeled as a different channel and is not described as end-to-end encrypted. Restricted fields route to phone walkthrough instead of email when the secure page cannot run. | Email replies have the confidentiality level of the firm's email system, not Advisor Prep Hero Intake's browser encryption. <!-- Source: ARCHITECTURE.md §4 and §8 T11; RISKS.md §5. --> |

## 5. FAQ for firm IT and compliance reviewers

### 1. Can Advisor Prep Hero read a client's SSN or uploaded documents?

No. In the designed intake path, the client's browser encrypts each answer and document to the intake public key before upload. The relay does not have the private key. <!-- Source: ARCHITECTURE.md §2, §3, and §8 T1. -->

### 2. What exactly is stored on Advisor Prep Hero-operated infrastructure?

The relay stores routing metadata, token hashes, sealed checklist and resume state, encrypted chunks, and encrypted item manifests until they are acknowledged by the advisor's app or swept up by the daily expiry cleanup, whichever comes first. It also receives normal HTTP request metadata such as IP and user agent. <!-- Source: ARCHITECTURE.md §3. -->

### 3. Does the server know the client's name, email, phone, item labels, file names, or answers?

No for v1 intake. The architecture states that the relay does not see the client's name, email, phone, item labels, answers, file names, or file contents. <!-- Source: ARCHITECTURE.md §3. -->

### 4. What encryption is used?

The design uses AES-256-GCM for payload sealing, ECDH P-256 with HKDF-SHA256 for wrapping per-item content keys to the intake public key, and SQLCipher for the local restricted facts store. <!-- Source: ARCHITECTURE.md §1, §2, and §5. -->

### 5. Where are keys stored?

The intake private key is generated on the advisor machine and stored in the operating system keychain. The link secret is in the URL fragment and is not sent to the relay. Per-item content keys are generated in the client's browser, used for one submission, wrapped to the intake public key, and then discarded by the page. <!-- Source: ARCHITECTURE.md §2 and §4. -->

### 6. What happens if the link is forwarded?

A forwarded link can show the firm branding, checklist labels, client first name, per-item done flags, generic confirmations, and later-wave advisor-approved outbound prefill values. Restricted facts are never prefilled. It cannot read submitted values or uploaded files. It can submit new values to open items, and those submissions are surfaced to the advisor with provenance and a new-device indicator (see the link leak/forwarding threat-table row above for that indicator's known first-submission limitation). <!-- Source: ARCHITECTURE.md §2, §8 T4, and §9a. -->

### 7. Can the client reopen the page and read back what they already submitted?

No for sensitive submitted payloads. The page stores only generic confirmations and completion status. It does not keep last-4 SSN, file names, or submitted values in resume state. <!-- Source: ARCHITECTURE.md §2 and §4. -->

### 8. What happens if the advisor is offline?

The relay queues encrypted submissions as a mailbox. The advisor app decrypts and files them the next time it syncs. The relay deletes acknowledged ciphertext only after the advisor app confirms local durable storage. <!-- Source: ARCHITECTURE.md §3, §5, and §10. -->

### 9. What happens if the advisor's computer is lost before syncing an intake?

In v1, unsynced in-flight submissions are unreadable if the creating advisor's private key is lost. The honest recovery path is to resend a fresh intake. Already synced files and facts remain in the advisor's local storage. <!-- Source: ARCHITECTURE.md §2 and §10. -->

### 10. Is the client page allowed to contact third-party services?

No. The page is designed as a self-contained static app with no third-party origins, no CDN, and no analytics. Its network access is limited by CSP to the relay API. <!-- Source: ARCHITECTURE.md §4 and §8 T3. -->

### 11. Does the intake page run AI on the client's private data?

Not cloud AI. The client page may run local deterministic checks in the browser, such as file type or document keyword checks. Any deeper AI review happens later on the advisor machine after decryption, using the app's normal provider controls. <!-- Source: ARCHITECTURE.md §7. -->

### 12. Is email fallback part of the end-to-end encrypted intake design?

No. Email is a separate fallback channel with the confidentiality of the firm's email system. The product must label email-sourced items separately and must not describe email fallback as end-to-end encrypted. <!-- Source: ARCHITECTURE.md §8 T11; RISKS.md §5. -->

### 13. Does Advisor Prep Hero claim SOC 2 certification for Intake?

No. This pack is an architecture and risk explanation, not a SOC 2 report. Advisor Prep Hero must not claim SOC 2 certification unless an independent audit has actually been completed. <!-- Source: RISKS.md §2. -->

### 14. Does Advisor Prep Hero Intake make the firm compliant with Reg S-P or books-and-records rules?

No. The firm remains the regulated entity. Advisor Prep Hero Intake can help reduce server-side exposure of client PII, but retention, deletion, incident response, supervision, and books-and-records decisions remain firm obligations. <!-- Source: RISKS.md §1; ARCHITECTURE.md §5. -->

### 15. Can a firm delete intake data?

Yes, with two layers. The relay deletes ciphertext when the advisor's app acknowledges a durable local save, and a daily sweep (also run once at boot) independently deletes any intake past its expiry, whether or not it was ever acknowledged — so unsynced ciphertext does not accumulate indefinitely, though there can be up to a 24-hour window between a link's expiry and that sweep actually removing it. Locally, the architecture includes per-item purge controls and optional firm-wide auto-delete, with audit rows for deletion actions. Firms should set retention rules before collecting restricted data. <!-- Source: ARCHITECTURE.md §3, §5, and §6; RISKS.md §1 and §4. -->

## 6. Reviewer checklist

- Confirm the final deployed intake page keeps the no-third-party, no-analytics, no-CDN rule. <!-- Source: ARCHITECTURE.md §4 and §8 T3. -->
- Confirm the deploy process checks the served bundle against the published hash before release. <!-- Source: ARCHITECTURE.md §8 T3. -->
- Confirm access-log retention and rate-limit storage match the metadata statement above. <!-- Source: ARCHITECTURE.md §3 and §8 T10. -->
- Confirm ack-after-local-write is implemented before treating relay deletion as a control. <!-- Source: ARCHITECTURE.md §5 and §10. -->
- Confirm email fallback copy stays clearly separate from the encrypted link path. <!-- Source: ARCHITECTURE.md §8 T11; RISKS.md §5. -->
- Confirm firm retention settings are documented before restricted intake fields are enabled. <!-- Source: ARCHITECTURE.md §5; RISKS.md §1 and §4. -->
