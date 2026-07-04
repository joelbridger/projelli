# Fix brief — QA-40: transcript hang on real recordings (Legion) — restage per the new engine contract + close any product-side hang hole

**Lane:** cc-lantern-transfix · dir `~/lp-transfix` (own worktree, branch `lp/transcript-hang`). **Model:** Sonnet 5 · high. **You own the Legion** (it's free, at-rest).
**Read first:** BUG-DB QA-40 · `docs/evidence/meetings-verify3-20260704/RUN-LOG.md` (the repro: mic channel transcribes, sys channel never starts, 2/2) · the SIDECAR STAGING addendum in `docs/evidence/meetings-verify-20260704/RUN-LOG.md` (what's staged on the Legion: a translator SHIM at `C:\lantern-plus\src-tauri\binaries\whisper.exe` expecting the OLD `--stdin --model <tier>` contract, real engine under `whisper-engine\`) · the voicefix merge @aa0ab3eb (the app NOW speaks real whisper.cpp CLI: temp file, `-f <file> -np -nt -m <model-path>`, via ParakeetSidecar; `scripts/build-voice-sidecar.sh` + `scripts/fetch-voice-models.sh` are the new canonical staging).

## Working hypothesis (verify, don't assume)
New app contract hands the shim `-f <tempfile> -m <path>` and does NOT pipe stdin; the shim blocks forever reading stdin → sys-channel hang. Mic channel completing may predate the rebuild or take a different path — establish the real sequence from logs before concluding.

## Tasks
1. **Root-cause on the Legion with evidence** (process list during a hang: what is `whisper.exe` doing; its cmdline; is it the shim). Confirm or refute the mismatch hypothesis.
2. **Restage the Legion per the NEW contract**: remove the obsolete shim; stage the raw engine + models the way the new code expects (use the repo's own `scripts/build-voice-sidecar.sh`/`fetch-voice-models.sh` on the Legion if runnable there, or follow their layout manually — the engine build already exists at `C:\sidecar-build\`). Settings → Voice must still say "Voice ready".
3. **PRODUCT-SIDE HOLE CHECK (the important one):** a wedged engine subprocess hung the pipeline indefinitely — meetings windowed transcription must never hang forever on a stuck engine. Read the ParakeetSidecar/transcribe_meeting timeout story post-voicefix: if a hung engine process (one that consumes stdin/produces nothing) can stall a channel with no bounded timeout + honest error, that's a REAL P1 product fix — implement it (bounded per-window engine timeout, kill_on_drop, classified error into the meeting's needs-review path, consistent with the QA-31 notes watchdog pattern) with a red-first Rust test (fake engine binary that sleeps forever). If timeouts genuinely already cover it and the hang was purely the shim ignoring them (e.g. the shim consumed the timeout differently), prove that in writing.
4. **Live verify on the Legion:** record a short real meeting → transcript completes → notes land (the QA-31 fix is already proven; this closes the loop end-to-end with NO seeded fixtures). Screenshot transcript + notes. This is the Meetings-DONE evidence.

## Gate + handoff
Rust-touched ⇒ `CARGO_TARGET_DIR=$HOME/.cargo-target-lp-transfix`, one cargo box-wide, `timeout 1200` per test · tsc + full vitest + i18n 0 + eslint-gate if TS touched · codex self-review foreground/watched. Evidence to `docs/evidence/transfix-20260704/` on lp/windows-smoke-evidence (commit in ~/lp-bench, branch-check first) — product code commits go on YOUR branch `lp/transcript-hang`. Leave the Legion quiet. Handoff: root cause (proven), what was restaged, product fix yes/no + tests, live-verify verdict + screenshots. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/transcript-hang`

## Landmines
Never touch ~/lantern on the Legion. No cloud transcription. Unique tunnel port. No interactive menus — `COORDINATOR:` plain text.
