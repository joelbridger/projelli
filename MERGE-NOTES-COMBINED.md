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
