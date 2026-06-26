# Pinned verifier environment (the Legion release-verifier)

**Why this file exists.** We run ONE Windows machine (the Legion) as both the dev
bench and the release verifier. Visual snapshots, "looks right on real Windows"
sign-offs, and release-verifier runs are only trustworthy if we know the exact OS
+ WebView2 + display-scaling they were taken on — those three move pixel layout,
font rendering, and WebView behavior. This is the recorded baseline. **Re-check it
before trusting a release-verifier or visual run**, and update this file (with the
date) whenever the Legion's Windows, WebView2, or scaling changes.

This is the cheap half of recommendation #8 (pin the verifier env). The full
version — a second, dedicated verifier box separate from the dev bench — is
deferred until the harness work (reseed snapshot + fixtured-AI bench smoke)
lands.

## Captured baseline

| Field | Value | Captured |
|---|---|---|
| Device | Legion laptop — Tailscale `laptop` = `james@100.127.67.22` (admin) | 2026-06-26 |
| OS | **Windows 11 Home, version 25H2, build 26200.8737** | 2026-06-26 |
| CPU arch | AMD64 (AMD Ryzen, Family 25 Model 68) | 2026-06-26 |
| **WebView2 Evergreen Runtime** | **149.0.4022.80** | 2026-06-26 |
| **Display scaling** | **150%** (AppliedDPI `0x90` = 144; 96=100%, 120=125%, 144=150%, 168=175%, 192=200%) | 2026-06-26 |

> **Heads-up on the OS name.** The registry `ProductName` reads "Windows 10 Home"
> — that is the well-known Windows 11 quirk (Microsoft never updated that one
> value). Build 26200 / DisplayVersion 25H2 is **Windows 11**. `cmd /c ver`
> returns `10.0.26200.8737`.

## How this was captured (read-only — the bench was NOT driven)

These are read-only queries over the Legion's SSH (no app launch, no robot, no
interference with a running bench). Re-run them to refresh the table:

```bash
# Windows build
ssh james@100.127.67.22 'cmd /c ver'
# Edition / feature-update / build / UBR
ssh james@100.127.67.22 'cmd /c reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v ProductName'
ssh james@100.127.67.22 'cmd /c reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v DisplayVersion'
ssh james@100.127.67.22 'cmd /c reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v UBR'
# CPU arch
ssh james@100.127.67.22 'cmd /c echo %PROCESSOR_ARCHITECTURE% %PROCESSOR_IDENTIFIER%'
# WebView2 Evergreen Runtime version (the install-folder name is authoritative)
ssh james@100.127.67.22 'cmd /c dir /b "C:\Program Files (x86)\Microsoft\EdgeWebView\Application"'
# Display scaling (AppliedDPI: 96/120/144/168/192 = 100/125/150/175/200%)
ssh james@100.127.67.22 'cmd /c reg query "HKCU\Control Panel\Desktop\WindowMetrics" /v AppliedDPI'
```

## Implications for tests

- **Visual baselines** committed for Playwright (`toHaveScreenshot`, 2% tolerance)
  were taken under these settings. A scaling change (e.g. 150% → 100%) will move
  far more than 2% of pixels and must trigger a deliberate re-baseline, not a
  "fix the flaky snapshot" patch.
- **WebView2 version** is the runtime the real app renders in. A major WebView2
  bump is worth a quick visual + smoke re-check, since it can change rendering and
  CDP behavior.
- Treat **release-verifier runs on this machine as the canonical baseline source**
  until a dedicated second verifier box exists.
