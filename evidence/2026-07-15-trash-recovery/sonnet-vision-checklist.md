# Sonnet visual QA — Trash & recovery

Reviewer: Claude Sonnet, high effort

Reviewed: fresh final packaged drive screenshot captured 2026-07-15 UTC

Actual screenshot: `02-trash-after-restart.png`

Reference: `/home/jameson/lantern/design/alt-familiar/prototypes/alt-familiar-hifi-v2/index.html`, `trashSettings()` around lines 546–549.

| Check | Verdict | Evidence |
|---|---|---|
| Polished light theme | PASS | Light background, dark text, and clean card/table styling. |
| Title “Trash & recovery” | PASS | Trash icon and heading match. |
| 30-day recovery sentence | PASS | “Deleted CRM records stay recoverable for 30 days.” matches the prototype. |
| Search | PASS | “Search deleted records” input is present. |
| All-types filter | PASS | “All types · 1” is present; the count reflects the single real drive record. |
| Record / Type / Deleted / Time remaining / Deleted by / Recover columns | PASS | All six are visible. The explicit Recover header is a small clarity improvement over the prototype’s blank final header. |
| Recovery meter | PASS | A horizontal meter is visible below “30 days remaining.” |
| Deleted-by value | PASS | “drive-reviewer” is populated. |
| Recover action | PASS | The Recover button is visible and styled as the row action. |
| Firm-admin guard | PASS | “Permanent deletion requires a firm admin.” is visible with a shield icon. Its stronger callout treatment is not a functional gap. |

Non-blocking differences: the real app shows its local-AI setup banner above the page, and the frozen markup includes a second “Deleted by” filter chip that was not part of this lane’s required search + all-types-filter scope. The real surface labels the Recover column and promotes the admin warning into a stronger callout. None of these differences hide or block the required Trash controls.

OVERALL: PASS
