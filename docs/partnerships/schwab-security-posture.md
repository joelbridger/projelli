# Advisor Prep Hero — Security Posture (for Schwab & other custodian/partner vetting)

*Draft prepared by Fable. This is the security story any custodian or integration partner (Schwab first) will vet us against. It doubles as the backbone of a future SOC 2 narrative. Fill [brackets]; keep every claim true.*

## The one-line pitch to a security reviewer
"We are a **local-first** product: the confidential client data our software touches stays on the advisor's own machine. We hold almost nothing on our servers, which makes us a structurally low-risk integration."

## Data handling
- **Client documents, email, notes, files:** stored on the advisor's device only (Tauri desktop app, OS filesystem). Never uploaded to our servers.
- **AI processing (BYOK):** AI requests go from the advisor's machine directly to their own AI provider (OpenAI/Anthropic/Google) with the advisor's own key, or run fully on-device (Ollama). We never see prompts, documents, or client content. An always-visible egress indicator + printable Data Map make this inspectable.
- **API keys:** stored in the OS keychain (Windows Credential Manager / macOS Keychain), never in plaintext, never on our servers.
- **Firm collaboration:** end-to-end encrypted — our relay (`api.lanternplatform.app`) stores only ciphertext; information barriers enforced by key denial, not UI hiding. The server cannot read content.
- **Audit:** append-only encrypted audit log (SQLCipher) of all AI actions and sends.

## Data that WOULD flow to Schwab (for account opening)
- Only the account-application fields the advisor reviews and approves (name, DOB, address, SSN, funding, beneficiaries), sent **from the advisor's machine to Schwab**, over Schwab's own secure channel, after explicit advisor review. Logged in the audit trail. No account data is retained on our servers.

## Encryption
- At rest: OS-level + optional AES-256-GCM encrypted vault (`keepance-vault` crate) for the workspace; SQLCipher for audit/mail metadata.
- In transit: TLS to all endpoints; E2EE for firm-shared content.

## Access control & identity
- SSO (OIDC) for firm tier; per-seat entitlement.
- Per-client cryptographic isolation ("matter isolation") — client data is compartmentalized.

## Compliance status (fill honestly)
- SOC 2 Type [I/II]: [not yet started / in progress / target date]. Recommend engaging a SOC 2 auditor before/alongside the Schwab application — it's the common bar.
- Reg S-P / Reg BI alignment: the local-first + audit + consent-gate design maps to advisor confidentiality obligations.
- Penetration test: [status].

## Why this posture is an ADVANTAGE in vetting
Most integration partners are cloud SaaS that ingest and store client PII centrally — a large attack surface a custodian must scrutinize. We invert that: the data stays with the advisor. Our server holds ciphertext (firm relay) and booking-safe scheduling data only. That's a materially smaller risk story to defend.

## Gaps to close before applying (honest checklist)
- [ ] Formal SOC 2 engagement (biggest lever).
- [ ] Written data-flow diagrams (this doc is the start).
- [ ] Incident response + breach notification policy documented.
- [ ] Pen test on the firm backend + any account-opening data path.
- [ ] Vendor/subprocessor list (AI providers as advisor-directed, not our subprocessors).
