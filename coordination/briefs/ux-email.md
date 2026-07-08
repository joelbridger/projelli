# Lane L5 — EMAIL (worktree /home/jameson/lp-ux-email, branch lp/ux-email)

Audit file: `email.md` (24 items). Implement all HIGH+MED per common rules. Notes:

- CORRECTION C1 OVERRIDES item 8: AI search does NOT move behind a sparkle icon or get demoted. Keep it as prominent as today; DO simplify its teaching copy per item 8's rewrites (shorter hint, two example chips) and DO hide scores/raw mail IDs (item 7).
- Item 1 (collapse always-open reply composer) + 9 (one primary Send after reply opens) are the biggest wins: read view = compact action row (`Reply` primary, `Draft with AI` secondary, `...` menu), composer expands on demand. Send errors/reconnect warnings stay visible once reply is open (protected).
- Item 2 (sensitivity pill + menu): the amber explanation stays visible while a sensitive state is active (TrustNote, warning variant).
- Items 3+17: one searchable filing dropdown pattern everywhere (reader, bulk, popover). Item 16: slim bulk bar.
- Item 6 + finding F5: ONE empty state total — when the rail is empty, the rail shows one muted line; the pane carries the single full empty state. Never two side-by-side empties.
- Item 4: Export strip dies; `Save email` into the reader `...` menu; failures become inline menu error/toast.
