# Calendly Connector

Pulls scheduled meetings and invitee records from [Calendly](https://calendly.com) into the local client index, linked to the right client by meeting name.

**Status:** Shipped. Working in production; demo content was parked during the 2026-06-28 demo pending a calendar reconnect. Authenticates via pasted Calendly API token stored in the OS keychain.

**Entry point:** `MeetingSourcePanel.tsx` (settings UI) — wires to Rust commands in `src-tauri/src/commands/calendly/`.
