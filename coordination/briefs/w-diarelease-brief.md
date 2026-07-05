# Worker brief — Stage the diarization sidecar+models into the release pipeline (#12), dry-validated

**Lane:** cc-lantern-diarelease · worktree `~/lp-diarelease` · branch `lp/diarize-release-staging`. **Model:** Sonnet 5 · high.
**CARGO_TARGET_DIR:** `$HOME/.cargo-target-lp-diarelease` (seeded warm). `timeout 1200` on cargo.

## Source of truth
`docs/operations/2026-07-04-diarize-release-staging-plan.md` (a read-only investigation's plan — grounded: the referenced scripts `scripts/{fetch-diarize-models,build-diarize-sidecar}.sh` and `src-tauri/sidecar-src/lantern-diarize` all exist). Follow it; verify each described diff against current files before applying.

## Do
1. Add `binaries/lantern-diarize` to `externalBin` in `src-tauri/tauri.conf.json` (mirror how `piper` is listed) and stage its native libs + models per the plan's per-platform file list (Windows DLLs beside the exe; models into resources; download-at-build via the existing fetch script — NO Git LFS, checksums verified).
2. Edit `.github/workflows/release.yml` to build the sidecar + fetch models BEFORE the bundling step, and (critical) BEFORE the macOS signing step (so the new Mach-O libs get signed) — per the plan. Add the CI toolchain deps the plan flags (LLVM/libclang for sherpa-rs-sys bindgen on Linux+Windows).
3. Add explicit post-staging existence checks (fail the job loudly if a required binary/DLL/model is missing) — the plan's "High" risks are silent-missing-file failures.

## Verify WITHOUT a real release (HARD RULE — never push a release tag, never cut an installer for users)
- `bash scripts/fetch-diarize-models.sh` then `TARGET_TRIPLE=x86_64-unknown-linux-gnu bash scripts/build-diarize-sidecar.sh`; confirm the staged files land (`find src-tauri/binaries src-tauri/resources/diarize -type f`).
- Local Linux bundle: `timeout 1800 npm run tauri build` (if feasible on this box) then `dpkg-deb -c .../bundle/deb/*.deb | grep -E 'lantern-diarize|sherpa|onnxruntime'` to PROVE the sidecar is inside the bundle.
- Final smoke: run the staged `lantern-diarize` against a tiny 16kHz mono WAV using the staged model paths — proves it loads its native libs + models.
- If a full `tauri build` is too heavy/slow here, validate as far as the bundle-config + a `--dry-run`/`act`-style parse of release.yml and the sidecar build+smoke, and DOCUMENT precisely what still needs a real CI build run to prove (the mac codesigning path especially — that can only be truly verified in CI). Honesty over false green.
- Windows/mac codesigning correctness can't be fully proven off-CI — describe the exact CI check to add, don't fake it.

## Rules
Never trigger a real release. tsc unaffected (config/YAML only, spot-check). Codex self-review of the diff (--base origin/lantern-plus), cap 3 rounds. Push; do NOT merge. Evidence handoff: what you changed, what the local bundle proved, what still needs a real CI run. Last line exactly: `WORKER-DONE: lp/diarize-release-staging`
