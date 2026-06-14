# Making "matter" the felt spine — what shipped + what's deferred (2026-06-14)

The UX review's biggest structural idea: a matter should be the spine of the product, so
everything (Ask, documents, email, workflows) feels like a view *on a matter*, instead of six
parallel tabs. The review itself framed this as "the bigger structural bet when ready." This
doc records what was shipped safely in the autonomous fix pass and what is deliberately deferred
to a focused, Jameson-greenlit effort (so nothing is lost).

## Shipped in Wave F (safe increment)
- **Matters surface is now a launchpad.** Each matter offers quick actions (Ask / Documents /
  Email) that set it active and jump straight to that surface scoped to the matter. The matter
  becomes the place you dive in from, not just a row you select.
- **Workflows shows "Running in: <matter>"** so the matter context follows you there too.
- Combined with the Wave D aha (you already land in the sample matter's Ask) and Ask's existing
  matter scope, the matter now threads through the core surfaces.

## Deferred — needs a dedicated, greenlit effort (not done blind)
These are real review items intentionally NOT done autonomously because they restructure the
working shell and carry real regression risk; they deserve Jameson's product input first.

1. **Full matter hub (review S1, the 10x version).** Entering a matter opens a dedicated hub
   whose sub-views (Ask / Documents / Email / Workflows) are all pre-scoped to that matter, and
   the top-level nav collapses (e.g. Matters as home + a couple of cross-matter tools). This is a
   fundamental change to the navigation model and the App.tsx render tree. It should be designed
   with Jameson and migrated carefully behind the reimagined-shell flag, with its own test pass.
2. **Persistent Documents split (review C4).** Replace the browser <-> editor toggle with a
   persistent file list on the left + document on the right (Finder/VS Code style), so you never
   lose your place. Deferred because it reworks the view logic touched in Wave A; lower risk once
   done deliberately. The current back-bar flow works in the meantime.
3. **Unify the two Ask experiences (review C6).** Fold the Email "Ask AI" mode into one
   "Ask anything" surface with a scope toggle (All matters / This matter / Email / Documents).
   Overlaps the hub work above; best done together so scoping is one consistent control.
4. **Consistent primary-action placement (review C2).** A cross-surface pass so "the thing you
   do" sits in the same place on every surface. Low individual value, spread risk; fold into the
   hub work.
5. **Celebrate the Isolated matter (review S3).** A confirmation/shield moment when a matter's
   network lockdown is enabled, making the cryptographic privilege protection feel owned. The
   status-bar "Isolated matter" badge already exists; this is the active-confirmation polish.

## Why this split
The shell is in a strong, stable place after Waves A-E (bugs fixed, language plain, funnel
reshaped, the aha landed, chrome tidied, full suite green). The items above are the difference
between "good" and "extraordinary," but they change navigation fundamentals. The right path is a
focused follow-up where Jameson sees mockups of the hub before it replaces the current nav, not a
blind autonomous restructure that risks the working product.
