use super::*;

/// Drop every row whose `path` matches. Used by the watcher when a file
/// is deleted from the workspace.
///
/// VG-6e: takes the PLAINTEXT path plus the vector master `key` and computes
/// the stored token internally — callers never handle tokens.
pub async fn delete_path(table: &Table, path: &str, key: &[u8; 32]) -> Result<()> {
    delete_by_token(table, &super::super::crypto::path_token(key, path)).await
}

/// Delete every row whose stored `path` column equals `token` (an HMAC path
/// token). Used by the boot reconcile to purge a DELETED file's rows when only
/// its manifest key — the token — is known (the plaintext path is gone from
/// disk). The token must be the SAME one the rows were written under
/// (`path_token(key, path)` over the exact path string used at index time), so
/// callers that hold a path use `delete_path`; the reconcile holds the token
/// directly. P1.1: keeps the deleted-file purge correct on Windows, where the
/// stored token is over a backslash path and normalization would mismatch.
pub async fn delete_by_token(table: &Table, token: &str) -> Result<()> {
    let _write = acquire_write_access(table).await?;
    let predicate = format!("path = '{}'", sql_escape(token));
    table
        .delete(&predicate)
        .await
        .context("delete by path token failed")?;
    Ok(())
}

/// BUG-040: purge EVERY chunk belonging to a matter, regardless of which file
/// or mail folder it came from. Used when a matter is deleted so its content
/// can no longer surface through all-matters retrieval (which applies no matter
/// filter). `matter_id` is the plaintext, queryable confidentiality-scope column
/// (see the schema notes above), so we filter on it directly — validated +
/// SQL-escaped to keep the predicate safe. Deleting `UNASSIGNED_MATTER` is
/// refused: it would wipe every uncategorized chunk in the workspace.
pub async fn delete_matter(table: &Table, matter_id: &str) -> Result<()> {
    let _write = acquire_write_access(table).await?;
    let matter_id = validate_matter_id(matter_id)?;
    if matter_id == UNASSIGNED_MATTER {
        anyhow::bail!("refusing to delete the UNASSIGNED_MATTER bucket");
    }
    let predicate = format!("matter_id = '{}'", sql_escape(matter_id));
    table
        .delete(&predicate)
        .await
        .with_context(|| format!("delete failed for matter {}", matter_id))?;
    Ok(())
}

/// Delete every chunk with the given source_type (e.g. "crm"). Used to purge
/// an external connector's imported data when the user disconnects it.
pub async fn delete_source_type(table: &Table, source_type: &str) -> Result<()> {
    let _write = acquire_write_access(table).await?;
    let predicate = format!("source_type = '{}'", sql_escape(source_type));
    table
        .delete(&predicate)
        .await
        .with_context(|| format!("delete failed for source_type {}", source_type))?;
    Ok(())
}

/// List the DISTINCT plaintext source ids currently indexed under `source_type`.
///
/// The queryable `source_id` column is tokenized (VG-6e), so this scans matching
/// rows and decrypts each `path_enc` (the encrypted plaintext path, which equals
/// the source id by construction) in memory. Store-less connectors (e.g. Addepar,
/// which re-fetches everything each sync and keeps no local record table) use this
/// to find chunks whose remote source has vanished, so they can be pruned. The
/// returned ids are plaintext and can be passed straight to [`delete_path`].
pub async fn list_external_source_ids(
    table: &Table,
    source_type: &str,
    key: &[u8; 32],
) -> Result<Vec<String>> {
    use futures_util::TryStreamExt;

    let predicate = format!("source_type = '{}'", sql_escape(source_type));
    let mut stream = table
        .query()
        .only_if(&predicate)
        .select(Select::columns(&["path_enc"]))
        .execute()
        .await
        .context("list_external_source_ids query execute failed")?;

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    while let Some(batch) = stream
        .try_next()
        .await
        .context("list_external_source_ids stream try_next failed")?
    {
        let path_enc_col = batch
            .column_by_name("path_enc")
            .context("missing path_enc column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("path_enc column is not StringArray")?;
        for i in 0..batch.num_rows() {
            if path_enc_col.is_null(i) {
                continue;
            }
            let plain = decrypt_path_enc_for_provider_scan(path_enc_col.value(i), key)?;
            if seen.insert(plain.clone()) {
                out.push(plain);
            }
        }
    }
    Ok(out)
}

/// Build the predicate for [`delete_crm_for_matters`]: delete every CRM chunk
/// whose matter is in `matter_ids`, in ONE clause. Returns `None` for an empty
/// list (nothing to delete). Pure + SQL-escaped so it is unit-testable without a
/// table.
pub(crate) fn crm_delete_predicate(matter_ids: &[String]) -> Option<String> {
    if matter_ids.is_empty() {
        return None;
    }
    let list = matter_ids
        .iter()
        .map(|m| format!("'{}'", sql_escape(m)))
        .collect::<Vec<_>>()
        .join(", ");
    Some(format!("source_type = 'crm' AND matter_id IN ({list})"))
}

fn crm_provider_scan_predicate(matter_ids: Option<&[String]>) -> Option<String> {
    match matter_ids {
        Some(ids) => crm_delete_predicate(ids),
        None => Some("source_type = 'crm'".to_string()),
    }
}

pub(crate) fn crm_source_id_belongs_to_provider(source_id: &str, provider_id: &str) -> bool {
    crate::commands::crm::model::crm_source_id_belongs_to_provider(source_id, provider_id)
}

fn decrypt_path_enc_for_provider_scan(path_enc: &str, key: &[u8; 32]) -> Result<String> {
    let blob = hex::decode(path_enc).context("decode crm path_enc")?;
    let plaintext = crate::commands::mail::crypto::decrypt_with_key(&blob, key)
        .context("decrypt crm path_enc")?;
    String::from_utf8(plaintext).context("crm path_enc was not utf8")
}

async fn list_crm_provider_entries(
    table: &Table,
    matter_ids: Option<&[String]>,
    provider_id: &str,
    key: &[u8; 32],
) -> Result<Vec<(String, String)>> {
    use futures_util::TryStreamExt;

    let Some(predicate) = crm_provider_scan_predicate(matter_ids) else {
        return Ok(Vec::new());
    };

    let mut stream = table
        .query()
        .only_if(&predicate)
        .select(Select::columns(&["matter_id", "source_id", "path_enc"]))
        .execute()
        .await
        .context("list_crm_provider_entries query execute failed")?;

    let mut out = Vec::new();
    while let Some(batch) = stream
        .try_next()
        .await
        .context("list_crm_provider_entries stream try_next failed")?
    {
        let matter_col = batch
            .column_by_name("matter_id")
            .context("missing matter_id column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("matter_id column is not StringArray")?;
        let source_col = batch
            .column_by_name("source_id")
            .context("missing source_id column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("source_id column is not StringArray")?;
        let path_enc_col = batch
            .column_by_name("path_enc")
            .context("missing path_enc column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("path_enc column is not StringArray")?;

        for i in 0..batch.num_rows() {
            if matter_col.is_null(i) || source_col.is_null(i) || path_enc_col.is_null(i) {
                continue;
            }
            let plain_source_id = decrypt_path_enc_for_provider_scan(path_enc_col.value(i), key)?;
            if crm_source_id_belongs_to_provider(&plain_source_id, provider_id) {
                out.push((
                    matter_col.value(i).to_string(),
                    source_col.value(i).to_string(),
                ));
            }
        }
    }

    Ok(out)
}

/// Delete every CRM chunk belonging to any of `matter_ids` in a SINGLE table
/// delete (one scan + commit + compaction), instead of one delete per source id.
///
/// Scoped to `source_type = 'crm'` so the file/mail chunks of a *merged* household
/// (a matter that has both files and CRM data) are preserved. A first sync matches
/// nothing and returns quickly; an empty list is a no-op.
///
/// This replaces the per-item `delete_path` loop the CRM backfill used to run: on a
/// ~40-household / ~200-item first sync that issued ~200 sequential full-table
/// deletes — each a scan + commit + compaction, all no-ops on a first sync — and
/// never completed (the hang the bench observed).
///
/// `backfill` calls this **per matter** (a one-element `matter_ids`), right after the
/// cancel check, as the delete half of a delete-then-insert (NOT a real transaction —
/// LanceDB gives none here; cancel is checked before the delete so a Stop leaves the
/// matter unchanged). One scoped delete per matter (not per item, not per household) is
/// what removed the churn. The slice form is kept so the same primitive can clear
/// several matters at once (e.g. the empty-map / orphan purge).
pub async fn delete_crm_for_matters(table: &Table, matter_ids: &[String]) -> Result<()> {
    let _write = acquire_write_access(table).await?;
    let Some(predicate) = crm_delete_predicate(matter_ids) else {
        return Ok(());
    };
    table
        .delete(&predicate)
        .await
        .context("delete failed for crm matters")?;
    Ok(())
}

/// Delete CRM chunks for the selected matters, scoped to one CRM provider.
///
/// The queryable `source_id` column is tokenized, so this scans matching CRM
/// rows, decrypts `path_enc` in memory, classifies the plaintext source id
/// (`sfdc:` = Salesforce, no provider prefix = Wealthbox), then deletes only
/// the matching source-id tokens. This is the multi-CRM safety boundary: a
/// Salesforce sync can replace Salesforce chunks without touching Wealthbox
/// chunks that live under the same matter.
pub async fn delete_crm_for_matters_for_provider(
    table: &Table,
    matter_ids: &[String],
    provider_id: &str,
    key: &[u8; 32],
) -> Result<()> {
    if matter_ids.is_empty() {
        return Ok(());
    }
    let _write = acquire_write_access(table).await?;
    let entries = list_crm_provider_entries(table, Some(matter_ids), provider_id, key).await?;
    let source_tokens: HashSet<String> = entries.into_iter().map(|(_, token)| token).collect();
    if source_tokens.is_empty() {
        return Ok(());
    }

    let matter_list = matter_ids
        .iter()
        .map(|m| format!("'{}'", sql_escape(m)))
        .collect::<Vec<_>>()
        .join(", ");
    let source_list = source_tokens
        .iter()
        .map(|s| format!("'{}'", sql_escape(s)))
        .collect::<Vec<_>>()
        .join(", ");
    let predicate = format!(
        "source_type = 'crm' AND matter_id IN ({matter_list}) AND source_id IN ({source_list})"
    );
    table
        .delete(&predicate)
        .await
        .context("delete failed for provider-scoped crm matters")?;
    Ok(())
}

/// Return the set of distinct `matter_id`s that currently have at least one CRM
/// chunk. ONE column-only scan (`matter_id` is the plaintext, queryable scope
/// column — no decryption needed). The CRM backfill uses this to (a) skip the
/// stale-chunk delete for a matter that has no chunks yet — a first sync's deletes
/// are all no-ops, and avoiding them removes their commit + compaction churn — and
/// (b) find matters that still have CRM chunks but are no longer being synced
/// (a household re-linked elsewhere), so their orphaned chunks can be purged.
pub async fn list_crm_matters(table: &Table) -> Result<HashSet<String>> {
    use futures_util::TryStreamExt;
    let mut stream = table
        .query()
        .only_if("source_type = 'crm'")
        .select(Select::columns(&["matter_id"]))
        .execute()
        .await
        .context("list_crm_matters query execute failed")?;

    let mut out = HashSet::new();
    while let Some(batch) = stream
        .try_next()
        .await
        .context("list_crm_matters stream try_next failed")?
    {
        let col = batch
            .column_by_name("matter_id")
            .context("missing matter_id column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("matter_id column is not StringArray")?;
        for i in 0..col.len() {
            if !col.is_null(i) {
                out.insert(col.value(i).to_string());
            }
        }
    }
    Ok(out)
}

/// Return distinct matters that currently have CRM chunks for one provider.
/// See [`delete_crm_for_matters_for_provider`] for why provider detection uses
/// decrypted `path_enc` instead of searching the tokenized `source_id` column.
pub async fn list_crm_matters_for_provider(
    table: &Table,
    provider_id: &str,
    key: &[u8; 32],
) -> Result<HashSet<String>> {
    let entries = list_crm_provider_entries(table, None, provider_id, key).await?;
    Ok(entries.into_iter().map(|(matter, _)| matter).collect())
}
