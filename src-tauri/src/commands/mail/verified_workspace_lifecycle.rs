//! Native-only ownership of the one M4 workspace generation.
//!
//! A renderer can ask the desktop host to inspect a selected folder, but it
//! never receives a workspace authority.  This module validates the existing
//! CRM database before it opens it, owns that live store, and mints the opaque
//! authority only while a current borrow is held.

#![allow(dead_code)] // M4 consumers land after this dark foundation.

use anyhow::{bail, Context, Result};
use rand::{distributions::Alphanumeric, Rng};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
};

use crate::commands::crm::core_store::CrmCoreStore;

/// A native capability, not an identifier supplied by a caller.  Its fields
/// remain private to this module; mail siblings can only carry and compare it.
#[derive(Debug)]
pub(super) struct VerifiedWorkspaceAuthority {
    native_handle: String,
    generation: u64,
}

impl VerifiedWorkspaceAuthority {
    pub(super) fn native_handle(&self) -> &str {
        &self.native_handle
    }

    pub(super) fn generation(&self) -> u64 {
        self.generation
    }

    pub(super) fn is_well_formed(&self) -> bool {
        !self.native_handle.trim().is_empty() && self.generation != 0
    }
}

/// The live borrow used by later M4 work.  Holding it keeps an already-started
/// operation safe while a close or workspace switch waits; dropping it lets the
/// revocation proceed.  It is deliberately neither cloneable nor serializable.
pub(super) struct VerifiedWorkspaceBorrow {
    authority: VerifiedWorkspaceAuthority,
    store: Arc<CrmCoreStore>,
    lease: Arc<WorkspaceLease>,
}

impl VerifiedWorkspaceBorrow {
    pub(super) fn authority(&self) -> &VerifiedWorkspaceAuthority {
        &self.authority
    }

    pub(super) fn store(&self) -> &CrmCoreStore {
        &self.store
    }
}

impl Drop for VerifiedWorkspaceBorrow {
    fn drop(&mut self) {
        self.lease.finish_borrow();
    }
}

#[derive(Debug)]
struct WorkspaceLease {
    state: Mutex<WorkspaceLeaseState>,
    drained: Condvar,
}

#[derive(Debug)]
struct WorkspaceLeaseState {
    accepts_new_borrows: bool,
    active_borrows: usize,
}

impl WorkspaceLease {
    fn new() -> Self {
        Self {
            state: Mutex::new(WorkspaceLeaseState {
                accepts_new_borrows: true,
                active_borrows: 0,
            }),
            drained: Condvar::new(),
        }
    }

    fn start_borrow(&self) -> Result<()> {
        let mut state = lock_unpoison(&self.state);
        if !state.accepts_new_borrows {
            bail!("M4 workspace generation is no longer current")
        }
        state.active_borrows += 1;
        Ok(())
    }

    fn revoke_and_wait(&self) {
        let mut state = lock_unpoison(&self.state);
        state.accepts_new_borrows = false;
        while state.active_borrows != 0 {
            state = self
                .drained
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    fn finish_borrow(&self) {
        let mut state = lock_unpoison(&self.state);
        debug_assert!(state.active_borrows != 0, "M4 borrow released twice");
        state.active_borrows = state.active_borrows.saturating_sub(1);
        if state.active_borrows == 0 {
            self.drained.notify_all();
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct DatabaseIdentity {
    canonical_database: PathBuf,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(windows)]
    volume_serial: u32,
    #[cfg(windows)]
    file_index: u64,
}

impl DatabaseIdentity {
    fn read(database: &Path) -> Result<Self> {
        let metadata = fs::symlink_metadata(database)
            .with_context(|| format!("inspect CRM database {}", database.display()))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            bail!("CRM database must be a readable regular file")
        }
        fs::File::open(database)
            .with_context(|| format!("read CRM database {}", database.display()))?;
        let canonical_database = fs::canonicalize(database)
            .with_context(|| format!("canonicalize CRM database {}", database.display()))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            return Ok(Self {
                canonical_database,
                device: metadata.dev(),
                inode: metadata.ino(),
            });
        }

        #[cfg(windows)]
        {
            use std::mem::zeroed;
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Storage::FileSystem::{
                GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
            };

            let file = fs::File::open(database)
                .with_context(|| format!("read CRM database {}", database.display()))?;
            let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { zeroed() };
            let read =
                unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut information) };
            if read == 0 {
                bail!("read CRM database file identity failed")
            }
            return Ok(Self {
                canonical_database,
                volume_serial: information.dwVolumeSerialNumber,
                file_index: ((information.nFileIndexHigh as u64) << 32)
                    | information.nFileIndexLow as u64,
            });
        }

        #[cfg(not(any(unix, windows)))]
        {
            Ok(Self { canonical_database })
        }
    }
}

struct CurrentNativeWorkspaceState {
    native_handle: String,
    generation: u64,
    store: Option<Arc<CrmCoreStore>>,
    database_identity: Option<DatabaseIdentity>,
    lease: Arc<WorkspaceLease>,
}

impl CurrentNativeWorkspaceState {
    fn authority(&self) -> VerifiedWorkspaceAuthority {
        VerifiedWorkspaceAuthority {
            native_handle: self.native_handle.clone(),
            generation: self.generation,
        }
    }

    fn database_is_current(&self) -> bool {
        let Some(expected) = self.database_identity.as_ref() else {
            return false;
        };
        matches!(
            DatabaseIdentity::read(&expected.canonical_database),
            Ok(observed) if observed == *expected
        )
    }
}

/// State held by the native host, never renderer or path input.  `MailState`
/// creates a fresh instance at process start, so no authority survives restart.
#[derive(Default)]
pub(super) struct NativeWorkspaceLifecycle {
    current: Option<CurrentNativeWorkspaceState>,
    next_generation: u64,
}

impl NativeWorkspaceLifecycle {
    /// Production entry point.  It rejects anything except an already-existing,
    /// readable encrypted CRM workspace before `CrmCoreStore::open` can create
    /// a data directory or a database.
    pub(super) fn open_selected(&mut self, selected_root: &Path) -> Result<()> {
        self.open_selected_with(selected_root, CrmCoreStore::open)
    }

    fn open_selected_with(
        &mut self,
        selected_root: &Path,
        open_store: impl FnOnce(&Path) -> Result<CrmCoreStore>,
    ) -> Result<()> {
        // Revocation comes first.  A failed new open deliberately leaves no
        // usable old generation behind.
        self.revoke_current();

        let canonical_root = canonical_existing_workspace_root(selected_root)?;
        let database = existing_crm_database(&canonical_root)?;
        let database_identity = DatabaseIdentity::read(&database)?;
        let store =
            Arc::new(open_store(&canonical_root).context("open existing encrypted CRM store")?);
        let generation = self
            .next_generation
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("M4 workspace generation exhausted"))?;
        self.next_generation = generation;
        self.current = Some(CurrentNativeWorkspaceState {
            native_handle: native_handle(),
            generation,
            store: Some(store),
            database_identity: Some(database_identity),
            lease: Arc::new(WorkspaceLease::new()),
        });
        Ok(())
    }

    /// Internal close/revoke operation for future explicit close UI and for a
    /// failed or superseded switch.  It blocks new borrows then waits only for
    /// an operation that already held a borrow to finish safely.
    pub(super) fn revoke_current(&mut self) {
        if let Some(current) = self.current.take() {
            current.lease.revoke_and_wait();
        }
    }

    fn borrow_current(&mut self) -> Result<VerifiedWorkspaceBorrow> {
        let database_is_current = self
            .current
            .as_ref()
            .map(CurrentNativeWorkspaceState::database_is_current)
            .unwrap_or(false);
        if !database_is_current {
            // A replaced, deleted, or otherwise changed database invalidates
            // the generation before any later M4 caller can receive it.
            self.revoke_current();
            bail!("no current verified M4 workspace")
        }
        let current = self.current.as_ref().expect("checked current workspace");
        current.lease.start_borrow()?;
        let Some(store) = current.store.clone() else {
            current.lease.finish_borrow();
            bail!("current M4 workspace has no live CRM store")
        };
        Ok(VerifiedWorkspaceBorrow {
            authority: current.authority(),
            store,
            lease: current.lease.clone(),
        })
    }

    fn authority_for_current_workspace(&self) -> Result<VerifiedWorkspaceAuthority> {
        let current = self
            .current
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("no current native workspace"))?;
        if current.native_handle.trim().is_empty() || current.generation == 0 {
            bail!("current native workspace state is invalid")
        }
        Ok(current.authority())
    }

    #[cfg(test)]
    fn authority_is_current(&self, authority: &VerifiedWorkspaceAuthority) -> bool {
        self.current.as_ref().is_some_and(|current| {
            current.database_is_current()
                && current.native_handle == authority.native_handle
                && current.generation == authority.generation
        })
    }
}

fn canonical_existing_workspace_root(selected_root: &Path) -> Result<PathBuf> {
    if !selected_root.is_absolute() {
        bail!("selected workspace must be an absolute path")
    }
    if selected_root
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        bail!("selected workspace must not contain traversal")
    }
    let metadata = fs::symlink_metadata(selected_root)
        .with_context(|| format!("inspect selected workspace {}", selected_root.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        bail!("selected workspace must be a real directory, not a symlink")
    }
    fs::read_dir(selected_root)
        .with_context(|| format!("read selected workspace {}", selected_root.display()))?;
    fs::canonicalize(selected_root).with_context(|| {
        format!(
            "canonicalize selected workspace {}",
            selected_root.display()
        )
    })
}

fn existing_crm_database(canonical_root: &Path) -> Result<PathBuf> {
    let data_dir = crate::commands::data_dir::workspace_data_dir(canonical_root);
    let data_metadata = fs::symlink_metadata(&data_dir)
        .with_context(|| format!("inspect workspace data directory {}", data_dir.display()))?;
    if data_metadata.file_type().is_symlink() || !data_metadata.is_dir() {
        bail!("workspace data directory must be a real directory, not a symlink")
    }
    fs::read_dir(&data_dir)
        .with_context(|| format!("read workspace data directory {}", data_dir.display()))?;

    let database = CrmCoreStore::db_path(canonical_root);
    // `DatabaseIdentity::read` performs the no-symlink, regular-file and
    // readable checks.  Do it here too so callers receive the rejection before
    // a store open can ever create or repair a missing database.
    DatabaseIdentity::read(&database)?;
    Ok(database)
}

fn native_handle() -> String {
    let suffix: String = rand::thread_rng()
        .sample_iter(Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    format!("m4-native-{suffix}")
}

fn lock_unpoison<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
pub(super) fn test_only_native_workspace_lifecycle(
    native_handle: &str,
    generation: u64,
) -> NativeWorkspaceLifecycle {
    NativeWorkspaceLifecycle {
        current: Some(CurrentNativeWorkspaceState {
            native_handle: native_handle.to_string(),
            generation,
            store: None,
            database_identity: None,
            lease: Arc::new(WorkspaceLease::new()),
        }),
        next_generation: generation,
    }
}

#[cfg(test)]
pub(super) fn load_current_workspace_from_native_owner(
    lifecycle: &NativeWorkspaceLifecycle,
) -> Result<VerifiedWorkspaceAuthority> {
    lifecycle.authority_for_current_workspace()
}

#[cfg(test)]
pub(crate) fn test_only_current_workspace_authority(
    native_handle: &str,
    generation: u64,
) -> VerifiedWorkspaceAuthority {
    let lifecycle = test_only_native_workspace_lifecycle(native_handle, generation);
    load_current_workspace_from_native_owner(&lifecycle).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, sync::mpsc, thread, time::Duration};
    use tempfile::TempDir;

    fn key(value: u8) -> [u8; 32] {
        [value; 32]
    }

    fn fixture(key: &[u8; 32]) -> TempDir {
        let workspace = TempDir::new().unwrap();
        CrmCoreStore::open_with_key(workspace.path(), key).unwrap();
        workspace
    }

    fn open_with_key(
        lifecycle: &mut NativeWorkspaceLifecycle,
        root: &Path,
        key: [u8; 32],
    ) -> Result<()> {
        lifecycle.open_selected_with(root, |workspace| {
            CrmCoreStore::open_with_key(workspace, &key)
        })
    }

    #[test]
    fn m4_workspace_lifecycle_refuses_renderer_like_paths_and_missing_data() {
        let mut lifecycle = NativeWorkspaceLifecycle::default();
        assert!(open_with_key(&mut lifecycle, Path::new("relative"), key(1)).is_err());
        assert!(open_with_key(&mut lifecycle, Path::new("/tmp/../tmp"), key(1)).is_err());
        assert!(open_with_key(
            &mut lifecycle,
            Path::new("/definitely/not/a/workspace"),
            key(1)
        )
        .is_err());
        let empty = TempDir::new().unwrap();
        assert!(open_with_key(&mut lifecycle, empty.path(), key(1)).is_err());
        assert!(lifecycle.borrow_current().is_err());
    }

    #[test]
    fn m4_workspace_lifecycle_refuses_broken_wrong_key_and_store_open_failure() {
        let fixture = fixture(&key(2));
        let mut lifecycle = NativeWorkspaceLifecycle::default();
        assert!(open_with_key(&mut lifecycle, fixture.path(), key(3)).is_err());
        assert!(lifecycle
            .open_selected_with(fixture.path(), |_| bail!(
                "simulated encrypted store failure"
            ))
            .is_err());

        let broken = TempDir::new().unwrap();
        let data = crate::commands::data_dir::workspace_data_dir(broken.path());
        fs::create_dir(&data).unwrap();
        fs::write(data.join("crm-core-enc.db"), b"not a CRM database").unwrap();
        assert!(open_with_key(&mut lifecycle, broken.path(), key(2)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn m4_workspace_lifecycle_refuses_symlinked_workspace_data_and_database() {
        use std::os::unix::fs::symlink;

        let target = fixture(&key(4));
        let root_link_parent = TempDir::new().unwrap();
        let root_link = root_link_parent.path().join("workspace-link");
        symlink(target.path(), &root_link).unwrap();
        let mut lifecycle = NativeWorkspaceLifecycle::default();
        assert!(open_with_key(&mut lifecycle, &root_link, key(4)).is_err());

        let data_link = TempDir::new().unwrap();
        symlink(
            crate::commands::data_dir::workspace_data_dir(target.path()),
            data_link.path().join(".lantern"),
        )
        .unwrap();
        assert!(open_with_key(&mut lifecycle, data_link.path(), key(4)).is_err());

        let database_link = fixture(&key(4));
        let database = CrmCoreStore::db_path(database_link.path());
        let replacement = database.with_extension("replacement");
        fs::rename(&database, &replacement).unwrap();
        symlink(&replacement, &database).unwrap();
        assert!(open_with_key(&mut lifecycle, database_link.path(), key(4)).is_err());
    }

    #[test]
    fn m4_workspace_lifecycle_switches_replays_and_closes_fail_closed() {
        let first = fixture(&key(5));
        let second = fixture(&key(5));
        let mut lifecycle = NativeWorkspaceLifecycle::default();
        open_with_key(&mut lifecycle, first.path(), key(5)).unwrap();
        let first_borrow = lifecycle.borrow_current().unwrap();
        let first_generation = first_borrow.authority().generation();
        drop(first_borrow);

        // A renderer replay is a new native generation, never a reused handle.
        open_with_key(&mut lifecycle, first.path(), key(5)).unwrap();
        let replay = lifecycle.borrow_current().unwrap();
        assert_ne!(replay.authority().generation(), first_generation);
        drop(replay);

        open_with_key(&mut lifecycle, second.path(), key(5)).unwrap();
        let current = lifecycle.borrow_current().unwrap();
        assert_ne!(current.authority().generation(), first_generation);
        drop(current);
        lifecycle.revoke_current();
        assert!(lifecycle.borrow_current().is_err());
    }

    #[test]
    fn m4_workspace_lifecycle_switch_waits_for_started_borrow_then_revokes_old_generation() {
        let first = fixture(&key(6));
        let second = fixture(&key(6));
        let lifecycle = Arc::new(Mutex::new(NativeWorkspaceLifecycle::default()));
        open_with_key(&mut lock_unpoison(&lifecycle), first.path(), key(6)).unwrap();
        let borrow = lock_unpoison(&lifecycle).borrow_current().unwrap();
        let old_generation = borrow.authority().generation();
        let (started_tx, started_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let lifecycle_for_switch = lifecycle.clone();
        let second_path = second.path().to_path_buf();
        thread::spawn(move || {
            started_tx.send(()).unwrap();
            let mut owner = lock_unpoison(&lifecycle_for_switch);
            let result = open_with_key(&mut owner, &second_path, key(6));
            done_tx.send(result).unwrap();
        });
        started_rx.recv().unwrap();
        assert!(done_rx.recv_timeout(Duration::from_millis(50)).is_err());
        drop(borrow);
        done_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        let current = lock_unpoison(&lifecycle).borrow_current().unwrap();
        assert_ne!(current.authority().generation(), old_generation);
    }

    #[test]
    fn m4_workspace_lifecycle_replacement_restart_and_stale_authority_fail_closed() {
        let workspace = fixture(&key(7));
        let mut lifecycle = NativeWorkspaceLifecycle::default();
        open_with_key(&mut lifecycle, workspace.path(), key(7)).unwrap();
        let stale = lifecycle.borrow_current().unwrap();
        let stale_handle = stale.authority().native_handle().to_string();
        let stale_generation = stale.authority().generation();
        drop(stale);

        let database = CrmCoreStore::db_path(workspace.path());
        fs::remove_file(&database).unwrap();
        CrmCoreStore::open_with_key(workspace.path(), &key(7)).unwrap();
        assert!(lifecycle.borrow_current().is_err());
        assert!(lifecycle.current.is_none());

        // A fresh process has no remembered M4 authority, even if a renderer
        // still knows an old opaque handle and generation.
        let mut restarted = NativeWorkspaceLifecycle::default();
        assert!(restarted.borrow_current().is_err());
        assert!(
            !restarted.authority_is_current(&VerifiedWorkspaceAuthority {
                native_handle: stale_handle,
                generation: stale_generation,
            })
        );
    }

    #[test]
    fn m4_shared_foundation_only_native_lifecycle_can_mint_workspace_authority() {
        assert!(NativeWorkspaceLifecycle::default()
            .authority_for_current_workspace()
            .is_err());
        let authority = test_only_current_workspace_authority("native-workspace-a", 7);
        assert_eq!(authority.native_handle(), "native-workspace-a");
        assert_eq!(authority.generation(), 7);
    }
}
