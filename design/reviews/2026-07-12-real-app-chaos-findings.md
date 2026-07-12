# Real-app chaos findings — 2026-07-12

This test suite starts the actual desktop application through its debug bridge,
uses a fresh on-disk workspace for every case, and kills the application with
`SIGKILL`. It does not replace the encrypted store with a mock.

## Run result

`npm run test:chaos` was run on 2026-07-12. It started a real app process,
connected to the real desktop bridge, and then stopped at the required visible
screen check: `crm-home` never mounted after the workspace was set.

Every named crash test therefore reports `DATALOSS:` and exits red. This is
deliberate. Running hidden Tauri commands after the visible app has failed to
open would prove an engine, not an advisor's real workflow.

Once the workspace-to-CRM-screen blocker is fixed, the runner proceeds to:

- confirm a live-record save survives a fresh desktop process;
- cut power during a live-record request and accept only no record or a
  complete record;
- interrupt a fabricated Wealthbox import, resume it, and require the
  attachment `0% via API` fidelity row.

## DATALOSS findings left red on purpose

1. **Propagation apply is not wired to its transactional outbox.** The core has
   a transaction that can put instance state, immutable operations, activity,
   and notification intent together. The running workflow screen saves live
   records separately instead. A hard stop can therefore leave the two user
   promises apart. The test reports `DATALOSS:` until the visible Apply action
   uses the one transaction.
2. **Offline queue survival is not proven in the real app.** The screen-level
   record flow has no persisted offline mutation queue plus relay acknowledgement
   to observe after a restart. It must not be described as crash-safe syncing.
3. **Checkpoint/compaction is not a mounted CRM app operation.** Engine-level
   checks do not prove a desktop process survives the actual storage-maintenance
   boundary. A real command and a visible recovery state are needed.
4. **Disk-full and read-only storage have no deterministic fault injection.**
   A chmod trick is not a disk-full test. The test remains red until the store
   can be made to return a genuine write failure and the desktop UI reports it.

Run with `npm run test:chaos`. Any `DATALOSS:` line is a release-blocking data
integrity finding, not a flaky test and not an invitation to weaken the check.
