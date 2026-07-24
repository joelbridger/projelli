# M2 private-note Legion camera-observer evidence

## Verdict: NOT_TESTED

The new read-only camera exception was proven from current Legion facts. The
camera task starts only the pinned Python program and `bench_cam.py`; its one
local listener is `127.0.0.1:8799`; source exposes only `GET /size` and `GET
/shot`; non-read requests were refused and plausible control paths returned
404. A fresh full-screen camera frame was saved and hashed.

The run then stopped at the ownership gate, before the fresh `-03` root was
checked or created and before any app or helper input. An additional interactive
process, `InputDirectorSessionHelper.exe` (PID 9388), was active in the logged-in
desktop session. Its name and installed product identify it as a mouse/keyboard
input-control helper, not the allowed camera or this lane's input helper. The
single-owner rule therefore requires this terminal result:

`NOT_TESTED / ANOTHER ACTIVE LANTERN BENCH OWNER`

No product claim is made. No Lantern app was launched, no credential was read or
transferred, and no workspace, seat, staff, Whole Firm, provider, send, build,
install, restart, or M3 action occurred. The camera-only SSH tunnel used to
collect its required frame was closed during non-gating cleanup.

The prior old attempts remain reference-only and are not reclassified:

- Attempt 1: job `20260724-153859-4of2xxxx`, commit `a5f645534`,
  `NOT_TESTED / ANOTHER ACTIVE LANTERN BENCH OWNER`.
- Attempt 2: job `20260724-160217-iorfxxxx`, commit `4d11af28`,
  `NOT_TESTED / ANOTHER ACTIVE LANTERN BENCH OWNER`.

Run `python3 verify.py` in this directory to validate the fail-closed evidence.
