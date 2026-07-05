use std::sync::{Mutex, MutexGuard};

/// Lock a shared state mutex without letting a previous panic permanently
/// brick the feature. A poisoned mutex means some earlier thread panicked
/// while holding the guard; it does not by itself prove the protected value is
/// corrupt. Recover the guard and clear the poison flag so later calls do not
/// keep tripping over the same old panic.
pub(crate) fn lock_unpoison<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::warn!("recovering from a poisoned mutex");
            mutex.clear_poison();
            poisoned.into_inner()
        }
    }
}
