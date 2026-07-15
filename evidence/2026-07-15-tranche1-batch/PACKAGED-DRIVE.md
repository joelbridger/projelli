# Tranche-1 batch packaged-drive evidence — 4 record lanes

Date: 2026-07-15 UTC

Product build reviewed: `a6952a0acfe39d82b0375fcbd6be2ffd16d0b230` (combined tip, `v1/evidence-tranche1-batch` branch)

This is a real Linux Tauri debug-app drive through the app's native development bridge, covering both deliverables in this folder:

- **Deliverable A (vision-parity)** — one continuous real app launch that toggled each of the 7 surfaces' own dev flag override live and screenshotted it. See `README.md` and `checklists/`.
- **Deliverable B (this file)** — a packaged restart proof for the 4 record-depth lanes: real data entered through each section's own Save action, a full app process restart, and rehydration verified two ways (native `extensionData` byte-compare and the live UI).

## Binary identity

The shared box-wide cargo target dir (`/mnt/devcache/cargo-target`) is shared across every active worktree/lane on this server. Partway through this drive, another concurrent lane's build silently replaced the binary at that shared path out from under this lane (its SHA changed between two of this lane's own script invocations, with no build run by this lane in between). Continuing on the shared path would have invalidated the SHA pin without any visible warning.

**Fix:** rebuilt with a private `CARGO_TARGET_DIR=/mnt/devcache/cargo-target-tranche1batch`, exclusive to this lane, then re-ran **both** deliverables against that binary so the whole evidence set in this folder shares one, verifiably-stable identity.

```text
cargo build --manifest-path src-tauri/Cargo.toml    # (CARGO_TARGET_DIR=/mnt/devcache/cargo-target-tranche1batch)
```

Binary: `/mnt/devcache/cargo-target-tranche1batch/debug/lantern`

Binary SHA-256: `259173163ba6627c905e2131eb8c14d1a122e9c99b3b5a78e5211362c662af63`

Verified unchanged (`sha256sum`) immediately before and immediately after both the vision-parity drive and this restart drive — this lane held it exclusively for the whole evidence-capture window.

Two sidecar assets referenced by `tauri.conf.json`'s `externalBin` (`binaries/piper-x86_64-unknown-linux-gnu`, `binaries/llama-server-x86_64-unknown-linux-gnu`) were missing from this fresh worktree and were fetched via the repo's own pinned, checksum-verified fetch scripts (`scripts/fetch-piper-sidecar.sh`, `scripts/fetch-llama-sidecar.sh`) before the build — public released artifacts, gitignored, no product code touched.

`node_modules` was also missing from this fresh worktree (git worktrees do not share it) and was installed via `npm ci` against the committed lockfile before any drive ran.

## Bench preflight

This lane owns port 5174 (the shared app bench) and the Tauri dev bridge port for the duration of its drive. Another worktree (`v1-1b2-internal-projects`) held port 5174 with its own Vite server for roughly the first 45 minutes of this lane's session; per the hard bench rule this lane printed `COORDINATOR: possible co-tenant on the bench`, did not kill it, and waited it out rather than proceeding on an unverified frontend. Once free, this drive started and owned its own private Vite server (verified free before binding, refuses to run if already occupied).

## Fixture

The household used for this drive contains no client data and exists only in the isolated drive workspace:

- `tranche1-batch-records-household` — "Okafor record-lanes household", primary advisor Priya Shah, members Amara Okafor and Chidi Okafor.

## Restart drive result

**PASS.** With all four record flags (`record-compliance-dates`, `record-employment`, `record-investment-profile`, `record-professional-contacts`) enabled:

1. **Enter** — real data was typed into all four record sections through their own UI Save actions (not a native shortcut): written-agreement dates via the compliance-dates edit form, Amara Okafor's occupation/employer/dates/income via the employment edit form, investment objective/risk tolerance/time horizon/liquidity need via the investment-profile form, and a CPA contact (Thomas Lee) via the professional-contacts inline editor. The record was re-opened (leaving and re-entering the household) to confirm the render reflects the saved store, not just local component state, then screenshotted (`11-records-entered-before-restart.png`).
2. **Restart** — the app process and dev bridge were fully stopped and health-polled until gone, then a second app instance was launched against the same workspace.
3. **Verify** — after the restart, the native `crm_live_list` record's `extensionData` was byte-compared against the exact object captured before the restart (see `records-drive-state.json`) and found identical. The household record was then re-opened in the UI; all four sections rehydrated their real values (screenshotted as `12-records-rehydrated-after-restart.png`): the written-agreement dates, "Managing partner, Okafor & Lane Architects" occupation, the CPA contact "Thomas Lee, CPA · Accountant · Lee & Partners", and the investment-profile fields all matched what was entered before the restart.

This proves the `extensionData` load path — the mechanism by which all four record extensions persist through `household.extensionData[<namespaced-key>]` and rehydrate on load — works correctly across a real process restart, not just within one render session.

## Files

- `records-drive.mjs` / `run-records-drive.sh` — repeatable packaged-drive runner (SHA-pinned binary check, private D-Bus + keychain, workspace isolation, two full app launches with a real restart between them).
- `records-drive.log` — full runner transcript from the passing run.
- `records-drive-state.json` — the exact `extensionData` object captured before the restart, used for the byte-compare.
- `11-records-entered-before-restart.png`, `12-records-rehydrated-after-restart.png`.

## Attestations

PACKAGED-RESTART-DRIVE: PASS

EXACT-BUILD-IDENTITY: PASS (private target dir; SHA verified stable across the whole drive after the shared-path collision was caught and fixed)

REAL-UI-DATA-ENTRY (not native-only seeding): PASS — all four sections' values were typed and saved through their own edit UI

EXTENSIONDATA-BYTE-IDENTICAL-ACROSS-RESTART: PASS

ALL-FOUR-SECTIONS-REHYDRATED-IN-UI: PASS
