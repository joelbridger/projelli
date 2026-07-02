# Keepance / Advisor Prep Hero — Current Capability Map (code-grounded)

*Compiled 2026-07-02 by a read-only exploration of `/home/jameson/keepance` (branch `keepance-3.0`, v3.3.5).
This is the "our side" baseline for the Jump feature-parity feasibility assessment.*

## 1. Tech stack & architecture

- **Desktop shell:** Tauri 2 (Rust backend), desktop-first (Win/Mac/Linux, signed installers + auto-update). Browser build for dev/demo only.
- **Frontend:** React 18 + TypeScript 5 (strict) + Vite 6, Zustand, shadcn/ui + Radix + Tailwind 3 (~160.6k LOC TS/TSX).
- **Backend:** Rust, 191 Tauri commands (~79.2k LOC incl. crates `lantern-docx` Word engine, `lantern-vault` AES-256-GCM vault).
- **Local-first:** documents are real files in a user-chosen workspace. No general app DB.
- **Data stores:** LanceDB + fastembed e5-small (semantic RAG), SQLCipher (audit log + mail metadata), AES-256-GCM blobs (mail bodies, vault). MiniSearch full-text, Fuse quick-open.
- **AI:** BYOK cloud (Anthropic/OpenAI/Google, keys in OS keychain) + embedded llama.cpp sidecar + Ollama. Confidentiality spectrum: Local-only / BYOK-direct / Assured (firm zero-retention proxy). No Keepance content server in solo mode.
- **Cloud component:** minimal firm backend (~11.2k LOC TS at api.keepance.com) — E2EE relay + SSO + licensing only; content-blind.
- **Payments:** LemonSqueezy per-seat annual (Solo $468 / Professional $948 / Firm $1,548-per-seat min 3).

## 2. What ships today (verified in code)

- **Documents:** full file management, version history, Trash; viewers/editors for docx (Word-native tracked changes + AI redline), doc, PDF (+OCR), xlsx/csv, pptx preview, images, audio, video.
- **Ask (cited RAG):** cited AI chat across files + email + connector data; semantic + keyword + full-text search; client-scoped (matter isolation); workspace facts memory; cost dashboard.
- **Client Map:** per-client/household home — scoped docs, scoped email, activity timeline, summaries, completeness scoring. Headline surface (3-tab IA: Client Map · Ask · Workflows).
- **Workflows:** template engine, 8 advisor templates (incl. MeetingPrepAndSuitabilityNotes, AnnualReviewPacket, RegBIDocumentation), export to Word/PowerPoint, template marketplace.
- **Email:** Outlook/M365, Gmail, IMAP — import, encrypted index, cite, reply-draft/send. Folder→client mapping.
- **Privacy/compliance surface:** egress indicator, Data Map, Privacy Center, append-only encrypted audit log, encrypted vault, firm tier with E2EE co-editing (Yjs CRDT), SSO/OIDC, information barriers via key denial.
- **Onboarding v2** scenes (Intro → Connect → AI setup → Firm setup).

## 3. Audio & meetings — exists vs. missing (grep-verified)

**EXISTS (all local, on-device):**
- Mic dictation / push-to-talk → bundled **Parakeet/whisper.cpp sidecar** (`transcribe_audio` command); inserts at cursor or saves voice notes. Fully local, no API key.
- Ad-hoc **audio recorder** (webm/wav to a workspace folder) + waveform editor/player.
- TTS read-aloud (Piper sidecar). Voice settings section.

**MISSING (zero code — 0 grep hits):**
- Meeting bot / Zoom / Teams / Google Meet / recall.ai / WebRTC — nothing.
- Live meeting transcription pipeline (dictation is single-utterance, no diarization).
- Google/Outlook **calendar** sync — nothing. Only Calendly connector (scheduled-meeting *metadata* → client mapping).

## 4. Connector layer (a real framework exists)

Shared Rust connector foundation (external RAG indexer, encrypt-at-rest, lifecycle contract, keychain creds, unit-tested client-mapping resolver). RAG source-type allowlist already includes `transcript`, `crm`, `meeting`.

- **Shipped:** Email (Outlook/Gmail/IMAP), Wealthbox CRM, OneDrive/SharePoint, Calendly.
- **Code-complete, gated on vendor creds:** DocuSign, Salesforce, Redtail.
- **Merged, gated on vendor creds:** Addepar, Box, Jotform, ShareFile, Zocks (Zocks = ingests a meeting-notes AI's *text* output).
- **Logos only, no code:** RightCapital, eMoney, MoneyGuidePro, Holistiplan, Orion, Tamarac, Nitrogen.
- **Recognized exports (TS-only ingest):** RightCapital plan PDFs and **Jump meeting-note exports** are already recognized by the generic ingester (`sourceProvenance.ts`).

## 5. Constraints & in-flight items

- Desktop-only; mobile explicitly out of scope. No always-on cloud runtime for user content.
- "No autonomous AI operations — user approves" is a stated product principle.
- Rebrand in flux: docs say Advisor Prep Hero; code identity still `lantern`/`keepance`; engine keeps `matter_id` (never rename).
- In-flight: `feat/advisor-wealthbox` 64-file WIP (overlaps shipped Wealthbox — decision pending), clientmap-design, demo-v3, onboarding-journey worktrees.
- Zero outside/paying users as of the 2026-06 evaluation.
