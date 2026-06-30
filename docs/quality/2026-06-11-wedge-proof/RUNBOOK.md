# VG-1 Leg 3 — Real-Machine Wedge Proof: RUNBOOK

Executed 2026-06-11 (attended, headless rig). This is the repeatable procedure —
every step below was actually performed; deviations from the original plan are
marked **[CONTINGENCY]** with the finding they produced. Results ledger:
[RESULTS.md](RESULTS.md). Harness: `scripts/wedge-proof-native.sh`.

## 1. Purpose + honesty boundaries

- Leg 3 is the audit's real-machine bar (F-117 / F-415 / F-422): the REAL Tauri
  debug binary on Xvfb :99, a quiesced production frontend (`vite preview`, no
  HMR), a fresh XDG profile, a headless Secret Service (gnome-keyring inside
  `dbus-run-session` — the live vector store requires the OS keychain before
  any embedding, `rag/mod.rs:446`), and Ollama as the local model.
- **Out of scope on this rig** (stays on Jameson's Windows spot check): live
  TLS mail import (F-419) and the live-audit-capture micro-item (F-425).
  Incidental audit evidence: with the headless keyring up, the app created
  `<ws>/.keepance/audit-enc.db` on first open — the live audit store
  initializes headless now; contents stay encrypted (F-425's at-rest proof).
  Banked as bonus evidence only.
- **Fixture caveat (state it everywhere):** the two Johnson fixtures carry
  inline `[CONTRADICTION-N: …]` annotation blocks. They are indexed text and
  make the LLM's job easier — chat attempt 1 literally quoted the
  `[CONTRADICTION-2 …]` block back. Acceptable for v1 (annotations are
  themselves matter-record text); a marker-free fixture variant is a follow-up.
- **Seeded-vs-clicked honesty:** three things are seeded into the webview's
  localStorage instead of clicked, each because the GTK layer is input-isolated
  on a no-WM Xvfb (campaign-proven), and each is byte-identical to what the
  real UI writes: (1) the recent-workspace entry (GTK file chooser unusable);
  (2) `keepance:settings → confidentialityMode: local-only` (what onboarding's
  "Keep everything on your computer" persists, `AiSetupStep.tsx:465`);
  (3) `templateModelOverrides` pinning the finder to Ollama (what Settings →
  Templates writes; the provider `<select>` opens a GTK popup that ignores
  synthetic input — surface itself screenshot-proven in run-08f…run-08i; and
  without the pin the run silently no-ops — finding F-502).

## 2. Bring-up (exact commands)

```bash
./scripts/wedge-proof-native.sh preflight   # memory, tools, ollama, model cache, keyring pkg
./scripts/wedge-proof-native.sh up          # build + Xvfb + vite preview + fresh profile/workspace
./scripts/wedge-proof-native.sh launch &    # first boot (creates the localStorage db); blocks
#   wait for the window:  DISPLAY=:99 xdotool search --name Advisor Prep Hero
#   shot boot-1 → first-run wizard = expected on the unseeded profile
./scripts/wedge-proof-native.sh down
./scripts/wedge-proof-native.sh seed-localstorage   # recents + onboarding + settings (above)
./scripts/wedge-proof-native.sh launch &    # the attended session
```

Every wait is screenshot-verified with `shot` (never timed blind). Watch the
launch output for the `keyring OK` probe line; watch `logs/app.log` for
`vectors key:` (any occurrence = the keychain bring-up failed — fix the
environment, never the app).

**[CONTINGENCY — F-501, fired 4×]** With the full fixture set, opening the
workspace OOM-killed the scope at the embed phase every time: twice at the
campaign-calibrated `MemoryMax=3G`, once at 6G, once at 12G (1 s curves in
`logs/cgroup-mem.csv`; journal `Failed with result 'oom-kill'`). Mechanism:
`index_one_file` embeds every chunk of a file through one `embed_documents`
call (`rag/mod.rs:343`), fastembed 4.9.1 batches 256 sequences internally, and
huge-notes.md (2 MB ≈ 1,400 chunks) makes that an accumulating multi-GB
allocation. Resolution per prime directive: the OOM is a logged P1 finding
(NOT fixed); the harness now excludes `huge-notes.md` from the seeded
workspace (`up`'s rsync) and the cap is recalibrated to 12G. **Expected
banner count is therefore 3 files on a fresh workspace** (deposition .txt,
incident-summary .md, acme-supply-agreement.txt), not the plan's original 4 —
and grows as AI artifacts (.aichat/.workflow) join the workspace (they are
indexable; see F-508).

## 3. The positive pass (what was done, with screenshots)

1. Selector shows seeded Recent — `run-01-selector`. Expand "Recent (1)"
   (~496,543), click `wedge-ws` (~683,567) — coordinates from THIS run's own
   screenshots, never reused blind.
2. `rag-progress-banner` appears and completes: **"Memory ready, indexed 3
   files."** (`run-02c-indexing-3files`; the 4-file in-flight banner on the
   pre-exclusion attempt is `run-02b-indexing-12g`). Disk truth: fragments
   under `<ws>/.keepance/vectors/chunks.lance`, zero `vectors key:` errors.
   Dismiss the "add your AI key" nudge card (it reappears each boot).
3. AI Assistant → green "Local-only mode is on…" banner, "Local model
   (Ollama)" picker showing **Llama 3.2 (3B)** → "+ Local model (Ollama)" →
   chat opens with the green egress line "On your machine. Nothing leaves",
   status bar "Memory: ready" (`run-03-local-chat`).
4. "Ask my workspace" ON → "Include privileged" toggle appears
   (`run-04-toggles`).
5. Ask THE question (identical to leg 1's c2 query):
   `What deadline was Johnson given to submit his written response about the expense review?`
   - Attempt 1 (`run-05a-answer-progress`): grounded two-sided answer (Oct 17
     vs Oct 10), scope chip "Scoped to all matters", "8 sources" accordion
     with real store hits from BOTH documents (`run-05b-sources`; full sources
     + scores in `output/local-chat-1.aichat.json`) — but no
     `[filename paragraph N]` citation → no chips, no live verification.
   - Attempt 2 (`run-05c-attempt2`): again grounded (incl. the "October 15"
     detail — verbatim transcript line 113); the model emitted
     `[1 paragraph 3]` → a chip RENDERS but is number-keyed; clicking it
     (`run-05d-chip-click`) shows "Source file not found: 1 … Re-indexing…" —
     honest failure, no crash. → finding F-503.
6. Click-through: expand the answer's sources accordion and click the
   `deposition-transcript-johnson.txt §3` row (same `onOpen` path as chips) —
   the real deposition opens in the editor **at line 1, top of file**; the
   cited passage (fixture line ~108) is not brought on screen
   (`run-06-clickthrough`) → corroborates leg 2's scroll-to-passage gap
   (F-504) on the native build.
7. Workflows → Deposition Contradiction Finder ▶ → Start dialog: "Total steps
   2, Estimated cost $0, This workflow runs on your local AI model. No
   provider charge." (`run-07-start-dialog`).
8. **[CONTINGENCY — F-502, fired]** On the default profile (no cloud keys, no
   template pin) "Run workflow" silently no-ops: dialog closes, no interview,
   no tab, nothing on disk (`run-08a/run-08b`). Diagnosis in RESULTS.md.
   Recovery used the product's own per-template override (Settings →
   Templates; surface shown in `run-08e…run-08i`; value seeded for the GTK
   reason above) pinning the finder to **Ollama / llama3.1:8b** (the option
   list is hardcoded to llama3.1:8b / qwen2.5:7b — llama3.2:3b is not
   offerable; `ollama pull llama3.1:8b` first). Relaunch → reopen workspace.
9. With the pin: ▶ → Run workflow → **the interview form renders**
   (`run-08o-after-run2`). Fill EXACTLY the leg-1 `FINDER_QUERY` inputs
   (`run-08p…run-08t`, `run-09i…run-09k` for attempt 2):
   - Matter name: `Johnson v. Nexus Dynamics Corp.`
   - Witness name: `Marcus Johnson`
   - Deposition date: `May 28, 2026`
   - Key claims (one line): `Whether Johnson forwarded documents to his
     personal email or all materials stayed on company servers. The deadline
     he was given for his written response to the compliance review. How many
     weeks of severance he was offered.`
   - Excerpts (one line, the three CLEAN Q/A passages — never the
     `[CONTRADICTION-N]` markers): `Q. Did you preserve those documents? A. I
     believe I did. I forwarded them to my personal email for safekeeping.
     Q. Did Mr. Weston tell you a deadline for submitting the explanation?
     A. He said I had until October 17, 2025 to submit my written response.
     Q. At the time of your termination, did anyone at Nexus Dynamics explain
     the severance package being offered? A. Sandra Liu gave me a document
     describing a four-week severance.`
   - Prior statements: empty. → Continue.
10. Run to completion (`run-09-run-complete`): green bar, "Verify before
    relying." banner, "Word deliverable ready — Flagged 3 candidate findings
    … 0 verified; 3 flagged unverified", the docx lands at
    `<ws>/Deposition Contradiction Finder - <ts>/Deposition Contradiction
    Analysis.docx`. Note: while a workflow tab is open the sidebar is hidden
    and Ctrl+B does not restore it; close the tab (Ctrl+W) to get the panel
    back (F-509).
11. `./scripts/wedge-proof-native.sh assert` — rubric on the NEWEST docx.
    Attempt 1: 4/5 clusters (C1 missed). Attempt 2 (identical inputs):
    3/5 (C1+C2 hit, C3 missed). Two attempts = stop, log F-507 — never tune.
    Both docx + extractions + run records banked under `output/`.

## 4. Option B ready-handoff run

```bash
./scripts/wedge-proof-native.sh down
./scripts/wedge-proof-native.sh launch --fresh-model &   # stashes the exe-adjacent bundle,
                                                         # removes the profile model; network ON
# selector → Recents → wedge-ws
```

- The **model download card** renders: "Setting up private search — Advisor Prep Hero
  is downloading its private search engine (about 465 MB), one time, from
  Hugging Face. You can keep working… 0 MB so far" (`run-10-download-card`).
- Bonus: a transient HF connection failure exercised the interrupted state —
  "The search engine download was interrupted. Nothing is lost. The download
  resumes where it stopped." + **Resume download** (`run-10b-progress`);
  clicking Resume completed the download.
- **The handoff:** the card vanished at Ready and the `rag-progress-banner`
  took over with no dead gap — "Indexing workspace: 1 / 6 file (17%)"
  (`run-10c-resumed`; 6 = 3 fixtures + 1 .aichat + 2 .workflow artifacts);
  indexing completed (`run-11-handoff`). Disk truth: 465 MB landed in the
  PROFILE's writable cache (`<profile>/data/keepance/models/e5-small`).
- `./scripts/wedge-proof-native.sh down` — restores the bundle stash
  (verified: `restored exe-adjacent model bundle from stash`).

Note the vector store was wiped (`rm -rf <ws>/.keepance/vectors`) before this
run so the deferred indexing had real work to do — otherwise re-opening an
already-indexed workspace is a no-op by design (the leak fix).

## 5. Contingencies that fired (summary — details in RESULTS.md)

| What | Disposition |
|---|---|
| Embed-phase cgroup OOM ×4 (3G, 3G, 6G, 12G) on huge-notes.md | **F-501 (P1)**; harness: exclude huge-notes.md, cap recalibrated 3G→12G |
| Local-only finder run silently no-ops without a template pin (the campaign's F-422 "interview did not render", now root-caused — it was never HMR) | **F-502 (P1)**; recovery = the product's own per-template Ollama pin |
| Local models don't emit the citation grammar (chat: none, then number-keyed; finder: sourceNumber absent → 0 verified) | **F-503 / half of F-507** |
| Citation click-through opens the file at the TOP (no scroll-to-passage listener) | **F-504** — corroborates leg 2 on native |
| Finder rubric 4/5 then 3/5 across the two allowed attempts (union 3/3, every planted quote verbatim) | **F-507**; diagnosis says LLM-selection floor, not the feed |
| `assert` used to write `*.extracted.txt` INTO the workspace (indexable → would contaminate re-runs) | harness bug, **fixed** (extraction now lands only in `output/`) |
| Workflow tab hides the sidebar; Ctrl+B inert while open | **F-509 (P3)** |

## 6. Artifact manifest (what must exist for a run to count)

- `screenshots/`: `run-01*` selector/recents · `run-02*` indexing/ready ·
  `run-03*` local chat + egress · `run-04` toggles · `run-05*` the two cited
  answers + sources + chip behavior · `run-06*` click-through · `run-07` start
  dialog · `run-08*` F-502 evidence, Settings/Templates surface, interview
  filled · `run-09*` run complete + attempt 2 · `run-10*`/`run-11` Option B
  card → interrupted/resume → banner handoff · `boot-1`/`smoke-*` bring-up.
- `logs/`: `app.log` (+ rotated `app.log.<ts>` per launch), `rss.csv`
  (keepance RSS @5 s), `cgroup-mem.csv` (whole-scope current/peak @1 s),
  `vite-preview.log`, `xvfb.log`.
- `output/`: `attempt{1,2}-Deposition-Contradiction-Analysis.docx` +
  `attempt{1,2}-extracted.txt` + `attempt{1,2}-run-record.workflow.json` +
  `local-chat-1.aichat.json`.
- RESULTS.md filled in, every FAIL carrying an F-5xx row.

## 7. Wave 2 extension (2026-06-11)

Same bring-up as §2 (`up` → `launch &` → wait for window → `down` → `seed-localstorage` → `launch &`). The seeded workspace now indexes **14 files** (OBSERVED on the live banner "Indexing workspace: 7 / 14 files"; the script comment is corrected to 14 — Wave 2 made docx/xlsx/pptx/rtf indexable Rust-side, on top of the text formats; the 3 scanned `.pdf` fixtures stay on the TS/OCR path, not in the Rust walk count). Attended items driven this pass (screenshots + artifacts under `wave2-rerun/`):

1. **Office citation (VG-2b):** local chat, Ask-my-workspace ON, ask "What hourly rate does the services agreement set?" → grounded "$375 per hour" answer with a `contract-services-agreement.docx §0` chip, `verified: true` on disk, chip click-through opens the `.docx` at the Fees & Payment clause. (`wave2-07`, `wave2-08`).
2. **Transcript citation (VG-3c):** ask the Weston retention question → "seven years" with a `Tr. 1:1-2:9` page:line chip, `verified: true` on disk. (`wave2-10`).
3. **Finder precision (F-510):** Workflows → Deposition Contradiction Finder ▶ → Run (the Start dialog confirms "runs on your local AI model" — F-502 stays fixed, no pin needed) → interview with the leg-1 inputs → completes to a `.docx`. `assert` rubric = **3/5** (C1 personal-email, C3 four-week, C3 eight-week); the cap is live (`perSourceCap` in the run record) and only 1 of 5 findings anchored on `huge-notes.md` vs the Wave-1 4/4 at 0/5 — the recovery. C2 partially surfaced; verdicts + the F-507a/all-matters-scope caveats are in RESULTS §F.

NOT re-driven natively this pass (deterministically test-covered; see RESULTS §F residuals): OCR retrieval over the scanned fixtures, and a letterheaded *deliverable* (a workflow run with a template set — the new-document byte-copy path was sanity-checked in Task 12; the deliverable merge + its review-found reconciliation fix are covered by the keepance-docx unit suite).

> Operator note: the in-app editor autosaves every ~2 s. If you mis-target the chat input and type into an open document, undo and restore the workspace copy from `tests/fixtures/matter-corpus/` immediately — the committed fixtures are never at risk, but a contaminated workspace copy would skew a re-index. (Happened once this pass; caught and reverted, committed fixtures verified untouched.)
