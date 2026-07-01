# CI policy: a red required check halts merges

**Why this exists.** The `e2e` job in `.github/workflows/ci.yml` had failed on
essentially every push to `keepance-3.0` for weeks while every other job stayed
green. Nobody treated it as a signal — it got normalized as noise, which means a
genuinely NEW e2e failure (a real regression) would have looked identical to the
permanent red and gone unnoticed. Fixed in F1.3
(`INITIATIVES/tech-eval-fix-plan-2026-07-01.md`) — see
[`docs/quality/e2e-suite-batching.md`](e2e-suite-batching.md) for the root cause
(an unsharded single-process Playwright run failing a large tail of unrelated
specs from long-run resource pressure) and
[`e2e-flaky-quarantine.md`](e2e-flaky-quarantine.md) for the per-spec disposition.

## The rule

1. **A red required CI check on an integration branch (`keepance-3.0`) halts
   merges into it until either the check is fixed, or the check is removed.**
   There is no third option where a red check stays in place and is ignored.
2. **A check nobody obeys is negative value.** It costs CI minutes and gives
   false confidence ("there's a gate") while catching nothing, because a real
   new failure is indistinguishable from the permanent noise. Either make it
   green-means-something, or delete it — never leave it red-and-ignored.
3. **Flaky/CI-environment-sensitive specs get quarantined, not silently
   skipped.** A quarantined spec requires a named owner and a fix-or-delete-by
   date in `e2e-flaky-quarantine.md` (source of truth for the exclusion list is
   `CI_QUARANTINE` in `playwright.config.ts`). No spec sits in quarantine with
   `owner: unassigned` — every row gets an owner, even if that owner is a
   standing follow-up ticket rather than a person.
4. **When you discover a red required check that's been ignored,** the fix is
   not "raise the timeout" or "add a retry" as the primary remedy — find the
   structural cause first (see the diagnosing-bugs skill). Timeout/retry bumps
   may be part of the fix but are never the whole fix.

## Applying this today

- The `e2e` job currently has no GitHub branch-protection "required status
  check" configured on `keepance-3.0` (verified 2026-07-01) — so today this is
  a norm, not yet a hard block enforced by GitHub. Making it a true required
  check (so a red `e2e` run literally blocks the merge button) is a
  repo-settings change or branch protection change, out of this doc's lane, to be picked
  up by whoever owns branch protection.
- Until it's a hard GitHub-enforced gate, treat it as a **hard human gate**:
  don't merge into `keepance-3.0` on top of a red `e2e` run without first
  either fixing it or explicitly quarantining the failing spec(s) here.
