# Lantern (Advisor Prep Hero / Keepance) — UI Ground-Truth Inventory

Annotated screenshot inventory for the senior-UX design phase. Every screenshot was
captured from the **running browser dev build** at `http://localhost:5273/`, viewport
**1440×900**, **light theme**, branch `lantern-plus`.

- **User-facing brand in this build:** "Advisor Prep Hero" (the rebrand of Keepance).
  The engine still uses `matter` / `matter_id` internally; UI copy says "client / household".
- **Screenshots live in:** `./shots/`

## How the app was seeded

The browser build has a test mode read from URL params (see
`src/app/lifecycle/useTestModeWorkspace.ts` and `src/app/lifecycle/seedDemoClients.ts`):

| Param | Effect |
|---|---|
| `?testMode=true` | Installs an in-memory mock workspace + two demo doc tabs. |
| `&seedDemo=1` | Seeds a realistic advisor book: **4 clients** — Brennan Household + Okafor (both full Client Maps with sourced items + completeness), plus Tran and Whitman (list-only). |
| `&mailFixture=1` | Seeds **8 emails** per client into the Email viewer. |
| `?forceOnboarding=true` | Forces the first-run onboarding flow. |
| `&recordMatter=1` | (Alt) opens a seeded "Webb Household" matter with docs, for screen recording. |

**Primary capture URL:** `http://localhost:5273/?testMode=true&seedDemo=1&mailFixture=1`
**Onboarding URL:** `http://localhost:5273/?forceOnboarding=true`

## Environment truths a prototype builder must know

- **Local AI is live** in the browser build (Ollama, `llama3.1:8b` + `llama3.2:3b`), so the
  header shows a green **"Using local AI"** chip. But the **private file search / RAG index is
  NOT available** in the browser build, so a real *cited* Ask answer cannot be produced here
  (see shot 23 — it returns a "couldn't search your files yet" callout instead).
- **Word (.docx) editing and the Email reading pane are desktop-only.** The browser shows
  read-only placeholders + a notice (shots 09, 11). The **plain-text/Markdown editor with its
  inline formatting toolbar DOES work in the browser** (shot 12) and is the closest reachable
  proxy for the editor chrome.

---

## Screenshot inventory

### 01 · `01-onboarding-setup-dialog.png` — Onboarding welcome
- **Surface:** First-run welcome / value-prop dialog ("A private AI that knows your clients.")
- **Component:** `src/features/onboarding/v2/OnboardingV2.tsx` + `.../components/OnboardingShell.tsx`
- **State:** Fresh first-run (forced). Three animated value cards (Connect AI & files → builds Client Maps → Ask with sources), three trust pills (stores none of your data / AES-256 / SOC 2), red **"Go!"** primary button. Full-bleed blue→pink gradient background.
- **Feature note:** This is the earliest surface; not a plug-in point for the named upcoming features, but sets the trust-forward visual tone.

### 02 · `02-onboarding-start-choice.png` — Onboarding "How do you want to start?"
- **Surface:** Path chooser (Sample practice vs. Connect my own data)
- **Component:** `src/features/onboarding/v2/scenes/ChooseStartScene.tsx`
- **State:** Step 2 of a 4-step flow (step dots visible). Two large choice cards; the left carries a red **"Recommended"** badge. Feature-bullet lists with check icons.
- **Not fully reachable:** Onboarding **steps 3–4 (the connector import steps)** are gated behind picking "Connect my own data" → a native folder picker, which the browser build cannot complete; and **"Use the sample"** needs native filesystem creation, so it does not advance in-browser. Flagged — capture these on desktop.

### 03 · `03-shell-clientmap-home.png` — App shell + Client Map home (MattersHome)
- **Surface:** The whole shell **plus** the Clients list. This is the canonical "everything" frame.
- **Components:** shell = `src/app/shell/layout/Spine.tsx` (left nav), `.../TrustBar.tsx` (the confidentiality strip under the top bar), `.../StatusBar.tsx` (bottom "Free trial / Report a bug" strip); list = `src/features/matters/MattersHome.tsx`
- **State:** 4 seeded clients. Shows the **3-tab Spine** (Client Map · Ask · Workflows), the Clients rail, the account footer + collapse control, and the top banner (workspace switcher, light-theme toggle, settings gear, Ctrl+K). Client rows carry inline actions (Ask / Documents / Email / Archive) and green **"Sample"** badges; sortable columns (Client / Documents / Created).
- **Feature note:** **Today's-meetings strip → top of MattersHome** (above the "New client" button / the client table). **Record pill → floats over this shell** (persistent, over the main region).

### 04 · `04-client-map-household-section.png` — Single client's Client Map (MatterHub)
- **Surface:** One household's Client Map, "Household" section selected.
- **Component:** `src/features/matters/MatterHub.tsx` (header + sub-tabs) → `src/features/matters/ClientMapView.tsx` / `ClientMapPanel.tsx` (sections + items) with the right-hand Sources panel.
- **State:** Brennan Household. Header sub-tabs **Client Map · Documents · Email · Activity**, a green **"Sample"** badge, a **scope chip "Retirement & wealth plan only"** (recall isolation), and a **"No AI connected"** status pill. Left **sections panel** (Household / Goals / Money and accounts / Follow-ups / What I'm missing + "New section" + "Start the guided interview"). Center = bulleted map items each with an **Edit** affordance and inline **source chips** ("email", "source p. 2"). Right = **Sources panel** with numbered source cards (Email / PDF) each showing "Verified against source".
- **Feature note:** **CRM approve card → client timeline** and **meeting entry → timeline** would live in/near this hub (see Activity sub-tab, shot 06). The at-a-glance summary + completeness display are shots 04/05.

### 05 · `05-client-map-completeness-missing.png` — Completeness display ("What I'm still missing")
- **Surface:** The Client Map completeness / gap view.
- **Component:** `src/features/matters/MatterHub.tsx` → the `__missing` client-map tab (completeness model from `seedDemoClients.ts` → `ClientMap.completeness`).
- **State:** A pill-shaped completeness badge **"Getting there"** (levels: getting-there / solid…), a plain-English disclaimer, open questions each with **"I know this" / "Ask the client"** buttons, and a "Questions for the client" block.
- **Feature note:** This is the "confidence / what's known vs assumed" surface — relevant to any feature that reasons about record completeness.

### 06 · `06-client-activity-timeline.png` — Activity / audit timeline (client-scoped)
- **Surface:** Per-client Activity tab (append-only audit log).
- **Component:** `src/features/matters/MatterHub.tsx` (Activity sub-tab) → audit views (`src/features/audit/`).
- **State:** **Empty state** ("No activity logged yet") — nothing is logged in the seeded browser session. Toolbar: **CSV / JSON** export, **Filters**, keyword search; a "Stored in your browser, not encrypted" notice.
- **Feature note:** This is the literal **timeline** target: **meeting entry → timeline**, and a **CRM approve card** could surface here as a timeline event. Shown empty — mark as empty state.

### 07 · `07-client-documents-tab.png` — Client Documents (grid, empty)
- **Surface:** Per-client Documents tab.
- **Component:** `src/features/documents/DocumentGridView.tsx` (+ workspace tree).
- **State:** **Empty state** ("Your workspace is ready" / "No documents yet") — the seed populates Client Map *facts* but not real files for these matters. Toolbar: New document / New folder / Add files / Tree·Grid toggle / search.
- **Feature note:** Empty state; flagged. Real files appear only on desktop or via `recordMatter`.

### 08 · `08-modal-create-word-doc-prompt.png` — "Create Word Document" prompt (modal)
- **Surface:** Name-entry modal (a `PromptDialog`).
- **Component:** `src/ui/PromptDialog.tsx` (via `src/ui/dialog.tsx`).
- **State:** Centered dialog: title + helper, a "Creating in `/…/Brennan Household/`" path chip, a name textbox, a live `my-document.docx` preview, Cancel / OK, and a close (×). Navy-tinted scrim.
- **Feature note:** Canonical **prompt-dialog** pattern for the design reference.

### 09 · `09-docx-editor-readonly-preview.png` — Docx editor (read-only, browser)
- **Surface:** The .docx viewer chrome.
- **Component:** `src/features/documents/media/DocxViewer.tsx` / `DocxEditor.tsx` / `DocxDocumentView.tsx`; inline toolbar/redline = `DocxRedlineControls.tsx`, `DocxReviewPane.tsx`.
- **State:** File header (name + Rename pencil + "Saved" status + "More actions ⋯"), a **desktop-only warning banner** ("Editing Word documents with tracked changes is only available in the … desktop app. Showing a read-only preview here."), and a gray render placeholder.
- **Not fully reachable:** **The full docx inline toolbar + tracked-changes/AI-redline UI is desktop-only** — flagged. Capture on the Legion/desktop for the true editor toolbar.

### 10 · `10-client-email-viewer.png` — Email viewer (populated list)
- **Surface:** Per-client Email inbox (populated).
- **Component:** `src/features/email/EmailWorkspace.tsx` + `MailRow.tsx` (rows), `EmailViewer.tsx` (reader).
- **State:** 8 seeded emails. Toolbar: **New email**, a **Keyword / AI search** segmented toggle, **Filters**, **Sync now**, keyword search. A blue **"Your email is connected…"** callout banner. Rows: subject / sender / snippet / date, attachment paperclips, per-row select checkboxes; "Showing 8 for this client".
- **Feature note:** A reachable, richly-populated surface. Scope-aware search toggle here mirrors the Ask scope model.

### 11 · `11-email-reading-view.png` — Email open (desktop-only) + doc editor chrome
- **Surface:** Opening an email routes it into the global Documents editor.
- **Component:** `src/features/email/EmailViewer.tsx` (the "could not be opened" state).
- **State:** **Desktop-only** notice ("This email could not be opened / Email viewer is only available in the desktop app"). Usefully reveals the **global Documents surface** with multiple doc tabs and the **inline formatting toolbar** (B, I, H1–H3, lists, link, ⋯, Preview).
- **Not fully reachable:** the actual email **reading pane** is desktop-only — flagged.

### 12 · `12-markdown-editor-inline-toolbar.png` — Markdown/plain-text editor + inline toolbar
- **Surface:** The working (browser) text editor.
- **Component:** `src/features/documents/editor/MarkdownEditor.tsx` / `PlainTextEditor.tsx`; footer `WordCountFooter.tsx`.
- **State:** `test1.md` open. **Inline toolbar** (Bold, Italic, H1/H2/H3, bullet + numbered list, link, ⋯, Preview) + "Export / Export as", document tabs, CodeMirror gutter line-numbers, bottom breadcrumb + word/char count. This is the reachable proxy for the editor toolbar's visual language.

### 13 · `13-ask-tab-input-scope-pills.png` — Ask tab (composer + scope pills)
- **Surface:** The Ask surface.
- **Components:** `src/features/ask/Ask.tsx`, composer `AskComposer.tsx`, **scope pills `ScopeToggle.tsx`**, sources `SourcePanel.tsx`, conversations `ConversationsRail.tsx`.
- **State:** Header + "Using local AI" chip; left Conversations rail ("New question"); bottom **scope pill group — "This client" (active/red) · All clients · Email · Documents** + a **"Files-only mode"** switch; a large search-composer with an **Ask** button; right **Sources** panel ("· from your files only" empty hint).
- **Feature note:** **Scope pill → Ask input area** plugs in exactly at this pill row (`ScopeToggle`). This is the primary target for the "scope pill" upcoming feature.

### 14 · `14-workflows-template-list.png` — Workflows template gallery
- **Surface:** Workflows tab (template catalog).
- **Component:** `src/features/workflows/AssociateHome.tsx` → `marketplace/TemplatesTab.tsx`, `TemplateCatalogCard.tsx`.
- **State:** Category filter **chips** (All active, Advisors, Tax, Consulting, Research, Analysis, Planning) + search; template **cards** grouped by category with counts (ADVISORS (7), TAX (13)…), each card = title + description + **Run** button; "Show all (n)" expanders. "No AI connected" pill top-right.

### 15 · `15-workflow-run-interview.png` — "Run Workflow" confirm dialog
- **Surface:** Confirm-before-run dialog.
- **Component:** `src/features/workflows/AssociateHome.tsx` (run confirm) via `src/ui/dialog.tsx`.
- **State:** Red **eyebrow "RUN WORKFLOW"**, title "Annual Review Packet", a "Run in: The Brennan Household…" context card, **Cancel / Run** (Run = red primary). Navy-tinted scrim over the dimmed gallery.
- **Feature note:** Serves as the canonical **confirm-dialog** pattern (dialog header + eyebrow + primary/secondary footer).

### 16 · `16-workflow-running-state.png` — Workflow interview (Workflow Questions modal)
- **Surface:** The workflow run/interview form.
- **Component:** `src/features/workflows/InterviewForm.tsx`.
- **State:** Large modal "**Workflow Questions**" + instruction, stacked form fields each = bold label + red required-asterisk + helper text + input/textarea (Client name, Review year, Key life events, Plan changes…). Focused field shows the navy focus ring. Behind it, the template card shows a **"Running"** spinner state.
- **Feature note:** The template "interview" UI. Note the field-card styling (each question in its own bordered block).

### 17 · `17-account-connections.png` — Account → Connections (top)
- **Surface:** Account window, Connections tab.
- **Component:** `src/features/account/AccountWindow.tsx`.
- **State:** Dialog header (avatar + name field + Upload photo), tabs **Account · Firm · Usage · Connections**. Connector cards: **Microsoft 365 email** (dark-navy "Connect Microsoft 365" button) and **Other email (IMAP)** (Host/Port/Email/App-password fields).

### 18 · `18-account-connections-scrolled.png` — Connections (Ollama / local models)
- **State:** Bottom of Connections: **Ollama (local models)** section — a green **"Ollama ready, 2 models installed"** success callout, "Check Ollama connection" (dark-navy) button, a "Why Ollama?" info card, and a collapsible **Developer tools** row.

### 19 · `19-account-connections-middle.png` — Connections (OneDrive / Box / Wealthbox / Addepar)
- **State:** Mid-scroll connector cards: **OneDrive/SharePoint** (dark-navy "Connect OneDrive" button, read-only note), **Box** (desktop-only), **Wealthbox** ("Available in the desktop app only"), **Addepar** (desktop-only).
- **Note:** Calendly is referenced in product docs but was not surfaced as a distinct card in this build's Connections list; connectors that say "available in the desktop app only" render as text-only cards here. Flagged — verify Calendly card on desktop.

### 20 · `20-data-map-dialog.png` — Data Map dialog
- **Surface:** The printable "where your data goes" map.
- **Component:** `src/platform/privacy/ui/DataMapDialog.tsx` (opened from the TrustBar map icon).
- **State:** Title "**Where your data lives and who can see it**" + "Print / Save PDF" button. Accordion rows, each with a soft-tinted icon: files stay on your machine (expanded) / AI keys in OS keychain / cloud prompt goes straight to provider / local model for sensitive work / email encrypted / Wealthbox runs machine→Wealthbox / scanned docs read locally / "What Advisor Prep Hero's own servers see".

### 21 · `21-privacy-center.png` — Privacy Center (full surface)
- **Surface:** Privacy Center (a full surface, not a dialog).
- **Component:** `src/features/privacy/PrivacyCenterHome.tsx`.
- **State:** "**Where your data is**" + **"Generate a security overview for my firm"** and **"Confidentiality Report for Retirement & wealth plan"** (red-outline) buttons; a **"Current mode: No AI connected"** pill + **"Scoped to: Retirement & wealth plan"**; then the same plain-English accordion as the Data Map.

### 22 · `22-egress-explainer-popover.png` — Egress indicator target (routes to Privacy Center)
- **Surface:** The TrustBar "**Where does my data go?**" info button.
- **Component:** `src/app/shell/layout/TrustBar.tsx` (the egress indicator strip: scope label + info + Data Map + Privacy Center icons).
- **State:** Clicking the egress info icon **navigates to the Privacy Center** (identical to shot 21) rather than a popover. The **always-visible egress indicator itself** is the strip directly under the top banner in every screenshot (scope label on the left, three trust icons on the right).
- **Feature note:** The egress indicator is a persistent shell element; any feature touching data-flow trust should respect it.

### 23 · `23-ask-submitted-answer.png` — Ask submitted (search-unavailable state)
- **Surface:** Ask after submitting a question.
- **Component:** `src/features/ask/Ask.tsx` + answer/callout blocks (`AnswerBlocks.tsx`).
- **State:** A red-tinted **warning callout** — "I couldn't search your files yet. Your private search may still be setting up…". The Ask button is now enabled (red). This is the reachable state; the true **cited-answer view is NOT seedable in the browser** (no RAG index).
- **Not fully reachable:** the citations/source-chip *answer* view — flagged. Its citation chip language is documented via the Client Map source chips (shot 04) and `CitationText.tsx` / `SourcePanel.tsx`.

### 24 · `24-command-palette.png` — Command palette (Ctrl+K)
- **Surface:** Global command palette.
- **Component:** `src/app/shell/common/CommandPalette.tsx` (also `QuickOpen.tsx`).
- **State:** Centered search modal ("Type a command or search…" + `esc`), grouped commands (FILE / VIEW) with right-aligned keyboard-shortcut badges (Ctrl+N, Ctrl+S, …). Good reference for the app's list/shortcut-badge styling.

### 25 · `25-confirm-dialog-archive.png` — MattersHome after archive (archived-clients state)
- **Surface:** Clients list after archiving a client.
- **Component:** `src/features/matters/MattersHome.tsx`.
- **State:** Archiving "The Whitmans" happened **instantly (no confirm dialog)**; count drops to "3 clients" and a collapsible **"Archived clients (1)"** row appears at the bottom of the table.
- **Note:** A generic `ConfirmDialog` exists (`src/ui/ConfirmDialog.tsx`) but Archive does not use it; the **Run Workflow dialog (shot 15) is the confirm-dialog reference**.

---

## Where the named upcoming features plug in (quick map)

| Upcoming feature | Plug-in point | Screenshot / component |
|---|---|---|
| Today's-meetings strip | Top of MattersHome (above New-client / table) | 03 · `MattersHome.tsx` |
| CRM approve card | Client timeline (Activity tab area) | 06 · `MatterHub.tsx` + `audit/` |
| Record pill | Floats over the shell (persistent) | 03 · `Spine.tsx` / shell layout |
| Meeting entry | Client timeline | 06 · `MatterHub.tsx` Activity |
| Scope pill | Ask input area (existing pill row) | 13 · `ScopeToggle.tsx` |

## Surfaces NOT reachable in the browser build (flagged for desktop capture)

1. **Onboarding steps 3–4** (connector import steps) + the "Use the sample" landing — need native FS. (02)
2. **Docx full editor** — inline toolbar, tracked changes, AI redline are desktop-only. (09)
3. **Email reading pane** — desktop-only. (11)
4. **Cited Ask answer** with source chips — no RAG index in browser; only the "search unavailable" state renders. (23)
5. **ClientMapUpdatesTray / update banners** — `src/features/matters/ClientMapUpdatesTray.tsx` renders nothing unless `ClientMap.pendingUpdates` is non-empty; the seed sets it empty, and no browser affordance injects a pending update. Not triggerable in this build — capture by seeding pending updates or via a live AI Client-Map rebuild on desktop.
6. **AI-write approval UI** — `src/features/ask/AiWriteApprovalModal.tsx` / `ProposedFactsPanel.tsx` require a live AI write proposal (needs cloud AI + RAG). Not reachable in the seeded browser session.
7. **Real client Documents** for seeded matters — grid is empty (07); files exist only on desktop or via `?recordMatter=1`.
8. **Calendly connector card** — not surfaced distinctly in this build's Connections list; verify on desktop. (19)
