# QA-81 baseline crash repro — bench-1, 2026-07-05 (pre-fix)

**Result: PASS = bug confirmed.** On `origin/lantern-plus @ ca3ffbb3` (before the `lp/savecrash-flush` fix lands), typing into a brand-new Word document and then killing the app process (simulating a crash) loses the typed text completely — with zero disk write ever happening, and the toolbar showing "Saved" the whole time.

## How this was tested

One single, self-contained script (`scripts/qa81-crash-repro.mjs`, not committed — scratch tooling) that:
1. Creates a brand-new client + a brand-new Word document.
2. Types real keyboard input (Playwright `keyboard.type`, not synthetic DOM events) into the empty editor.
3. **Does not navigate away.**
4. Kills `lantern.exe` (`Stop-Process -Force`) from *within the same script* — no separate SSH round trip, no timing race.
5. Reads the on-disk `.docx` directly via PowerShell's `System.IO.Compression.ZipFile` (a completely independent check, not going through the app's own UI) to see whether the typed text is really there.

This avoids the automation flakiness (multiple stray scripts left running and fighting over the same browser session) that made the previous pass's results less clean — this run used exactly one process, and it exits cleanly (`process.exit(0)`) when done.

## Raw result

```json
{
  "clientName": "QA81 Crash Repro 96014",
  "fileBase": "qa81-doc-37212",
  "docPath": "C:\\Users\\lpbench\\Documents\\QA Workspace\\QA81 Crash Repro 96014\\qa81-doc-37212.docx",
  "marker": "QA81-CRASH-MARKER-768789",
  "domTextAfterType": "qa81-doc-37212.docx\nDraft follow-up\nSend to Wealthbox\nExport\nRevise with AI\nSaved\nReviewing\n\nQA81-CRASH-MARKER-768789\n\nREVIEW\nAccept all\nReject all\nCHANGES (0)\n\nNo tracked changes in this document.",
  "saveStateAfterType": { "state": "idle", "label": "Saved" },
  "statBeforeKill": { "exists": true, "size": 1815, "mtimeMs": 1783285970849.272 },
  "statAfterKill":  { "exists": true, "size": 1815, "mtimeMs": 1783285970849.272 },
  "markerSurvived": false,
  "docxXmlSnippet": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document ...><w:body><w:p><w:r><w:t></w:t></w:r></w:p></w:body></w:document"
}
```

## What this means, plainly

- The typed marker text showed up on screen (`domTextAfterType` includes it) and the little "Saved" label was showing — exactly what a real advisor would see and trust.
- But the file on disk **never changed at all** — same exact size (1815 bytes) and same exact last-modified timestamp, both immediately before and immediately after killing the app. Nothing was ever written.
- Directly reading the real file content (not just asking the app) confirms it: the saved paragraph is completely empty (`<w:t></w:t>`), no trace of the typed text anywhere.
- So if the app crashes, or Windows forces a restart, or the power goes out, while someone is actively typing a brand-new document — before they click away to another file — everything they typed is gone, permanently, with no warning and no backup copy. This confirms **QA-81 is real and still present** on this tip.

## Evidence files

- `00-relaunch-clean-boot.jpeg` — app relaunched cleanly after the kill (10+ clients, no crash/blank/hang — the crash didn't corrupt anything else).
- `01-empty-after-crash.jpeg` — the actual test document (`qa81-doc-37212.docx`) reopened completely empty, "Saved" label showing.

## Bench state at handoff

- `C:\lantern-plus` on `origin/lantern-plus @ ca3ffbb3`, working tree clean.
- App running (scheduled task `LanternDevBench`), CDP port 9223 live.
- No stray/zombie automation processes (verified via `Get-CimInstance Win32_Process` before handoff).
- **Standing by** for the `lp/savecrash-flush` fix to merge, to re-sync and re-run this exact same script for the after-fix comparison.
