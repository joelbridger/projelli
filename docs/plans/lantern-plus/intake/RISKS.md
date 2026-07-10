# Lantern Intake — Risks, Compliance Notes, and Claims Discipline
**Author:** dedicated Intake design session (Fable 5), 2026-07-10.
**Purpose:** the honest register — what regulators and IT gatekeepers will ask, where the design's real weak points are, and the sentences we must never say. Not legal advice; flag anything here that needs real counsel before customer-facing use.

---

## 1. Regulatory framing (Reg S-P and friends)

- **The firm is the regulated entity; Lantern is a service provider.** RIAs sit under Reg S-P's Safeguards Rule (and the 2024 amendments, whose compliance dates for smaller firms land ~Dec 2025/June 2026 — i.e., NOW for our ICP): written policies for safeguarding customer information, incident response programs, and customer breach notification. Our story must be framed as *helping the firm meet its obligations*, never as taking them over.
- **What our architecture honestly contributes:** client PII collected through the link is end-to-end encrypted; a compromise of Lantern's server cannot expose readable client data (ARCHITECTURE.md §8 T1). Under breach-notification analyses, encrypted-beyond-provider-reach data is a categorically better position. Say exactly that — no more.
- **SSN-specific expectations:** several states (MA 201 CMR 17.00 is the strictest model) explicitly require encryption of SSNs in transit and at rest. We exceed the requirement (encrypted in transit, at rest, AND from the service provider itself). The email fallback is the exception — see §5.
- **Books and records (Advisers Act 204-2):** advisors may be *required* to retain records we might casually delete. Retention controls must always be firm-decided; we never auto-delete by our own policy alone (QUESTIONS #4, decided 2026-07-10: keep by default, per-client delete, firm-wide auto-delete opt-in). Deletion actions get audit rows.
- **What to prepare for the IT gatekeeper (AlphaOne-type reviewers):** the honest-metadata list (ARCHITECTURE.md §3), the key-model one-pager, subprocessor list (hosting provider for the relay + static page), access-log retention (24h), and the incident-response posture. This slots into the existing IT-gatekeeper pack effort.

## 2. Claims discipline — sentences we must never say

- **Never claim SOC 2 certification** (we have none). Approved framing: "Lantern has not completed a SOC 2 audit. Here is our architecture instead, which removes the server from the trust equation for client data: [honest posture]." If a firm requires SOC 2 as a hard gate, that is a sales fact to record, not a claim to fudge.
- Never "bank-level security," "military-grade," "zero-knowledge" (the relay does see metadata — §3 of ARCHITECTURE.md — so "zero-knowledge" would be false), or "HIPAA/GLBA compliant" (compliance is the firm's property, not a product feature).
- **The client-page headline ("this page locks your information on your device; only [Firm] can unlock it") is permitted ONLY while the Wave 1 page-integrity gates hold** (published build hashes + deploy-time integrity verification, ARCHITECTURE.md §8 T3), and the linked privacy explainer must state the condition honestly: the promise depends on the page you received being the genuine one, and here is how we protect that. If the integrity gates ever lapse, the headline overclaims and must change — this pairing is a standing claims-discipline rule, not a launch detail.
- Say "the honest client sends only ciphertext; the server holds no key to read anything" rather than "the server only ever stores ciphertext" — the relay cannot verify that arbitrary bytes are encrypted, and our own privacy-proof test is scoped to honest-client behavior. Precision here is cheap and reviewers notice.
- Never describe the email fallback as encrypted end to end (§5).
- Never "we can't be breached." Approved: "a breach of our server cannot expose your clients' readable data."
- The client-page privacy explainer, the marketing site, and the IT pack must all use the SAME carefully worded claims — one source of truth, reviewed once, reused everywhere.

## 3. The hosted component — the real weak point, named

The E2EE guarantee has one residual trust root: **the JavaScript we serve to the client's browser** (ARCHITECTURE.md §8 T3). If the intake host were compromised and served poisoned code, that code could exfiltrate what a client types *from that session onward*. This is true of every web-delivered E2EE product (Proton, Bitwarden web vault); we adopt the same honest posture:
- Minimal, self-contained, versioned page bundle; published build hashes **plus a deploy-time integrity check that fails the deploy on any mismatch — a Wave 1 gate, not a roadmap item**; CSP `connect-src` pinned to the relay origin; no third-party origins at all, ever (one analytics script would break the whole story).
- The bar this sets operationally: the intake page's deploy pipeline is security-sensitive infrastructure. Deploy access, integrity checks, and change review at the same rigor as the relay itself. No CDN rewriting, no tag managers, nothing injected.
- We say it out loud in the IT pack (reviewers respect the honesty and will find it anyway), while noting the comparison point: every "secure portal" competitor holds server-readable plaintext as its *normal operating mode*, which is strictly worse than our worst case.
- Roadmap noted, not promised: reproducible builds / signed-page verification.

## 4. Driver's license scans

- DL scans are identity documents: store only in the vault-encrypted client folder, masked thumbnails in UI, no OCR output of DL numbers into any plaintext store (extracted DL fields are `restricted` facts, same handling as SSN).
- Some states regulate retention/use of scanned IDs (anti-fraud statutes aimed at retailers, e.g., limits on retaining scanned barcode data). Advisory onboarding for identity verification is a legitimate purpose, but: collect front/back images only, never barcode-parse for extra fields we didn't ask consent for, and keep the per-client delete control visible (QUESTIONS #4, decided: keep by default + per-client delete + opt-in firm auto-delete).
- We do no biometric processing (no face matching). State biometric statutes (BIPA-style) are therefore out of scope — keep it that way; any future "verify identity by selfie" idea re-opens this section.

## 5. The email fallback is a different lock — never blur it

- Email replies are as private as the firm's email, no more. Provenance chips mark every email-sourced item; the privacy explainer states it; marketing never implies the E2EE applies to the email door.
- Mis-filing is this feature's catastrophic failure (someone else's SSN in the wrong client's folder). The deterministic gate (sender matches the client on file AND an active intake with open items exists, in-thread replies preferred) runs BEFORE any AI; email authentication splits the flow into two distinct paths — authenticated mail gets normal proposals, failed/missing-auth mail is quarantined into a manual-only card with nothing pre-selected and a loud warning (so spoofs never reach one-click accept, and legitimate clients on misconfigured domains don't silently vanish); and nothing files without advisor confirmation — hard product rules (PRODUCT-DESIGN.md §7). Wave 3's adversarial review explicitly attacks them (spoofed From headers, look-alike addresses, forwarded-thread tricks).
- The WebCrypto-fallback path routes by sensitivity (documents → email; SSN → phone walkthrough) precisely so the fallback never funnels the most sensitive value into the weakest channel (PRODUCT-DESIGN.md §6).
- Inbound email is untrusted content: extraction prompts must treat message bodies as data, not instructions (prompt-injection discipline per the repo's security rules).

## 6. Phishing surface

Intake links train clients to click a link and type an SSN — the exact behavior phishers want. Mitigations, all cheap, all v1: the link always arrives personally from the advisor's own email/phone (never a Lantern-branded blast); one consistent domain forever (QUESTIONS #3, decided: one neutral Lantern-owned address, firm branding on-page); the page greets by first name and shows the firm brand; the privacy explainer includes "how to know this page is really from your advisor: it came from [advisor] directly, and the address is always <domain>"; firms get a one-paragraph client-education blurb in the welcome template. Accept honestly: we cannot stop a determined spoof of a *different* domain — no web product can — but we avoid creating habits that make it easier (no urgency language in nudges, nudges always reference specifics only the real firm knows).

## 7. Abuse, availability, and data-handling residuals

- **Public endpoint abuse:** the relay's intake routes are the product's only unauthenticated-ish surface (bearer `t_auth`). Rate limits, size caps, per-intake quotas, uniform 410s (ARCHITECTURE.md §3, §8 T9), and a kill switch per intake and globally (feature flag) for incident response.
- **The relay is single-instance today** (its sync tickets and rate buckets live in process memory — `backend/src/lib/syncTickets.ts`). Intake's in-memory rate/quota buckets inherit that; horizontal scaling would need shared state. One thing must be durable regardless of instance count from day one: duplicate-`submission_id` rejection is DB-backed, never an in-memory set, or a restart reopens the replay window.
- **SQLite blob growth:** license scans and statements make the relay's single SQLite file grow fast. Ack-deletes-ciphertext plus expiry-plus-grace cleanup bounds it; watch disk on the relay host; a move to file-backed blob storage is an implementation escape hatch that changes nothing about the crypto.
- **Malicious uploads:** inert-bytes handling, no server parsing (structurally impossible — server can't decrypt), advisor-side sniffing and sandboxed extraction (ARCHITECTURE.md §8 T8).
- **Client-side data residue:** the page keeps plaintext in memory only; no localStorage of answers; masked inputs; `Referrer-Policy: no-referrer`; fragment never sent. Browser autofill/password managers may offer to remember typed values — set the standard `autocomplete` hints to discourage retention on SSN fields.
- **Accessibility as a compliance-adjacent risk:** our ICP's clients skew older; an inaccessible intake page is both a business failure and an ADA exposure for the firm. WCAG-conscious build from Wave 1; formal audit in Wave 6.

## 8. The general form-request surface (Addendum 1 additions)

- **The DocuSign boundary must never be blurred.** A signed envelope transits DocuSign's cloud; the E2EE story stops at that handoff. The flow marks it (audit row, Integration Honesty Card, plain sentence in the advisor UI). Marketing that implies the sign stage is end-to-end encrypted would be false — same discipline as the email fallback (§5).
- **Native click-to-sign is legally real but narrower than it looks.** ESIGN/UETA generally honor click-to-sign with intent + attribution + record retention (our audit rows are strong here), but custodians and many counterparties dictate their own signing rails and will not accept it. Scope it to firm-internal forms only, and have counsel glance at the affirmation wording before it ships (Wave 9's assessment covers this).
- **Custodian PDF reuse:** firms fill the custodian's own forms as clients of the custodian — normal use. We do not redistribute vendor forms, ship a form library, or pre-bundle Schwab PDFs; the firm imports its own copies. Keep it that way and the IP question stays boring.
- **Field-map mistakes are the PDF pipeline's mis-filing analog.** A mis-mapped field could put an SSN into a visible or low-sensitivity slot. Mitigations: sensitivity is inherited from the fact kind (mapping a `restricted` kind forces restricted handling), the map editor previews exactly what the client will see, and Wave 8's adversarial review attacks the mapping. Prefill previews show the advisor every prefilled value before send.
- **Prefill inverts the data flow, so it is tiered (ARCHITECTURE.md §9a):** whatever we prefill to the page, a link holder can read — the promise splits into "submitted payloads are write-only, always" and "outbound prefills are link-visible, by construction." Standard facts may prefill automatically; confidential facts require explicit advisor opt-in with a preview of exactly what ships; restricted facts never prefill outbound (confirm-or-replace without the value). The write-only property stays one-directional: secrets flow client to advisor, never advisor to link.
- **Builder scope creep is a board-stance risk, not just a product one.** The moment the builder grows conditional logic, public galleries, or non-client audiences, we are building JotForm and diluting the identity. The constraint (items in a request, sent to a client, period) is written into Wave 10's goal and should be defended in review.

## 9. Honest unknowns (to validate, not assume)

- One firm (the design partner) validates the "clients will type SSNs into an E2EE page" premise. The brief locks it for v1 — good — but the 3-5 additional advisor validation chats recommended in the pain analysis should confirm it before we scale marketing claims around it.
- Reg S-P amendment interpretations for small RIAs are young; have counsel sanity-check the IT-pack language before it goes to a real gatekeeper.
- Whether firms will accept relay-side deletion-on-ack (some may *want* a server-side copy for continuity) — surfaced as a setting question only if real firms push back; default stays minimize.
