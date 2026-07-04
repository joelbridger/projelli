# Worker brief — Azure bench WebView2 CDP port (finish the cloud bench as a 2nd target)

**Lane:** cc-lantern-azcdp · worktree `~/lp-azcdp` · branch `lp/azure-cdp-fix`
**Model:** Sonnet 5 · high.

## Mission
On the existing Azure VM `lantern-cloud-bench-1`, make the WebView2 remote-debug port (9223) actually LISTEN so `scripts/bench-smoke.mjs --target azure-cloud-bench-1` can drive the app over CDP. The app already compiles and launches there (~3-min cached rebuilds); the CDP port is the ONLY gap blocking the cloud bench as a second smoke target.

## Read first
`coordination/azure-bench/SETUP-LOG.md` IN FULL — especially step 7 (the failed CDP attempt + its leads) and the cost/uptime notes. Access: Tailscale `ssh lpbench@100.75.247.98`; repo at `C:\lantern-plus` (branch lantern-plus @3651d99e, clean); admin creds pointer is in the setup log (never echo/commit).

## Primary hypothesis (test this first)
The prior attempt launched the app from a **headless SSH session**; on the Legion the app runs via a **scheduled task in the logged-on interactive user session** (`LanternPlusDev` pattern) and CDP works there with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` (mechanism documented in `scripts/desktop-drive.mjs`). WebView2 debug ports frequently refuse to open in session-0/non-interactive contexts. So: replicate the Legion launch shape — an interactive session (auto-logon or an active RDP/console session) + a scheduled task that launches the dev app INSIDE it — before chasing anything else. Secondary leads from the log: `--remote-debugging-address` binding, WebView2 user-data-folder reset. Also check whether 9223 listens on loopback only (then the harness needs an SSH tunnel like the Legion path — check how desktop-drive.mjs reaches the Legion and mirror it).

## Cost guardrails (binding)
- `az vm start` when you begin; **`az vm deallocate` the moment you're done, blocked, or idle >15 min.** Target ≤90 minutes VM uptime; if you need more, ask the coordinator with a one-line justification. Auto-shutdown 02:00 PT and budget alerts exist as backstops, not as your plan.
- Rebuilds should be from-cache (~3 min). If you somehow face a cold 15-min build, stop and ask.
- While on the VM, also delete the leftover clutter noted in the log: `del C:\*.ps1 C:\protoc.zip C:\strawberry-perl.zip`.

## Success bar
From the server: one cheap harness check executes against the VM over CDP, e.g. `node scripts/bench-smoke.mjs --target azure-cloud-bench-1 --only <a cheap check id>` (pick from `--plan`), or at minimum `scripts/desktop-drive.mjs` connects and screenshots. Evidence: command + output + screenshot path.

## Deliverables
1. The fix, made durable (scheduled task/config on the VM so future sessions get CDP without hand-work) and documented as a new dated section in `coordination/azure-bench/SETUP-LOG.md` (commit on `lp/azure-cdp-fix` from `~/lp-azcdp`).
2. If the VM's persistent state changed meaningfully, take a fresh snapshot (`lantern-cloud-bench-1-clean-3`) AFTER deallocating, then confirm deallocated.
3. Report VM minutes used. NEVER touch the Legion (another lane owns it). No cargo on the server — builds happen on the VM only.
4. Long commands wrapped in `timeout`. Report progress at each milestone (VM up / hypothesis result / harness check result / deallocated).
5. When done: print the evidence summary, then as the very last line of your turn the done sentinel in the standard format for branch `lp/azure-cdp-fix` (copy exactly): `WORKER-DONE: lp/azure-cdp-fix`
