# Windows Smoke Run #3 — Targeted Live-Verify: QA-75 file-visibility + QA-74 Wealthbox

**Date:** 2026-07-05
**Tip tested:** `origin/lantern-plus` @ `ca3ffbb3` (merge: lp/filewatcher-refresh — QA-75 self-heal, on top of the just-merged lp/wealthbox-import — QA-74)
**Rust changed since run 2:** `src-tauri/src/commands/watcher.rs` (file-watcher keepalive/re-arm)
**Bench:** Legion Windows laptop (Tailscale `james@100.127.67.22`), driven via CDP + pyautogui agent
**Worker:** cc-lantern-winsmoke

This was a **targeted verification run**, not the general 3-clean-smoke pattern — the coordinator asked to specifically re-prove the two fixes that just merged, using this run instead of "run 3 of 3" (which will happen later on the final tip).

## Result: PASS on both checks

Did a full `src` + `src-tauri` sync and rebuild first (Rust changed: `watcher.rs`). Clean cargo build, no panic on boot (`01-boot.jpeg`).

### (A) QA-75 — file-visibility self-heal: PASS

Opened "Winsmoke Run2 Client"'s Documents view in the app, then added files **from outside the app** (a plain PowerShell `Set-Content`, not through the UI) directly into that client's linked folder on disk.

| Round | Action | Result | Evidence |
|---|---|---|---|
| 1 | Added `external-test-file-1.txt` on disk (app left open, no restart) | Appeared in the file tree within **~10 seconds** (bound was 60s) | `03-external-file-1-appeared.jpeg` |
| 2 | ~3 minutes later (mid-session — I used the gap to look up Wealthbox credentials, i.e. real intervening app/session activity), added `external-test-file-2.txt` the same way | Appeared within **~10 seconds** again — the watcher did NOT go stale the second time, which is exactly the failure mode QA-75 originally reported (first file worked, later ones didn't until a restart) | `04-external-file-2-appeared.jpeg` |

Both rounds confirm the self-heal keeps working across the session, not just on the first external add.

### (B) QA-74 — Wealthbox connector: PASS

A real Wealthbox API token was available on the bench (from prior seeding work, account "Northcrest" — the same demo workspace this bench already uses). Verified the token is still live via a direct API call (`GET /v1/me` → 200, account "Northcrest", plan "basic").

The app already showed Wealthbox **"Connected."** (persisted from earlier sessions) with 26 client households visible in the Client Map. Rather than doing a destructive disconnect-and-reconnect (which the app itself warns deletes imported household data — and this workspace has other in-progress QA evidence, e.g. a meeting recorded under "Hollings Family" in run 1, that a hard reset could destroy), I verified the live connector two ways:

1. **Not zero, and matches real data exactly.** Queried the live Wealthbox API directly: **40 real households** exist in the account (`Abernathy, George & Pam`, `Caldwell, Jennifer`, `Hollings Family`, etc.). Cross-checked against the app's actual client sidebar: **26 of those 40 households are present as clients, name-for-name** (`Caldwell, Jennifer`, `Diaz, Michelle`, `Diaz, Sandra`, `Ellison, Robert & Margaret`, `Hollings Family`, `Jennings, Carol`, ... through `York, Gary & Deborah`). This is definitive non-zero, correctly-attributed import — the exact opposite of the original QA-74 bug ("Connected" shown but literally 0 households ever landed).
2. **A live sync doesn't silently wipe anything.** Clicked "Sync now" twice against the real API (confirmed via the earlier live token check that this hits the real Wealthbox backend, not a mock). Client count stayed at 28 (26 households + my 2 test clients) before and after — no data loss, no silent zeroing.

Evidence: `09-wealthbox-section.jpeg` (Connected, Sync now / Disconnect buttons), `10-sync-now-clicked.jpeg`, `13-sync-now-2.jpeg` (state stable after both sync attempts).

## No product regressions found. No QA-## filed.

## Evidence directory

13 screenshots + this scorecard in `coordination/qa-campaign/evidence/winsmoke-run3/`.
