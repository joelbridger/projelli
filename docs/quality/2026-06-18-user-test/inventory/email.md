# Email domain inventory

Full-feature email surface: connect (M365/Gmail/IMAP OAuth), import/sync with per-provider progress, the Email tab message list, keyword and AI search, filters, per-row and bulk actions, the EmailViewer (decrypt/display), privilege tagging, matter filing, compose, reply (with AI draft), attachment download, export to workspace, and cross-window refresh after import.

---

## Account → Connections panel (connectors window)

| ID | Persona | Story | Steps | Surface | Precondition | Expected | Layer | Risk | Covered? |
|---|---|---|---|---|---|---|---|---|---|
| EMAIL-01 | any | As a user I want to connect my Microsoft 365 account so that my Outlook mail is available in Keepance. | Open Account → Connections; click "Connect Microsoft 365"; sign in to Microsoft in the browser window that opens. | `MailConnect.tsx`; no `data-testid` on the main button (uses role); `src-tauri/.../mail/oauth.rs`, `graph.rs` | Desktop app running; no M365 account connected | Panel shows "Connected." and sync begins | L3 | H | `MailConnect.test.tsx` (unit, mocked) |
| EMAIL-02 | any | As a user I want to see a "waiting" state during the OAuth sign-in flow so I know the app is waiting for me. | Click "Connect Microsoft 365"; observe button text changes to "Waiting for sign-in…". | `MailConnect.tsx` | M365 not connected | Button disabled, text shows "Waiting for sign-in in your browser…" | L2 | M | `MailConnect.test.tsx` |
| EMAIL-03 | any | As a user I want to see a plain-English error if my M365 connection fails so I know what went wrong. | Click "Connect Microsoft 365"; OAuth flow fails or is cancelled. | `MailConnect.tsx` | M365 not connected | Error message "Something went wrong: <detail>" shown below the button | L3 | H | `MailConnect.test.tsx` (Error + string variants) |
| EMAIL-04 | any | As a user I want to see a full-disk encryption nudge if my OS encryption is off so my data-at-rest risk is surfaced. | Mount the M365 panel on a machine where `mailFdeStatus()` returns `"off"`. | `MailConnect.tsx`; `mail_fde_status` Tauri command | Desktop app; FDE status detectable | Amber nudge banner visible above the Connect button | L2 | M | `MailConnect.test.tsx` ("shows FDE warning" test) |
| EMAIL-05 | any | As a user I want to stop an in-progress import so I can reclaim resources or abort a runaway sync. | Connect M365; while "Importing…" is shown, click the "Stop" button. | `MailConnect.tsx` Stop button; `mail_cancel_sync` | M365 connected; sync in progress | Status changes to "Import stopped." | L3 | M | `MailConnect.test.tsx` |
| EMAIL-06 | any | As a user I want to see a live message count during import so I can tell the sync is working. | Connect M365; watch the "Importing… N messages so far." counter update. | `MailConnect.tsx`; `mail-sync-progress` Tauri event | M365 connected | Count increments as messages are written | L3 | M | `mail-connector-isolation.test.tsx` (isolated per provider) |
| EMAIL-07 | any | As a user I want to see "All mail imported and searchable" when the sync finishes so I know import is complete. | Wait for sync to reach `status: "done"`. | `MailConnect.tsx` | M365 connected, sync running | "All mail imported and searchable." message shown | L3 | M | `MailConnect.test.tsx` |
| EMAIL-08 | any | As a user I want to see a sync error message if the import fails mid-run so I can retry. | Sync reaches `status: "error"`. | `MailConnect.tsx` | M365 connected | "Mail sync ran into a problem. Open this panel again to retry." | L3 | M | `MailConnect.test.tsx` (partial — unit mocked) |
| EMAIL-09 | any | As a user I want to connect my Gmail account via native OAuth so my Google mail is searchable in Keepance. | Open Account → Connections; click "Connect Gmail"; sign in to Google in the browser. | `MailGmailConnect.tsx`; `src-tauri/.../mail/gmail/oauth.rs` | Desktop app; Gmail not connected | Panel shows "Connected." and Gmail sync begins | L3 | H | `MailGmailConnect.test.tsx` (unit, mocked) |
| EMAIL-10 | any | As a user I want to disconnect my Gmail account so my Google credentials are removed from this machine. | In the Gmail panel (connected state), click "Disconnect". | `MailGmailConnect.tsx`; `gmail_disconnect` | Gmail connected | Panel returns to "Connect Gmail" button state | L2 | M | `MailGmailConnect.test.tsx` |
| EMAIL-11 | any | As a user I want to connect via IMAP so I can use any standard mail host (Fastmail, Gmail app-password, etc.). | Open Account → Connections; fill host/port/username/app-password; click Connect. | `MailImapConnect.tsx`; `mail_imap_connect` | Desktop app | Panel shows "Connected." | L3 | H | `MailImapConnect.test.tsx` |
| EMAIL-12 | any | As a user I want to disconnect my IMAP account so those credentials are removed. | In the IMAP connected state, click "Disconnect". | `MailImapConnect.tsx`; `mail_imap_disconnect` | IMAP connected | Panel returns to the connection form | L2 | M | `MailImapConnect.test.tsx` |

---

## Email tab — no-accounts state

| ID | Persona | Story | Steps | Surface | Precondition | Expected | Layer | Risk | Covered? |
|---|---|---|---|---|---|---|---|---|---|
| EMAIL-13 | any | As a user with no connected accounts I want to see a clear "connect your email" prompt so I know what to do. | Navigate to Email tab with no accounts connected. | `EmailWorkspace.tsx` → `NoAccountsState.tsx`; `data-testid="no-accounts-state"` | No mail accounts connected | EmptyState shows "No email connected" + "Connect your email" button; clicking it fires `onOpenSettings()` | L1 | L | `ReimaginedEmailWorkspace.test.tsx` test 9 |

---

## Email tab — message list and browse

| ID | Persona | Story | Steps | Surface | Precondition | Expected | Layer | Risk | Covered? |
|---|---|---|---|---|---|---|---|---|---|
| EMAIL-14 | any | As a user I want to see all my imported mail in a list so I can browse it. | Navigate to Email tab with account connected and mail imported. | `EmailWorkspace.tsx`; `data-testid="mail-row"` (MailRow) | At least one mail account connected; mail synced | List of mail rows rendered; each row shows subject, sender, date, snippet | L1 (`?mailFixture=1`) / L2 (real) | M | `ReimaginedEmailWorkspace.test.tsx` test 1 |
| EMAIL-15 | any | As a user I want to see a loading indicator while the list loads so I know the app is working. | Navigate to Email tab while list fetch is in flight. | `EmailWorkspace.tsx`; `data-testid="loading-state"` | Account connected | Spinner with "Loading email…" shown while `mailListMessages` is pending | L1 | L | `ReimaginedEmailWorkspace.test.tsx` test 7 |
| EMAIL-16 | any | As a user I want to see an error message with a retry button if the list fails to load so I can recover. | `mailListMessages` throws (network error, auth error, etc.). | `EmailWorkspace.tsx`; `data-testid="error-state"`, `"error-retry"` | Account connected | Friendly error message + "Try again" button; clicking retry re-fetches | L1 | M | `ReimaginedEmailWorkspace.test.tsx` tests 10, 22, 23 |
| EMAIL-17 | any | As a user I want to see a "No emails found" state when my search or filters return nothing so I know my query had no hits. | Type a keyword with no matches, or apply filters that exclude all mail. | `EmailWorkspace.tsx`; `data-testid="no-results-state"` | Account connected; mail synced | "No emails found" + contextual hint ("Try a different keyword…" or "No email has been synced yet.") | L1 | L | `ReimaginedEmailWorkspace.test.tsx` test 8 |
| EMAIL-18 | any | As a user I want to search my email by keyword so I can find messages about a specific topic. | Type in the search field; observe filtered results after 200ms debounce. | `EmailWorkspace.tsx`; `data-testid="email-search-input"` | Account + mail | Query passed as `keyword` to `mailListMessages`; list updates | L1 (fixture) / L2 (real SQLCipher FTS) | M | `ReimaginedEmailWorkspace.test.tsx` test 2 |
| EMAIL-19 | any | As a user I want to see a result count so I know how many emails matched and how many are loaded. | View result list header. | `EmailWorkspace.tsx`; `data-testid="result-count"` | Results returned | "Showing N of M" (partial) or "All email loaded" (full, no query) | L1 | L | `ReimaginedEmailWorkspace.test.tsx` tests 18–20 |
| EMAIL-20 | any | As a user I want to load more messages beyond the first 50 so I can browse my full history. | Click "Load more (N remaining)" at the bottom of the list. | `EmailWorkspace.tsx`; `data-testid="load-more"` | More than 50 results exist | Additional rows appended; offset incremented by 50 | L1 (fixture) / L2 (real) | L | NONE (unit not written for load-more click) |
| EMAIL-21 | any | As a user with multiple accounts I want to filter by provider so I see only one account's mail. | Expand filters; select a provider from the dropdown. | `EmailWorkspace.tsx`; `data-testid="provider-filter"` | 2+ accounts connected | `provider` param passed to `mailListMessages` | L1 | M | `ReimaginedEmailWorkspace.test.tsx` test 3 |
| EMAIL-22 | any | As a user I want to filter mail by a date range so I can find messages from a specific period. | Expand filters; set From date and/or To date. | `EmailWorkspace.tsx`; `data-testid="date-from"`, `"date-to"` | Account + mail | `dateFrom`/`dateTo` passed to list query; To date treated as end-of-day | L1 | M | `ReimaginedEmailWorkspace.test.tsx` test 3 (hasAttachments; date tested indirectly) |
| EMAIL-23 | any | As a user I want to filter to only messages with attachments so I can find contracts, exhibits, or transcripts. | Expand filters; check "Has attachment". | `EmailWorkspace.tsx`; `data-testid="attachment-filter"` | Account + mail | `hasAttachments: true` passed to list query | L1 | L | `ReimaginedEmailWorkspace.test.tsx` test 3 |
| EMAIL-24 | any | As a user I want to toggle the filter panel open/closed so the UI isn't cluttered when I don't need filters. | Click "Filters" button. | `EmailWorkspace.tsx`; `data-testid="filters-toggle"` | Account connected | Filter row expands/collapses; badge shows count of active filters | L1 | L | `ReimaginedEmailWorkspace.test.tsx` test 3 (opens filters) |
| EMAIL-25 | any | As a user I want to see an attachment icon on rows that have attachments so I can quickly identify them. | View list row for a message with `hasAttachments: true`. | `MailRow.tsx` | Mail with attachments synced | Paperclip icon visible on the row | L1 | L | NONE (no explicit test; covered by render test) |

---

## Email tab — row-level actions

| ID | Persona | Story | Steps | Surface | Precondition | Expected | Layer | Risk | Covered? |
|---|---|---|---|---|---|---|---|---|---|
| EMAIL-26 | any | As a user I want to click a mail row to open the message so I can read it. | Click a mail row (or the "Open" button on hover). | `MailRow.tsx`; `data-testid="mail-row"`, `"open-email-{id}"`; dispatches `keepance:open-email` | Account + mail list loaded | `keepance:open-email` custom event fired with `{ sourceId: "mail:<id>" }`; viewer tab opens | L1 | M | `ReimaginedEmailWorkspace.test.tsx` test 4 |
| EMAIL-27 | any | As a user I want to select individual mail rows via checkbox so I can take bulk actions. | Hover over a row to reveal its checkbox; click the checkbox. | `MailRow.tsx`; `role="checkbox"` | Mail list loaded | Row shows selected state (tinted background, CheckSquare icon) | L1 | L | NONE (no dedicated test) |
| EMAIL-28 | any | As a user I want to clear my bulk selection so I can start over. | In bulk action bar, click "Clear selection" (X). | `EmailWorkspace.tsx`; `data-testid="bulk-action-bar"` | 1+ rows selected | `selectedIds` cleared; bulk bar dismissed | L1 | L | NONE |
| EMAIL-29 | any | As a user I want to file a single email to a matter so it's scoped to the right case. | Hover a row; click "File"; pick a matter from the popover. | `MailRow.tsx` → `MatterPickerPopover.tsx`; `data-testid="file-to-matter-{id}"` | Matters exist; mail list loaded | `mailRetagMessageMatter(msgId, matterId)` called; popover closes | L1 (mock) / L2 (real SQLCipher retag) | H | `ReimaginedEmailWorkspace.test.tsx` test 6 |
| EMAIL-30 | any | As a user I want to search within the matter picker so I can find the right matter quickly. | Open matter picker; type in the search field. | `MatterPickerPopover.tsx`; `data-testid="matter-picker-search"` | Matters list has multiple entries | Picker filters to matching matters | L1 | L | `ReimaginedEmailWorkspace.test.tsx` test 21 |
| EMAIL-31 | any | As a user I want to file multiple selected emails to a matter at once so I don't have to do it one by one. | Select 2+ rows; click "File to matter" in the bulk bar; pick a matter. | `EmailWorkspace.tsx` → `BulkMatterPicker.tsx`; `data-testid="bulk-file-to-matter"`, `"bulk-matter-picker-search"` | 2+ rows selected; matters exist | `mailRetagMessageMatter` called for each selected id; selection cleared | L1 (mock) / L2 (real) | H | NONE (BulkMatterPicker has no dedicated unit test) |
| EMAIL-32 | any | As a user I want to tag a mail row's privilege status so I can mark attorney-client or work-product messages. | Hover a row; click "Privilege" dropdown; select a privilege level. | `MailRowPrivilege.tsx`; `data-testid="privilege-option-{status}"` | Mail list loaded | `setPrivilege("mail:<id>", status)` called; dropdown closes; button style reflects new privilege | L1 | M | `ReimaginedEmailWorkspace.test.tsx` test 5 |

---

## Email viewer

| ID | Persona | Story | Steps | Surface | Precondition | Expected | Layer | Risk | Covered? |
|---|---|---|---|---|---|---|---|---|---|
| EMAIL-33 | any | As a user I want to open a stored email and read it so I can reference its content. | Click a mail row (dispatches `keepance:open-email`); viewer tab opens and loads. | `EmailViewer.tsx`; `data-testid="email-viewer"`, `"email-viewer-loading"` | Message exists in encrypted store (Tauri) | Viewer shows subject, from, to, cc, date, plain-text body; decrypted by backend, never innerHTML | L2 | H | `EmailViewer.test.tsx` (unit, mocked `mailGetMessage`) |
| EMAIL-34 | any | As a user I want to see a friendly error if an email can't be opened so I'm not shown a crash. | `mailGetMessage` rejects (message not synced, store corrupt, etc.). | `EmailViewer.tsx`; `data-testid="email-viewer-error"` | Message id invalid or not yet synced | Error panel: "This email could not be opened" + error detail; raw id NOT shown | L2 | M | `EmailViewer.test.tsx` |
| EMAIL-35 | any | As a user I want the email body rendered as plain text with no HTML execution so my data is safe from injected markup. | Open a message whose stored body contains residual HTML tags. | `EmailViewer.tsx`; `data-testid="email-viewer-body"`; `stripResidualTags()` | Message synced | Body rendered as `<pre>` text; `<img>`, `<script>`, attributes stripped; `onerror` never fires | L2 | H | `EmailViewer.test.tsx` (stripResidualTags unit test + render test) |
| EMAIL-36 | any | As a user I want to see an attachments list so I know what files came with the message. | Open a message that has attachments. | `EmailViewer.tsx`; `data-testid="email-viewer-attachments"` | Message has `hasAttachments: true` | Attachment list row visible with each attachment name as a clickable button | L2 | M | `EmailViewer.test.tsx` |
| EMAIL-37 | any | As a user I want to download an attachment so I can work with the file. | Click an attachment button in the viewer. | `EmailViewer.tsx`; `data-testid="attachment-download-{att.id}"`; `mailGetAttachment` → blob URL | Tauri desktop; message open | File downloads to browser Downloads via blob URL; no disk persistence on Keepance's side | L2 | H | `EmailViewer.test.tsx` (button presence only; no blob decode test) |
| EMAIL-38 | any | As a user I want to set the privilege status from the viewer so I can mark a message without going back to the list. | In the viewer privilege control, click a radio option. | `EmailViewer.tsx`; `data-testid="email-privilege-control"`, `"email-privilege-option-{status}"` | Message open | `setPrivilege(mailSourceId, status)` called; selected option highlighted | L1 | M | `email-privilege-control.test.tsx` |
| EMAIL-39 | any | As a user I want to file an open email to a matter from the viewer so I can tag it without returning to the list. | In the viewer, click a matter button in the "File to matter" section. | `EmailViewer.tsx`; `data-testid="email-file-to-matter"`, `"file-to-matter-btn-{matterId}"` | Message open; matters exist | `mailRetagMessageMatter(id, matterId)` called; "Filed successfully." confirmation | L1 (mock) / L2 (real) | H | `EmailViewer.test.tsx` (section presence + button; success path NONE) |
| EMAIL-40 | any | As a user I want to see a privilege note when I mark a message privileged so I understand what it means. | Mark a message as Attorney-Client or Work Product in the viewer. | `EmailViewer.tsx`; `data-testid="email-privilege-note"` | Message open | Amber note appears below the privilege control | L1 | L | `email-privilege-control.test.tsx` |

---

## Compose (new email)

| ID | Persona | Story | Steps | Surface | Precondition | Expected | Layer | Risk | Covered? |
|---|---|---|---|---|---|---|---|---|---|
| EMAIL-41 | any | As a user I want to compose a new email from the Email tab so I can send from Keepance without switching apps. | Click "New email" button. | `EmailWorkspace.tsx`; `data-testid="compose-btn"`, `"compose-close"` | Account connected | Compose modal opens with From, To, Subject, Body, Attach, Send | L1 | L | `ReimaginedEmailWorkspace.test.tsx` test 11 |
| EMAIL-42 | any | As a user I want to close the compose modal with the X button so I can dismiss it without sending. | Click the X icon in the modal header. | `EmailWorkspace.tsx`; `data-testid="compose-close"` | Compose modal open | Modal closes | L1 | L | `ReimaginedEmailWorkspace.test.tsx` test 11 (close btn present) |
| EMAIL-43 | any | As a user I want to close the compose modal by pressing Escape so I can dismiss it quickly from the keyboard. | Press Escape while compose is open. | `EmailWorkspace.tsx`; global `keydown` listener; `data-testid="compose-close"` | Compose modal open | Modal closes | L1 | M | `ComposeEscapeClose.test.tsx` |
| EMAIL-44 | any | As a user I want to close the compose modal by clicking outside it so I can dismiss it naturally. | Click the backdrop overlay (not the modal card). | `EmailWorkspace.tsx`; backdrop `onClick` | Compose modal open | Modal closes when clicking outside the modal card | L1 | L | NONE |
| EMAIL-45 | any | As a user I want the "From" account to be auto-selected when compose opens so I don't have to pick it every time. | Open compose; observe the From dropdown. | `EmailWorkspace.tsx`; From `<select>` | 1+ accounts connected | First connected account is pre-selected in From; other accounts listed | L1 | L | NONE |
| EMAIL-46 | any | As a user I want to fill in To, Subject, and Body in the compose form so I can write my message. | Fill the compose fields. | `EmailWorkspace.tsx`; `data-testid="compose-to"`, `"compose-subject"`, `"compose-body"` | Compose modal open | Fields accept input; `parseRecipients` splits comma/semicolon on send | L1 | M | `ReimaginedEmailWorkspace.test.tsx` tests 12, 16 |
| EMAIL-47 | any | As a user I want to expand Cc/Bcc fields so I can add additional recipients. | Click "Cc / Bcc" toggle; fill the Cc and Bcc fields. | `EmailWorkspace.tsx`; `data-testid="compose-cc-bcc-toggle"`, `"compose-cc"`, `"compose-bcc"` | Compose modal open | Cc and Bcc fields appear; values sent as arrays to `mailSend` | L1 | M | NONE (toggle click not directly tested) |
| EMAIL-48 | any | As a user I want to attach files to a composed email so I can send documents with the message. | Click "Attach"; pick a file. | `EmailWorkspace.tsx`; `data-testid="compose-attach"`, `"compose-attach-input"` | Compose modal open | File read as base64; attachment chip appears with filename | L1 | M | `ReimaginedEmailWorkspace.test.tsx` test 17 |
| EMAIL-49 | any | As a user I want to remove an attachment chip before sending so I can correct my selection. | Click the X on an attachment chip. | `EmailWorkspace.tsx`; `data-testid="compose-remove-attachment-{idx}"` | Compose modal open with attachment chip | Chip removed from list | L1 | L | `ReimaginedEmailWorkspace.test.tsx` test 17 |
| EMAIL-50 | any | As a user I want to send the composed email and have the modal auto-close so I know it was delivered. | Click "Send" in compose modal. | `EmailWorkspace.tsx`; `data-testid="compose-send"`, `"compose-success"` | Account connected; To field non-empty | `mailSend` called with right args; "Email sent" confirmation shown; modal closes after 1.5 s | L3 | H | `ReimaginedEmailWorkspace.test.tsx` test 12 (mocked) |
| EMAIL-51 | any | As a user I want to see a send error in the compose modal so I know my email failed to send. | `mailSend` rejects with a non-scope error. | `EmailWorkspace.tsx`; `data-testid="compose-error"` | Compose modal open | Error message shown inside the modal; modal stays open | L3 | H | NONE (error-mapping covered; compose-error data-testid not directly tested) |
| EMAIL-52 | any | As a user I want to see a reconnect prompt if my token lacks send permission so I know how to fix it. | `mailSend` rejects with "scope_upgrade_required". | `EmailWorkspace.tsx`; `data-testid="compose-scope-upgrade"` | Compose modal open | "Sending needs a one-time reconnect…" + "Go to Settings" button | L3 | H | `ReimaginedEmailWorkspace.test.tsx` test 13 |

---

## Reply (from EmailViewer)

| ID | Persona | Story | Steps | Surface | Precondition | Expected | Layer | Risk | Covered? |
|---|---|---|---|---|---|---|---|---|---|
| EMAIL-53 | any | As a user I want to draft a reply with AI so I can start from a professional draft instead of a blank screen. | In the viewer reply area, click "Draft with AI". | `EmailViewer.tsx`; `data-testid="reply-draft-ai-btn"`, `"reply-draft-textarea"` | Message open; AI key set | Spinner shown; AI generates a reply draft filled into the textarea | L1 | M | `EmailViewer.test.tsx` (reply area presence; full AI generation path: NONE with real key) |
| EMAIL-54 | any | As a user I want to edit the AI-generated draft before sending so I can personalise it. | After Draft with AI fills the textarea, edit the content. | `EmailViewer.tsx`; `data-testid="reply-draft-textarea"` | AI draft generated | Textarea is editable; edited content sent on Send | L1 | L | NONE (implicit in viewer render; no edit-flow test) |
| EMAIL-55 | any | As a user I want to send a reply with the correct threading so the recipient's mail client shows it as a thread. | Fill reply fields; click "Send" in the reply area. | `EmailViewer.tsx`; `data-testid="reply-send-btn"`, `"reply-send-success"`; `mailSend` with `inReplyToId` | Message open; account connected | `mailSend` called with correct To/Cc/Bcc/Subject/body/inReplyToId; "Reply sent" shown | L3 | H | `EmailViewer.test.tsx` (unit, mocked mailSend) |
| EMAIL-56 | any | As a user I want a "Reply in your mail app" link so I can fall back to my normal client. | Click the mailto: link in the reply area. | `EmailViewer.tsx`; `data-testid="reply-mailto-link"` | Message open | `mailto:` link opens OS mail client with pre-filled To and Re: Subject | L2 | L | `EmailViewer.test.tsx` |
| EMAIL-57 | any | As a user I want to copy the AI-generated draft to the clipboard so I can paste it elsewhere. | After Draft with AI generates content, click "Copy". | `EmailViewer.tsx`; `data-testid="reply-copy-btn"` | AI draft generated | Draft text in clipboard; button shows "Copied!" for 2 s | L1 | L | NONE |
| EMAIL-58 | any | As a user I want to save the AI-generated draft as a document so it appears in my workspace. | After Draft with AI, click "Save as document". | `EmailViewer.tsx`; `data-testid="reply-save-doc-btn"` | AI draft generated | File downloaded as markdown via blob URL; filename derived from draft | L1 | L | NONE |
| EMAIL-59 | any | As a user I want to add Cc/Bcc recipients to a reply so I can include others in the thread. | Click "Cc / Bcc" toggle in the reply area; fill the fields. | `EmailViewer.tsx`; `data-testid="reply-cc-bcc-toggle"`, `"reply-cc-input"`, `"reply-bcc-input"` | Reply area visible | Cc/Bcc fields appear; values included in `mailSend` call | L1 | M | NONE |
| EMAIL-60 | any | As a user I want to see a scope_upgrade prompt when my reply send fails on a stale token so I know to reconnect. | `mailSend` rejects with "scope_upgrade_required" from the reply send button. | `EmailViewer.tsx`; `data-testid="reply-scope-upgrade"` | Message open | Scope-upgrade notice + "Go to Settings" button | L3 | H | `EmailViewer.test.tsx` |
| EMAIL-61 | any | As a user I want to see "Reply sent" confirmation after my reply is delivered so I know it worked. | Click Send in reply area with valid recipient and body. | `EmailViewer.tsx`; `data-testid="reply-send-success"` | Message open; account connected | "Reply sent" shown below the send button | L3 | H | `EmailViewer.test.tsx` (mocked) |

---

## AI search (Ask AI mode)

| ID | Persona | Story | Steps | Surface | Precondition | Expected | Layer | Risk | Covered? |
|---|---|---|---|---|---|---|---|---|---|
| EMAIL-62 | any | As a user I want to switch to AI search mode so I can ask natural-language questions about my email. | Click "AI search" in the mode toggle. | `EmailWorkspace.tsx`; `data-testid="mode-ask"` | Account connected | Mode switches; keyword search hidden; ask empty state shown | L1 | L | `ReimaginedEmailWorkspace.test.tsx` test 14 |
| EMAIL-63 | any | As a user I want to see example search chips when I haven't typed anything so I know what AI search can do. | Switch to AI search with no query. | `EmailWorkspace.tsx`; `data-testid="ask-empty-state"`, `"ask-chip"` | Mode = ask | Empty state headline + 3 example chips shown | L1 | L | `ReimaginedEmailWorkspace.test.tsx` test 14 |
| EMAIL-64 | any | As a user I want to click an example chip to use it as my search query so I can try AI search quickly. | Click one of the example chips. | `EmailWorkspace.tsx`; `data-testid="ask-chip"` | Ask mode; no query | Chip text fills the search input; ask search fires | L1 | L | `ReimaginedEmailWorkspace.test.tsx` test 15 |
| EMAIL-65 | any | As a user I want to run a natural-language query and see semantically relevant emails ranked by similarity so I can find things keyword search misses. | Type a query in Ask AI mode; wait for results. | `EmailWorkspace.tsx`; `MemoryService.retrieve()`; `data-testid="ask-hit-card"` | LanceDB RAG enabled; mail indexed | Ranked hit cards shown (subject, chunk excerpt, score, source id) | L2 | H | NONE (MemoryService always mocked; no RAG integration test) |
| EMAIL-66 | any | As a user I want to see a loading spinner during AI search so I know it's working. | Type a query in Ask AI mode; observe loading state. | `EmailWorkspace.tsx`; `data-testid="ask-loading"` | Ask mode; query typed | Spinner with "Searching email…" while `MemoryService.retrieve` is pending | L1 | L | NONE (loading state not directly tested) |
| EMAIL-67 | any | As a user I want to see a "enable memory" prompt if RAG is off when I try AI search so I know why results are empty. | Type a query in Ask AI mode when `isMemoryEnabled()` returns false. | `EmailWorkspace.tsx`; `data-testid="ask-no-results"` | Memory disabled | "AI search needs memory enabled. Enable it in Settings" link shown | L1 | M | NONE |
| EMAIL-68 | any | As a user I want to see a "no email filed to this matter" message when scope is "This matter" but nothing is tagged so I can understand and fix it. | Ask AI mode; active matter; no mail tagged to it. | `EmailWorkspace.tsx`; `data-testid="ask-no-results"`, `"ask-no-results-switch-scope"` | Active matter; no mail tagged to it; memory enabled | "No email is filed to this matter yet." + "Switch to All email" link | L1 | M | NONE |
| EMAIL-69 | any | As a user I want to click a hit card to open the email in the viewer so I can read the full message. | Click an ask-hit-card. | `AskHitCard.tsx`; `data-testid="ask-hit-card"`; dispatches `keepance:open-email` | AI search results shown | `keepance:open-email` fired with `sourceId`; viewer tab opens | L1 | M | NONE |
| EMAIL-70 | any | As a user I want to toggle between "This matter" and "All email" scope in AI search so I can narrow or broaden my query. | In Ask AI mode with an active matter, click the scope toggle. | `EmailWorkspace.tsx`; `SegmentedToggle` with aria-label "Email scope"; `data-testid="mode-ask"` | Active matter; Ask AI mode | Scope toggles between matter-scoped and all-email retrieval; query re-runs | L1 | M | NONE |

---

## First-connect TTV callout

| ID | Persona | Story | Steps | Surface | Precondition | Expected | Layer | Risk | Covered? |
|---|---|---|---|---|---|---|---|---|---|
| EMAIL-71 | any | As a user I want to see a "Your email is connected" callout after my first account connects so I know to try searching. | Connect first account; navigate to Email tab. | `EmailWorkspace.tsx`; `data-testid="first-connect-callout"` | First account just connected; `keepance:email:firstConnectCalloutSeen` not set | Info callout visible with "Your email is connected." headline | L1 | L | `first-connect-callout.test.tsx` |
| EMAIL-72 | any | As a user I want to dismiss the callout so it doesn't show again. | Click the dismiss (X) on the callout. | `EmailWorkspace.tsx`; `Callout` onDismiss; `mailStore.dismissFirstConnectCallout()` | Callout visible | Callout hidden; `localStorage` key set; callout never shown again | L1 | L | `first-connect-callout.test.tsx` |
| EMAIL-73 | any | As a user I want to click the callout CTA to focus the search field so I can immediately try a search. | Click "Search by name, topic, or deadline" in the callout. | `EmailWorkspace.tsx`; `data-testid="first-connect-callout-cta"` | Callout visible | Search input focused; callout dismissed | L1 | L | `first-connect-callout.test.tsx` |

---

## Cross-window refresh

| ID | Persona | Story | Steps | Surface | Precondition | Expected | Layer | Risk | Covered? |
|---|---|---|---|---|---|---|---|---|---|
| EMAIL-74 | any | As a user I want the email list to auto-refresh after an import completes so newly imported mail appears without a manual filter change. | Import runs in the connectors window; `mail-sync-progress` event with `status: "done"` fires. | `EmailWorkspace.tsx`; `listen(MAIL_SYNC_EVENT)`; `setRetryCount` | Email tab open while sync runs in separate connectors window | List re-fetches from page 0 when sync-done event fires | L2 | H | `email-refresh-on-import.test.tsx` (unit, mocked Tauri listen) |
| EMAIL-75 | any | As a user I want the email list to refresh when I bring the app window into focus so I see the latest mail without manually reloading. | Switch away from app then back; window fires `focus` event. | `EmailWorkspace.tsx`; `window.addEventListener('focus', refresh)` | Email tab open | List re-fetches on window focus | L2 | M | `email-refresh-on-import.test.tsx` |
| EMAIL-76 | any | As a user I want the connected-accounts list to refresh when I regain focus so connecting in the connectors window is immediately reflected in the Email tab. | Connect account in Account window; return focus to Email tab. | `EmailWorkspace.tsx`; `window.addEventListener('focus', load)` in accounts loader | Email tab open; account list was empty | Account list re-fetches; "No email connected" state replaced by list | L2 | H | NONE (focus listener for accounts not directly tested) |

---

## Export to workspace

| ID | Persona | Story | Steps | Surface | Precondition | Expected | Layer | Risk | Covered? |
|---|---|---|---|---|---|---|---|---|---|
| EMAIL-77 | any | As a user I want to export an email to my workspace so I can reference or annotate it as a document. | Hover a mail row; click "Export". | `MailRow.tsx`; `data-testid="export-email-{id}"`; `mailGetMessage` → `onSaveToWorkspace` | `onSaveToWorkspace` prop provided; message synced | Message fetched (decrypt), formatted as headers + body, saved to workspace as `<slug>.txt` | L2 | M | NONE |

---

## Open email from AI chat citation

| ID | Persona | Story | Steps | Surface | Precondition | Expected | Layer | Risk | Covered? |
|---|---|---|---|---|---|---|---|---|---|
| EMAIL-78 | any | As a user I want to click a `mail:` citation in the AI chat so that the referenced email opens in a viewer tab. | In the Ask surface, click a citation whose sourceId starts with `mail:`. | `useOpenEmailListener.ts`; `keepance:open-email` custom event; editor store `openTab` | AI chat session with a mail citation; email synced | Viewer tab opened (keyed by `mail:<id>`); second click focuses existing tab | L1 (event dispatch) / L2 (viewer decrypt) | M | `open-email-listener.test.tsx` |

---

## Notes on Layer and testability

- **L1 (browser dev server, `?mailFixture=1`)**: All `EmailWorkspace` list/search/compose UI, AI search mode UI, viewer UI (with mocked `mailGetMessage`), row actions (mocked Tauri commands), privilege UI, matter picker UI.
- **L2 (real Tauri desktop)**: Real `mailGetMessage` decrypt, attachment download, retag/matter filing (SQLCipher), cross-window events (`isTauri()` required), session scroll persistence, FDE status.
- **L3 (live OAuth harnesses)**: Real M365/Gmail/IMAP connect → token → sync → data in store; real compose/reply send; real attachment fetch. Harnesses: `gmail_live_smoke` / `outlook_live_smoke` in `src-tauri` (both `#[ignore]`).
- **L4**: OS-specific signing/notarisation; FDE reporting on macOS (FileVault) vs Windows (BitLocker).
