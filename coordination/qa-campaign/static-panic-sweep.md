
`meeting_started_ms()` does `&name[..10]`. That is byte slicing. If the first 10 bytes land inside a Unicode character, Rust panics.

Trigger: finalized meeting folder with no usable `transcript.json` `meta.startedAt`, and a folder name like `aaaaaaaaaé-meeting` where byte 10 is inside `é`.

User impact: retention cleanup fails instead of falling back to modified time. Since this runs during cleanup, old audio/transcripts may not be removed.

Recommended fix:

```diff
- if name.len() >= 10 {
-     if let Ok(date) = chrono::NaiveDate::parse_from_str(&name[..10], "%Y-%m-%d") {
+ if let Some(prefix) = name.get(..10) {
+     if let Ok(date) = chrono::NaiveDate::parse_from_str(prefix, "%Y-%m-%d") {
```

3. **P1: Many shared stores use `Mutex::lock().unwrap()`**
Representative lines:
[file](/home/jameson/lantern-plus/src-tauri/src/commands/capture/engine.rs:328), [capture engine](/home/jameson/lantern-plus/src-tauri/src/commands/capture/engine.rs:354), [calendar store](/home/jameson/lantern-plus/src-tauri/src/commands/calendar/store.rs:137), [mail store](/home/jameson/lantern-plus/src-tauri/src/commands/mail/store.rs:592), [audit store](/home/jameson/lantern-plus/src-tauri/src/commands/audit/store.rs:568), [CRM store](/home/jameson/lantern-plus/src-tauri/src/commands/crm/store.rs:262)

If any panic happens while one of these locks is held, Rust marks the lock as “poisoned”. After that, normal future calls can panic at `.lock().unwrap()`.

User impact: one crash can turn into repeated broken commands until app restart. In capture, this is more serious because `StoppingGuard::drop()` also unwraps the lock; a panic during cleanup can become a double-panic risk.

Recommended fix: add a tiny helper and use it for shared state locks:

```rust
fn unpoison<T>(r: std::sync::LockResult<T>) -> T {
    r.unwrap_or_else(|p| p.into_inner())
}
```

Then replace:

```diff
- let conn = self.conn.lock().unwrap();
+ let conn = unpoison(self.conn.lock());
```

For places where corrupted state should stop the command, return a clean `Err(...)` instead of panicking.

4. **P2: Bad diarization sidecar output can underflow duration math**
[file](/home/jameson/lantern-plus/src-tauri/src/commands/diarize/mod.rs:396)

```rust
total_ms: s.turns.iter().map(|t| t.end_ms - t.start_ms).sum(),
```

Trigger: sidecar returns a turn where `end_ms < start_ms`.

User impact: debug/overflow-check builds can panic; release builds can wrap into a huge bogus duration.

Recommended fix:

```diff
- total_ms: s.turns.iter().map(|t| t.end_ms - t.start_ms).sum(),
+ total_ms: s.turns.iter().map(|t| t.end_ms.saturating_sub(t.start_ms)).sum(),
```

Better: validate sidecar JSON and reject invalid turns with a clean error.

**Checked As Safe**
- Vault recovery `split_at(12)` is guarded by a length check first.
- Vault encrypted blob indexing is guarded by length/magic checks.
- Calendar `unfold()` `last_mut().unwrap()` is guarded by `!out.is_empty()`.
- Calendar `date.and_hms_opt(0,0,0).unwrap()` is safe after a valid date parse.
- Capture chunk writer unwraps are internal invariants after constructor setup.
- DOCX parser byte slices use XML parser byte positions, not guessed user string indexes; I did not find a concrete panic path there.

No tests were run; this was a read-only static sweep.
