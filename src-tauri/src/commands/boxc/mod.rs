//! Read-only Box document connector.
//!
//! Box is self-serve for read-only import through a Box Platform App configured
//! with the `root_readonly` scope. This connector stores a user-pasted Box
//! Developer Token in the `keepance-box` keychain slot and only calls GET
//! endpoints: folder listing, metadata reads, and file content download.

pub mod client;
pub mod commands;
pub mod engine;
pub mod model;
pub mod render;
pub mod source;
pub mod store;
