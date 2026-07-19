# F12 structured Summary receipt

Base: `800a5df6512d157aab481376b22cec44cd8bf5cf`

## Review pointers

1. `bc0d255fb756adfef2fb907fc5a46bc8524323fd` — client-bound summary
   artifact type and reader.
2. `4a6495aa4cc49a34c6221d0612087c2ef4a54deb` — structured Summary panel,
   stale-load clearing, and compatibility-slot rebind.
3. `a92a595789d11b827041cc71600424e4ef4ad729` — CHANGES-1 fix: the Summary
   panel no longer reads or renders folder-only summary content.
4. `4a665a07dc752ad748197993bd3742fc39932bda` — preserves non-content
   pending/error feedback and updates legacy host tests to require the new
   fail-closed behavior.

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
- Folder-only compatibility fails closed: the compatibility binding remains in
  place until F11 makes pair-bound host identity mandatory, but it renders only
  an empty state. It never projects `context.summaryText`, `notes.docx`, or
  folder metadata into the Summary screen.
- Shared-folder isolation:
  `StructuredMeetingSummaryPanel.test.tsx > does not give household B household
  A folder summary when both share a matter and meeting folder` gives both
  households the same matter and folder, leaves B without a sealed summary
  artifact, and proves the folder is not read and A's summary never reaches the
  DOM.
- Missing-host isolation:
  `StructuredMeetingSummaryPanel.test.tsx > fails closed when the folder-only
  host already extracted a summary` proves even pre-extracted folder text stays
  dark when the host has not supplied the canonical meeting and sealed pair.
- Fence: the panel reads the client-scoped meeting/artifact stores only. It does
  not import or call the firm-wide review reader, a provider/model, or
  `registerMeetingPanel`; it performs no generation to populate the shell.

## Original F12 verification receipt

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

## CHANGES-1 fix receipt

- Focused Summary plus affected legacy-host run — PASS: 5 files, 26 tests.
- `npm run gate:changed` — PASS on attempt 2: 155 files, 831 tests. Attempt 1
  correctly exposed 11 old expectations that required the retired folder-only
  content; those focused expectations were updated before the green rerun.
- `npx eslint src/features/meetings/StructuredMeetingSummaryPanel.tsx
  src/features/meetings/StructuredMeetingSummaryPanel.test.tsx
  src/features/meetings/structuredMeetingSummary.ts
  src/features/meetings/structuredMeetingSummary.test.ts` — PASS.
- `npm run typecheck -- --pretty false` — PASS.
- `npm run boundaries:check` — PASS:
  `No feature-boundary regression (597 current baseline finding(s)).`
