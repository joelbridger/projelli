# Worker brief — Virtual-audio spike on clone bench-2 (program #5, the last queued item)

**Lane:** cc-lantern-vaudio · dir `~/lantern-plus` (infra/spike lane — no product code; findings go in `coordination/azure-bench/VIRTUAL-AUDIO-SPIKE.md`, committed on `lantern-plus` — `git branch --show-current` first)
**Model:** Sonnet 5 · high.

## Goal
Prove (or honestly disprove) that meeting-capture tests can run on a cloud VM with NO physical audio hardware, using a virtual audio driver + WAV fixtures. Success unlocks capture regression testing without the Legion.

## Target: `lantern-cloud-bench-2` ONLY
The CLONE (not bench-1 — keep the original pristine; NEVER the Legion). Connection details + the Tailscale-identity landmine notes: `coordination/azure-bench/SETUP-LOG.md` (2026-07-04 azclone section). It boots bench-ready: merged tip built, app launches via the LanternDevBench scheduled task, CDP on 9223. If you break it, that's fine — it resets from snapshot `lantern-cloud-bench-ready-1`; note it and continue.

## Steps
1. `az vm start lantern-cloud-bench-2`; SSH in; confirm the app runs and CDP responds (known-good baseline first).
2. Install a virtual audio driver. First choice: VB-Audio VB-CABLE (free, widely used; silent-install support is limited — document what the install actually needs; if it requires an interactive session click, you have auto-logon + the scheduled-task pattern and `scripts/legion_agent.py`-style pyautogui is NOT set up here, so prefer a driver with silent install — alternatives: Virtual Audio Cable (muzychenko, paid — skip), VB-CABLE via devcon/pnputil silent modes, or Windows' built-in "Stereo Mix" if the vNIC audio stack exposes it. Research briefly, pick ONE, document why).
3. Reboot if the driver needs it; confirm Windows sees a playback + recording endpoint pair.
4. Play a WAV fixture through the virtual output (e.g. PowerShell `(New-Object Media.SoundPlayer 'C:\fixture.wav').PlaySync()` with the virtual cable as default output) while invoking the app's capture over CDP exactly the way w3's device verification did (capture_start/capture_stop via CDP invoke — see `docs/evidence` + the capture commands in `src-tauri/src/commands/capture/`). Generate a fixture with a clear tone (PowerShell or copy one over).
5. Verdict: does the captured WAV contain the tone on the loopback channel (RMS clearly above noise floor)? Does the mic channel see the virtual mic? Record RMS numbers like w3 did.
6. Write `coordination/azure-bench/VIRTUAL-AUDIO-SPIKE.md`: driver chosen, install steps (scriptable or not), what worked, RMS evidence, and a recommendation: viable for CI-style capture tests, or not.
7. **Deallocate the VM when done.** Budget: ≤75 min VM time. Report at: VM up / driver installed / capture verdict / deallocated.

## Rules
- An honest "not viable" (driver needs interactive install, endpoint invisible to WASAPI loopback, etc.) is a valid outcome — document and stop rather than heroics.
- timeout-wrap everything; never touch bench-1 or the Legion.
- Last line when done, exactly: `WORKER-DONE: vaudio`
