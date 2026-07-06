# Box Connector

Syncs files and folders from [Box](https://box.com) cloud storage into the local client index.

**Status:** Merged and in `lantern-3.0`. Gated on Box developer/partner credentials — the connector code is complete but can't authenticate in production until Advisor Prep Hero has an approved Box app.

**Entry point:** `BoxSourcePanel.tsx` (settings UI) — wires to Rust commands in `src-tauri/src/commands/boxc/`.
