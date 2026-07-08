# Email UX Simplification Audit

## 5-line screen summary

1. The Email screen is a two-pane workspace: a left rail for search/results and a right pane for reading one message.
2. The rail shows an Email title, a plus button, a more menu, a search field, hidden filters, result counts, load-more, selectable rows, badges, snippets, and empty/error states.
3. The reader shows notices, an export strip, subject, sender/date card, attachments, sensitivity, filing, body text, and a full reply composer.
4. Filing appears in three shapes: bulk bar, message reader panel, and older row popover; sensitivity appears as both row badge and reader radio control.
5. AI search is a separate mode with teaching copy, example chips, ranked cards, score numbers, and raw mail ids.

## Recommendations

1. HIGH - Collapse the always-open reply composer.
   - What/where: `EmailViewer`, reply area at `src/features/email/EmailViewer.tsx:728`.
   - Why it costs more than it gives: every opened email looks like a compose screen, even when the user only wants to read. The box adds many borders, labels, fields, and equal-weight buttons below the message.
   - Concrete simplification: show a single compact action row after the body: primary `Reply`, secondary icon button `Draft with AI`, and a `...` menu. Clicking `Reply` opens the existing fields inline. Put `Reply in your mail app`, `Copy`, and `Save as document` inside the `...` menu. Keep send errors and reconnect warnings visible only after the user opens reply.
   - Exact copy: `Write your reply...` -> `Reply...`; `Reply in your mail app` -> `Open in mail app`; `Save as document` -> `Save as document`; `Draft with AI` -> `Draft with AI` stays.
   - Impact: HIGH.

2. HIGH - Turn Sensitivity from a box into a visible pill with a menu.
   - What/where: `EmailViewer`, sensitivity control at `src/features/email/EmailViewer.tsx:452`; strings at `src/locales/en.json:1601`.
   - Why it costs more than it gives: the radio group takes a full bordered panel for a setting that usually stays unchanged. The trust signal matters, but the three choices do not need to be visible all the time.
   - Concrete simplification: replace the bordered panel with one pill near the subject metadata: shield icon + current state + chevron. Open a dropdown with `Standard`, `Sensitive client`, and `Work product`. Keep the amber explanation visible only when a sensitive state is active, as a one-line note under the pill or in an info tooltip.
   - Exact copy: `Sensitivity` -> `Sensitive`; `Sensitive Client` -> `Sensitive client`; `Excluded from AI retrieval by default. The Include sensitive content toggle in chat is the only way to bring it back in.` -> `Excluded from AI unless you turn on Include sensitive content.`
   - Impact: HIGH.

3. HIGH - Turn File to client from a chip wall into one dropdown row.
   - What/where: `EmailViewer`, file-to-matter control at `src/features/email/EmailViewer.tsx:500`.
   - Why it costs more than it gives: every client becomes a visible chip. That gets noisy fast and makes the reader feel like a settings screen.
   - Concrete simplification: show one compact row near metadata: `Filed to: [Client name]` or `Not filed` with a folder icon and chevron. Opening it shows the existing searchable picker. Keep success/error states inline under that row.
   - Exact copy: `File to client` -> `Filed to`; `Filed successfully.` -> `Filed`; `No clients yet. Create a client first.` -> `Create a client first.`
   - Impact: HIGH.

4. HIGH - Remove the standalone Export strip.
   - What/where: `EmailWorkspace`, export bar at `src/features/email/EmailWorkspace.tsx:1186`.
   - Why it costs more than it gives: a whole horizontal strip appears above the message for one secondary action. It competes with reading and breaks the clean reader flow.
   - Concrete simplification: move `Export` into a reader `...` menu in the message header. If export fails, show a small toast or inline menu error, not a permanent strip.
   - Exact copy: `Export` -> `Save email`; `Export failed` -> `Could not save`.
   - Impact: HIGH.

5. HIGH - Make the message header plain, not a card.
   - What/where: `EmailViewer`, sender/date header card at `src/features/email/EmailViewer.tsx:636`.
   - Why it costs more than it gives: the border and shaded card make normal email metadata feel like a separate module. The labels already explain themselves.
   - Concrete simplification: put From, To, Cc, and Date as quiet metadata lines directly below the subject. Use light dividers only between major sections, not around metadata.
   - Exact copy: keep `From`, `To`, `Cc`, `Date`, but remove uppercase styling. `Date` can be calendar icon + date with no label when space is tight.
   - Impact: HIGH.

6. HIGH - Show one no-email empty state, not two.
   - What/where: rail empty state at `src/features/email/EmailWorkspace.tsx:782`; detail empty state at `src/features/email/EmailWorkspace.tsx:1216`.
   - Why it costs more than it gives: the same icon, title, and helper text can appear in both panes. That makes an empty screen feel heavier and more broken than it is.
   - Concrete simplification: when there are no results, keep the rail visually quiet and show the empty state once in the detail pane. In the rail, show only a small muted line like `No results`.
   - Exact copy: `No emails found` -> `No email`; `Try a different keyword or adjust the filters.` -> `Try another search or filter.`; `No email has been synced yet.` -> `No email synced yet.`
   - Impact: HIGH.

7. HIGH - Simplify AI search cards by hiding score and raw ids.
   - What/where: `AskHitCard`, rank/score/id at `src/features/email/AskHitCard.tsx:46`, `src/features/email/AskHitCard.tsx:74`, and `src/features/email/AskHitCard.tsx:103`.
   - Why it costs more than it gives: `score 0.823` and a raw mail id are machine details. They do not help an advisor decide which email to open.
   - Concrete simplification: keep subject, snippet, sender/date if available, and maybe a small rank number. Move score and raw id to a tooltip or debug-only view.
   - Exact copy: remove visible `score {{number}}`; remove visible raw id. Tooltip can say `Match strength`.
   - Impact: HIGH.

8. HIGH - Make AI search mode feel like search, not a separate lesson.
   - What/where: `EmailWorkspace`, Ask empty state at `src/features/email/EmailWorkspace.tsx:1029`.
   - Why it costs more than it gives: title, paragraph, and three long chips take over the whole pane before the user has done anything.
   - Concrete simplification: keep one short hint under the search field when AI mode is active, then show two compact example chips max. Consider putting AI search behind a sparkle icon inside the search field instead of a hidden mode in the `...` menu.
   - Exact copy: `Search your email` -> `Ask your email`; `I search across your imported email and answer with citations you can open.` -> `Answers use imported email and openable citations.`; `Who emailed about a beneficiary change?` -> `Beneficiary change`; `Find statements with attachments from the custodian` -> `Statements with attachments`; remove the third chip by default.
   - Impact: HIGH.

9. HIGH - Keep only one primary action in the reply action row.
   - What/where: `EmailViewer`, reply buttons at `src/features/email/EmailViewer.tsx:832`.
   - Why it costs more than it gives: `Draft with AI`, `Send`, `Reply in your mail app`, `Copy`, and `Save as document` all sit at the same level. The user has to decide which button matters.
   - Concrete simplification: after reply opens, make `Send` the one filled primary button. Keep `Draft with AI` as a quiet secondary button beside the textarea. Move `Reply in your mail app`, `Copy`, and `Save as document` into `...`.
   - Exact copy: `Copied!` -> `Copied`; `Send` stays; `Draft with AI` stays; `Reply in your mail app` -> `Open in mail app`.
   - Impact: HIGH.

10. MED - Replace the mode menu's "Current:" text with checkmarks.
    - What/where: `EmailWorkspace`, mode items at `src/features/email/EmailWorkspace.tsx:890`; string at `src/locales/en.json:1556`.
    - Why it costs more than it gives: `Current: Keyword search` reads like status text inside a command menu. Menus in the rest of the app already use compact action patterns.
    - Concrete simplification: show a checkmark on the active item and remove `Current: `. Keep the two choices in the `...` menu if AI remains a separate mode.
    - Exact copy: `Current: Keyword search` -> checkmark icon + `Keyword search`; `Current: AI search` -> checkmark icon + `AI search`.
    - Impact: MED.

11. MED - Make filters a compact active-filter row.
    - What/where: `EmailWorkspace`, filter panel at `src/features/email/EmailWorkspace.tsx:808`; strings at `src/locales/en.json:1559`.
    - Why it costs more than it gives: the panel is fine when open, but date labels and attachment copy create a small form for a task that should feel like narrowing a list.
    - Concrete simplification: collapsed state shows chips only when active: `Gmail`, `After Jul 1`, `Before Jul 8`, `Attachments`. The `...` menu item opens the panel. In the panel, combine the two date fields under one label: `Date range`.
    - Exact copy: `Show filters` -> `Filters`; `Hide filters` -> `Hide filters`; `From` -> `After`; `To` -> `Before`; `Has attachment` -> `Attachments`.
    - Impact: MED.

12. MED - Reduce result count and load-more copy.
    - What/where: `EmailWorkspace`, result count and load-more at `src/features/email/EmailWorkspace.tsx:986`; strings at `src/locales/en.json:1583`.
    - Why it costs more than it gives: `Showing 50 of 183`, `All email loaded`, and `Load more (133 remaining)` add bookkeeping text to a narrow rail.
    - Concrete simplification: show counts only while a search/filter is active. Default inbox can omit `All email loaded`. Use a shorter button.
    - Exact copy: `Showing {{shown}} of {{total}}` -> `{{shown}} of {{total}}`; `All email loaded` -> remove; `Load more ({{count}} remaining)` -> `More`; `Loading...` -> `Loading`.
    - Impact: MED.

13. MED - Shorten the first-connect callout.
    - What/where: `EmailWorkspace`, first-connect callout at `src/features/email/EmailWorkspace.tsx:1127`.
    - Why it costs more than it gives: the callout is a nice welcome, but it takes a full banner and uses a sales-like phrase: "a search your inbox never could."
    - Concrete simplification: make it one short sentence with one plain action. Dismiss still stays.
    - Exact copy: `Your email is connected. Try a search your inbox never could. Search by name, topic, or deadline` -> `Email connected. Try searching by name, topic, or deadline.`
    - Impact: MED.

14. MED - Shorten the no-account empty state while keeping trust visible.
    - What/where: `NoAccountsState`, empty state at `src/features/email/NoAccountsState.tsx:18`.
    - Why it costs more than it gives: the body tries to explain search, filing, citations, and privacy in one sentence.
    - Concrete simplification: split into one value line and one trust line. Keep the primary button.
    - Exact copy: `No email connected` -> `Connect email`; `Connect your email to search across it, file messages to a client, and cite them in answers. It is imported to your machine, not our servers.` -> `Search, file, and cite email. Imported to this device, not our servers.`; `Connect your email` -> `Connect email`.
    - Impact: MED.

15. MED - Make attachments an inline metadata row.
    - What/where: `EmailViewer`, attachments panel at `src/features/email/EmailViewer.tsx:667`.
    - Why it costs more than it gives: attachments get a separate bordered module, even when they are simple downloadable chips.
    - Concrete simplification: put paperclip + attachment chips directly below the header metadata. Only show a warning line if attachments exist but cannot be downloaded.
    - Exact copy: `Attachments` -> remove visible heading; `This message has attachments. Open it in your mail app to download them.` -> `Open in mail app to download attachments.`
    - Impact: MED.

16. MED - Make the bulk action bar smaller and more command-like.
    - What/where: `BulkActionBar`, selected bar at `src/features/email/BulkActionBar.tsx:25`.
    - Why it costs more than it gives: a bordered bar with `File to client` and `Clear selection` feels heavy for a temporary state.
    - Concrete simplification: use a slim sticky row: `3 selected` | `File` | icon-only `X` with tooltip `Clear selection`. Keep the same bulk picker.
    - Exact copy: `File to client` -> `File`; `Clear selection` -> tooltip only; `{{count}} selected` stays.
    - Impact: MED.

17. MED - Use one shared filing picker pattern.
    - What/where: `BulkMatterPicker` at `src/features/email/BulkMatterPicker.tsx:46`; `MatterPickerPopover` at `src/features/email/MatterPickerPopover.tsx:53`; reader filing at `src/features/email/EmailViewer.tsx:500`.
    - Why it costs more than it gives: the same job appears as a chip wall in the reader and dropdown pickers elsewhere. Users have to relearn one task.
    - Concrete simplification: standardize on a searchable dropdown everywhere. The trigger text changes by context: `File`, `Filed to: Acme`, or `3 selected`.
    - Exact copy: `Search clients...` -> `Find client`; `No matching clients` -> `No matches`; `No clients yet` -> `No clients yet`.
    - Impact: MED.

18. MED - Quiet the compose modal controls.
    - What/where: `ComposeModal`, modal body and footer at `src/features/email/ComposeModal.tsx:107` and `src/features/email/ComposeModal.tsx:396`.
    - Why it costs more than it gives: New email has a header, a scroll body, a footer, labels, borders, and an Attach text button. It feels more like a form than a simple email draft.
    - Concrete simplification: put `Send` in the header as the primary action. Make Attach an icon button beside the body toolbar. Keep `Cc / Bcc` folded. Use the same lighter field style as reply.
    - Exact copy: `New email` stays; `Attach` -> icon-only with tooltip `Attach file`; `Connect an account first in Settings.` -> `Connect email in Settings first.`
    - Impact: MED.

19. MED - Shorten search placeholders and remove ellipses.
    - What/where: `EmailWorkspace`, search field at `src/features/email/EmailWorkspace.tsx:969`; strings at `src/locales/en.json:1564`.
    - Why it costs more than it gives: the placeholder repeats "email" inside the Email screen and the ellipsis adds visual noise.
    - Concrete simplification: use short, action-first placeholders.
    - Exact copy: `Search email by keyword...` -> `Search email`; `Search your email with AI...` -> `Ask email`.
    - Impact: MED.

20. LOW - Hide the rail "open in tab" button unless the user opens a row menu.
    - What/where: `EmailRailRow`, hover icon at `src/features/email/EmailWorkspace.tsx:167`.
    - Why it costs more than it gives: row click already reads the email in the pane. The external-link icon is a secondary path and can be mistaken for the main action.
    - Concrete simplification: put `Open in tab` inside the row or reader `...` menu. Keep the keyboard-accessible action through the menu.
    - Exact copy: `Open email in tab` -> `Open in tab`.
    - Impact: LOW.

21. LOW - Reduce row snippets from two lines to one in the rail.
    - What/where: `EmailRailRow`, snippet at `src/features/email/EmailWorkspace.tsx:180`.
    - Why it costs more than it gives: a two-line snippet makes each rail row tall, so fewer messages fit. The right pane already shows the full message.
    - Concrete simplification: show one line by default; expand to two only on hover or when the row is active.
    - Exact copy: no copy change.
    - Impact: LOW.

22. LOW - Clean up demo preview copy.
    - What/where: `EmailFixturePreview`, demo preview at `src/features/email/EmailWorkspace.tsx:207`; strings at `src/locales/en.json:1594`.
    - Why it costs more than it gives: `Demo preview`, `Snippet`, and a full bordered note stack extra labels on a mode that is already limited.
    - Concrete simplification: show the subject, sender/date, snippet, and one quiet note under it.
    - Exact copy: `Demo preview` -> `Preview`; `Snippet` -> remove; `The browser demo shows the email summary. Open the desktop app to read the full message body.` -> `Open the desktop app to read the full message.`
    - Impact: LOW.

23. LOW - Normalize loading and error language.
    - What/where: `EmailWorkspace` loading/error at `src/features/email/EmailWorkspace.tsx:766`; `EmailViewer` loading/error at `src/features/email/EmailViewer.tsx:579`.
    - Why it costs more than it gives: `Loading email...`, `Opening email...`, and `Could not load email` describe similar states in slightly different ways.
    - Concrete simplification: use one short verb per state across rail and reader.
    - Exact copy: `Loading email...` -> `Loading`; `Opening email...` -> `Opening`; `Could not load email` -> `Could not open email`; `Fix the loading problem, then choose an email.` -> `Fix the problem, then choose an email.`
    - Impact: LOW.

24. LOW - Make provider names user-friendly in the filter.
    - What/where: `EmailWorkspace`, provider filter options at `src/features/email/EmailWorkspace.tsx:811`.
    - Why it costs more than it gives: raw provider values can read like system labels.
    - Concrete simplification: display `Gmail` and `Outlook` labels while keeping the stored values unchanged.
    - Exact copy: `gmail` -> `Gmail`; `m365` or `outlook` -> `Outlook`.
    - Impact: LOW.

## Do not touch

1. Keep sensitivity visible. The shape can be smaller, but sensitive/client-confidential status must stay visible wherever email content can be read or selected.
2. Keep client scoping strict. The embedded client Email tab must stay client-scoped, and the all-email path must not appear there.
3. Keep visible send/reconnect warnings. Anything that blocks or warns about sending email must remain clear at the moment the user is about to send.
4. Keep local privacy copy in the no-account state. It can be shorter, but the promise "not our servers" is load-bearing trust.
5. Keep filing. Filing email to a client is core value; the recommendation is to fold the controls, not remove the capability.
6. Keep attachments downloadable. The section can become quieter, but attachment access is part of email value.
7. Keep the left rail pattern, plus button, and `...` menu pattern. The app has standardized on those, and Email should stay aligned.
8. Keep the light theme.
9. Keep the client wording facade. Do not expose internal matter language in user-facing copy.
