# Questions for Jameson (documented per his 2026-07-04 instruction; answered when he has time — work continues on stated defaults)

| # | Question | My default (proceeding on this) |
|---|----------|-------------------------------|
| 1 | Zoom + Google Meet test accounts: may I create free test accounts (Zoom free tier; a Google account for Meet) for the live-call recording verification, using the demo identity (Sarah Morgan pattern)? | Yes-by-default for a Zoom free account with demo credentials stored in demo-creds/; for Google I'll first check whether an existing test Google identity is available in the password manager rather than creating a new one. |
| 2 | Mac meeting capture: the capture-mac sidecar needs real Mac hardware time (the M1 bench). Priority relative to the Windows QA campaign? | Default: AFTER the Wave-3 UI ships and passes its Legion end-to-end; then an M1 bench session builds+verifies the sidecar. |
| 3 | The 9 Jump battle-plan board decisions (publicity aggressiveness, pricing pilot, brand, switch-credit, legal review, etc.) — ready whenever you are; nothing blocks engineering. | No default — genuinely board-level; parked until you engage. |
| 4 | The bench browser on the Legion is your personal Chrome profile (your password manager was incidentally visible during the OAuth test). OK to create a separate dedicated browser profile for bench automation? | Yes-by-default; queued in the cleanup backlog. |
| 5 | Azure quota for a 3rd cloud bench was denied (account too new). Want me to retry in a week, or is 2 cloud benches + the Legion enough? | Default: 2 clouds + Legion is enough; retry only if sharding becomes the bottleneck. |
