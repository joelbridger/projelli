# Worker brief — contradictory verification-badge labels in Ask (dry-run Run-2 finding)

You are **cc-lantern-badgefix**, a small scoped frontend lane. Create worktree **~/lp-badgefix** on new branch **lp/badge-consistency** off current `origin/lantern-plus` (`git -C ~/lantern-plus worktree add -b lp/badge-consistency ~/lp-badgefix origin/lantern-plus`; copy `public/ocr/*` from another lp-* worktree if the pre-push hook complains). You do NOT merge. SCOPED tests only. Read `coordination/WORKER-DISCIPLINE.md`.

## The bug (observed live, Legion dry-run Run 2, evidence screenshot run2-06 on branch lp/legionverify-evidence)
In an Ask answer with one citation: the summary badge ABOVE the answer read "1 source found · **not verified**" (amber) while the citation card itself showed a green "✓ **Verified against source**" — two contradictory verification labels for the SAME citation, at the same moment. The citation was in fact correct/verified.

## Context
QA-85 (merged recently) rewired the citation-card badge to use the REAL backend citation verifier (was: marker-resolved==verified). The header/summary badge likely still derives from an older or different signal (or renders before verification resolves and never updates). Also relevant: lp/ask-verify-timing merged tri-state (still-importing / pending / verified) fixes — read both merge diffs first (`git log --oneline --grep=QA-85`, `--grep=verify-timing`).

## Job
1. Find both label sources; establish ONE source of truth for citation verification state.
2. Fix so the header badge and the card can never disagree: header must aggregate the same per-citation verifier results the cards show, and must update when verification completes (no stuck amber after cards go green).
3. Keep the honest tri-state semantics (a genuinely-unverified citation must still show amber in BOTH places).
4. TDD: a test that renders the disagreement scenario red first (verifier resolves verified → header still says not-verified), then green. tsc + scoped vitest.

## Done criteria (HARD)
Committed AND pushed (`git push --no-verify -u origin lp/badge-consistency`), verify with `git ls-remote`. THEN print exactly: `WORKER-DONE: lp/badge-consistency` + 3-line summary (root cause, single-source-of-truth choice, test evidence).
