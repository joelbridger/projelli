# Workflow completion seam result

- Branch: `feat/workflow-completion-seam`
- Approved base: `8118b12cca5f05892e1418c254818268795694e8`
- Review cured: `terra-seam-CHANGES5.log`
- Reviewed code tip: `c2a2198be`
- Final full verification receipt: pending the separate quiet-window run
- Existing receipt: covers pre-fix commit `ba82a42be` only

## Outcome

PASS. Round 2 closes every CHANGES-5 finding:

1. The legacy completion helper is private. The whole-tree guard rejects any
   production reference to its name, including an aliased import, and separately
   proves the owner module does not export it.
2. Each validator receives its own defensive workflow snapshot. A validator can
   alter that copy without changing the live instance or what a later validator
   sees.
3. Today catches a refused completion and shows the refusal through its existing
   `FreshnessBanner` attention state.
4. The migration checklist catches a refused completion and shows it through the
   existing migration error surface. It does not mark the decision saved.
5. Migration builds and validates the complete recreated instance before saving
   the new template. A refusal therefore makes zero persistence calls.
6. Focused tests click the real Workflows, Today, and migration controls instead
   of relabelling three calls to the canonical writer.

## Compatibility proof

The empty-validator test fixes time and randomness, serializes the complete
output, and compares both its exact byte length and SHA-256 with the pre-round-2
baseline:

```text
bytes: 7141
sha256: fc307244a38bb17ffa76dc75f48f1fd906c153559b7f29a6f0ecf3056e2de409
```

Any byte change fails the test. The existing workflow behavior assertions were
kept and now enter through the only public completion writer. The earlier result
text about an original red fixture was removed because the reviewer correctly
found that fixture was not present in branch history.

## Focused proof added

- A validator mutates its snapshot; the live instance stays `todo`, the next
  validator still sees `todo`, and the saved result becomes `done` normally.
- Workflows shows the typed refusal and never calls its save boundary.
- Today shows the refusal in the existing attention banner.
- Migration shows the refusal in the existing error surface and never shows
  “Decision saved.”
- A missing-template migration refuses before any template, instance, or
  checklist save.
- The bypass guard scans all production TypeScript for the retired helper name
  and checks both function exports and export lists in the owner module.

The first focused run after implementation was green:

```text
Test Files  5 passed (5)
Tests       40 passed (40)
Duration    5.51s
exit        0
```

## Final verification

Reviewed code tip: `c2a2198be`. The final full verification receipt is pending
the separate quiet-window run. The existing receipt covers pre-fix commit
`ba82a42be` only.

## Fence attestation

The round-2 production edits are limited to the reviewed completion seam,
Today refusal handling, and migration refusal/order handling. Tests and this
result were updated to prove those cures. The inherited receipts for meetings
(`f3ec9e0d`), browser guard (`1ca9e197`), and universal tags (`d3b0b0ff`) remain
untouched, as required.
