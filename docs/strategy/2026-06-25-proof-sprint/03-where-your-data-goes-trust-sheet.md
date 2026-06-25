# Where your client data goes (and where it doesn't)

**Keepance privacy and security overview, for financial advisors and their compliance teams.**

*This is a plain-language summary of how Keepance handles data. Every claim below reflects how the app actually works today. We would rather tell you straight than over-promise.*

---

## The short version

Keepance runs on your own computer. Your client files, the search index it builds, and the "Client Map" it creates all stay on your machine. Nothing about your clients is stored on a Keepance server. The only time your client information leaves your computer is when you choose to use a cloud AI, and in that case it goes straight from your computer to the AI provider on your own account, not through a Keepance server.

*(This sheet describes the two ways a solo or small-firm advisor runs Keepance: fully on your own machine, or with your own AI key.)*

## What stays on your computer

- **Your files and notes.** They remain ordinary files in a folder you choose. Keepance does not upload or sync them anywhere.
- **The search index.** Keepance reads your documents and builds a private search index on your machine so it can find things fast. That index, and the AI "embeddings" behind it, are created on your computer and stored on your computer.
- **The Client Map.** The profile Keepance builds for each client household lives in the app on your machine.
- **Your sensitive data is encrypted on your machine.** The optional secure vault, your imported email, the activity log, and the readable text inside the search index are locked with strong, industry-standard encryption (AES-256), with the keys held in your operating system's secure keychain (not in a file someone could copy). Your ordinary working files and the Client Map also stay on your computer; like the rest of your documents they're protected by your device's own security, and you can place anything especially sensitive inside the encrypted vault.

## The one thing that can leave: the AI

This is the part advisors and compliance teams care about most, so here it is clearly. Keepance gives you two ways to run the AI:

1. **Local mode.** The AI runs entirely on your own computer (using a local model). In this mode, **nothing leaves your machine at all.** No internet connection is used for the AI.

2. **Bring-your-own-key mode.** You connect your own account with an AI provider (such as Anthropic, OpenAI, or Google) using your own key. When you ask a question, the relevant text is sent **directly from your computer to that provider**, on your account, to get the answer. It does **not** pass through any Keepance server. We never see it.

In bring-your-own-key mode, the AI provider you chose does see the text of your question (this is true of any cloud AI). Because it is your own account, you control that relationship, and most providers offer settings so your data is not used to train their models. If you want zero data to leave your machine, use Local mode.

## What Keepance (the company) can and cannot see

**We cannot see:** your client documents, your emails, the questions you ask, the answers you get, your file names, or your clients' names. None of that ever reaches us.

**The only routine connections the app makes to us are:**
- **A license check** to confirm your subscription. It sends your license key, a machine identifier, and the app version. It contains **no client data**.
- **A software-update check**, which reads a public release list (hosted on GitHub) to see if a newer version exists. It contains **no client data**.

**Optional and off by default:** basic usage counts and an opt-in diagnostics channel for design partners. Both are turned off unless you choose to turn them on, and neither carries any of your content.

## Your email connections

When you connect Microsoft 365, Gmail, or another mailbox, Keepance talks **directly** to your email provider from your computer. Your email does not route through any Keepance server.

## For your compliance officer

Keepance is designed so that **client data stays under the advisor's control.** Practically, that means:
- There is no Keepance cloud holding your clients' files, so there is one fewer outside vendor to vet, monitor, and worry about under data-protection rules such as Reg S-P.
- Data is encrypted at rest, and team collaboration (on the Firm plan) is end-to-end encrypted, meaning even the connection point that passes edits between teammates only ever sees scrambled data and never holds the key.
- You decide whether AI runs fully on-device or through your own provider account.

We are happy to complete your firm's vendor or security questionnaire and to walk your compliance team through any of the above.

## What we don't have yet (so you hear it from us first)

We are an early-stage company, and we will not claim certifications we don't have:
- **We are not SOC 2 certified yet.** We have done the readiness work and can share our security design and roadmap.
- **We do not yet have a lawyer-reviewed, signed data-processing agreement.** We have a draft in progress that still needs legal review before we can use it, and we are glad to work toward a signed agreement before you onboard if your firm requires one.
- We can answer security and recordkeeping questions directly while these formal artifacts are in progress.

We would rather earn your trust with a straight answer than lose it with an exaggerated one.

## Questions

Reach out any time and we will walk you or your compliance team through exactly how your data is handled.

---

*Internal note (STRIP THIS before sending to any customer): claims here were verified against the app's source code on 2026-06-25 and then corrected after an independent Codex over-claim review (see `docs/trust/security-overview.md` and the data-flow verification in this proof-sprint folder). The scope is deliberately limited to Local mode and bring-your-own-key mode; the Firm-tier managed-AI path is out of scope and must be described separately if it is ever used. Do not add claims about SOC 2, a signed DPA, a penetration test, a formed legal entity, or an audited inference proxy until they are actually true. Per the project's no-em-dash rule for customer-facing copy, this document uses none.*
