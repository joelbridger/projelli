# Verdict: NOT_TESTED

This Windows privacy drive stopped before it opened, changed, signed in to, or closed any Lantern app. A harmless proof screenshot showed a separate active Lantern debug app on Legion. Its process was read-only verified as `C:\\keepance\\src-tauri\\target\\debug\\lantern.exe` in the logged-in desktop session. That violates this lane's single-bench-owner preflight rule.

**First blocker:** `NOT_TESTED / ANOTHER ACTIVE LANTERN BENCH OWNER`.

The required accepted executable, fresh `-01` root absence, scheduled screen helper, HTTPS reachability, and synthetic-source checks were measured before the stop. The protected advisor credential file was only permission-checked on the server; its contents were never read, copied, or used. No temporary credential file, app profile, cloned workspace, native dialog, account action, seat action, Whole Firm action, provider action, send, build, install, or M3 action occurred.

The tunnel used only server loopback and was closed. The screen helper was returned to its preflight running state. Cleanup is recorded in [receipt.json](receipt.json); it does not change the product verdict.

Run `python3 verify.py` from this directory to validate the evidence boundary.
