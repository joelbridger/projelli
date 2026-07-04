# Cloud bench-1 parallel regression pass (cloudreg) — 2026-07-04

**Lane:** cc-lantern-cloudreg · **Date:** 2026-07-04 · **Bench:** Azure cloud VM `lantern-cloud-bench-1` (Tailscale `lpbench@100.75.247.98`) · **App:** `C:\lantern-plus` reset from `de72ab1b` (180 commits behind) onto `origin/lantern-plus` tip `14b6be71`, real cargo rebuild (9m50s cold-ish, 1086 crates touching new native deps). Ran in parallel with the Legion audio regression lane; this lane covered the non-audio half.

## Plain-language summary for Jameson

**The short version: I found one real, serious bug, and confirmed several fixes from earlier this week are holding up.**

1. **Big finding — the "app says Saved but actually loses your work" bug is back, in a slightly different form.** ❌ This was supposedly fixed already (QA-34). I tested it the way the fix was supposed to handle: I simulated another program (like antivirus) briefly locking a document file while someone's typing. The FIRST time this happened, the app handled it perfectly — it showed a clear "this document can't be saved right now, another program may be blocking it" warning, kept trying in the background, and saved successfully the moment the block cleared. That's the fix working exactly as designed. **But when I did it a SECOND time on the same document, something broke**: the app went back to silently saying "Saved" while two more sentences I typed were never written to disk — no warning banner, no error, nothing. I proved this wasn't just a display glitch: I fully closed and restarted the app, reopened the same document, and that content was gone for good. This means a user could still lose real work today, just under a slightly less common trigger (a second interruption) than the original bug.
2. **The trust/honesty fixes from this week's Data Map audit are all holding up.** ✅ I checked the "Where does my data go" page (the one advisors can print and hand to a compliance officer). The Wealthbox connector wording is honest ("writing is not automatic — you approve every note before it's sent"), the encryption feature is clearly marked as something you turn on, not something already active, and the "SOC 2" mention is correctly framed as "on the roadmap," not a claim that Advisor Prep Hero already has it.
3. **The core day-to-day loop still works.** ✅ Adding a new client works cleanly. Asking a question about a client's files correctly showed an honest "the AI isn't ready yet" message rather than hanging or lying about it — the local AI model just isn't installed on this particular test computer, which is expected for a bare-bones cloud bench, not a bug. Sending a document to Wealthbox is correctly turned off (greyed out) because this test computer isn't connected to a real Wealthbox account.
4. **The "app hangs forever with no explanation" startup bugs from earlier this week are still fixed.** ✅ This cloud computer happened to already have the Windows credential-vault service turned off (the exact condition that used to cause a silent 30-second freeze with zero explanation). With the current code, the app opened straight into a working workspace almost immediately — no freeze, no unexplained wait.

**Bottom line: three of four fix-verification checks pass cleanly. The fourth (save integrity) surfaced a real, still-serious data-loss bug that needs a follow-up fix — it's better than before (the first interruption is now handled honestly) but a second one still causes silent, permanent loss.**

## Verdicts (PASS / FAIL / REGRESSED)

| # | Check | Verdict | Notes |
|---|---|---|---|
| 1 | VM updated to current tip, real rebuild, CDP-driveable | **PASS** | `origin/lantern-plus@14b6be71`, cargo rebuild 9m50s (cold on new native deps), CDP port 9223 confirmed live, driven via `scripts/desktop-drive.mjs` over an SSH tunnel |
| 2 | QA-34 save-integrity — first lock/save-failure cycle | **PASS** | Held an OS-level exclusive lock (`FileShare.None`) on an open `.docx` while typing. App showed an honest "This document can't be saved right now" banner + "Save failed" state (not a false "Saved"), auto-recovered and saved correctly within ~12s of the lock releasing |
| 3 | QA-34 save-integrity — second lock/save-failure cycle | **REGRESSED — confirmed real, restart-verified** | After a **second** lock/recovery cycle on the same document, further typed content silently stopped persisting: UI kept showing a calm "Saved • Xm ago" with no error for 5+ minutes, and a full app restart confirmed the content was **permanently lost** (never written to disk). See detailed writeup below |
| 4 | Tier A honesty pass — Wealthbox write-path wording | **PASS** | Data Map: "Reading is automatic; writing is not... only from a review card... approve before anything goes out. Nothing is written back on its own." |
| 5 | Tier A honesty pass — AES-256 pill optional | **PASS** | Privacy Center: "Encrypt this workspace" shown as an opt-in action ("Enable vault" button), not an already-active claim |
| 6 | Tier A honesty pass — SOC-2 / "stores none of your data" honesty | **PASS** | Pricing tier pill reads "SOC 2 and DPA **on the roadmap**" (not a certification claim); Data Map's server-contact section is scoped and specific ("a periodic license check... carries nothing about your documents, prompts, or clients"), no longer a bare "we store nothing" claim |
| 7 | Tier A honesty pass — privacy headline / provider-name agreement | **PASS** | No unqualified "nothing leaves this computer" claims found; egress indicator and "Using local AI" / "On your machine. No cloud AI" pills matched the actual active mode throughout testing |
| 8 | Broad smoke — connect a client | **PASS** | Created "Smoke Test Family" via `+ New client`, appeared correctly in Client Map and sidebar |
| 9 | Broad smoke — cited Ask | **PASS (UI/flow), infra gap on this VM** | Submitted a real question; got an honest "couldn't get an answer — it may still be downloading or loading the local model" error, not a hang or a fabricated answer. This bench has no Ollama model installed, so a real cited answer couldn't be produced — that's a bench setup gap, not a product bug |
| 10 | Broad smoke — CRM push (Send to Wealthbox) | **N/A — not connected on this bench** | Button correctly disabled/greyed since no real Wealthbox account is connected on this VM; this is correct behavior, not a bug |
| 11 | QA-32/33 — stopped credential service (`VaultSvc`) no longer causes a silent hang | **PASS** | `VaultSvc` was already stopped on this VM (leftover from earlier QA sessions). Fresh app launch opened straight into the workspace's Client Map within a few seconds — no 30s freeze, no silent failure |
| 12 | QA-32 — native folder-picker watchdog | **NOT RE-TESTED** | Re-triggering the original native-dialog-hang repro requires a UI-Automation helper for the OS-level folder picker; out of scope for the time available this pass. No regression signal seen elsewhere |

## Detail — the QA-34 regression (finding #3)

**Setup:** `Emily Chen Household` → `my-document.docx`, opened in the editor, "Reviewing" (track changes) on.

**Cycle 1 (control — confirms the existing fix works):**
1. Typed a sentence with no lock held → saved to disk correctly within ~10s.
2. Started an OS-level exclusive lock (PowerShell `[System.IO.File]::Open(path, Open, Read, FileShare.None)`) for 30s, typed a second sentence while locked.
3. Within ~8s the UI showed a clear, honest banner: **"This document can't be saved right now — another program (often antivirus, backup, or cloud sync) may be blocking the file. Your changes are safe here and I'll keep trying automatically. If it doesn't clear, save a copy somewhere else so nothing is lost."** with "Try again now" / "Save a copy elsewhere..." buttons, and the toolbar showed "Save failed" + Retry. This is the fix working exactly as designed — no false "Saved" while genuinely blocked.
4. Lock released → app auto-recovered and wrote the file successfully ~12s later, banner cleared, indicator returned to "Saved • Xs ago".

**Cycle 2 (this is where it broke):**
5. Started a second 20s exclusive lock, typed a third sentence ("THIRD-ATTEMPT-MARKER") while locked — landed in the DOM correctly.
6. Lock released. Waited well past any reasonable debounce (60+ seconds, checked via direct `Get-Item` on the file every few seconds) — **the file on disk never updated**, staying at the byte count/timestamp from cycle 1's save.
7. No error banner appeared this time. The toolbar indicator just read **"Saved • Xm ago"** — technically not lying about *when* the last real save was, but the overall presentation reads as calm/normal, not "you have unsaved work." A typical user would not know anything was wrong.
8. Typed a fourth sentence via a direct click inside the existing text (ruling out a cursor-position/test-tooling artifact) — same result: appears in the DOM, never reaches disk, no error shown.
9. **Proved real, permanent data loss**: killed the app process entirely (simulating a crash/forced close) and confirmed via direct file inspection that no final flush-save happened on exit either. Relaunched the app fresh, reopened the same document — **only cycle 1's two sentences were present; the third and fourth sentences were gone permanently**, with no recovery/backup snapshot rescuing them.

**Assessment:** the honest-failure-and-retry mechanism built for QA-34 works correctly for a *single* lock/interruption event, but something in the retry/recovery bookkeeping appears to get into a bad state after a *second* one on the same document session — it stops attempting saves at all, without ever re-arming the error UI. This is a narrower trigger than the original bug (needs two interruptions, not one) but the outcome — silent, permanent data loss with a UI that never signals a problem — is exactly the P0 failure mode QA-34 was meant to close off. Recommend a dedicated follow-up fix scoped to the save-retry state machine's behavior across *repeated* failures, not just a single one.

Screenshots: `screenshots/04` through `screenshots/12` cover this sequence in order (04 = doc open clean, 05–06 = cycle 1 pre-lock, 07–08 = cycle 1 locked/honest-error, 09 = cycle 1 recovered, 10–11 = cycle 2 silently stuck with no error despite no lock present, 12 = post-restart, content confirmed permanently lost).

## Landmines hit this session (for whoever picks up bench-1 next)

- **Killing `lantern.exe` with `Stop-Process -Force` can orphan its `llama-server` local-AI sidecar process**, which then holds an inherited handle on `C:\tauri-dev.log`, causing the next `Remove-Item`/relaunch to silently fail ("used by another process") with no obvious symptom beyond the scheduled task looking stuck. Fix: also kill any `llama-server-*` process by name before relaunching.
- **The `LanternDevBench` scheduled task can get stuck reporting `Running` after its process has already died** (`Start-ScheduledTask` then silently fails with result `0x800710E0`). Always check `(Get-ScheduledTask -TaskName LanternDevBench).State` and `Stop-ScheduledTask` first if it's not `Ready` before starting it again.
- **A brief transient workspace-switch glitch** was observed once, immediately after the fresh app launch: the UI showed a completely different workspace ("Northcrest Wealth Partners") for a few seconds before settling back to the correct "QA Workspace" (which matched `localStorage`'s recorded recent-workspace list throughout). Did not reproduce on a second fresh launch; treating as a one-off startup race, not confirmed as a reportable bug, but worth a second look if seen again.
- This VM's remote shell is PowerShell by default; `&&` is not supported (use `;`). Nested double-quoted paths with spaces (e.g. `C:\Users\lpbench\Documents\QA Workspace\...`) break through SSH's quoting — write a `.ps1`, `scp` it up, and run via `-File` instead of inlining.

## No product code changes

Per the brief's landmines — this lane only observed, tested, and reported. The one exclusive-lock file used for QA-34 testing was released and confirmed clean afterward. `~/lantern` was never touched.

## Bench state left behind

- `LanternDevBench` scheduled task: left running (app open) at hand-off; VM is being deallocated immediately after this evidence push per the brief.
- Scratch client `Smoke Test Family` and test document `my-document 2.docx` were left in the QA Workspace (harmless test artifacts, consistent with prior lanes' `Klutz Test Client` fixtures already present).
- SSH CDP tunnel (local port 9556) closed. VM deallocated via `az vm deallocate -g lantern-bench -n lantern-cloud-bench-1`.
