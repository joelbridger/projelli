# CRM Trash & recovery — packaged restart evidence

Date: 2026-07-15 UTC

Product build: `5c78629e27f2a886e5b041b6736d779c24216c5f`

Binary SHA-256: `fbb244d6b54847d0f4c3e26d38539dad1e22c6662f663703ab641a038df1a791`

The earlier `/tmp/crm-trash-recovery-final.png` existed, but it was not used as evidence for this round. Every image here was captured fresh from the exact product build above.

## Restart drive result

PASS: a real household was written to the encrypted CRM store, soft-deleted through the public `trashClient` entry point, and shown in Trash with an exact 30-day expiry. The app process and bridge were fully stopped. After launch two, the same timestamps and “30 days remaining” survived. The visible Recover button restored the record. The app was fully stopped again. After launch three, the record remained out of Trash and was visible in the Clients directory.

The headless app was run with a private, unlocked Secret Service keychain. This exercised the normal encrypted audit-store path without reading or changing Jameson’s real keychain. It did not bypass audit persistence.

## Files

- `packaged-restart-drive.log` — complete drive log with build identity and all PASS lines.
- `drive-state.json` — exact deletion and expiry timestamps; their difference is exactly 30 days.
- `01-deleted-before-restart.png` — visible Trash row immediately after soft-delete.
- `02-trash-after-restart.png` — visible Trash row after the first full restart; primary prototype-parity image.
- `03-recovered-before-restart.png` — empty Trash state after using Recover.
- `04-record-back-after-restart.png` — restored household visible in Clients after the second full restart.
- `sonnet-vision-checklist.md` — independent Sonnet visual comparison against frozen `trashSettings()`; overall PASS.
- `drive.mjs` and `run-drive.sh` — repeatable evidence runner.

## Attestations

PACKAGED-RESTART-DRIVE: PASS

EXACT-BUILD-IDENTITY: PASS

30-DAY-TIMESTAMP-DURABILITY: PASS

RECOVER-AFTER-RESTART: PASS

RESTORED-AFTER-SECOND-RESTART: PASS

SONNET-PROTOTYPE-PARITY: PASS
