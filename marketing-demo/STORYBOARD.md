# Keepance — Product Demo Video Storyboard

**Goal:** A polished 60–90s MP4 that makes Keepance look like a working Windows app for a
**financial advisor**, to validate demand ("would you pay for this?"). Demo data + scripted AI
responses are intentional. Target length: **~69 seconds**.

> **2026-06-29 re-cut:** the onboarding section (Scene 2) is now the **REAL full-screen
> onboarding-journey** (`JourneyHost`), driven live — not a simulated modal. The old simulated
> welcome / connect-AI / connect-data modals (former Scenes 2–4) are replaced by one onboarding
> scene that mounts the genuine first-run experience. Everything else (cold open, Client Map, Ask,
> closing) is unchanged.

**Hero client:** the **Webb Household** (canonical demo client). Story spine: an advisor has a
client whose context is scattered; Keepance pulls it into one cited Client Map, and the AI
catches a **stale beneficiary** on an old 401(k) that still names Marcus's ex-wife, Jessica Reyes.

**Visual language:** real Keepance light theme. Navy `#0a2540`, accent blue `#1f74c4`, Satoshi
font, calm professional SaaS feel. Smooth animated cursor, real typing, realistic loading,
subtle fades. No cartoon motion, no startup fluff. Looks like an app an advisor could use tomorrow.

**What's real vs simulated** (see README for the honest boundary):
- **REAL UI, driven live:** the app shell (top bar + sidebar tabs Client Map · Ask · Workflows),
  Scene 2 (the **onboarding-journey** `JourneyHost`, full-screen), Scene 5 (Client Map) and
  Scene 6 (Ask) — the actual React app, the actual components.
- **Scripted/simulated, demo-only (styled with the app's own design tokens so it looks native):**
  the cold open, the closing card, and the Ask answer/email content. The AI answers are scripted
  (Playwright intercepts the AI request).

---

## Frame & timing

- Resolution: **1280×800**, deviceScaleFactor 2 (renders at 2560×1600, crisp).
- Final encode: H.264 / yuv420p, 30 fps, MP4.
- One continuous Playwright recording (no concat seams); scenes flow via short cross-fades.
- An injected animated cursor is present in every scene (Playwright's real cursor isn't captured).

| # | Scene | Length | Cumulative |
|---|-------|-------:|-----------:|
| 1 | Cold open / the pain | 4s | 4s |
| 2 | **Real onboarding** (Welcome → Files → Meet the AI → Choose your AI / BYOK) | 23s | 27s |
| 5 | The Client Map appears (the aha) | 16s | 43s |
| 6 | Ask — cited answer + drafted email | 21s | 64s |
| 7 | Closing | 4s | 69s |

Scenes are numbered 1, 2, 5, 6, 7 (the old simulated Scenes 3–4 are folded into the real
onboarding in Scene 2). Lengths are the measured render times of the current cut.

---

## Scene 1 — Cold open / the pain  (0:00–0:06)

**On screen:** a calm dark-navy title card. A faint scatter of small document/email/note cards
drifts in the background (slightly disordered, low opacity), suggesting scattered context.

**Caption (fades in, centered, Satoshi):**
> Client context is scattered across files, emails, notes, and old conversations.

Then, smaller, beneath:
> You're the one holding it all together.

**Motion:** cards drift; caption fades in over ~1.2s, holds, then the whole card fades to white as
Scene 2 begins.

---

## Scene 2 — Real onboarding (the full-screen first-run)  (0:04–0:27)

**On screen:** the **genuine** Keepance onboarding-journey (`JourneyHost`), full-screen, light
theme — the real component, not a mock. It mounts over the running app and the demo cursor clicks
its real buttons. A tight, cinematic 4-chapter cut (the full first-run has 8 chapters; we show the
strongest four, in an order whose buttons lead into the next screen):

**2a — Welcome (≈3s):**
- Title: **Welcome to Keepance** · *A private workroom where powerful AI helps with your real
  work. Nothing ever leaves your computer.* · button **Start**.

**2b — Your files stay home (≈4s):**
- Title: **Your files stay home** · *Most apps copy your work to their servers. Keepance keeps your
  files on your own computer.* The cursor clicks **Choose a folder**; a path appears
  (`C:\Users\Advisor\Keepance\Clients`); **Continue** enables and is clicked. (The folder pick is
  stubbed for the film — no real folder is opened.)

**2c — Meet the AI (≈4s):**
- Title: **Meet the AI** · *Think of AI as a brain you plug in… Whatever you ask, the AI reads your
  own files to answer. And it shows its receipts.* · button **Show me my choices**.

**2d — Choose your AI → Connect your account (≈7s):**
- **Choose your AI** — three cards (use your own AI account / keep it on your computer / decide
  later). The cursor picks **Use your own AI account**, opening:
- **Connect your account** — the real BYOK screen: provider tabs **Claude / OpenAI / Gemini**, a
  "What is an API key?" explainer, a step-by-step get-your-key tutorial, and the key field
  (`sk-ant-api03-…`). This is the genuine "bring your own key, it never leaves your machine" beat.
  (No key is typed; the screen is shown, then a navy wipe hands off to Scene 5.)

> The journey is mounted by `src/dev/DemoJourneyOverlay.tsx` (dev-only) and driven by
> `marketing-demo/render/onboardingScene.mjs` via `window.__kpJourney`. The on-screen copy is the
> product's own; side-effects (key save, folder pick) are stubbed for the film.

---

## Scene 5 — The Client Map appears (the aha)  (0:27–0:43)

**On screen:** the REAL Client Map for the Webb Household, fully populated, cited. This is the
payoff — it should feel like the scattered context just snapped into one organized, source-backed page.

- Header: **Webb Household** · *Comprehensive financial planning + ongoing investment management.*
- Sections scroll past smoothly (cursor/scroll):
  - **People** — Marcus Webb (38), Tanya Webb (37), Caleb (8), Ava (5).
  - **Goals** — Retire at 60 · Fund both kids' college · Pay off the house early.
  - **Key dates** — Old 401(k) rollover pending · Roth conversion decision before December.
  - **Assets & accounts** — Marcus 401(k) $412k · Old 401(k) $96k (rollover pending) ·
    Tanya 403(b) $188k · Roth IRAs · Joint brokerage $145k · 529s · Mortgage.
  - **Open questions** — ⚠️ *Old 401(k) still names Jessica Reyes (Marcus's ex-wife) as sole
    beneficiary, dated 2019.* (highlighted) · Confirm rollover paperwork.
- Each item shows a small **source citation** chip (e.g. *Beneficiary Designations.md*) — the
  cursor hovers one to show it's source-backed.

---

## Scene 6 — Ask: cited answer + drafted email  (0:43–1:04)

**On screen:** the REAL Ask tab. Centered composer.

**6a — Meeting-prep question (≈10s):**
- Types (typing animation): **What should I know before my next meeting with the Webb household?**
- Press enter. A brief "thinking" state, then a polished, **cited** answer streams in:
  - **Where things stand** — comprehensive plan; retire at 60, fund college; moderate-growth.
  - **What changed since last meeting** — Tanya's raise (+$400/mo to savings); old 401(k) still
    not rolled over.
  - **Risks / open questions** — ⚠️ the old 401(k) still names **Jessica Reyes** (ex-wife) as sole
    beneficiary; if unaddressed before the rollover, ~$96k would pass to her, not Tanya.
  - **Talking points** — start the rollover (fixes the beneficiary gap), confirm the Roth
    conversion amount before December, raise the brokerage auto-contribution.
  - Inline citations: *— Review Notes.md, Beneficiary Designations.md, Financial Plan Summary.md*.

**6b — Draft the email (≈8s):**
- Types: **Draft a follow-up email asking for the missing beneficiary information.**
- A concise, client-specific draft appears:
  > Subject: Quick item before we finalize your rollover
  > Hi Marcus, before we move the old 401(k) into your IRA, I want to confirm one thing on the
  > current account. Our records show the beneficiary there still lists a name from before your
  > 2019 update. Could you confirm the latest beneficiary form for that account? Once that's set,
  > the rollover puts everything under the correct designations. — [Advisor]
  - Citation chip: *based on Beneficiary Designations.md*.

---

## Scene 7 — Closing  (1:04–1:09)

**On screen:** the final UI (Client Map + the cited answer) blurs/dims slightly; a clean navy
closing card fades up with the logo.

**Caption:**
> **Keepance**
> Know every client. Cite every answer. Keep context secure.

Sub-line, smaller:
> Private client intelligence for high-trust work.

Fade to navy. End.

---

## On-screen text master list (for caption overlays / typing)

- S1: "Client context is scattered across files, emails, notes, and old conversations." / "You're the one holding it all together."
- S6a prompt: "What should I know before my next meeting with the Webb household?"
- S6b prompt: "Draft a follow-up email asking for the missing beneficiary information."
- S7: "Know every client. Cite every answer. Keep context secure." / "Private client intelligence for high-trust work."

All numbers/names are fictional demo data (the Webb Household). No real API keys ever appear.
