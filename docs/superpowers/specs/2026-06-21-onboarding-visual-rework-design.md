# Onboarding Visual + Teaching Rework — Design Spec

**Date:** 2026-06-21
**Status:** Approved (brainstorm). Builds on the shipped journey (`feat/onboarding-journey`, PR #33).

## Why
Jameson reviewed the live journey and gave three pieces of feedback:
1. The animations aren't engaging enough.
2. The hand-built CSS/SVG visuals look amateur. Need professional-grade graphics. (Hard rule: Claude does NOT draw the assets.)
3. It doesn't actually TEACH what AI is or what the options MEAN — it just lists three choices.

## Decisions (locked via brainstorm)
1. **Graphics source:** curated professional **Lottie** animations (made by real motion designers), all in ONE cohesive style/palette matched to the Keepance brand. Not a mismatched grab-bag.
2. **Teaching style:** a short guided **animated lesson, then choose** — what AI is → where your question goes → the three paths compared → choose. Plainly demystify jargon ("an API key is just a password that lets your computer talk to the AI company"; "a local model is an AI that lives on your machine").
3. **Engagement:** quality animation + tight pacing + smooth transitions (a real motion library). Play-on-enter; no heavy interactivity required.
4. **Asset approval workflow:** Claude curates a cohesive shortlist per beat → Jameson approves/swaps on a board → only then integrate.
5. **Preview gate (added by Jameson):** every candidate animation must be rendered and verified to actually play + look good in a browser BEFORE it is presented or integrated.

## What stays vs changes
- **Stays:** the journey engine (`useJourney`/`JourneyHost`), the 8-chapter flow, the real setup wiring (saveApiKey/chooseWorkspaceFolder/setConfidentialityMode), skip/replay, the deferred-AI reminder, accessibility model, and the test suite. Not wasted.
- **Changes:**
  - Replace the hand-drawn scene kit (`scenes/*`) with a Lottie-based scene system.
  - Expand the teaching: the thin "Meet the AI" beat grows into a ~3-beat animated lesson before the choice.
  - Every chapter's scene becomes a curated professional animation (consistent style).

## Tech
- Add a Lottie player dependency (the standard `@lottiefiles/dotlottie-react` or `lottie-react`) and, if needed, `framer-motion` for transitions. This intentionally relaxes the journey's earlier "no new deps" rule — pro animation requires a real player. Keep bundles lean (lazy-load the player; `.lottie` dotLottie format where possible for size).
- New `LottieScene` component (replaces `SceneFrame` + hand-drawn shapes): plays a Lottie asset, honors `prefers-reduced-motion` (renders a static poster frame, not motion), carries `role="img"` + a plain `aria-label`. Assets stored in-repo (e.g. `src/features/onboarding-journey/assets/lottie/`), each with a recorded source + license.
- Reduced-motion, keyboard, and focus behavior carry over unchanged.

## The teaching lesson (content)
Three beats before the choice (replacing/expanding the current Ch4):
1. **What is AI here?** — a brain that reads *your* files and answers, always showing its sources. "A brain you plug in."
2. **Where does your question go?** — a question travels out to an AI company and back, vs. staying entirely on your computer. The key mental model behind the choice.
3. **Your three choices, compared** — your own account / on your computer / decide later, side by side on privacy, smartness, cost, effort; plain definitions of "API key" and "local model" here.
Then the existing choice screen (Ch5), now informed.

## Work order (quality locked before effort)
- **Phase A — Pipeline + board:** stand up the Lottie tooling + a preview/approval board; source cohesive candidate animations per beat; render + verify each plays and looks good; present the board to Jameson for approve/swap.
- **Phase B — Prototype 2 screens:** rebuild the lesson + the choice with approved assets; Jameson reviews the real feel.
- **Phase C — Roll out:** apply the approved look + the `LottieScene` system across all 8 chapters; remove the old hand-drawn scene kit; update tests/docs.

## Licensing
Prefer LottieFiles free assets (attribution where required) or low-cost licensed; record source + license per asset. No assets whose license forbids app use.

## Non-goals
- No bespoke commissioned art (separate budget decision).
- No change to the underlying setup logic or flow order.
- Claude does not hand-author illustrations/animations.
