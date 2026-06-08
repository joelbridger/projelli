# Security FAQ: Questions CCOs, IT Reviewers, and Malpractice Carriers Ask

**Internal document. Feeds gatekeeper one-pagers and the public trust page.**
**Last updated: 2026-06-08**

This document answers the specific questions that come up during vendor approval reviews for law firms, CPA firms, RIA compliance departments, and malpractice carriers. Answers are written to be copy-pasted into questionnaires or quoted verbatim in review conversations. The framing is honest: where Keepance has a gap, it says so.

---

## Architecture and data storage

**Q: Where is data stored?**

A: On the user's machine, in a folder they choose. Keepance stores all documents, notes, chat histories, and workspace files as plain files (Markdown and JSON) on the user's local hard drive. No Keepance server holds a copy of workspace data.

---

**Q: Does Keepance have servers that touch client data?**

A: No, with three narrow exceptions unrelated to workspace content: (1) a license key validation call that contains the license key only; (2) periodic update-check requests to GitHub Releases that contain no user data; and (3) a web demo on the marketing homepage that uses a shared API key for pre-installation trials. The desktop app does not use the web demo proxy once installed with the user's own key. Workspace content, documents, and AI chat histories never reach Keepance servers.

---

**Q: Is there a cloud backup or sync?**

A: No. There is no cloud sync, no backup to Keepance's servers, and no account-linked storage of any kind. The workspace exists only on the user's local machine. Organizations should layer their own backup solution (e.g., Time Machine, Windows Backup, or a network drive) on top of Keepance if they want redundancy.

---

**Q: If a Keepance server is breached, what data is exposed?**

A: No workspace data. The only Keepance-side data stores contain: license keys and purchase records (held by LemonSqueezy, our payment processor), GitHub release manifests (public), and web demo proxy logs (short-lived, no identifying workspace content). User documents, AI chat histories, and API keys are not on Keepance servers and cannot be reached by a Keepance server breach.

---

## AI providers and data flow

**Q: Who can see the prompts a user sends to AI?**

A: It depends on which path the user takes.

- **Cloud BYOK path (Anthropic, OpenAI, Google):** The prompt travels from the user's machine directly to the chosen AI provider's API under the user's own API account. Keepance is not in this path and never sees the prompt. The AI provider receives the prompt and is governed by its API data-processing terms. Neither Anthropic nor OpenAI uses API inputs to train models by default (see each provider's current commercial API terms for exact language).
- **Local model path (Ollama):** The prompt stays on the user's machine. The AI model runs locally. No data reaches any external server. No party other than the user sees the prompt.

---

**Q: Does a BYOK cloud key mean "nothing leaves the machine"?**

A: No, and we don't claim otherwise. With a cloud BYOK key (Anthropic, OpenAI, Google), the prompt still travels to that cloud provider's servers for inference. Keepance is removed from the data path, but the cloud AI provider is not. The "nothing leaves the machine" statement applies only when the user is running a local model such as Ollama. These are meaningfully different postures, and the distinction matters for professional confidentiality analysis.

---

**Q: What are the AI provider's data-handling commitments?**

A: The relevant policies are:

- **Anthropic (Claude API):** Does not train on API inputs by default. See [Anthropic Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms).
- **OpenAI (API):** Does not train on API inputs by default. Default API log retention is 30 days for abuse monitoring; zero-retention is available on request for some plans. See [OpenAI API data usage policies](https://openai.com/policies/api-data-usage-policies/).
- **Google (Gemini API paid tier):** Review current [Gemini API Terms of Service](https://ai.google.dev/gemini-api/terms) -- terms differ by tier and update periodically.
- **Local model (Ollama, etc.):** No network call; no provider involved.

These are the user's direct relationships with the providers under their own API accounts. Keepance is not a sub-processor for these calls.

---

**Q: Is Keepance a "sub-processor" of the user's AI provider?**

A: No. The AI provider call goes directly from the user's machine to the provider under the user's own API key. Keepance does not proxy, log, or store these requests. Keepance is not in the contractual chain between the user and their AI provider.

---

## Key storage and credentials

**Q: How are API keys stored?**

A: In the OS-native keychain: macOS Keychain on Mac, Windows Credential Manager on Windows, and libsecret (GNOME Keyring / KWallet) on Linux. Keys are never written to config files in plaintext, never logged, and never transmitted to Keepance. If a user's machine is lost or the app is uninstalled, the key remains in their OS keychain under their control.

---

**Q: Can an API key be extracted from the Keepance app?**

A: Not via normal app operation. Keys are read from the OS keychain at the time a request is made and are not held in memory beyond that use. They are not written to disk in plaintext anywhere in the app. An attacker with full OS-level access to the machine (root/admin) could access the keychain through the OS's own keychain APIs, but that is a function of OS security, not Keepance-specific storage.

---

## Audit trail and matter isolation

**Q: Is there an audit trail?**

A: Yes. Keepance maintains an append-only audit log per workspace that records: timestamp, AI model used, the list of files included as context for that session, and the output produced. The log is stored on the user's machine as part of the workspace and can be exported as plain text. It cannot be deleted without deleting the workspace folder itself.

---

**Q: Is there client matter isolation?**

A: Yes, by folder structure. Each matter has its own subfolder within the workspace. An AI chat session is scoped to the folder it is opened from; the AI does not have access to files outside that scope. There is no cross-matter shared memory or chat history. The user controls the folder structure.

---

## Compliance certifications and agreements

**Q: Do you have SOC 2?**

A: No. Keepance has not completed a SOC 2 Type I or Type II audit. We don't hold any active SOC 2 report. We are evaluating whether to pursue an audit scoped to the parts of our infrastructure that are auditable (license server, update server, web demo proxy). The bulk of what a SOC 2 audit tests -- controls around vendor-side data storage and processing -- does not apply to Keepance's architecture because we don't process user data server-side. If SOC 2 is a hard requirement for your vendor approval process, we cannot satisfy that requirement today.

---

**Q: Do you have a signed Data Processing Agreement (DPA)?**

A: Not yet. A draft DPA template is in preparation and under legal review. We expect to have a reviewable draft available in the coming months. Contact [legal@keepance.com](mailto:legal@keepance.com) for current status.

Note: the traditional DPA framing governs a cloud SaaS vendor that processes personal data on its servers on behalf of a customer. Because Keepance does not process workspace data on its servers, the standard cloud-processor DPA model does not map cleanly to our architecture. Our legal review is working through the right framing for this.

---

**Q: Do you have a HIPAA BAA?**

A: No. Keepance does not currently offer a HIPAA Business Associate Agreement. Healthcare-adjacent uses involving PHI are not a supported use case today.

---

**Q: Do you have a penetration test report?**

A: No. We have not commissioned an independent third-party penetration test. The source code is open at [github.com/keepance/keepance](https://github.com/keepance/keepance) and can be reviewed directly by your security team.

---

**Q: Are you on any approved-vendor lists?**

A: Not currently. If your organization maintains a vendor approval list and you want to start the process, email [security@keepance.com](mailto:security@keepance.com).

---

## Email and imported data

**Q: If I import email, where is it stored?**

A: Imported email is stored encrypted at rest on the user's device. Email is never routed through a Keepance server. Search is performed locally. No email content is uploaded to Keepance or to any third party by Keepance.

---

**Q: Who can see imported email?**

A: Only the user, on their machine. Keepance does not have access to the user's email account or imported email content.

---

## Incident response

**Q: What is your incident response process?**

A: In the event of a breach of Keepance infrastructure (license server, web demo proxy, update server), we would notify affected users by email within 72 hours of confirmed breach, describe what was accessed, and advise on any action needed. Because workspace data is not on Keepance servers, a Keepance server breach does not expose workspace content. We do not have a published incident response policy document yet.

---

## Open source

**Q: Is the source code auditable?**

A: Yes. Keepance's source code is open at [github.com/keepance/keepance](https://github.com/keepance/keepance). Your security team can review the full codebase, including how keys are stored, how AI calls are made, and what data is written to disk.

---

## Contact

Security questions or vulnerability reports: [security@keepance.com](mailto:security@keepance.com)
DPA and legal questions: [legal@keepance.com](mailto:legal@keepance.com)
