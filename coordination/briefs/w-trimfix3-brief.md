# Worker brief — localai-trimming round 3: ONE verified finding from the delta re-review

You are **cc-lantern-trimfix3**. Work in the EXISTING worktree **~/lp-localtrim** (branch `lp/localai-trimming` @f5e5b4cc). You do NOT merge. SCOPED tests only (localContextTrim + useAsk test files). Read `coordination/WORKER-DISCIPLINE.md`.

## The finding (coordinator-verified)
`localContextTrim.ts`: the trim loop always drops the LOWEST-ranked chunk first. When the top-ranked chunk is oversized all by itself, everything below it gets dropped first, then the top chunk itself (smart mode) — ending at ZERO file chunks even when the #2-ranked chunk alone would fit comfortably. Files-only mode similarly declines "too long" when a fitting chunk existed. Usable evidence is thrown away.

## The fix
When the surviving top chunk cannot fit by itself, drop THAT oversized chunk and re-try with the remaining ranked hits (next-best-first), rather than giving up. Applies to both modes: smart and files-only should both end up with the best-ranked SUBSET that fits (relevance-first dropping stays the default; the oversized-top case is the exception). Keep round-2's contracts intact: smart mode may still fall back to history + hasEvidence:false when NO chunk fits; files-only still declines honestly when no usable file context remains.

Reviewer's test shape (use it, plus a files-only variant and a both-chunks-oversized variant):
```ts
it('drops an oversized top hit and keeps the next best hit that fits', ...)
// hits: [oversized #1 (score .99), small usable #2 (score .90)] → fits=true, hits=['usable.md']
```

## Done criteria (HARD)
Red→green, tsc + scoped vitest green (bare exit codes), committed AND pushed (`git push --no-verify`), verify with `git ls-remote`. THEN print exactly: `WORKER-DONE: lp/localai-trimming round3` + 2-line summary.
