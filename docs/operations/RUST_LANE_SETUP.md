# Rust lanes: separate build folders, shared compiler cache

Each Rust lane gets its own build folder. This lets two people build at once without one build blocking the other. Think of it like giving each cook their own counter, while both still use the same well-stocked pantry.

The shared compiler cache is `sccache`. The private build folder is the Cargo target folder. Keep the folder on `/mnt/devcache`, not the home disk.

## Start a Rust lane

Pick a short lane name and seed it from a quiet, warm Rust build folder:

```bash
scripts/dev/seed-cargo-lane.sh intake-w4
```

The script creates `/mnt/devcache/cargo-targets/intake-w4`. It copies useful compiled files but deliberately skips `debug/incremental`. Those files are tied to one exact source state and are unsafe to share.

Before running Cargo in that lane, set:

```bash
export CARGO_TARGET_DIR=/mnt/devcache/cargo-targets/intake-w4
export CARGO_BUILD_JOBS=3
export SCCACHE_BASEDIRS="$(pwd)/src-tauri"
```

Run Cargo from `src-tauri` as usual. Start with at most two Rust lanes at once, with three build jobs each. That is the safe starting point; increase it only after timing evidence shows it helps.

## Close a lane

After the lane is merged and its worktree is gone, remove only its own folder:

```bash
rm -rf /mnt/devcache/cargo-targets/intake-w4
```

Never share one target folder between active lanes. Never copy another lane's `debug/incremental` folder. The full `npm run gate` still runs the complete Rust workspace proof before merge; these folders only make day-to-day feedback faster.
