# Calendar grid — canonical shared-sheet handoff (Wave 1)

## Wave 2 adoption contract

The sole shared Event Sheet export is `CalendarEventSheet` from
`@/features/calendar-grid` (`src/features/calendar-grid/index.ts`, implemented
in `src/features/calendar-grid/CalendarEventSheet.tsx`). Calendar add-event and
record quick-add must rebase onto this landed change, delete their own sheet
implementations, and import this export. Keep the exact status chip wording:
**“Saved in this workspace.”**

## Rejection disposition

1. **Full workspace, not booking dashboard — resolved in this lane.** When Calendar is enabled it now replaces the existing Scheduling work area; the booking administration surface is not rendered beside it.
2. **Toolbar — resolved.** It has readable ranges, previous/next controls, joined Month/Week/Day controls, an active state, and New event.
3. **Month cues — resolved.** The grid keeps seven columns, shows outside-month dates, distinguishes today and selected days, and uses the red-edge/light-red event treatment.
4. **Week/Day duration and overlap — resolved.** Timed events use real vertical start/duration and divide overlap lanes side by side.
5. **Permanent details column — resolved.** Selection now opens a temporary 480px read-only peek. Edit opens the event sheet.
6. **Canonical editor — resolved as a shared export.** `CalendarEventSheet` is the reusable 520px sheet used by New event and grid edit. Its public Wave 2 import is `@/features/calendar-grid`.
7. **Empty — resolved.** The real calendar frame remains, with a centred dashed quiet panel.
8. **Loading — resolved.** A pending read retains the frame and uses a restrained loading cue; it never says the range is empty first.
9. **Error — resolved.** Retryable reads have Retry while the frame stays visible. The real Scheduling host now supplies the app workspace-picker hand-off through the mounted calendar contribution, and a contribution-mount test clicks that recovery action.
11. **Success — resolved.** Saving returns to the calendar context and shows the concrete past-tense toast, “Event saved.”
10. **Evidence recapture — owed.** This desk has focused automated coverage, not the packaged visual-drive setup needed for screenshots.

## A1 — seven-part screenshot evidence still owed at the pre-merge evidence step

| Required proof | Status in this lane |
| --- | --- |
| 1. Populated Month, Week, Day | Automated coverage added; packaged screenshots still owed. |
| 2. New event sheet over Calendar | Automated coverage added; packaged screenshot still owed. |
| 3. Peek then the same sheet for edit | Automated coverage added; packaged screenshot still owed. |
| 4. Record + Add → Event with linked household | Owed from record quick-add after it adopts `CalendarEventSheet`. |
| 5. Event-list row uses the same selection/edit path | Owed from the event-list owner after integration. |
| 6. Empty/loading/error/validation/saving/save-error/success/flag-off | Focused tests cover the core states; the full visual sequence and real save paths are still owed. |
| 7. Calendar home and neighbour/return path | Calendar is the full Scheduling work area with no new top-level route; the final Meetings-home evidence is still owed from that cutover. |

## A2 — title fallback

`eventSheetHeading` uses **Untitled event** for blank/whitespace titles and shortens an edit heading after 72 characters with an ellipsis. It never changes the saved title or the title field.

## A3 — status-chip wording for build-time review

The sheet currently says **“Saved in this workspace”**. This deliberately claims local persistence only; it does not claim sync, invitations, a provider, a meeting link, or delivery. Review this exact wording when the shared sheet is adopted by the sibling entry points.

## Scope notes

- No new top-level Calendar route was added.
- No native, provider, OAuth, or external-calendar code changed.
- The sibling integrations and packaged screenshots are intentionally listed as owed rather than asserted as complete.
