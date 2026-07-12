# Cover Email For IT Vendor

Subject: Request to review Advisor Prep Hero for a small pilot

Hi [IT contact],

We are evaluating Advisor Prep Hero for a small advisor pilot. It is a desktop app for working with client documents and AI-assisted prep work.

The important point for review: it is local-first. Our files stay on the advisor's computer by default. Cloud AI is optional. If we start in Local-only mode, prompt content does not go to Anthropic, OpenAI, or Google.

I am sending this approval pack so you can review it:

- `ARCHITECTURE-ONE-PAGER.md`
- `DATA-FLOW.md`
- `SECURITY-POSTURE.md`
- `NETWORK-REQUIREMENTS.md`

Plain-English summary:

- The app runs on the advisor's computer.
- Documents live in a workspace folder chosen by the user.
- Secrets are stored in the operating system keychain.
- Local AI can run on the same computer.
- If cloud AI is approved, selected prompt content goes directly to the chosen provider, or through the firm's Assured proxy if we choose that setup.
- Firm shared workspaces send encrypted sync blobs to the relay. The relay is designed to see ciphertext, not readable client text.
- The product is not SOC 2 certified today. We are not asking you to treat it as certified.

For a cautious first pilot, I suggest we approve only:

1. The desktop app.
2. Local-only AI mode.
3. License activation and update checks.
4. Any one connector we actually need for the pilot, if any.

Could you please review and tell us:

1. Whether Local-only mode is acceptable for a pilot.
2. Whether you want cloud AI blocked at the network level.
3. If cloud AI is allowed, which provider account and policy we should use.
4. Whether our VPN or proxy will block the needed outbound HTTPS, WebSocket, or local loopback paths.
5. Whether you need a vendor questionnaire, DPA, or any other review material.

Thanks,

[Advisor name]
