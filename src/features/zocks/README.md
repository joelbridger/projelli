# Zocks Connector

Pulls AI-generated meeting notes and summaries from [Zocks](https://zocks.ai) into the local client index.

**Status:** Merged and in `keepance-3.0`. Gated on Zocks API credentials — the connector code is complete but requires a Zocks API key to authenticate.

**Entry point:** `ZocksSourcePanel.tsx` (settings UI) — wires to Rust commands in `src-tauri/src/commands/zocks/`.
