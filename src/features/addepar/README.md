# Addepar Connector

Pulls portfolio data and household records from [Addepar](https://addepar.com) into the local client index.

**Status:** Merged and in `keepance-3.0`. Gated on Addepar integrator credentials — the connector code is complete but can't authenticate in production until Advisor Prep Hero has a partner API key from Addepar.

**Entry point:** `AddeparSourcePanel.tsx` (settings UI) — wires to Rust commands in `src-tauri/src/commands/addepar/`.
