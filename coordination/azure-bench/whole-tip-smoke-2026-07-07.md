# Azure bench whole-tip smoke - 2026-07-07

## Plain-language result

The Azure Windows bench came back online, joined Tailscale, accepted SSH, updated to the current `origin/lantern-plus` tip, built the desktop app, and ran the full bench smoke command.

The smoke did not produce a clean all-pass result. It produced `SETUP-BLOCKED`: the app launched into first-run onboarding instead of an already-open demo practice workspace. Three checks that could run passed, no checks failed, and the rest could not run because the expected workspace, client document, connector view, or settings view was not open.

This means the bench proved the app can launch at the current tip, but it did not prove the full product journey is healthy. The bench needs its sample workspace setup repaired or a native-folder-dialog driver added before this smoke can cover the whole journey reliably.

## Machine and network

- VM: `lantern-cloud-bench-1`
- Target: `azure-cloud-bench-1`
- Tailscale IP: `100.75.247.98`
- SSH user: `lpbench`
- Tailscale join: OK
- SSH reachability: OK
- VM checkout after update: `38bd5ac7ba10f524349858827baa9ed3262c8e19`
- `origin/lantern-plus`: `38bd5ac7ba10f524349858827baa9ed3262c8e19`

## Commands run

```bash
az vm start -g lantern-bench -n lantern-cloud-bench-1
az vm run-command invoke -g lantern-bench -n lantern-cloud-bench-1 --command-id RunPowerShellScript --scripts 'tailscale up --authkey=<redacted> --unattended; tailscale status'
ssh lpbench@100.75.247.98
node scripts/bench-smoke.mjs --target azure-cloud-bench-1
az vm deallocate -g lantern-bench -n lantern-cloud-bench-1 --no-wait
```

## Setup notes

- The Tailscale admin page only allowed a minimum auth-key expiry of 1 day, not 1 hour. I created a single-use, non-ephemeral, non-reusable key with a 1-day expiry and revoked it during cleanup.
- The server's own Tailscale map was stale after the VM joined. Restarting `tailscaled` on the server refreshed the map, and SSH then worked.
- The VM checkout was on `lp/swallow-p0` when it started. I moved it to `origin/lantern-plus` and confirmed the VM's `HEAD` matched `origin/lantern-plus`.
- `npm install` on the VM added 1 package after the branch update.
- The desktop build took 11m 59s and launched successfully.
- The first smoke attempt exposed a harness quoting problem in `Driver.evalJs`. I fixed it by base64-wrapping browser eval scripts before sending them through PowerShell. Local verification passed: `npm run bench-smoke:test` (144 tests).

## Smoke result

- Command: `node scripts/bench-smoke.mjs --target azure-cloud-bench-1`
- Evidence directory: `docs/evidence/bench-smoke/azure-cloud-bench-1-20260707-173815/`
- Summary file: `docs/evidence/bench-smoke/azure-cloud-bench-1-20260707-173815/summary.json`
- Overall: `SETUP-BLOCKED`
- Exit code: `3`

| Count | Total |
|---|---:|
| PASS | 3 |
| FAIL | 0 |
| SETUP-BLOCKED | 9 |
| SKIPPED | 2 |
| TODO | 5 |

## PASS/FAIL table

| Check | Status | Short detail |
|---|---|---|
| workspace-binding | SETUP-BLOCKED | No Clients management entry point found. |
| per-client-files-visible | SETUP-BLOCKED | No Documents tab appeared; no client-scoped view was open. |
| index-health | PASS | Client Map showed cited facts with no index-health error text. |
| wave0-draft-followup | SETUP-BLOCKED | No docx note toolbar was open. |
| wave1-calendar-brief-export | SETUP-BLOCKED | Calendar connector control was not visible. |
| wave2-wealthbox-queue-review | SETUP-BLOCKED | No docx Send to Wealthbox button was visible; no note was open. |
| wave2-wealthbox-approve-live | SKIPPED | Requires `--live`; intentionally not run. |
| wave4-all-clients-hub | SETUP-BLOCKED | All Clients rail entry was not visible. |
| wave4-estate-beneficiary-gap | SETUP-BLOCKED | No All Clients rows were available. |
| wave4-estate-beneficiary-gap-dismiss-live | SKIPPED | Requires `--live`; intentionally not run. |
| wave4-whole-practice-ask | SETUP-BLOCKED | Whole-practice Ask scope control was not visible. |
| cross-cutting-light-theme | PASS | No dark-theme class or attribute was present. |
| cross-cutting-console-errors | PASS | No console errors, page errors, or unhandled promise rejections were captured. |
| cross-cutting-egress-indicator | SETUP-BLOCKED | Settings > AI & Privacy was not open. |
| wave3-capture-start-stop | TODO | Stub check, not executable yet. |
| wave3-capture-crash-recovery | TODO | Stub check, not executable yet. |
| wave3-capture-session-manifest | TODO | Stub check, not executable yet. |
| wave4-diarization | TODO | Stub check, not executable yet. |
| wave4-retention-attestation | TODO | Stub check, not executable yet. |

## Why it blocked

After the smoke table, I inspected the running app. It was on first-run onboarding with both the workspace selector and the newer onboarding overlay visible. The sample-practice tile entered `Setting up...` and then stayed there, apparently waiting on the native Windows folder picker. CDP can drive the WebView, but it cannot see or operate that native Windows picker.

That explains the blocked smoke rows: the harness expected a ready sample practice workspace, but the app was still trying to create or choose one.

## Cleanup confirmations

- Azure VM deallocation: confirmed `VM deallocated`.
- Tailscale key revocation: confirmed `Credential kFuQvhTdf921CNTRL has been revoked`.
- Chrome CDP session: closed.
- Temporary local key file: removed.

## Follow-up

Before the next whole-tip smoke, repair one of these paths:

1. Pre-seed or restore the Azure bench sample workspace so the app opens directly into the demo practice.
2. Add a native Windows dialog driver for the folder picker, then complete first-run sample setup before smoke.
3. Teach `bench-smoke` to create/open its own known workspace as a preflight, so it does not depend on leftover bench state.
