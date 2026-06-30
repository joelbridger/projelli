# Jotform Connector

Pulls form submissions from [Jotform](https://jotform.com) into the local client index, tagged by client/matter.

**Status:** Merged and in `keepance-3.0`. Gated on Jotform API credentials — the connector code is complete but requires a Jotform API key to authenticate.

**Entry point:** `JotformSourcePanel.tsx` (settings UI) — wires to Rust commands in `src-tauri/src/commands/jotform/`.
