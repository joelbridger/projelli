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
