# Bench steps — finishing the two harness speed wins

The script/code work is done and unit-tested off-bench. These are the remaining
steps that need the real Windows app on the **Legion bench** (`james@100.127.67.22`).
Run them **only when the bench is confirmed clear** (the `demotest` session isn't
driving it). Each step prints a pass/fail; stop and report on any fail.

## Preconditions (once)

- Tunnel up (IPv4 on both ends):
  `ssh -fN -o ExitOnForwardFailure=yes -L 127.0.0.1:9444:127.0.0.1:9223 james@100.127.67.22`
- The canonical workspace `C:\keepance-demo-northcrest\Northcrest Wealth Partners`
  exists and holds the demo documents, and the app (KeepanceDev) is running.
- **Ask must resolve to OpenAI** for the OpenAI fixture to be exercised: an OpenAI
  key present in the bench keychain with Anthropic absent, or `defaultProvider=openai`
  in settings. (Confirm with the live Ask in step 1 / the recorder in step 3.)

## Step 1 — build the golden snapshot (#2)

```bash
npm run robot:build-snapshot
```

Opens the workspace, WAITS for the RAG index to finish + stabilize, PROVES isolation
(no cross-client leaks) + a cited Ask, then archives the workspace (+ `.keepance`)
to `C:\keepance-snapshots\northcrest-golden.tar` (+ `.manifest.json`).

- PASS = `SNAPSHOT BUILD: OK` and a non-zero `archiveBytes` in the manifest.
- The index-wait requires the broad retrieval to reach a floor of stable hits
  (`BUILD_SNAPSHOT_MIN_HITS`, default 40) so a stalled/partial index can't be
  frozen; the job also PROVES isolation (5 matters) + a cited Ask before archiving.
  **Sanity-check those proof counts in the output** — they're the real coverage signal.
- If the index hasn't finished, the job waits up to 20 min (override with
  `BUILD_SNAPSHOT_INDEX_TIMEOUT_MS`). Use `--skip-index-wait` only if you KNOW the
  index is already complete.
- The restore verifies the archive's sha256 against the manifest and that the
  extract contains real documents (not an index-only husk) before the swap, and
  swaps with rollback (old workspace moved aside, restored if the move fails).

## Step 2 — verify the fast restore (#2)

```bash
node scripts/robot/cli.mjs reset '{"mode":"snapshot"}' --no-daemon
```

Should restore the frozen world in seconds (kill → extract+swap → restart → reseed)
and report `ok:true` with `seeded.mattersCount: 26`. This is the new fast reset the
smoke uses. (If no archive exists it REFUSES and reports a guard error — it must
never wipe the workspace without a valid archive.)

## Step 3 — record the provider-accurate Ask fixture (#3)

Record **against the frozen snapshot** (step 2 just restored it) so the answer's
citation markers stay stable on replay:

```bash
npm run robot:record-ask
```

Writes `scripts/robot/fixtures/ai-replays/ask-portfolio.json` (OpenAI frames). Open
it and sanity-check it has real answer text + `wireFormat:"openai"`. This REPLACES
the committed placeholder. Commit it.

> If recording fails with "no OpenAI chat-completions stream captured", Ask resolved
> to a non-OpenAI provider — fix the bench provider/default (precondition above) and
> re-record.

## Step 4 — run the deterministic smoke (#3 + #2 together)

```bash
npm run robot:smoke
```

Default now = `snapshot` reset + fixture-replayed Ask + egress guard. Expect:
`[PASS] ask ... — egress: served>=1 leaks=0` and a new cited attestation. No live
AI spend. If `egress` shows `leaks>0` or `served=0`, the run FAILS loudly (that's
the guardrail working — investigate; do not "make it green").

## Step 5 — keep a weekly live-model drift run

```bash
ROBOT_SMOKE_LIVE_AI=1 npm run robot:smoke   # real model, lighter 'fast' reset
```

Schedule this weekly to catch provider drift; the routine PR/branch smokes use the
deterministic default.

## Gotchas

- **The snapshot is bench-bound + path-bound.** Its index keys live in this machine's
  OS keychain and absolute paths are baked into the index — build and restore only on
  this bench, only to the canonical path. Don't copy the `.tar` to another machine and
  expect it to decrypt.
- **A webview `location.reload` kills the Vite dev server on this bench** — the reset
  modes restart `tauri:dev` instead of reloading.
- After step 3, re-run step 4 to confirm the real fixture produces cited chips
  (the committed placeholder will NOT).
