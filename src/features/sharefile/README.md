# ShareFile Connector

Syncs client files from [Citrix ShareFile](https://sharefile.com), a secure file-sharing portal commonly used in financial advisory practices.

**Status:** Merged and in `keepance-3.0`. Gated on ShareFile partner/integrator credentials — the connector code is complete but requires an approved ShareFile app to authenticate in production.

**Entry point:** `SharefileSourcePanel.tsx` (settings UI) — wires to Rust commands in `src-tauri/src/commands/sharefile/`.
