//! Approval-gated external write-back sockets.
//!
//! Wave 1 deliberately uses mock RightCapital and Holistiplan sockets only.
//! The shared engine owns the safety rules: proposals do not send, approval is
//! the only send path, a ledger row is written before any external write, and
//! unclear delivery is verified before retry.

pub mod commands;
pub mod engine;
pub mod holistiplan;
pub mod model;
pub mod rightcapital;
pub mod store;
