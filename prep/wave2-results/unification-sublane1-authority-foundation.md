# Unification sub-lane 1 — authority foundation

- Branch: `feat/unification-sublane1-authority-foundation`
- Base SHA: `0683ff9b6987334e2191a6e8ed302491be55fbf7`
- Frozen source: `207ec6367`
- Final foundation code SHA: `c35c7a031cfa74c93722eed7f8bae77fd0c66013`
- Receipt: `src/platform/client-context/evidence/receipt.md`
- Rust touched: no

## Delivered

The platform package now has the sealed, tri-state authority foundation, still
dark behind `selection-authority-boot-gate`. Its first enabled authority read
cannot expose a persisted scope before real validation. Its real matter-store
subscription blocks the source immediately if a selected matter is later
archived or deleted, even after the legacy follower already converged.

With the flag off, an executable copy of the exact pre-foundation client store
runs next to the current store and confirms the same observable boot no-op,
select/clear transitions, blank-client error, subscriber values, and follower
values. Rejected sealed requests stay a no-op refusal while dark. No external
caller, consumer, writer, Meeting surface, or guard was migrated in this lane.

## Evidence fixes completed

1. The complete frozen delta list now names every changed semantic group, its
   reason, and fresh coverage; the only byte-identical source groups are
   separately hash-confirmed.
2. Boot coverage now uses the real authority read rather than calling an unused
   helper, for valid, null, missing, and archived persisted values.
3. Live invalidation coverage uses the real matter-store archive and delete
   operations after convergence.
4. Zustand is recorded honestly: the install is 5.0.14 while the lockfile says
   5.0.12; `npm ci` cannot cleanly restore it because the lockfile is missing a
   declared lint plugin. The subscriber proof was rerun against 5.0.14.
5. The retained 359-finding lint log was an environment/install mismatch. The
   current lint gate has zero new findings without any baseline update.

## Verification

- Focused authority Vitest suite: 21/21 passed.
- Test and application TypeScript checks: passed.
- Authority proof includes sealed forgery, stale/request revalidation,
  all-matters, single-flight retry, subscriber throw, dark refusal, boot, and
  live archive/delete invalidation.
- The complete fresh machine receipt is intentionally left for the coordinator
  to run in the next honest window; this worker did not run it.
