# Keepance Onboarding Journey — Build Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **For Jameson:** Read **Part A** to approve the experience (the words, the pictures, the feel). Part B is the technical build for the engineers and Codex. You only need Part A to say "yes, build this" or "change this."

**Goal:** Replace Keepance's static, drop-off-prone first-run setup with one flowing, animated "journey" that teaches a complete beginner what Keepance is and how AI works inside it, using simple metaphor pictures, while getting them fully set up.

**Architecture:** A new event-driven "journey engine" (advances when the user acts, not on a timer) renders eight chapters. Each chapter pairs a metaphor animation (built with Jameson's proven lightweight React + CSS "house technique," no heavy animation library) with a real setup action that resolves the metaphor into the actual Keepance UI. Built on the existing `src/ui/kp` design system and brand tokens; reuses the existing good AI-setup pieces (key tester, provider tutorials, mail connectors, data-map dialog).

**Tech Stack:** React 19 + Vite + Tailwind v4 + TypeScript (Tauri desktop app). CSS `@keyframes` + transitions for motion (matches the marketing-site technique). `tailwindcss-animate` (already present). No new heavy animation dependency by default. Existing services: `KeychainService`, `providerFactory`, `OllamaProvider`, RAG model download, mail connectors.

## Global Constraints

- **No new heavy animation library by default.** CSS-first, matching the Healthful/BehaviorUX house technique. `framer-motion` may be added ONLY if a specific transition is impractical in CSS, and only with an explicit note in the task. (Keepance's repo rule is "no new libs.")
- **Light theme only.** Build on existing brand tokens in `src/styles/globals.css` (`--kp-navy`, `--kp-pink`, `--kp-blue`, `--kp-grad`).
- **On-screen copy rules:** plain language a non-technical person can follow; define any term the first time it appears; **no em dashes in any on-screen string** (use periods/commas); no jargon, no file paths, no code shown to the user.
- **Accessibility:** fully keyboard navigable; respect `prefers-reduced-motion` (static "final frame" per chapter); each metaphor scene carries `role="img"` + one plain `aria-label` describing the idea, inner decorative DOM `aria-hidden`.
- **Local-first, always.** Nothing in the journey sends file content or questions anywhere. Copy must stay truthful about this.
- **Cross-platform build.** Must compile for Windows, Mac, Linux. Keep any build/prebuild scripts cross-platform (the Windows signed build breaks on Unix-only shell steps; use `scripts/copy-build-assets.mjs` style cross-platform scripts).
- **Skippable + replayable.** A quiet "Skip setup" is available on every chapter (with a gentle confirm). The whole journey is replayable later from Settings/Help.
- **Build the heart first.** Even though we are planning the whole thing up front, the build sequence starts with the engine + Chapter 5 ("Choose your brain") so the riskiest, highest-value piece is proven before the other seven are stamped out.

---

# PART A — The Experience (read this to approve)

## The one-line vision

> A single, flowing, animated onboarding journey that teaches a complete beginner what Keepance is and how AI works inside it, using simple, charming metaphor pictures (a house for your files, a brain you plug in, a paper plane for your questions), while quietly getting them fully set up along the way.

## The five locked decisions

1. **Scope:** explain all of Keepance and how AI works, not just the AI-choice screen.
2. **Structure:** one woven journey, where learning and doing blend together.
3. **Visual style:** a "metaphor world" of simple shapes, which resolves into the real app whenever it is time to actually do something.
4. **Sound:** on-screen words, no voice (we keep an "add narration" option for later).
5. **Completeness:** the full eight-chapter version, with email and firm setup woven in too.

## The visual language (our metaphor dictionary)

Every picture in the journey is built from the same small, consistent set of shapes, so the story feels whole. Same family as the animations already on your sites: lightweight, hand-built, on-brand.

| Idea | Picture |
|---|---|
| Your computer / your private space | a warm little **house** |
| Your files and documents | **papers** that float in and settle inside the house |
| Privacy / it stays put | a **lock** that clicks shut on the house |
| The AI | a glowing **brain** you "plug in" to an empty socket on the house |
| An AI company's servers | a **cloud** floating far away |
| A cloud AI ("your own account") | the brain lives in the cloud; your question flies up to it and back |
| A home AI ("local model") | the brain sits **inside** the house; your question never leaves |
| Your question | a **paper plane** (or envelope) |
| Your account key (the secret code) | a small **key** that locks your paper plane to your own brain, and only yours |
| Citations (sources) | little **receipt tags** pinned to each answer, pointing back to the exact page |
| The private search setup (the 465 MB download) | the house quietly **organizing its own filing cabinet** so it can find things fast |

The mood: calm, warm, premium, your pink-to-blue gradient. Never childish, even though it is simple. Think "a tasteful picture book for grown-ups," not "a cartoon."

## How a chapter works

Every chapter does two things at once: it **shows a little picture that teaches one idea**, and it **lets you do one real thing**. When it is time to do the real thing (pick a folder, paste a key, connect email), the metaphor shapes gracefully dissolve into the actual Keepance controls, so you never feel a jarring switch between "the cute intro" and "the real app." They are one thing.

A slim progress strip shows the eight chapters so people know where they are and that there is an end. A quiet "Skip setup" sits in the corner the whole time.

---

## The eight chapters (with the actual on-screen words)

### Chapter 1 — Your private workroom

**Teaches:** what Keepance even is.
**Picture:** on a soft gradient, a little house fades in with a warm light on. A few papers drift in and settle inside it. A lock clicks shut. Calm, one breath.
**Words on screen:**
- Title: **"Welcome to Keepance."**
- Body: "A private workroom where powerful AI helps with your real work, and nothing ever leaves your computer."
- Small: "Let's set it up together. It takes about three minutes."
- Button: **"Start"**
**You do:** just press Start. ("Skip setup" available.)

### Chapter 2 — A bit about you

**Teaches:** nothing heavy; this personalizes everything after it.
**Picture:** the house gets a small nameplate by the door.
**Words on screen:**
- Title: **"What kind of work do you do?"**
- Body: "So Keepance can speak your language."
- Choices (cards): "Legal practice", "Tax and accounting", "Consulting and strategy", "Financial advisor or wealth", "Something else."
- Then: **"What should we call you?"** with a name box and an optional photo.
- Small under the name: "This is just for your own sidebar. It stays on your computer."
- Button: **"Continue"**
**You do:** pick your kind of work (this quietly sets a sensible default AI for you later) and enter your name. The house nameplate updates to your name as a tiny delight.

### Chapter 3 — Your files stay home

**Teaches:** Keepance is "local-first," meaning your files live on your machine, not on our servers.
**Picture:** the house with your papers inside. A big cloud floats far away with a dotted line reaching toward the house, but the line stops short and a shield appears. The lock stays on. The point lands instantly: your stuff does not go up to the cloud.
**Words on screen:**
- Title: **"Your files stay home."**
- Body: "Most apps copy your work up to their servers. Keepance keeps your files right here, on your own computer. We never get a copy."
- Then: **"Where should Keepance keep your workspace?"** with real choices: "My Documents folder", "A synced folder (like Dropbox or iCloud)", "Choose another folder."
- If they pick a synced folder, a gentle note appears: "That works. Just know a synced folder copies files to that service too. Your most private work is happiest in a folder that stays on this computer."
- Button: **"Continue"**
**You do:** actually choose your real workspace folder. *(Fix: today these buttons look like they pick the folder but do not. We wire them up for real.)*

### Chapter 4 — Meet the AI brain

**Teaches:** what "the AI" actually is here, and the single most important trust idea: every answer shows its sources.
**Picture:** an empty socket appears on the side of the house. A glowing brain floats in and plugs in. A paper plane (a question) flies to the brain; an answer card floats back with little receipt tags pinned to it, and a faint line connects each tag back to a specific page in the papers.
**Words on screen:**
- Title: **"Meet the AI."**
- Body: "Think of AI as a brain you plug in. Keepance does not come with one. You choose yours, and you can change it any time."
- Second line: "Whatever you ask, the AI reads your own files to answer. And it always shows its receipts. Every answer points back to the exact page it came from, so you can check it yourself."
- Button: **"Show me my choices"**
**You do:** nothing yet. This is a pure "aha" beat that sets up the big choice next.

### Chapter 5 — Choose your brain *(the heart)*

**Teaches:** the three kinds of AI, where your questions go in each, what they cost, and how private each is. This is the exact screen people quit on today, so it gets the most care.
**Picture:** three gentle options, each with its own little animation:
1. **Cloud brain (your own account):** a paper plane flies from the house up to a cloud (labelled Claude / OpenAI / Gemini) and a cited answer flies back. A small key shows the plane is locked to you only. Caption idea: "goes straight there, we are never in the middle."
2. **Home brain (on your computer):** the brain sits *inside* the house; the paper plane bounces around inside and never leaves. Caption idea: "nothing ever goes out."
3. **Decide later:** a small clock; the house works fine without a brain plugged in.

**Words on screen (the choice):**
- Title: **"Choose your AI brain."**
- Body: "One short choice, and you're done. There is no wrong answer."
- Card 1 title: **"Use your own AI account"** badge: "Recommended for legal work"
  - "Connect your Claude, OpenAI, or Gemini account. Your questions go straight to them with your own key, never through us. Most solo users spend about two to five dollars a month, paid to the AI company, not to us."
- Card 2 title: **"Keep the AI on your computer too"** badge: "Most private. A bit less sharp for legal work."
  - "Run a free AI brain that lives entirely on your machine. Nothing is ever sent out, not even to an AI company. It works best on a fast computer, and we will set it up for you, no typing of commands."
- Card 3 title: **"Decide later"**
  - "Your files, templates, and workflows all work without an AI. You can connect one any time from Settings."

**You do:**
- **If "your own account":** pick a provider (Claude / OpenAI / Gemini). A friendly explainer says, in plain words, "You will copy a short code called an account key. It is like a password that lets your computer talk straight to the AI company. You make it on their site, paste it here once, and it is stored in your computer's secure keychain, never on a server." A button opens the provider's site. You paste the key, press "Test this key" (green check or a plain-English fix), then "Save and continue." *(We keep the existing key tester and per-provider step-by-steps, which already test well.)*
- **If "keep it on your computer":** *(Fix the dead-end.)* Instead of telling you to open a terminal and type commands, Keepance offers a **"Set it up for me"** button that downloads and installs the local AI tool and its model for you, with a friendly progress bar. If your computer already has it, we just say "Ready" and move on.
- **If "decide later":** we move on, and a gentle reminder will appear later so you can connect one when ready. *(Fix: this reminder exists in the code but is not currently shown. We wire it up.)*

**The 465 MB reassurance (folded in here):** right as this chapter wraps, a calm aside appears so the big background download never feels scary:
- "One more thing, and it is good news. Keepance is quietly building a private search index of your files, a one-time setup of about 465 MB, so it can find anything in a blink. Like the AI, this happens on your computer and never leaves it."
- Pictured as the house tidying its own filing cabinet. *(Fix: today this download happens silently with no explanation right when we have promised "nothing leaves your computer.")*

### Chapter 6 — Bring in your email (optional)

**Teaches:** Keepance can read and search your email privately, right next to your files.
**Picture:** an envelope flies into the house and files itself neatly among the papers. The lock stays on.
**Words on screen:**
- Title: **"Bring in your email (optional)."**
- Body: "Keepance can read and search your email right alongside your files, all on your computer. No more fighting with slow inbox search."
- Choices (tabs): "Microsoft 365", "Gmail", "Other (IMAP)."
- Button: **"Connect later"** (always available)
**You do:** connect an account (opens a secure sign-in) or skip. *(Reuses the existing mail connectors.)*

### Chapter 7 — Just you, or a team?

**Teaches:** Keepance can be solo or shared across a firm, with a shared locked vault.
**Picture:** one house, then a few houses on a shared street with a single shared lockbox between them (the encrypted firm vault).
**Words on screen:**
- Title: **"Just you, or a team?"**
- Choices: "I work solo", "Create a firm", "Join a firm" (with an invite code box).
- Small: "You can change this any time."
- Button: **"Continue"**
**You do:** pick one; create or join a firm, or continue solo.

### Chapter 8 — See it work, you're set

**Teaches:** the payoff. The metaphor world fully becomes the real app, and you watch a real, cited answer appear.
**Picture:** the shapes resolve into the actual Keepance screen. A sample question is asked and a cited answer appears, receipts and all.
**Words on screen:**
- Title: **"You're set."**
- Toggle: "Add a sample case so I can try things before using real client work."
- Recap (small, calm): "Your files stay on your computer. Every answer shows its sources. You are in control."
- Button: **"Open the sample case"** (or **"Create my first matter"** if they declined samples).
**You do:** finish. The journey marks itself complete and drops you into the real app, ready to go.

---

## The fixes we fold in along the way

1. **The home-AI dead-end is gone.** No more "open a terminal and type a command." Keepance sets up the local AI for the user with a one-click button and a progress bar (Chapter 5).
2. **The 465 MB download is explained, not silent.** It becomes a reassuring beat in the story instead of a scary surprise (Chapter 5).
3. **The folder buttons actually work.** Choosing where your workspace lives really sets the folder now (Chapter 3).
4. **The "no shame, decide later" reminder actually shows up.** People who skip the AI step get the gentle nudge the code already promises but never displays (Chapter 5 follow-through).
5. **No more repeated, identical headers** that made it feel like the screen did not change.

## What stays the same (good things we keep)

- The genuinely nice plain-English explanations already written (the "what is an account key" callout, the per-provider step-by-steps, the privacy "data map").
- The key tester that turns a pasted key green when it works.
- The honest, calm voice about cost and privacy.

---

# PART B — The Build (for engineers and Codex)

## File structure

New feature module (feature-first layout, per `ARCHITECTURE.md`):

```
src/features/onboarding-journey/
  JourneyHost.tsx              # mounts the engine, owns completion + skip + replay
  engine/
    useJourney.ts              # event-driven step machine (advance on action, optional idle nudge)
    types.ts                   # Chapter, ChapterContext, JourneyState interfaces
    progress.ts                # chapter ordering + progress calc
  scenes/                      # the metaphor "world" — reusable animated primitives
    House.tsx  Papers.tsx  Lock.tsx  Brain.tsx  Cloud.tsx
    PaperPlane.tsx  KeyShape.tsx  ReceiptTag.tsx  FilingCabinet.tsx
    sceneKeyframes.css         # CSS @keyframes (caret, ripple, pop, glide, drift)
    reducedMotion.ts           # static "final frame" helpers
  chapters/
    Ch1Welcome.tsx
    Ch2AboutYou.tsx
    Ch3FilesStayHome.tsx
    Ch4MeetTheAI.tsx
    Ch5ChooseYourBrain.tsx     # the heart — built first
    Ch6Email.tsx
    Ch7SoloOrFirm.tsx
    Ch8SeeItWork.tsx
  copy/strings.ts              # ALL on-screen copy in one file (single source of truth, easy review)
```

Reused as-is or lightly adapted (do NOT rebuild):
- `src/features/onboarding/ApiKeyTester.tsx`, `ProviderTutorialSteps.tsx`, `ApiKeyExplainer.tsx`
- `src/features/onboarding/useProfessionCopy.ts`
- `src/features/settings/MailConnect.tsx`, `MailGmailConnect.tsx`, `MailImapConnect.tsx`
- `src/platform/privacy/ui/DataMapDialog.tsx`
- `src/platform/providers/*` via `providerFactory.ts`; `KeychainService.ts`
- `src/platform/rag/ui/ModelDownloadCard.tsx` (its download logic; we reframe the surface)
- `src/ui/kp/*` design system + `src/styles/globals.css` tokens

Retired at the end: `src/features/onboarding/GuidedOnboarding.tsx` (current live flow) and the dead `FirstRunWizard.tsx`.

## The journey engine (the one genuinely new piece)

The marketing-site technique is a *timer-driven, non-interactive* playback engine. Onboarding is the opposite: it must wait for the user to act. So we keep the house technique's **CSS motion primitives and metaphor-render style**, but replace the timer driver with an **event-gated step machine**.

```ts
// engine/types.ts
export interface ChapterContext {
  advance: () => void            // chapter calls this when its action is satisfied
  goBack: () => void
  skipAll: () => void
  setData: (patch: Partial<JourneyData>) => void
  data: JourneyData              // profession, name, workspacePath, aiChoice, etc.
  reducedMotion: boolean
}
export interface Chapter {
  id: ChapterId
  title: string
  canAdvance: (data: JourneyData) => boolean   // gate Continue button
  render: (ctx: ChapterContext) => JSX.Element
}
```

`useJourney` holds current index, the accumulated `JourneyData`, and exposes `advance/goBack/skipAll`. No `setTimeout`-driven progression. Optional idle nudge timers are allowed per-chapter but never auto-advance.

Reduced motion: each scene component renders a static "final frame" when `reducedMotion` is true (no prerender machinery needed; this is a desktop app, not a crawled webpage).

## Verification approach

- **Engine + helpers:** unit tests (vitest) for `useJourney` (advance/back/skip/gating) and `progress.ts`.
- **Scenes:** render/snapshot tests + a reduced-motion render assertion.
- **Whole flow:** the existing "drive it like a user" playbook (`docs/quality/full-user-test-playbook.md`) on the Vite dev server, plus the AI-key live smoke where relevant.
- **Independent review:** `codex-task --read-only` reviews the engine + Chapter 5 before Jameson sees the prototype, and `codex-review` on the final diff. (Note: in this repo use `codex-task --read-only`, not `codex-review`, for investigation, per the testing-infra notes.)
- **Copy lint:** the repo's existing copy/fingerprint lint must pass; add a check that no on-screen string in `copy/strings.ts` contains an em dash.

## Tasks

### Task 1: Journey engine + host shell
**Files:** Create `engine/types.ts`, `engine/useJourney.ts`, `engine/progress.ts`, `JourneyHost.tsx`; Test `engine/useJourney.test.ts`.
**Produces:** `useJourney()`, `Chapter`, `ChapterContext`, `JourneyData`, `<JourneyHost/>`.
- [ ] Write failing tests: advance moves index forward; `canAdvance=false` blocks advance; skipAll sets completion flag; goBack never goes below 0.
- [ ] Run tests, verify they fail.
- [ ] Implement the engine + host (renders current chapter, progress strip, persistent "Skip setup" with gentle confirm).
- [ ] Run tests, verify pass.
- [ ] Commit.

### Task 2: Metaphor scene kit
**Files:** Create everything in `scenes/`; Test `scenes/scenes.test.tsx`.
**Produces:** `House, Papers, Lock, Brain, Cloud, PaperPlane, KeyShape, ReceiptTag, FilingCabinet`, each accepting a `reducedMotion` prop and exposing a stable `role="img"` + `aria-label`.
- [ ] Write failing tests: each scene renders; reduced-motion variant renders the static final frame; aria-label present.
- [ ] Run, verify fail.
- [ ] Build the shapes with CSS/SVG, reusing the house-technique primitives (glide via `left/top` %, never `transform`; caret/ripple/pop keyframes in `sceneKeyframes.css`).
- [ ] Run, verify pass. Commit.

### Task 3: Chapter 5 "Choose your brain" — the heart (built first)
**Files:** Create `chapters/Ch5ChooseYourBrain.tsx`, `copy/strings.ts` (seed with Ch5 copy); reuse `ApiKeyTester`, `ProviderTutorialSteps`, `ApiKeyExplainer`, `providerFactory`, `KeychainService`; Test `chapters/Ch5.test.tsx`.
**Consumes:** engine `ChapterContext` (Task 1), scene kit (Task 2).
- [ ] Write failing tests: three cards render; choosing "your own account" reveals provider pick + key flow; a passing key save calls `KeychainService.setKey` and advances; "decide later" sets the deferred flag and advances.
- [ ] Run, verify fail.
- [ ] Build the choice UI (kp components + tokens, NOT inline styles), the cloud-key sub-flow (reusing existing pieces), and the 465 MB reassurance aside.
- [ ] Run, verify pass. Commit.

### Task 4: Fix the home-AI dead-end (guided local setup)
**Files:** Modify `chapters/Ch5ChooseYourBrain.tsx`; add a Tauri command for guided install if needed under `src-tauri/src/commands/`; reuse `OllamaProvider` detect logic; Test for the install state machine.
**Detail:** Replace "open a terminal, run `ollama pull`" with a **"Set it up for me"** button: detect → if missing, download/install the local tool + pull the default model with a progress bar → "Ready." No terminal instructions surfaced to the user. If a true one-click install is not feasible on a platform, fall back to a guided installer download with progress, still no command typing.
- [ ] Write failing tests for the four states (checking / ready / installing-with-progress / error-with-plain-message).
- [ ] Run, verify fail. Implement. Run, verify pass. Commit.

### Task 5: Chapters 1–4
**Files:** Create `chapters/Ch1Welcome.tsx`, `Ch2AboutYou.tsx`, `Ch3FilesStayHome.tsx`, `Ch4MeetTheAI.tsx`; extend `copy/strings.ts`; for Ch3 wire the real workspace folder (reuse the real `WorkspaceSelector` mechanism, not cosmetic radios); Ch2 reuses profession-default logic.
- [ ] Per chapter: failing test for its action gate (e.g. Ch2 requires profession+name to advance; Ch3 actually sets `workspacePath`), fail, implement, pass, commit.

### Task 6: Chapters 6–8
**Files:** Create `chapters/Ch6Email.tsx` (reuse mail connectors), `Ch7SoloOrFirm.tsx`, `Ch8SeeItWork.tsx` (sample-files toggle + cited-answer demo that resolves scene into real app); extend `copy/strings.ts`.
- [ ] Per chapter: failing test, fail, implement, pass, commit. Ch8 must set `keepance_onboarding_complete`.

### Task 7: Skip reminder + replay entry point
**Files:** Wire `AiSetupReminder` to actually render for deferred users; add a "Watch the intro again" entry in Settings/Help that relaunches `JourneyHost`.
- [ ] Failing test: deferred flag causes reminder to mount; replay entry reopens the journey. Fail, implement, pass, commit.

### Task 8: Accessibility + reduced-motion pass
- [ ] Keyboard-navigate the whole flow; assert focus order and that every scene respects `prefers-reduced-motion`. Fix gaps. Commit.

### Task 9: Cutover + cleanup + docs
**Files:** Point `App.tsx` first-run mount at `JourneyHost`; remove `GuidedOnboarding.tsx` and dead `FirstRunWizard.tsx`; update `ARCHITECTURE.md` and the onboarding docs; refresh the relevant memory file.
- [ ] Swap the mount, delete dead flow, run full test suite + the user-test playbook, Codex review the final diff, fix wave, commit.

## Self-review notes (spec coverage)

- All 8 chapters → Tasks 3, 5, 6. ✅
- All 5 fixes → dead-end (T4), 465 MB aside (T3), folder wiring (T5/Ch3), skip reminder (T7), repeated headers (handled by distinct per-chapter titles in `copy/strings.ts`). ✅
- Reuse of existing good pieces → called out in Tasks 3, 5, 6. ✅
- Reduced motion / a11y → Task 8 + per-scene in Task 2. ✅
- Cutover without leaving two flows live → Task 9. ✅
