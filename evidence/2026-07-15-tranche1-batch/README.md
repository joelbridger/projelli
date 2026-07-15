# Tranche-1 batch vision-parity + record-lane packaged-drive evidence

Build reviewed: `a6952a0acfe39d82b0375fcbd6be2ffd16d0b230` (combined tip, `v1/evidence-tranche1-batch` branch)

Reviewer: Claude Sonnet, high effort — independent vision lane, no product code changed.

This folder covers the 7 tranche-1 surfaces still open after merges #2-#8: the 4 record-depth
lanes (compliance-dates, employment, investment-profile, professional-contacts), booking-public-page,
shared-client-bar, and teams-roles. `crm-trash-recovery` and `v1-shell-frame` already have their own
committed per-lane evidence at `evidence/2026-07-15-trash-recovery/` and
`evidence/2026-07-15-v1-shell-frame/` and are not repeated here.

Both deliverables below were captured against the same SHA-pinned packaged binary —
`259173163ba6627c905e2131eb8c14d1a122e9c99b3b5a78e5211362c662af63`, built from this
worktree's exact HEAD. See "Bench and build" for why a private cargo target dir was
needed partway through.

## Deliverable A — vision-parity checklists

| # | Surface | Flag | Verdict |
|---|---|---|---|
| 1 | record-compliance-dates | `record-compliance-dates` | **PASS** |
| 2 | record-employment | `record-employment` | **PASS** |
| 3 | record-investment-profile | `record-investment-profile` | **PASS** |
| 4 | record-professional-contacts | `record-professional-contacts` | **PASS** (one minor cosmetic indentation note) |
| 5 | booking-public-page | `booking-public-page` | **PASS** on component fidelity; **honest gap** — no in-app navigation entry point exists yet (see `checklists/05-booking-public-page.md`) |
| 6 | shared-client-bar | `shared-client-bar` | **PASS** |
| 7 | teams-roles | `teams-roles` | **PASS** |

Full detail, frozen-prototype references, and every delta (expected or otherwise) are in `checklists/0N-*.md`. The four record sections all show the same **expected structural delta**: the frozen prototype nests them as four subsections inside one unified "Client profile" card; the real app renders each as its own separate top-level card, per the "one lane, one folder, one card" architecture law. This is deliberate, not a defect — see `05-records-all-on.png` for the visual.

## Deliverable B — packaged batch drive of the 4 record lanes

**PASS.** See `PACKAGED-DRIVE.md` for full detail. Real data was entered through each of the four record sections' own Save actions, the app was fully restarted, and rehydration was verified both natively (`extensionData` byte-identical before/after in `records-drive-state.json`) and visually (`11-records-entered-before-restart.png` / `12-records-rehydrated-after-restart.png`).

## Files

- `vision-drive.mjs` / `run-vision-drive.sh` — Deliverable A drive: one real app launch, screenshots all 7 surfaces by toggling each surface's own dev flag override live.
- `records-drive.mjs` / `run-records-drive.sh` — Deliverable B drive: real data entered through each of the 4 record sections' own Save actions, full app restart, rehydration verified both natively (`crm_live_list` extensionData byte-compare) and visually.
- `checklists/0N-*.md` — per-surface Sonnet vision checklists against the frozen prototype.
- `records-drive-state.json` — exact `extensionData` captured before restart, for the byte-compare.
- Screenshots, named `NN-<surface>-<state>.png`:
  - `00` flags-off absence proof, `01`-`04` each record section isolated, `05` all four together (hierarchy comparison)
  - `06`/`06b` booking public page (pick-time / confirmation-information)
  - `07`/`08` shared client bar (bar / picker modal)
  - `09`/`10` teams-roles (People+Teams / role matrix expanded)
  - `11`/`12` packaged restart drive (before / after restart)
- `vision-drive.log` / `records-drive.log` — full runner transcripts from the passing runs.
- `PACKAGED-DRIVE.md` — Deliverable B detail, including the binary-identity incident and fix.

## Bench and build

- **Bench co-tenancy:** port 5174 (the shared app bench) was held by a co-tenant worktree (`v1-1b2-internal-projects`, pid 1771156, its own Vite dev server) for roughly the first 45 minutes of this session. Per the hard bench rule, this lane printed `COORDINATOR: possible co-tenant on the bench`, never killed it, and waited for it to clear before starting any drive.
- **Binary-identity incident:** the packaged binary was first built at the shared, box-wide `CARGO_TARGET_DIR` (`/mnt/devcache/cargo-target`). Partway through this lane's work, another concurrent lane's own build silently overwrote that shared binary — its SHA changed between two of this lane's script invocations with no rebuild run by this lane in between. Caught by re-checking the SHA before Deliverable B; fixed by rebuilding in a private `CARGO_TARGET_DIR=/mnt/devcache/cargo-target-tranche1batch` exclusive to this lane, then **re-running both deliverables** against that binary so every screenshot and every restart-proof artifact in this folder shares one verified, stable identity (`259173163ba6627c905e2131eb8c14d1a122e9c99b3b5a78e5211362c662af63`).
- **Environment setup (not product changes):** this fresh worktree had neither `node_modules` (installed via `npm ci` against the committed lockfile) nor two Tauri sidecar binaries required by `tauri.conf.json`'s `externalBin` (fetched via the repo's own pinned, checksum-verified `scripts/fetch-piper-sidecar.sh` and `scripts/fetch-llama-sidecar.sh`). Both are gitignored, publicly-released artifacts — no product source was touched.
