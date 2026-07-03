//! data_dir.rs — the single seam for resolving and migrating the per-workspace
//! internal data folder, renamed `.keepance` → `.lantern` (and the OS-level data
//! subdir `keepance` → `lantern`, and the vault metadata file
//! `.keepance-vault.json` → `.lantern-vault.json`).
//!
//! Why this exists: the internal namespace flipped from `keepance` to `lantern`
//! (see `identity.rs`), so `identity::WORKSPACE_DATA_DIR` is now `.lantern`. But
//! real installs (and dev/bench machines) already have user data under the OLD
//! `.keepance` folder. Without a migration the app would silently look at an
//! empty `.lantern` and orphan the user's mail / audit / RAG / connector data.
//!
//! Design goals (this is data-migration, correctness-critical):
//!  - **Atomic**: a same-volume `rename` (the old and new dirs are always
//!    siblings under the workspace root, so it is always same-volume).
//!  - **Fail-safe**: on ANY failure we never half-migrate and never touch the
//!    old data — the pure resolver (`workspace_data_dir`) keeps returning the
//!    OLD path so consumers transparently keep using the real data in place.
//!  - **Idempotent**: a second launch after success is a no-op; a crash
//!    mid-migration leaves a state the next launch + the resolver both resolve
//!    correctly.
//!  - **Both-exist (a PRIMARY case here, not just defensive)**: because stores
//!    create their dir eagerly on open and the shipped build already uses
//!    `.lantern`, an upgraded install can have a fresh `.lantern` STUB beside
//!    the real `.keepance`. We pick the one with real data (marker-based),
//!    quarantine — never delete, never merge — the loser, and log loudly.
//!
//! Every consumer of the data folder asks ONE of the functions here; no code
//! outside this module should hardcode `.keepance` or join `WORKSPACE_DATA_DIR`
//! for a live filesystem path.

use std::path::{Path, PathBuf};

use crate::identity::{OS_DATA_SUBDIR, VAULT_META_FILE, WORKSPACE_DATA_DIR};

/// Legacy per-workspace data-dir name (pre-Lantern). The ONE place this literal
/// is allowed to live.
pub const LEGACY_WORKSPACE_DATA_DIR: &str = ".keepance";

/// Legacy vault-metadata filename (pre-Lantern).
pub const LEGACY_VAULT_META_FILE: &str = ".keepance-vault.json";

/// Legacy OS-level data subdir name (pre-Lantern), under `dirs::data_dir()`.
pub const LEGACY_OS_DATA_SUBDIR: &str = "keepance";

/// Marker file written INSIDE the migrated data dir. Only this migration writes
/// it, and only into the new (`.lantern`) dir. Its presence is the discriminator
/// that tells a real migrated `.lantern` apart from a fresh empty stub created
/// by a post-flip build before this migration existed.
const MIGRATION_MARKER: &str = ".migrated-from-keepance";

// ─────────────────────────────────────────────────────────────────────────────
// Pure resolver — NO filesystem mutation. This is the fail-safe source of truth.
// ─────────────────────────────────────────────────────────────────────────────

/// Resolve the authoritative internal data dir for a workspace, WITHOUT mutating
/// the filesystem. Correct whether or not `migrate_workspace` has already run.
///
/// Rules (old = `.keepance`, new = `.lantern`):
///  - new exists AND (marker present OR old absent) → new   *(migrated / fresh)*
///  - else old exists → old   *(legacy in place, or a both-exist stub → prefer
///    the dir with the real data)*
///  - else → new              *(fresh install; consumers create it lazily)*
pub fn workspace_data_dir(workspace_root: &Path) -> PathBuf {
    workspace_root.join(workspace_data_dir_name(workspace_root))
}

/// The resolved data-dir NAME (`.lantern` or, in the legacy/fail-safe case,
/// `.keepance`). Same decision as [`workspace_data_dir`]; used to rebuild stored
/// data-dir-relative paths (e.g. mail blob refs) against the live dir name.
pub fn workspace_data_dir_name(workspace_root: &Path) -> &'static str {
    let new = workspace_root.join(WORKSPACE_DATA_DIR);
    let old = workspace_root.join(LEGACY_WORKSPACE_DATA_DIR);
    let new_exists = new.exists();
    let old_exists = old.exists();
    if new_exists && (new.join(MIGRATION_MARKER).exists() || !old_exists) {
        // Migrated (marker) or fresh install / already-lantern.
        WORKSPACE_DATA_DIR
    } else if new_exists && old_exists {
        // Both exist, no marker: mirror the migration's decision so the resolver
        // is correct even if `migrate_workspace` has not run yet (e.g. a store
        // opened by the MCP sidecar). Prefer the legacy real data ONLY when the
        // new dir is a proven-empty stub; otherwise the new dir holds the real
        // (newer) data and must win — never fork back onto legacy data.
        if dir_is_pure_stub(&new) {
            LEGACY_WORKSPACE_DATA_DIR
        } else {
            WORKSPACE_DATA_DIR
        }
    } else if old_exists {
        // Legacy in place (not yet migrated), or fail-safe after a failed rename.
        LEGACY_WORKSPACE_DATA_DIR
    } else {
        WORKSPACE_DATA_DIR
    }
}

/// True if `name` is EITHER the current or the legacy data-dir name (case-
/// insensitive, for Windows). Used by workspace walkers so a leftover legacy
/// `.keepance` dir is skipped exactly like `.lantern` and never gets indexed,
/// vault-encrypted, or counted as a user file.
pub fn is_workspace_data_dir_name(name: &str) -> bool {
    name.eq_ignore_ascii_case(WORKSPACE_DATA_DIR)
        || name.eq_ignore_ascii_case(LEGACY_WORKSPACE_DATA_DIR)
}

/// Resolve a stored workspace-relative path that MAY carry a data-dir prefix
/// (e.g. a mail blob ref `.keepance/mail/blobs/<sha>.enc` persisted by an older
/// build) to an absolute path under the LIVE data-dir name. A leading
/// `.keepance/` or `.lantern/` segment is rewritten to the resolved name; any
/// other path (e.g. a user file `Mail/Inbox/x.md`) is joined unchanged.
pub fn resolve_workspace_relative(workspace_root: &Path, rel: &str) -> PathBuf {
    let normalized = rel.replace('\\', "/");
    let (first, rest) = match normalized.split_once('/') {
        Some((f, r)) => (f, Some(r)),
        None => (normalized.as_str(), None),
    };
    if is_workspace_data_dir_name(first) {
        let base = workspace_root.join(workspace_data_dir_name(workspace_root));
        return match rest {
            Some(r) => base.join(r),
            None => base,
        };
    }
    workspace_root.join(rel)
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration outcomes + report
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DirOutcome {
    /// Neither dir existed — nothing to migrate (fresh install).
    FreshInstall,
    /// New dir already authoritative (marker present, or old absent).
    AlreadyMigrated,
    /// Old dir renamed to new. Data migrated in place.
    Migrated,
    /// Both existed; new was a fresh empty stub → old promoted, stub quarantined.
    PromotedOverStub,
    /// Both existed WITH data but new had no marker (user ran a post-rename build
    /// and did real work in `.lantern` while legacy `.keepance` also holds data).
    /// The current `.lantern` is kept active and adopted; the legacy folder is
    /// left fully intact for manual recovery. Nothing merged, moved, or deleted.
    ConflictKeptNew,
    /// Both existed and new is the real migrated dir; old is a stale leftover
    /// (left untouched for safety).
    LeftoverOldKept,
    /// A rename/promote failed. Old data left fully intact; the resolver keeps
    /// using the old path in place. Retried on the next launch.
    FailSafe,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileOutcome {
    FreshInstall,
    AlreadyMigrated,
    Migrated,
    /// Both files existed. For the vault-metadata file this is a potential
    /// key-material CONFLICT (an interim post-rename build may have created a new
    /// vault with a different master key without seeing the legacy one). Neither
    /// file is moved or deleted — both are preserved for manual recovery — and it
    /// is logged loudly. The app reads the new (`.lantern-vault.json`) file.
    Conflict,
    FailSafe,
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct WorkspaceMigrationReport {
    pub data_dir: DirOutcome,
    pub vault_meta: FileOutcome,
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure planner — the decision, independent of the filesystem (unit-tested).
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DirAction {
    /// No filesystem change; the carried outcome is final.
    None(DirOutcome),
    /// Rename old → new.
    Rename,
    /// Quarantine the stub `new`, then rename old → new.
    Promote,
    /// Both exist, new is authoritative; keep both, log the leftover.
    LeftoverKept,
}

fn plan_dir(old_exists: bool, new_exists: bool, marker_present: bool) -> DirAction {
    match (old_exists, new_exists) {
        (false, false) => DirAction::None(DirOutcome::FreshInstall),
        (false, true) => DirAction::None(DirOutcome::AlreadyMigrated),
        (true, false) => DirAction::Rename,
        (true, true) => {
            if marker_present {
                DirAction::LeftoverKept
            } else {
                DirAction::Promote
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FileAction {
    None(FileOutcome),
    Rename,
}

fn plan_file(old_exists: bool, new_exists: bool) -> FileAction {
    match (old_exists, new_exists) {
        (false, false) => FileAction::None(FileOutcome::FreshInstall),
        (_, true) => FileAction::None(FileOutcome::AlreadyMigrated),
        (true, false) => FileAction::Rename,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply layer — performs the filesystem work.
// ─────────────────────────────────────────────────────────────────────────────

fn ensure_marker(new_dir: &Path) {
    let marker = new_dir.join(MIGRATION_MARKER);
    if !marker.exists() {
        if let Err(e) = std::fs::write(&marker, b"migrated from .keepance\n") {
            // Non-fatal: the resolver still resolves correctly once `old` is gone
            // (new exists, old absent → new). The marker only disambiguates the
            // both-exist case, which cannot arise after a clean rename.
            log::warn!(
                "[data-dir-migration] could not write marker {}: {e}",
                marker.display()
            );
        }
    }
}

/// True only if `dir` is PROVABLY empty — `read_dir` succeeds AND yields no
/// entries. An unreadable/locked dir returns `false` (fail closed), so the stub
/// check never treats a dir it couldn't read as empty scaffolding.
fn dir_is_provably_empty(dir: &Path) -> bool {
    match std::fs::read_dir(dir) {
        Ok(mut it) => it.next().is_none(),
        Err(_) => false,
    }
}

/// Best-effort: is `dir` a pure empty STUB — i.e. it contains ONLY the
/// scaffolding an ordinary workspace-open creates (a schema-only audit DB and
/// its WAL/SHM sidecars, the transient MCP session-scope file, empty
/// subdirectories, and our own marker)? Any other entry — a mail store or blob,
/// RAG vectors content, `memory.json`, a connector DB, or an over-sized audit DB
/// — means the user did REAL work here, so it is NOT a stub.
///
/// This gates the both-exist promotion: we only quarantine a `.lantern` and
/// promote the legacy `.keepance` when `.lantern` is a proven-empty stub. If it
/// holds any real data we treat it as a conflict instead and never revert to the
/// older folder. Conservative by construction: anything unrecognized, unreadable,
/// or populated counts as real data, so we never mistake real data for a stub —
/// even a small one (a lone `memory.json` or connector DB trips it).
fn dir_is_pure_stub(dir: &Path) -> bool {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return false; // unreadable → not provably empty → treat as real
    };
    // An empty schema-only SQLCipher DB is a few tens of KB; a populated one is
    // larger. Generous ceiling so a schema-only audit DB stays "stub".
    const EMPTY_DB_CEILING: u64 = 64 * 1024;
    for entry in rd {
        // An unreadable entry must count as real data — never classify a dir we
        // couldn't fully read as a stub (that could quarantine current data).
        let Ok(entry) = entry else { return false };
        let raw = entry.file_name();
        let name = raw.to_string_lossy();
        let Ok(ft) = entry.file_type() else { return false };
        if ft.is_dir() {
            // Only a PROVABLY-empty subdirectory is scaffolding; a populated one
            // (mail/blobs, a real vectors dataset, …) OR an unreadable/locked one
            // (e.g. a `vectors`/`mail` dir we can't read) fails closed as real
            // work, so we never quarantine current data we couldn't fully read.
            if !dir_is_provably_empty(&entry.path()) {
                return false;
            }
            continue;
        }
        match name.as_ref() {
            MIGRATION_MARKER | "mcp-session-scope.json" => {}
            "audit-enc.db" | "audit-enc.db-wal" | "audit-enc.db-shm" => {
                // The audit store is the ONE DB created merely by opening a
                // workspace, so its presence alone cannot mark real data — else
                // every legacy upgrade (bare open → schema-only `.lantern`
                // audit DB beside the real `.keepance`) would be misread as a
                // conflict and orphan the legacy data. We can't read an
                // encrypted DB's row count, so size is the only available signal:
                // accept it as scaffolding while schema-sized, treat a larger one
                // as real audit history. TRADEOFF: an interim session that logged
                // only a few audit rows (and did nothing else — no mail, vectors,
                // memory, or connectors) may stay under the ceiling and be
                // quarantined as a stub. That is data-preserving (the folder is
                // quarantined, never deleted, and logged with its recovery path),
                // and it favors the far-more-common bare-open upgrade case.
                if entry.metadata().map(|m| m.len()).unwrap_or(u64::MAX) > EMPTY_DB_CEILING {
                    return false;
                }
            }
            // memory.json, mail*.db, *-enc.db, or anything unrecognized → real.
            _ => return false,
        }
    }
    true
}

/// Pick a non-colliding quarantine path for a superseded stub dir, e.g.
/// `.lantern.pre-migration-stub`, then `-1`, `-2`, … Deterministic (no clock).
fn quarantine_path(new_dir: &Path) -> PathBuf {
    let parent = new_dir.parent().unwrap_or_else(|| Path::new("."));
    let base = new_dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| WORKSPACE_DATA_DIR.to_string());
    let first = parent.join(format!("{base}.pre-migration-stub"));
    if !first.exists() {
        return first;
    }
    for n in 1..10_000 {
        let candidate = parent.join(format!("{base}.pre-migration-stub-{n}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    // Astronomically unlikely fallback.
    parent.join(format!("{base}.pre-migration-stub-overflow"))
}

/// Migrate one directory (`old` → `new`) per the marker state machine.
fn migrate_dir(old: &Path, new: &Path) -> DirOutcome {
    let marker_present = new.join(MIGRATION_MARKER).exists();
    match plan_dir(old.exists(), new.exists(), marker_present) {
        DirAction::None(outcome) => {
            if outcome == DirOutcome::AlreadyMigrated {
                ensure_marker(new);
            }
            outcome
        }
        DirAction::Rename => match std::fs::rename(old, new) {
            Ok(()) => {
                ensure_marker(new);
                log::info!(
                    "[data-dir-migration] migrated {} → {}",
                    old.display(),
                    new.display()
                );
                DirOutcome::Migrated
            }
            Err(e) => {
                log::error!(
                    "[data-dir-migration] FAILED to rename {} → {}: {e}. \
                     Keeping the old data in place (fail-safe); will retry next launch.",
                    old.display(),
                    new.display()
                );
                DirOutcome::FailSafe
            }
        },
        DirAction::LeftoverKept => {
            log::warn!(
                "[data-dir-migration] both {} and the migrated {} exist; \
                 keeping the migrated one and leaving the legacy folder untouched \
                 (not merged, not deleted).",
                old.display(),
                new.display()
            );
            DirOutcome::LeftoverOldKept
        }
        DirAction::Promote => {
            // Both exist and `new` has no marker. Before assuming `new` is an
            // empty stub, check whether it holds REAL data — a user who ran a
            // post-rename build could have done real work in `.lantern` while
            // legacy `.keepance` also holds data. In that genuine-conflict case
            // we must NOT revert to the older folder: keep the current `.lantern`
            // active (adopt it by writing the marker) and leave the legacy folder
            // fully intact for manual recovery. Nothing moved, merged, or deleted.
            if !dir_is_pure_stub(new) {
                ensure_marker(new);
                log::error!(
                    "[data-dir-migration] CONFLICT: both {} (legacy) and {} contain data. \
                     Keeping the current data folder ({}) active and leaving the legacy \
                     folder untouched for manual recovery — nothing was merged or deleted.",
                    old.display(),
                    new.display(),
                    new.display()
                );
                return DirOutcome::ConflictKeptNew;
            }
            // `new` is a fresh empty stub created by a post-flip build; `old` has
            // the real data. Set the stub aside (never delete, never merge) and
            // promote the real data into `new`.
            let quarantine = quarantine_path(new);
            match std::fs::rename(new, &quarantine).and_then(|()| std::fs::rename(old, new)) {
                Ok(()) => {
                    ensure_marker(new);
                    log::warn!(
                        "[data-dir-migration] found a legacy {} beside an empty {}; \
                         promoted the legacy data and quarantined the stub at {} \
                         (nothing merged or deleted).",
                        old.display(),
                        new.display(),
                        quarantine.display()
                    );
                    DirOutcome::PromotedOverStub
                }
                Err(e) => {
                    // Best-effort undo of the first rename so we leave a clean
                    // both-exist state (the resolver still prefers the real
                    // `old` data because `new` has no marker).
                    if !new.exists() && quarantine.exists() {
                        let _ = std::fs::rename(&quarantine, new);
                    }
                    log::error!(
                        "[data-dir-migration] FAILED to promote {} over the stub {}: {e}. \
                         Keeping the legacy data in place (fail-safe); will retry next launch.",
                        old.display(),
                        new.display()
                    );
                    DirOutcome::FailSafe
                }
            }
        }
    }
}

/// Migrate one file (`old` → `new`) — used for the vault metadata file. A single
/// file rename is atomic; if `new` already exists it is authoritative (never
/// clobbered) and `old` is left as a harmless leftover.
fn migrate_file(old: &Path, new: &Path) -> FileOutcome {
    match plan_file(old.exists(), new.exists()) {
        FileAction::None(FileOutcome::AlreadyMigrated) if old.exists() => {
            // Potential vault key-material conflict — never auto-pick a side by
            // clobbering: preserve BOTH files intact for manual recovery and log
            // loudly. The app reads the new file; if that is the wrong vault, the
            // legacy one is still on disk to recover from.
            log::error!(
                "[data-dir-migration] CONFLICT: both {} (legacy) and {} exist. \
                 They may reference DIFFERENT vault master keys; NEITHER was moved \
                 or deleted. The app will use the current file — if encrypted files \
                 fail to open, recover from the legacy metadata manually.",
                old.display(),
                new.display()
            );
            FileOutcome::Conflict
        }
        FileAction::None(outcome) => outcome,
        FileAction::Rename => match std::fs::rename(old, new) {
            Ok(()) => {
                log::info!(
                    "[data-dir-migration] migrated {} → {}",
                    old.display(),
                    new.display()
                );
                FileOutcome::Migrated
            }
            Err(e) => {
                log::error!(
                    "[data-dir-migration] FAILED to rename {} → {}: {e} (fail-safe; retry next launch).",
                    old.display(),
                    new.display()
                );
                FileOutcome::FailSafe
            }
        },
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public migration entry points
// ─────────────────────────────────────────────────────────────────────────────

/// Migrate a single workspace's internal data folder and vault-metadata file.
/// Idempotent; safe to call on every workspace open. Never blocks or fails the
/// open — the worst case is a logged fail-safe that leaves the old data usable.
pub fn migrate_workspace(workspace_root: &Path) -> WorkspaceMigrationReport {
    let data_dir = migrate_dir(
        &workspace_root.join(LEGACY_WORKSPACE_DATA_DIR),
        &workspace_root.join(WORKSPACE_DATA_DIR),
    );
    let vault_meta = migrate_file(
        &workspace_root.join(LEGACY_VAULT_META_FILE),
        &workspace_root.join(VAULT_META_FILE),
    );
    WorkspaceMigrationReport {
        data_dir,
        vault_meta,
    }
}

/// Migrate the OS-level data subdir (`dirs::data_dir()/keepance` → `/lantern`),
/// which holds regenerable artifacts (downloaded models, logs). Best-effort,
/// run once at app startup. Returns `None` if the OS data dir is unavailable.
pub fn migrate_os_data_dir() -> Option<DirOutcome> {
    let base = dirs::data_dir()?;
    let outcome = migrate_dir(&base.join(LEGACY_OS_DATA_SUBDIR), &base.join(OS_DATA_SUBDIR));
    Some(outcome)
}

/// Tauri command: migrate the given workspace's data folder at open time.
/// Called from the renderer BEFORE any store (audit/mail/rag/…) is opened.
#[tauri::command]
pub fn migrate_workspace_data_dir(workspace_root: String) -> Result<WorkspaceMigrationReport, String> {
    let root = PathBuf::from(&workspace_root);
    if !root.is_dir() {
        return Err(format!("workspace root is not a directory: {workspace_root}"));
    }
    Ok(migrate_workspace(&root))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // ── Pure planner: exhaustive truth table ─────────────────────────────────

    #[test]
    fn plan_dir_truth_table() {
        assert_eq!(
            plan_dir(false, false, false),
            DirAction::None(DirOutcome::FreshInstall)
        );
        // marker irrelevant when only one side exists
        assert_eq!(
            plan_dir(false, true, false),
            DirAction::None(DirOutcome::AlreadyMigrated)
        );
        assert_eq!(
            plan_dir(false, true, true),
            DirAction::None(DirOutcome::AlreadyMigrated)
        );
        assert_eq!(plan_dir(true, false, false), DirAction::Rename);
        assert_eq!(plan_dir(true, false, true), DirAction::Rename);
        // both exist: marker decides
        assert_eq!(plan_dir(true, true, false), DirAction::Promote);
        assert_eq!(plan_dir(true, true, true), DirAction::LeftoverKept);
    }

    #[test]
    fn plan_file_truth_table() {
        assert_eq!(
            plan_file(false, false),
            FileAction::None(FileOutcome::FreshInstall)
        );
        assert_eq!(
            plan_file(false, true),
            FileAction::None(FileOutcome::AlreadyMigrated)
        );
        assert_eq!(
            plan_file(true, true),
            FileAction::None(FileOutcome::AlreadyMigrated)
        );
        assert_eq!(plan_file(true, false), FileAction::Rename);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    fn old_dir(root: &Path) -> PathBuf {
        root.join(LEGACY_WORKSPACE_DATA_DIR)
    }
    fn new_dir(root: &Path) -> PathBuf {
        root.join(WORKSPACE_DATA_DIR)
    }
    /// Seed a data dir with a recognizable "real data" file.
    fn seed(dir: &Path, marker_file: &str, contents: &[u8]) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join(marker_file), contents).unwrap();
    }

    // ── FS integration ───────────────────────────────────────────────────────

    #[test]
    fn fresh_install_is_noop_and_resolves_to_lantern() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let report = migrate_workspace(root);
        assert_eq!(report.data_dir, DirOutcome::FreshInstall);
        assert_eq!(workspace_data_dir(root), new_dir(root));
        assert_eq!(workspace_data_dir_name(root), WORKSPACE_DATA_DIR);
        // Nothing created on disk.
        assert!(!new_dir(root).exists());
        assert!(!old_dir(root).exists());
    }

    #[test]
    fn legacy_only_is_migrated_with_contents_and_marker() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        seed(&old_dir(root), "mail-enc.db", b"real-mail-data");

        let report = migrate_workspace(root);
        assert_eq!(report.data_dir, DirOutcome::Migrated);

        assert!(!old_dir(root).exists(), "old dir must be gone");
        assert!(new_dir(root).exists(), "new dir must exist");
        assert_eq!(
            fs::read(new_dir(root).join("mail-enc.db")).unwrap(),
            b"real-mail-data",
            "contents must be preserved verbatim"
        );
        assert!(
            new_dir(root).join(MIGRATION_MARKER).exists(),
            "marker must be written"
        );
        assert_eq!(workspace_data_dir(root), new_dir(root));
    }

    #[test]
    fn migration_is_idempotent() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        seed(&old_dir(root), "audit-enc.db", b"x");
        assert_eq!(migrate_workspace(root).data_dir, DirOutcome::Migrated);
        // Second run: new exists, marker present, old absent.
        assert_eq!(migrate_workspace(root).data_dir, DirOutcome::AlreadyMigrated);
        // Third run: still stable.
        assert_eq!(migrate_workspace(root).data_dir, DirOutcome::AlreadyMigrated);
        assert!(new_dir(root).exists());
        assert!(!old_dir(root).exists());
    }

    #[test]
    fn both_exist_stub_promotes_real_data_and_quarantines_stub() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        // Real legacy data.
        seed(&old_dir(root), "mail-enc.db", b"real-data");
        // Fresh stub created by a post-flip build (NO marker), holds an empty db.
        seed(&new_dir(root), "audit-enc.db", b"");

        let report = migrate_workspace(root);
        assert_eq!(report.data_dir, DirOutcome::PromotedOverStub);

        // Real data now lives at .lantern.
        assert_eq!(
            fs::read(new_dir(root).join("mail-enc.db")).unwrap(),
            b"real-data"
        );
        assert!(new_dir(root).join(MIGRATION_MARKER).exists());
        assert!(!old_dir(root).exists(), "legacy dir consumed into .lantern");
        // Stub preserved (not deleted) in a quarantine dir.
        let quarantine = root.join(format!("{WORKSPACE_DATA_DIR}.pre-migration-stub"));
        assert!(quarantine.exists(), "stub must be quarantined, not deleted");
        assert!(quarantine.join("audit-enc.db").exists());
        assert_eq!(workspace_data_dir(root), new_dir(root));
    }

    #[test]
    fn both_exist_with_marker_keeps_new_and_leaves_legacy() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        // Migrated dir (has the marker) + a stale legacy leftover.
        seed(&new_dir(root), "mail-enc.db", b"current");
        fs::write(new_dir(root).join(MIGRATION_MARKER), b"m").unwrap();
        seed(&old_dir(root), "mail-enc.db", b"stale");

        let report = migrate_workspace(root);
        assert_eq!(report.data_dir, DirOutcome::LeftoverOldKept);
        // Neither side touched.
        assert!(old_dir(root).exists());
        assert_eq!(
            fs::read(new_dir(root).join("mail-enc.db")).unwrap(),
            b"current"
        );
        assert_eq!(workspace_data_dir(root), new_dir(root));
    }

    #[test]
    fn both_exist_real_lantern_is_conflict_keeps_new_and_preserves_legacy() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        // Legacy .keepance with data.
        seed(&old_dir(root), "mail-enc.db", b"older-data");
        // .lantern has NO marker but holds REAL data (>128 KiB) — the user did
        // real work on a post-rename build.
        let big = vec![0u8; 200 * 1024];
        seed(&new_dir(root), "audit-enc.db", &big);

        let report = migrate_workspace(root);
        assert_eq!(report.data_dir, DirOutcome::ConflictKeptNew);

        // NEITHER side is moved, merged, or deleted.
        assert!(old_dir(root).exists(), "legacy dir must be preserved intact");
        assert_eq!(
            fs::read(old_dir(root).join("mail-enc.db")).unwrap(),
            b"older-data"
        );
        assert_eq!(fs::read(new_dir(root).join("audit-enc.db")).unwrap().len(), big.len());
        // .lantern is adopted (marker written) and stays active.
        assert!(new_dir(root).join(MIGRATION_MARKER).exists());
        assert_eq!(workspace_data_dir(root), new_dir(root));
        // No quarantine dir was created.
        assert!(!root
            .join(format!("{WORKSPACE_DATA_DIR}.pre-migration-stub"))
            .exists());
    }

    #[test]
    fn dir_is_provably_empty_fails_closed() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        // Empty dir → provably empty.
        let empty = root.join("empty");
        fs::create_dir_all(&empty).unwrap();
        assert!(dir_is_provably_empty(&empty));
        // Populated dir → not empty.
        let full = root.join("full");
        fs::create_dir_all(&full).unwrap();
        fs::write(full.join("f"), b"x").unwrap();
        assert!(!dir_is_provably_empty(&full));
        // Non-existent / unreadable → fail closed (NOT treated as empty).
        assert!(!dir_is_provably_empty(&root.join("does-not-exist")));
    }

    #[test]
    fn lantern_with_populated_subdir_is_a_conflict_not_a_stub() {
        // A populated subdir (e.g. a real vectors dataset) means real work — the
        // dir must NOT be classified as a stub even if no top-level file trips it.
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        seed(&old_dir(root), "mail-enc.db", b"legacy");
        let vectors = new_dir(root).join("vectors");
        fs::create_dir_all(&vectors).unwrap();
        fs::write(vectors.join("data.lance"), b"embeddings").unwrap();
        assert_eq!(migrate_workspace(root).data_dir, DirOutcome::ConflictKeptNew);
        assert!(old_dir(root).exists());
    }

    #[test]
    fn small_real_lantern_data_is_a_conflict_not_a_stub() {
        // Regression (Codex round 3, P1): a SMALL real artifact in .lantern
        // (e.g. memory.json or a connector DB, well under any size threshold)
        // must be treated as a conflict — never quarantined as an empty stub.
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        seed(&old_dir(root), "mail-enc.db", b"legacy-real");
        fs::create_dir_all(new_dir(root)).unwrap();
        fs::write(new_dir(root).join("memory.json"), b"{\"facts\":[\"x\"]}").unwrap();

        assert_eq!(migrate_workspace(root).data_dir, DirOutcome::ConflictKeptNew);
        assert!(old_dir(root).exists(), "legacy preserved");
        assert_eq!(
            fs::read(new_dir(root).join("memory.json")).unwrap(),
            b"{\"facts\":[\"x\"]}"
        );
        // Resolver mirrors the decision even before/without the marker being read.
        assert_eq!(workspace_data_dir(root), new_dir(root));
    }

    #[test]
    fn schema_only_audit_stub_still_promotes_legacy() {
        // The one DB created merely by opening a workspace: a small schema-only
        // audit-enc.db must still count as a stub so the real legacy data wins.
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        seed(&old_dir(root), "mail-enc.db", b"real-legacy-data");
        fs::create_dir_all(new_dir(root)).unwrap();
        fs::write(new_dir(root).join("audit-enc.db"), vec![0u8; 20 * 1024]).unwrap();
        fs::write(new_dir(root).join("mcp-session-scope.json"), b"{}").unwrap();

        assert_eq!(migrate_workspace(root).data_dir, DirOutcome::PromotedOverStub);
        assert_eq!(
            fs::read(new_dir(root).join("mail-enc.db")).unwrap(),
            b"real-legacy-data"
        );
    }

    #[test]
    fn resolver_prefers_real_lantern_over_legacy_when_unmarked() {
        // Regression (Codex round 3, P1): with both dirs present, no marker, and
        // REAL data in .lantern, the pure resolver must return .lantern (not fork
        // back onto legacy) even before migrate_workspace runs.
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        seed(&old_dir(root), "mail-enc.db", b"legacy");
        fs::create_dir_all(new_dir(root)).unwrap();
        fs::write(new_dir(root).join("memory.json"), b"real").unwrap();
        assert_eq!(workspace_data_dir(root), new_dir(root));
        assert_eq!(workspace_data_dir_name(root), WORKSPACE_DATA_DIR);
    }

    #[test]
    fn both_exist_real_lantern_via_mail_blob_is_conflict() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        seed(&old_dir(root), "mail-enc.db", b"older");
        // A single (small) imported mail blob is a definitive "real data" signal.
        let blobs = new_dir(root).join("mail").join("blobs");
        fs::create_dir_all(&blobs).unwrap();
        fs::write(blobs.join("abc.enc"), b"tiny-but-real").unwrap();

        assert_eq!(migrate_workspace(root).data_dir, DirOutcome::ConflictKeptNew);
        assert!(old_dir(root).exists());
        assert!(new_dir(root).join(MIGRATION_MARKER).exists());
    }

    #[test]
    fn resolver_prefers_legacy_when_only_legacy_exists() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        seed(&old_dir(root), "mail.db", b"x");
        // No migration run yet: resolver must point at the legacy dir in place.
        assert_eq!(workspace_data_dir(root), old_dir(root));
        assert_eq!(workspace_data_dir_name(root), LEGACY_WORKSPACE_DATA_DIR);
    }

    #[test]
    fn resolver_prefers_real_legacy_over_unmarked_stub() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        seed(&old_dir(root), "mail.db", b"real");
        seed(&new_dir(root), "audit-enc.db", b""); // stub, no marker
        // Even before migration runs, the resolver must prefer the real data.
        assert_eq!(workspace_data_dir(root), old_dir(root));
        assert_eq!(workspace_data_dir_name(root), LEGACY_WORKSPACE_DATA_DIR);
    }

    #[test]
    fn quarantine_name_collision_gets_a_counter() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        seed(&old_dir(root), "mail-enc.db", b"real");
        seed(&new_dir(root), "audit-enc.db", b"");
        // Pre-create the default quarantine name to force the counter path.
        fs::create_dir_all(root.join(format!("{WORKSPACE_DATA_DIR}.pre-migration-stub"))).unwrap();

        assert_eq!(migrate_workspace(root).data_dir, DirOutcome::PromotedOverStub);
        assert!(root
            .join(format!("{WORKSPACE_DATA_DIR}.pre-migration-stub-1"))
            .exists());
    }

    // ── resolve_workspace_relative ───────────────────────────────────────────

    #[test]
    fn resolve_relative_rewrites_legacy_prefix_to_live_name() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        // After migration, the live dir is `.lantern`, but old mail rows store
        // `.keepance/...` — they must resolve to the physical `.lantern` file.
        seed(&new_dir(root), "x", b"");
        fs::write(new_dir(root).join(MIGRATION_MARKER), b"m").unwrap();

        let resolved = resolve_workspace_relative(root, ".keepance/mail/blobs/abc.enc");
        assert_eq!(resolved, new_dir(root).join("mail/blobs/abc.enc"));

        // A current-prefixed row resolves to the same place.
        let resolved2 = resolve_workspace_relative(root, ".lantern/mail/blobs/abc.enc");
        assert_eq!(resolved2, new_dir(root).join("mail/blobs/abc.enc"));
    }

    #[test]
    fn resolve_relative_passes_through_non_data_dir_paths() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let resolved = resolve_workspace_relative(root, "Mail/Inbox/msg.md");
        assert_eq!(resolved, root.join("Mail/Inbox/msg.md"));
    }

    #[test]
    fn resolve_relative_handles_backslashes() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        seed(&old_dir(root), "x", b""); // live name is legacy here
        let resolved = resolve_workspace_relative(root, ".keepance\\mail\\blobs\\z.enc");
        assert_eq!(resolved, old_dir(root).join("mail/blobs/z.enc"));
    }

    #[test]
    fn is_data_dir_name_matches_both_and_is_case_insensitive() {
        assert!(is_workspace_data_dir_name(".lantern"));
        assert!(is_workspace_data_dir_name(".keepance"));
        assert!(is_workspace_data_dir_name(".Lantern"));
        assert!(is_workspace_data_dir_name(".KEEPANCE"));
        assert!(!is_workspace_data_dir_name("docs"));
        assert!(!is_workspace_data_dir_name(".lantern-vault.json"));
    }

    // ── Vault metadata file ──────────────────────────────────────────────────

    #[test]
    fn vault_meta_legacy_only_is_renamed() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(root.join(LEGACY_VAULT_META_FILE), b"{\"vmk\":1}").unwrap();
        let report = migrate_workspace(root);
        assert_eq!(report.vault_meta, FileOutcome::Migrated);
        assert!(!root.join(LEGACY_VAULT_META_FILE).exists());
        assert_eq!(
            fs::read(root.join(VAULT_META_FILE)).unwrap(),
            b"{\"vmk\":1}"
        );
    }

    #[test]
    fn vault_meta_new_wins_when_both_exist() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(root.join(LEGACY_VAULT_META_FILE), b"legacy").unwrap();
        fs::write(root.join(VAULT_META_FILE), b"current").unwrap();
        let report = migrate_workspace(root);
        // Both vault metas present → potential VMK conflict: preserve BOTH.
        assert_eq!(report.vault_meta, FileOutcome::Conflict);
        assert_eq!(fs::read(root.join(VAULT_META_FILE)).unwrap(), b"current");
        assert_eq!(fs::read(root.join(LEGACY_VAULT_META_FILE)).unwrap(), b"legacy");
    }

    #[test]
    fn vault_meta_fresh_is_noop() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        assert_eq!(migrate_workspace(root).vault_meta, FileOutcome::FreshInstall);
    }
}
