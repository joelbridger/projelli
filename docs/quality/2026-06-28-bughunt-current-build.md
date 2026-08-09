# Bug Hunt — 2026-06-28 (keepance-3.0 branch)

**Session type:** QA drive — browser (Vite dev server, port 5174, `?testMode=true&mailFixture=1`)  
**Tester:** Claude Code (automated)  
**Scope:** All 6 core journeys end-to-end, financial advisor pivot lens, law-era content audit  
**Date:** 2026-06-28  
**Branch:** fix/audit-load-normalize-metadata (off keepance-3.0)

---

## Summary

**7 P1 blockers, 12 P2 significant issues, 7 P3 polish items = 26 total new findings.**

The most urgent cluster is the **law-era content that survived the 2026-06-24 advisor pivot** — it shows up during onboarding, in the email demo data, in AI search suggestions, and in a labeling issue on the email "Privilege" button. A financial advisor hitting any of these immediately doubts this product was built for them.

The second cluster is **contradictory AI status** — the app simultaneously claims local Ollama is running AND that no provider is configured, and the trust badge claims "Sent to your Anthropic account" when zero keys are set. These are P1 credibility destroyers for a product that makes privacy its core promise.

Bright spots: Workflows are excellently advisor-adapted. Privacy Center is well-written. The API key wizard is clear and trustworthy. Compose email closes on Escape. The overall shell and navigation are stable.

---

## P1 — Blockers (7)

These stop a journey cold or directly undermine the product's core promise.

---

### NEW-001 · Onboarding — "legal work" labels survive the advisor pivot
**Surface:** Onboarding, Step 6 → "Connect AI" sub-screen  
**What's wrong:** The two AI mode options read: "Recommended for **legal work**" and "Less capable for **legal work**." These labels appear immediately after the user selects "Financial advisor / wealth" as their profession.  
**Why it's P1:** This is the first screen that explains how the AI works. Seeing "legal work" written into the UI sends an immediate "this wasn't built for me" signal to an advisor.  
**Repro:** Load app without testMode → complete onboarding through Step 6 → choose "Cloud AI" → see mode descriptions.

---

### NEW-002 · Search — local-model banner and provider error shown simultaneously
**Surface:** Search page  
**What's wrong:** A green banner reads "On your machine. Nothing leaves. This runs on a local model (Ollama). No prompt or file is sent over the network." At the same time, a red error says "I couldn't reach your AI provider. Try again, or check your key in Settings."  
**Why it's P1:** These two states are mutually exclusive. One says a local model is running; the other says no provider is reachable. The user has no idea what's actually happening or what to trust.  
**Repro:** Navigate to Search in testMode with no keys configured.

---

### NEW-003 · AI Chat — trust badge contradicts model picker
**Surface:** AI Chat  
**What's wrong:** The header badge reads "Sent to your Anthropic account" (implying the AI is active and configured). The model picker directly below says "No AI provider configured."  
**Why it's P1:** A product that markets itself on privacy transparency cannot show contradictory privacy disclosures on the same screen. This is a direct credibility failure.  
**Repro:** Open AI Chat in testMode with no keys configured. See both the badge and the model picker.  
**Note:** Related to open bug BUG-024.

---

### NEW-014 · Email — demo fixture data is 100% law-era
**Surface:** Email tab (mailFixture=1)  
**What's wrong:** All 8 demo fixture emails are from a law practice, not a financial advisory firm. Examples visible:
- "Re: Settlement Conference" (Pat Henderson <pat@henderson.law>) — "Confirmed for Thursday at 2pm in **Courtroom 4**."
- "Deposition Transcript - Exhibit A" (Linda Court Reporter) — "transcript from the June 10 **deposition**"
- "Motion for Summary Judgment" (z.torres@opposing.com) — "We intend to file our **MSJ**"
- "Court calendar update" (Court Clerk <clerk@court.gov>) — "The November 3 **hearing** has been moved"
- "Clio integration update" (Clio is **legal** practice management software)  
**Why it's P1:** Any demo, sales flow, or QA run that shows email content immediately signals the wrong audience. This is what a prospect sees during a demo.  
**Repro:** Load `?testMode=true&mailFixture=1` → navigate to Email.

---

### NEW-015 · Email — "Privilege" button is law-only terminology
**Surface:** Email tab — email row actions  
**What's wrong:** Every email row shows an "Open / File / **Privilege ▾** / Export" action set. "Privilege" refers to attorney-client privilege, which is a legal doctrine with no financial advisor equivalent.  
**Why it's P1:** An advisor will not know what this button does. Worse, it signals this tool was built for lawyers.  
**Repro:** Load Email tab in testMode — visible on first email row.

---

### NEW-019 · Email — dev team debugging email in demo fixture
**Surface:** Email tab (mailFixture=1), 7th email in list  
**What's wrong:** One fixture email reads: **"snake_case variable issue"** from Dev Team <dev@keepance.com> — "There is an underscore handling bug in the search surface — see attached report."  
**Why it's P1:** An internal engineering debugging note is part of the demo dataset. Any prospect, QA run, or recorded demo will show this. It's embarrassing and erodes trust.  
**Repro:** Load Email tab in testMode → scroll down to the 7th email.

---

### NEW-020 · Email AI Search — suggested prompts are law-era
**Surface:** Email → AI search tab  
**What's wrong:** The three suggested search queries are:
1. "Who emailed about the **deposition**?"
2. "Find emails with attachments from **opposing counsel**"
3. "What did the client agree to over email?" (acceptable)  
**Why it's P1:** "Deposition" and "opposing counsel" are exclusively legal terms. These are the first things an advisor sees when trying email AI search — and both say "this is a lawyer's tool."  
**Repro:** Email → click "AI search" tab.

---

## P2 — Significant (12)

Real gaps that confuse, mislead, or block common flows.

---

### NEW-004 · Onboarding — modal has no focus trap
**Surface:** Onboarding modal  
**What's wrong:** While the onboarding modal is open, the background workspace selector buttons ("Open Existing Workspace," "New Workspace") remain in the keyboard tab order and accessible tree. Keyboard and screen reader users can accidentally activate the wrong element.  
**Repro:** Open the app without testMode → tab through the onboarding modal.

---

### NEW-005 · Onboarding — double-ask about cloud vs. local AI
**Surface:** Onboarding, Step 6  
**What's wrong:** Step 6 presents a "Cloud vs. On-device" choice. After the user picks Cloud, the very next screen immediately asks again with essentially the same choice.  
**Why it matters:** Redundant decisions increase drop-off. It also makes the product feel unpolished.

---

### NEW-006 · AI Chat — formatting toolbar visually merges with chat input
**Surface:** AI Chat  
**What's wrong:** A document formatting toolbar (Bold / Italic / H1 / H2 / etc.) sits directly above the chat interface. It visually looks like it applies to the chat input, but it's actually part of the document wrapper. Users will be confused about what they're formatting.

---

### NEW-007 · Clients — "Create client" form has unexplained second field
**Surface:** Clients → Create client form  
**What's wrong:** The form has a "Client name" field and immediately below it a second field labeled only "Client" (placeholder: "e.g. Acme Corp"). No label explains what "Client" means differently from "Client name."  
**Repro:** Clients → + Create client → see both fields.

---

### NEW-008 · Clients — "MCP" acronym in create client form
**Surface:** Clients → Create client form  
**What's wrong:** A checkbox reads "Allow external AI tools (MCP) to access this client." Financial advisors do not know what MCP means. This is a technical integration protocol name that should be explained in plain language.

---

### NEW-009 · AI Chat — model picker requires coordinate click (Radix bug)
**Surface:** AI Chat → model picker dropdown  
**What's wrong:** The model picker button doesn't open via a standard DOM click. It requires a precise pixel-coordinate click to trigger. This is a Radix UI interaction issue that could affect keyboard users and automated tests.

---

### NEW-010 · Global — trust badge shows wrong provider when no keys are set
**Surface:** Top bar, present on every screen  
**What's wrong:** "Sent to your Anthropic account" is shown in the badge even when no API keys exist. The badge should either be hidden or show "No provider configured" when there are no keys.  
**Note:** This is a residual from BUG-024; flagging as still present.

---

### NEW-016 · Settings — token limit controls shown to non-technical users
**Surface:** Settings → AI & Privacy → AI tab  
**What's wrong:** "Context Token Limit (50,000)" and "Chat Context Token Limit (200,000)" are visible in the main AI settings for all users. Financial advisors won't know what a token limit is or what to change these to. Should be under an "Advanced" section.

---

### NEW-017 · Settings — "Workspace" terminology collision in key wizard
**Surface:** Settings → AI & Privacy → Manage AI Account Keys → Add key → Step 3  
**What's wrong:** Step 3 says "Leave 'Workspace' as default." This refers to Anthropic's API console workspace concept — but "Workspace" is also Keepance's core concept for where files live. The collision will confuse new users who just went through onboarding learning the Keepance Workspace.

---

### NEW-023 · Privacy Center — "Design-partner diagnostics" is internal jargon
**Surface:** Privacy Center (scroll to bottom)  
**What's wrong:** An accordion item reads "Design-partner diagnostics (opt-in, off by default)." "Design-partner" is an internal Keepance program term. Users should see "Optional error reporting (off by default)" or similar.

---

### NEW-024 · Workflows — cancelled workflow creates orphan artifact folder
**Surface:** Workflows → Run workflow → Cancel  
**What's wrong:** Clicking "Run" on a workflow, then clicking "Cancel" on the questions form still: (a) logs "Workflow Started" + "Workflow Failed" in Activity Log, and (b) creates an output folder in Documents (e.g., "Client Financial Plan Summary - 2026-06-28-..."). Users will accumulate empty orphan folders from every mis-clicked Run.  
**Repro:** Workflows → Client Financial Plan Summary → Run → Cancel → navigate to Documents.

---

### NEW-025 · Documents — `.keepance` system folder exposed in file tree
**Surface:** Documents tab  
**What's wrong:** The `.keepance` internal storage directory appears as a user-visible folder in the Documents grid alongside the user's real files. Users shouldn't see, rename, or delete this folder.  
**Repro:** Navigate to Documents in testMode.

---

## P3 — Polish (7)

Minor copy/UX refinements that don't block a journey.

---

### NEW-011 · Onboarding Step 5 — "your firm's policies" appears twice
The phrase "your firm's policies" repeats twice in close succession on Step 5. Reads awkwardly; one instance should be reworded.

---

### NEW-012 · Search — "upcoming deadlines" query is mildly law-adjacent
Suggested search "What are the upcoming deadlines?" skews toward legal usage. Advisors also have deadlines (tax deadlines, RMDs, beneficiary deadlines), so this isn't wrong — just slightly off-target. Something like "What client reviews are coming up?" would be sharper.

---

### NEW-013 · Onboarding — "Got it, connect an AI" button phrasing
The CTA "Got it, connect an AI" on Step 6 is awkward. Should be "Connect an AI provider" or "Set up AI."

---

### NEW-018 · Settings — Theme defaults to "System" instead of "Light"
Settings → General → Theme is set to "System" by default. For a product designed with a light UI for professional use, defaulting to "System" means advisors on dark-mode OS will see dark Keepance, which hasn't been tested or polished. Should default to "Light."

---

### NEW-021 · Workflows — long question modal has no sticky submit button
The "Client Financial Plan Summary" workflow has 7 required fields across ~1650px of modal content. The Continue/Cancel buttons are hidden at the very bottom — users must scroll 2–3 screens to find them. A sticky footer with the buttons would fix this.

---

### NEW-022 · Activity Log — "mock-model" badge is developer jargon
Activity Log entries show `mock-model` as the model badge when no AI provider is configured. "mock-model" is a developer/test term. Should display as "No AI configured" or be omitted.

---

### NEW-026 · Activity Log — SCOPE column empty in testMode
The SCOPE column on Activity Log entries shows nothing in testMode. Unclear whether this is by design (testMode has no scoped client) or a bug. If it's intentional, the column should either show "All clients" or be hidden when empty.

---

## Confirmed Working ✅

- Onboarding 6-step flow completes end-to-end (steps 1–6 navigate correctly)
- Workspace name entry via React synthetic input events (step 3)
- AI Chat surface opens and renders without crashing
- Email compose modal opens, fields are clear, Escape-to-close works
- Email Keyword vs. AI search tab switching works
- Filters dropdown visible and accessible
- Workflows page: 32 workflows listed, Advisors/Tax/Consulting/Research/Analysis/Planning filter tabs — all advisor-appropriate
- Workflow "Client Financial Plan Summary" questions form: all fields are excellently advisor-adapted (401k balances, Roth IRA, meeting objectives, next steps, beneficiary forms examples)
- Activity Log: loads without crash, CSV/JSON export buttons present, log entries appear correctly for workflow events
- Privacy Center: complete and well-written; Wealthbox entry confirms CRM integration; "not a custodian of your data" tagline works well for financial advisor audience
- Settings → AI & Privacy: AI mode selector (Cloud vs. On-device) is clear; Network lockdown toggle explained; "AI Account Keys" wizard is 3-step, clear, trustworthy
- Settings → General: Language, On Startup, Update Notifications controls render correctly
- Documents: file tree renders, Grid/Tree/List views accessible, New document/folder/Add files buttons visible

---

## Law-Era Leftovers Summary (pivot to financial advisors: 2026-06-24)

The following are the live instances of law-era content still visible as of 2026-06-28:

| Location | Law-era content | Bug ID |
|---|---|---|
| Onboarding Step 6 | "Recommended for legal work" / "Less capable for legal work" | NEW-001 |
| Email fixture (all 8 emails) | Settlement Conference, Deposition, Motion for Summary Judgment, Court calendar, Clio, @henderson.law | NEW-014 |
| Email row actions | "Privilege" button (attorney-client privilege) | NEW-015 |
| Email AI search suggestions | "deposition," "opposing counsel" | NEW-020 |
| Email fixture (item 7) | "snake_case variable issue" from dev@keepance.com | NEW-019 |
| Search suggested query | "What are the upcoming deadlines?" (minor) | NEW-012 |

---

*Report written by Claude Code QA session. Branch: fix/audit-load-normalize-metadata. Build tested: keepance-3.0 Vite dev server, 2026-06-28.*
