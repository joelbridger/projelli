use super::*;
use arrow_array::UInt64Array;
use futures_util::TryStreamExt;

/// BEFORE the atomic `merge_insert` runs, collapse any rows that are ALREADY
/// duplicated under the same `id` on disk (P2 finding: LanceDB documents
/// `merge_insert` behavior on multiple matches as undefined — when a pre-existing
/// duplicate `id` matches the join, `when_matched_update_all` updates EVERY
/// matching row instead of collapsing them, so a corrupt id stays duplicated
/// forever across every future re-index).
///
/// ORDERING (F1): this runs BEFORE the merge, never after. Any fallible work
/// AFTER a committed merge turns a SUCCEEDED content swap into a hidden file — a
/// transient failure would make the whole command return Err, and the caller's
/// fail-closed path (indexing.rs) would durably tombstone the freshly-written
/// path, making the file vanish from search until a later re-index. Recreating
/// exactly the disappearing-file symptom this branch exists to kill. Run here
/// instead: if the cleanup fails, the content is UNTOUCHED (old rows still
/// serve retrieval) and the error is honest — a genuine, complete failure, not
/// a partial success. Combined with the incoming-id uniqueness check, no
/// post-merge dedup is needed: a deduped table plus a unique incoming batch
/// cannot produce a duplicate id.
///
/// Scoped to `path_predicate` — the same token-scoped predicate the caller
/// already builds — so this only ever scans/touches the one file's rows.
///
/// No retrieval gap: the duplicated rows all hold the CURRENT (pre-swap)
/// content, so deleting the N-1 excess copies by `_rowid` (never by `id`) in a
/// SINGLE delete commit always leaves at least one row for the id alive holding
/// that content — a reader can never land on a version where the id is missing.
/// The subsequent atomic merge then swaps the surviving row to the new content.
async fn dedup_duplicate_ids_for_path(table: &Table, path_predicate: &str) -> Result<()> {
    let mut stream = table
        .query()
        .only_if(path_predicate)
        .with_row_id()
        .select(Select::columns(&["id"]))
        .execute()
        .await
        .context("dedup scan failed")?;

    let mut seen: HashSet<String> = HashSet::new();
    let mut extra_row_ids: Vec<u64> = Vec::new();
    while let Some(batch) = stream
        .try_next()
        .await
        .context("dedup scan stream failed")?
    {
        let id_col = batch
            .column_by_name("id")
            .context("dedup scan missing id column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("dedup scan id column is not StringArray")?;
        let rowid_col = batch
            .column_by_name("_rowid")
            .context("dedup scan missing _rowid column")?
            .as_any()
            .downcast_ref::<UInt64Array>()
            .context("dedup scan _rowid column is not UInt64Array")?;
        for i in 0..batch.num_rows() {
            let id = id_col.value(i).to_string();
            let row_id = rowid_col.value(i);
            if !seen.insert(id) {
                extra_row_ids.push(row_id);
            }
        }
    }

    if extra_row_ids.is_empty() {
        return Ok(());
    }

    let list = extra_row_ids
        .iter()
        .map(|r| r.to_string())
        .collect::<Vec<_>>()
        .join(", ");
    table
        .delete(&format!("_rowid IN ({list})"))
        .await
        .context("dedup delete of duplicate rows failed")?;
    Ok(())
}

/// F2 defense-in-depth: the atomic `merge_insert` keys on `id`, and LanceDB's
/// behavior on duplicate SOURCE ids is undefined — the merge would then update
/// in place and the pre-merge dedup can't help (it only collapses rows already
/// on disk, not duplicates arriving IN the batch), so all-but-one incoming copy
/// is silently lost. Chunk-id generation upstream (chunk_id = path +
/// paragraph_index band) is supposed to make in-batch collisions impossible,
/// but a bug there (e.g. a PDF page overflowing its band) must fail LOUDLY here
/// rather than silently drop a chunk. Validates the exact `id` column the merge
/// will key on, across every batch of the incoming source.
fn ensure_unique_incoming_ids(batches: &[RecordBatch], path: &str) -> Result<()> {
    let mut seen: HashSet<String> = HashSet::new();
    for batch in batches {
        let id_col = batch
            .column_by_name("id")
            .context("id-uniqueness check: batch missing id column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("id-uniqueness check: id column is not StringArray")?;
        for i in 0..id_col.len() {
            let id = id_col.value(i);
            if !seen.insert(id.to_string()) {
                anyhow::bail!(
                    "duplicate incoming chunk id for {} — refusing merge_insert \
                     (undefined on duplicate source ids); this indicates a chunk-id \
                     banding overflow upstream",
                    path
                );
            }
        }
    }
    Ok(())
}

pub fn build_batch(
    rows: &[(Chunk, Vec<f32>)],
    source_type: SourceType,
    matter_id: &str,
    privilege: &str,
    extraction: Option<(&str, f32)>,
    key: &[u8; 32],
) -> Result<RecordBatch> {
    use crate::commands::mail::crypto::encrypt_with_key;

    let schema = build_schema();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let ids: Vec<String> = rows
        .iter()
        .map(|(c, _)| chunk_id(&c.path, c.paragraph_index))
        .collect();
    let para_idx: Vec<u32> = rows.iter().map(|(c, _)| c.paragraph_index).collect();
    let timestamps: Vec<i64> = vec![now; rows.len()];

    // WS-VEC: encrypt each chunk's text at rest; store as a hex blob in the text
    // column. Embeddings (the `vector` column) are computed from plaintext by the
    // caller and stay unencrypted because LanceDB needs queryable floats for
    // similarity. They are local derived data, not document text, but they are not
    // currently tied to the encrypted-vault lock lifecycle. Pre-scale decision:
    // either lock/wipe/rebuild vectors with the vault, or market them plainly as a
    // local derived index protected by device security. Do not imply vault lock
    // covers vectors until that lifecycle is implemented.
    // Propagate encrypt errors (never silently store an empty string with
    // encrypted=true, which would be a permanently-unrecoverable chunk).
    let mut encrypted_texts: Vec<String> = Vec::with_capacity(rows.len());
    for (c, _) in rows.iter() {
        let blob = encrypt_with_key(c.text.as_bytes(), key)
            .map_err(|e| anyhow::anyhow!("encrypt chunk {}: {e}", c.path))?;
        encrypted_texts.push(hex::encode(&blob));
    }

    // VG-6e: the queryable path/source_id columns carry the deterministic
    // keyed token; the real path is encrypted into path_enc (same key, same
    // wire format as the text column). Plaintext paths are NEVER written.
    // P2.3 row 3: token + ciphertext computed once per distinct path.
    let (path_tokens, path_encs) = path_token_and_enc_columns(rows, key)?;

    let vectors = FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
        rows.iter()
            .map(|(_, v)| Some(v.iter().copied().map(Some).collect::<Vec<_>>())),
        EMBEDDING_DIM as i32,
    );

    let id_arr = StringArray::from_iter_values(ids.iter().map(|s| s.as_str()));
    let path_arr = StringArray::from_iter_values(path_tokens.iter().map(|s| s.as_str()));
    // WS-B/C: matter_id (one value, all rows) + source_id (== path per row —
    // VG-6e: both columns hold the token).
    let matter_arr = StringArray::from(vec![matter_id; rows.len()]);
    let src_arr = StringArray::from_iter_values(path_tokens.iter().map(|s| s.as_str()));
    let penc_arr = StringArray::from_iter_values(path_encs.iter().map(|s| s.as_str()));
    let pi_arr = UInt32Array::from(para_idx);
    let text_arr = StringArray::from_iter_values(encrypted_texts.iter().map(|s| s.as_str()));
    let ts_arr = Int64Array::from(timestamps);

    // A3 columns — source_type and page_number.
    let (st_str, pn_val): (&str, u32) = match source_type {
        SourceType::Text => ("text", 0),
        SourceType::Pdf { page_number } => ("pdf", page_number),
        // VG-2b — office documents. docx/rtf band like text; xlsx/pptx put
        // their REAL 1-based sheet/slide number in page_number (the citation
        // label "sheet N" / "slide N" reads it back).
        SourceType::Docx => ("docx", 0),
        SourceType::Rtf => ("rtf", 0),
        SourceType::Xlsx { sheet_number } => ("xlsx", sheet_number),
        SourceType::Pptx { slide_number } => ("pptx", slide_number),
        // VG-3c — certified transcripts: page_number carries the group's
        // locator start page (the per-row "Tr. p:l-p:l" detail lives in the
        // `locator` column below).
        SourceType::Transcript { start_page } => ("transcript", start_page),
        // Mail chunks MUST go through build_batch_mail so source_type = "mail".
        // Fail loudly — this is a programmer error on a code-chosen enum, never
        // data-driven.
        SourceType::Mail => unreachable!("mail chunks must use build_batch_mail, not build_batch"),
        // CRM chunks MUST go through build_batch_crm so source_type = "crm".
        SourceType::Crm => unreachable!("crm chunks must use build_batch_crm, not build_batch"),
    };
    let st_arr = StringArray::from(vec![st_str; rows.len()]);
    let pn_arr = UInt32Array::from(vec![pn_val; rows.len()]);

    // WS-VEC: encrypted = true — the text column holds ciphertext, not plaintext.
    let enc_arr = arrow_array::BooleanArray::from(vec![true; rows.len()]);

    // WS-PRIV: validate the privilege value (defence-in-depth) before it is
    // written to every row. An invalid value fails the build loudly rather than
    // persisting an unscopeable privilege string.
    let privilege = validate_privilege(privilege)?;
    let priv_arr = StringArray::from(vec![privilege; rows.len()]);

    // VG-2: extraction disclosure — one value for the whole batch (callers
    // group OCR pages separately), null on every native batch.
    let ext_arr = StringArray::from(vec![extraction.map(|(kind, _)| kind); rows.len()]);
    let conf_arr =
        arrow_array::Float32Array::from(vec![extraction.map(|(_, conf)| conf); rows.len()]);

    // VG-3c: the page:line locator is PER ROW — each transcript chunk carries
    // its own range; every non-transcript chunk writes null.
    let loc_arr = StringArray::from(
        rows.iter()
            .map(|(c, _)| c.locator.as_deref())
            .collect::<Vec<Option<&str>>>(),
    );

    let batch = RecordBatch::try_new(
        schema,
        vec![
            Arc::new(id_arr),
            Arc::new(path_arr),
            Arc::new(matter_arr),
            Arc::new(src_arr),
            Arc::new(pi_arr),
            Arc::new(text_arr),
            Arc::new(vectors),
            Arc::new(ts_arr),
            Arc::new(st_arr),
            Arc::new(pn_arr),
            Arc::new(enc_arr),
            Arc::new(priv_arr),
            Arc::new(ext_arr),
            Arc::new(conf_arr),
            Arc::new(loc_arr),
            Arc::new(penc_arr),
        ],
    )
    .context("RecordBatch::try_new failed for chunks batch")?;
    Ok(batch)
}

/// Build a RecordBatch for mail chunks. The `text` column contains
/// hex-encoded AES-256-GCM ciphertext (encrypt_with_key). Embeddings are
/// computed from plaintext (already passed in as `rows`). `encrypted = true`.
///
/// WS-VEC: `key` is the dedicated vector-store master key (`crypto.rs`), the
/// SAME key `build_batch` uses for text/pdf chunks — so the whole `chunks` table
/// decrypts under one key. (Pre-WS-VEC this was the mail key and only mail was
/// encrypted; the version-5 migration re-indexes mail chunks under the vector
/// key.) The mail BODY's canonical encrypted copy still lives in the mail store
/// under the mail key; this is the RAG-derived copy.
///
/// WS-B/C: `matter_id` is the confidentiality scope key (NON-NULL) written to
/// every row. `source_id` is the chunk's `path` — for mail this is the
/// "mail:<message-id>" key, the resolvable source for the citation contract.
///
/// WS-PRIV: `privilege` is the litigation-safety status (NON-NULL) written to
/// every row. Privileged mail (e.g. a client communication) is excluded from
/// retrieval by default, just like a privileged document.
pub fn build_batch_mail(
    rows: &[(Chunk, Vec<f32>)],
    key: &[u8; 32],
    matter_id: &str,
    privilege: &str,
) -> Result<RecordBatch> {
    use crate::commands::mail::crypto::encrypt_with_key;

    let schema = build_schema();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let ids: Vec<String> = rows
        .iter()
        .map(|(c, _)| chunk_id(&c.path, c.paragraph_index))
        .collect();
    let para_idx: Vec<u32> = rows.iter().map(|(c, _)| c.paragraph_index).collect();
    let timestamps = vec![now; rows.len()];

    // Encrypt each chunk's text; store as hex string in the text column.
    // The embedding was computed from plaintext (passed in `rows`) and is stored unencrypted.
    //
    // S2: Propagate encrypt errors — an unwrap_or_default() here would silently
    // store an empty string with encrypted=true, producing a permanently-
    // unrecoverable chunk. Instead, return Err so the caller sees the failure.
    let mut encrypted_texts: Vec<String> = Vec::with_capacity(rows.len());
    for (c, _) in rows.iter() {
        let blob = encrypt_with_key(c.text.as_bytes(), key)
            .map_err(|e| anyhow::anyhow!("encrypt mail chunk {}: {e}", c.path))?;
        encrypted_texts.push(hex::encode(&blob));
    }

    // VG-6e: same tokenization as build_batch — a "mail:<id>" key on disk is a
    // re-identification surface exactly like a file path (message ids tie back
    // to mailbox provider records), so it gets the same token + path_enc pair.
    // P2.3 row 3: token + ciphertext computed once per distinct path.
    let (path_tokens, path_encs) = path_token_and_enc_columns(rows, key)?;

    let vectors = FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
        rows.iter()
            .map(|(_, v)| Some(v.iter().copied().map(Some).collect::<Vec<_>>())),
        EMBEDDING_DIM as i32,
    );

    let id_arr = StringArray::from_iter_values(ids.iter().map(|s| s.as_str()));
    let path_arr = StringArray::from_iter_values(path_tokens.iter().map(|s| s.as_str()));
    // WS-B/C: matter_id (one value, all rows) + source_id (== path = "mail:<id>"
    // — VG-6e: both columns hold the token).
    let matter_arr = StringArray::from(vec![matter_id; rows.len()]);
    let src_arr = StringArray::from_iter_values(path_tokens.iter().map(|s| s.as_str()));
    let penc_arr = StringArray::from_iter_values(path_encs.iter().map(|s| s.as_str()));
    let pi_arr = UInt32Array::from(para_idx);
    let text_arr = StringArray::from_iter_values(encrypted_texts.iter().map(|s| s.as_str()));
    let ts_arr = Int64Array::from(timestamps);
    let st_arr = StringArray::from(vec!["mail"; rows.len()]);
    let pn_arr = UInt32Array::from(vec![0u32; rows.len()]);
    // G4: encrypted = true — the text column holds ciphertext, not plaintext.
    let enc_arr = arrow_array::BooleanArray::from(vec![true; rows.len()]);
    // WS-PRIV: validate + write the privilege value to every mail row.
    let privilege = validate_privilege(privilege)?;
    let priv_arr = StringArray::from(vec![privilege; rows.len()]);
    // VG-2: mail is never OCR-extracted — extraction columns stay null.
    let ext_arr = StringArray::from(vec![None::<&str>; rows.len()]);
    let conf_arr = arrow_array::Float32Array::from(vec![None::<f32>; rows.len()]);
    // VG-3c: mail never carries a page:line locator.
    let loc_arr = StringArray::from(vec![None::<&str>; rows.len()]);

    RecordBatch::try_new(
        schema,
        vec![
            Arc::new(id_arr),
            Arc::new(path_arr),
            Arc::new(matter_arr),
            Arc::new(src_arr),
            Arc::new(pi_arr),
            Arc::new(text_arr),
            Arc::new(vectors),
            Arc::new(ts_arr),
            Arc::new(st_arr),
            Arc::new(pn_arr),
            Arc::new(enc_arr),
            Arc::new(priv_arr),
            Arc::new(ext_arr),
            Arc::new(conf_arr),
            Arc::new(loc_arr),
            Arc::new(penc_arr),
        ],
    )
    .context("RecordBatch::try_new failed for mail chunks batch")
}

/// Build a RecordBatch for CRM chunks. Mirrors `build_batch_mail` exactly —
/// the `text` column holds hex-encoded AES-256-GCM ciphertext, `source_type`
/// is written as `"crm"`, and `encrypted = true`. Used by the Wealthbox
/// connector (Phase 1A) to persist per-object records and household summaries.
///
/// WS-VEC: `key` is the vector-store master key — the same key used by every
/// other batch builder, so the whole `chunks` table decrypts under one key.
///
/// WS-B/C: `matter_id` is the confidentiality scope key (NON-NULL) written to
/// every row. `source_id` is formatted as `crm:<kind>:<id>` by the caller.
///
/// WS-PRIV: `privilege` is the litigation-safety status (NON-NULL) written to
/// every row.
pub fn build_batch_crm(
    rows: &[(Chunk, Vec<f32>)],
    key: &[u8; 32],
    matter_id: &str,
    privilege: &str,
) -> Result<RecordBatch> {
    use crate::commands::mail::crypto::encrypt_with_key;

    let schema = build_schema();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let ids: Vec<String> = rows
        .iter()
        .map(|(c, _)| chunk_id(&c.path, c.paragraph_index))
        .collect();
    let para_idx: Vec<u32> = rows.iter().map(|(c, _)| c.paragraph_index).collect();
    let timestamps = vec![now; rows.len()];

    // Encrypt each chunk's text; store as hex string in the text column.
    // S2: Propagate encrypt errors — silently storing empty with encrypted=true
    // would produce a permanently-unrecoverable chunk.
    let mut encrypted_texts: Vec<String> = Vec::with_capacity(rows.len());
    for (c, _) in rows.iter() {
        let blob = encrypt_with_key(c.text.as_bytes(), key)
            .map_err(|e| anyhow::anyhow!("encrypt crm chunk {}: {e}", c.path))?;
        encrypted_texts.push(hex::encode(&blob));
    }

    // VG-6e: same tokenization as build_batch_mail — a "crm:<kind>:<id>" key is
    // a re-identification surface, so it gets the same token + path_enc pair.
    // P2.3 row 3: token + ciphertext computed once per distinct path.
    let (path_tokens, path_encs) = path_token_and_enc_columns(rows, key)?;

    let vectors = FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
        rows.iter()
            .map(|(_, v)| Some(v.iter().copied().map(Some).collect::<Vec<_>>())),
        EMBEDDING_DIM as i32,
    );

    let id_arr = StringArray::from_iter_values(ids.iter().map(|s| s.as_str()));
    let path_arr = StringArray::from_iter_values(path_tokens.iter().map(|s| s.as_str()));
    // WS-B/C: matter_id (one value, all rows) + source_id (== path = "crm:<kind>:<id>"
    // — VG-6e: both columns hold the token).
    let matter_arr = StringArray::from(vec![matter_id; rows.len()]);
    let src_arr = StringArray::from_iter_values(path_tokens.iter().map(|s| s.as_str()));
    let penc_arr = StringArray::from_iter_values(path_encs.iter().map(|s| s.as_str()));
    let pi_arr = UInt32Array::from(para_idx);
    let text_arr = StringArray::from_iter_values(encrypted_texts.iter().map(|s| s.as_str()));
    let ts_arr = Int64Array::from(timestamps);
    let st_arr = StringArray::from(vec!["crm"; rows.len()]);
    let pn_arr = UInt32Array::from(vec![0u32; rows.len()]);
    // G4: encrypted = true — the text column holds ciphertext, not plaintext.
    let enc_arr = arrow_array::BooleanArray::from(vec![true; rows.len()]);
    // WS-PRIV: validate + write the privilege value to every crm row.
    let privilege = validate_privilege(privilege)?;
    let priv_arr = StringArray::from(vec![privilege; rows.len()]);
    // VG-2: crm is never OCR-extracted — extraction columns stay null.
    let ext_arr = StringArray::from(vec![None::<&str>; rows.len()]);
    let conf_arr = arrow_array::Float32Array::from(vec![None::<f32>; rows.len()]);
    // VG-3c: crm never carries a page:line locator.
    let loc_arr = StringArray::from(vec![None::<&str>; rows.len()]);

    RecordBatch::try_new(
        schema,
        vec![
            Arc::new(id_arr),
            Arc::new(path_arr),
            Arc::new(matter_arr),
            Arc::new(src_arr),
            Arc::new(pi_arr),
            Arc::new(text_arr),
            Arc::new(vectors),
            Arc::new(ts_arr),
            Arc::new(st_arr),
            Arc::new(pn_arr),
            Arc::new(enc_arr),
            Arc::new(priv_arr),
            Arc::new(ext_arr),
            Arc::new(conf_arr),
            Arc::new(loc_arr),
            Arc::new(penc_arr),
        ],
    )
    .context("RecordBatch::try_new failed for crm chunks batch")
}

/// Build a RecordBatch for external connector chunks. Mirrors `build_batch_crm`
/// exactly — the `text` column holds hex-encoded AES-256-GCM ciphertext,
/// `source_type` is written from the allowlisted parameter, and
/// `encrypted = true`.
///
/// This is the additive connector foundation for OneDrive, e-signature,
/// meetings, and future external record kinds. The typed `SourceType` enum
/// stays closed for file extraction; connector modules use this string path.
pub fn build_batch_external(
    rows: &[(Chunk, Vec<f32>)],
    key: &[u8; 32],
    matter_id: &str,
    privilege: &str,
    source_type: &str,
) -> Result<RecordBatch> {
    use crate::commands::mail::crypto::encrypt_with_key;

    let source_type = validate_external_source_type(source_type)?;
    let schema = build_schema();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let ids: Vec<String> = rows
        .iter()
        .map(|(c, _)| chunk_id(&c.path, c.paragraph_index))
        .collect();
    let para_idx: Vec<u32> = rows.iter().map(|(c, _)| c.paragraph_index).collect();
    let timestamps = vec![now; rows.len()];

    // Encrypt each chunk's text; store as hex string in the text column.
    // S2: Propagate encrypt errors — silently storing empty with encrypted=true
    // would produce a permanently-unrecoverable chunk.
    let mut encrypted_texts: Vec<String> = Vec::with_capacity(rows.len());
    for (c, _) in rows.iter() {
        let blob = encrypt_with_key(c.text.as_bytes(), key)
            .map_err(|e| anyhow::anyhow!("encrypt external chunk {}: {e}", c.path))?;
        encrypted_texts.push(hex::encode(&blob));
    }

    // VG-6e: same tokenization as build_batch_crm — external connector keys
    // are re-identification surfaces, so they get the same token + path_enc pair.
    // P2.3 row 3: token + ciphertext computed once per distinct path.
    let (path_tokens, path_encs) = path_token_and_enc_columns(rows, key)?;

    let vectors = FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
        rows.iter()
            .map(|(_, v)| Some(v.iter().copied().map(Some).collect::<Vec<_>>())),
        EMBEDDING_DIM as i32,
    );

    let id_arr = StringArray::from_iter_values(ids.iter().map(|s| s.as_str()));
    let path_arr = StringArray::from_iter_values(path_tokens.iter().map(|s| s.as_str()));
    // WS-B/C: matter_id (one value, all rows) + source_id (== path = external
    // connector source id — VG-6e: both columns hold the token).
    let matter_arr = StringArray::from(vec![matter_id; rows.len()]);
    let src_arr = StringArray::from_iter_values(path_tokens.iter().map(|s| s.as_str()));
    let penc_arr = StringArray::from_iter_values(path_encs.iter().map(|s| s.as_str()));
    let pi_arr = UInt32Array::from(para_idx);
    let text_arr = StringArray::from_iter_values(encrypted_texts.iter().map(|s| s.as_str()));
    let ts_arr = Int64Array::from(timestamps);
    let st_arr = StringArray::from(vec![source_type; rows.len()]);
    let pn_arr = UInt32Array::from(vec![0u32; rows.len()]);
    // G4: encrypted = true — the text column holds ciphertext, not plaintext.
    let enc_arr = arrow_array::BooleanArray::from(vec![true; rows.len()]);
    // WS-PRIV: validate + write the privilege value to every external row.
    let privilege = validate_privilege(privilege)?;
    let priv_arr = StringArray::from(vec![privilege; rows.len()]);
    // VG-2: external connector rows are not OCR-extracted here — extraction columns stay null.
    let ext_arr = StringArray::from(vec![None::<&str>; rows.len()]);
    let conf_arr = arrow_array::Float32Array::from(vec![None::<f32>; rows.len()]);
    // VG-3c: external connector rows never carry a page:line locator here.
    let loc_arr = StringArray::from(vec![None::<&str>; rows.len()]);

    RecordBatch::try_new(
        schema,
        vec![
            Arc::new(id_arr),
            Arc::new(path_arr),
            Arc::new(matter_arr),
            Arc::new(src_arr),
            Arc::new(pi_arr),
            Arc::new(text_arr),
            Arc::new(vectors),
            Arc::new(ts_arr),
            Arc::new(st_arr),
            Arc::new(pn_arr),
            Arc::new(enc_arr),
            Arc::new(priv_arr),
            Arc::new(ext_arr),
            Arc::new(conf_arr),
            Arc::new(loc_arr),
            Arc::new(penc_arr),
        ],
    )
    .context("RecordBatch::try_new failed for external connector chunks batch")
}

/// Replace all rows for `path` with the new `rows`. Idempotent re-index.
///
/// A3: `source_type` is passed to `build_batch` so every row in the batch
/// gets the correct `source_type` / `page_number` values. Text callers pass
/// `SourceType::Text`; PDF callers pass `SourceType::Pdf { page_number }`.
/// Note: for PDF files where different chunks belong to different pages,
/// call this once per page or use `build_batch_per_row` (not needed in A3
/// since we split at the page level already).
pub async fn upsert_chunks_for_path(
    table: &Table,
    path: &str,
    rows: Vec<(Chunk, Vec<f32>)>,
    source_type: SourceType,
    matter_id: &str,
    privilege: &str,
    key: &[u8; 32],
) -> Result<()> {
    let _write = acquire_write_access(table).await?;
    // VG-6e: the `path` column holds the keyed token, so every predicate matches
    // on the token computed from the same plaintext path + key. (The predicate
    // string lands in LanceDB's transaction log — tokenizing it is part of the
    // no-plaintext-paths-on-disk guarantee.)
    let predicate = format!(
        "path = '{}'",
        sql_escape(&super::super::crypto::path_token(key, path))
    );

    // Empty `rows` means the file was emptied by the user — there is nothing to
    // swap IN, so a plain delete is correct and exposes no gap (a reader
    // correctly sees the source disappear because it genuinely has). The atomic
    // path below only matters when we are REPLACING content.
    if rows.is_empty() {
        table
            .delete(&predicate)
            .await
            .with_context(|| format!("delete failed for {}", path))?;
        return Ok(());
    }

    // SWAP-1 (atomic re-index): do NOT delete-then-add. Those are two separate
    // LanceDB commits, and with a zero read-consistency interval a concurrent
    // Ask can land on the briefly-committed post-delete version and miss this
    // file entirely (demo step-4 finding 4). Instead perform the whole replace
    // as ONE `merge_insert` transaction so readers only ever see the OLD content
    // or the NEW content, never a gap:
    //   - join on `id` (= chunk_id(path, paragraph_index), unique per source);
    //   - when_matched_update_all: a paragraph that survives re-index is updated
    //     in place (new text/vector/timestamp);
    //   - when_not_matched_insert_all: brand-new paragraphs are inserted;
    //   - when_not_matched_by_source_delete SCOPED to this path's token: stale
    //     paragraphs that no longer exist (the file shrank) are dropped — and the
    //     `path = '<token>'` filter guarantees rows for OTHER files/matters are
    //     never touched, so matter/privilege scoping semantics are unchanged.
    // Row-count outcome is identical to the old delete-then-add, so QA-92's
    // reconcile row-count proofs still hold; only the atomicity changes.
    //
    // WS-VEC: build_batch encrypts the text column under the vector-store key.
    // VG-2: this path serves native text extraction only — never OCR.
    let batch = build_batch(&rows, source_type, matter_id, privilege, None, key)?;

    // F2: reject a batch with duplicate incoming ids BEFORE touching the table —
    // merge_insert on duplicate source ids is undefined and silently loses rows.
    ensure_unique_incoming_ids(std::slice::from_ref(&batch), path)?;

    // F1 + P2: collapse any pre-existing on-disk duplicate ids BEFORE the merge
    // (never after). If it fails, content is untouched and the error is honest;
    // running it after a committed merge would turn a succeeded swap into a
    // tombstoned, vanished file. See dedup_duplicate_ids_for_path.
    dedup_duplicate_ids_for_path(table, &predicate)
        .await
        .with_context(|| format!("pre-merge dedup failed for {}", path))?;

    let schema = batch.schema();
    let iter = RecordBatchIterator::new(vec![Ok(batch)], schema);

    let mut merge = table.merge_insert(&["id"]);
    merge
        .when_matched_update_all(None)
        .when_not_matched_insert_all()
        .when_not_matched_by_source_delete(Some(predicate.clone()));
    merge
        .execute(Box::new(iter))
        .await
        .with_context(|| format!("atomic re-index merge_insert failed for {}", path))?;
    Ok(())
}

/// Replace all rows for `path` with per-group batches, where every group
/// carries its OWN `SourceType` — the write shape for SECTIONED sources
/// (PDF pages, xlsx sheets, pptx slides) whose chunks differ in
/// `source_type`/`page_number` across the same file.
///
/// Generalized out of `pdf_indexer.rs` (VG-2b): one up-front delete for the
/// whole path (calling `upsert_chunks_for_path` per group would re-delete
/// the groups already inserted), then ONE `table.add` over every group's
/// batch. Idempotent re-index, exactly like `upsert_chunks_for_path`.
/// Returns the number of rows inserted; an empty `groups` still deletes
/// stale rows (the file may have emptied) and returns 0.
///
/// VG-2: each group carries its own `extraction` marker — `Some(("ocr", conf))`
/// on a PDF page group the OCR engine read, `None` on every native group
/// (office callers pass `None` throughout).
pub async fn upsert_grouped(
    table: &Table,
    path: &str,
    groups: Vec<(SourceType, Option<(&str, f32)>, Vec<(Chunk, Vec<f32>)>)>,
    matter_id: &str,
    privilege: &str,
    key: &[u8; 32],
) -> Result<usize> {
    let _write = acquire_write_access(table).await?;
    // VG-6e: tokenized predicate — see upsert_chunks_for_path.
    let predicate = format!(
        "path = '{}'",
        sql_escape(&super::super::crypto::path_token(key, path))
    );

    use arrow_schema::ArrowError;
    let mut count = 0usize;
    let mut batches: Vec<RecordBatch> = Vec::new();
    for (source_type, extraction, rows) in &groups {
        if rows.is_empty() {
            continue;
        }
        count += rows.len();
        let batch = build_batch(rows, *source_type, matter_id, privilege, *extraction, key)
            .map_err(|e| anyhow::anyhow!("build grouped batch for {}: {e}", path))?;
        batches.push(batch);
    }

    if batches.is_empty() {
        // Every group was empty — the sectioned file emptied. A plain delete is
        // correct (nothing to swap in) and exposes no retrieval gap. See
        // upsert_chunks_for_path for the same empty-source reasoning.
        table
            .delete(&predicate)
            .await
            .with_context(|| format!("delete failed for {}", path))?;
        return Ok(count);
    }

    // SWAP-1 (atomic re-index): replace all of this path's rows across every
    // section (PDF pages / xlsx sheets / pptx slides) in ONE `merge_insert`
    // transaction — never delete-then-add — so a concurrent Ask can't land on a
    // committed post-delete version and miss the file. Same three clauses as
    // upsert_chunks_for_path; the `when_not_matched_by_source_delete` filter is
    // scoped to this path's token so stale sections are dropped while rows for
    // other files/matters are untouched (scoping semantics unchanged, QA-92
    // row-count proofs preserved). Merging on `id` across the multi-batch source
    // is fine: chunk_id is unique per (path, paragraph_index), so page/sheet
    // groups never collide.
    // F2: reject duplicate incoming ids ACROSS every group's batch BEFORE
    // touching the table — chunk_id is unique per (path, paragraph_index), so a
    // collision here means a banding overflow (a long PDF page spilling into the
    // next page's id band). merge_insert on duplicate source ids is undefined
    // and would silently drop content; fail loudly instead.
    ensure_unique_incoming_ids(&batches, path)?;

    // F1 + P2: collapse any pre-existing on-disk duplicate ids BEFORE the merge
    // (never after) — a post-merge failure would tombstone the freshly-swapped
    // file. See dedup_duplicate_ids_for_path.
    dedup_duplicate_ids_for_path(table, &predicate)
        .await
        .with_context(|| format!("pre-merge grouped dedup failed for {}", path))?;

    let schema = build_schema();
    let iter = RecordBatchIterator::new(
        batches.into_iter().map(Ok::<RecordBatch, ArrowError>),
        schema,
    );

    let mut merge = table.merge_insert(&["id"]);
    merge
        .when_matched_update_all(None)
        .when_not_matched_insert_all()
        .when_not_matched_by_source_delete(Some(predicate.clone()));
    merge
        .execute(Box::new(iter))
        .await
        .with_context(|| format!("atomic grouped re-index merge_insert failed for {}", path))?;
    Ok(count)
}
