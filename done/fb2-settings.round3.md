# FB2 Settings Round 3

Done.

## What changed

- `lantern:open-settings` now opens the in-app Settings page when the app shell is available.
- Account-style settings categories still open the Account window.
- The Settings modal remains the fallback when the app shell is unavailable.
- The disabled-memory email link now sends one AI settings destination request instead of also calling the modal callback.

## Checks

- `npm run test -- tests/unit/app/useGlobalEventBus.test.tsx tests/unit/mail/ReimaginedEmailWorkspace.test.tsx`
- `npm run typecheck`
- `git diff --check`
