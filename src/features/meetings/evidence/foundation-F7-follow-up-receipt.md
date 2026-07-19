# Foundation F7 exact-meeting Outlook Drafts receipt

Base: `b34cf7755101e0f7d0d5ae5da5a1691a57736ec7`

## Scope delivered

The Follow-up panel reads and writes only through a target that requires the
exact canonical meeting plus the sealed `householdRef + matterId` pair. Its
opaque recap key is derived from all three values. Empty, partial, mismatched,
duplicate, malformed, and legacy matter-only records fail closed.

The editable recap uses the existing email draft backend through an Outlook
Drafts-only capability. That capability lists only Microsoft 365 accounts and
saves only after the advisor presses **Save to Outlook Drafts**. It has no Send
or Generate control, its send handler refuses the mode as a second guard, and
failed saves expose a generic retry message rather than a raw provider error.
An Outlook success is never made retryable merely because the later local
status update fails, preventing a duplicate Outlook draft.

The compatibility binding imports the exact Follow-up identifier from F2's
`BLESSED_MEETING_PANEL_IDS` public Meetings doorway. It registers only for the
lifetime of a real sealed `MeetingEntry` host and adds no base descriptor.

## Opus security and egress review pointers

Review these commits in order:

1. `57ea35243` — Outlook Drafts-only mode, explicit save, generic provider
   errors, Outlook-only account filter, and defense-in-depth no-send guard.
2. `04d14ff5d` — exact meeting plus sealed household/matter target, derived key,
   current-record validation, panel states, and blessed Follow-up binding.
3. `54997f017` — same-matter/different-household isolation, no-send assertions,
   runtime missing-pair refusal, and compile-negative matter-only fixtures.

## Claim artifacts

- `meetingFollowUpStore.test.ts` proves household B cannot see household A's
  recap even when the matter ID and meeting ID are the same.
- The same store test contains `@ts-expect-error` fixtures proving matter-only
  reads and writes cannot typecheck, plus runtime empty/missing-pair cases.
- `MeetingFollowUpPanel.test.tsx` proves explicit single-draft saving, no Send
  or Generate control, no call to `mailSend`, no-Outlook blocking, editing and
  saved states, generic provider failure text, and retry.
- `meetingFollowUpCompatibility.test.tsx` proves the exact blessed ID, one
  host-lifetime registration, and no base Follow-up descriptor.
- A whole-tree scan of every `MeetingFollowUp` / `meetingFollowUp` source found
  no `householdRef?:` access: `FOLLOW_UP_OPTIONAL_HOUSEHOLD_SCAN=PASS`.

## Verification evidence

- `GATE_BASE=b34cf7755101e0f7d0d5ae5da5a1691a57736ec7 npm run gate:changed`
  — pass on the second and final allowed attempt: application and test
  TypeScript, Tauri command contracts, provider and consent safeguards, wire
  contracts, brand/identity checks, ESLint regression gate, 314 test files,
  and 2,004 tests.
- Attempt 1 exposed one test mock lint issue and the undeclared, intentional
  `meetings -> email` public capability edge. Both were corrected before the
  final attempt. Its test run otherwise passed 1,177 files and 9,282 tests.
- Focused follow-up, legacy modal, and architecture run — pass: 5 files / 31
  tests.
- `npx tsc --noEmit` — pass.
- `npx tsc -p tsconfig.test.json --noEmit` — pass, including the negative type
  fixtures.
- `npm run boundaries:check` — pass: no feature-boundary regression (597
  current baseline findings).
- `npm run i18n:completeness` — pass: 65 catalogs / 3,865 keys.
- `git diff --check` — pass.

## Fence receipt

- No Send path in Outlook Drafts-only mode.
- No implicit save and no implicit send.
- No raw Outlook error reaches the panel.
- No cross-meeting lookup.
- No matter-only or household-optional follow-up access.
- No shell placeholder reconciliation and no panel from another lane.

Native/Rust touched: **NO**.
