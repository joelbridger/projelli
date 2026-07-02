# Lantern-Plus Prototype Design Brief

*Fable, 2026-07-02. This brief directs the clickable HTML prototypes for the Jump
feature-parity program. Governing documents: `docs/plans/lantern-plus/2026-07-02-UI-INTEGRATION-SPEC.md`
(the constitution) and `docs/design/lantern-plus-ui-audit/` (the ground truth —
DESIGN-TOKENS.md is mandatory reading; prototypes must be visually indistinguishable
from the real product).*

## Purpose

These prototypes are (1) the medium for Jameson's design direction — he reviews by
clicking, not by reading specs — and (2) once approved, the **binding acceptance
artifact** for the 4.8 execution agents ("matches the approved prototype" is the test).

## The bar

An advisor who has used Lantern for a week should be unable to tell these features
are new. No new visual vocabulary, no new navigation, no learning curve. Jump's
failure — surfaces bolted onto surfaces — is the anti-pattern; every prototype should
feel like the product finally doing what it obviously should have done all along.

## Prototypes to build (Waves 0–2 scope, plus one north star)

### P1 — The morning moment (Wave 1's flagship)
MattersHome with the "Today: Hendersons 10:00 · Ortiz 1:30" strip. States: (a) two
matched meetings; (b) one unmatched meeting greyed with "Whose meeting is this?" —
clicking it opens the one-click assign that teaches the mapping (show the moment of
teaching: pick client → tiny confirmation "Got it — future Acme Planning calls file
here"); (c) empty (no meetings today — the strip simply isn't there; show that
MattersHome looks untouched).

### P2 — Before you meet (Wave 1)
A single client's Map with the brief strip: five bullets, each with a real-looking
source chip (a statement PDF, an email, a Calendly meeting, a CRM fact). Interactions:
expand/collapse; hover a chip → source preview affordance; the one-keystroke "Export
brief (Word)" affordance; the quiet shimmer state while a brief is still generating
(never a spinner, never blocking). Include honest microcopy: "Prepared 8:02 this
morning · refreshes while the app is open."

### P3 — The Wealthbox stamp (Wave 2)
A client timeline entry with the collapsed card "Update Wealthbox: 1 note · 3 tasks."
Click → expands to tracked-changes-style rows (green additions; each row toggleable),
one primary **Approve** button. States: (a) standard; (b) multi-household matter —
the explicit household picker inside the card; (c) after approve — rows show quiet ✓
"In Wealthbox," card collapses to a receipt line; (d) one row failed — inline retry,
not a toast.

### P4 — Draft follow-up (Wave 0)
From the docx editor: the toolbar button (placed beside Export per the Wave 0 plan),
opening the single modal: recipient (prefilled, editable), subject, body with inline
citation chips, "Save to my Drafts" primary + "Send" secondary. Include the hover
state on a citation chip showing its source line. One state only — this feature IS
one modal; if it needs a second screen we designed it wrong.

### P5 — Calendar connection (Wave 1)
The Connections surface with the one new Calendar card (Microsoft / Google / paste an
ICS link) matching the existing connector cards exactly. Show connected state with
the honest sync line ("Read-only · past 7 days + next 14"). This prototype exists to
prove the feature adds ONE card and zero settings pages.

### P6 — North star (Wave 3 preview — clearly watermarked "GATED: not in current build scope")
The meeting timeline entry ("Meeting · Jun 30 · 41 min") opening notes-left /
transcript-right / audio scrubber on top, one fact chip that highlights a transcript
moment (the click-a-fact-hear-the-moment demo), and the floating record pill with the
green egress dot. Built last, only if budget remains after P1–P5 are approved; it
aligns everyone on where this is going.

## Rules for builders

1. **Tokens and components come from DESIGN-TOKENS.md** — real hex values, real
   radii, real class recipes, verbatim component structures. No invented styles, no
   generic Tailwind defaults, no dark theme.
2. Base each prototype on the corresponding audit screenshot's actual layout —
   recreate the surrounding screen faithfully enough that the new element's fit is
   judgeable. The point is evaluating integration, not the feature in a vacuum.
3. Self-contained HTML per prototype (inline CSS/JS, no CDNs), realistic advisor data
   (the Northcrest demo cast: Hendersons, Ortiz…), light theme, 1440-wide desktop
   frame. Interactions per prototype are small state machines (plain JS) — enough to
   click through the states listed, no more.
4. Every prototype page carries a slim header bar: prototype name, wave, the states
   it demonstrates (clickable), and a "notes for Jameson" footnote listing the 2-3
   design decisions embedded that most want his reaction.
5. An `index.html` links all prototypes with one-line descriptions.
6. Microcopy follows the UI spec §2 rules (plain, warm, honest, no em dashes).

## Review protocol

Round 1: Jameson clicks through all prototypes, reacts freely (voice notes,
screenshots with scribbles, plain text — anything). Each reaction becomes a revision;
Round 2 targets sign-off. Approved prototypes are frozen (`APPROVED-` filename
prefix) and referenced by the wave plans' UI tasks as acceptance criteria. Design
authority is Jameson's; ties break toward LESS: fewer elements, fewer states, fewer
words.
