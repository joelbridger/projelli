# Foundation F10 truthful management receipt

Base: `b34cf7755101e0f7d0d5ae5da5a1691a57736ec7`

## Opus review pointers

Review these commits in order:

1. `bab5e057b` — splits the real firm template library from its optional fill
   binding; makes the library usable without an open meeting; threads F11's
   verified host identity into the existing inline transcript panel; removes
   the old folder/matter-shaped fill props; and adds translated
   loading/empty/error/retry states.
2. `c41b08716` — adds the pair-required Automations scope, selected-client
   candidate/count filtering, same-matter/different-household refusal,
   firm-wide behavior only for the explicit all-matters arm, and translated
   loading/empty/error/retry states.

## Claim artifacts

- Firm library and fill are separate: `MeetingTemplatePanel.test.tsx > opens
  and manages the real firm library without any meeting, then fills only after
  an F11 binding is supplied` opens and edits `.lantern/meeting-templates.json`
  without meeting data. The fill control appears only after the complete F11
  pair plus sealed F8 target is supplied.
- Matter/folder-only fill does not compile: `MeetingTemplatePanel.test.tsx >
  has no matter-only or folder-only fill call shape` contains compile-negative
  checks for a missing sealed target and the retired `meetingDir` prop.
- Inline fill consumes F11: `MeetingEntry` supplies its already-verified
  `MeetingEntryHostIdentity` through `MeetingPanelContext`.
  `TranscriptCompatibilityPanel` passes its `clientBoundary + target` pair to
  the only optional fill binding. `MeetingTemplatePanel` calls
  `meetingEntryHostIdentity` and derives the write folder only from the
  verified result.
- Same matter, different household fails closed:
  `MeetingTemplatePanel.test.tsx > fails closed for the same matter under a
  different household before provider or transcript fill runs` proves no AI
  provider call, review content, or fill control escapes.
- Stale transcript work is discarded: `MeetingTemplatePanel.test.tsx >
  discards an in-flight fill when the F11 pair changes before AI returns`
  switches from household A to household B while the provider is pending and
  proves A's text never renders or saves. The save path rechecks the current
  F11 result immediately before writing.
- Selected Automations require a sealed pair:
  `AutoJoinMeetingsPanel.test.tsx > has no matter-only selected Automations
  scope` is compile-negative for `{ matterId }` access.
- Candidate rows and counts are pair-proven:
  `AutoJoinMeetingsPanel.test.tsx > shows a selected household only its proven
  pair, even when another household uses the same matter id` proves household A
  sees its candidate while household B, with the same matter ID, sees none.
  The UI test also proves selected mode stays filtered while explicit
  all-matters mode is firm-wide.
- Async calendar results carry a request and scope revision. Results from an
  older selected pair are discarded before rows or counts can render.
- Real panels own explicit local states. Tests prove loading, translated empty,
  translated error, and retry behavior, and prove raw storage/calendar errors
  do not render.

## Fence receipt

- No fake template catalogue or automation rule list was added.
- No firm-template client-filter claim was added.
- No `matterId`, `meetingDir`, or folder-only fill overload survives in F10.
- No selected-client Automation row or count survives without one exact saved
  household link matching the sealed pair.
- `src/app/shell/MeetingsWorkspace.tsx` and all standalone destination/host
  work remain untouched for Group E.
- F8's store and F11's host-identity guard were consumed, not reimplemented.
- Native/Rust touched: **NO**.

## Verification receipt

- `GATE_BASE=b34cf7755101e0f7d0d5ae5da5a1691a57736ec7 npm run gate:changed`
  — **PASS on the first official gate attempt**: 313 test files and 1,994
  tests passed. Tauri parity/contracts, provider front door, consent wiring,
  TypeScript, test TypeScript, wire contracts, brand/identity checks, and the
  ESLint regression gate all passed.
- Focused F10 plus preserved F11 run — **PASS**: 4 files, 17 tests.
- `npm run i18n:completeness` — **PASS**: 65 catalogues, 3,893 keys, all target
  shards complete.
- `npm run boundaries:check` — **PASS**:
  `No feature-boundary regression (597 current baseline finding(s)).`
- `git diff --check` — **PASS**.
