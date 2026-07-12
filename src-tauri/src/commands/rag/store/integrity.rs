use super::*;

// ---------------------------------------------------------------------------
// WS-B/C: version-aware migration.
// ---------------------------------------------------------------------------

/// Path of the index-version marker file for a workspace's vector dir.
fn index_version_path(workspace_root: &Path) -> PathBuf {
    dataset_path(workspace_root).join(INDEX_VERSION_FILE)
}

/// BUG-099: filename holding the DURABLE tombstone set — the HMAC PATH TOKENS
/// (not plaintext paths) of files whose stale-row cleanup DELETE failed. One
/// token per line. This makes the fail-closed guarantee survive an app restart:
/// without it, the in-memory `RagState::unsafe_tokens` is empty on relaunch while
/// the stale rows are still on disk, so retrieval could cite the old version.
///
/// LOCATION (decorrelated from the failing dir): this file lives in the
/// `.lantern/` PARENT dir, NOT inside `.lantern/vectors/`. The tombstone is
/// written precisely WHEN a LanceDB delete in the vectors dataset dir failed
/// (lock contention / a locked or unwritable dataset). Writing the tombstone
/// into that SAME dataset dir would likely fail for the same reason, defeating
/// the durable guarantee. The sibling `.lantern/` dir is a separate directory,
/// so a dataset-scoped failure does not block persisting the tombstone.
///
/// PRIVACY (VG-6e parity): we persist the OPAQUE keyed token — the exact value
/// stored in the `path` column — NOT the plaintext path. A raw-disk reader
/// therefore learns nothing about client/matter file names from this file,
/// consistent with the tokenized `path`/`source_id` columns and the encrypted
/// `path_enc`. The token is what retrieval excludes anyway, so this is both
/// safer and simpler (no plaintext→token conversion on read).
const UNSAFE_PATHS_FILE: &str = ".unsafe_tokens";

/// BUG-099: a DURABLE, cross-process "integrity unknown" sentinel. Written when a
/// durable tombstone WRITE itself fails (so the on-disk `.unsafe_tokens` is
/// stale/missing a token while stale rows are still in LanceDB). Its mere
/// PRESENCE forces every reader — the GUI on workspace open AND the separate MCP
/// sidecar process — to fail closed, because the GUI's in-memory tombstone set is
/// invisible across processes. Removed only by a clean full walk that rewrites
/// the tombstone file successfully.
const INTEGRITY_UNKNOWN_FILE: &str = ".integrity_unknown";

/// Durable "a clean full rebuild is required" sentinel (sibling of the others).
/// Set when the boot reconcile's deleted-source purge is DEGRADED — the
/// mass-deletion sanity breaker refused to purge, or the consecutive-failure
/// backoff aborted the purge loop — leaving deleted-file rows un-purged and
/// un-tombstoned. Unlike the integrity-unknown sentinel (which only forces a full
/// WALK that re-indexes present files but never drops orphaned rows), this forces
/// the reconcile to `drop_table` + full re-index on the next boot, exactly like a
/// manifest key-format upgrade. That is the only recovery that actually removes
/// the un-purged rows (a false mass-deletion re-indexes every present file under
/// correct tokens; a real-but-unpurgeable deletion is dropped with the table).
/// Removed only after that clean full walk completes.
const REBUILD_REQUIRED_FILE: &str = ".rebuild_required";

/// Path of the durable tombstone file. Lives in the `.lantern/` dir (the parent
/// of `vectors/`) so a locked/unwritable LanceDB dataset dir cannot block it.
pub(crate) fn unsafe_paths_path(workspace_root: &Path) -> PathBuf {
    crate::commands::data_dir::workspace_data_dir(workspace_root).join(UNSAFE_PATHS_FILE)
}

/// Path of the durable integrity-unknown sentinel (sibling of `.unsafe_tokens`).
fn integrity_unknown_path(workspace_root: &Path) -> PathBuf {
    crate::commands::data_dir::workspace_data_dir(workspace_root)
        .join(INTEGRITY_UNKNOWN_FILE)
}

/// BUG-099: mark the workspace integrity UNKNOWN durably (cross-process). Called
/// when a durable tombstone write fails, so the MCP sidecar (which only reads
/// disk) also fails closed. Best-effort; logged on failure.
pub fn mark_integrity_unknown(workspace_root: &Path) {
    let path = integrity_unknown_path(workspace_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    if let Err(e) = std::fs::write(&path, b"1") {
        log::error!(
            "rag: failed to write integrity-unknown sentinel {:?}: {e}",
            path
        );
    }
}

/// BUG-099: clear the durable integrity-unknown sentinel after a clean re-index.
pub fn clear_integrity_unknown(workspace_root: &Path) {
    let path = integrity_unknown_path(workspace_root);
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => log::warn!(
            "rag: failed to clear integrity-unknown sentinel {:?}: {e}",
            path
        ),
    }
}

/// Path of the durable rebuild-required sentinel (sibling of `.integrity_unknown`).
fn rebuild_required_path(workspace_root: &Path) -> PathBuf {
    crate::commands::data_dir::workspace_data_dir(workspace_root)
        .join(REBUILD_REQUIRED_FILE)
}

/// Mark the workspace as needing a clean `drop_table` + full re-index on the next
/// boot. Set by the degraded deleted-source purge (breaker/backoff). Best-effort;
/// logged on failure. See [`REBUILD_REQUIRED_FILE`] for why a full WALK alone is
/// not enough.
pub fn mark_rebuild_required(workspace_root: &Path) {
    let path = rebuild_required_path(workspace_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    if let Err(e) = std::fs::write(&path, b"1") {
        log::error!("rag: failed to write rebuild-required sentinel {:?}: {e}", path);
    }
}

/// True iff a clean full rebuild is durably pending (the sentinel file exists).
pub fn is_rebuild_required(workspace_root: &Path) -> bool {
    rebuild_required_path(workspace_root).exists()
}

/// Clear the durable rebuild-required sentinel after the clean full rebuild it
/// demanded has completed.
pub fn clear_rebuild_required(workspace_root: &Path) {
    let path = rebuild_required_path(workspace_root);
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => log::warn!(
            "rag: failed to clear rebuild-required sentinel {:?}: {e}",
            path
        ),
    }
}

/// BUG-099: outcome of reading the durable tombstone file. We MUST distinguish
/// "no tombstones" from "couldn't read the tombstones", because treating the
/// latter as the former is a fail-OPEN: in the exact cleanup-failure case this
/// feature protects, stale rows are still in LanceDB, so an unreadable tombstone
/// file (corruption / lock / permission fault) must make retrieval fail CLOSED,
/// not serve unfiltered results.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TombstoneRead {
    /// File absent (healthy: no cleanup ever failed) or read cleanly. Carries the
    /// token set (possibly empty). Retrieval applies it as the exclusion.
    Tokens(HashSet<String>),
    /// File EXISTS but could not be read (corruption / lock / permission). The
    /// real tombstone set is unknown, so callers must FAIL CLOSED (refuse to
    /// serve / force a re-index) rather than assume "no tombstones".
    IntegrityUnknown,
}

impl TombstoneRead {
    /// True when the durable tombstone could not be read and the index integrity
    /// is therefore unknown — callers must fail closed.
    pub fn is_integrity_unknown(&self) -> bool {
        matches!(self, TombstoneRead::IntegrityUnknown)
    }

    /// The token set when readable; an empty set when integrity is unknown.
    /// Use ONLY where a fail-closed decision has already been made separately
    /// (e.g. the MCP path checks `is_integrity_unknown()` first and refuses).
    pub fn into_tokens(self) -> HashSet<String> {
        match self {
            TombstoneRead::Tokens(t) => t,
            TombstoneRead::IntegrityUnknown => HashSet::new(),
        }
    }
}

/// BUG-099: load the durable tombstone token set for a workspace. Used to
/// re-hydrate `RagState::unsafe_tokens` on workspace open so the fail-closed
/// exclusion survives a restart, and read directly by the MCP sidecar. Tokens
/// are hex strings, taken verbatim after stripping only the line terminator.
///
/// Returns `Tokens(set)` when the file is ABSENT (healthy → empty) or read
/// cleanly, and `IntegrityUnknown` when (a) the durable integrity-unknown
/// SENTINEL is present (a prior durable tombstone WRITE failed — cross-process
/// fail-closed signal, so the MCP sidecar honors it too), or (b) the tombstone
/// file EXISTS but cannot be read. The file is written ATOMICALLY (temp + rename,
/// with a direct-write fallback), so a torn/truncated write cannot happen; an
/// unreadable existing file is genuine corruption or a permission/lock fault.
pub fn read_unsafe_tokens(workspace_root: &Path) -> TombstoneRead {
    // Durable cross-process sentinel: a prior tombstone WRITE failed, so the
    // on-disk token set cannot be trusted. Fail closed regardless of the file.
    if integrity_unknown_path(workspace_root).exists() {
        return TombstoneRead::IntegrityUnknown;
    }
    let path = unsafe_paths_path(workspace_root);
    match std::fs::read_to_string(&path) {
        Ok(s) => TombstoneRead::Tokens(
            s.split('\n')
                .map(|l| l.strip_suffix('\r').unwrap_or(l))
                .filter(|l| !l.is_empty())
                .map(|l| l.to_string())
                .collect(),
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Absent = healthy default (no tombstones).
            TombstoneRead::Tokens(HashSet::new())
        }
        Err(e) => {
            // Present-but-unreadable = corruption / lock / permission fault.
            // FAIL CLOSED: the caller must not serve as if there were no
            // tombstones (stale rows may still be in the DB).
            log::error!(
                "rag: durable tombstone file {:?} exists but could not be read \
                 ({e}); marking index integrity UNKNOWN — retrieval will fail \
                 closed until a clean re-index rewrites the tombstone file",
                path
            );
            TombstoneRead::IntegrityUnknown
        }
    }
}

/// BUG-099: persist the durable tombstone TOKEN set for a workspace. Called
/// after any change (a token tombstoned on a cleanup failure, or cleared on a
/// clean re-index) so the on-disk set always matches memory. An empty set writes
/// an empty file (rather than deleting it) so a later read is unambiguous. Write
/// errors are surfaced to the caller, which treats a failed persist as part of
/// the unsafe state (does not stamp the index complete).
///
/// ATOMICITY: written to a temp file in the SAME dir, then renamed over the
/// target so a crash mid-write can never leave a half-written / truncated
/// tombstone that would silently drop tokens (fail-open) on the next read.
///
/// WINDOWS-SAFE REPLACE: `std::fs::rename` is an atomic replace on POSIX, and on
/// Windows it maps to a replacing move — BUT a Windows move over an EXISTING
/// target can still fail with a sharing violation if the target is momentarily
/// open. Losing the tombstone there would be a fail-OPEN, so on ANY rename
/// failure we FALL BACK to a direct in-place write of the same bytes: that loses
/// the crash-atomicity for this one write but GUARANTEES the tombstone persists
/// (fail-closed beats elegant). The fallback's own error is surfaced to the
/// caller, which treats a failed persist as part of the unsafe state.
pub fn write_unsafe_tokens(workspace_root: &Path, tokens: &HashSet<String>) -> Result<()> {
    let path = unsafe_paths_path(workspace_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let mut sorted: Vec<&String> = tokens.iter().collect();
    sorted.sort();
    let body = sorted
        .iter()
        .map(|s| s.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    // Preferred path: write temp + atomic rename-replace. Pid-tagged temp name so
    // concurrent writers don't collide on the temp path.
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    std::fs::write(&tmp, &body)
        .with_context(|| format!("write unsafe-tokens temp at {:?}", tmp))?;
    if let Err(rename_err) = std::fs::rename(&tmp, &path) {
        // Windows: a replacing move can fail with a sharing violation if the
        // existing target is briefly open. Fall back to a direct write so the
        // tombstone STILL persists, then drop the temp file.
        //
        // TRUNCATION SAFETY: a direct `std::fs::write` TRUNCATES the known-good
        // file before rewriting it, so a crash or a concurrent reader (the MCP
        // sidecar) mid-write could see an EMPTY/partial-but-readable tombstone —
        // a fail-OPEN. To prevent that, mark `.integrity_unknown` FIRST so any
        // reader during the destructive write fails CLOSED; only clear it once
        // the direct write fully succeeds. If the direct write itself fails, the
        // sentinel stays set (fail closed) and the error propagates.
        log::warn!(
            "rag: atomic rename of unsafe-tokens failed ({rename_err}); \
             marking integrity-unknown and falling back to a direct write"
        );
        mark_integrity_unknown(workspace_root);
        let direct = std::fs::write(&path, &body)
            .with_context(|| format!("direct-write unsafe-tokens tombstone at {:?}", path));
        let _ = std::fs::remove_file(&tmp);
        direct?;
        // The direct write fully succeeded → the known-good file is complete
        // again, so it is safe to clear the sentinel.
        clear_integrity_unknown(workspace_root);
    }
    Ok(())
}

/// Read the index version the on-disk `chunks` table was built with. Returns 0
/// when the marker is absent (i.e. a pre-3.0 table, or no table yet).
pub fn read_index_version(workspace_root: &Path) -> u32 {
    std::fs::read_to_string(index_version_path(workspace_root))
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0)
}

/// Stamp the current `INDEX_VERSION` into the marker file. Called once after a
/// successful (re-)index so the migration runs at most once.
pub fn write_index_version(workspace_root: &Path) -> Result<()> {
    let path = index_version_path(workspace_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&path, INDEX_VERSION.to_string())
        .with_context(|| format!("write index version marker at {:?}", path))?;
    Ok(())
}

/// WS-B/C migration check: does this workspace need a one-time re-index because
/// its vectors predate the NON-NULL `matter_id` / `source_id` columns?
///
/// True iff a `chunks` table already exists AND its version marker is below
/// `INDEX_VERSION`. A fresh workspace (no table) returns false — there is
/// nothing to migrate; new content is written with the columns from the start.
///
/// We deliberately do NOT back-fill nulls: a null matter_id is a confidentiality
/// hazard. The caller drops the old table and re-indexes, assigning the
/// `UNASSIGNED_MATTER` sentinel, then calls `write_index_version`.
pub async fn needs_migration(conn: &Connection, workspace_root: &Path) -> Result<bool> {
    if read_index_version(workspace_root) >= INDEX_VERSION {
        return Ok(false);
    }
    let names = conn
        .table_names()
        .execute()
        .await
        .context("table_names failed during migration check")?;
    let table_exists = names.iter().any(|n| n == TABLE_NAME);
    Ok(table_exists)
}

/// Drop the legacy `chunks` table so the caller can re-index from scratch under
/// the 3.0 schema. Used by the one-time migration when `needs_migration` is true.
/// No-op if the table doesn't exist.
pub async fn drop_table(conn: &Connection) -> Result<()> {
    let _write = acquire_connection_write_access(conn).await?;
    let names = conn
        .table_names()
        .execute()
        .await
        .context("table_names failed before drop")?;
    if names.iter().any(|n| n == TABLE_NAME) {
        conn.drop_table(TABLE_NAME)
            .await
            .context("drop_table chunks failed")?;
    }
    Ok(())
}
