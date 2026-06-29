# Keepance — Product Demo Video Storyboard

**Goal:** A polished 60–90s MP4 that makes Keepance look like a working Windows app for a
**financial advisor**, to validate demand ("would you pay for this?"). Demo data + scripted AI
responses are intentional. Current length: **~70 seconds**.

> **Onboarding source (2026-06-29):** Scene 2 is the **V2 "concise" 4-screen onboarding**
> (Jameson's simplified version) — the standalone animated HTML prototype at
> `docs/design/onboarding-prototype-v2-concise/`. It is captured full-screen in an iframe (Lottie
> + GSAP animations and all). This **replaces** both the old simulated welcome/connect-AI/import
> modals (former scenes 2–4) and the earlier 8-chapter React-journey cut. The cold open, the real
> Client Map, the Ask scene, and the closing card are unchanged.

**Hero client:** the **Webb Household** (canonical demo client). Story spine: an advisor has a
client whose context is scattered; Keepance pulls it into one cited Client Map, and the AI
catches a **stale beneficiary** on an old 401(k) that still names Marcus's ex-wife, Jessica Reyes.

**Visual language:** real Keepance light theme. Navy `#0a2540`, accent blue `#1f74c4`, Satoshi
font, calm professional SaaS feel. Smooth animated cursor, real typing, realistic loading,
subtle fades. No cartoon motion, no startup fluff. Looks like an app an advisor could use tomorrow.

**What's real vs simulated** (see README for the honest boundary):
- **REAL UI, driven live:** the app shell (top bar + sidebar tabs Client Map · Ask · Workflows),
  Scene 5 (Client Map) and Scene 6 (Ask) — the actual React app, the actual components.
- **Onboarding (Scene 2):** the **V2 "concise" 4-screen prototype** — a real, animated,
  vector-crisp HTML design (Lottie + GSAP), captured full-screen. It's a design prototype, not the
  live in-app onboarding, but it is genuine product design, not a styled mock-up.
- **Scripted/simulated, demo-only (styled with the app's own design tokens so it looks native):**
  the cold open and the closing card. The AI answers are scripted (Playwright intercepts the AI
  request).

---

## Frame & timing

- Resolution: **1440×900** (16:10), deviceScaleFactor 1.
- Final encode: H.264 / yuv420p, 30 fps, MP4 (~70 s, ~4.4 MB).
- One continuous Playwright recording (no concat seams); scenes flow via short cross-fades.
- An injected animated cursor is present in every scene (Playwright's real cursor isn't captured).

| # | Scene | Length | Cumulative |
|---|-------|-------:|-----------:|
| 1 | Cold open / the pain | 4s | 4s |
| 2 | Onboarding — V2 concise, 4 screens (intro flowchart · cloud/local AI · connect data · live setup) | 25s | 29s |
| 5 | The Client Map appears (the aha) | 13s | 42s |
| 6 | Ask — cited answer + drafted email | 18s | 60s |
| 7 | Closing | 6s | 70s |

> Scene numbering keeps the original 1/5/6/7 ids; former scenes 3 and 4 are folded into the single
> Scene 2 onboarding capture, so the registry in `render/record.mjs` is `1, 2, 5, 6, 7`.

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

## Scene 2 — Onboarding (V2 "concise", 4 screens)  (0:04–0:29)

**Source:** the standalone animated HTML prototype at
`docs/design/onboarding-prototype-v2-concise/` (Lottie step icons + GSAP). It is served as a
no-cache static site and captured **full-screen in an iframe**, layered just under the navy
"stage" cover. The cold open's navy card crossfades out to reveal screen 1; the prototype's own
nav (Back / Continue / progress dots) is on screen; the harness advances the 4 screens with
`postMessage('kp-advance')` and paces each hold so the animations read. A navy wipe then hands off
to the real Client Map.

**Screen 1 — intro flowchart (≈5s):**
- Headline: **A private AI that knows your clients.**
- A 3-card, card-to-card flowchart with **animated Lottie icons**:
  **Connect your AI and files → Keepance builds Client Maps → Ask anything, with sources.**
- Security pills: *Keepance stores none of your data · Fully encrypted (AES-256) · AI provider is
  SOC 2 certified.* Button: **Go!**

**Screen 2 — Connect your AI (≈5s):**
- Title: **1. Connect your AI.** Two even cards:
  - **Use ChatGPT, Claude, or Gemini** — *Keepance never sees your key or your data; providers are
    SOC 2 Type 2 certified; encrypted in transit and at rest; providers don't train on your data
    (paid API); pay as you go with your own key.* Provider pills: OpenAI · Anthropic · Google.
  - **Use local AI** — *Runs on your computer; completely secure (nothing leaves); ~2.5 GB
    download; great at questions across lots of files.* Button: **Try Local AI.**

**Screen 3 — Securely connect your data (≈5s):**
- Title: **2. Securely connect your data.** Three connect cards for the real connectors:
  **OneDrive · Outlook · Wealthbox.** Security pills (encrypted in transit · stays on your device ·
  Keepance never sees your data). Beneath: a **COMING SOON** strip of planned-connection logos
  (Redtail, RightCapital, eMoney, Envestnet MoneyGuide, Holistiplan, Orion, Envestnet, Addepar,
  Nitrogen, DocuSign).

**Screen 4 — Live setup / progress (≈7s):**
- Title: **3. Setting up your firm** — *You can continue to the app and these will load in the
  background.* Real-time **progress bars** fill: *Downloading your private AI*, then *Importing
  your data* (Outlook · Wealthbox · OneDrive). A *Building your Client Maps* indicator sweeps
  (*assembling the whole story of every client and household*). A preview of **questions you can
  ask Keepance**. Button: **Continue to the app** → navy wipe into the real Client Map.

> Honest boundary: this is a **design prototype** captured full-screen, not the live in-app
> onboarding (that in-app status panel is a separate build item). No real key, import, or indexing
> happens.

---

## Scene 5 — The Client Map appears (the aha)  (0:29–0:42)

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

## Scene 6 — Ask: cited answer + drafted email  (0:42–1:00)

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

## Scene 7 — Closing  (1:00–1:10)

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
