# M2 private-note Legion evidence — visible `Go!` gate

## Verdict: NOT_TESTED / VISIBLE GO AND APP SHELL DRIVE NOT PROVEN

This ordinary attempt-1 lane stopped at the required pre-credential visible gate.
The exact accepted `lantern.exe` was measured, launched in the logged-in Legion
session, and bound to PID 142240. Both independent full-screen views instead
showed the ordinary Lantern workspace immediately. They did **not** show the
required first-run intro, its scroll pane, or the visible `Go!` button.

Because the mandatory `BEFORE → pointer-in-pane → scroll → GO-VISIBLE → click
Go! → GO-AFTER → SHELL` sequence never began, no coordinate was derived, no
scroll or Go click was sent, and no credential was read, transferred, copied,
placed on the clipboard, or typed. M2 assertions A–E did not run. This is a
control-gate stop, not a product PASS or FAIL.

The source-workspace clone, passive camera, newly started input helper, exact
app bytes, and normal close were all recorded. Cleanup cleared the clipboard to
a harmless blank, removed the lane-only launch task, closed both tunnels, and
left the approved LegionAgent task running.

Reference-only lineage: job `20260724-170916-sekmxxxx` at app evidence commit
`594d791aaa89d8184dd74a070f6ba1779e221568` stopped because its pointer was
outside the onboarding pane; it is neither a product PASS nor a product FAIL.
Job `20260724-165056-hxkrxxxx` at `622d0cba261c007a9927930b31cb46629c98bdac`
is reference-only first-ownership-stop lineage.
