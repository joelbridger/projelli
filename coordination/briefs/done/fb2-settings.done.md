# FB2 Settings Lane Done

Branch: `lp/fb2-settings`
Commit: `37dd98e2 fix(settings): apply feedback batch 2 polish`
Pushed: yes, `origin/lp/fb2-settings`

## What shipped

- Settings page polish for the assigned feedback lines:
  - Hid retired settings rows (`Startup`, tab overflow, AI rules) while keeping search from surfacing them.
  - Made autosave delay read as seconds and added plain helper text for file/template and hidden-file settings.
  - Made voice shortcut rows show their hotkeys instead of blank controls.
  - Reworked the AI privacy cards so local AI download state and cloud API-key/model state live inside the cards.
  - Hid Marketplace/Extensions behind `VITE_SETTINGS_MARKETPLACE_LIVE=1`; per-workflow model settings remain reachable in Advanced.
  - Put Setup before Shortcuts in Help.
- Top trust bar:
  - Removed the separate data-flow info icon.
  - Put the data-flow detail into the egress pill tooltip.
  - Clicking the pill now opens the full Settings page directly on AI settings.
- Privacy Center:
  - Replaced the in-app security-pack overlay with Word and PDF export actions.
  - Added a visible empty state for product email opt-in.
- Left rail:
  - Let the client list fill available vertical space instead of stopping at a small fixed height.

## Notes

- Scout findings file was not present: `/home/jameson/lantern-plus/coordination/briefs/fb2-scout-findings.md`.
- Required foundation fetch was attempted before and after implementation. The remote branch was not available:

```text
$ git fetch origin 'refs/heads/lp/fb2-railchrome:refs/remotes/origin/lp/fb2-railchrome'
fatal: couldn't find remote ref refs/heads/lp/fb2-railchrome
```

## Checks

### Typecheck

```text
$ npm run typecheck

> lantern@3.3.5 typecheck
> tsc --noEmit
```

Result: passed.

### Scoped Vitest

```text
$ npx vitest run tests/unit/components/settings/SettingsContent.test.tsx tests/unit/components/settings/SettingsSections.test.tsx tests/unit/components/settings/SettingsModalMarketplaceBadge.test.tsx tests/unit/privacy/PrivacyCenterHome.test.tsx tests/unit/privacy/firm-security-pack.test.tsx tests/unit/privacy/assured-mode.test.tsx tests/unit/privacy/confidentiality-card-help-a11y.test.tsx tests/unit/spine-clients-section.test.tsx tests/unit/local-ai-settings-control.test.tsx tests/unit/i18n/en-json-snapshot.test.ts

 RUN  v4.1.3 /home/jameson/lp-fb2-settings


 Test Files  10 passed (10)
      Tests  157 passed (157)
   Start at  21:40:04
   Duration  4.44s (transform 4.79s, setup 2.04s, import 12.72s, tests 5.61s, environment 6.88s)
```

### Architecture Boundary Spot Check

```text
$ npx vitest run tests/unit/architecture-boundaries.test.ts

 RUN  v4.1.3 /home/jameson/lp-fb2-settings


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  21:43:58
   Duration  755ms (transform 78ms, setup 129ms, import 244ms, tests 3ms, environment 280ms)
```

### i18n Completeness

```text
$ npm run i18n:completeness

> lantern@3.3.5 i18n:completeness
> node scripts/i18n-completeness-check.mjs

✅ de.json: complete (1968 keys checked)
✅ es.json: complete (1968 keys checked)

✅ i18n completeness: de.json and es.json cover every en.json key.
```

### ESLint Gate

```text
$ node scripts/eslint-gate.mjs
✅ No ESLint regression vs baseline. (43 fingerprint(s) cleaned up vs baseline)
```

### Pre-push Hook

The first push attempt found one real architecture-boundary issue, which was fixed, and also revealed generated OCR assets were missing because the hook runs `npx vitest run` directly. I ran `npm run copy-build-assets`, then retried the push.

```text
$ git push origin lp/fb2-settings
pre-push: fast gate (typecheck + unit tests)…

> lantern@3.3.5 typecheck
> tsc --noEmit


 RUN  v4.1.3 /home/jameson/lp-fb2-settings

 Test Files  739 passed | 1 skipped (740)
      Tests  7063 passed | 6 skipped (7069)
   Start at  21:45:28
   Duration  118.69s (transform 67.57s, setup 223.93s, import 735.38s, tests 346.97s, environment 698.70s)

✅ fast gate passed
To https://github.com/lanternplatform/lantern.git
 * [new branch]        lp/fb2-settings -> lp/fb2-settings
```

## Correction round

Branch: `lp/fb2-settings`
Commit: `2d723af9 fix(settings): restore startup and AI rules rows`
Pushed: yes, `origin/lp/fb2-settings`

### What changed

- Restored the Startup setting row. It now reads `On startup`, with the dropdown value `Reopen where you left off`.
- Restored the `Manage AI rules` row in AI settings.
- When no workspace is open, `Manage AI rules` stays visible but is disabled with `Open a workspace first`.
- Added the visible description: `Opens ai-rules.md — standing instructions the AI follows in every chat.`
- Settings search now checks dropdown option labels too, so `Reopen where you left off` finds the startup row.

### EV_OPEN_SETTINGS audit

Current receiver: `useGlobalEventBus` still routes `EV_OPEN_SETTINGS` through `openSettings`, which opens the Settings modal for non-account categories. Account-style categories are redirected to the Account window.

- `src/features/ask/Ask.tsx:551` — indexing notice `Enable` button dispatches `category: 'ai'`; opens the Settings modal on AI.
- `src/features/ask/Ask.tsx:614` — streaming/local-AI status action dispatches `category: 'ai'`; opens the Settings modal on AI.
- `src/features/matters/MattersHome.tsx:187` helper:
  - Called at `src/features/matters/MattersHome.tsx:262` with `category: 'ai'`; opens the Settings modal on AI.
  - Called at `src/features/matters/MattersHome.tsx:292` with `category: 'integrations'`; redirects to the Account window.
- `src/features/email/EmailWorkspace.tsx:1084` — memory-disabled `Enable in settings` link dispatches `category: 'ai'`; opens the Settings modal on AI. The same click also calls its `onOpenSettings` prop, which opens the Account window on Connections.
- Egress pill is not an `EV_OPEN_SETTINGS` dispatcher now: `src/App.tsx:1897` calls `openSettingsPage('ai')`, so it opens the full in-app Settings page on AI.

Report-only conclusion: the remaining in-shell `EV_OPEN_SETTINGS` dispatchers still open the Settings modal for `ai`. That does not match the ruling that the modal should be reserved for places where the app shell is unavailable.

### Checks

```text
$ npm run test -- tests/unit/components/settings/SettingsContent.test.tsx

Test Files  1 passed (1)
Tests  25 passed (25)
```

```text
$ npm run typecheck

> lantern@3.3.5 typecheck
> tsc --noEmit
```

```text
$ git diff --check

(no output)
```

```text
$ node scripts/eslint-gate.mjs

✅ No ESLint regression vs baseline. (43 fingerprint(s) cleaned up vs baseline)
```

```text
$ git push origin lp/fb2-settings

Test Files  739 passed | 1 skipped (740)
Tests  7065 passed | 6 skipped (7071)
✅ fast gate passed
To https://github.com/lanternplatform/lantern.git
   37dd98e2..2d723af9  lp/fb2-settings -> lp/fb2-settings
```
