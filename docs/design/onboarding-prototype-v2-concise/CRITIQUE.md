# Onboarding v2 — the concise cut (4 screens). What changed and why.

**Live to compare:**
- v2 (this draft, 4 screens): **http://100.68.20.52:8903/**
- v1 (the 12-scene version, still running): **http://100.68.20.52:8902/**

Screenshots of every v2 screen are in `keepance-coordination/ux-audit/onboarding-v2/`.

---

## The one idea behind this rewrite

The old onboarding had **12 screens, and 9 of them only talked.** They explained Advisor Prep Hero.
You read, you clicked Continue, you read more. By the time you actually *did* anything, you
were eight screens deep.

v2 flips that. **One screen sets the hook, then every screen after it asks you to do one real thing.**
Explaining is folded *into* the doing, as a sentence or two right next to the buttons, instead of
living on its own slide. The result is 4 screens: 1 intro + 3 actions.

A good test for any screen: *"If I delete this, does the person lose something they need to act?"*
The 8 screens I cut all failed that test. They were nice to know, not need to know.

---

## The 4 screens, and the single job each one does

| # | Screen | Its one purpose (the only reason it exists) |
|---|--------|---------------------------------------------|
| 1 | **Intro** ("A private AI that actually knows your clients") | Make you want the next three steps in one breath: it knows your clients, every answer is cited, and your data stays yours. |
| 2 | **Power your AI** | Get you set up with intelligence, your way: paste your own AI key, or run the AI on your own computer. Two options, shown as equals. |
| 3 | **Connect your clients' world** | Point Advisor Prep Hero at the data it should read (files, email, Wealthbox) so its answers are about *your* clients, not nothing. |
| 4 | **Ask your first question** | The payoff. One click on a sample client returns a real answer with sources you can open. You feel the value before you've done any work. |

---

## What I cut from the 12, and why

I sorted the original 12 into three buckets: **kept**, **folded** (its one good point moved into a
surviving screen), and **cut** (it was teaching, not doing).

| Original screen | Fate | Why |
|---|---|---|
| 1. welcome | **Folded → Intro** | Kept the logo + one-line hook + the 3 value pills. |
| 2. clients ("knows the household") | **Folded → Intro + Screen 4** | The promise moved to the intro sub-line; the *proof* of it became the live answer on Screen 4. |
| 3. advisors (who it's for) | **Cut** | A person installing Advisor Prep Hero already knows they're an advisor. Telling them who it's for is a marketing-page job, not a setup job. |
| 4. ecosystem (8 partner logos) | **Folded → Screen 3** | The logos now sit on the *connect* screen where they're an action ("connect this"), not a poster. The 5 we don't connect yet show small as "also reads across." |
| 5. teach1 ("AI isn't scary") | **Folded → Screen 2 sub-line** | Its one real point ("the only thing that matters is where the data goes") is now a single sentence above the two choices. |
| 6. teach2 (two safe ways) | **Folded → Screen 2** | This *is* Screen 2 now, except you pick instead of read. |
| 7. teach3 (BYOK explained) | **Folded → Screen 2, card 1** | The explanation is the card's two-line body, read only if you're hovering that option. |
| 8. teach4 (local model explained) | **Folded → Screen 2, card 2** | Same: the explanation lives on the card you're considering. |
| 9. choose (pick a mode) | **Merged with teach2/3/4 → Screen 2** | The old flow *explained* on 4 screens then *asked* on a 5th. That's the core waste. Now explaining and choosing are the same screen. |
| 10. email (bring in email) | **Folded → Screen 3** | Email is just one of the things you connect. It became one tile of three, not its own screen. |
| 11. team (solo or firm) | **Deferred to after onboarding** | A solo advisor (our main user) doesn't need a firm decision to get value. Asking on day one adds a fork in the road before they've seen anything work. Surface it later, in-app, when they invite someone. |
| 12. done | **Replaced by Screen 4** | The old ending just said "you're set." The new ending *shows* you're set by answering a real question with citations. A payoff beats a pat on the back. |

**Net:** 12 → 4. Nothing of value was thrown away; the teaching was compressed into microcopy that
sits next to the relevant action.

---

## The honesty fix (you flagged this, and it was right)

The old welcome said: *"Everything stays on your computer, never in someone else's cloud."*
That isn't literally true once you use your own AI key or connect Outlook/Wealthbox, so I removed it.

The precise, always-true version is now split across the flow:
- **Intro pill + sub-line:** "Your data stays yours" + "Your questions go to the AI you pick, never through Advisor Prep Hero."
- **Screen 2, card 1 (your own key):** "Your questions go straight to your provider with your own key. They never pass through Advisor Prep Hero."
- **Screen 2, card 2 (on your computer):** "Your client data never leaves it, not even to an AI company."

So instead of one sweeping claim that breaks, each mode states exactly what happens to the data.
No "compliant," no "guaranteed," no em dashes in any user copy. (Verified by search across the build.)

---

## Two design calls worth your eye

1. **No "recommended" on Screen 2.** You decided this, and I built it straight: the two options are
   the same size, same weight, no badge on either. Selecting one reveals its next step inline (paste a
   key, or download the model). "I'll decide this later" is a quiet third path so nobody gets stuck.

2. **Screen 4 uses a clearly-labelled "SAMPLE CLIENT."** Since a brand-new user has no data connected
   yet, the aha moment runs on a built-in sample household (Hendricks) so the answer + citations are
   real and clickable, not a fake-looking placeholder. The badge keeps it honest.

---

## Open questions for you (where I'd want your gut)

1. **Is the intro doing too much or too little?** It now carries the work of 4 old screens. It feels
   right to me, but you may want the "built for advisors" idea back as a fourth pill.
2. **Screen 2 reveal:** selecting an option expands the card to show the key field / download button.
   Do you want that inline, or should picking an option just advance and ask for the key on its own beat?
3. **Should "Ask your first question" be skippable?** Right now Skip jumps straight to it (skipping
   *to* the payoff, which I think is good). But a user who connected real data might want to ask about
   a real client, not the sample. Worth a toggle later.
4. **Team/firm:** I deferred it entirely. Confirm you're happy surfacing it later in-app (e.g. the
   first time someone clicks "share" or "invite"), not in first-run.
