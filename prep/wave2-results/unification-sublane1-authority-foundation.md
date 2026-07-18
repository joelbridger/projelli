# Unification sub-lane 1 — authority foundation

- Branch: `feat/unification-sublane1-authority-foundation`
- Base SHA: `0683ff9b6987334e2191a6e8ed302491be55fbf7`
- Frozen source: `207ec6367`
- Final foundation code SHA: `ef9b7d878c3285ec7339f519ec8da5ca8487d8e6`
- Receipt: `src/platform/client-context/evidence/receipt.md`
- Rust touched: no

## Delivered

The platform package now has the sealed, tri-state authority foundation, still
dark behind `selection-authority-boot-gate`. Its first enabled authority read
cannot expose a persisted scope before real validation. Its real matter-store
subscription blocks the source immediately if a selected matter is later
archived or deleted, even after the legacy follower already converged.

With the flag off, an executable copy of the exact pre-foundation client store
runs next to the current store with the same deliberately messy client input.
It confirms matching trim/fallback behavior, complete subscriber values,
errors, and final client state, as well as the boot no-op and follower values.
Rejected sealed requests stay a no-op refusal while dark. No external
caller, consumer, writer, Meeting surface, or guard was migrated in this lane.

## Evidence fixes completed

1. The complete frozen delta list is now an exhaustive non-overlapping source
   partition. Every changed group has its reason and fresh coverage; the only
   byte-identical source groups are separately hash-confirmed.
2. Boot coverage now uses the real authority read rather than calling an unused
   helper, for valid, null, missing, and archived persisted values.
3. Live invalidation coverage uses the real matter-store archive and delete
   operations after convergence.
4. The lockfile now includes the missing local test-rule workspace package, so
   `npm ci` is reproducible. The clean installed Zustand is 5.0.12, matching
   its lockfile entry, and the subscriber proof was rerun there.
5. The retained 359-finding lint log is the honest pre-fix record. The scrubbed
   current lint gate has zero new findings without any baseline update.

## Verification

- Focused authority suite plus the 15 formerly import-failing changed-gate
  files: 16 files / 82 tests passed.
- The scrubbed `gate-preflight.sh` lint, application TypeScript, and test
  TypeScript checks passed.
- Authority proof includes sealed forgery, stale/request revalidation,
  all-matters, single-flight retry, subscriber throw, dark refusal, boot, and
  live archive/delete invalidation.
- The complete fresh machine receipt is intentionally left for the coordinator
  to run in the next honest window; this worker did not run it.
