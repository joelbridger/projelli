# Tasks priority design review

## Scope and evidence

This is a pre-merge review of the new task-priority urgency marker only. Navigation placement was not reviewed, as requested.

The approved prototype and the named WB-039 audit file were not present in this checkout or its parent repository at review time. The review therefore used the stated approved direction (Wealthbox-style priority as an urgency marker) and the rendered Tasks surface's existing light visual language.

The product screen was run from this worktree in a fresh Xvfb display (`:92`), with Vite on fresh port `5177`, and a disposable Google Chrome/Chromium profile using `--password-store=basic`. The screen used the product's live Tasks rendering path with a disposable in-memory native-record boundary to show the three review records; no product or test files were changed.

- `evidence/design-review-task-priority/tasks-all-priorities.png` — the live list with High, Normal, and Low records.
- `evidence/design-review-task-priority/task-editor-priority-focus.png` — the live editor, its saved-state marker, and the native Priority control in keyboard focus.

## Assessment

| Criterion | Assessment |
| --- | --- |
| Legibility | Pass. Each compact pill says the full priority name, so it remains understandable without interpreting an icon. |
| Hierarchy | Pass. High is the warmest, most noticeable treatment, but its small outlined pill keeps it from competing with the task title. Normal and Low recede appropriately. |
| Existing Tasks tone | Pass. The pills use the same restrained borders, rounded shapes, small type, and light background as the surrounding Tasks screen. |
| Color, shape, and text redundancy | Pass. ▲ / ◆ / ▼, full words, and color all carry the same meaning. Color is not the only signal. |
| Light-theme contrast | Pass. The labels and borders are distinct against the white screen; Normal remains readable despite being intentionally quieter. |
| Dense-list resilience | Pass. Three adjacent rows keep the marker beside their metadata without wrapping, overlap, or a change in row height. |
| Editor and keyboard focus | Pass. The native Priority control has a clear focus outline, names its selected value, and the adjacent saved-state badge retains the saved High state. |

The screenshots also show pre-existing header/detail spacing collisions outside this marker change. They were not used to judge the marker and are outside this lane's fenced scope.

DESIGN-VERDICT: PASS
