# QA Campaign — Bug DB (coordinator owns status; explorers append findings)

| ID | Sev | Finding | Source | Status |
|----|-----|---------|--------|--------|
| QA-1 | P1 | Queued CRM write proposals are NOT persisted — app restart silently discards them (crmWriteQueueStore.ts) | codex code investigation off the bench's card-lifecycle repro | FIX LANE: lp/crm-card-visibility |
| QA-2 | P2 | The CRM review card renders only on the Client Map overview sub-tab — invisible from Documents/Email/Activity | same | FIX LANE: lp/crm-card-visibility |
| QA-3 | P3 | Toolbar confirmation copy misleads + auto-clears in 2.5s ("Added to the review card on this client's map") | same | FIX LANE: lp/crm-card-visibility |
| QA-4 | P2(harness) | wave2 bench check can PASS on the toolbar confirmation without proving the real review card | same | FIX LANE: lp/crm-card-visibility (item 4) |
