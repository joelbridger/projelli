# Wealthbox Integration Honesty Card

Last verified: 2026-07-10

Status: Shipping

This connector brings Wealthbox client records into Advisor Prep Hero and can write back only a small set of advisor-approved updates.

## What this connector reads

From Wealthbox:

- `me`: account validation for the pasted API token.
- `contacts` and `households`: `id`, `external_id`, `type`, `name`, `first_name`, `middle_name`, `last_name`, `nickname`, `prefix`, `suffix`, `company_name`, `job_title`, `birth_date`, `anniversary`, `client_since`, `retirement_date`, `date_of_death`, `marital_status`, `contact_type`, `status`, `background_information`, `important_information`, `personal_interests`, `investment_objective`, `investment_time_horizon`, `investment_risk_tolerance`, `gross_annual_income`, `assets`, `non_liquid_assets`, `liabilities`, `adjusted_gross_income`, `tax_bracket`, `tax_year`, professional relationship ids, `street_addresses`, `email_addresses`, `phone_numbers`, `household`, `tags`, and `contact_roles`.
- `notes`: `id`, `external_id`, `created_at`, `updated_at`, `content`, and `linked_to`.
- `tasks`: `id`, `external_id`, `name`, `due_date`, `complete`, `priority`, `description`, `created_at`, `updated_at`, and `linked_to`.
- `events`: `id`, `external_id`, `title`, `starts_at`, `ends_at`, `all_day`, `location`, `description`, and `linked_to`.
- Category, user, and team labels used to make synced records readable.
- Deleted contact ids, so Advisor Prep Hero can remove stale local CRM rows.

On this device:

- The connector stores synced CRM JSON, source ids, hashes, linked client ids, and write receipts in an encrypted local database.
- The connector indexes mapped client records into the local encrypted search index.

## What this connector writes

In Wealthbox:

- `notes`: creates a note with `content` and `linked_to: [{ id: contact_id, type: "Contact" }]`.
- `tasks`: creates a task with `name`, `description`, `due_date`, and `linked_to: [{ id: contact_id, type: "Contact" }]`.
- `contacts`: updates only the allowlisted field `background_information`.

On this device:

- Write queue items: proposed note, task, or field update, requested time, source reference, status, and remote receipt.
- Write ledger rows: dedup key, write kind, status, remote id, created time, and updated time.
- Audit entries for approved writes, stale blocked writes, pending verification, and remote receipts.

## What this connector can never touch

- It does not read or write Wealthbox passport number, green card number, or driver's license fields. Those fields are intentionally omitted from the data model.
- It has no Wealthbox delete path.
- It has no write path for Redtail or Salesforce.
- It does not write notes, tasks, or field updates from sync, timers, page load, or AI generation alone.
- It does not write any contact field except `background_information`.
- It does not file notes, tasks, or events to a client unless their Wealthbox `linked_to` target resolves to a contact household.

## How writes are gated

- Review card: Wealthbox writes appear in the CRM write review card inside the client view.
- Approval action: Nothing is sent until the advisor clicks Approve for selected items.
- Receipt: Successful writes store the Wealthbox remote id. Deduped writes store the prior remote id. Audit entries record the approved action without logging private note bodies as diagnostics.
- Field safety: Before a field update is sent, Advisor Prep Hero re-fetches the live Wealthbox value. If the value changed, the write is blocked and the advisor must review again.
- Background behavior: Background CRM sync reads Wealthbox and updates local encrypted data. It cannot write remotely.

## Limits worth knowing

- Wealthbox tasks require a due date.
- AI-drafted notes get a provenance line before approval, so the Wealthbox note says it was AI-drafted and advisor-approved.
- `source_ref` is used locally for traceability. It is never sent to Wealthbox.

<!--
Evidence:
- src/features/crm/README.md
- src/features/matters/CrmWriteReviewCard.tsx
- src/features/matters/crmProvenance.ts
- src/platform/state/crmWriteQueueStore.ts
- src/platform/utils/wealthbox-commands.ts
- src-tauri/src/commands/crm/client.rs
- src-tauri/src/commands/crm/commands.rs
- src-tauri/src/commands/crm/engine/ingest.rs
- src-tauri/src/commands/crm/engine/index.rs
- src-tauri/src/commands/crm/model.rs
- src-tauri/src/commands/crm/render.rs
- src-tauri/src/commands/crm/source.rs
- src-tauri/src/commands/crm/store.rs
- src-tauri/src/commands/crm/write.rs
-->
