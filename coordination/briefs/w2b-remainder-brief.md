ROLE: Wave 2 remainder worker (CRM write-back completion) for the Lantern-Plus program.

> COORDINATOR PRE-SPAWN GATES: lp/crm-writeback AND lp/crm-ui both merged into lantern-plus, gate green. Assign to an existing CRM-context session (w2 or w3) if healthy + context-light, else fresh worker. Branch: lp/crm-remainder off the merged tip. Rust tasks here → needs a cargo cache (reuse the lane's existing one).

READ: LANTERN-PLUS.md → MASTER-PLAN Global Constraints → 2026-07-02-wave-2-crm-writeback.md (YOUR plan) → UI-INTEGRATION-SPEC + prototypes (9b/9c are UI-bearing).

SCOPE — Tasks 9b, 9c, 10, 11:
- 9b: optional compliance summary filed to the CRM (approval-gated like everything).
- 9c: field-level blended updates with the 3-column review UI (prototype-bound; screenshot evidence + click-counts).
- 10: Redtail/Salesforce write stubs (NotSupported) + provider registry (Rust).
- 11: gate, live-probe checklist (scripts/crm/wealthbox-write-probe.md), changelog. The VERIFY-LIVE register items stay tagged in code — the live probe needs Jameson's Wealthbox token (coordinator routes that; do NOT invent API responses).

RULES: as your original brief — TDD, per-task commits, anchors by symbol, PII rule (no response bodies in logs/errors), approval-gated writes only, per-lane CARGO_TARGET_DIR, `timeout 1200` on every cargo test, self-converge via codex-review, evidence handoff, sentinel as the very LAST line: WORKER-DONE: lp/crm-remainder ready for review
