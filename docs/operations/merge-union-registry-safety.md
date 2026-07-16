# `merge=union` registry safety review

## Decision

Enable Git's built-in `union` merge driver for **only**
`src/platform/flags/registry.ts`.

The flag inventory is a real append-only set: each entry is a complete flag
record, the router selects by `id`, and no flag is selected by array position
or consumes another flag's `id`. The registry guard enforces those assumptions.
It also enforces the one-line `defineFlag(...)` convention that makes Git's
line-based union result safe.

Lane self-check, before handing off a change that appends a flag:

```bash
node scripts/check-union-registry-preconditions.mjs
```

This is documentation only. It deliberately does not change `merge-gate.sh`,
its launcher, or any coordinator brief; adoption belongs to the coordinator
governance process.

## FUSION TRAP: empirical result and fix

The original registry used one multi-line object literal per descriptor. A real
two-branch, both-at-end merge with `merge=union` active did **not** retain two
objects. Git coalesced the common field lines and produced one malformed object
with duplicate `id` and `description` keys:

```ts
{
  id: 'union-sim-raw-ours',
  description: 'Complete descriptor union-sim-raw-ours.',
  id: 'union-sim-raw-theirs',
  description: 'Complete descriptor union-sim-raw-theirs.',
  ownerLane: 'merge-union-simulation',
  // … shared fields …
}
```

`tsc --noEmit` rejected that merge with `TS1117: An object literal cannot have
multiple properties with the same name` for both duplicate keys. Therefore a
plain attribute on the old shape would be unsafe.

The registry now uses one physical `defineFlag(...)` call per descriptor. The
helper preserves the same descriptor object and literal `FlagId` union. The
file is excluded from Prettier because the deliberately atomic call lines are
part of its merge-safety contract. Two concurrent additions are now two
distinct full lines, which Git's union driver cannot weave into one object.

## MERGE-SIMULATION EVIDENCE

All simulations used temporary local clones based on the current
`origin/merge/combined` tip. Each simulation first committed the active
`.gitattributes` rule, then created two branches from that same base, appended
one complete descriptor per branch, and performed an ordinary `git merge`.
No working feature branch was changed by the simulations.

| Case | Shape and positions | Result |
| --- | --- | --- |
| Original control | Two multi-line objects, both at the end | Unsafe fusion shown above; merge reported only two inserted lines; `tsc` failed with `TS1117`. |
| Refactored conflict case | Two one-line `defineFlag(...)` calls, both at the end | Merge retained exactly one complete `union-sim-at-end-ours` call and one complete `union-sim-at-end-theirs` call; `tsc --noEmit` passed. |
| Refactored separated control | One one-line call inserted between existing entries and one appended at the end | Merge retained exactly one complete descriptor from each branch; `tsc --noEmit` passed. |

Representative command sequence:

```bash
git clone --no-local /home/jameson/v1-speedup-union /tmp/union-registry-sim/repo
git -C /tmp/union-registry-sim/repo checkout origin/merge/combined
# Commit the attribute and the tested registry shape to a temporary simulation base.
git -C /tmp/union-registry-sim/repo checkout -b sim-ours sim-base
# Append a complete union-sim-…-ours descriptor and commit it.
git -C /tmp/union-registry-sim/repo checkout -b sim-theirs sim-base
# Append a complete union-sim-…-theirs descriptor and commit it.
git -C /tmp/union-registry-sim/repo checkout sim-ours
git -C /tmp/union-registry-sim/repo merge --no-edit sim-theirs
tsc --noEmit -p /tmp/union-registry-sim/repo/tsconfig.json
```

## Registry survey

Only the flag registry meets the narrow precondition today. The following
nearby registry/contribution files were surveyed and intentionally excluded.

| Candidate | Why it is excluded from `merge=union` |
| --- | --- |
| `src/app/shell/registry/appSurfaceRegistry.ts` | Surface rendering uses `order`; equal values fall back to registry order, so order is still meaningful. |
| `src/features/settings/registry/settingsModuleRegistry.ts` | A panel names its parent section and groups/definitions must be globally unique: entries can directly depend on sibling entries. |
| `src/features/crm-clients/directoryRegistry.tsx` | Query comparators deliberately compose in descriptor order; the file also contains several different contribution lists. |
| `src/features/crm-clients/recordRegistry.tsx`, `tabRegistry.ts` | Sections name tabs and all visible contributions use `order`; these are not independent sets. |
| `src/features/crm-home/registry.ts` | Its own contract preserves route order, and feature surfaces carry ordered placement behavior. |
| `src/app/commands/registry/{commandRegistry,navigationTargetRegistry}.ts` | Commands can collide on shortcuts; navigation targets name app-surface ids, creating a cross-registry dependency. |
| `src/features/account/{accountSectionRegistry,connectionCardRegistry}.ts` | Sections/cards are rendered by placement and numeric order, with static import changes in the same files. |
| `src/app/shell/client-context/clientContextAdapterRegistry.ts` | The consumer can choose among adapters; no proof exists that the list is a commutative set. |
| `src/features/{meetings,crm-tasks,crm-workflows,crm-pipeline,scheduling}/…Registry.*` | These mount UI fragments in explicit numeric order; order is product behavior. |
| `src/platform/privacy/egressModules/registry.ts` | It intentionally flattens operations in registry order and is privacy/security-sensitive. |
| `src/features/booking/public-page/registry/bookingPageRegistry.ts`, `src/features/audit/auditActionRegistry.ts` | They are not demonstrated lane-append hot spots with an enforced independence contract; their current multi-line descriptor shapes would reintroduce the fusion risk. |

## Guard and limits

`scripts/check-union-registry-preconditions.mjs` parses the TypeScript source
and requires every flag entry to be a single-line call with five literal string
arguments. It rejects duplicate ids, a descriptor mentioning a sibling id, and
numeric `flagRegistry[index]` access, and removal of the Prettier exclusion.
This makes the flag registry a stable, order-independent set rather than an
ordered program.

The rule is intentionally narrow. `merge=union` does not validate meaning: it
can still preserve duplicate lines or duplicate ids if two lanes choose the same
new id. The existing registry/type checks and normal independent review remain
required. Any additional file needs its own independence proof, guard, and real
merge simulation before gaining this attribute.
