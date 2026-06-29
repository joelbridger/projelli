//! Read-only Zocks meeting-notes connector.
//!
//! The Zocks API endpoints in this module are provisional pending Zocks API
//! confirmation. HTTP paths and auth assumptions are isolated in `client.rs`
//! so the real endpoint contract can be swapped in one place.

pub mod client;
pub mod commands;
pub mod engine;
pub mod model;
pub mod render;
pub mod source;
pub mod store;
