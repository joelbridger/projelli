# Combined-merge resolution notes (merge/combined)

## Binding law (senior lead, 23:44)
THE COMPILER IS NOT THE CUSTOMER. Preserve both sides' behavior. Never drop a feature, guard, check, or receipt to make it compile.

## MANDATORY DISCLOSURE (added mid-lane, 23:45)
Any conflict resolved by REMOVING anything — a feature, a guard, a check, a receipt, a test assertion — must be named explicitly here with its justification, even if the resolver is confident. Ten justified removals beat one silent one found during the exam.

## Ask-engine seam (src/features/ask/useAsk.ts)
STOP-RATHER-THAN-GUESS is binding. If the correct resolution is not obvious, do not pick the one that builds — write the doubt here and escalate to the coordinator.

## Removals

- The old `MattersHome` and standalone `Ask` branches were removed from the
  main surface switch because the binding merge direction makes CRM Home,
  CRM Clients, and CRM Ask the combined product's front door. Their underlying
  behaviors were not discarded: document/email/activity routes remain wired,
  CRM Ask forwards the main Ask save/open/audit props, and household selection
  now clears or applies the matching matter scope fail-closed.
- Vitest 4's removed `poolOptions` setting was not retained. Its working
  replacement is the env-overridable `maxWorkers` cap (4 normally, 2 on
  Windows) plus `maxConcurrency: 4`; keeping the dead option only produced a
  warning and enforced nothing.

## Ask-engine doubt log

None. CRM hits enter after the existing retrieval scope is fixed, the Rust
search receives that matter id, and the adapter repeats the same-id filter
before any hit can reach the prompt or citation binder. The existing durable
approval/audit-before-send and egress receipt path remains the only model-send
path used by CRM Ask.

## Rust build completion (2026-07-13)

### Environment files restored locally

- Copied `src-tauri/binaries/` and `src-tauri/resources/` from
  `/home/jameson/lp-ux-integrate/src-tauri/` so Tauri could find its declared
  Piper, llama-server, Whisper, speech-data, and embedding resources. These are
  local/ignored build resources; `tauri.conf.json` was not weakened or changed.

### Missing CRM implementations restored

- `src-tauri/src/commands/crm/commands.rs`
  - Restored `crm_create_note` with the CRM parent's command signature.
  - Restored `crm_create_task` with the CRM parent's command signature.
  - Restored `crm_update_field` with the CRM parent's command signature.
- The restored commands call the merged tree's existing shared write
  implementations (`crm_create_write` and `crm_update_field_from_proposal`).
  This preserves the CRM parent's registered entry points while also preserving
  the app parent's stronger audit, stale-value, reconnect, disconnect, and
  delivery-verification checks.

### Preservation check

- Compared the `tauri::generate_handler!` command lists from app parent
  `f8e2ffb3`, CRM parent `1b7ed4db`, and this merge. The merged list contains
  every registration from both parents.
- Nothing was removed to make the build pass.
- Nothing required by either parent's command registration could not be
  brought over. There are no omitted commands or undisclosed removals.

### Verification

- `CARGO_TARGET_DIR=/mnt/devcache/cargo-target-combined cargo check --workspace`:
  passed.
- `CI=1 CARGO_TARGET_DIR=/mnt/devcache/cargo-target-combined cargo test --workspace --locked`:
  passed with zero failures.
- `npx tsc --noEmit`: passed.
