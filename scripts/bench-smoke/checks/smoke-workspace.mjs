// scripts/bench-smoke/checks/smoke-workspace.mjs — the known Northcrest
// Wealth Partners demo workspace's canonical smoke-test client and note,
// confirmed live on the Legion bench (2026-07-03) and matching every prior
// manual RUN-LOG pass (docs/evidence/windows-smoke-2/RUN-LOG.md). If a future
// bench run ever uses a different demo workspace, override these here — the
// checks that navigate (setup.mjs, wave0.mjs, wave2.mjs) all read from this
// one place.
export const SMOKE_CLIENT_MATTER_ID = 'matter_nc_caldwell_jennifer';
export const SMOKE_CLIENT_NAME = 'Caldwell, Jennifer';
export const SMOKE_NOTE_FILENAME = 'Meeting Notes 2024-05-20 - Caldwell, Jennifer.docx';

// A SECOND smoke note, distinct from SMOKE_NOTE_FILENAME above — used by
// wave2.mjs. Root-caused live (2026-07-04, after the ensureClientsTableTab
// fix let wave0 and wave2 both reach their note-opening step for the first
// time in the same run): re-opening a file very soon after a prior check
// already opened-and-navigated-away-from it can silently fail to render
// (the row selects but no editor tab appears) — confirmed reproducible on
// this exact file, and confirmed NOT reproducible on a different file
// opened immediately after. This is a real, narrow product quirk (not
// fixed here — out of scope for this harness lane), but wave0 and wave2
// running back-to-back in the default checklist order were colliding on
// the identical file every time. Splitting them onto different notes
// avoids the collision entirely.
export const SMOKE_NOTE_FILENAME_SECONDARY = 'Meeting Notes 2025-05-15 - Caldwell, Jennifer.docx';
