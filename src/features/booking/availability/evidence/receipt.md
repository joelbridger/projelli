# Booking availability receipt

Historical snapshot: `5713b4ba8`.

## Complete 19-path blob comparison

| Path | Historical blob SHA | Current blob SHA | Byte-clean |
| --- | --- | --- | --- |
| `src/features/booking/availability/BookingAvailabilitySettings.test.tsx` | `9576df96f0dc1c22a246309680f70faab188d25a` | `9576df96f0dc1c22a246309680f70faab188d25a` | yes |
| `src/features/booking/availability/BookingAvailabilitySettings.tsx` | `d500bc2e86a731b150ad595215281913c68a4252` | `d500bc2e86a731b150ad595215281913c68a4252` | yes |
| `src/features/booking/availability/evidence/receipt.md` | `aafbe2eafa59bc2bde92fd7845eeb6cb9153c281` | self-referential; final SHA is in the lane report | no |
| `src/features/booking/availability/index.ts` | `336b4b27b2c1ad8eb5522912bff189d64d019e09` | `336b4b27b2c1ad8eb5522912bff189d64d019e09` | yes |
| `src/features/booking/availability/locales/de.json` | `ec9029d8030c4c7ba3278cd541276ac8cdd98af5` | `ec9029d8030c4c7ba3278cd541276ac8cdd98af5` | yes |
| `src/features/booking/availability/locales/en.json` | `a424d268f497044348fe2c6b3ca34e56d17ec3ec` | `a424d268f497044348fe2c6b3ca34e56d17ec3ec` | yes |
| `src/features/booking/availability/locales/es.json` | `d2059d85c168e6ee9393549c5bd2f15c14a9213f` | `d2059d85c168e6ee9393549c5bd2f15c14a9213f` | yes |
| `src/features/booking/availability/settingsModuleDescriptor.tsx` | `9cbbfa75507a4836f6103fc84c9cffd15924f65c` | `9cbbfa75507a4836f6103fc84c9cffd15924f65c` | yes |
| `src/features/booking/index.ts` | `a5419fe6554bdac34ef94151d32ff89b0290d2aa` | `a5419fe6554bdac34ef94151d32ff89b0290d2aa` | yes |
| `src/features/calendar/core/index.ts` | `203b67256d727d2c247a872c4fe1c32169309331` | `203b67256d727d2c247a872c4fe1c32169309331` | yes |
| `src/features/calendar/core/settingsStores.ts` | `653dbf8f96f1abf9c1dca09a4aa0a1de68b51784` | `653dbf8f96f1abf9c1dca09a4aa0a1de68b51784` | yes |
| `src/features/calendar/core/types.ts` | `4302a289625d37ce5bb02e4c06dea3b019a5165a` | `4302a289625d37ce5bb02e4c06dea3b019a5165a` | yes |
| `src/features/calendar/testing/index.ts` | `f4b22939e42ade527bb86c531af0d21d9501d232` | `f4b22939e42ade527bb86c531af0d21d9501d232` | yes |
| `src/features/calendar/testing/roundTripCalendarFoundation.test.tsx` | `7499a246e66844bdcd0e88ee97efff2c6f6ac48f` | `7499a246e66844bdcd0e88ee97efff2c6f6ac48f` | yes |
| `src/features/settings/registry/settingsModuleRegistry.test.ts` | `da5bc8d384a47dec45cd413bf6f4bb11ef095f64` | `7c545b40f9ae1efa727856f20fd8d02947badeb9` | no |
| `src/features/settings/registry/settingsModuleRegistry.ts` | `96f48861de7a01c83b14760cbeb2a724348639ac` | `33e62c03a26bf9b238fba9e7d4f348e7cf272a43` | no |
| `src/platform/flags/registry.ts` | `280c957bec91b613994d73897d3c957b3ddb9334` | `a662e2c5152b3e776467f7678ce8cb65f6e551fa` | no |
| `tests/public-imports/calendar-booking-availability.ts` | `ffd73a8cf9c91a82e8466eefbc00d878281e3398` | `ffd73a8cf9c91a82e8466eefbc00d878281e3398` | yes |
| `tests/unit/architecture-boundaries.test.ts` | `fd57d21995d83f6c77cc6a367bd69726ddacc73a` | `a13e5dff8718b2356464ef0095921eea9b536348` | no |

The receipt row cannot contain its own final Git blob ID: that ID is calculated from these exact bytes, including the ID cell. The committed, non-self-referential lane report records that final value.

## Every differing hunk and its current doorway

| File and line group | Current doorway served | Why this is the smallest difference |
| --- | --- | --- |
| `settingsModuleRegistry.ts`: `@/features/meetings` import | The existing Settings registry mounts `meetingIntelligenceSettingsPanel` and `meetingKeywordsSettingsPanel` through the Meetings public export. | Retains the two current registry entries; removing either would make a current Settings panel unreachable. |
| `settingsModuleRegistry.ts`: `SettingsModuleDescriptor`, mutable registry, and `settingsModuleRegistry.register` | The current public Settings contribution doorway is `settingsModuleRegistry.register`, and `getSettingsPanelDescriptors` reads that same mutable list. | Preserves the present registry contract while leaving the restored Booking registration as its one historical descriptor line. |
| `settingsModuleRegistry.ts`: Meetings entries in the panel list | The Settings panel list reaches the two current Meetings descriptors. | Keeps only those existing descriptor entries needed by the current registry list. |
| `settingsModuleRegistry.test.ts`: testing-library/React/flag imports and `afterEach` override reset | The test reaches the real Settings descriptor render doorway while resetting the development flag override after the test. | Adds only the tools and cleanup needed for the live mount proof; no product code changes. |
| `settingsModuleRegistry.test.ts`: enabled mount test | `getSettingsPanelDescriptors('scheduling')` returns the descriptor, whose real `render` function mounts `BookingAvailabilitySettingsMount`. | A real render plus the panel test id fails if the public Booking export or registered render doorway is null or a stub. |
| `settingsModuleRegistry.test.ts`: Scheduling fixture and Booking mock section | The mocked registry still validates the real descriptor's `scheduling` section shape. | One minimal fixture section and matching mock section preserve registry validity without broadening the test fixture. |
| `flags/registry.ts`: six current flag descriptors before `booking-availability` | `flagRegistry` is the closed-union doorway for current Calendar Write, workflow quick-add, public booking calendar, calendar grid, meeting-keyword, and calendar-add-event flags. | Retains exactly the six pre-existing current flags; the restored default-off Booking flag remains a separate historical descriptor. |
| `architecture-boundaries.test.ts`: `calendar-add-event->calendar` | The boundary allowlist admits Calendar Add Event's public Calendar import. | Adds one existing public feature edge and does not alter the boundary checker. |
| `architecture-boundaries.test.ts`: current `booking->calendar` comment plus `calendarWrite->calendar` and `calendar-grid->calendar` | The allowlist admits the current public booking page, Calendar Write, and Calendar Grid Calendar doorways. | Keeps only the three existing current public edges and their reasons; no rule or scan change. |
| `architecture-boundaries.test.ts`: `scheduling->calendar-grid` and `scheduling->calendar-add-event` | The Scheduling surface composes the two feature-owned descriptors through their public exports. | Adds only the two existing composition edges; the restored `settings->booking` entry remains the historical line. |
| `availability/evidence/receipt.md`: full replacement | This evidence receipt is the restoration-proof doorway for the Booking availability lane. | Replaces the false seven-versus-eight claim with the complete table and hunk register; it changes no product behavior. |

## Verification

| Check | Result |
| --- | --- |
| Registry suite, including `mounts the real booking availability panel through the enabled Settings doorway` | PASS — 14 tests |
| `npm test -- src/features/settings/registry/settingsModuleRegistry.test.ts src/features/booking/availability/BookingAvailabilitySettings.test.tsx src/features/calendar/testing/roundTripCalendarFoundation.test.tsx` | PASS — 3 files, 34 tests |
| Scrubbed `gate-preflight.sh` | PASS — `lint:gate`, `typecheck`, and `typecheck:tests` (`GATE_PREFLIGHT_EXIT=0`) |

## Combined final-tip Settings-host evidence (JP-056 + SC-011)

**Base:** `974f34e2394ad7b4131557be5c9fa9b09de0322c`.
**Implementation dark delta:** `5ce098d30fff0c18d4b2f0c79d4b76eb79210f52`.
**Final verified source tip:** `1808372a143c0577ec8ff2a348eac6c630171f6b`.

The final verified source tip includes only the test-hygiene repair required to
make the claimed four-suite command reproducible: each registry-host test
cleans up its rendered DOM and has a 15-second integration-test timeout. It
does not change production behavior. This receipt/report commit follows that
source tip and changes evidence text only.

The restoration proof above is inherited from `974f34e23`; this combined lane
did not re-perform its 19-path restoration comparison or alter the restored
production capability.

### Re-traced host and public-doorway route

- Static append: `settingsModuleRegistry.ts` imports
  `bookingAvailabilitySettingsPanel` from public `@/features/booking` and
  includes it once in `mutableSettingsPanelRegistry`.
- Descriptor: `settingsModuleDescriptor.tsx` remains `id:
  booking-availability`, `section: scheduling`, `order: 10`, and `flagId:
  booking-availability`. The existing Scheduling rail comes from
  `legacySettingsSections.tsx`; no rail or section was added.
- Both real shells use the shared renderer: legacy `SettingsContent.tsx` calls
  `renderRegisteredSettingsPanels(activeSection, sectionProps)` and enabled V1
  `SettingsV1FrameEnabled.tsx` calls
  `renderRegisteredSettingsPanels(effectiveSection, sectionProps)`.
- The panel's Calendar imports stay on public `@/features/calendar` doorways:
  capability, availability, aggregate settings and event stores, validators,
  `getBusyBlocks`, and `getBookableSlots`. No Calendar core/store/type file was
  changed.

The descriptor flag remains verbatim and default-off:

> defineFlag('booking-availability', 'Configure local booking availability', 'booking-availability', '2026-07-16', '2026-10-14'),

### Automated combined proof

New real-host tests use `setDevFlagOverride('booking-availability', true)` only
inside the test process. They prove the same restored descriptor is reachable
through legacy Settings → Scheduling and enabled V1 Settings → Scheduling.
Separate flag-off assertions prove that neither real host renders the panel.
They do not direct-render the panel as the host proof.

The existing restored panel tests remain green and prove both ledger rows on
their own capability:

- **JP-056:** one aggregate Calendar writer saves timezone, weekly hours,
  meeting types, buffers, notice, and horizon. Invalid drafts refuse before a
  writer runs.
- **SC-011:** exactly one home calendar plus selected busy blockers save in the
  same aggregate operation; the panel presents opaque busy blocks, not event
  titles or other event detail. Busy-time loading and rejected occurrence reads
  both show no slots and do not calculate slots.

No production defect was found. The only production changes are **none**;
this lane adds host-path regression proof only.

### Row-stamp evidence gate: D2 design review and live drive

**JP-056 ROW STAMP OWED:** its controlled flag-on live drive and D2 review are
incomplete. The required populated, empty/no-slot, loading,
unavailable/error, calendar-selection/blocker, opaque-preview, and flag-off
screenshots were not available. No fresh-read/cold-reload persistence proof or
design verdict is claimed for JP-056.

**SC-011 ROW STAMP OWED:** its controlled flag-on live drive and D2 review are
also incomplete. The same unavailable real workspace prevented a fresh-reader
proof for the home-calendar and selected-blocker state, and no D2 verdict is
claimed for SC-011.

A temporary local Vite flag-on browser attempt reached the app shell but could
not open a real workspace, so it could not truthfully drive Settings, save,
cold-reload, or capture the required panel states. The temporary override was
cleared and the local server was stopped. These are row-stamp evidence gaps,
not a green design verdict or a `DESIGN-CHANGES` verdict, and they do **not**
gate this dark delta's merge.

### Final commands and terminal output at final verified source tip

All commands below were run from
`1808372a143c0577ec8ff2a348eac6c630171f6b` before this evidence-only commit.

| Command | Result |
| --- | --- |
| Canonical scrubbed `/home/jameson/lantern/coordination/coordinator/tools/gate-preflight.sh` | PASS — `lint:gate`, `typecheck`, and `typecheck:tests` |
| `npm run typecheck:tests` | PASS |
| `node scripts/ui-system/handle-guard.mjs` | PASS — no permanent handle vanished and no new ambiguous handle was found (64 frozen duplicates; 479 permitted new handles) |
| `npx eslint src/features/booking/availability/BookingAvailabilitySettings.tsx src/features/booking/availability/BookingAvailabilitySettings.test.tsx src/features/booking/availability/index.ts src/features/booking/availability/settingsModuleDescriptor.tsx` | PASS — explicit flag-off availability lint coverage |
| `npm test -- src/features/settings/registry/settingsContentRegistry.test.tsx src/features/settings/v1-frame/SettingsV1FrameEnabled.test.tsx src/features/settings/registry/settingsModuleRegistry.test.ts src/features/booking/availability/BookingAvailabilitySettings.test.tsx` | PASS — 4 files, 35 tests |
| Temporary `VITE_FLAG_BOOKING_AVAILABILITY=true npm run dev -- --host 127.0.0.1 --port 5173` browser drive | INCOMPLETE, no real workspace available; override cleared and server stopped |

```text
$ npm run typecheck:tests
> advisor-prep-hero@3.3.5 typecheck:tests
> tsc -p tsconfig.test.json --noEmit

$ node scripts/ui-system/handle-guard.mjs
Handle guard: 2985 keys in source, 2506 in baseline.
✅ Handle guard passed — no permanent handle vanished, and no new ambiguous
(duplicate) handles (64 frozen; 479 new handles permitted).

$ npx eslint src/features/booking/availability/BookingAvailabilitySettings.tsx \
  src/features/booking/availability/BookingAvailabilitySettings.test.tsx \
  src/features/booking/availability/index.ts \
  src/features/booking/availability/settingsModuleDescriptor.tsx
[no output; exit 0]

$ npm test -- src/features/settings/registry/settingsContentRegistry.test.tsx \
  src/features/settings/v1-frame/SettingsV1FrameEnabled.test.tsx \
  src/features/settings/registry/settingsModuleRegistry.test.ts \
  src/features/booking/availability/BookingAvailabilitySettings.test.tsx
Test Files  4 passed (4)
     Tests  35 passed (35)
```

Self-review attestation: this lane did not add a flag, enable a default, add a
Settings rail/section, use dynamic duplicate registration, touch a Meetings or
daily Calendar surface, expose event detail, or introduce provider writes,
holds, bookings, or confirmations.
