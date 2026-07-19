# Task row actions design review

## Scope and evidence

This pre-merge review covers the new task-row actions and the task delete confirmation only. Navigation and placement decisions were not reviewed, as requested.

The live Tasks surface was run with a disposable in-memory CRM boundary, so the row used the product's actual rendering, focus behavior, confirmation dialog, and soft-delete path. It ran on a fresh Xvfb display (`:94`), with Vite on fresh port `5188`, and fresh Google Chrome using `--password-store=basic` and a disposable profile. The display, server, browser, and profile were all torn down after capture.

- `evidence/design-review-task-row-actions/01-actions-visible.png` — two live task rows with Edit, Duplicate, and Delete visible.
- `evidence/design-review-task-row-actions/02-keyboard-focus-row-actions.png` — keyboard focus moves from the row title to Edit, with the focus ring visible.
- `evidence/design-review-task-row-actions/03-delete-confirmation.png` — the recovery wording and destructive confirmation state.
- `evidence/design-review-task-row-actions/04-task-moved-to-trash.png` — the deleted task is gone while the remaining row stays in place.

## Assessment

| Criterion | Assessment |
| --- | --- |
| Discoverability without clutter | Pass. The actions use plain, visible labels instead of a hidden menu. They sit as a compact three-button group at the row edge, so a person can scan a task's details first and then find its actions in one predictable place. |
| Existing Tasks tone | Pass. Small outlined secondary buttons and one clearly red destructive button fit the restrained, light Tasks surface. The group is quiet beside the title and metadata but still easy to find. |
| Delete wording | Pass. “The task will move to Trash, where it can be restored for 30 days.” is plain and honest. It clearly says this is recoverable, not permanent deletion. |
| Light-theme contrast | Pass. The regular actions have dark text and blue outlines on white; Delete uses a strong red fill and white text. The dialog stays crisp against the dimmed light surface. |
| Keyboard and labels | Pass. Each control has a specific accessible name, for example “Edit Prepare annual review.” From the row title, Tab lands on Edit first. The confirmation opens with Cancel focused, Escape closes it, and the visible controls provide a clear safe order: Cancel then Delete. |
| Confirmed outcome | Pass. After confirmation, the live task row disappears from the list through the recoverable Trash path. |

DESIGN-VERDICT: PASS
