# Advisor Prep Hero trust materials

These documents help a firm's IT, security, and compliance reviewers inspect Advisor Prep Hero's privacy and security posture. They describe the architecture and current readiness honestly. They are not certifications, audit reports, or legal advice.

## Core materials

- [Security overview](security-overview.md): how the local-first desktop product handles client work, AI requests, and device storage.
- [SOC 2 readiness](soc2-readiness.md): the current gap and readiness assessment. Advisor Prep Hero is not SOC 2 certified.
- [Intake IT Gatekeeper Pack](it-pack/INTAKE-IT-PACK.md): the separate secure-link intake architecture, relay metadata boundary, email-fallback boundary, and reviewer checklist.

## Using the Intake pack

Use the Intake IT Gatekeeper Pack when a firm is deciding whether to enable secure client or household intake links. It is deliberately separate from the desktop product overview because Intake has a hosted relay and a limited, disclosed metadata boundary. The relay cannot read submitted answers or files, but it does receive the routing and connection metadata listed in the pack. Email fallback is a separate, non-end-to-end-encrypted channel.

The same Intake summary and checklist are available in the app under **Security overview for your firm**, where they can be exported as a Word document or PDF for a reviewer.
