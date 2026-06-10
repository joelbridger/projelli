# Keepance 3.0 — Native Desktop Pass (Phase 6)
# native-findings.md — progress journal + evidence ledger
# Session started: 2026-06-10 (attempt 3 — resuming from two killed runs)

Severity: P0 ship-blocker / P1 fix before release / P2 fix soon / P3 polish
Type: bug / observation / ux-improvement / pass
Status: open / pass / blocked / needs-windows

---

## Evidence reuse notes (run 1 + run 2 screenshots)

Screenshots in screenshots/native/ from prior runs used as evidence below.
- 01–16: run 1 (initial launch through docx editor)
- run2-*: run 2 (wizard step 2 partial)
- run3-*: run 3 (workspace, docx regressions, upload)

| ID | Sev | Type | Status | Finding | Evidence | Notes |
|---|---|---|---|---|---|---|
| F-301 | — | pass | pass | **Item 1 - First run wizard**: Fresh profile shows Welcome to Keepance (3.0 copy), step 2 profession (Legal selected), step 3/4 folder picker GTK dialog opened with path typed, data-map accordion expanded (4 items), workspace opened. | screenshots/native/01-initial-launch.png, 03-profession-legal-selected.png, 05-folder-picker-dialog.png, 06-datamap-accordion-expanded.png, 13-workspace-in-app.png | All wizard steps confirmed across prior runs. |
| F-302 | — | pass | pass | **Item 2a - New docx → type → save → reopen**: Created test-document.docx in docs subfolder, typed "Hello from Keepance test", saved, reopened - content preserved, document editable. | screenshots/native/14-new-docx-created.png, 15-docx-editor-open.png, 16-docx-text-typed.png, run3-05-docx-reopened.png | PASS. Autosave working, reopen shows content. |
| F-303 | — | pass | pass | **Item 2b - Müller upload subfolder**: matter-files subfolder created, upload dialog triggered (run3-07 through run3-12), Müller — Schäfer engagement (draft 2).docx uploaded to matter-files. | screenshots/native/run3-07-new-folder-dialog.png, run3-08-folder-created.png, run3-09-upload-dialog.png, run3-10-muller-upload-done.png | Upload to subfolder via Upload + GTK dialog confirmed. |
| F-304 | — | pass | pass | **Item 2c - Tracked changes**: Opened test-document.docx in Reviewing mode, CHANGES(1) panel shows insertion by "You", "Accept change" tooltip visible, accept/reject buttons active. | screenshots/native/run3-05-docx-reopened.png, run3-06-tracked-accept-tested.png | Accept/reject tracked change UI confirmed. Note: only 1 tracked change present in synthetic doc, not the fixture engagement-letter-tracked.docx — will re-verify with that fixture below. |
| F-305 | P3 | observation | open | **Item 2d - "Open on Desktop"**: xdg-open headless = no desktop app to open with; the button is visible in sidebar (screenshots/native/13-workspace-in-app.png shows "Open on Desktop" in sidebar footer). Headless observation: command will silently fail or show no-desktop-environment warning. Needs Windows/macOS spot-check. | screenshots/native/13-workspace-in-app.png | Linux headless: genuinely impossible. Windows/macOS spot-check required. |

---

## In-progress items (active run below this line)

Items 3–12 and remaining item-2 sub-tasks will be appended below as evidence is collected.
