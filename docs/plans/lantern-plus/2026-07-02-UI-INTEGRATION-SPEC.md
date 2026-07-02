# UI Integration Spec — the binding design contract for all Lantern-Plus waves

> **Rank:** co-equal with the master plan. Every UI task in every wave plan is governed
> by this spec. Where a wave plan's UI step and this spec disagree, THIS SPEC WINS and
> the executor notes the deviation in the merge note.
>
> **Why this exists:** Jump's product is feature-rich and experience-poor — scattered
> surfaces, configuration sprawl, "connect 60 things." Our features win only if they are
> **intuitive, simple, and almost invisible**: folded into the existing UI so naturally
> that an advisor cannot tell where the old product ends and the new features begin.
> The UI is not the wrapper around this program's value. It IS the value.

## 1. The design constitution (unchanged, non-negotiable)

1. **Three tabs, forever.** Client Map · Ask · Workflows. Nothing in this program adds
   a GLOBAL tab, a sidebar section, or a standalone window. If a feature seems to need
   one, the feature is designed wrong — redesign, don't expand. *(Clarified 2026-07-02,
   Jameson's decision: the PER-CLIENT tab row — Client Map · Documents · Email ·
   Meetings · Activity — is a different thing; it may grow when the client-container
   logic demands it. The Meetings tab on each client is the one sanctioned instance;
   see DESIGN-DECISIONS.md.)*
2. **The client is the container.** No global inboxes: no meetings list, no notes list,
   no tasks inbox, no briefs library. Everything about the Hendersons appears on the
   Hendersons' timeline/Map. The user's one mental model: *"Where is it? On the client."*
3. **A meeting is just another source.** A transcript sits on the timeline next to a
   PDF and an email — same chip style, same citation behavior, same Ask treatment.
   Zero new concepts for the user to learn.
4. **Defaults you edit, not options you configure.** No template pickers, no field
   mappers, no per-feature settings pages. The app guesses well, shows its work, and
   learns from the user's edits. If a feature needs a settings page to be usable,
   redesign the feature (connector auth screens are the one exception — one card each,
   in the existing Connections surface).
5. **AI proposes, you approve — as a stamp, not a nag.** Every outbound write (CRM,
   email) is one clean preview rendered in the product's tracked-changes visual
   language, with ONE primary Approve action. Never a modal chain, never a background
   send, never a confirmation-of-a-confirmation.

## 2. Visual & interaction vocabulary (use ONLY these, never invent parallels)

- **Design system:** existing `src/ui/` primitives + `src/ui/kp/` components,
  shadcn/Radix + Tailwind, light theme. New UI composes existing primitives; a new
  primitive requires a named justification in the merge note.
- **Chips** (source/citation chips as used in Ask) are the universal "this came from
  somewhere" affordance — calendar events, transcript moments, imported Jump notes,
  CRM facts all wear the same chip, differing only in icon + label.
- **Strips** (horizontal, collapsible, top-of-panel — the Client Map's existing tray
  pattern, cf. `ClientMapUpdatesTray`) are the universal "the app prepared something
  for you" affordance — Today's meetings, Before-you-meet, "3 open action items,"
  "2 new facts from Tuesday's meeting" all render as strips. Strips never demand;
  they offer. Dismissing a strip is always one click and never destroys data.
- **The pill** (floating, corner, small) is reserved for LIVE states only — recording
  in progress (elapsed time + green egress dot). Nothing else floats. Ever.
- **Tracked-changes green/red** is the visual language for "AI proposes" — CRM write
  previews and Map fact updates render as insertions, exactly like the Word redline
  UI users already know from this product.
- **The egress indicator** is the trust anchor. Features in this program must never
  cover, move, or duplicate it — they REFERENCE it (the record pill embeds its dot).
- **Microcopy:** plain, warm, specific; sentence case; contractions welcome; no
  jargon (say "your meeting audio," never "loopback stream"); no em dashes; honest
  about limits ("Briefs refresh while the app is open"). Voice per the repo's
  existing marketing-voice rules.

## 3. Per-feature integration (the exact folds)

**Wave 0 — Draft follow-up.** One button, in the toolbar the user already uses
(FormattingToolbar for text/markdown; DocxEditor's inline toolbar, beside Export, for
Word docs). Opens ONE modal: recipient (prefilled, editable), subject, body, and two
actions — "Save to my Drafts" (primary) and "Send." Citations render as inline chips
in the preview. No mode switches, no template choice, no tone dropdown. The modal is
the entire feature.

**Wave 0 — Imported meeting notes.** No new surface at all: imported Jump/Zocks notes
appear on the client timeline with a small provenance label on the existing chip
("Jump meeting note"). One filter chip in the existing section panel. That's it —
the feature is *recognition*, and recognition should feel like the app simply knew.

**Wave 1 — Today's meetings + Before-you-meet.** THE flagship moment; polish budget
concentrates here. Morning open → one strip atop Client Map home: "Today: Hendersons
10:00 · Ortiz 1:30." Click a name → that client's Map, where "Before you meet" is
ALREADY THERE — five bullets, each with a source chip, no Generate button, no spinner
(generation happened at app-open in the background; if still running, the strip shows
a quiet shimmer, never a blocking state). One keystroke exports a printable Word
brief. Unmatched meetings appear greyed with "Whose meeting is this?" — one click
assigns AND teaches the mapping permanently. Calendar setup: one card in Connections
(Microsoft / Google / paste an ICS link), zero other options.

**Wave 2 — CRM write-back.** After any note/meeting with extractable content, ONE
card on that client's timeline entry: "Update Wealthbox: 1 note · 3 tasks." Expanded:
tracked-changes-style rows, each toggleable, one Approve button. Approved rows show a
quiet ✓ with "In Wealthbox." Failures show retry inline — never a toast that
disappears with the user's trust. NEVER auto-send; NEVER a field-mapping screen;
multi-household matters get an explicit picker inside the same card.

**Wave 3 — Meeting capture.** The whole surface is: (a) a strip offer when a meeting
is detected/scheduled ("Meeting with the Hendersons in 4 min — record it?"), (b) the
record pill while live (elapsed + green dot + Stop), (c) a consent line at start
(state-aware copy, one "Consent noted" action, stamped forever on the entry), and
(d) a timeline entry when done ("Meeting · Jun 30 · 41 min") opening notes-left /
transcript-right / audio-scrubber-top. Templates: none visible — every meeting gets
the default note shape; if the user restructures a note, offer once: "Keep this shape
for future meeting notes?" Crash recovery is a gentle card ("Found Tuesday's
recording — finish the notes?"), never an error dialog. Retention is one honest
action on the entry: "Delete audio · keep transcript." *(Additions 2026-07-02, completeness
sweep:)* the client's Meetings tab opens with a quiet **"Needs review"** strip
(unreviewed notes, waiting CRM updates, undrafted follow-ups) — per-client ONLY, never
a practice-wide queue (Jameson's explicit refusal); the meeting header wears a small
**type chip** ("Annual review · change") whose correction teaches future detection —
type management never gets a settings page; and a one-line **"Topics covered"** row
lists tracked keywords, each chip seeking the transcript moment.

**Wave 4 — Book view, cross-client Ask, voice naming.** Book view = a scope toggle
inside the existing Client Map home (the existing SegmentedToggle), not a dashboard —
a ranked client list with completeness/staleness, click-through to each Map. Ask
gains a permanent scope pill ("Asking: the Hendersons · 214 files · 6 meetings" /
"Whole practice (summaries only)") — always visible, one click to switch. Voiceprint
naming happens inline in the transcript ("Speaker 2 — who is this?" → type a name
once), never in a settings screen; deleting a voiceprint lives on the client's page.

## 4. The anti-roadmap (refusals that protect the experience)

No fourth tab · no meetings/notes/tasks inboxes · no template gallery · no field
mappers · no per-feature settings pages · no dashboards · no floating UI except the
record pill · no toasts for outcomes that matter · no configuration step before value
appears · no "beta" ribbons — a feature ships finished or not at all.

## 5. Execution rules for UI tasks (binding on every wave)

1. **Invoke the `frontend-design` skill** for any new visible surface, styled within
   the existing design system (it raises craft; it does not license novelty).
2. **Screenshot evidence at every UI merge:** before a wave merges, the coordinator
   captures the feature in the browser build (and on the Legion for desktop-only
   surfaces) and attaches screenshots to the merge note AND sends them to Jameson via
   notify-jameson (MILESTONE). Jameson is a product designer: screenshots are how he
   reviews. His veto reopens the wave; do not block the merge waiting, but treat his
   feedback as a P0 follow-up task.
3. **The five signature demo moments** (feasibility `research/brainstorm-simplicity-ux.md`
   §"Signature moments") are acceptance criteria, not marketing: un-droppable
   recording, works-with-Wi-Fi-pulled, click-a-fact-hear-the-moment, folder-in-Map-out,
   no-bot-in-the-room. Wave gates check the ones their wave enables.
4. **Copy review:** all user-facing strings in a wave are collected in one place in
   the merge note for a single read-through against §2's microcopy rules.
5. **Count the clicks.** Every feature's happy path is measured in the merge note:
   record a meeting = 1 click; approve CRM updates = 2 (expand, approve); draft
   follow-up = 1 click + edit + 1. If a happy path grows past its number, that's a
   design regression and blocks the merge.
