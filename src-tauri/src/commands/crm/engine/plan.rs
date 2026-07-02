use super::*;

// ---------------------------------------------------------------------------
// 3. plan_household_index  (PURE — no network, no embedding model)
// ---------------------------------------------------------------------------

/// Build the list of RAG index items for one household from the store.
///
/// This function is **pure**: it reads the store, deserialises stored JSON,
/// calls the render functions, and returns a list of [`CrmIndexItem`]s — no
/// network calls, no embedding model.  It is the offline-testable core of the
/// sync pipeline.
///
/// **Household-type contact present** (typical case): emits one household
/// summary record (`crm:household:<id>`) followed by one per-contact record
/// for each member (`crm:contact:<id>`).
///
/// **No household-type contact** (individual client): emits per-contact
/// records only.  A synthetic household summary is not generated because a
/// single-person group has no additional household-level context beyond the
/// contact record itself, and duplicating the data would confuse the RAG
/// retriever.
///
/// Notes, tasks, and events are rendered individually regardless.
#[allow(dead_code)]
pub fn plan_household_index(
    store: &CrmStore,
    grouping_key: &str,
    matter_id: &str,
) -> anyhow::Result<Vec<CrmIndexItem>> {
    let rows = store.list_objects_by_household(grouping_key)?;
    let mut items: Vec<CrmIndexItem> = Vec::new();

    // Partition rows by kind.
    let mut hh_contact: Option<CrmContact> = None;
    let mut member_contacts: Vec<CrmContact> = Vec::new();
    let mut notes: Vec<CrmNote> = Vec::new();
    let mut tasks: Vec<CrmTask> = Vec::new();
    let mut events: Vec<CrmEvent> = Vec::new();

    for row in &rows {
        // Match on a lowercased kind. `ingest` already normalises on store, but
        // normalise here too so any row stored before that fix (capitalised live
        // value) still indexes instead of being skipped.
        match row.kind.to_ascii_lowercase().as_str() {
            "household" => {
                let mut contact: CrmContact = serde_json::from_str(&row.json)?;
                apply_contact_provider(&mut contact, provider_for_store_id(&row.id));
                hh_contact = Some(contact);
            }
            "person" | "organization" | "trust" => {
                let mut contact: CrmContact = serde_json::from_str(&row.json)?;
                apply_contact_provider(&mut contact, provider_for_store_id(&row.id));
                member_contacts.push(contact);
            }
            "note" => {
                let mut note: CrmNote = serde_json::from_str(&row.json)?;
                apply_linked_object_provider(
                    &mut note.source_provider,
                    &mut note.linked_to,
                    &row.id,
                );
                notes.push(note);
            }
            "task" => {
                let mut task: CrmTask = serde_json::from_str(&row.json)?;
                apply_linked_object_provider(
                    &mut task.source_provider,
                    &mut task.linked_to,
                    &row.id,
                );
                tasks.push(task);
            }
            "event" => {
                let mut event: CrmEvent = serde_json::from_str(&row.json)?;
                apply_linked_object_provider(
                    &mut event.source_provider,
                    &mut event.linked_to,
                    &row.id,
                );
                events.push(event);
            }
            other => {
                log::warn!(
                    "plan_household_index: unknown kind '{}' for id '{}'; skipping",
                    other,
                    row.id
                );
            }
        }
    }

    // ── Household summary (when a household-type contact exists) ─────────────
    if let Some(ref hh) = hh_contact {
        let (source_id, text) = render_household_summary(hh, &member_contacts);
        items.push(CrmIndexItem {
            source_id,
            text,
            matter_id: matter_id.to_string(),
        });
    }
    // No household-type contact = individual client; per-contact records below
    // are sufficient and clearer than a synthetic one-person summary.

    // ── Per-contact records (non-household contacts only) ────────────────────
    for contact in &member_contacts {
        let (source_id, text) = render_contact(contact);
        items.push(CrmIndexItem {
            source_id,
            text,
            matter_id: matter_id.to_string(),
        });
    }

    // ── Notes ────────────────────────────────────────────────────────────────
    for note in &notes {
        let (source_id, text) = render_note(note);
        items.push(CrmIndexItem {
            source_id,
            text,
            matter_id: matter_id.to_string(),
        });
    }

    // ── Tasks ─────────────────────────────────────────────────────────────────
    for task in &tasks {
        let (source_id, text) = render_task(task);
        items.push(CrmIndexItem {
            source_id,
            text,
            matter_id: matter_id.to_string(),
        });
    }

    // ── Events ───────────────────────────────────────────────────────────────
    for event in &events {
        let (source_id, text) = render_event(event);
        items.push(CrmIndexItem {
            source_id,
            text,
            matter_id: matter_id.to_string(),
        });
    }

    Ok(items)
}

fn provider_for_store_id(store_id: &str) -> CrmRecordProvider {
    let rest = store_id
        .split_once(':')
        .map(|(_, rest)| rest)
        .unwrap_or(store_id);
    if rest.starts_with("sfdc:") {
        CrmRecordProvider::Salesforce
    } else if rest.starts_with("redtail:") {
        CrmRecordProvider::Redtail
    } else {
        CrmRecordProvider::Wealthbox
    }
}

fn apply_contact_provider(contact: &mut CrmContact, provider: CrmRecordProvider) {
    contact.source_provider = provider;
    if let Some(household) = contact.household.as_mut() {
        household.source_provider = provider;
        for member in &mut household.members {
            member.source_provider = provider;
        }
    }
}

fn apply_linked_object_provider(
    source_provider: &mut CrmRecordProvider,
    linked_to: &mut [CrmLink],
    store_id: &str,
) {
    let provider = provider_for_store_id(store_id);
    *source_provider = provider;
    for link in linked_to {
        link.source_provider = provider;
    }
}
