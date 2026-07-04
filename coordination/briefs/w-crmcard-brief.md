# Worker brief — CRM review-card visibility + persistence (QA finding, trust-story relevant)

**Lane:** cc-lantern-crmcard · worktree `~/lp-crmcard` · branch `lp/crm-card-visibility`
**Model:** Sonnet 5 · high. TS-only expected. tdd applies (red first per fix).

## Findings to fix (from a code-level investigation; verify each against HEAD before coding)
1. **P1 — queued CRM proposals are lost on app restart.** `src/platform/state/crmWriteQueueStore.ts` (~line 5 comment says proposals are not persisted). "AI proposes, user approves" is the product's core promise — a proposal silently vanishing on restart breaks it. Fix: persist the queue like sibling stores (zustand + localStorage pattern; check how other stores persist + migrate versions), restoring pending proposals on launch. Consider staleness honestly (a restored proposal references a note/matter — if the target is gone, surface it as expired rather than crashing).
2. **P2 — the review card is invisible outside the Client Map overview sub-tab.** `CrmWriteReviewCard` mounts only under `subTab === 'overview'` — a user on Documents/Email/Activity never sees the pending approval. Fix: render pending-review presence in the client hub chrome, above the active sub-tab panel (a slim banner/count with expand-in-place or a Review-now jump to the full card — match existing hub design patterns; light theme; i18n de/es).
3. **P3 — copy:** the toolbar confirmation says "Added to the Wealthbox review card on this client's map" and auto-clears in 2.5s. Make it plain and actionable: "Queued for Wealthbox review" + a Review now action.
4. **Harness honesty:** `scripts/bench-smoke/checks/wave2.mjs` (~line 64) can PASS on the toolbar confirmation ("review card" text) without the real card. Change it to assert the REAL card (`[data-testid="crm-write-card-collapsed"]`, or via your new hub-chrome presence testid) and to expand+verify "Approve" is reachable.

## Rules
- Read the original wire-fix context in coordination/briefs/w-crm-wire-fixes-brief.md history if helpful; never rename Matter/matter_id; robust over minimal (core-app rule).
- Gates: scoped vitest red→green per fix; full vitest + tsc + eslint-gate; bench-smoke test config for item 4; add/extend a bench-mirror Playwright spec if the hub-chrome banner is browser-drivable (it should be).
- Codex self-review per commit; cap ~4 rounds. Push; do NOT merge. Evidence handoff with exact outputs. Last line exactly: `WORKER-DONE: lp/crm-card-visibility`
