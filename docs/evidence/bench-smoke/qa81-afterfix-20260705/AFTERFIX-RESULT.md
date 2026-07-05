# QA-81 after-fix crash repro — bench-1, 2026-07-05 (post-fix)

**Result: PASS — the fix works. Typed text survives a crash now.**

Tip: `origin/lantern-plus @ 7089fc65` (includes the QA-81 fix, `81e35ca7`, `lp/savecrash-flush`). No Rust changes in this diff, so this was a frontend-only relink.

## Same exact test as the baseline

Reused the identical script (`qa81-crash-repro.mjs`, unchanged) from the pre-fix baseline run (`docs/evidence/bench-smoke/qa81-baseline-20260705/`):
1. Create a brand-new client + brand-new Word document.
2. Type real keyboard input into the empty editor.
3. Do **not** click away.
4. Kill `lantern.exe` (simulated crash) from within the same script.
5. Read the raw `.docx` off disk directly via `.NET ZipFile` — independent of the app's own UI.

## Raw result

```json
{
  "clientName": "QA81 Crash Repro 58173",
  "fileBase": "qa81-doc-69638",
  "docPath": "C:\\Users\\lpbench\\Documents\\QA Workspace\\QA81 Crash Repro 58173\\qa81-doc-69638.docx",
  "marker": "QA81-CRASH-MARKER-226220",
  "domTextAfterType": "qa81-doc-69638.docx\nDraft follow-up\nSend to Wealthbox\nExport\nRevise with AI\nSaved · just now\nReviewing\n\nQA81-CRASH-MARKER-226220\n\nREVIEW\nAccept all\nReject all\nCHANGES (0)\n\nNo tracked changes in this document.",
  "saveStateAfterType": { "state": "idle", "label": "Saved" },
  "statBeforeKill": { "exists": true, "size": 1197, "mtimeMs": 1783289560286.3694 },
  "statAfterKill":  { "exists": true, "size": 1197, "mtimeMs": 1783289560286.3694 },
  "markerSurvived": true,
  "docxXmlSnippet": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:document ...><w:body><w:p><w:r><w:t>QA81-CRASH-MARKER-226220</w:t></w:r></"
}
```

## What changed vs. the baseline (plainly)

- **Before the fix:** typed text showed on screen and said "Saved," but the real file on disk never changed at all — 0 bytes of the typed text ever landed. Killing the app lost everything.
- **After the fix:** the save label now says **"Saved · just now"** (new, more specific wording) — and this time it's telling the truth. The file on disk was already updated with the typed text (1197 bytes, non-empty) *before* the app was even killed. Reading the real file content directly (not asking the app, just looking at the bytes) confirms the exact typed marker text (`QA81-CRASH-MARKER-226220`) is really there.
- Relaunched the app fresh afterward and opened that same document again — the text is right there on screen too. Both the raw file and the app's own display agree: **nothing was lost.**

## Evidence files

- `00-relaunch-clean-boot.jpeg` — app relaunched cleanly after the kill, no crash/blank/hang.
- `01-text-survived.jpeg` — the test document (`qa81-doc-69638.docx`) reopened showing the typed marker text intact.

## Bench state at handoff

- `C:\lantern-plus` on `origin/lantern-plus @ 7089fc65`, working tree clean.
- App running (scheduled task `LanternDevBench`), CDP port 9223 live.
- No stray/zombie automation processes.
- **Bench-1 is ready to be deallocated** — this was the last planned test for this round.
