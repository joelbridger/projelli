# Onboarding & pitch reframe — "the AI you're allowed to use"

*Fable design, grounded in the 2026-07-08 advisor research (`docs/user-research/2026-07-08-wife-onboarding/ANALYSIS.md`). The old onboarding assumed the advisor already knew what the product was and led with a vague benefit. The research says: lead with the PAIN and the COMPLIANCE answer, name what it is in one line, and give her ammunition for her compliance officer. Build on a separate branch `feat/onboarding-reframe`; present the concept before it replaces anything.*

## The core reframe (the new pitch)
**Old hero:** "A private AI that knows your clients." → she was confused what it does.

**New hero, one line:**
> ## The AI you're actually allowed to use with client data.
> It lives on your computer, reads your whole practice — files, email, client notes — and answers with citations. Nothing ever leaves your machine.

Why this works (straight from the research):
- **Names the enemy:** the ChatGPT she's forbidden to put client data into. She instantly knows what problem this solves.
- **Answers "what is it?"** in one sentence (she couldn't tell if it was a CRM/replacement/new).
- **Leads with the first gate (compliance),** turning our architecture into the buying reason.
- It's the truth: our local-first design *is* the reason she can use it when she can't use ChatGPT.

## The narrative arc (5 beats)
The old flow: Intro → Choose start → Connect AI → Connect data → progress. Keep the *structure*, change the *story* so each beat answers a real question she asked.

### Beat 1 — Intro: name the pain + the answer (was: vague benefit)
- New headline (above) + the three flow cards reframed:
  1. **Connect your practice** (files, email, CRM) — *stays on your machine*
  2. **It builds a Client Map** for every household — *cited from your own records*
  3. **Ask anything** — *answers with sources you can open*
- Trust line, plain: "Your client data never touches our servers, the cloud, or any AI's training. Ever."
- **Re-findable:** a small "You can reopen this walkthrough anytime from Help" so she doesn't fear "now or never."

### Beat 2 — The compliance answer, up front (NEW beat — this is the wedge)
A short, prominent screen (or a strong panel) titled roughly **"Why you can use this when you can't use ChatGPT."** Plain language:
- Your files stay on your computer. The AI reads them locally.
- When you use a cloud AI, it's *your* account and *your* key — we never see your data, and the provider doesn't train on it.
- **The key CTA: "For your compliance officer →"** — opens/downloads the **Compliance & Security pack** (the CCO one-pager: data-flow, encryption, SOC 2 status, what to tell them). This is the single most valuable addition — it hands her exactly what she needs to get past gate #1, which is where she quit.
- This beat directly serves the two-pillar reality: it answers "can we use it?" before asking her to invest in setup.

### Beat 3 — Connect AI: bring your own, both paths private (fix the confusion)
- Reframe: **"Bring your own AI — your account, your key. We never see it."**
- **Name providers by consumer names:** "ChatGPT (OpenAI)", "Claude (Anthropic)", "Gemini (Google)". (She said "OpenAI, I don't think of that as ChatGPT.")
- **Don't make cloud feel scary.** The old copy highlighted local as "completely secure, nothing leaves," which made her distrust the cloud key she'd just set up. New framing: *"Either way, your client files stay on your machine. Cloud AI just means the questions go to your own AI account; Local AI means even that stays on your computer."* Both are safe; local is the maximum.
- **Fix the "offline" icon** that read as "something's broken" — use a clear "On device" / shield glyph, not a no-wifi symbol.

### Beat 4 — Connect data: meet them where the data actually is
- Real connector logos (M365, Gmail, OneDrive, Wealthbox — done) + Holistiplan/DocuSign/RightCapital/Jump as recognized sources.
- Fix the confusing "reads plan reports you export" — she said *"we don't export plans; our notes are in the CRM."* Reframe around the CRM + email + files as the primary sources (ties to the connector strategy: meet advisors where their data lives).
- Light compliance reassurance repeated at the connect step (she worried "is linking this okay?").

### Beat 5 — Progress + land in value
- The build/progress screen (kept) → land in a populated practice where she can ask a cited question in the first minute (the sample path).

## Copy principles (from the research)
- Plain, category-first: tell her *what it is* and *what it replaces* before benefits.
- Every security term she trusts-but-doesn't-understand (SOC 2, vault, encryption) gets a one-line plain hover — keep the trust signal, add comprehension.
- Set the support expectation: a visible "Need help? Book a setup call" (she expects an onboarding specialist; even a link signals it exists).

## What this reframe is NOT
- Not a visual overhaul — reuse the current onboarding shell + the design system. This is a *narrative + copy + one new beat (the compliance answer)* change, not a re-skin.
- Not a replacement of the reverted "liked" onboarding visuals — same look, new story.

## Build plan
1. Branch `feat/onboarding-reframe` off `lp/ux-simplify-v1`.
2. Rewrite the intro/AI/connect copy + add the Beat-2 compliance-answer screen with the "For your compliance officer" CTA (links to the compliance pack — see `docs/partnerships/`, which the SEC research will strengthen).
3. Fix the OpenAI→ChatGPT labels + the offline icon.
4. Present the concept (screenshots) to Jameson before it replaces the current onboarding.

## Dependencies
- The **Compliance & Security pack** (the CCO CTA target) is strengthened by the in-flight SEC/RIA compliance research (`coordination/reports/sec-ria-compliance-*.md`). Ship the reframe copy now; wire the pack as the research lands.
