// Workspace file watcher - Phase 2 Rust foundation for v1.5.
//
// `watch_workspace(path)` starts a `notify` recursive watcher on the given
// path. Every filesystem event is normalised into a `{ path, kind }` shape
// and emitted to the frontend as the Tauri event `workspace-file-changed`.
//
// Only ONE watcher is active at a time. Calling `watch_workspace` with a
// new path tears down the previous watcher before starting the new one.
// Bursts of events on the same path are coalesced by a 200ms debounce so
// we don't spam the frontend (Phase 3 RAG indexer will thank us — saving
// a file in most editors emits create/modify pairs).

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Debounce window for coalescing bursts of events on a single path.
/// 200ms is long enough to suppress the create+modify pair most editors
/// emit on save, short enough that interactive usage still feels live.
const DEBOUNCE_MS: u64 = 200;

/// Name of the Tauri event the frontend subscribes to.
pub const EVENT_NAME: &str = "workspace-file-changed";

/// Payload emitted on `workspace-file-changed`. Serialised as camelCase so
/// the TypeScript binding reads naturally.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileChangePayload {
    pub path: String,
    pub kind: ChangeKind,
}

/// Simplified change kind. `notify`'s full enum has ~20 variants most UIs
/// don't care about — we collapse to the four that matter for RAG /
/// file-tree refresh: create / modify / delete / rename.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Create,
    Modify,
    Delete,
    Rename,
}

/// Map a `notify` event kind to our narrower public kind. Returns `None`
/// for event kinds we don't surface (access events, "other", etc).
pub fn map_event_kind(kind: &EventKind) -> Option<ChangeKind> {
    use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};
    match kind {
        EventKind::Create(CreateKind::File | CreateKind::Folder | CreateKind::Any) => {
            Some(ChangeKind::Create)
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::To | RenameMode::From | RenameMode::Both)) => {
            Some(ChangeKind::Rename)
        }
        EventKind::Modify(_) => Some(ChangeKind::Modify),
        EventKind::Remove(RemoveKind::File | RemoveKind::Folder | RemoveKind::Any) => {
            Some(ChangeKind::Delete)
        }
        _ => None,
    }
}

/// Debouncer: decides whether a (path, kind) event should fire NOW or be
/// suppressed because the same path already fired within `DEBOUNCE_MS`.
///
/// Pure data structure so it can be unit-tested without time. The `now`
/// parameter is injected.
#[derive(Debug, Default)]
pub struct Debouncer {
    last_emit: HashMap<String, Instant>,
    window: Duration,
}

impl Debouncer {
    pub fn new(window_ms: u64) -> Self {
        Self {
            last_emit: HashMap::new(),
            window: Duration::from_millis(window_ms),
        }
    }

    /// Returns `true` if this (path, kind) should be emitted now. Updates
    /// the internal "last seen" timestamp on emit. Called once per event.
    pub fn should_emit(&mut self, path: &str, now: Instant) -> bool {
        let should = match self.last_emit.get(path) {
            Some(&prev) => now.duration_since(prev) >= self.window,
            None => true,
        };
        if should {
            self.last_emit.insert(path.to_string(), now);
        }
        should
    }
}

/// Handle to the currently-active watcher. Stored in Tauri's shared state
/// via `app.manage(...)` in Phase 4 wiring; for Phase 2 we just stash it
/// in a module-level `Mutex` since the watcher is a singleton anyway.
struct ActiveWatcher {
    _watcher: RecommendedWatcher,
    _debouncer: Arc<Mutex<Debouncer>>,
}

static WATCHER_SLOT: Mutex<Option<ActiveWatcher>> = Mutex::new(None);

/// Start (or replace) the workspace watcher. Emits `workspace-file-changed`
/// for every change inside `path` that passes the debouncer.
#[tauri::command]
pub async fn watch_workspace(app: AppHandle, path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("watch target does not exist: {}", path));
    }

    // Build the new debouncer + watcher BEFORE tearing down the old one,
    // so a user navigating between workspaces doesn't see an event gap.
    let debouncer = Arc::new(Mutex::new(Debouncer::new(DEBOUNCE_MS)));
    let debouncer_for_closure = Arc::clone(&debouncer);
    let app_handle = app.clone();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(ev) = res else { return };
        let Some(kind) = map_event_kind(&ev.kind) else {
            return;
        };
        let now = Instant::now();
        for p in ev.paths.iter() {
            let p_str = p.to_string_lossy().to_string();
            let emit = {
                let mut d = debouncer_for_closure.lock().expect("debouncer poisoned");
                d.should_emit(&p_str, now)
            };
            if !emit {
                continue;
            }
            let payload = FileChangePayload {
                path: p_str,
                kind: kind.clone(),
            };
            let _ = app_handle.emit(EVENT_NAME, payload);
        }
    })
    .map_err(|e| format!("failed to create watcher: {}", e))?;

    watcher
        .watch(&target, RecursiveMode::Recursive)
        .map_err(|e| format!("failed to start watcher: {}", e))?;

    // Replace any existing watcher AFTER the new one is live.
    let mut slot = WATCHER_SLOT.lock().map_err(|e| format!("watcher slot poisoned: {}", e))?;
    *slot = Some(ActiveWatcher {
        _watcher: watcher,
        _debouncer: debouncer,
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debouncer_emits_first_event_for_a_path() {
        let mut d = Debouncer::new(200);
        let t0 = Instant::now();
        assert!(d.should_emit("/a.md", t0));
    }

    #[test]
    fn debouncer_suppresses_second_event_within_window() {
        let mut d = Debouncer::new(200);
        let t0 = Instant::now();
        assert!(d.should_emit("/a.md", t0));
        assert!(!d.should_emit("/a.md", t0 + Duration::from_millis(50)));
        assert!(!d.should_emit("/a.md", t0 + Duration::from_millis(199)));
    }

    #[test]
    fn debouncer_emits_after_window_expires() {
        let mut d = Debouncer::new(200);
        let t0 = Instant::now();
        assert!(d.should_emit("/a.md", t0));
        assert!(d.should_emit("/a.md", t0 + Duration::from_millis(200)));
        assert!(d.should_emit("/a.md", t0 + Duration::from_millis(500)));
    }

    #[test]
    fn debouncer_tracks_paths_independently() {
        let mut d = Debouncer::new(200);
        let t0 = Instant::now();
        assert!(d.should_emit("/a.md", t0));
        // Different path -> not suppressed.
        assert!(d.should_emit("/b.md", t0 + Duration::from_millis(10)));
        // Same path again -> still suppressed.
        assert!(!d.should_emit("/a.md", t0 + Duration::from_millis(20)));
    }

    #[test]
    fn map_event_kind_covers_the_four_public_kinds() {
        use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};
        assert_eq!(
            map_event_kind(&EventKind::Create(CreateKind::File)),
            Some(ChangeKind::Create)
        );
        assert_eq!(
            map_event_kind(&EventKind::Modify(ModifyKind::Data(
                notify::event::DataChange::Content
            ))),
            Some(ChangeKind::Modify)
        );
        assert_eq!(
            map_event_kind(&EventKind::Modify(ModifyKind::Name(RenameMode::Both))),
            Some(ChangeKind::Rename)
        );
        assert_eq!(
            map_event_kind(&EventKind::Remove(RemoveKind::File)),
            Some(ChangeKind::Delete)
        );
    }

    #[test]
    fn map_event_kind_returns_none_for_access_events() {
        let access = EventKind::Access(notify::event::AccessKind::Read);
        assert_eq!(map_event_kind(&access), None);
    }

    #[test]
    fn payload_serializes_camel_case() {
        let payload = FileChangePayload {
            path: "/w/a.md".into(),
            kind: ChangeKind::Create,
        };
        let s = serde_json::to_string(&payload).expect("serialize");
        assert!(s.contains("\"path\":\"/w/a.md\""));
        // Kind variants are camelCase.
        assert!(s.contains("\"kind\":\"create\""), "got {}", s);
    }
}
