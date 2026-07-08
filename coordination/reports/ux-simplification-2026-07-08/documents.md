# Documents Screen UX Simplification Audit

## 1. Five-line screen summary

1. The screen is really three screens stacked together: the Documents page header, a left file/tab rail, and a file browser/editor area.
2. The current Files view has two kinds of navigation at once: a left "Files" tab and a horizontal "Files / Trash" switch.
3. The main file actions are split across places: the + menu lives in the rail, while view controls and search live in the content toolbar.
4. The grid is clean in structure, but the boxed cards, count label, and duplicate mode controls make it feel busier than it needs to.
5. Trash and document editing are strong functionally, but they show too much helper text and too many default controls before the user asks for them.

## 2. Recommendations

1. **Move Trash into the left rail and remove the horizontal Files/Trash switch.**
   - **What/where:** `DocumentsHome` renders the Files/Trash segmented control at lines 628-678, while the rail already has a pinned Files tab at lines 741-774.
   - **Why it costs more than it gives:** The user sees "Files" twice: once as the left rail item and once inside the content toolbar. That makes the screen feel like it has two nav systems.
   - **Concrete simplification:** Add a second pinned rail item for Trash below Files, with the existing count badge. Remove the horizontal Files/Trash segmented control. Keep the same `TrashPanel`; just switch it from the rail instead of the toolbar.
   - **Impact:** HIGH

2. **Move the + menu out of the rail and into the file toolbar.**
   - **What/where:** The create/add menu is built at `DocumentsHome` lines 588-626, then attached to the rail's Files tab at line 759.
   - **Why it costs more than it gives:** The rail should choose places. It should not also hold the main create action. Right now the most important action is visually tucked into navigation.
   - **Concrete simplification:** Keep the same menu items, but place the + button in the content toolbar next to search. Rail becomes navigation only. Tooltip copy: `Create or add files` -> `New or add`.
   - **Impact:** HIGH

3. **Make Tree/Grid an icon-only view toggle or fold it into a View menu.**
   - **What/where:** `DocumentsHome` lines 682-709 show a full text segmented toggle: icon + `Tree`, icon + `Grid`.
   - **Why it costs more than it gives:** Tree and grid are display modes, not primary tasks. The labels make the toolbar feel heavier than the decision deserves.
   - **Concrete simplification:** Preferred: keep the two icons, remove visible `Tree` and `Grid`, and use tooltips/aria labels. If the team wants maximum calm, use one icon button with a small menu: `View` -> `Grid`, `Tree`.
   - **Copy rewrite:** `View` aria label stays. Visible `Tree` / `Grid` -> hidden tooltip labels.
   - **Impact:** HIGH

4. **Unbox the file grid cards.**
   - **What/where:** `DocumentGridView` `FileCard` uses `className="kp-card kp-card--interactive"` at lines 351-355, then each item gets a bordered card shape.
   - **Why it costs more than it gives:** A folder grid is already organized by spacing. Putting every file inside a card creates lots of little boxes, which fights the owner's minimalism brief.
   - **Concrete simplification:** Use plain icon + filename tiles on whitespace. Show only a light hover background. Keep a visible active state for the open file, but avoid borders on every normal item.
   - **Impact:** HIGH

5. **Remove the root-level count label unless the user is searching.**
   - **What/where:** `DocumentGridView` lines 869-881 shows `No documents yet`, `N items`, or `N results` above the grid.
   - **Why it costs more than it gives:** In normal browsing, the grid itself already communicates that files exist. The count is another line to read before the files.
   - **Concrete simplification:** Show the label only during search: `1 result` / `N results`. Do not show `N items`, `N folders`, or `No documents yet` above a normal grid.
   - **Impact:** HIGH

6. **Simplify the empty Files state to one primary action.**
   - **What/where:** `DocumentGridView` `WorkspaceEmptyState` lines 411-429 shows title, long body, `New Word document`, and `New folder`.
   - **Why it costs more than it gives:** The empty state is trying to teach too much. It also gives two equal choices before the user has any files.
   - **Concrete simplification:** Keep one primary button: `New document`. Put `New folder` and `Add files` in the + menu above.
   - **Copy rewrites:** `Your workspace is ready` -> `No files yet`; `Real Word documents, with tracked changes and AI redlining, stored as files on your computer.` -> `Create or add a file to start.`; `New Word document` -> `New document`.
   - **Impact:** HIGH

7. **Remove the extra card wrapper around Trash.**
   - **What/where:** `DocumentGridView` wraps `TrashPanel` in another bordered white container at lines 927-946. `TrashPanel` then draws its own header, borders, rows, and dialogs.
   - **Why it costs more than it gives:** This is a box inside a box. It makes Trash feel like a panel inside a panel instead of a first-class view.
   - **Concrete simplification:** Let `TrashPanel` fill the content area directly, with the same page padding as Files. Keep row dividers inside Trash; remove the outer rounded bordered wrapper.
   - **Impact:** HIGH

8. **Fold Trash settings and Empty Trash into one overflow menu.**
   - **What/where:** `TrashPanel` lines 123-155 shows a header, a settings gear, and a visible `Empty Trash` destructive text button.
   - **Why it costs more than it gives:** Emptying trash is rare and destructive. Giving it constant text-button weight makes the header feel louder than the file list.
   - **Concrete simplification:** Use one `...` menu in the Trash header: `Settings`, `Empty Trash`. Keep the destructive confirmation dialog.
   - **Copy rewrite:** Visible `Empty Trash` button -> menu item `Empty trash`.
   - **Impact:** HIGH

9. **Remove the Trash stats bar from the default view.**
   - **What/where:** `TrashPanel` lines 157-170 shows total size and `Oldest: Today/Yesterday/...` in a separate shaded bar.
   - **Why it costs more than it gives:** Size and oldest deleted item are secondary facts. They are not needed every time someone opens Trash.
   - **Concrete simplification:** Fold these into the Trash header tooltip, the overflow menu, or a compact line inside Trash settings. Keep item count in the rail badge/header.
   - **Copy rewrite:** `Oldest: {{date}}` -> `Oldest {{date}}` if it remains anywhere.
   - **Impact:** HIGH

10. **Move file rename into the document actions menu.**
    - **What/where:** `DocxEditor` shows a separate pencil button at lines 2068-2081 and a nearby `...` document actions menu at lines 2083-2237.
    - **Why it costs more than it gives:** Two tiny action buttons sit beside the file name. The app has standardized on `...` menus for secondary file actions.
    - **Concrete simplification:** Remove the visible pencil button. Add `Rename` as the first item in the `...` menu with the same pencil icon and same rename behavior.
    - **Copy rewrite:** `Rename file` -> `Rename`.
    - **Impact:** HIGH

11. **Make the saved state quieter when everything is fine.**
    - **What/where:** `AutoSaveIndicator` lines 116-122 shows `Saved`, `Saved · Ns ago`, `Unsaved changes`, `Saving...`, or `Save failed`.
    - **Why it costs more than it gives:** `Saved · 3s ago` constantly changes and attracts the eye, even though the good state is not a task.
    - **Concrete simplification:** In the normal saved state, show only the save icon or `Saved`. Keep full text for `Unsaved changes`, `Saving...`, and `Save failed`.
    - **Copy rewrite:** `Saved · {{time}}` -> `Saved` visible, with tooltip `Last saved {{time}}`.
    - **Impact:** HIGH

12. **Keep the trust banner, but make its copy even tighter.**
    - **What/where:** `DocumentsHome` `TrustBanner` lines 210-228 shows `Indexed on your machine. Nothing was uploaded.`
    - **Why it costs more than it gives:** The trust message is important, but the phrase can be shorter without losing meaning.
    - **Concrete simplification:** Keep the banner visible after Add files. Shorten the sentence.
    - **Copy rewrite:** `Indexed on your machine. Nothing was uploaded.` -> `Indexed locally. Nothing uploaded.`
    - **Impact:** MED

13. **Shorten the search placeholder.**
    - **What/where:** `DocumentsHome` lines 711-719 uses `SearchField`; the string is `workspace.documents.search-placeholder` at `en.json` line 387: `Search files...`.
    - **Why it costs more than it gives:** The magnifying glass and the current screen already say this is file search.
    - **Concrete simplification:** Use the same search field, but shorten the placeholder.
    - **Copy rewrite:** `Search files...` -> `Search`
    - **Impact:** MED

14. **Tighten the Documents page header or remove it in the rail layout.**
    - **What/where:** `DocumentsHome` lines 796-803 renders a top `SurfaceHeader` with only icon + `Documents`.
    - **Why it costs more than it gives:** Once the left rail says Files and open document names, the header spends a full row mostly repeating where the user is.
    - **Concrete simplification:** Either use a compact 44px header for Documents, or fold `Documents` into the left rail's top area and remove this row only for the Documents surface.
    - **Impact:** MED

15. **Collapse the Tab Group Manager into the rail overflow.**
    - **What/where:** `TabBar` lines 1588-1606 shows a full-width `Manage Tab Groups` button at the bottom of the vertical document rail.
    - **Why it costs more than it gives:** Tab groups are useful, but they are not a top-level action for most people working with documents.
    - **Concrete simplification:** Move `Manage Tab Groups` into the rail `...` menu or the all-tabs menu. If kept visible, use icon-only with tooltip.
    - **Copy rewrite:** `Manage Tab Groups` -> `Tab groups`.
    - **Impact:** MED

16. **Narrow the left rail after removing create actions.**
    - **What/where:** `TabBar` vertical mode fixes the rail width at 252px at lines 1470-1482.
    - **Why it costs more than it gives:** A 252px rail is wide when it holds navigation and open file names only. It steals space from the work area.
    - **Concrete simplification:** After moving + and Trash, reduce the default rail width to about 208-224px, with truncation and tooltips for long file names.
    - **Impact:** MED

17. **Simplify the Tree empty state and remove shortcut teaching text.**
    - **What/where:** `FileTree` lines 550-560 shows `No files yet`, a long description, `Ctrl+N / Ctrl+P`, and an optional CTA.
    - **Why it costs more than it gives:** The copy explains the UI instead of helping the user decide. Keyboard shortcuts should not be visible teaching text in this app surface.
    - **Concrete simplification:** Keep the title and one CTA. Remove the shortcut line.
    - **Copy rewrite:** `Create a document from the toolbar above, drop files in from your desktop, or start a new note to get going. Press Ctrl+P to quickly open any file by name.` -> `Create or add a file to start.`
    - **Impact:** MED

18. **Move `Open on Desktop` into a menu.**
    - **What/where:** `FileTree` lines 608-621 shows a bottom footer button: `Open on Desktop`.
    - **Why it costs more than it gives:** Opening the folder in the operating system is useful, but not common enough to deserve a permanent footer.
    - **Concrete simplification:** Put `Open on Desktop` in the same `...` menu as view/settings actions for Files. Keep the command available.
    - **Copy rewrite:** `Open on Desktop` -> `Show in Finder/Explorer` if platform-aware; otherwise `Show on computer`.
    - **Impact:** MED

19. **Make the Tree multi-select bar more compact.**
    - **What/where:** `FileTree` lines 501-546 shows a full blue-tinted bar with count, `Clear`, `Download`, and `Delete`.
    - **Why it costs more than it gives:** The state is useful, but the bar is visually loud for a temporary selection state.
    - **Concrete simplification:** Keep the count. Make `Clear` an X icon-only button with tooltip. Make `Download` and `Delete` icon buttons with labels only in tooltips, or put them in a compact `...` menu if more actions arrive.
    - **Copy rewrite:** `{{count}} items selected` -> `{{count}} selected`; `Clear` -> tooltip only.
    - **Impact:** MED

20. **Use one action pattern for file rows and tree rows: `...` menus.**
    - **What/where:** `DocumentBrowserRow` lines 231-333 uses separate hover-only Rename, Download, Delete buttons. `FileTreeItem` lines 962-1031 already uses a `...` menu.
    - **Why it costs more than it gives:** Even if `DocumentBrowser` is older, it preserves a second pattern. If it resurfaces, users see one screen with icon buttons and another with `...` menus.
    - **Concrete simplification:** Standardize on the `...` menu for per-file secondary actions. Keep direct row click as open/drill-in.
    - **Copy rewrite:** `Delete` -> `Move to Trash` wherever the action is recoverable.
    - **Impact:** MED

21. **Shorten Trash empty-state copy.**
    - **What/where:** `TrashPanel` lines 175-187 builds a dynamic empty-state description based on retention.
    - **Why it costs more than it gives:** Empty Trash does not need to explain restore behavior before there is anything to restore.
    - **Concrete simplification:** Keep the title. Use one short line.
    - **Copy rewrites:** `Deleted files live here until you empty the trash. Restore any file from here back to its original folder.` -> `Deleted files appear here.`; `Deleted files live here for {{days}} days before being removed permanently. Restore any file from here back to its original folder.` -> `Deleted files stay here for {{days}} days.`
    - **Impact:** MED

22. **Shorten Trash settings copy.**
    - **What/where:** `TrashPanel` lines 247-302 uses `en.json` lines 58-62: `Trash Retention Settings`, `Configure how long items stay in trash before automatic deletion`, `Auto-delete after:`, `Never (keep forever)`, and a long help sentence.
    - **Why it costs more than it gives:** This dialog uses admin-style wording for a simple setting.
    - **Concrete simplification:** Keep the same controls, with shorter labels.
    - **Copy rewrites:** `Trash Retention Settings` -> `Trash settings`; `Configure how long items stay in trash before automatic deletion` -> `Choose when deleted files are removed.`; `Auto-delete after:` -> `Remove after`; `Never (keep forever)` -> `Never`; `Items older than this period will be automatically deleted from trash. Set to "Never" to keep items indefinitely.` -> `Older items are removed automatically. Choose Never to keep them.`
    - **Impact:** MED

23. **Shorten the Word review toggle.**
    - **What/where:** `ReviewingToggle` in `DocxRedlineControls` lines 21-51 shows visible label `Reviewing` and tooltip copy from `en.json` line 801.
    - **Why it costs more than it gives:** `Reviewing` is a mode name, but it reads like a status. The document header already has many small controls.
    - **Concrete simplification:** Label it `Review`. Keep the switch visible because tracked changes are load-bearing for Word work.
    - **Copy rewrites:** `Reviewing` -> `Review`; `Show tracked changes (insertions, deletions). Turn off for a clean final view.` -> `Show changes. Turn off for final view.`
    - **Impact:** MED

24. **Clean up the Word actions menu labels.**
    - **What/where:** `DocxEditor` lines 2098-2237 renders the document actions menu. Strings live in `en.json` lines 820-858.
    - **Why it costs more than it gives:** The menu has the right idea, but several labels are longer than needed.
    - **Concrete simplification:** Keep all actions, grouped the same way, with shorter labels.
    - **Copy rewrites:** `Split horizontally` -> `Split right`; `Split vertically` -> `Split down`; `Toggle outline` -> `Outline`; `Export as` -> `Export`; `Privilege-safe` -> `Clean copies`; `Clean copy (remove hidden data)` -> `Clean copy`; `Strips author, company, and edit history. Keeps tracked changes and comments.` -> `Removes hidden data.`; `Clean copy, accept all changes` -> `Final clean copy`; `Also accepts every tracked change and removes comments. Sends a flat final document.` -> `Accepts changes and removes comments.`
    - **Impact:** MED

25. **Make the AI redline composer smaller by default.**
    - **What/where:** `RedlineComposer` lines 86-160 shows a title row, large textarea, egress note, errors/hints, and submit button. Strings are at `en.json` lines 834-842.
    - **Why it costs more than it gives:** This is an on-demand panel, but when open it pushes the document down and uses a lot of text.
    - **Concrete simplification:** Start with a one-line input that expands after focus or typing. Keep the egress note visible, but shorter.
    - **Copy rewrites:** `Tell the AI how to revise this document. For example: "tighten the indemnity clause", "make this more formal", "shorten by 20%".` -> `What should change? Example: "shorten by 20%".`; `Suggest changes` -> `Suggest`; `Sends document text directly to your AI provider with your own key.` -> `Sends this document to your AI provider with your key.`
    - **Impact:** MED

26. **Hide disabled review bulk actions when there is nothing to review.**
    - **What/where:** `ReviewPane` lines 42-82 always shows the Review header plus disabled `Accept all` and `Reject all` buttons when `revisionCount === 0`; lines 98-104 then says `No tracked changes in this document.`
    - **Why it costs more than it gives:** Disabled buttons say "there is something to do here" even when there is not.
    - **Concrete simplification:** If `revisionCount === 0`, hide the bulk action row and show only the empty state. Keep comments visible if comments exist.
    - **Copy rewrite:** `No tracked changes in this document.` -> `No changes to review.`
    - **Impact:** MED

27. **Simplify the version-history side panel header.**
    - **What/where:** `VersionHistoryPanel` lines 114-130 and `BinaryVersionHistoryPanel` lines 191-204 show `Version History` plus the filename. Strings are at `en.json` lines 943-945.
    - **Why it costs more than it gives:** The active document name is already visible in the document header. Repeating it in a side panel header adds weight.
    - **Concrete simplification:** Header title becomes `History`; remove the filename subtitle unless the side panel can be detached from the document.
    - **Copy rewrites:** `Version History` -> `History`; `No version history yet` -> `No history yet`; `Versions are saved automatically when you edit and save the file` -> `Edits appear here after the first save.`
    - **Impact:** LOW

28. **Retire or route away from the older DocumentBrowser table if it is no longer used.**
    - **What/where:** `DocumentBrowser` lines 512-990 and `DocumentBrowserRow` lines 143-334 define an older table/card browser, but current `DocumentsHome` uses `DocumentGridView` at lines 844-892.
    - **Why it costs more than it gives:** Two file browsers create two design languages: the older table has a duplicated `Documents` eyebrow/title at lines 535-560, separate action bar at lines 821-918, and a bordered table card at lines 920-963.
    - **Concrete simplification:** If no live route uses it, remove it after test cleanup. If compact panels still need it, restyle it to use the same toolbar, `...` row menu, and empty-state copy as `DocumentGridView`.
    - **Impact:** LOW

## 3. Do not touch list

- **Do not remove privacy/trust messages.** The Add files trust banner, AI egress note, save-failure warning, outbound-blocked notes, and review-gated send states are load-bearing. Shorten them only if the meaning stays visible.
- **Do not remove the Trash badge/count.** It is the one quick signal that deleted items exist. Move it to the rail if Trash moves there.
- **Do not remove recoverability.** Delete-to-Trash, Restore, permanent delete confirmations, Empty Trash confirmation, and retention settings must remain.
- **Do not remove Tree view.** Some users need dense folder scanning. Hide it behind a quieter control, but keep it.
- **Do not remove Grid view.** It is the calmer default for file browsing and works well for a product-designer-friendly app.
- **Do not remove the review toggle or review pane.** Tracked changes are core Word functionality. Make the controls quieter, not absent.
- **Do not remove clean-copy export.** Hidden metadata removal is trust-critical for advisor/client work. Shorten the labels, but keep the feature easy to find.
- **Do not remove save-error escalation.** When saving is blocked, the app must stay loud and clear until the user's work is safe.
- **Do not change client/matter internals in UI copy.** Keep the facade: user-facing copy says client/household where relevant; internal `matter` naming is not a design surface.
