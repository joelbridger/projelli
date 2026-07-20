# Calendly Integration Honesty Card

Last verified: 2026-07-10

Status: Shipping

This connector reads scheduled Calendly meetings and invitees into Advisor Prep Hero. It does not change Calendly.

## What this connector reads

From Calendly:

- Current user: `uri`, `name`, `email`, and `current_organization`.
- Scheduled events: `uri`, `name`, `status`, `start_time`, `end_time`, `created_at`, `updated_at`, `location`, and `event_type`.
- Event location: `type`, `location`, and `join_url`.
- Invitees: `uri`, `name`, `email`, `status`, `created_at`, `updated_at`, and `questions_and_answers`.
- Invitee question answers: `question` and `answer`.
- Pagination: `count`, `next_page`, and `next_page_token`.

On this device:

- The Calendly API token and user URI in the OS keychain.
- Encrypted event rows: id, uuid, event URI, content hash, raw event-plus-invitees JSON, indexed hash, client id, and deleted flag.
- Sync cursors and sync status.
- Encrypted search chunks for rendered meetings.

## What this connector writes

In Calendly:

- Nothing. The connector has no Calendly write path.

On this device:

- Encrypted Calendly event data and sync cursors.
- Encrypted search chunks with meeting title, status, start time, end time, location, join URL, invitee names, invitee emails, invitee status, and intake question answers.
- Last sync report counts: events fetched, events changed, invitees fetched, meetings indexed, records indexed, and cancelled.

## What this connector can never touch

- It cannot create Calendly events.
- It cannot cancel Calendly events.
- It cannot reschedule Calendly events.
- It cannot edit event types.
- It cannot edit invitees.
- It cannot send Calendly notifications.
- It cannot write to Calendly at all. The API client exposes only GET-backed methods, and its test checks that no POST, PUT, PATCH, or DELETE methods are present.

## How writes are gated

- Remote writes: Not available.
- Local imports: Run only after the advisor pastes a Calendly API token and starts sync.
- Client matching: Meetings are linked to clients by mapped meeting key, invitee email, or invitee name. If the match is ambiguous or missing, the meeting stays unassigned.
- Receipt: The sync report records fetched events, changed events, fetched invitees, indexed meetings, indexed records, and whether the sync was cancelled.
- Disconnect: Disconnect cancels sync, purges local Calendly search chunks and the encrypted Calendly database, then deletes the token only if local purge succeeds.

## Limits worth knowing

- Calendly auth uses a Personal Access Token stored in the OS keychain.
- Sparse or null Calendly fields are skipped instead of failing the whole sync.
- The connector indexes what Calendly returns. It does not infer meeting content that is not present in the event or invitee records.

<!--
Evidence:
- src/features/calendly/README.md
- src-tauri/src/commands/calendly/client.rs
- src-tauri/src/commands/calendly/commands.rs
- src-tauri/src/commands/calendly/engine.rs
- src-tauri/src/commands/calendly/model.rs
- src-tauri/src/commands/calendly/render.rs
- src-tauri/src/commands/calendly/source.rs
- src-tauri/src/commands/calendly/store.rs
-->
