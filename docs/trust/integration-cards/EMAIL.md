# Email Integration Honesty Card

Last verified: 2026-07-10

Status: Shipping for Microsoft 365, Gmail, and IMAP

This connector imports email into Advisor Prep Hero and can send or save drafts only when the advisor acts from the email UI.

## What this connector reads

From Microsoft 365:

- Mail folders, excluding Deleted Items and Junk Email when those folders can be resolved.
- Message delta pages for each synced folder.
- Messages: `id`, `conversationId`, `internetMessageId`, `subject`, `receivedDateTime`, `from.emailAddress.name`, `from.emailAddress.address`, `toRecipients`, `ccRecipients`, `hasAttachments`, and `body.contentType/body.content`.
- Attachment bytes on demand from `/me/messages/{id}/attachments/{attachment_id}`. The bytes are returned in memory for viewing or download.

From Gmail:

- Labels: `id` and `name`.
- Message ids from all mail, excluding spam and trash by Gmail's default.
- Message history: added message ids, deleted message ids, and `historyId`.
- Full messages: `id`, `threadId`, `labelIds`, headers (`Subject`, `From`, `To`, `Cc`, `Message-ID`, `Date`), MIME body text or HTML fallback, attachment presence, and `internalDate`.
- Gmail profile fields used by the connector: `historyId` for sync and `emailAddress` for sending from the authenticated account.
- Attachment bytes on demand from `/gmail/v1/users/me/messages/{id}/attachments/{attachment_id}`. The bytes are returned in memory.

From IMAP:

- Mailbox names from `LIST`.
- UIDs from `UID SEARCH ALL`.
- Full RFC822 messages from `UID FETCH ... BODY.PEEK[]`, which does not mark messages as read.
- Parsed message fields: subject, from name/address, to, cc, Message-ID, date, thread id from `References` or `In-Reply-To`, text body or HTML fallback, attachment presence, folder name, provider, and account.

On this device:

- Email metadata: id, folder id, internet message id, encrypted body path, received time, provider, account, subject, sender address/name, snippet, and attachment flag.
- Encrypted email body blobs under the workspace data folder.
- Local encrypted search chunks for filed or folder-mapped client email.
- Manual client filing state for messages.

## What this connector writes

In Microsoft 365:

- Sends email through `/me/sendMail` with `subject`, plain-text `body`, `toRecipients`, `ccRecipients`, `bccRecipients`, optional `attachments`, and `saveToSentItems: true`.
- Saves a real mailbox draft through `/me/messages` with `subject`, HTML `body`, and `toRecipients`.
- Saves a threaded reply draft through `/me/messages/{id}/createReply`, then patches the draft with `subject`, HTML `body`, and `toRecipients`.

In Gmail:

- Sends email through `/gmail/v1/users/me/messages/send` as a raw RFC822 message with `From`, `To`, `Cc`, `Bcc`, `Subject`, plain-text body, optional `In-Reply-To`, optional `References`, and optional attachments.
- Saves a draft through `/gmail/v1/users/me/drafts` as a raw RFC822 message with `From`, `To`, `Subject`, HTML body, optional `In-Reply-To`, and optional `References`.

In IMAP:

- Sends email through SMTP STARTTLS on port 587 using the connected IMAP account's host, username, and password.
- The sent message can include `From`, `To`, `Cc`, `Bcc`, `Subject`, plain-text body, optional `In-Reply-To`, optional `References`, and optional attachments.
- It does not save IMAP drafts.

On this device:

- Encrypted message bodies, metadata rows, sync cursors, local filing tags, and encrypted search chunks.
- Audit entries for AI draft egress, saved drafts, and sent messages. The audit entries store counts, provider/account, message ids or scope, not email body text or recipient addresses.

## What this connector can never touch

- It has no mailbox delete, move, archive, label edit, mark-read, or mark-unread write path.
- IMAP reads use `BODY.PEEK[]`, so syncing does not mark messages as seen.
- IMAP attachment download is not implemented.
- IMAP draft saving is not implemented.
- Send and draft logging deliberately avoids email body text and recipient addresses.
- Background sync cannot send email or save drafts.

## How writes are gated

- Review surface: New email, reply, and follow-up draft screens show editable To, Cc, Bcc, Subject, and Body fields before any send.
- Approval action: A real send happens only when the advisor clicks Send. A real draft save happens only when the advisor clicks Save to my Drafts.
- AI draft generation: Opening the follow-up modal does not send note content to an AI provider. The note leaves only when the advisor clicks Generate.
- Receipt: Send success is recorded as a sent state plus an `email.send` audit entry. Draft save success is recorded as a saved state plus an `email.draft_saved` audit entry. Provider draft ids are returned by Microsoft 365 and Gmail draft paths.
- Background behavior: Sync imports and indexes email locally. It cannot send, draft, delete, move, or mark mailbox messages.

## Limits worth knowing

- Microsoft 365 send returns success with no sent message id.
- Gmail send returns a Gmail message id.
- SMTP send returns success with no server-assigned message id.
- Microsoft 365 and Gmail draft saving may require reconnecting if the stored token predates the needed scope.

<!--
Evidence:
- src/features/email/ComposeModal.tsx
- src/features/email/DraftFollowUpModal.tsx
- src/features/email/EmailViewer.tsx
- src/features/email/emailAuditLog.ts
- src/features/email/followUpDraft.ts
- src/platform/utils/mail-commands.ts
- src-tauri/src/commands/mail/backfill.rs
- src-tauri/src/commands/mail/graph.rs
- src-tauri/src/commands/mail/gmail/api.rs
- src-tauri/src/commands/mail/gmail/normalize.rs
- src-tauri/src/commands/mail/imap/client.rs
- src-tauri/src/commands/mail/imap/normalize.rs
- src-tauri/src/commands/mail/imap/send.rs
- src-tauri/src/commands/mail/messages.rs
- src-tauri/src/commands/mail/model.rs
- src-tauri/src/commands/mail/normalize.rs
- src-tauri/src/commands/mail/oauth.rs
- src-tauri/src/commands/mail/send.rs
- src-tauri/src/commands/mail/store.rs
- src-tauri/src/commands/mail/sync.rs
-->
