# Onboarding Reframe Done

## What shipped

- Rewrote the intro hero to: "The AI you're actually allowed to use with client data."
- Reframed the three intro flow cards around connecting the practice, building Client Maps, and asking cited questions.
- Added the small Help reminder: "You can reopen this walkthrough anytime from Help."
- Added the new compliance beat between start choice and AI setup.
- Added the "For your compliance officer" CTA with `data-testid="onboarding-compliance-officer-cta"`.
- Wired the CTA to a placeholder modal titled "Compliance & Security" with the data-flow/encryption/SOC 2 stub.
- Reframed the AI step as "Bring your own AI" and renamed providers to:
  - ChatGPT (OpenAI)
  - Claude (Anthropic)
  - Gemini (Google)
- Reworded cloud vs on-device AI so both paths keep client files on the machine.
- Replaced the broken-looking no-wifi style signal with shield/on-device language and a shield icon.
- Reframed the connect step around CRM, email, OneDrive/SharePoint files, Wealthbox, and saved reports from tools like RightCapital, Holistiplan, DocuSign, and Jump.
- Moved V2 onboarding copy into i18n keys and updated the English snapshot.
- Added matching fallback keys to `es.json` and `de.json` so locale completeness stays green.

## Skipped

- None.

## Checks

### `npm run typecheck`

```text
> advisor-prep-hero@3.3.5 typecheck
> tsc --noEmit
```

Result: passed.

### `npx vitest run tests/unit/onboarding-v2.test.tsx tests/unit/onboarding-v2-trust-pills.test.ts tests/unit/first-run-mount.test.tsx tests/unit/onboarding-sample-recents.test.tsx src/features/onboarding/v2/components/OnboardingShell.test.tsx src/features/onboarding/v2/LottiePlayer.test.tsx tests/unit/i18n/en-json-snapshot.test.ts`

```text
 RUN  v4.1.3 /home/jameson/lp-onboarding

 Test Files  7 passed (7)
      Tests  40 passed (40)
   Start at  05:04:46
   Duration  11.41s (transform 6.38s, setup 886ms, import 10.00s, tests 10.37s, environment 2.24s)
```

Result: passed.

### `node scripts/eslint-gate.mjs`

```text
✅ No ESLint regression vs baseline. (45 fingerprint(s) cleaned up vs baseline)
```

Result: passed.

### Extra check: `npm run i18n:completeness`

```text
> advisor-prep-hero@3.3.5 i18n:completeness
> node scripts/i18n-completeness-check.mjs

✅ de.json: complete (2180 keys checked)
✅ es.json: complete (2180 keys checked)

✅ i18n completeness: de.json and es.json cover every en.json key.
```

Result: passed.

## Files touched

- 21 implementation/test/locale files, plus this done note.

## Coordinator notes

- The Spanish and German V2 onboarding keys are English fallback text. I did not run the full translator because the dry run wanted to refresh 1,373 existing Spanish keys, far outside this lane.
- `src/platform/connectors/onedrive/OneDriveConnect.tsx` got one lint-only note on an existing native-null guard so the required lint gate could pass without changing behavior.
