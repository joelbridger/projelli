//! Read-only OneDrive / SharePoint document connector.
//!
//! This module is intentionally isolated from the existing Microsoft mail auth
//! path. It reuses the shared Graph transport and the shared encrypted external
//! RAG bridge, but stores its own refresh token and local sync metadata.

pub mod client;
pub mod commands;
pub mod engine;
pub mod model;
pub mod oauth;
pub mod render;
pub mod source;
pub mod store;
