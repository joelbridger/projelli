import { BRAND } from '@/config/brand';
export const integrationHonestyCardIds = [
  'wealthbox',
  'email',
  'onedrive-sharepoint',
  'calendly',
] as const;

export type IntegrationHonestyCardId = (typeof integrationHonestyCardIds)[number];

export type IntegrationHonestySection = {
  heading: string;
  items: string[];
};

export type IntegrationHonestyGate = {
  label: string;
  detail: string;
};

export type IntegrationHonestyCard = {
  connectorId: IntegrationHonestyCardId;
  name: string;
  lastVerified: string;
  status: string;
  summary: string;
  reads: IntegrationHonestySection[];
  writes: IntegrationHonestySection[];
  neverTouch: string[];
  gating: IntegrationHonestyGate[];
  limits: string[];
};

export const integrationHonestyCards = {
  wealthbox: {
    connectorId: 'wealthbox',
    name: 'Wealthbox',
    lastVerified: '2026-07-10',
    status: 'Shipping',
    summary:
      `This connector brings Wealthbox client records into ${BRAND.name} and can write back only a small set of advisor-approved updates.`,
    reads: [
      {
        heading: 'From Wealthbox',
        items: [
          '`me`: account validation for the pasted API token.',
          '`contacts` and `households`: `id`, `external_id`, `type`, `name`, `first_name`, `middle_name`, `last_name`, `nickname`, `prefix`, `suffix`, `company_name`, `job_title`, `birth_date`, `anniversary`, `client_since`, `retirement_date`, `date_of_death`, `marital_status`, `contact_type`, `status`, `background_information`, `important_information`, `personal_interests`, `investment_objective`, `investment_time_horizon`, `investment_risk_tolerance`, `gross_annual_income`, `assets`, `non_liquid_assets`, `liabilities`, `adjusted_gross_income`, `tax_bracket`, `tax_year`, professional relationship ids, `street_addresses`, `email_addresses`, `phone_numbers`, `household`, `tags`, and `contact_roles`.',
          '`notes`: `id`, `external_id`, `created_at`, `updated_at`, `content`, and `linked_to`.',
          '`tasks`: `id`, `external_id`, `name`, `due_date`, `complete`, `priority`, `description`, `created_at`, `updated_at`, and `linked_to`.',
          '`events`: `id`, `external_id`, `title`, `starts_at`, `ends_at`, `all_day`, `location`, `description`, and `linked_to`.',
          'Category, user, and team labels used to make synced records readable.',
          `Deleted contact ids, so ${BRAND.name} can remove stale local CRM rows.`,
        ],
      },
      {
        heading: 'On this device',
        items: [
          'The connector stores synced CRM JSON, source ids, hashes, linked client ids, and write receipts in an encrypted local database.',
          'The connector indexes mapped client records into the local encrypted search index.',
        ],
      },
    ],
    writes: [
      {
        heading: 'In Wealthbox',
        items: [
          '`notes`: creates a note with `content` and `linked_to: [{ id: contact_id, type: "Contact" }]`.',
          '`tasks`: creates a task with `name`, `description`, `due_date`, and `linked_to: [{ id: contact_id, type: "Contact" }]`.',
          '`contacts`: updates only the allowlisted field `background_information`.',
        ],
      },
      {
        heading: 'On this device',
        items: [
          'Write queue items: proposed note, task, or field update, requested time, source reference, status, and remote receipt.',
          'Write ledger rows: dedup key, write kind, status, remote id, created time, and updated time.',
          'Audit entries for approved writes, stale blocked writes, pending verification, and remote receipts.',
        ],
      },
    ],
    neverTouch: [
      "It does not read or write Wealthbox passport number, green card number, or driver's license fields. Those fields are intentionally omitted from the data model.",
      'It has no Wealthbox delete path.',
      'It has no write path for Redtail or Salesforce.',
      'It does not write notes, tasks, or field updates from sync, timers, page load, or AI generation alone.',
      'It does not write any contact field except `background_information`.',
      'It does not file notes, tasks, or events to a client unless their Wealthbox `linked_to` target resolves to a contact household.',
    ],
    gating: [
      {
        label: 'Review card',
        detail: 'Wealthbox writes appear in the CRM write review card inside the client view.',
      },
      {
        label: 'Approval action',
        detail: 'Nothing is sent until the advisor clicks Approve for selected items.',
      },
      {
        label: 'Receipt',
        detail:
          'Successful writes store the Wealthbox remote id. Deduped writes store the prior remote id. Audit entries record the approved action without logging private note bodies as diagnostics.',
      },
      {
        label: 'Field safety',
        detail:
          `Before a field update is sent, ${BRAND.name} re-fetches the live Wealthbox value. If the value changed, the write is blocked and the advisor must review again.`,
      },
      {
        label: 'Background behavior',
        detail: 'Background CRM sync reads Wealthbox and updates local encrypted data. It cannot write remotely.',
      },
    ],
    limits: [
      'Wealthbox tasks require a due date.',
      'AI-drafted notes get a provenance line before approval, so the Wealthbox note says it was AI-drafted and advisor-approved.',
      '`source_ref` is used locally for traceability. It is never sent to Wealthbox.',
    ],
  },
  email: {
    connectorId: 'email',
    name: 'Email: Microsoft 365, Gmail, and IMAP',
    lastVerified: '2026-07-10',
    status: 'Shipping for Microsoft 365, Gmail, and IMAP',
    summary:
      `This connector imports email into ${BRAND.name} and can send or save drafts only when the advisor acts from the email UI.`,
    reads: [
      {
        heading: 'From Microsoft 365',
        items: [
          'Mail folders, excluding Deleted Items and Junk Email when those folders can be resolved.',
          'Message delta pages for each synced folder.',
          'Messages: `id`, `conversationId`, `internetMessageId`, `subject`, `receivedDateTime`, `from.emailAddress.name`, `from.emailAddress.address`, `toRecipients`, `ccRecipients`, `hasAttachments`, and `body.contentType/body.content`.',
          'Attachment bytes on demand from `/me/messages/{id}/attachments/{attachment_id}`. The bytes are returned in memory for viewing or download.',
        ],
      },
      {
        heading: 'From Gmail',
        items: [
          'Labels: `id` and `name`.',
          "Message ids from all mail, excluding spam and trash by Gmail's default.",
          'Message history: added message ids, deleted message ids, and `historyId`.',
          'Full messages: `id`, `threadId`, `labelIds`, headers (`Subject`, `From`, `To`, `Cc`, `Message-ID`, `Date`), MIME body text or HTML fallback, attachment presence, and `internalDate`.',
          'Gmail profile fields used by the connector: `historyId` for sync and `emailAddress` for sending from the authenticated account.',
          'Attachment bytes on demand from `/gmail/v1/users/me/messages/{id}/attachments/{attachment_id}`. The bytes are returned in memory.',
        ],
      },
      {
        heading: 'From IMAP',
        items: [
          'Mailbox names from `LIST`.',
          'UIDs from `UID SEARCH ALL`.',
          'Full RFC822 messages from `UID FETCH ... BODY.PEEK[]`, which does not mark messages as read.',
          'Parsed message fields: subject, from name/address, to, cc, Message-ID, date, thread id from `References` or `In-Reply-To`, text body or HTML fallback, attachment presence, folder name, provider, and account.',
        ],
      },
      {
        heading: 'On this device',
        items: [
          'Email metadata: id, folder id, internet message id, encrypted body path, received time, provider, account, subject, sender address/name, snippet, and attachment flag.',
          'Encrypted email body blobs under the workspace data folder.',
          'Local encrypted search chunks for filed or folder-mapped client email.',
          'Manual client filing state for messages.',
        ],
      },
    ],
    writes: [
      {
        heading: 'In Microsoft 365',
        items: [
          'Sends email through `/me/sendMail` with `subject`, plain-text `body`, `toRecipients`, `ccRecipients`, `bccRecipients`, optional `attachments`, and `saveToSentItems: true`.',
          'Saves a real mailbox draft through `/me/messages` with `subject`, HTML `body`, and `toRecipients`.',
          'Saves a threaded reply draft through `/me/messages/{id}/createReply`, then patches the draft with `subject`, HTML `body`, and `toRecipients`.',
        ],
      },
      {
        heading: 'In Gmail',
        items: [
          'Sends email through `/gmail/v1/users/me/messages/send` as a raw RFC822 message with `From`, `To`, `Cc`, `Bcc`, `Subject`, plain-text body, optional `In-Reply-To`, optional `References`, and optional attachments.',
          'Saves a draft through `/gmail/v1/users/me/drafts` as a raw RFC822 message with `From`, `To`, `Subject`, HTML body, optional `In-Reply-To`, and optional `References`.',
        ],
      },
      {
        heading: 'In IMAP',
        items: [
          "Sends email through SMTP STARTTLS on port 587 using the connected IMAP account's host, username, and password.",
          'The sent message can include `From`, `To`, `Cc`, `Bcc`, `Subject`, plain-text body, optional `In-Reply-To`, optional `References`, and optional attachments.',
          'It does not save IMAP drafts.',
        ],
      },
      {
        heading: 'On this device',
        items: [
          'Encrypted message bodies, metadata rows, sync cursors, local filing tags, and encrypted search chunks.',
          'Audit entries for AI draft egress, saved drafts, and sent messages. The audit entries store counts, provider/account, message ids or scope, not email body text or recipient addresses.',
        ],
      },
    ],
    neverTouch: [
      'It has no mailbox delete, move, archive, label edit, mark-read, or mark-unread write path.',
      'IMAP reads use `BODY.PEEK[]`, so syncing does not mark messages as seen.',
      'IMAP attachment download is not implemented.',
      'IMAP draft saving is not implemented.',
      'Send and draft logging deliberately avoids email body text and recipient addresses.',
      'Background sync cannot send email or save drafts.',
    ],
    gating: [
      {
        label: 'Review surface',
        detail: 'New email, reply, and follow-up draft screens show editable To, Cc, Bcc, Subject, and Body fields before any send.',
      },
      {
        label: 'Approval action',
        detail: 'A real send happens only when the advisor clicks Send. A real draft save happens only when the advisor clicks Save to my Drafts.',
      },
      {
        label: 'AI draft generation',
        detail: 'Opening the follow-up modal does not send note content to an AI provider. The note leaves only when the advisor clicks Generate.',
      },
      {
        label: 'Receipt',
        detail:
          'Send success is recorded as a sent state plus an `email.send` audit entry. Draft save success is recorded as a saved state plus an `email.draft_saved` audit entry. Provider draft ids are returned by Microsoft 365 and Gmail draft paths.',
      },
      {
        label: 'Background behavior',
        detail: 'Sync imports and indexes email locally. It cannot send, draft, delete, move, or mark mailbox messages.',
      },
    ],
    limits: [
      'Microsoft 365 send returns success with no sent message id.',
      'Gmail send returns a Gmail message id.',
      'SMTP send returns success with no server-assigned message id.',
      'Microsoft 365 and Gmail draft saving may require reconnecting if the stored token predates the needed scope.',
    ],
  },
  'onedrive-sharepoint': {
    connectorId: 'onedrive-sharepoint',
    name: 'OneDrive and SharePoint',
    lastVerified: '2026-07-10',
    status: 'Shipping',
    summary:
      'This connector reads documents from Microsoft OneDrive and SharePoint. It does not upload, edit, or delete anything in Microsoft.',
    reads: [
      {
        heading: 'From Microsoft Graph',
        items: [
          'Drives: `id`, `name`, `webUrl`, and `driveType`.',
          'Drive items: `id`, `name`, `parentReference`, `file`, `folder`, `size`, `lastModifiedDateTime`, `eTag`, `cTag`, `webUrl`, `remoteItem`, and `deleted`.',
          "SharePoint site id when Microsoft includes it in a drive item's `parentReference`.",
          'Delta pages for root folders, including `@odata.nextLink` and `@odata.deltaLink`.',
          'File bytes through `/items/{id}/content` for supported files.',
        ],
      },
      {
        heading: 'Supported file types',
        items: [
          'Text extraction: `.docx`, `.xlsx`, `.pptx`, `.rtf`, `.txt`, `.text`, `.md`, and `.markdown`.',
          'PDF handling: mapped `.pdf` files are imported as local files. Direct connector text indexing for unmapped `.pdf` files is recorded as pending PDF work, not silently treated as unsupported.',
          'Unsupported files are recorded as unsupported and are not indexed.',
        ],
      },
      {
        heading: 'On this device',
        items: [
          `Folder mappings from Microsoft folders to ${BRAND.name} clients.`,
          'Sync metadata: source id, drive id, site id, item id, file name, parent path, web URL, remote signature, content hash, client id, indexed flag, pending PDF flag, deleted flag, cursor, and local imported path when one exists.',
        ],
      },
    ],
    writes: [
      {
        heading: 'In Microsoft OneDrive or SharePoint',
        items: [
          'Nothing. The connector has no Microsoft Graph write path.',
        ],
      },
      {
        heading: 'On this device',
        items: [
          'Encrypted sync metadata in the local OneDrive database.',
          'Encrypted search chunks for unmapped or RAG-only downloaded files.',
          "Local imported copies for mapped client folders, under the client's workspace folder in a `OneDrive` subfolder.",
          `Local cleanup on remote delete: if Microsoft reports an item deleted, ${BRAND.name} marks the local item deleted, removes its connector search chunks, and removes its owned imported local copy when one was recorded.`,
        ],
      },
    ],
    neverTouch: [
      'It cannot upload files to OneDrive or SharePoint.',
      'It cannot edit Microsoft files.',
      'It cannot delete Microsoft files.',
      'It cannot create Microsoft folders.',
      'It cannot change Microsoft sharing settings, permissions, owners, labels, or retention.',
      `It cannot write outside the active ${BRAND.name} workspace. Folder and file path segments are sanitized before local import.`,
      `It does not overwrite a user-owned local file. If a same-name local file exists and ${BRAND.name} does not already own that imported copy, it writes a conflict copy instead.`,
    ],
    gating: [
      {
        label: 'Remote writes',
        detail: 'Not available.',
      },
      {
        label: 'Local imports',
        detail: 'Run only after the advisor connects Microsoft and starts OneDrive/SharePoint sync.',
      },
      {
        label: 'Local file import',
        detail: 'Happens only for mapped folders with a client destination. The files are namespaced under `OneDrive`.',
      },
      {
        label: 'Receipt',
        detail:
          'The sync report records seen, downloaded, imported, indexed, skipped unchanged, removed, pending PDF, unsupported, repaired, and cancelled counts.',
      },
      {
        label: 'Disconnect',
        detail:
          `Local imported data is deleted only through the disconnect flow. Imported files in client folders are deleted only when the user chooses the delete-files option. If cleanup cannot finish safely, ${BRAND.name} keeps the Microsoft connection so the user can retry deletion.`,
      },
    ],
    limits: [
      'The connector uses Microsoft OAuth scopes for file and site reading: `Files.Read.All` and `Sites.Read.All`.',
      'Personal OneDrive and business drives are handled differently because Microsoft exposes them differently.',
      `A sync can be stopped. If stop lands after a download but before the local write, ${BRAND.name} does not commit that local file write.`,
    ],
  },
  calendly: {
    connectorId: 'calendly',
    name: 'Calendly',
    lastVerified: '2026-07-10',
    status: 'Shipping',
    summary:
      `This connector reads scheduled Calendly meetings and invitees into ${BRAND.name}. It does not change Calendly.`,
    reads: [
      {
        heading: 'From Calendly',
        items: [
          'Current user: `uri`, `name`, `email`, and `current_organization`.',
          'Scheduled events: `uri`, `name`, `status`, `start_time`, `end_time`, `created_at`, `updated_at`, `location`, and `event_type`.',
          'Event location: `type`, `location`, and `join_url`.',
          'Invitees: `uri`, `name`, `email`, `status`, `created_at`, `updated_at`, and `questions_and_answers`.',
          'Invitee question answers: `question` and `answer`.',
          'Pagination: `count`, `next_page`, and `next_page_token`.',
        ],
      },
      {
        heading: 'On this device',
        items: [
          'The Calendly API token and user URI in the OS keychain.',
          'Encrypted event rows: id, uuid, event URI, content hash, raw event-plus-invitees JSON, indexed hash, client id, and deleted flag.',
          'Sync cursors and sync status.',
          'Encrypted search chunks for rendered meetings.',
        ],
      },
    ],
    writes: [
      {
        heading: 'In Calendly',
        items: [
          'Nothing. The connector has no Calendly write path.',
        ],
      },
      {
        heading: 'On this device',
        items: [
          'Encrypted Calendly event data and sync cursors.',
          'Encrypted search chunks with meeting title, status, start time, end time, location, join URL, invitee names, invitee emails, invitee status, and intake question answers.',
          'Last sync report counts: events fetched, events changed, invitees fetched, meetings indexed, records indexed, and cancelled.',
        ],
      },
    ],
    neverTouch: [
      'It cannot create Calendly events.',
      'It cannot cancel Calendly events.',
      'It cannot reschedule Calendly events.',
      'It cannot edit event types.',
      'It cannot edit invitees.',
      'It cannot send Calendly notifications.',
      'It cannot write to Calendly at all. The API client exposes only GET-backed methods, and its test checks that no POST, PUT, PATCH, or DELETE methods are present.',
    ],
    gating: [
      {
        label: 'Remote writes',
        detail: 'Not available.',
      },
      {
        label: 'Local imports',
        detail: 'Run only after the advisor pastes a Calendly API token and starts sync.',
      },
      {
        label: 'Client matching',
        detail:
          'Meetings are linked to clients by mapped meeting key, invitee email, or invitee name. If the match is ambiguous or missing, the meeting stays unassigned.',
      },
      {
        label: 'Receipt',
        detail:
          'The sync report records fetched events, changed events, fetched invitees, indexed meetings, indexed records, and whether the sync was cancelled.',
      },
      {
        label: 'Disconnect',
        detail:
          'Disconnect cancels sync, purges local Calendly search chunks and the encrypted Calendly database, then deletes the token only if local purge succeeds.',
      },
    ],
    limits: [
      'Calendly auth uses a Personal Access Token stored in the OS keychain.',
      'Sparse or null Calendly fields are skipped instead of failing the whole sync.',
      'The connector indexes what Calendly returns. It does not infer meeting content that is not present in the event or invitee records.',
    ],
  },
} satisfies Record<IntegrationHonestyCardId, IntegrationHonestyCard>;

export function getIntegrationHonestyCard(id: IntegrationHonestyCardId): IntegrationHonestyCard {
  return integrationHonestyCards[id];
}
