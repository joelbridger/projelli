# E2E flaky-test quarantine — tracked & owned

**Why this file exists.** `playwright.config.ts` has a `CI_QUARANTINE` list of E2E
specs excluded from the CI gate (`E2E_CI_QUARANTINE=1`) because they fail on
CI-environment quirks (state/onboarding/timing/visual), not real bugs. Excluding
them keeps the CI gate a trustworthy green — but a quarantine with no owner and no
deadline rots into a graveyard where real regressions hide. This file gives every
quarantined spec an **owner** and a **fix-or-delete-by date** so the list stays
small and honest.

**The rule (recommendation #6).** A spec doesn't get to sit in quarantine forever.
By its fix-or-delete-by date it must be either (a) **fixed** and removed from
`CI_QUARANTINE`, (b) **deleted** if it no longer earns its keep, or (c)
**consciously re-dated here with a one-line reason**. It must never silently stay
quarantined past its date. Quarantining a NEW spec means adding a row here in the
same change.

> Quarantined specs **still run locally** (`npx playwright test`) — they are only
> skipped in the `E2E_CI_QUARANTINE=1` CI gate. Source of truth for the list is
> the `CI_QUARANTINE` array in `playwright.config.ts`; this file tracks ownership.

## Quarantined specs

Owner `unassigned` = the parallel QA engine picks it up; the lead may assign a
specific agent/session. Suspected cause is a hypothesis from the spec name + the
config comment (state / onboarding / timing / visual), not a confirmed diagnosis.

| Spec | Suspected cause | Owner | Fix-or-delete by |
|---|---|---|---|
| `workflows-panel.spec.ts` | workflow-panel state/timing on cold CI start | unassigned | 2026-07-31 |
| `web-demo.spec.ts` | demo-route load + route-mock timing | unassigned | 2026-07-31 |
| `onboarding-card.spec.ts` | onboarding state seeded inconsistently on CI | unassigned | 2026-07-31 |
| `file-tree.spec.ts` | file-tree render/expand timing | unassigned | 2026-07-31 |
| `citation-persistence.spec.ts` | citation state across reload (persisted-state timing) | unassigned | 2026-07-31 |
| `app-layout.spec.ts` | layout/visual sensitivity to CI rendering | unassigned | 2026-07-31 |
| `v1.5-integration-flows.spec.ts` | broad multi-step flow; cold-start timing | unassigned | 2026-07-31 |
| `v1.5-accessibility-full.spec.ts` | full a11y sweep; slow/timing-sensitive | unassigned | 2026-07-31 |
| `templates-marketplace.spec.ts` | templates list state/timing | unassigned | 2026-07-31 |
| `status-bar.spec.ts` | status-bar state/visual | unassigned | 2026-07-31 |
| `sidebar-a11y.spec.ts` | sidebar a11y tree timing | unassigned | 2026-07-31 |
| `search-content.spec.ts` | search depends on the index (browser index is desktop-only) | unassigned | 2026-07-31 |

## How to work the list

1. Reproduce locally with retries off to see the real failure:
   `npx playwright test tests/e2e/<spec> --retries=0`
2. If it's a real CI-only flake, fix the root (seed the state deterministically,
   wait on a stable `data-testid`, not a timeout) and remove it from
   `CI_QUARANTINE`.
3. If the spec no longer pulls its weight (superseded by a lower-layer test, or
   testing a removed surface), delete it.
4. If it genuinely can't be fixed yet, re-date its row here with a one-line reason.
