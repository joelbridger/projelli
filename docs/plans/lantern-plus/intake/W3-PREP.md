# Lantern Intake Wave 3 Prep Pack

**Purpose:** make Wave 3 dispatchable immediately after Wave 2 lands.

**Wave 3 goal:** an email reply to the advisor's normal mailbox becomes an advisor-reviewed intake proposal. It is never silently filed. Authenticated mail can produce confidence-tiered proposal cards. Failed or missing mail authentication goes to quarantine. Accepted items write files and facts with `channel:'email_reply'`, `confirmed_by`, checklist updates, and audit intent/outcome rows.

**Source notes:** the current docs-only worktree contains `docs/plans/lantern-plus/intake/W2-PREP.md`, but not the requested `WAVE-PLAN.md`, `PRODUCT-DESIGN.md`, or intake-specific `ARCHITECTURE.md` at that path. I read the current source docs from `plan/intake-design:docs/plans/lantern-plus/intake/{WAVE-PLAN.md,ARCHITECTURE.md,PRODUCT-DESIGN.md}` and read the repo root `ARCHITECTURE.md` in this worktree. Mail path claims below are grounded in current code.

## Real Mail Rails Found

Current working anchors:

- `src-tauri/src/commands/mail/store.rs` defines `MailRecord`, `MailListItem`, `MailStore`, and `EncryptedMailStore`.
- `src-tauri/src/commands/mail/store.rs` stores mail metadata in SQLCipher at `.lantern/mail-enc.db` through `EncryptedMailStore::db_path()`.
- `src-tauri/src/commands/mail/store.rs` stores encrypted message bodies under `.lantern/mail/blobs/<sha256>.enc`.
- `src-tauri/src/commands/mail/sync.rs` writes provider messages through `apply_messages_enc()`, upserts metadata, and writes encrypted blobs.
- `src-tauri/src/commands/mail/model.rs` has provider-neutral `MailMessage` fields: `id`, `conversation_id`, `internet_message_id`, `from_address`, `thread_id`, `provider`, `account`, `has_attachments`, and body text.
- `src-tauri/src/commands/mail/normalize.rs` writes `conversation_id`, `internet_message_id`, and `thread_id` into stored Markdown frontmatter.
- `src-tauri/src/commands/mail/messages.rs` exposes `mail_list_messages`, `mail_get_message`, and `mail_get_attachment`.
- `src/platform/utils/mail-commands.ts` mirrors those commands as `mailListMessages`, `mailGetMessage`, and `mailGetAttachment`.
- `src-tauri/src/lib.rs` registers `mail_get_attachment`.
- `src/features/email/EmailViewer.tsx` already calls `mailGetAttachment()` when the viewer has an attachment id.
- `src/platform/fs/WorkspaceService.ts` owns path validation plus `writeFileBinary()` for saving binary files into the workspace.
- `src/features/matters/CrmWriteReviewCard.tsx` and `src/platform/state/crmWriteQueueStore.ts` are the nearest existing "proposal card plus explicit approve" pattern.
- `src-tauri/src/commands/crm/commands.rs` has the strongest intent/outcome audit precedent. It writes an intent row before the outside effect and an outcome row after.

Current gaps that Wave 3 must handle:

- No DKIM, DMARC, SPF, or `Authentication-Results` handling exists in the mail rails. Search found no mail-auth result storage or parsing.
- `EncryptedMailStore` metadata columns are `id`, `folder_id`, `internet_message_id`, `relative_path`, `received_date_time`, `provider`, `account`, `subject`, `from_addr`, `from_name`, `snippet`, and `has_attachments`. There is no auth-result column and no durable `thread_id` column.
- `MailMessage` has `thread_id`, and stored Markdown includes `thread_id`, but `MailRecord`, `MailListItem`, `MailView`, and the TS `MailView` wrapper do not expose it. Wave 3's "in-thread replies ranked above cold messages" rule needs this surfaced.
- `mail_get_attachment` can fetch Graph and Gmail attachment bytes on demand, but `MailView::from_markdown()` always returns `attachments: Vec::new()`. The UI tests mock attachment refs, but the real import path does not persist attachment ids or names yet.
- `mail_get_attachment` returns an error for IMAP. IMAP can participate in body-only proposal matching unless Wave 3 adds IMAP attachment download.
- The current `Matter` model in `src/platform/types/matter.ts` and the current `NewClientDialog` do not store client email addresses. Wave 1 or Wave 2 is expected to add this for Intake. Wave 3 cannot safely match by sender until that final contact-address source exists.

## Dispatch Shape

Recommended branch fan-out after Wave 2 is merged:

| Lane | Branch | Primary outcome | Depends on |
|---|---|---|---|
| Ingest and match | `lp/intake-w3-ingest-match` | Mail candidates, sender/auth/thread gates, deterministic request matching | Wave 2 board state, final contact-address store |
| Proposal cards | `lp/intake-w3-proposal-cards` | Advisor cards, accept path, file/fact writes, audit pairs | Ingest/match contracts, final facts store |
| Quarantine path | `lp/intake-w3-quarantine` | Failed/missing-auth and ambiguous-match manual review path | Ingest/match auth result shape |

Merge order recommendation: ingest/match first, proposal cards second, quarantine third. Quarantine can build against a stub auth shape, but should merge last so it uses the final matcher outputs.

## Lane 1: Ingest And Match

**Outcome:** a safe, deterministic candidate engine that says whether an imported email can be considered for Intake, before AI or document classification runs.

### Existing anchors

- `src-tauri/src/commands/mail/store.rs`
- `src-tauri/src/commands/mail/sync.rs`
- `src-tauri/src/commands/mail/model.rs`
- `src-tauri/src/commands/mail/normalize.rs`
- `src-tauri/src/commands/mail/gmail/normalize.rs`
- `src-tauri/src/commands/mail/imap/normalize.rs`
- `src-tauri/src/commands/mail/messages.rs`
- `src/platform/utils/mail-commands.ts`
- `src/platform/types/matter.ts`

### Expected Wave 1 and Wave 2 anchors

Confirm exact names after Wave 2 lands:

- `src/platform/intake/types.ts`, for `FormRequest`, `RequestItem`, `ClientFact`, and provenance types.
- `src/platform/intake/intakeStore.ts`, for request state, open items, lifecycle, and board selectors.
- `src/platform/intake/factsStore.ts`, for fact writes and masked reads.
- The final client or household contact-address store. Current code does not have it.
- The final nudge state, if Wave 2 records provider draft ids, sent message ids, or thread ids.

### Proposed new or changed files

- `src/platform/intake/emailReplyTypes.ts`
- `src/platform/intake/emailAddressMatch.ts`
- `src/platform/intake/emailAuthResult.ts`
- `src/platform/intake/emailReplyMatcher.ts`
- `src/platform/intake/emailReplyMatcher.test.ts`
- `src/platform/intake/emailThreadMatch.ts`
- `src/platform/intake/emailThreadMatch.test.ts`
- `src/platform/intake/emailAttachmentManifest.ts`
- `src-tauri/src/commands/mail/store.rs`, add durable fields for auth result, thread id, and attachment manifest reference or attachment JSON.
- `src-tauri/src/commands/mail/model.rs`, add provider-neutral auth and attachment-ref fields.
- `src-tauri/src/commands/mail/normalize.rs`, include auth summary and attachment refs in normalized storage only if the team keeps Markdown as the message blob format.
- `src-tauri/src/commands/mail/gmail/normalize.rs`, parse `Authentication-Results`, `ARC-Authentication-Results`, `Received-SPF`, and attachment ids/names from Gmail full message JSON.
- `src-tauri/src/commands/mail/imap/normalize.rs`, parse equivalent headers from raw RFC822 where possible and record missing auth as missing, not pass.
- `src-tauri/src/commands/mail/messages.rs`, expose auth result, thread ids, and attachment refs in `MailView`.
- `src/platform/utils/mail-commands.ts`, mirror the new fields in TS types.

### Matching behavior

The matcher is a pure function over imported mail metadata plus Intake state. It must not ask an AI provider until the deterministic gate passes.

Inputs:

- Message id, provider, account, received timestamp.
- Parsed sender address, not display name.
- Provider-reported auth result.
- Thread identifiers: Graph `conversationId`, Gmail `threadId`, IMAP `References` or `In-Reply-To` derived thread id.
- Active request list for the matched client.
- Open item list for each request.
- Outbound thread/message ids recorded when the advisor sent the initial intake email or Wave 2 nudges.

Rules:

1. Normalize sender addresses by trimming, lowercasing the domain, IDNA-normalizing the domain, and lowercasing for comparison. Do not strip dots, hyphens, or plus tags unless the exact alias is saved on the client or household.
2. Match only against saved client or household member addresses. Display name never counts.
3. If the same address maps to more than one active client or household, quarantine as ambiguous.
4. If no active intake or request exists for that matched client, do not produce an intake proposal.
5. If exactly one active request exists and the sender matches, the email can become a candidate.
6. If multiple active requests exist for the same client, an inbound thread id must uniquely match one request's original intake email or nudge thread. Without that unique thread tie, quarantine as ambiguous.
7. If the message is in-thread with the original intake email or nudge, rank it above cold messages from the same address.
8. Run classification only against open items. Already accepted items can only become "possible update" proposals.
9. For authenticated mail, classification can assign high, medium, or low confidence.
10. For failed or missing auth, skip confidence tiers and send the message to quarantine.

## Lane 2: Proposal Cards And Accept Path

**Outcome:** matched authenticated emails show as advisor-reviewed proposal cards on the Onboarding board or per-client Onboarding tab. Accepting writes files, facts, checklist state, and audit rows.

### Existing anchors

- `src/features/matters/CrmWriteReviewCard.tsx`
- `src/platform/state/crmWriteQueueStore.ts`
- `src/features/matters/MatterHub.tsx`
- `src/platform/utils/mail-commands.ts`
- `src-tauri/src/commands/mail/messages.rs`
- `src/platform/fs/WorkspaceService.ts`
- `src/platform/fs/activeWorkspaceService.ts`
- `src/features/matters/matterManagerDialogHelpers.ts`
- `src-tauri/src/commands/crm/commands.rs`

### Proposed new or changed files

- `src/features/intake/EmailReplyProposalCard.tsx`
- `src/features/intake/EmailReplyProposalRow.tsx`
- `src/features/intake/EmailReplyReviewModal.tsx`
- `src/features/intake/EmailReplyProposalBanner.tsx`
- `src/features/intake/__tests__/EmailReplyProposalCard.test.tsx`
- `src/platform/intake/emailReplyProposalStore.ts`, or the final Wave 1 Rust intake store if proposal queues live encrypted at rest there.
- `src/platform/intake/emailReplyClassifier.ts`
- `src/platform/intake/emailReplyAccept.ts`
- `src/platform/intake/emailReplyAudit.ts`
- `src/platform/intake/requestPaths.ts`, if Wave 1 does not already provide a `Requests/onboarding/` path helper.
- `src-tauri/src/commands/mail/messages.rs`, add a persist-to-workspace command if the lead chooses Rust-side attachment persistence.
- `src/platform/utils/mail-commands.ts`, add the matching TS wrapper if a new command is added.
- `src/locales/en.json`, `src/locales/es.json`, `src/locales/de.json`

### Proposal behavior

- Authenticated high-confidence matches can be checked by default, but never filed automatically.
- Authenticated medium-confidence matches can be pre-selected only when the reasoning line is visible.
- Low-confidence matches are visible but unchecked.
- A card can include body-derived facts, attachment-derived documents, or both.
- The body text must be treated as untrusted client content. It can be read for classification, but it must not control recipient, request id, file path, item id, or audit content.
- The code, not the model, chooses the target client, request, open item list, destination folder, and provenance.
- Accepting a proposal writes an audit intent row before any file or fact write.
- If the intent row cannot be written, the accept path refuses to write files or facts.
- Accepted files land under the request folder convention from the Intake architecture. For onboarding, use `Requests/onboarding/`, with a stable email-reply subfolder such as `Requests/onboarding/email-replies/<safe-message-id>/`.
- Attachment filenames are sanitized and uniquified. Never trust provider filenames as paths.
- File writes go through `WorkspaceService.writeFileBinary()` or a new Rust command with the same path validation standard.
- Accepted facts use `ClientFact.provenance.channel = 'email_reply'`, `confirmed_by = <advisor id>`, and `verification = 'advisor_confirmed'`.
- Body-derived restricted facts should show masked previews in the card. Full restricted values should not be rendered into normal React state or audit rows.
- Checklist ticks happen only after the file or fact write succeeds.
- Outcome audit rows include the same `audit_pair_id`, item ids, fact ids or file paths, provider/account/message id, and final status. They do not include email body text or restricted values.

### Attachment behavior

Wave 3 needs an attachment manifest before file proposals can ship:

- Graph: `mail_get_attachment` already fetches a Graph attachment by message id and attachment id.
- Gmail: `mail_get_attachment` fetches a Gmail part `attachmentId`, but current code falls back to using the attachment id as filename because the fetch endpoint does not return content type or filename.
- IMAP: `mail_get_attachment` currently returns "IMAP attachment download is not yet supported."
- Real proposal cards need durable attachment refs in `MailView`, not only `has_attachments`.

Recommended first cut:

- Persist attachment refs at sync time for M365 and Gmail: id, display filename, content type when known, byte size when known, and attachment kind.
- For IMAP, either add part-number download or mark IMAP attachments as unsupported in Wave 3 and keep body-only matching.
- Add tests that an imported real provider fixture with two attachments produces two card rows with stable ids.

## Lane 3: Quarantine Path

**Outcome:** risky or ambiguous email replies are visible enough not to vanish, but cannot be accepted with the fast path.

### Existing anchors

- `src/features/email/EmailViewer.tsx`, for opening and reading the original email.
- `src/features/matters/MatterHub.tsx`, for per-client placement.
- `src/features/matters/CrmWriteReviewCard.tsx`, for a compact approval-card pattern.
- `src/ui/kp/`, for `Card`, `Button`, `Badge`, and light UI pieces.

### Proposed new or changed files

- `src/platform/intake/emailQuarantinePolicy.ts`
- `src/platform/intake/emailQuarantineStore.ts`
- `src/features/intake/EmailReplyQuarantineCard.tsx`
- `src/features/intake/EmailReplyQuarantinePanel.tsx`
- `src/features/intake/__tests__/emailQuarantinePolicy.test.ts`
- `src/features/intake/__tests__/EmailReplyQuarantineCard.test.tsx`
- `src/platform/types/audit.ts`, add final action strings.
- `src/app/shell/common/AuditLog.tsx` and `src/features/audit/auditHomeHelpers.ts`, label the new audit rows.
- `src/locales/en.json`, `src/locales/es.json`, `src/locales/de.json`

### Quarantine behavior

Quarantine is for messages that may be real, but are not safe enough for the fast proposal path:

- From-address matches, but DKIM/SPF/DMARC pass is failed or missing.
- From-address is a look-alike or display-name-only match.
- Sender address maps to multiple active clients.
- One client has multiple active requests and the thread id does not uniquely identify one.
- A reply targets a completed, revoked, or expired request.
- The message attempts to update an already accepted restricted item.
- The provider does not expose enough attachment metadata to safely identify which file is being accepted.

Quarantine rules:

- No "Accept all."
- No preselected rows.
- No confidence tier.
- The advisor must open or review the message, pick the target client/request/item when applicable, and explicitly confirm.
- The warning must explain the reason in plain language.
- A quarantined email can be dismissed as not intake material.
- A quarantined email can be manually filed after verification, but the resulting provenance must show `channel:'email_reply'` and the activity trail must say the advisor manually confirmed it.

## Deterministic Matching Acceptance Criteria

These are the plan rules restated as tests.

### Sender identity

- Given an email from `sarah@example.com` and an active intake whose saved client address is `sarah@example.com`, the matcher can continue to auth checks.
- Given an email from `Sarah Okafor <sarah@example.com>`, the matcher uses only `sarah@example.com`.
- Given an email from `Sarah Okafor <sarah.okafor@example.com>` and a saved address `sarah@example.com`, the matcher does not match.
- Given an email from `sarah+docs@example.com` and a saved address `sarah@example.com`, the matcher does not match unless `sarah+docs@example.com` is also saved.
- Given a Unicode or IDN domain, the matcher compares after domain normalization and rejects malformed addresses.
- Given one sender address saved on two active clients, the matcher quarantines as ambiguous.

### Sender authenticity

- Given a sender match and aligned DKIM/SPF with DMARC pass, the message can use normal proposal confidence tiers.
- Given a sender match and DMARC fail, the message goes to quarantine.
- Given a sender match and missing auth result, the message goes to quarantine.
- Given a provider that cannot supply auth results, the message goes to quarantine until the wave lead explicitly downgrades the provider scope.
- Given a spoofed sender where `from_addr` equals the client's address but auth fails, no proposal row is preselected and there is no one-click accept.

### Active request

- Given a matched, authenticated sender and exactly one active intake with open items, the matcher can classify against those open items.
- Given no active intake, the matcher does not create an intake proposal.
- Given a completed intake, the matcher does not tick checklist items. It may create a completed-request signal or quarantine card for manual handling.
- Given a revoked or expired intake, the matcher does not create a normal proposal.
- Given multiple active intakes or form requests for the same client, the matcher requires a unique thread tie to one request.
- Given multiple active requests and no unique thread tie, the matcher quarantines as ambiguous.

### Thread preference

- Given an inbound message in the same thread as the initial intake email, it ranks above a cold message from the same sender.
- Given an inbound message in the same thread as a Wave 2 nudge, it ties to that request.
- Given a cold message from the same sender and only one active request, it can still be a candidate after auth passes.
- Given a cold message from the same sender and multiple active requests, it quarantines.

### Open items only

- Given an authenticated reply with an attachment that looks like an open driver's license item, the proposal can target that item.
- Given an authenticated reply with an attachment that looks like an already accepted driver's license item, the proposal becomes "possible update" and is unchecked.
- Given an authenticated reply with body text that looks like an already accepted SSN, it requires per-field review and supersede handling. It never silently replaces the active fact.
- Given an item in "Needs another look", the proposal can target that reopened item if the request state says it is open.

### No silent filing

- No imported email writes a client file, fact, or checklist state until the advisor approves.
- No AI output can choose a client, request, item id, or destination path.
- The accept path writes intent before effect and outcome after effect.
- If a file write succeeds but a fact write fails, the outcome row records partial failure and the UI keeps the unresolved proposal visible.
- If the app restarts after a proposal is created but before approval, the proposal or quarantine state survives through encrypted durable state, not local-only React state.

## Non-E2EE Channel Copy

Use this copy as the starting pack. It is intentionally plain and does not claim that email has the same protection as the secure link.

### Client-visible copy

**Fallback on an old browser:**

This secure page cannot run in this browser. You can reply to [Advisor]'s email with documents instead. Please do not email your Social Security number. Call [Advisor] for that.

**Privacy explainer, email section:**

If you reply by email, your message is protected by your email provider and [Firm]'s email system. It does not use this page's end-to-end encryption.

**Advisor email draft note:**

You can use the secure link, or you can reply to this email with documents. Email is normal firm email, not the same protected channel as the link. For Social Security numbers or other very sensitive details, please call us.

**Client confirmation after an emailed item is accepted by the advisor, if surfaced later:**

We received this by email and [Advisor] added it to your onboarding list.

### Advisor-visible copy

**Proposal card channel label:**

Email reply. Not end-to-end encrypted.

**Proposal card helper text:**

This came through your mailbox, not the secure link. Review it before filing.

**Authenticated proposal note:**

Email authentication passed for [sender]. Still review the items before accepting.

**Quarantine warning:**

This email did not prove it came from [client]. Verify with the client before accepting anything.

**Look-alike address warning:**

The sender address is not on this client's record. It may be a different person or a typo.

**Completed-request signal:**

This reply is tied to a completed onboarding request. Nothing will be added unless you file it manually.

**Multiple-request warning:**

This client has more than one active request, and this email does not clearly belong to one of them.

**Accepted provenance chip:**

From email reply. Confirmed by you.

**Activity trail row:**

Accepted from normal email. Confirmed by [Advisor]. Channel: email reply.

**Audit description pattern:**

Email intake item accepted for [Client]. Source: [provider] message [message id]. Channel: email reply. Confirmed by [Advisor].

## Cross-Lane Tests

- Matcher fixture: exact saved sender, authenticated, one active intake, one open item.
- Spoof fixture: same from-address, failed DMARC, quarantined with no checked rows.
- Look-alike fixture: similar address and matching display name, no deterministic match.
- Completed intake fixture: reply to completed request creates no checklist tick.
- Multiple active requests fixture: unique thread matches one request, missing thread quarantines.
- Duplicate client-address fixture: same sender saved on two active clients quarantines.
- Accepted item fixture: license already accepted becomes possible update, unchecked.
- Missing auth fixture: no auth result quarantines.
- Attachment manifest fixture: imported Graph and Gmail messages expose stable attachment refs in `MailView`.
- Attachment persist fixture: accepting one attachment writes a sanitized file under `Requests/onboarding/`, does not overwrite an existing file, and records an outcome audit row.
- Restricted fact fixture: emailed SSN proposal shows only a masked preview and writes a restricted fact only after explicit approval.
- Restart fixture: proposal/quarantine state survives app restart through durable encrypted state.
- IMAP fixture: body-only matching works, and attachment acceptance is blocked or implemented according to the final scope.

## Open Questions For The Wave Lead

1. What is the final Wave 1 or Wave 2 source of truth for client and household email addresses?
2. Is "one active intake per client" still a hard invariant, or can Wave 3 see multiple active `FormRequest`s for one client after Addendum 1?
3. Will Wave 2 store provider message ids or thread ids for initial intake emails and nudges, or must Wave 3 add that state?
4. Which providers must ship in Wave 3: M365 and Gmail only, or IMAP too?
5. Should IMAP attachment download be built now, or should IMAP be body-only for Wave 3?
6. What exact provider auth fields should become the durable `MailAuthResult` shape?
7. How should Wave 3 handle legitimate clients whose domain has broken or missing DMARC? Recommendation: quarantine, never normal proposal flow.
8. Should emailed restricted facts such as SSNs be accepted into the facts store after advisor confirmation, or should the UI force phone/manual re-entry?
9. Should attachment persistence run through `WorkspaceService.writeFileBinary()` in TS or a new Rust command that fetches and writes without returning bytes to the renderer?
10. Where should proposal and quarantine queues live durably? Recommendation: the encrypted Intake SQLCipher store, not Zustand localStorage.
11. What are the final audit action strings and payload fields for email-reply intent and outcome rows?
12. Should quarantined cards appear on the main Onboarding board by default, or only inside the affected client's Onboarding tab?
