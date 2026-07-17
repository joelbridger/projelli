# Calendar grid — design-convergence handoff

## Rejection disposition

1. **Full workspace, not booking dashboard — resolved in this lane.** When Calendar is enabled it now replaces the existing Scheduling work area; the booking administration surface is not rendered beside it.
2. **Toolbar — resolved.** It has readable ranges, previous/next controls, joined Month/Week/Day controls, an active state, and New event.
3. **Month cues — resolved.** The grid keeps seven columns, shows outside-month dates, distinguishes today and selected days, and uses the red-edge/light-red event treatment.
4. **Week/Day duration and overlap — resolved.** Timed events use real vertical start/duration and divide overlap lanes side by side.
5. **Permanent details column — resolved.** Selection now opens a temporary 480px read-only peek. Edit opens the event sheet.
6. **Canonical editor — resolved as a shared export.** `CalendarEventSheet` is the reusable 520px sheet used by New event and grid edit. Calendar add-event, record quick-add, and event-list owners still need to adopt this export at merge.
7. **Empty — resolved.** The real calendar frame remains, with a centred dashed quiet panel.
8. **Loading — resolved.** A pending read retains the frame and uses a restrained loading cue; it never says the range is empty first.
9. **Error — partly resolved.** Retryable reads have Retry while the frame stays visible. The sheet accepts an optional real `onOpenWorkspace` hand-off for no-workspace recovery; the shell has not yet supplied that hand-off, so that one wiring item is owed.
10. **Evidence recapture — owed.** This desk has focused automated coverage, not the packaged visual-drive setup needed for screenshots.

## A1 — seven-part proof gate

| Required proof | Status in this lane |
| --- | --- |
| 1. Populated Month, Week, Day | Automated coverage added; packaged screenshots owed. |
| 2. New event sheet over Calendar | Automated coverage added; packaged screenshot owed. |
| 3. Peek then same sheet for edit | Automated coverage added; packaged screenshot owed. |
| 4. Record + Add → Event with linked household | Owed from record quick-add owner after it adopts `CalendarEventSheet`. |
| 5. Event-list row uses same selection/edit path | Owed from event-list owner after integration. |
| 6. Empty/loading/error/validation/saving/save-error/success/flag-off | Empty/loading and sheet validation covered here; full visual state sequence and real save paths owed. |
| 7. Calendar home and neighbour/return path | This lane makes Calendar a full-width existing Scheduling work area, with no new top-level route. The final Meetings home evidence is owed from the Meetings-shell cutover. |

## A2 — title fallback

`eventSheetHeading` uses **Untitled event** for blank/whitespace titles and shortens an edit heading after 72 characters with an ellipsis. It never changes the saved title or the title field.

## A3 — status-chip wording for build-time review

The sheet currently says **“Saved in this workspace”**. This deliberately claims local persistence only; it does not claim sync, invitations, a provider, a meeting link, or delivery. Review this exact wording when the shared sheet is adopted by the sibling entry points.

## Scope notes

- No new top-level Calendar route was added.
- No native, provider, OAuth, or external-calendar code changed.
- The sibling integrations and packaged screenshots are intentionally listed as owed rather than asserted as complete.
