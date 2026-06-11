//! Crash-safe atomic file write: write to a temp sibling, fsync, then atomically rename over the target.
//! Implements §6 of the encrypted-workspace-vault design spec.
