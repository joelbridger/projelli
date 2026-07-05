# QA-68 investigation — RAG cross-workspace content leak (ragleak, bench-2, 2026-07-05)

**Question:** After the QA-62 stale-Client-Map bug (switching workspaces still shows the OLD workspace's
clients), can an Ask scoped to one of those stale clients actually retrieve real document content from
the OTHER workspace? This would be a much worse leak than QA-62's blocked file-write, since it would
bypass PathValidator's filesystem-level protection entirely.

**Bench/setup:** Azure `lantern-cloud-bench-2` (`100.88.113.105`), repo reset to `origin/lantern-plus`
tip `fef898c2`. QA-60's boot-collision case-mismatch (`meetingNoteOutboundGate.ts` /
`MeetingNoteOutboundGate.tsx`) was still present at this tip — applied hunt2's local-only workaround
(renamed the lowercase file to `meetingNoteOutboundGateCore.ts`, fixed its one importer in
`useMeetingNoteOutboundGate.ts`, cleared `node_modules/.vite`) to get the app to boot. This workaround
was NOT committed — bench-only, matches how hunt1/hunt2 handled it. VaultSvc (Windows Credential
Manager) was found stopped again on this VM (same latent issue as QA-33) — started it so the keychain-
backed API key save would work. Configured Cloud AI mode with a real OpenAI key (from
`~/lantern/.env.test`, the same test key documented in `reference_keepance_user_test.md`) so inference
was fast, per the brief.

## Steps + evidence (numbered screenshots in this folder)

1. **Workspace A** (`AdvisorPrepHeroSample`, the existing bench workspace): created client "RagLeak
   Probe Client" (`00`–`08`), added a document with a distinctive marker string
   (`RAGLEAK-SECRET-MARKER: The Roth Conversion Plan targets a balance of $2.4 million by the year 2040
   for this household.`) (`09`–`11`). Switched the workspace to Cloud AI mode and added a real OpenAI
   key via Settings → AI & Privacy → Manage AI Account Keys (`12`–`21`).
2. Asked the Ask panel scoped to "This client" — initially got "nothing found" (`22`–`24`). Root-caused
   via a direct `invoke('rag_retrieve', {scope:{kind:'allMatters'}})` call from devtools: the document
   WAS retrievable (score 0.93) but tagged with the WRONG `matter_id`
   (`matter_sample_garcia_v_meridian`, an orphaned pre-existing sample matter, not RagLeak Probe
   Client's real id `matter_a72690b1-...`) — a separate matter-mistagging bug, noted in BUG-DB but not
   the leak this investigation was chasing. Confirmed baseline retrieval otherwise works (`25`–`33`).
3. Read the Rust source (`src-tauri/src/commands/rag/store/mod.rs:331`,
   `src-tauri/src/commands/rag/state.rs` `RagState`/`require_workspace`) — the LanceDB dataset path is
   `workspace_data_dir(workspace_root).join("vectors")`, i.e. INSIDE each workspace root
   (`.lantern/vectors`), not a global `~/.keepance` path as CLAUDE.md / QA-62 assumed. Confirmed live on
   disk: Workspace A's `.../AdvisorPrepHeroSample/.lantern/vectors/` had 86+ LanceDB versions; a fresh
   empty Workspace B got its own brand-new `.../QA-Workspace-B-ragleak/.lantern/vectors/` with only 2
   versions and zero content.
4. **Reproduced QA-62's stale-Client-Map bug via a second trigger path** (not just Recent-Projects
   click): injected a fresh empty workspace path into `lantern_recent_workspaces` localStorage and
   reloaded — the title bar correctly switched to "QA-Workspace-B-ragleak" (`39`), but the Client
   Map/sidebar still showed all 5 stale Workspace-A clients including RagLeak Probe Client (`40`) —
   same defect as QA-62, corroborated via a different reproduction path.
5. **The actual test, with the app in exactly this confused state:** clicked into the stale "RagLeak
   Probe Client" and asked the Ask panel (Files-only mode, scoped "This client") the exact probe
   question (`41`). Response: **"I couldn't find anything about that in your documents."** (`42`) — no
   leak. Confirmed at the Rust level too: a direct `rag_retrieve` AllMatters call in this same state
   returned `[]` (empty), proving the backend had genuinely re-pointed at Workspace B's own empty
   dataset rather than silently still serving Workspace A's.

## Verdict

**QA-68 downgraded — no cross-workspace RAG/content leak.** The vector store is workspace-scoped by
construction (physically separate directories per workspace root) and the Rust-side active-workspace
pointer (`RagState.workspace_root`) correctly re-points on a real workspace switch, even while the
frontend's matter/Client-Map store is still showing stale data (QA-62). QA-62 itself remains a real,
now twice-corroborated bug (wrong client roster + broken file-write path), just not one that cascades
into content-level leakage via Ask.

**New smaller bug found in passing** (not yet its own ticket): new documents can get indexed under the
wrong `matter_id` (an orphaned pre-existing sample matter, not the client's own id), which breaks
"This client"-scoped Ask for that client's own new content — worth a dedicated follow-up.
