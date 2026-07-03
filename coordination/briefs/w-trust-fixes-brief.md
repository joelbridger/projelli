ROLE: Trust-fixes worker — three cross-wave prompt-security/audit findings from the whole-program review.

WORKDIR: ~/lp-w7 (git worktree, branch lp/trust-fixes off lantern-plus, already created). NOT self-merged.

READ: LANTERN-PLUS.md → coordination/briefs/trust-fixes-findings.txt (the full review output — your three findings with recommended diffs are at the bottom; the recommendations are PROPOSALS, verify each against the actual code).

SCOPE — exactly these three, TDD, separate commits:
1. Egress audit must be written IMMEDIATELY BEFORE every provider.sendMessage (with a follow-up model_call/settled entry after), never only after a successful response — cover ALL call sites that send workspace/client content (Ask, Client Map updates, at-a-glance, meeting briefs, follow-up drafts, field blending). A timeout after send must still leave an egress record.
2. sanitizeForPrompt the source PATH + provenance note in buildWorkspaceContextBlock (workspaceCommand.ts ~165-166) — chunk body is already sanitized, the header is not.
3. fieldBlend.ts mergePrompt: sanitize existingValue + newValue and add the untrusted-data framing line.
Lane boundary: do NOT touch src/features/matters/bookRanking or Ask-scope UI (another lane is building there); coordinate through me if a shared file is unavoidable.

RULES: TS only (ask before any Rust); full vitest before handoff; self-converge via codex-review (cap 4 rounds — the diffs are small); prompt-security tests extend tests/unit/prompt-security\*; evidence handoff; sentinel LAST: WORKER-DONE: lp/trust-fixes ready for review
