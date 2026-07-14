# Feature-flag cleanup lane

Feature flags are temporary scaffolding. Every live entry adds two paths to
understand and test, so the cleanup lane removes them before they become part
of the product forever.

## Inputs and staleness detection

Run the registry inventory; it is the only source of truth:

```bash
node scripts/flag-inventory.mjs
node scripts/check-flag-cap.mjs
```

Review every entry that is near expiry, past expiry, or old enough that its
owner cannot say why the dark path remains. The expiry unit test blocks a
forgotten date automatically.

## Cleanup-lane brief template

```md
Flag: <id>
Owner lane: <ownerLane>
Created / expires: <createdAt> / <expiresAt>
Decision: remove | graduate permanently on | extend once
Evidence: <release result, user-test result, or reason>
Files and paths to remove: <router calls, guarded UI, tests, docs>
Rollback: <how the normal release rollback covers this; no flag remains>
```

An extension is deliberate work: update the expiry date and record why in the
brief. Do not use an extension to quietly defer the decision.

## Piranha-style workflow

1. Start from the inventory, choose one stale flag, and give the cleanup lane
   the brief above.
2. Search for every `useFlag`, `isEnabled`, and test reference to its id.
   Make the selected behavior permanent, delete the other path, then delete
   the descriptor in the same change.
3. Review the diff for missed guarded branches and for any copy, analytics, or
   tests that still name the flag. Run focused tests plus the expiry and cap
   checks.
4. Merge only when the descriptor and all old branches are gone. Re-run the
   inventory so the next cleanup lane starts with the smaller list.

## Gate configuration guidance

The production-config test must pass only `VITE_FLAG_<UPPER_SNAKE_ID>` values
to the router; localStorage overrides are ignored outside development. The
all-pending-off fallback is a second test configuration with no flag variables
at all, which keeps every registry default (`false`) dark. This proves both the
intended release configuration and the safe behavior when a configuration is
missing.

When the gate is wired, add both:

```bash
node scripts/check-flag-cap.mjs
npm exec vitest run src/platform/flags/expiry.test.ts src/platform/flags/router.test.tsx
```
