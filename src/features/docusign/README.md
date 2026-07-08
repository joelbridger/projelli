# DocuSign Connector

Pulls signed envelopes and signature history from [DocuSign](https://docusign.com) into the local client index.

**Status:** Code-complete - 8 backend commands registered, UI wired. Gated on DocuSign integrator credentials (an approved DocuSign app). Cannot authenticate in production until Lantern has the partner app key.

**Entry point:** `DocusignSourcePanel.tsx` (settings UI) — wires to Rust commands in `src-tauri/src/commands/docusign/`.
