# Divergence Report: `origin/lantern-plus` vs `origin/keepance-3.0`

Generated: 2026-07-04
Worktree: `/home/jameson/lantern-plus/.worktrees/divergence`

## Executive summary

Git can currently merge these two branch tips without a text conflict. I verified this with `git merge-tree origin/keepance-3.0 origin/lantern-plus`, which produced a merged tree and no conflict output.

That does not mean the integration is low risk. The current `keepance-3.0` side is small and mostly website/docs, while the `lantern-plus` side is a large product fork: 547 commits, 690 changed files, about 110k added lines, and major changes in the React app, Tauri/Rust backend, release packaging, sidecars, CI, tests, and QA evidence.

The highest risk is semantic, not textual: the fork adds meeting capture, calendar prep, CRM write-back, whole-practice Ask, retention controls, voiceprint/diarization, and Windows bench infrastructure on top of a product line that has also been renamed internally from Keepance to Lantern and moved from `.keepance` data folders to `.lantern`.

## Branch points and counts

Common ancestor:

```text
664ec81eb62e108f0268c57680e143d6654d4ab6
2026-07-03T13:43:30+00:00
docs(design): log Jameson's approval of reimagine A+B + implementation/timing plan
```

Current tips:

```text
origin/lantern-plus
c230579ee45284a041ff26687636a46c4794be63
2026-07-04T09:13:26+00:00
coordination: LANES - qa3 persona-D lane + codex divergence job

origin/keepance-3.0
dbd5b164898f2fa629a2aa048ae5ff9cc746a01a
2026-07-04T06:29:09+00:00
Merge docs/rename-ref-hygiene: migrate live /home/jameson/keepance paths to /home/jameson/lantern in scripts+docs
```

Commit counts since the merge-base:

| Side | All commits | Non-merge commits |
|---|---:|---:|
| `origin/lantern-plus` | 547 | 490 |
| `origin/keepance-3.0` | 5 | 3 |

Changed-file scale since the merge-base:

| Side | Files changed | Added files | Modified files |
|---|---:|---:|---:|
| `origin/lantern-plus` | 690 | 507 | 183 |
| `origin/keepance-3.0` | 10 | 1 | 9 |

High-level touched areas:

| Area | Fork touched | Main touched |
|---|---:|---:|
| `src/` | 168 files | 0 files |
| `src-tauri/` | 92 files | 0 files |
| `tests/` | 68 files | 0 files |
| `scripts/` | 43 files | 2 files |
| `docs/` | 157 files | 3 files |
| `coordination/` | 137 files | 0 files |
| `website/` | 0 files from fork relative to base | 2 files |
| `.github/` | 2 files | 0 files |
| `backend/` | 1 file | 1 file |

## Current text-conflict candidates

Only seven files were touched on both sides since the merge-base:

```text
CLAUDE.md
REPO_GUIDE.md
backend/deploy/RUNBOOK.md
docs/operations/2026-06-19-test-bench-operations-guide.md
docs/operations/REPO-MAP-CURRENT.md
scripts/eval/ask-nightly.mjs
scripts/update-spots-remaining.ts
```

Six of the seven are now identical at the two branch tips. Both sides made the same `/home/jameson/keepance` to `/home/jameson/lantern` path hygiene changes, so Git will not need a human to reconcile them.

The only current file difference among the shared files is:

- `CLAUDE.md`: `lantern-plus` adds a fork-only banner at the top. Keep this banner on the fork, but do not blindly carry it into `keepance-3.0` unless the future main branch is meant to remember the fork program after merge.

Main also changed these files that the fork did not touch:

- `website/vs/jump.html`
- `website/press-kit/comparison-matrix.html`
- `docs/marketing/2026-07-03-vs-jump-page-corrections.md`

Those should be preserved. They correct stale or risky public claims about Jump: wrong HIPAA wording, stale advisor count, broken Jump URLs, and old "Markdown" product copy.

## Ranked risk areas

### 1. Very high risk: `src-tauri/`

Main did not touch `src-tauri/` in the current divergence window, so there is no current text conflict. But the fork touched 92 `src-tauri/` files and added major native behavior:

- `src-tauri/src/commands/calendar/*`
- `src-tauri/src/commands/capture/*`
- `src-tauri/src/commands/crm/write.rs`
- `src-tauri/src/commands/diarize/mod.rs`
- `src-tauri/src/commands/pathguard.rs`
- `src-tauri/src/commands/retention/*`
- `src-tauri/src/commands/voiceprint/*`
- `src-tauri/src/sidecars/diarize.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/identity.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/windows/installer-hooks.nsh`

Why this matters:

- These files control native filesystem access, encrypted local storage, sidecar processes, audio capture, calendar OAuth, CRM write-back, audit logging, and Windows packaging.
- Even if Git merges them cleanly, mistakes here can break real user data, release builds, or Windows/macOS runtime behavior.
- The fork also changed `src-tauri/Cargo.lock` heavily and added `src-tauri/sidecar-src/lantern-diarize/Cargo.lock`.

Specific hot spots:

- `src-tauri/src/commands/pathguard.rs`: new path safety layer used by capture/MCP/retention code. Any future main path changes must not bypass it.
- `src-tauri/src/commands/audit/store.rs`: fork hardens audit-seal behavior. Integration must not reintroduce silent reseal or repair gaps.
- `src-tauri/src/commands/rag/*`: fork changes RAG and matter scoping callers. This needs cross-client leakage tests.
- `src-tauri/src/commands/capture/*`: new audio/session code needs real Windows and macOS checks, not just unit tests.
- `src-tauri/src/commands/retention/*`: local deletion/redaction behavior needs destructive-operation review.

### 2. Very high risk: release packaging, CI, and sidecars

Fork touched:

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- `scripts/build-diarize-sidecar.sh`
- `scripts/fetch-diarize-models.sh`
- `src-tauri/sidecar-src/lantern-diarize/*`

Current main did not touch CI or lockfiles, so there is no text conflict today. The risk is build/release behavior.

Important fork changes:

- Linux CI installs `libasound2-dev` for `cpal`/ALSA.
- Release CI installs `clang`/`libclang-dev` or Windows `llvm` for `sherpa-rs-sys`/bindgen.
- Release CI now fetches diarization models and builds/stages the `lantern-diarize` sidecar.
- macOS signing now recurses under `binaries/` so nested diarization binaries/dylibs get signed.
- Windows release staging checks for `lantern-diarize.exe`, `sherpa-onnx` DLLs, and `onnxruntime` DLLs.
- `package.json` adds:
  - `build-diarize-sidecar`
  - `fetch-diarize-models`
  - `bench-smoke:test`

Re-verification needed:

- GitHub CI on Linux.
- Windows release build.
- macOS release build and notarization.
- Installer launch with staged `binaries/diarize/*` and `resources/diarize/*`.

### 3. High risk: `src/platform/`

Main did not touch `src/platform/` in the current divergence window, but the fork touched this shared foundation heavily:

- `src/platform/audit/AuditService.ts`
- `src/platform/clientMap/clientMapStore.ts`
- `src/platform/clientMap/estate/*`
- `src/platform/clientMap/meetingNoteSources.ts`
- `src/platform/connectors/calendar/CalendarConnect.tsx`
- `src/platform/fs/appPath.ts`
- `src/platform/hooks/useMemoryWiring.ts`
- `src/platform/matter/matterStore.ts`
- `src/platform/privacy/*`
- `src/platform/providers/AppLocalProvider.ts`
- `src/platform/providers/providerFactory.ts`
- `src/platform/rag/matterResolver.ts`
- `src/platform/rag/workspaceCommand.ts`
- `src/platform/settings/schema.ts`
- `src/platform/state/crmWriteQueueStore.ts`
- `src/platform/state/fieldBlend.ts`
- `src/platform/types/audit.ts`
- `src/platform/types/meeting.ts`
- `src/platform/utils/calendar-commands.ts`
- `src/platform/utils/mail-commands.ts`
- `src/platform/utils/tauri-commands.ts`
- `src/platform/utils/wealthbox-commands.ts`

Why this matters:

- This is shared app plumbing, not isolated UI. It affects client/matter isolation, RAG search, privacy settings, audit events, Tauri command shapes, and persisted browser/desktop state.
- The fork adds new persistent state keys and new matter fields. Any main changes to the same stores later could merge cleanly but still produce stale saved state or missing migration behavior.

### 4. High risk: app surfaces in `src/features/`

Fork added or changed large user-facing surfaces:

- `src/features/meetings/*`
- `src/features/email/DraftFollowUpModal.tsx`
- `src/features/email/followUpDraft.ts`
- `src/features/matters/CrmWriteReviewCard.tsx`
- `src/features/matters/CrmWritePendingBanner.tsx`
- `src/features/matters/book/*`
- `src/features/ask/book/*`
- `src/features/settings/RetentionSettings.tsx`
- `src/features/documents/media/DocxEditor.tsx`
- `src/features/matters/MatterHub.tsx`
- `src/features/matters/MattersHome.tsx`
- `src/features/ask/Ask.tsx`

Why this matters:

- Main's public copy says Advisor Prep Hero is not built around meeting notes, but the fork now adds meeting capture and CRM write-back. The product story still can be "not built around meeting notes," but the website and sales story need one deliberate pass after integration.
- The fork adds whole-practice Ask and book/client map surfaces. These need client-isolation verification because they intentionally cross client boundaries in controlled ways.

### 5. Medium risk: docs, coordination, evidence, and marketing files

Fork added many docs and evidence files:

- `coordination/*`
- `docs/evidence/*`
- `docs/design/lantern-plus-prototypes/*`
- `docs/design/lantern-plus-ui-audit/*`
- `docs/plans/lantern-plus/*`
- `docs/strategy/2026-07-03-jump-battle-plan/*`
- `feasibility/*`

These are not likely to break the app, but they affect repository weight and future agent behavior. Before merging fork to main, decide whether main should keep all `coordination/` and evidence artifacts, or whether some should be archived separately.

### 6. Low current risk: `backend/` and maintenance scripts

Both sides touched:

- `backend/deploy/RUNBOOK.md`
- `scripts/eval/ask-nightly.mjs`
- `scripts/update-spots-remaining.ts`

At current tips these files are identical. The shared change is only `/home/jameson/keepance` to `/home/jameson/lantern` path hygiene.

## Semantic collision risks beyond text conflicts

### Keepance-to-Lantern naming and identity

Both current tips use the permanent internal app namespace `lantern`:

- `src/config/identity.ts`
- `src-tauri/src/identity.rs`
- `src-tauri/tauri.conf.json`

Important current facts:

- `src/config/identity.ts` has `APP_NS = 'lantern'`.
- `WORKSPACE_DATA_DIR = '.lantern'`.
- `LEGACY_WORKSPACE_DATA_DIR = '.keepance'`.
- Tauri identifier is `com.lantern.app`.
- Product display name is still `Advisor Prep Hero`.
- GitHub updater endpoint points to `https://github.com/lanternplatform/lantern/releases/latest/download/latest.json`.

Risk:

- The fork has a cosmetic `keepance -> lantern` sweep plus follow-up fixes. A broad future rename could easily over-correct customer-facing names or under-correct old internal paths.
- Do not rename `matter`, `matter_id`, or the `Matter` type. The fork plan explicitly repeats this rule.
- Do not change license tier wire codes: `personal`, `professional`, `practice`.

Recommended check after integration:

- Run `npm run identity:check`.
- Grep for hardcoded `.keepance`, `keepance:`, `keepance_`, `/home/jameson/keepance`, and `com.keepance`, then classify each as either an intentional legacy migration reference or a bug.

### Data-dir migration: `.keepance` to `.lantern`

The main product line already contains the data-dir migration work before this merge-base. The fork builds on top of it. New fork modules write new data under the migrated Lantern identity:

- calendar data
- meeting briefs
- capture sessions
- diarization assets
- voiceprints
- retention policy data
- CRM write queues

Risk:

- A clean merge can still leave a module writing to `.lantern` while a migration or path guard still scans `.keepance`, or vice versa.
- The fork's `src-tauri/src/commands/pathguard.rs` and `src/platform/fs/appPath.ts` are especially important here.

Recommended checks:

- Open an old workspace that still has `.keepance`.
- Confirm first launch migrates or hides legacy app data correctly.
- Confirm new meeting/capture/retention features do not strand data in the old folder.
- Confirm file tree hides both `.lantern` and any leftover `.keepance` folder.

### Pricing and website copy drift

`src/config/pricing.ts` is identical between the two current tips. The canonical 3.0 pricing remains:

- Solo: `$468/yr`
- Professional: `$948/yr`
- Firm: `$1,548/seat/yr`, 3-seat minimum
- Wire codes remain `personal`, `professional`, `practice`

Main changed public website copy in:

- `website/vs/jump.html`
- `website/press-kit/comparison-matrix.html`

Those fixes should land in the fork. They correct:

- Jump URL: `jump.ai`, not `meetjump.com` or `jumpai.com`.
- Jump adoption: `35,000+ advisors`, not `27,000`.
- Jump security: SOC 2 Type II only, not HIPAA.
- Product files: real Word docs, not Markdown.
- Meeting notes wording: "not built around meeting notes" instead of "not a meeting-notes tool."

Risk:

- After the fork's meeting capture and CRM write-back features land on main, the website copy should get a fresh product-marketing pass. The current wording is safer than before, but the product is no longer simply "not a meeting-notes tool."

### Main's Jump correction doc duplicates fork research

Main adds:

- `docs/marketing/2026-07-03-vs-jump-page-corrections.md`

The fork adds a broader Jump research package:

- `docs/strategy/2026-07-03-jump-battle-plan/SOURCES.md`
- `docs/strategy/2026-07-03-jump-battle-plan/01-jump-assessment.md`
- `docs/strategy/2026-07-03-jump-battle-plan/02-kill-sheet.md`
- `docs/strategy/2026-07-03-jump-battle-plan/README.md`
- `feasibility/jump-feature-inventory.md`
- `feasibility/ASSESSMENT.md`

Risk:

- The same facts now live in multiple places. The main correction doc is useful because it explains exactly why the public pages changed. The fork's strategy docs are broader and should not replace it.

Recommended action:

- Keep `docs/marketing/2026-07-03-vs-jump-page-corrections.md`.
- Add a later cross-link from that doc to `docs/strategy/2026-07-03-jump-battle-plan/SOURCES.md` if the strategy docs are merged.

### Main changes the fork silently depends on or duplicates

The fork silently depends on earlier main-line work that is already before the current merge-base:

- the `.keepance` to `.lantern` app-data migration
- the permanent `lantern` identity constants
- the Tauri bundle identifier and updater endpoint changes
- the Word-native document direction in product copy and docs
- the advisor-first pricing config

The fork duplicates main's newest path hygiene work in seven scripts/docs. At current tips, six of those files are byte-for-byte identical between branches. This is safe, but it means a future manual cherry-pick could accidentally replay the same edits or miss the fork banner exception in `CLAUDE.md`.

The fork also depends on main's public Jump corrections for marketing accuracy. Those changes are not in `origin/lantern-plus` today and should be merged in before any release branch is cut from the fork.

## Recommended integration approach

### Direction

Use `origin/keepance-3.0` as the target and integrate `origin/lantern-plus` into a temporary staging branch. Do not rebase the whole fork.

Reason:

- The fork has 547 commits, many merge commits, and evidence of repeated review/fix rounds.
- Rebasing that history would be slow and easy to get wrong.
- The current merge is text-clean, so preserving the fork's tested history is safer than replaying it.

Recommended branch:

```bash
git fetch origin
git checkout -b integrate/lantern-plus-to-main origin/keepance-3.0
git merge --no-ff origin/lantern-plus
```

If main needs a cleaner public history later, do that after a verified merge, not before. The safe path is:

1. Merge first.
2. Verify the product.
3. If needed, make a separate cleanup commit that archives or removes fork-only coordination artifacts.

Do not squash before verification. Squashing would hide which tested commits introduced which behavior and would make bug hunting harder.

### Order of review after the merge

Review in this order:

1. `CLAUDE.md`
   - Decide whether the fork banner belongs on main after integration.

2. Website and marketing accuracy
   - Preserve main's changes in `website/vs/jump.html`.
   - Preserve main's changes in `website/press-kit/comparison-matrix.html`.
   - Preserve `docs/marketing/2026-07-03-vs-jump-page-corrections.md`.
   - After merge, do one copy pass for the new reality: meeting capture exists, but the product should still not be positioned as "just a notetaker."

3. Lockfiles and package/release plumbing
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock`
   - `src-tauri/sidecar-src/lantern-diarize/Cargo.lock`
   - `.github/workflows/ci.yml`
   - `.github/workflows/release.yml`

4. Native backend
   - `src-tauri/src/commands/pathguard.rs`
   - `src-tauri/src/commands/capture/*`
   - `src-tauri/src/commands/calendar/*`
   - `src-tauri/src/commands/crm/*`
   - `src-tauri/src/commands/retention/*`
   - `src-tauri/src/commands/voiceprint/*`
   - `src-tauri/src/commands/rag/*`
   - `src-tauri/src/commands/audit/*`

5. Shared platform state
   - `src/config/identity.ts`
   - `src/platform/matter/matterStore.ts`
   - `src/platform/rag/matterResolver.ts`
   - `src/platform/state/crmWriteQueueStore.ts`
   - `src/platform/privacy/*`
   - `src/platform/utils/tauri-commands.ts`

6. Product surfaces
   - `src/features/meetings/*`
   - `src/features/matters/*`
   - `src/features/ask/*`
   - `src/features/email/*`
   - `src/features/settings/*`

7. Repository hygiene
   - Decide which of `coordination/`, `docs/evidence/`, and `feasibility/` should stay in main.

### What to merge vs rebase vs cherry-pick

Merge:

- The full fork into a staging branch for first integration verification.
- Main's current website/doc fixes into the fork now, if the fork continues active work before integration.

Do not rebase:

- Do not rebase all 547 fork commits. It adds risk without improving the product.
- Do not rebase release/sidecar commits separately from the Rust code that needs them.

Cherry-pick only if the integration goal changes:

- If Jameson later decides that main should receive only a narrow part of the fork, cherry-pick complete vertical slices, not isolated files.
- Safe vertical slices would be:
  - website corrections from main: `f42cb6b5`, `632b357d`, merge `5207beac`
  - calendar/prep
  - CRM write-back
  - meeting capture/transcription
  - diarization/voiceprints
  - retention/privacy
- Do not cherry-pick a UI file without the matching `src/platform`, `src-tauri`, tests, and command-wrapper files.

## Required verification after integration

### Fast local gates

Run:

```bash
npm run typecheck
npm run test
npm run lint:gate
cargo test --manifest-path src-tauri/Cargo.toml
```

Then run targeted tests for the forked areas:

```bash
npm run bench-smoke:test
vitest run tests/unit/meetings tests/unit/crmWriteQueue.test.ts tests/unit/fieldBlend.test.ts
vitest run tests/unit/clientMap tests/unit/matter tests/unit/rag
cargo test --manifest-path src-tauri/Cargo.toml calendar
cargo test --manifest-path src-tauri/Cargo.toml capture
cargo test --manifest-path src-tauri/Cargo.toml retention
```

Exact test names may need adjustment, but those are the areas that matter.

### Full product gate

Run:

```bash
npm run gate
```

Run `npm run gate:full` before any release candidate. It is expensive, but the fork touched enough app and desktop behavior that the full gate is warranted.

### Real Windows verification

This is required. Do not treat Linux/browser tests as enough.

Verify on the Legion Windows laptop:

- Fresh install and launch.
- Upgrade-in-place from a pre-fork workspace that still has `.keepance`.
- Workspace opens with `.lantern` data and legacy `.keepance` hidden or migrated.
- Create/open a client and confirm client folder scoping.
- Ask tab works at normal and narrow window widths.
- Calendar connection UI loads and handles disconnect.
- Today's meetings strip / before-you-meet strip renders without blocking main app use.
- Meeting capture start/stop/status path works.
- Transcription path works or fails with a clear user-facing error.
- Diarization sidecar is present in packaged app resources.
- CRM write review card queues and clears correctly.
- Retention settings render and do not delete anything without the intended confirmation path.
- Audit log shows capture/CRM/retention events correctly.
- App relaunch preserves meeting/client state.

Also run a packaged Windows build, not only `tauri dev`, because the fork changed sidecar staging and installer hooks.

### macOS verification

Needed because the fork changed recursive signing and added nested native diarization binaries:

- macOS release build.
- Codesign verification for all Mach-O files under `binaries/`.
- Notarization.
- Launch packaged app.
- Confirm audio/capture permission failure is handled clearly if permissions are missing.

## Effort estimate

Current text merge:

- 0.5 day. Git can already merge the tips without text conflicts.

Real integration review:

- 1 to 2 days. Most time is not conflict resolution; it is reviewing `src-tauri`, `src/platform`, CI/release, and deciding what fork artifacts should live on main.

Verification:

- 2 to 3 days. Windows and release packaging are the long pole because meeting capture, diarization, and sidecar staging need real packaged-app checks.

Total realistic effort:

- 3 to 5 focused days for a responsible fork-to-main integration.
- Add 1 to 2 days if the team wants a cleaned-up product-history import instead of preserving the fork's history and then doing cleanup commits.
- Add more time if `keepance-3.0` continues changing `src/`, `src-tauri/`, lockfiles, or CI before the integration happens.

## Bottom line

This is currently a clean Git merge but not a small merge.

The safe path is:

1. Merge latest main into the fork now if the fork keeps moving.
2. When ready, create a staging branch from `origin/keepance-3.0`.
3. Merge `origin/lantern-plus` into that staging branch with `--no-ff`.
4. Preserve main's Jump website corrections.
5. Review `src-tauri`, `src/platform`, lockfiles, and CI first.
6. Run full local gates.
7. Re-verify on real Windows with a packaged build before any release decision.

