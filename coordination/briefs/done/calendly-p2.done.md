## Polish round (timezone)

Changed the Scheduling surface so preview times and booking request times render in the advisor timezone from the profile store, with browser/OS timezone as the fallback. The saved slot data still stays in UTC.

Small polish:
- Availability weekday inputs continue to read and write advisor-local clock times such as `09:00`, and the preview now proves those local hours become the right UTC slot underneath.
- The "Next open slots" card keeps stable heading spacing and no longer stretches when the Upcoming list changes size.

Checks:

```text
npm run test -- src/features/scheduling

Test Files  4 passed (4)
Tests  17 passed (17)
```

```text
npm run typecheck

tsc --noEmit
passed
```

```text
npm run lint:gate

No ESLint regression vs baseline. (45 fingerprint(s) cleaned up vs baseline)
```
