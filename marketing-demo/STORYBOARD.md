# Keepance — Product Demo Video Storyboard

**Goal:** A polished 60–90s MP4 that makes Keepance look like a working Windows app for a
**financial advisor**, to validate demand ("would you pay for this?"). Demo data + scripted AI
responses are intentional. Target length: **~78 seconds**.

**Hero client:** the **Webb Household** (canonical demo client). Story spine: an advisor has a
client whose context is scattered; Keepance pulls it into one cited Client Map, and the AI
catches a **stale beneficiary** on an old 401(k) that still names Marcus's ex-wife, Jessica Reyes.

**Visual language:** real Keepance light theme. Navy `#0a2540`, accent blue `#1f74c4`, Satoshi
font, calm professional SaaS feel. Smooth animated cursor, real typing, realistic loading,
subtle fades. No cartoon motion, no startup fluff. Looks like an app an advisor could use tomorrow.

**What's real vs simulated** (see README for the honest boundary):
- **REAL UI, driven live:** the app shell (top bar + sidebar tabs Client Map · Ask · Workflows),
  Scene 5 (Client Map) and Scene 6 (Ask) — the actual React app, the actual components.
- **Scripted/simulated, demo-only (styled with the app's own design tokens so it looks native):**
  the cold open, the onboarding modals, the connect-AI flow, the connect-data import progress,
  and the closing card. The AI answers are scripted (Playwright intercepts the AI request).

---

## Frame & timing

- Resolution: **1280×800**, deviceScaleFactor 2 (renders at 2560×1600, crisp).
- Final encode: H.264 / yuv420p, 30 fps, MP4.
- One continuous Playwright recording (no concat seams); scenes flow via short cross-fades.
- An injected animated cursor is present in every scene (Playwright's real cursor isn't captured).

| # | Scene | Length | Cumulative |
|---|-------|-------:|-----------:|
| 1 | Cold open / the pain | 6s | 6s |
| 2 | Welcome / onboarding | 11s | 17s |
| 3 | Connect an AI | 9s | 26s |
| 4 | Connect your data (import) | 15s | 41s |
| 5 | The Client Map appears (the aha) | 13s | 54s |
| 6 | Ask — cited answer + drafted email | 18s | 72s |
| 7 | Closing | 6s | 78s |

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

## Scene 2 — Welcome / onboarding  (0:06–0:17)

**On screen:** the real Keepance app shell (top bar, sidebar). A clean centered modal sequence
(native styling) walks first-run setup. Cursor moves and clicks between steps.

**Step 2a — Welcome (≈3s):**
- Modal title: **Welcome to Keepance**
- Subtitle: *The private place your whole practice lives — and answers you back.*
- Primary button: **Get started** (cursor clicks).

**Step 2b — Choose your profession (≈3s):**
- Title: **What kind of work do you do?**
- Options as cards: **Financial Advisor** (selected, highlighted), Attorney, Accountant, Consultant.
- Cursor selects **Financial Advisor**, clicks **Continue**.

**Step 2c — Create your first Client Map (≈3s):**
- Title: **Create your first client**
- Text field labeled *Client or household name*; types **Webb Household** (typing animation).
- Button: **Create**.

**Step 2d — Privacy mode (≈2s):**
- Title: **Where should this live?**
- Selected card: **Local-first · Private workspace** — *Your files and your keys stay on your
  computer. Nothing routes through a server we control.*
- Small reassurance line + a lock glyph. Cursor clicks **Continue**.

---

## Scene 3 — Connect an AI  (0:17–0:26)

**On screen:** a clean "Connect an AI" settings panel (native styling), light theme.

- Title: **Connect an AI**, subtitle: *Bring your own key. It never leaves your machine.*
- Provider row: **Anthropic (Claude)** selected, with OpenAI · Google · Local (Ollama) shown.
- API key field: cursor clicks, a key types in **masked** — shows `sk-ant-••••••••••••••••••••3f9` (never a real key).
- Button **Test** → brief spinner → green check: **AI connected securely.**
- Sub-caption: *Requests go straight from your computer to your provider. Keepance never sees your data.*

---

## Scene 4 — Connect your data  (0:26–0:41)

**On screen:** a "Connect your data" screen with source cards, then a live import with progress.

- Title: **Bring in this client's context**
- Source cards (selectable): **Local documents** (selected), **Email export**, **Notes**,
  **Client interview**, **CRM export**.
- Cursor selects **Local documents**, clicks **Import**.
- An import panel animates realistic progress, lines appearing/ticking off:
  - *Scanning 47 documents…* ✓
  - *Reading 126 emails…* ✓
  - *Extracting key people, dates, accounts, and open questions…* ✓
  - *Finding source citations…* ✓
  - *Building the Client Map…* (progress bar fills to 100%)
- Footer reassurance: *All processing happens locally on your machine.*
- On 100%, a soft success pulse, then fade to Scene 5.

> Label in code: `// DEMO-ONLY: scripted progress, not real indexing.`

---

## Scene 5 — The Client Map appears (the aha)  (0:41–0:54)

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

## Scene 6 — Ask: cited answer + drafted email  (0:54–1:12)

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

## Scene 7 — Closing  (1:12–1:18)

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
