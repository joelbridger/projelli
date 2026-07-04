# Virtual-audio spike — can capture regression tests run on a cloud VM with no physical audio hardware?

**Date:** 2026-07-04 · **Target:** `lantern-cloud-bench-2` (clone only; bench-1 and the Legion untouched) · **Lane:** cc-lantern-vaudio (infra/spike, no product code) · **VM time used:** ~40 min of the 75 min budget.

## Bottom line

**Yes — with a real, scriptable fix.** A cloud VM with zero audio hardware can be given a working virtual microphone + speaker pair in under a minute, with no reboot and no manual click, using the free **VB-CABLE** driver. Proven at the actual audio-engine level (cpal/WASAPI, the same library the app uses): both the system-audio ("loopback") capture path and the microphone capture path opened successfully and recorded a real tone with RMS 0.40 (expected ≈0.42 for the test tone — a clean match). This unlocks capture regression testing on cloud benches without needing the physical Legion laptop, **with one real limitation**: a single free VB-CABLE install gives exactly one virtual cable, so it cannot yet prove "tone in loopback, silence in mic" the way the Legion's real hardware can (see Limitation below).

## What "no audio hardware" looks like before the fix

Confirmed via `Get-PnpDevice -Class Media` / `-Class AudioEndpoint` on a freshly booted bench-2: **zero results, all classes**. This is a genuine Azure D4s_v4 VM — there's no audio silicon at all, so Windows shows no playback or recording device, no "Stereo Mix," nothing. This matches what's in the standing project memory (`project-azure-cloud-bench`) — cloud benches were assumed audio-incapable, and this spike confirms that was accurate on stock hardware.

## Driver chosen: VB-CABLE (VB-Audio), not the alternatives

- **VB-CABLE (chosen).** Free, one virtual cable pair (one playback endpoint "CABLE Input" wired straight to one recording endpoint "CABLE Output"). The installer (`VBCABLE_Setup_x64.exe`) supports a documented silent-install switch set: **`-h -i -H -n`**. This is a known pattern already used to automate VB-CABLE on other headless cloud VMs (a Google Compute Engine cloud-gaming project, `gcloudrig`, does exactly this in production).
- **Virtual Audio Cable (muzychenko, paid)** — skipped per the brief; no free silent-install path to justify the cost for a spike.
- **Windows "Stereo Mix"** — not applicable; it only exposes an *existing* physical output device as a recording device. With zero physical audio devices, there's nothing for Stereo Mix to expose.

## Install: fully scriptable, no interactive click, no reboot

This was the open question going in — VB-CABLE's driver `.sys`/`.cat` files are **not WHQL-lab-tested**, so the classic worry is a "Windows can't verify this driver's publisher" dialog that only a human can dismiss. That did **not** happen here:

1. Downloaded `VBCABLE_Driver_Pack45.zip` directly from vb-audio.com and extracted it.
2. Inspected the win10 driver's certificate (`vbaudio_cable64_win10.cat`) — it's signed by **"Microsoft Windows Hardware Compatibility Publisher"** (a real Microsoft attestation-signing chain, not VB-Audio's own self-signed cert like older releases). That's *why* no signing prompt appears on Windows 10/11 for this specific file.
3. Ran the installer via `Start-Process -ArgumentList "-h -i -H -n" -Wait -PassThru` as SYSTEM (through `az vm run-command invoke`, which runs elevated regardless of the SSH session's own UAC token — see Landmine below). **Exit code 0**, both endpoints appeared within seconds, no reboot required.

Attempted step (turned out to be unnecessary but is harmless/good practice to keep in any install script): importing the driver cert into `Cert:\LocalMachine\TrustedPublisher`/`Root` via `certutil -addstore`. It errored (store-open quirk unrelated to real permissions) but the install succeeded anyway — confirming the Microsoft-signed `.cat` is what actually avoids the prompt, not the cert-trust step.

**Recommended repeatable script shape** for any future bench that needs this:
```powershell
Invoke-WebRequest "https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip" -OutFile C:\vbcable.zip
Expand-Archive C:\vbcable.zip C:\vbcable
Start-Process "C:\vbcable\VBCABLE_Setup_x64.exe" -ArgumentList "-h -i -H -n" -Wait -PassThru   # exit code 0, no reboot
```
Run this through `az vm run-command invoke` (SYSTEM-elevated) rather than a plain SSH session — see Landmine below.

## Capture verdict (the actual audio proof)

Because the app instance running on bench-2 became unresponsive partway through this session (see Known issue below), the proof was done one layer down, directly against **cpal** — the same Rust audio crate the app's `capture` engine uses (`src-tauri/src/commands/capture/sources.rs`) — via a standalone throwaway crate (not committed; cpal-only, so it compiled in ~40s instead of dragging in the whole app's dependency tree). This mirrors the technique the wave-3 plan's Task 0 (`src-tauri/examples/loopback_spike.rs`) already used successfully on the Legion, extended here to also open the input (mic) side and measure RMS.

Played a 10s, 440Hz, stereo tone fixture through the virtual output while both streams recorded:

| Channel | Device opened | Samples | RMS | Interpretation |
|---|---|---|---|---|
| Loopback (system audio) | `CABLE Input (VB-Audio Virtual Cable)` opened as WASAPI loopback | 960,000 | **0.400** | Real signal — a 0.6-peak-amplitude sine has expected RMS ≈0.424; close match confirms genuine tone capture, not noise |
| Mic | `CABLE Output (VB-Audio Virtual Cable)` opened as plain input | 959,040 | **0.401** | Also captured the tone — proves cpal can open a *recording-role* endpoint on this VM at all |

Raw WAVs: `docs/evidence/vaudio-spike/bench-2-20260704/vaudio-{loopback,mic}.wav`.

**Both endpoints became the system default automatically** (there was nothing else to compete with), so no explicit "set default device" step was needed on this VM.

## Limitation — this is not yet a real mic/loopback isolation test

A single free VB-CABLE installs exactly **one** cable: one playback endpoint wired directly to one recording endpoint. That's why the mic channel's RMS (0.401) is nearly identical to the loopback channel's (0.400) — they're *the same wire*, not an independent "quiet mic in a quiet room" the way the real Legion test proves (mic RMS < 0.02, loopback RMS > 0.05, per `docs/plans/lantern-plus/2026-07-02-wave-3-meeting-capture.md` Task 6). To get real two-channel isolation on a cloud VM, a future session would need either:
- **VB-CABLE A+B** (paid, ~$/one-time from VB-Audio) — two independent cable pairs, or
- Two separate VB-CABLE-style drivers installed under different names, or
- Accept that cloud-bench capture tests can only prove "does audio flow at all," not "does the app correctly separate two live channels" — that part still needs the Legion.

This spike's job was to prove the *audio plumbing* works at all on a VM with no hardware — it does. Whether that's sufficient for the specific regression tests planned depends on what those tests actually assert; if they need real channel isolation, keep those on the Legion and use cloud benches for the simpler "does recording start/stop/produce a file" class of check.

## Known issue found along the way (flag for the meeting-capture / app-health lane, not fixed here — out of scope for this spike)

1. **App instability after driver install.** The already-running desktop app (WebView2 CDP on :9223) stopped responding partway through this session — right around the time the audio driver was installed (installing a driver typically bounces the Windows Audio service, which may have knocked over whatever audio handles the app held). Restarting the `LanternDevBench` scheduled task did not bring CDP back up within several minutes. Not investigated further (out of scope for an infra/audio spike, and the VM resets from `lantern-cloud-bench-ready-1` regardless) — worth a look if it recurs.
2. **Possible Windows-only path bug in `capture_start`.** Before the app went unresponsive, one attempt to invoke `capture_start` over CDP (the same pattern the wave-3 plan's Task 6 harness describes) returned: `cannot canonicalize : The system cannot find the path specified. (os error 3)`. Tracing the code (`src-tauri/src/commands/capture/mod.rs` → `pathguard::canonicalize_symlink_safe_absolute`), this error shape matches what you'd get if the symlink-safe path-walk mishandles a Windows verbatim `\\?\C:\...` prefix (the form `Path::canonicalize()` always returns on Windows) — the walk's first "does this component exist" check may fail on the bare drive-prefix component, short-circuiting to an empty `existing` path before it ever canonicalizes anything real. **This was observed once, not root-caused with a controlled repro** — flagging it as a plausible, previously-undiscovered Windows-specific bug in the capture engine's path guard (this code path had never been exercised on real Windows before; Task 6's real-device harness scripts don't exist yet in the repo). Whoever picks up Wave 3a's Task 6 on Windows should check this first before assuming `capture_start` works as-is.

## Landmine for future sessions: SSH sessions on this VM are not UAC-elevated

Even though `lpbench` is in the local Administrators group, commands run over a plain SSH session get Windows' non-elevated "filtered" admin token — `Import-Certificate`/`certutil -addstore` to `LocalMachine` stores fail with Access Denied over plain SSH. **Use `az vm run-command invoke` (runs as SYSTEM) for anything that needs real machine-level admin rights** (driver cert stores, installing drivers, etc.) — SSH is fine for everything else (file copies, running the app, reading state).

## Recommendation

**Adopt VB-CABLE for cloud-bench capture smoke tests** (start/stop/produces-a-file-with-real-audio-in-it checks) — it's free, installs in under a minute with zero interaction, and the underlying cpal capture path is proven to work. **Do not** rely on cloud benches yet for tests that need genuine mic-vs-system channel isolation — keep those on the Legion until/unless a two-cable setup (VB-CABLE A+B or equivalent) is provisioned. Whoever next drives Wave 3a's real capture engine on Windows should also check the `capture_start` path-guard finding above before assuming it works untested.

**VM deallocated at end of session** (see sentinel below).
