# Booking availability receipt

## Restoration proof

- Restored source snapshot: `5713b4ba8`. The eight availability descendants are byte-clean against that source: `BookingAvailabilitySettings.tsx`, `BookingAvailabilitySettings.test.tsx`, `index.ts`, `settingsModuleDescriptor.tsx`, and `locales/{de,en,es}.json`.
- The feature reaches Calendar only through `@/features/calendar`'s public doorway. The aggregate writer is the one `calendar_settings` record; it reloads the canonical record after saving and migrates legacy split capability/availability records on the next save.
- The Settings mount calls `useFlag('booking-availability')` and returns before Calendar hooks, occurrence reads, busy-block work, or slot work. The flag descriptor is default-off.

## Final verification

- Focused command: `npm test -- src/features/booking/availability/BookingAvailabilitySettings.test.tsx src/features/calendar/testing/roundTripCalendarFoundation.test.tsx src/features/settings/registry/settingsModuleRegistry.test.ts tests/public-imports/calendar-foundation.compile.test.ts tests/unit/architecture-boundaries.test.ts` — PASS (5 files, 35 tests).
- Flag-off lint coverage: `npx eslint src/features/booking/availability/BookingAvailabilitySettings.tsx src/features/booking/availability/BookingAvailabilitySettings.test.tsx src/features/booking/availability/index.ts src/features/booking/availability/settingsModuleDescriptor.tsx` — PASS; this explicitly includes every restored TypeScript/TSX availability source file.
- `npm run typecheck:tests` — PASS. `node scripts/ui-system/handle-guard.mjs` — PASS. `npm run gate` — PASS.
- Rust/native touched: NO.
