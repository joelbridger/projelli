# Unified daily list — design review verdict

## Scope and evidence

Reviewed the finished Tasks surface only. Navigation and placement were not judged.

- [Mixed ranked list](design-review-unified-daily-list/01-mixed-ranked-list.png)
- [Keyboard focus on a task row](design-review-unified-daily-list/02-keyboard-focus-task-row.png)
- [Empty work list](design-review-unified-daily-list/03-empty-work-list.png)

The screenshots were taken in a fresh Chrome session on a fresh `:104` display, with a disposable profile and `--password-store=basic`. The review server used Vite port `41846`, not `5174`. Browser, server, display, and disposable files were torn down after capture.

## What works

The list genuinely combines tasks and workflow steps. The empty state plainly tells an advisor how to begin. The light background and high-contrast text are calm and readable, and the focused task title has a clear visible outline.

## Changes required

1. Make a workflow step visibly different at a glance, and show it the same ranking facts as a task. Today the only distinction is small inline text: `Task` or `Workflow step`. The workflow row omits both its due date and priority, even though those facts decide its place in the shared list. Use a durable kind marker and show comparable due/priority information on both kinds.

2. Explain the order in the list itself. “1 of 3 open items fit the first daily plan” is a capacity message, not an ordering explanation. An advisor cannot tell why the workflow step sits between the two tasks, particularly because its due-today fact is invisible. Show a short rank reason on each row or an equally plain ranked-list explanation tied to the visible facts.

3. Give every work item the same accessible row structure and keyboard path. The current rows and their container are plain `div`s rather than a semantic list. A task title is a focusable button and gets a visible focus outline; a workflow title is only a `span`, so it has no comparable keyboard destination or row action. Use a semantic list and a consistent focusable row/action for both kinds.

## Verdict

The combined-list idea is sound, but the current surface makes two different kinds of work look too similar while hiding the facts that explain rank. It also gives the two row types uneven keyboard behavior. Address the three changes above before merge.

DESIGN-VERDICT: CHANGES-3
