# OneDrive / SharePoint Connector

Syncs client documents from Microsoft OneDrive and SharePoint into the local client index. Supports `.docx`, `.pdf`, and `.txt` files; incremental sync via Microsoft delta tokens.

**Status:** Shipped. Working in production and demo-proven (2026-06-28 Windows demo). Authenticates via OAuth PKCE (device-code or loopback).

**Entry point:** `OneDriveSourcePanel.tsx` (settings UI) — wires to Rust commands in `src-tauri/src/commands/onedrive/`.
