# CRM Connector

Pulls client households, contacts, and notes from CRM platforms into the local client index. The primary CRM is Wealthbox; Salesforce and Redtail are code-complete but gated on vendor credentials.

**Status:** Wealthbox shipped and demo-proven (2026-06-28 Windows demo). Salesforce and Redtail code is complete — gated on `KEEPANCE_SALESFORCE_CLIENT_ID` and `KEEPANCE_REDTAIL_API_KEY` respectively.

**Entry point:** `CrmSourcePanel.tsx` (settings UI) — wires to Rust commands in `src-tauri/src/commands/crm/` (multi-provider: `mod.rs`, `salesforce.rs`, `redtail.rs`).
