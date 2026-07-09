# User research — first-pass analysis (Fable)

*Source: three recorded clips of a practicing financial advisor (Jameson's wife, XYPN-network RIA) thinking aloud through the Advisor Prep Hero onboarding, 2026-07-08. ~49 min, ~7,600 words. This is our first real target-user session and it is unusually rich. **Confidential** — contains her firm's internal compliance situation; keep to the private reports page.*

## The single most important finding: her two-pillar mental model
Every software decision at her firm passes through **two gates, in order**:
1. **"Can we use it?"** — compliance. A hard, binary gate that comes *first*.
2. **"Is it useful?"** — product value. Only gets evaluated if #1 passes.

Her exact words: *"there's like two pillars… would it be useful, and can we use it… any software in this space would have to nail both."* Tonight was almost entirely pillar #1 — and it's the one we've been under-weighting. **She would have quit at the API-key screen** — not because the product was bad, but because she can't adopt anything without compliance sign-off.

## 🎯 The strategic bombshell: we are the answer to her #1 pain
Her lived reality, unprompted:
- *"It's part of my job to protect client information from going into ChatGPT. I don't even use clients' first names."*
- *"We've been using AI out of compliance… individual ChatGPT plans, just being careful… that's a no-no."*
- *"There's a huge gap — I feel like we could benefit from AI tools so much, but there are these blockers."*
- And when asked if a secure private AI would be valuable: *"Of course."*

**This is the whole thesis, validated by a real advisor who didn't know it was our thesis.** She is *desperate* for AI she's actually allowed to use with client data, and today she has none. Our local-first / nothing-leaves-your-machine / BYOK product is *precisely* that. We are not "another AI tool she can't use" — we're the first one she can. **That is the wedge, and it should be the headline.**

## Pillar 1 — Compliance: the blocker AND the GTM playbook (she handed us both)
How advisor software actually gets approved (these are the levers to pull):
1. **Herd safety is the #1 lever.** *"If a lot of other firms have adopted it, that really helps… you could tell the SEC, well everybody else is doing it."* There are **no explicit published SEC/FINRA rules for AI software** — approval is a black-box custom evaluation — which is *exactly why* social proof carries so much weight. → **Collect and flaunt adopting-firm logos; make herd adoption visible.**
2. **XYPN (XY Planning Network) is the master key.** Their RIA membership bundles vetted software; members trust that *"if XYPN recommends it, it would be shocking if it wasn't safe."* **Jump got in via XYPN — met them at an XYPN conference.** → **Getting on XYPN's recommended/partner list is likely our single highest-leverage GTM move.** Follow Jump's exact path.
3. **Microsoft-adjacency = instant trust.** *"Microsoft is secure, so anything in the Microsoft suite is fine."* → lean on our M365/OneDrive integration and Microsoft-grade security framing.
4. **Court the outside compliance consultants.** Firms outsource compliance to shops like **Synergy Compliance** and **XYPN's compliance service** — these consultants are the gatekeepers who say yes/no. Her literal suggestion: *"call them… 'I'm a software provider wanting to help advisors, what do I need to be compliant?' — I wonder if they just tell you."* → **Do exactly that.** We already drafted a security-posture doc for Schwab; it's 80% of a "compliance pack" for CCOs.
5. **The buyer is the firm, gated by a CCO** who can be *personally sued for negligence* — hence the fear. CCOs are risk-minimizers, often not tech-savvy, and move slow. → Make the CCO's job trivially easy: a one-page "what your compliance officer needs to know," data-flow diagram, SOC 2 status, and the herd/XYPN proof.

**Action items this surfaces:**
- Build a **"Compliance & Security pack"** aimed at CCOs (repurpose the Schwab security-posture doc).
- Pursue **XYPN** (approved list + conference presence) as priority #1 GTM.
- Open a conversation with **Synergy Compliance** and XYPN's compliance arm — ask them directly what software needs.
- Feature a **firms-using-us logo wall** the moment we have a few.

## Pillar 2 — Product & onboarding (confusion, all fixable)
- **The value prop doesn't land.** *"'A private AI that knows your clients'… I'm a little confused what exactly it's gonna do for me."* Advisors need to instantly categorize a tool: *"is it a CRM? is it replacing something? is it new?"* → **The intro must say, in one plain line, what it IS and what it replaces** (lead: "the private AI that replaces the ChatGPT you're not allowed to use — trained on your own client files, nothing leaves your machine").
- **The intro under-sells.** She wanted more explanation before the setup steps; she'd *"read every word"* of the tour (high intent). But she feared *"I won't be able to find this again"* → **make the tour re-accessible.**
- **An onboarding specialist is expected**, not optional. Software = sales → yes → a human who demos/trains (often a live call with the team). **Support quality is a named evaluation criterion** — her firm asks "what does support look like, how much turnover?" → we need a visible support story (help center, named contact, demos).
- **The local-vs-cloud framing slightly backfired.** Highlighting "local = completely secure, nothing leaves" made her distrust the *cloud* key she'd just set up (*"what am I signing up for on the other side?"*). → reassure that **both** paths are safe; don't accidentally frame cloud as the scary option.
- **Small but real nits:** call it **"ChatGPT," not "OpenAI"** (she doesn't connect the two); the offline/"no-wifi" icon read as *"something's broken"*; "vault encryption" and "SOC 2" earn trust but aren't understood (*"I know that's good but don't know what it is"*) — keep them, add a plain-language hover.
- **Connectors resonate** — she uses RightCapital, Jump, Holistiplan, DocuSign, and her CRM daily, and liked seeing them. But *"reads plan reports you export"* confused her: **they don't export plans; their notes live in the CRM.** → this validates the connector strategy — **meet advisors where their data actually is (the CRM), not where we assume it is.**

## Positioning: the one-line reframe
Today we say *"a private AI that knows your clients."* After this session, the sharper line is:

> **"The AI you're actually allowed to use with client data. It lives on your machine, learns your whole practice, and answers with citations — nothing ever leaves your computer."**

That leads with compliance (the first gate), names the enemy (ChatGPT-you-can't-use), and turns our architecture into the buying reason. Jump sends data to the cloud; we don't — against a compliance-terrified buyer, that's not a feature, it's the whole sale.

## Suggested next steps
1. **Reframe the hero + intro** around "the AI you're allowed to use," and answer "what is it?" in one line.
2. **Stand up the Compliance/Security pack** for CCOs (Schwab security doc → generalize).
3. **Prioritize XYPN** (approved list, conference) as the GTM wedge; study Jump's XYPN path.
4. **Reach out to Synergy Compliance / XYPN compliance** to learn the software-approval bar directly.
5. **Tomorrow's session (pillar 2):** as Jameson planned — pretend compliance is greenlit, give her the "this replaces Jump, better" pitch, and test the actual product value. This research says the compliance story is *solved by our architecture* — so pillar 2 is where the head-to-head-with-Jump product work matters.

*Caveat: single participant, and she's close to Jameson — directional, not statistical. But she is a genuine target user (XYPN RIA, uses Jump), and the compliance dynamics she described are structural, not personal. High-confidence on the compliance findings; treat the UI nits as strong hypotheses to confirm with more users.*
