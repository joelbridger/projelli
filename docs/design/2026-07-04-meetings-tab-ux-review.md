# Meetings tab — senior UX review (2026-07-04)

**Reviewer lane:** cc-lantern-w3ux (Fable 5) · branch `lp/wave3-meetings-ux`
**Mandate (Jameson):** review the entire Meetings tab through a senior UX designer lens so it is extremely intuitive and integrates well with the rest of the app. Bar: a financial advisor who has never seen it understands it in seconds; recording feels obviously safe and controllable; nothing feels bolted-on.

**Method:** experienced first-hand in the browser dev build (`?testMode=true&seedDemo=1`, seeded realistic meeting folders through the live WorkspaceService), judged against (a) the locked prototype `docs/design/lantern-plus-prototypes/p6-client-meetings-tab.html`, (b) the sibling tabs' idioms (Documents / Email / Activity, mapped file-by-file), and (c) the approved reimagine design language (`ui-reimagine-approved-2026-07-03`: `--kp-*` token system, elevation scale, spacing system). Screenshots live in `2026-07-04-meetings-ux-review-shots/`. The real capture flow (mic, Rust sidecar) is Tauri-only; those paths were reviewed in code and are exercised in the coordinator's post-merge Legion walkthrough.

**Screenshots** (in `2026-07-04-meetings-ux-review-shots/`): before — `02-meetings-empty`, `03-consent`, `05-recording-pill`, `06-list`, `07-meeting-page`, `08-speakers`, `09-type-edit`, `10-with-audio`; after (fixes verified live in the same build) — `11-empty-after`, `12-list-after`, `13-entry-after`, `14-delete-confirm`, `15-pill-recording`, `16-pill-processing`, `17-consent-error`.

**Overall:** the bones are right — the tab sits exactly where the prototype decided (between Email and Activity), consent gating is legible and conservative, isolation is per-client, and the copy that exists is human. What's missing is the last mile: the recording moment doesn't say "Recording", machine artifacts (folder names, `[t:ms]` tokens, type slugs) leak into advisor-facing surfaces, and the meeting page buries its two main artifacts when audio exists. All blockers and should-fixes below are implemented on this branch; polish items are documented backlog.

---

## Blockers (fixed on this branch)

### B1 — The record pill never says "Recording", and shows "No AI connected" mid-recording
`05-recording-pill.jpg` · `RecordPill.tsx`

While recording, the floating pill showed: red dot · `12:41` · **"No AI connected"** · Stop. The one moment an advisor needs instant certainty — *is this recording, and is it private?* — the pill answered neither. Worse, the `EgressIndicator` chip surfaces AI-provider config ("No AI connected"), which reads as an error/warning and is irrelevant to where the *audio* goes. The prototype pill says **Recording** over the elapsed time plus a **Local** affordance whose tooltip reads "Nothing has left this machine. The audio is written straight to your disk."

**Fix:** pill now carries a "Recording" label above the elapsed time and a green-check "Local" affordance (tooltip: audio is written straight to this computer's disk), replacing the AI-provider chip. Stop stays the only action.

### B2 — Pill background was transparent (undefined token) 
`RecordPill.tsx:56`, `ClientMeetingsTab.tsx:234`

`background: var(--kp-surface)` — but `--kp-surface` does not exist in `globals.css` (verified: computed background `rgba(0,0,0,0)`). The pill floats over every surface; over any non-white content it became unreadable text soup. Meeting list rows had the same undefined token. `--kp-shadow-lg` is also undefined (fallback saved it).

**Fix:** pill uses `--color-card` + the design system's `--kp-shadow-3` (the "floats over everything" elevation per the reimagine elevation scale); rows use the `.kp-card` idiom (below).

### B3 — Raw `[t:724000]` machine tokens in the advisor's meeting notes
`meetingNoteTemplate.ts`, `meetingStore.ts` (`tryGenerateNotes`)

The note template *requires* every bullet to end with a literal `[t:<ms>]` token, and the generated markdown was written into `notes.docx` verbatim — so the flagship artifact of the whole feature (the AI meeting note) ended every line with `[t:513000]`-style garbage. The prototype renders these as clickable `2:15` chips. The chip renderer exists (`renderNoteWithCitations`) but is dead code — nothing calls it, because notes render through the read-only DocxEditor.

**Fix (scoped):** at generation time, tokens are converted to readable `(at 2:15)` text in the docx. Nothing else consumes the notes tokens (Client Map source links are built from `transcript.json` directly — verified `meetingSources.ts`), so this is loss-free today. **Backlog:** render notes in a dedicated pane with live citation chips that seek the audio/transcript (the prototype's signature moment) — that needs a notes-pane rework, not polish.

### B4 — With audio present, a full-page audio player buries the notes and transcript
`10-with-audio.jpg` · `MeetingEntry.tsx`, `AudioPlayer.tsx`

`MeetingEntry` reused the dictation `AudioPlayer`, which is designed as a full-surface hero: giant centered title (the raw folder name — its third appearance on one screen), an "Audio File" caption, a 128px waveform, and a 64px round play button. Measured: the audio block was 404px tall in a 376px-tall content area — notes and transcript were completely below the fold. The prototype has a slim scrub row (small play button · waveform strip · time) above the split panes.

**Fix:** `AudioPlayer` gains a `compact` variant (one horizontal row: 36px play button, waveform strip, `0:12 / 41:00` time) and `MeetingEntry` uses it. The dictation surface keeps the full-size layout.

### B5 — Raw folder names shown as meeting titles everywhere
`06-list.jpg`, `07-meeting-page.jpg` · `ClientMeetingsTab.tsx`, `MeetingEntry.tsx`

List rows titled "2026-07-04 Quarterly check-in" with "Jul 4, 2026" repeated on the meta line below; the breadcrumb and (pre-fix) the audio hero repeated the same machine string. The prototype separates a human title ("Quarterly review") from a meta line ("Jun 18 · 38 min").

**Fix:** a `meetingDisplayTitle()` helper strips the leading ISO date stamp from the folder name for display (falls back to the full name); the date (plus duration when `meeting.json` has `durationMs`) moves to the meta line only. Duration now renders as "· 41 min" per the prototype.

### B6 — "Start recording" failed silently
`ConsentDialog.tsx`, `ClientMeetingsTab.tsx` — verified live: click Start → dialog closes → nothing

Any non-macOS-permission `capture_start` failure (sidecar missing, disk full, mic in use) closed the consent dialog with zero feedback — the advisor believes they are recording when they are not. For a compliance-adjacent capture feature this is the worst possible failure shape.

**Fix:** the error message now renders inline in the consent dialog (danger text, dialog stays open), with the existing macOS-permission explainer unchanged.

### B7 — Delete audio was a single un-confirmed click
`MeetingEntry.tsx`

"Delete audio · keep transcript" permanently deleted the recording instantly. This violates the app's own core principle ("Destructive Ops — require confirmation") and every sibling surface's behavior. One mis-click destroys the only recording of a client meeting.

**Fix:** a confirm dialog (title, plain-language consequence, Cancel / "Delete audio") before deletion; the confirm restates that the transcript and notes stay.

---

## Should-fix (fixed on this branch)

### S1 — No feedback after Stop: nothing says notes are being made
`RecordPill.tsx`, `meetingStore.ts` (UI state only — no engine change)

On Stop, the pill vanished and the store silently ran transcription + note generation. The prototype's "Just finished" state exists precisely because this gap breaks trust ("did it work? where did it go?"). **Fix:** the store now exposes a `processing` flag around the post-stop pipeline; the pill stays up in a "Writing your meeting notes… you can keep working" state until it resolves, and the Meetings tab refreshes when it completes. (The full arrival card with "Open notes" stays on backlog — the processing pill closes the trust gap.)

### S2 — Two-party consent copy asserted "Your state requires everyone's consent" when the state is unknown
`ClientMeetingsTab.tsx` passes `consentModeFor(null)` — there is no per-client state on file yet — so *every* advisor saw a legal assertion that is false in 35 one-party states. **Fix:** when the state is unknown, the dialog uses conditional copy ("If your state requires everyone's consent…"); the recorded consent mode stays the conservative `two-party`.

### S3 — "Needs review" box duplicated the list right above itself
`06-list.jpg` — the same meetings appeared twice on one screen (once in the pink queue box, once as rows), and the box's accent-pink fill read as an error banner. The prototype puts status **badges on the rows** ("Needs review · 3 tasks" / "Reviewed"). **Fix:** review badges moved onto each row's right meta column; the separate queue box is gone. The "No follow-up drafted" flag no longer fires for meetings under a day old (it flagged a meeting recorded five minutes ago).

### S4 — Meeting rows: undefined-token cards, no icon, no affordance
Rows now use the design system's `.kp-card .kp-card--interactive` idiom (defined background, hover elevation per the reimagine language), with the prototype's mic icon chip, human title, and date · duration · badges meta — matching the prototype's `mrow` pattern. (Prototype deliberately uses cards for meetings; Email/Documents flat-row idiom does not govern here.)

### S5 — Record button: orphaned placement, missing trust note, raw styling
The button sat alone top-right (a full empty row above the content) as a hand-rolled `<button>`. Prototype: top-left, next to "Recorded on this Mac. Nothing is uploaded." **Fix:** moved left with the reassurance note beside it (platform-neutral copy: "Recorded on this computer. Nothing is uploaded."), styled via the shared `Button` primitive with a mic icon.

### S6 — Empty state: wrong icon, no action
`02-meetings-empty.jpg` — the empty state used a **video camera** icon (recording is audio; every other affordance uses a mic) and offered no action, leaving a first-run advisor to hunt top-right. **Fix:** mic icon + "Record a meeting" as the empty state's action button (the `EmptyState` primitive already supports `actions`).

### S7 — "Needs review · 1 items"
`en.json` had a single plural form. **Fix:** proper i18next `_one`/`_other` forms in en/de/es.

### S8 — Meeting type edit leaked the raw slug and had no cancel
`09-type-edit.jpg` — clicking "change" put `annual-review` (the internal id) in a free-text input; Escape did nothing. **Fix:** input shows the human label, Escape cancels, Enter saves (mapped back to the built-in type id when it matches one; otherwise saved as typed).

### S9 — No loading state on the list
While scanning `Meetings/`, the tab rendered nothing (blank flash, then content pops). Email shows "Loading email…", Client Map "Building client map…". **Fix:** matching muted "Loading meetings…" line.

### S10 — "Separate speakers" was the loudest element on the page
`08-speakers.jpg` — a full-width accent-filled button for a secondary utility, visually outranking every primary action. **Fix:** demoted to a normal-width secondary button; eyebrow + privacy note unchanged.

### S11 — The Activity cross-link hint was nearly invisible
The one line that teaches the tab's mental model ("each meeting also lands on the Activity timeline") rendered at the smallest token in near-invisible gray at the page bottom. **Fix:** prototype's `mv-hint` idiom — small info icon + `--kp-font-xs`, still muted but findable.

---

## Polish backlog (documented, not implemented — each still worth doing)

| # | Item | Why it can wait |
|---|---|---|
| P1 | **Citation chips in the notes pane** (click `2:15` → transcript highlights + audio plays) — the prototype's signature moment | Needs a notes-pane rework (DocxEditor is read-only in this context); `renderNoteWithCitations` is ready and now has a consumer-shaped contract |
| P2 | Post-stop **arrival card** ("Found your 41-minute meeting — notes ready · Open notes") on the Meetings tab | S1's processing pill closes the trust gap; the card is delight, not comprehension |
| P3 | **Date grouping** ("This month" / "Earlier") in the list | Low value below ~8 meetings per client |
| P4 | **Search within transcript** + copy-all / per-turn copy | Prototype has it; advisors will want it once transcripts are long |
| P5 | Inline **"name them?"** chip on unknown-speaker turns (instead of only the panel below) | Panel works; inline is faster |
| P6 | **Consent chip** on the meeting page as a green success chip (prototype `mp-consent`) instead of a plain text row | Cosmetic |
| P7 | Elapsed time **h:mm:ss past 60 minutes** | 90-min meetings show "92:11" — readable but unpolished |
| P8 | **Wealthbox / follow-up actions** on the notes footer ("Send N tasks to Wealthbox", "Draft follow-up") per prototype | Depends on the CRM write-queue surfaces landing on this page |
| P9 | Focus-visible rings on rows/chips via `--kp-focus-ring` | Global adopt-as-touched policy per the design-system doc |
| P10 | Record button **keyboard shortcut** + `aria-live` announcement when recording starts/stops | A11y follow-up |

## What already meets the bar (unchanged)

- **Tab placement and order** exactly per the locked decision (Client Map · Documents · Email · **Meetings** · Activity); active-pill styling matches the hub's tab idiom.
- **Consent dialog copy** is the plan's exact language — plain, honest, with the non-legal-advice disclaimer; the checkbox gate and disabled Start are right.
- **Per-client isolation** — the list reads only this client's `Meetings/` folder; the review queue filters by matter id.
- **Conservative consent law defaults** (`recordingConsentLaw.ts`) — unknown state → two-party.
- **i18n discipline** — fully keyed (better than Documents/Email, which still carry hardcoded strings).
- **Speaker privacy note** ("Voice profiles are stored only on this computer…") — exactly the right trust register.
- **Transcript viewer interaction** — click a turn to seek; active-segment highlight.
