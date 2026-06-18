# Inventory entry schema (every catalog file uses this)

Each user story is one row. Group rows under H2 sections by sub-area.

| Field | Meaning |
|---|---|
| **ID** | `<DOMAIN>-NN` e.g. EMAIL-01 |
| **Persona** | solo / firm-admin / firm-member / any |
| **Story** | "As a ___ I want to ___ so that ___" |
| **Steps** | The concrete UI actions a user takes (clicks/typing/nav), in order |
| **Surface** | Component file + `data-testid`(s) + route/menu where it lives |
| **Precondition** | What must be true first (key set, matter exists, firm joined, etc.) |
| **Expected** | Observable success result |
| **Layer** | L1 browser-dev / L2 real-desktop(local Linux) / L3 live-OAuth-harness / L4 windows-only-manual |
| **Risk** | H/M/L (H = data-loss, auth, firm/multi-user, money, irreversible) |
| **Covered?** | existing automated test path, or "NONE" |

Layer rule of thumb:
- L1 = works in the Vite browser dev server (most UI, AI chat via proxy, file create/md edit).
- L2 = needs the real Tauri backend: keychain, encrypted mail store, RAG/semantic index,
  .docx OOXML engine, multi-window, real disk persistence, firm create->login, co-editing.
- L3 = real provider OAuth + import (Gmail/Outlook live harnesses).
- L4 = only a signed platform build shows it: installer/uninstaller branding, OS console flash,
  auto-updater, code-sign/notarize, OS keychain specifics.
