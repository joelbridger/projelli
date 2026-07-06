# Worker brief — swallow-p0 Check B on the LEGION (pin lifted by Jameson's demo postponement)

You are **cc-lantern-legioncheck**, a Legion driver lane. Work from **~/lp-swallow8** (branch `lp/swallow-p0-r8` @2efa2e05); commit nothing to it. Read `coordination/WORKER-DISCIPLINE.md`.

## Context — why the Legion, and what changed
Jameson postponed the demo (major UI work comes first), so the Legion's abcedeb0 freeze is LIFTED (coordinator's call, told to Jameson). A full archive backup of the repo exists (~/archive/lantern-plus-backup-20260706-uiapproved). Both cloud benches have a proven pathology: WebView2 executes a STALE frontend for the identical URL that curl fetches fresh — evidence at `docs/evidence/cloudcheck-swallow/checkB-bench2/` on branch lp/cloudcheck-evidence (read it). The Legion demonstrably executes fresh code (the certified dry-runs exercised brand-new fixes live). Legion access: Tailscale `james@100.127.67.22`, drive via `scripts/desktop-drive.mjs` + `scripts/legion_agent.py` (see `~/.claude/projects/-home-jameson/memory/reference_keepance_desktop_control.md`).

## The mission — Check B only
1. Bring the Legion's checkout to **lp/swallow-p0-r8 @2efa2e05** exactly; rebuild.
2. **Runtime-freshness proof FIRST** (non-negotiable given the bench episode): over CDP, confirm a symbol that exists only in this code (`pendingFolderRetagHydrationSuspect`) resolves in the RUNNING webview. Record the proof.
3. **Check B:** 2-client test workspace, indexed folder mapped to client A → remap A→B → kill the app BEFORE the retag completes (several attempts fine) → relaunch → verify (i) the hold is restored at boot (banner and/or old-client Ask withholds that folder during the heal window — no stale wrong-client answers), (ii) after the heal: B finds it, A doesn't, banner clears.
4. Evidence (screenshots + transcript + verdict) → branch `lp/cloudcheck-evidence`, `docs/evidence/cloudcheck-swallow/checkB-legion/`, push `--no-verify`.
5. Leave the Legion app CLOSED and the machine tidy when done (no deallocate — it's the physical bench).

## Done criteria (HARD)
Evidence pushed (verify `git ls-remote`). THEN print exactly: `WORKER-DONE: legioncheck checkB` + `CHECK-B: PASS|FAIL|BLOCKED — <one line>` + the freshness-proof note. Honest FAIL/BLOCKED beats a fake PASS.
