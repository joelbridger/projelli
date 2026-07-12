TASK: Lantern Intake Wave 6 Lane W6d — client-page accessibility audit + fixes.

You are Codex (gpt-5.6), building in an isolated git worktree on branch `lp/w56-a11y-audit` off `lp/intake-w56` (dispatched AFTER W5b welcome-journey merges, so the audit covers the finished welcome/what-happens-next page). Scope = `intake-page/` only. TDD via axe + Playwright.

## Read first
- `docs/plans/lantern-plus/intake/PRODUCT-DESIGN.md` §6 (client flow — "a 68-year-old on an iPhone finishes the core items in one sitting"; big touch targets; one item per screen), §10 (edge cases).
- `docs/plans/lantern-plus/intake/ARCHITECTURE.md` §4 (page is self-contained: NO third-party origins/CDN/analytics — an a11y fix must NOT pull in an external a11y lib at runtime; axe is a TEST-time dev dependency only, never shipped in the bundle), §8 T3 (page integrity — don't break the signed-bundle rule).
- `docs/plans/lantern-plus/intake/WAVE-PLAN.md` Wave 6 goal (accessibility audit of the client page — older clients are the point). Note Wave 1 already added an axe pass; this lane deepens it to a full WCAG-basics audit.
- Existing: `intake-page/src/App.tsx` (screens: welcome, one-item-per-screen typed/upload/guided, completion, fallback, error, loading), `intake-page/src/styles.css`, `intake-page/tests/` (existing Playwright + any axe pass), `intake-page/playwright.config.ts`.

## Goal (plain)
Make the client intake page genuinely usable by older, less technical clients on a phone with assistive tech. Run a real WCAG-basics audit (axe) across every screen and state, fix what it finds, and lock it with tests so future changes can't regress accessibility.

## Deliverables
1. **Axe audit across all screens/states** — welcome, each item type (typed field incl. masked SSN, doc upload/camera, guided question with number/range/"I don't know"), completion/what-happens-next, resume, fallback (old browser), error, loading. Add axe assertions (using `@axe-core/playwright` as a dev/test dependency) that fail on serious/critical violations per screen.
2. **Fixes** for what the audit finds. Expect: form labels/`aria-label` on every input, correct heading order, focus management on screen transitions (focus moves to the new item heading; focus never lost), visible focus indicators, sufficient color contrast (check against the firm-accent theming — accent-on-white must meet contrast, or the text color adapts), touch-target size (≥44px), progress indicator announced to screen readers (`aria-live`/`role`), error messages associated with inputs (`aria-describedby`), the "I don't know"/Skip buttons reachable and labeled. No keyboard traps.
3. **Reduced-motion + zoom**: respect `prefers-reduced-motion`; layout survives 200% zoom without horizontal scroll on a phone width.
4. Keep the page self-contained: axe is test-time only; no runtime third-party code; CSP + signed-bundle rules intact. Light theme, tokens, no em dashes.

## TDD — the audit IS the test
`intake-page/tests/a11y.spec.ts` (new or extend): drive each screen/state and assert `axe` finds no serious/critical violations; assert focus lands on the new item heading after Next; assert progress is announced; assert masked SSN input has an accessible name and its confirmation is announced. Keep existing Playwright green.

## Non-negotiables
- Page integrity: no third-party origins/CDN/analytics in the shipped bundle; axe is dev/test only. Don't change the crypto/relay behavior — this is presentation + semantics only.
- Don't regress the privacy-proof / hosting-integrity tests. Light theme, tokens, no em dashes, client/household language.
- If a contrast fix touches firm-accent theming, keep it honest (the accent still shows; text/border colors adapt for contrast) — don't hardcode away firm branding.

## Out of scope
- Advisor-side surfaces (that's W6a/W5a), backend, crypto, welcome-journey COPY (W5b owns the copy; you fix its accessibility if the audit flags it, without rewording). No new features — accessibility + semantics only.

## Verify
`cd intake-page && npm run build && npx playwright test` (esp. your a11y spec). Report exact pass/fail + the axe violation categories you fixed. When done + committed, print `W56-A11Y-AUDITED-DONE` then `DONE-EXIT:0`.
