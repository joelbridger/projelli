# Onboarding redesign — make "Advisor Prep Hero Local AI" the primary private path (Ticket 6, part 2)

**Date:** 2026-06-25 · **Status:** DRAFT PROPOSAL for Jameson to react to (not built). Design-sensitive — needs Jameson's calls on the marked decisions before any code.

## The problem (in plain terms)

We just shipped a real on-your-computer AI engine ("Advisor Prep Hero Local AI" — a model the app downloads itself, ~2.4 GB, zero network). But **onboarding doesn't know it exists.** Today, first-run's "keep everything private" path is built 100% around **Ollama** — a separate tool the user has to go install themselves before they can even continue. So the most private option is also the most annoying, and our own built-in private engine is invisible until the user digs into Settings later.

There's a second wrinkle: the local-model setup is **split across two screens** and they don't agree:
- A personal user first hits a **"Where your data goes"** choice (step 5/6): *Local-only (most private)* vs *Cloud (bring your own key)*. Picking **Local-only** just flips a switch and moves on — it never actually helps you set up a local model.
- A different screen (the AI setup step's "local" view) is the Ollama installer flow — but most personal users never even reach it because they already chose Local-only on the previous screen.

So a brand-new advisor who wants "private" ends up in Local-only mode with **no working model**, and no clear path to get one. That's the gap to close.

## What I'm proposing

Make **Advisor Prep Hero Local AI the front-and-center "keep everything private" choice** in onboarding, and demote the Ollama setup to an **Advanced** option for power users.

Concretely:
1. The **"Local-only / Most private"** choice in onboarding leads to a single, friendly **"Get Advisor Prep Hero Local AI"** step — one button, we download it for you in the background, no Ollama, no terminal commands.
2. The download is **non-blocking**: the user keeps going through the rest of onboarding while the model downloads (the app already has an app-wide progress banner for this). They land in the app private-by-default; the model finishes shortly after.
3. **Ollama moves to Settings → Advanced** (for the rare user who already runs their own local model and wants to point Advisor Prep Hero at it). It stops being the face of "private."
4. The marketing page `keepance.com/local-model-setup` gets repositioned: a new primary "Advisor Prep Hero Local AI (built in)" story up top, with the existing Ollama guide kept as the "advanced / bring-your-own" section. *(Do this after the feature ships, so the page doesn't promise something not yet downloadable.)*

## Decisions I need from you (this is the design-sensitive part)

**D1 — Does onboarding download the 2.4 GB model, or just set the choice and download later?**
My recommendation: **start the download in the background during onboarding** (non-blocking) so the user is ready to go almost immediately, instead of hitting "you have no model" the first time they try to chat. Alternative: just record the "private" choice and prompt for the download on the first chat. (I lean background-download-during-onboarding.)

**D2 — Primary copy + the honesty trade-off.** The current Ollama card says *"Maximum privacy. Less capable for legal work."* For advisors, I'd soften to something like: **"Private — runs entirely on your computer"** as the headline, with one honest line that the built-in model is great for finding and citing answers across your files, and you can switch to a cloud model anytime for the heaviest drafting. Do you want me to keep an explicit "less capable" warning, or frame it as "switch to cloud for heavy work" without the negative? (I lean the gentler framing — it's still honest.)

**D3 — Default selection.** Today **Cloud (bring-your-own-key)** is the visual default ("Recommended"). For a privacy-first product aimed at advisors, do we make **Advisor Prep Hero Local AI the recommended default**, or keep cloud as default and present local as the equal/privacy choice? (I lean: make local the recommended default for the privacy story, cloud clearly offered for users who want maximum capability. This is a brand/positioning call — your area.)

**D4 — The three-way vs two-way choice.** Right now it's Local-only / Cloud / Decide-later. With a built-in engine, I'd keep three: **Advisor Prep Hero Local AI (private)** / **Your own cloud key (most capable)** / **Decide later**. Confirm that's the shape you want.

## ⚠️ Important coordination issue (this changes the plan)

Another instance is **rewriting onboarding entirely** on a branch called `feat/onboarding-journey` — it **replaces** the current onboarding screens with a new "animated journey" and **deletes** the exact files I'd edit (`GuidedOnboarding.tsx`, `FirstRunWizard.tsx`). If we both build onboarding changes, they'll collide hard.

**Recommendation:** don't rebuild the onboarding *screens* here. Instead:
- Keep the local-AI piece as a small, reusable component (the "Get Advisor Prep Hero Local AI" step + the choice logic), and
- Coordinate so it gets dropped into the **new** animated journey, not the old screens we're about to delete.

This is exactly the kind of thing worktrees make visible (see the merge explainer). The safe move is to decide the design now (D1–D4), then implement the AI-setup piece against whichever onboarding wins — ideally after, or in lockstep with, the animated-journey work.

## What's already done vs. not
- **Done (shipped):** the engine, the in-chat picker, the Settings "Download Advisor Prep Hero Local AI" control, the app-wide progress banner. So the building blocks for the onboarding step already exist and are tested.
- **Not done (this proposal):** the onboarding screens themselves, the Ollama→Advanced move, the website reposition. Held pending D1–D4 + coordination with `feat/onboarding-journey`.
