use super::*;

// ---------------------------------------------------------------------------
// 2. ingest
// ---------------------------------------------------------------------------

/// Fetch all objects from `source`, upsert them into `store`, and return a
/// count summary.
///
/// Contacts are grouped by household id (see module-level doc for the grouping
/// key rules).  Notes/tasks/events inherit every distinct grouping key from
/// their fetched contact links. Unresolvable objects are skipped and tallied in
/// [`IngestReport::skipped_unlinked`].
#[allow(dead_code)]
pub async fn ingest(source: &dyn CrmSource, store: &CrmStore) -> anyhow::Result<IngestReport> {
    ingest_cancellable(source, store, None)
        .await?
        .ok_or_else(|| anyhow::anyhow!("CRM ingest cancelled"))
}

/// The sync command uses this cancellable form.  A cancellation never drops a
/// request or an embedding task on the floor: it is observed at safe boundaries
/// between complete provider calls, before anything is written to the local
/// store.  The provider client's per-request timeout bounds the one request
/// that may already be in flight when cancellation is requested.
pub async fn ingest_cancellable(
    source: &dyn CrmSource,
    store: &CrmStore,
    cancel: Option<&std::sync::atomic::AtomicBool>,
) -> anyhow::Result<Option<IngestReport>> {
    use std::sync::atomic::Ordering;

    let cancelled = || cancel.is_some_and(|flag| flag.load(Ordering::SeqCst));
    if cancelled() {
        return Ok(None);
    }
    let mut report = IngestReport::default();
    let provider_id = source.provider_id();

    // Every store id we FILED this sync: contacts always; a note/task/event only when
    // its link resolves to a household. The deletion diff at the end tombstones any
    // previously-stored object that is NOT filed now — i.e. removed from Wealthbox OR
    // newly unlinkable — so neither can leave a stale chunk behind on re-sync.
    let mut seen: HashSet<String> = HashSet::new();

    // P2.3 row 7: collect every upsert and commit them (plus tombstones) in ONE
    // transaction at the end, instead of one autocommit upsert (= one fsync) per
    // object. Network fetches (the `.await`s below) all happen first; the DB work
    // is a single synchronous transaction with no awaits held across it.
    let mut upserts: Vec<CrmUpsert> = Vec::new();

    // ── 1. Contacts ──────────────────────────────────────────────────────────
    let contacts = source.list_all_contacts().await?;
    if cancelled() {
        return Ok(None);
    }

    // Build contact_id → grouping_key lookup used by note/task/event resolution.
    let mut contact_to_group: HashMap<String, String> = HashMap::with_capacity(contacts.len());
    for c in &contacts {
        let gk = c.household_key().unwrap_or_else(|| c.crm_key());
        contact_to_group.insert(c.crm_key(), gk);
    }

    for c in &contacts {
        let c_key = c.crm_key();
        let gk = contact_to_group[&c_key].clone();
        let store_id = format!("contact:{}", c_key);
        seen.insert(store_id.clone());
        let json = serde_json::to_string(c)?;
        let hash = content_hash(&json);
        // Store the kind canonicalised to lowercase. The live Wealthbox API returns
        // CAPITALISED contact types ("Household"/"Person"/"Organization"/"Trust") while
        // the whole index pipeline matches on lowercase — without this every contact
        // falls through `plan_household_index`'s `_ => skip` arm and NOTHING is embedded.
        // CrmContact has no updated_at field; use "" (content_hash drives change detection).
        upserts.push(CrmUpsert {
            id: store_id,
            kind: c.r#type.to_ascii_lowercase(),
            household_id: gk,
            updated_at: String::new(),
            content_hash: hash,
            json,
        });
        report.contacts += 1;
    }

    // ── 2. Notes ─────────────────────────────────────────────────────────────
    let notes = source.list_notes().await?;
    if cancelled() {
        return Ok(None);
    }
    for n in &notes {
        let grouping_keys = resolve_grouping_keys(&n.linked_to, &contact_to_group);
        if grouping_keys.is_empty() {
            // TODO(1B.3c): surface unlinked objects to an operator log
            report.skipped_unlinked += 1;
        } else {
            let grouping_count = grouping_keys.len();
            let crm_key = n.crm_key();
            let json = serde_json::to_string(n)?;
            let hash = content_hash(&json);
            for gk in grouping_keys {
                let store_id = linked_object_store_id("note", &crm_key, &gk, grouping_count);
                seen.insert(store_id.clone());
                upserts.push(CrmUpsert {
                    id: store_id,
                    kind: "note".to_string(),
                    household_id: gk,
                    updated_at: n.updated_at.clone(),
                    content_hash: hash.clone(),
                    json: json.clone(),
                });
                report.notes += 1;
            }
        }
    }

    // ── 3. Tasks ─────────────────────────────────────────────────────────────
    let tasks = source.list_tasks().await?;
    if cancelled() {
        return Ok(None);
    }
    for t in &tasks {
        let grouping_keys = resolve_grouping_keys(&t.linked_to, &contact_to_group);
        if grouping_keys.is_empty() {
            report.skipped_unlinked += 1;
        } else {
            let grouping_count = grouping_keys.len();
            let crm_key = t.crm_key();
            let json = serde_json::to_string(t)?;
            let hash = content_hash(&json);
            for gk in grouping_keys {
                let store_id = linked_object_store_id("task", &crm_key, &gk, grouping_count);
                seen.insert(store_id.clone());
                // CrmTask has no updated_at; use "" (content_hash drives change detection).
                upserts.push(CrmUpsert {
                    id: store_id,
                    kind: "task".to_string(),
                    household_id: gk,
                    updated_at: String::new(),
                    content_hash: hash.clone(),
                    json: json.clone(),
                });
                report.tasks += 1;
            }
        }
    }

    // ── 4. Events ────────────────────────────────────────────────────────────
    let events = source.list_events().await?;
    if cancelled() {
        return Ok(None);
    }
    for e in &events {
        let grouping_keys = resolve_grouping_keys(&e.linked_to, &contact_to_group);
        if grouping_keys.is_empty() {
            report.skipped_unlinked += 1;
        } else {
            let grouping_count = grouping_keys.len();
            let crm_key = e.crm_key();
            let json = serde_json::to_string(e)?;
            let hash = content_hash(&json);
            for gk in grouping_keys {
                let store_id = linked_object_store_id("event", &crm_key, &gk, grouping_count);
                seen.insert(store_id.clone());
                // CrmEvent has no updated_at; use "" (content_hash drives change detection).
                upserts.push(CrmUpsert {
                    id: store_id,
                    kind: "event".to_string(),
                    household_id: gk,
                    updated_at: String::new(),
                    content_hash: hash.clone(),
                    json: json.clone(),
                });
                report.events += 1;
            }
        }
    }

    // ── 5. Tombstone objects that are no longer filed ────────────────────────
    // `seen` holds everything we filed this sync. Anything still stored (deleted = 0)
    // from a previous sync but NOT in `seen` is either gone from Wealthbox OR newly
    // unlinkable (its contact link was removed) — both must stop surfacing. Soft-delete
    // it so `plan_household_index` (which filters deleted = 0) stops re-planning it and
    // its stale RAG chunk drops on the household's next delete-then-insert.
    // `upsert_object` resets deleted = 0, so an object that re-appears (or is re-linked)
    // un-tombstones itself automatically.
    //
    // P2.3 row 7: the tombstone decision is driven entirely by `seen` (what we
    // filed this sync), so it is unaffected by whether this sync's upserts have
    // landed yet — we can read the PRE-batch id set here and apply upserts +
    // tombstones together in one transaction. `list_all_object_ids` already
    // filters deleted = 0, and every object we are about to upsert is in `seen`,
    // so no id's tombstone decision changes vs the old inline-per-object order.
    let tombstone_ids: Vec<String> = store
        .list_all_object_ids()?
        .into_iter()
        .filter(|existing| {
            object_belongs_to_provider(existing, provider_id) && !seen.contains(existing)
        })
        .collect();
    report.removed_tombstoned += tombstone_ids.len() as u32;

    // Do not begin the single local transaction after a stop request.  This is
    // the final safe point before local state changes for this fetch pass.
    if cancelled() {
        return Ok(None);
    }
    store.apply_ingest_batch(&upserts, &tombstone_ids)?;

    Ok(Some(report))
}

pub(crate) fn object_belongs_to_provider(store_id: &str, provider_id: &str) -> bool {
    let Some((_, rest)) = store_id.split_once(':') else {
        return provider_id == "wealthbox";
    };
    match provider_id {
        "salesforce" => rest.starts_with("sfdc:"),
        "redtail" => rest.starts_with("redtail:"),
        "wealthbox" => !rest.starts_with("sfdc:") && !rest.starts_with("redtail:"),
        _ => false,
    }
}

/// Walk `linked_to`, returning every distinct grouping key from **contact-typed**
/// entries whose ids map to known contacts.
///
/// The `r#type` check is mandatory for correctness: a note/task/event can
/// also be linked to a project or opportunity, and if a project's numeric id
/// happens to collide with a contact's id the record would be silently
/// mis-filed into the wrong household — a confidentiality bug.  Only entries
/// with `r#type == "Contact"` (case-insensitive) are eligible for lookup.
fn resolve_grouping_keys(
    linked_to: &[CrmLink],
    contact_to_group: &HashMap<String, String>,
) -> Vec<String> {
    let mut grouping_keys = Vec::new();
    let mut seen = HashSet::new();
    for link in linked_to {
        // Guard: only contact-typed links may resolve a household grouping key.
        // Non-contact links (Project, Opportunity, …) are ignored even when
        // their numeric id happens to match a known contact id.
        if link.r#type.eq_ignore_ascii_case("contact") {
            if let Some(gk) = contact_to_group.get(&link.crm_key()) {
                if seen.insert(gk.clone()) {
                    grouping_keys.push(gk.clone());
                }
            }
        }
    }
    grouping_keys
}

fn linked_object_store_id(
    kind: &str,
    crm_key: &str,
    grouping_key: &str,
    grouping_count: usize,
) -> String {
    if grouping_count <= 1 {
        format!("{kind}:{crm_key}")
    } else {
        format!("{kind}:{crm_key}@{grouping_key}")
    }
}
