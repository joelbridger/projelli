# `merge=union` flag-registry safety

## Decision and non-negotiable checks

Git's built-in `union` driver is enabled for exactly one file:
`src/platform/flags/registry.ts`. Each descriptor is one physical
`defineFlag(...)` line, so two independent additions cannot have their fields
woven together.

This is not a best-effort convention. The normal blocking gate runs both:

```bash
node scripts/check-union-registry-preconditions.mjs
node scripts/check-union-registry-merge-history.mjs
```

The first check rejects malformed or multi-line descriptors, duplicate ids,
sibling-id dependencies, removal of the Prettier exclusion, and positional
access (`flagRegistry[index]` or `.at(...)`) in every tracked TypeScript or
JavaScript consumer under `src/`. The second check is merge-parent-aware: for
a two-parent merge it compares the merge base, both parents, and the final
registry. If either parent deleted a base flag and the merged result contains
it, the gate fails. A delete therefore cannot be silently undone by an append.

`scripts/flag-registry.mjs` is the canonical reader used by the flag-cap and
inventory commands. It reads the atomic `defineFlag(...)` form into the same
six `FlagDescriptor` fields as before. It also understands the old object
form only for merge-history inspection of pre-adoption parents; the automatic
precondition gate rejects that old form in the live registry.

Useful local commands:

```bash
npm run flags:union:check
npm run flags:union:simulate
node scripts/check-flag-cap.mjs
node scripts/flag-inventory.mjs
```

## One-time transition rule for existing lanes

Do not ordinarily merge an old-style flag-registry lane after this attribute is
active. A normal Git merge can retain both the new one-line registry and the
old multi-line registry without showing a conflict marker.

For every lane already based on the old object form, use this mechanical
sequence:

1. Start from the adopted one-line registry, not from the merged registry file.
2. Compare the lane's registry to its old base and extract only its newly added
   descriptors.
3. Convert each extracted descriptor to one complete one-line `defineFlag(...)`
   call and append it to the adopted registry.
4. Run `npm run flags:union:check`, the flag-cap command, focused flag tests,
   the merge simulations, and TypeScript before accepting the lane.

The checked-in old-style simulation proves why this freeze exists. It creates a
lane from an old object registry, adopts the one-line registry on the other
side, and performs an ordinary merge. Git may finish cleanly, but the automatic
precondition gate rejects the duplicated ids and old-form entries, so the bad
result cannot pass the build.

## Checked-in merge simulations

`npm run flags:union:simulate` uses fresh temporary Git repositories and real
ordinary merges. It never changes the working branch. Every case must be either
clean and correct or rejected by an automatic gate:

| Case | Required result |
| --- | --- |
| Two end appends | Both complete calls appear exactly once; structural and merge-history checks pass. |
| Insert plus append | Both complete calls appear exactly once; structural and merge-history checks pass. |
| Delete versus append | Git can merge, but the merge-parent check fails for the resurrected id. |
| Exact same full line | One line remains; both checks pass. |
| Same id, different metadata | The duplicate-id check fails. |
| Old-style in-flight append versus adopted file | The malformed/duplicate registry fails the automatic structural check. |

The focused unit test also parses the real registry through the canonical
reader, and the expiry behavior test proves that the set of expired ids is the
same after a permutation. The production router already creates a `Map` keyed
by id, so lookup does not depend on descriptor order.

## Registry survey

Only the flag inventory meets the narrow independent-set contract today. These
plausible registry-like files were reviewed and deliberately excluded:

| Candidate | Why it is excluded from `merge=union` |
| --- | --- |
| `src/app/shell/registry/appSurfaceRegistry.ts` | Surface rendering uses `order`; equal values fall back to source order. |
| `src/features/settings/registry/settingsModuleRegistry.ts` | Panels name parent sections and definitions must be globally unique. |
| `src/features/crm-clients/{directoryRegistry,recordRegistry,tabRegistry}.*` | Comparators, tabs, and sections deliberately compose in descriptor order. |
| `src/features/crm-home/registry.ts`, `src/features/home/homeWidgetHostRegistry.ts` | Product placement and source-order tie-breaking are observable behavior. |
| `src/app/commands/registry/{commandRegistry,navigationTargetRegistry}.ts` | Shortcut collisions and cross-registry ids create sibling dependencies. |
| `src/features/account/{accountSectionRegistry,connectionCardRegistry}.ts` | Placement order and static imports change behavior together. |
| `src/app/shell/client-context/clientContextAdapterRegistry.ts` | Consumers choose among adapters; it is not proven to be a commutative set. |
| `src/features/{meetings,crm-tasks,crm-workflows,crm-pipeline,scheduling}/…Registry.*` | UI fragments have explicit numeric placement. |
| `src/platform/privacy/{egressModules/registry.ts,egressRegistry.ts}` | Operation flattening is ordered and privacy-sensitive. |
| `src/platform/fs/docxSaveRegistry.ts` | This is a mutable runtime store, not a lane-append source inventory. |
| `src/features/booking/public-page/registry/bookingPageRegistry.ts`, `src/features/audit/auditActionRegistry.ts` | They are not proven independent lane-append hot spots and their descriptor shape is not atomic. |

Any future candidate needs its own independence proof, blocking guard, and real
merge simulation before receiving the attribute.

## Evidence run — 2026-07-16

The repaired branch was checked with these results:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| Focused router, expiry, and flag-script tests | 3 files, 10 tests passed. |
| `npm run flags:union:check` | Passed on the normal branch; merge-history check correctly reports that the current tip is not a two-parent merge. |
| `node scripts/check-flag-cap.mjs` | Passed: 19/300 active flags. |
| `node scripts/flag-inventory.mjs` | Passed and printed the full 19-flag inventory. |
| `npm run flags:union:simulate` | All six real temporary-repository merge cases passed their required clean-or-fail outcome. |
| `git diff --check` | Passed. |

No Cargo command was run for this change.
