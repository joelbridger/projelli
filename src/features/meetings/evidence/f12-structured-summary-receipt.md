# F12 structured Summary receipt

Base: `800a5df6512d157aab481376b22cec44cd8bf5cf`

## Review pointers

1. `bc0d255fb756adfef2fb907fc5a46bc8524323fd` — client-bound summary
   artifact type and reader.
2. `4a6495aa4cc49a34c6221d0612087c2ef4a54deb` — structured Summary panel,
   stale-load clearing, and compatibility-slot rebind.

## Claim artifacts

- Exact meeting + exact client pair:
  `structuredMeetingSummary.test.ts > selects the newest real summary for the
  exact meeting and sealed pair` uses household A and household B with the same
  matter ID, proves B is refused by A's reader, proves deterministic newest-A
  selection, and proves the real approval transition becomes `reviewed`.
- No stale fallback:
  `structuredMeetingSummary.test.ts > does not fall back to an older artifact
  when the newest summary is malformed` proves stale valid content is not shown
  as current after a newer unreadable artifact arrives.
- Async client switch clearing:
  `StructuredMeetingSummaryPanel.test.tsx > clears client A synchronously and
  ignores A when its async read finishes late` drives A → B with one shared
  matter, resolves A after the switch, and proves A never reaches the DOM.
- Honest sections and states:
  `StructuredMeetingSummaryPanel.test.tsx > renders only real populated
  sections and omits absent cards` proves recap, decisions, processing, and
  review state render from the result while an absent personal-notes section
  leaves no card.
- Rebind, not registration:
  `StructuredMeetingSummaryPanel.test.tsx > rebinds the one existing blessed
  summary descriptor without registering another` proves the registry contains
  exactly one `summary` descriptor and its mount is
  `StructuredMeetingSummaryPanel`. A production-source search finds the sole
  `id: 'summary'` binding in `meetingWorkspaceCompatibility.tsx` and no Summary
  call to `registerMeetingPanel`.
- Existing behavior preserved: the focused legacy tests for notes retry,
  unreadable Word bytes, Word-native review items, pending state, and the
  existing Summary test IDs all pass. The folder-only compatibility branch is
  intentionally retained until F11 makes pair-bound host identity mandatory;
  structured artifact access itself is available only with the canonical
  meeting and sealed household + matter pair.
- Fence: the panel reads the client-scoped meeting/artifact stores only. It does
  not import or call the firm-wide review reader, a provider/model, or
  `registerMeetingPanel`; it performs no generation to populate the shell.

## Verification receipt

- `npm run gate:changed` — PASS.
  - TypeScript application and test type checks passed.
  - Wire contracts, brand/identity checks, and the ESLint regression gate
    passed.
  - Changed-test run: **304 test files passed; 1,956 tests passed**.
- `npm run boundaries:check` — PASS:
  `No feature-boundary regression (597 current baseline finding(s)).`
- `npm run i18n:completeness` — PASS:
  63 catalogues, 3,790 keys, all target shards complete.
- Focused F12 + preserved-behavior run — PASS:
  5 files, 22 tests.
