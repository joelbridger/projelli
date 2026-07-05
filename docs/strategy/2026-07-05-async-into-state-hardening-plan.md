# Async-into-State Hardening — design note (staged; the deep half of bug-class #1)

*From the 2026-07-05 assessment. The guardrails lane (lp/guardrails) adds the LINT that stops NEW silent-failure/incomplete-locale code. This note is the deeper, more invasive half: a standard PATTERN so the "async finished late → wrong/stuck state" class stops being writable. Staged deliberately — it touches many files and should land when the current feature wave (trust tiers, Notice Card, swallow fixes) has settled, not mid-churn.*

## The problem, precisely
Two shapes recurred all day:
1. **Swallowed failure → silent wrong/stuck state** (empty catch, `.catch(()=>{})`, floating promise). → Lint handles NEW ones (guardrails lane); burn down the baseline via the swallow fix-lanes.
2. **Stale async completion sets state after the context changed** (a load for client A resolves after switching to B and calls setState; a cancelled/superseded request still fires its side effect). → THIS is what the pattern below addresses. Lint can't reliably catch it; a shared primitive can make the safe path the easy path.

## The proposed primitive: `useLatestAsync` / `runGuarded`
A single hook + helper every "async → state" site uses, so the correct behavior (error path + still-current guard + cleanup cancellation) is the default, not something each author reinvents (and forgets):

```
// Resolves only if this is still the latest call for this key AND the component is mounted.
const run = useLatestAsync();
run(async (signal) => {
  const result = await load(id);           // signal aborts on supersede/unmount
  return result;                            // returned value is DROPPED if superseded
}, {
  onResult: (r) => setState(r),             // called ONLY if still-current
  onError: (e) => setError(classify(e)),    // MANDATORY — no silent swallow
  key: id,                                   // a newer call with any key supersedes
});
```

Guarantees by construction: (a) a superseded/late completion never sets state; (b) every path has an error handler (no silent swallow); (c) unmount cancels; (d) the "still pending forever" state is impossible because onError always fires on failure.

## Adoption plan (incremental, non-breaking)
1. Build + unit-test the primitive (`src/platform/hooks/useLatestAsync.ts`) with a fake-clock/fake-abort test suite proving supersede-drops-result, error-always-fires, unmount-cancels.
2. Migrate the KNOWN offenders first (the ones already fixed by hand today become the reference migrations + regression tests): notice-trail load, Ask provider resolution, whole-practice send, meeting scan, orphan filter.
3. Then a guided sweep (the race-sweep Codex findings map the sites) migrating remaining `async→setState` sites, one PR per feature area.
4. Once adoption is broad, add a lint rule that flags `setState`/`setX` inside an un-guarded `await`/`.then` in effects — the same fail-on-new baseline pattern as the silent-failure rule.

## Why staged, not now
It touches dozens of files across features; running it while the trust-tier + Notice-Card + swallow lanes are hot guarantees conflicts. Trigger: after those merge and the merge queue is quiet. Effort: L (one primitive lane, then N incremental migration PRs). This is the structural end-state that makes bug-class #2 un-writable.
