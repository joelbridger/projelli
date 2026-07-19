# Design review — task-list print

**Verdict: PASS**

Reviewed `v1/task-list-print` at `09ce745de92f440508905d3432001aafdeaa92c8`.

## What was checked

- The Tasks list shows a named **Print task list** button beside the existing
  list actions. It is a real enabled button with that accessible name, so the
  printer icon is helpful rather than the only cue.
- The browser popup output is a light, high-contrast page: a clear title and
  count, then a calm numbered list. Task and workflow-step rows are visibly
  distinguished and their status, assignee, and due information scans well.
- The three printed items exactly reflect the supplied on-screen task/workflow
  list. The print view adds no made-up data or unrelated toolbar/client data;
  it uses plain labels for supplied facts and for missing values.
- With popups blocked, the visible message is plain and honest: “The print
  window could not open. Allow popups and try again.” It does not falsely say
  that a printout or PDF was created.

## Evidence

- `design-review-task-list-print-control.png` — discoverable control on the
  actual Tasks surface.
- `design-review-task-list-print-output.png` — exact print-document helper
  rendered in a real browser popup from the same three supplied records.
- `design-review-task-list-print-popup-blocked.png` — truthful blocked-popup
  state on the actual Tasks surface.

## Bench record

- Fresh Vite server: `127.0.0.1:5301` (not 5174).
- Fresh virtual display: `:100` (not `:1` or `:251`).
- Fresh disposable Chrome profile with `--password-store=basic`.
- Focused behavior checks passed: 2 files, 9 tests.

The temporary browser, display, and Vite server were stopped after review.
