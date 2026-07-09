# Foundation lane — fix round 1 COMPLETE

Branch: `lp/ux-found` (pushed).
HEAD: `9ccb5ce5fa0729e56708575995684e03e9f723cb`

All six review items fixed in ONE combined round, TDD per item. Full write-up in
`found.done.md` under "## Fix round 1".

## Items
1. BLOCKER mode-switch display race — fixed (mode-tagged hook, null "checking" until tags match).
2. BLOCKER assured routes ignored — fixed (resolver returns real destination + assuredAvailable; assured wins over BYOK; passed through EgressIndicator).
3. MAJOR local-only strict probe — fixed (same probe as the send; LOCAL_PENDING "Local AI setting up", never a false "Using local AI").
4. MAJOR duplicate composer testids — fixed (testId override: `egress-indicator-composer` / `egress-indicator-chat`; migrated `local-ai-privacy-race.test.tsx`).
5. MAJOR top-bar pill click path — fixed (status pill is a keyboard-reachable button opening AI settings, aria-label + hover).
6. B-PRIV-1 DOM coverage restored — `egress-topbar-mode-switch.test.tsx` (per-mode agreement + one-frame guarantee); single-source matrix gained assured + pending columns.

## Checks (real output)

```
$ npm run typecheck
> tsc --noEmit
(clean — no output)

$ node scripts/eslint-gate.mjs
✅ No ESLint regression vs baseline. (18 fingerprint(s) cleaned up vs baseline)

$ node scripts/ui-system/handle-guard.mjs
✅ Handle guard passed — no permanent handle vanished, and no new ambiguous (duplicate) handles (33 frozen).

$ npx vitest run src/ui/kp/ tests/unit/privacy/ tests/unit/ask/ tests/unit/chat/ \
    tests/unit/matter/ tests/unit/workflows/ tests/unit/i18n/en-json-snapshot.test.ts \
    tests/unit/newNav-settings-gear.test.tsx tests/unit/reimagined-ask.test.tsx \
    tests/unit/local-ai-privacy-race.test.tsx
 Test Files  101 passed (101)
      Tests  834 passed (834)
```

Did NOT run full gate / cargo / Playwright / desktop (coordinator's job). Two
things to confirm on the e2e/desktop runs: `bench-mirror-cross-cutting.spec.ts`
(now unambiguous — the composer id was split out) and `19-global-shell.mjs`
(gripped `egress-indicator` from round 0).
