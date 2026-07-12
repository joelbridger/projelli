# Foundation lane — fix round 2 COMPLETE

Branch: `lp/ux-found` (pushed).
HEAD: `791b495370b43d1a64033403af2b31edb5032671`

Coordinator scope ruling + re-review residuals, one combined round, TDD per item.
Full write-up in `found.done.md` under "## Fix round 2".

## Items
1. BLOCKER (conservative resolution) — global badge mirrors Ask/Workflows (BYOK wins over assured); dropped the round-1 global assured-preference, kept the destination enum + assuredAvailable in the shape; documented the ruling in a resolver comment. Ask/Workflows routing NOT rewired (separate lane). Email stays assured-honest via its own resolveEmailProvider.
2. MAJOR sentinel leak — type-level fix: RealEgressProviderId + toRealProviderId; hook returns precise ActiveEgressProviderId | null; MainPanel narrows before redline/inline-edit; resolveRedlineProvider takes ChatProviderId | null. A sentinel is no longer assignable into provider code.
3. MAJOR stale local-pending — new localAiReadiness.ts; egress hook subscribes to the local-model readiness event and re-resolves, so the badge flips without a reload.
4. Residual — resolveEmailProvider local fallback now uses the strict reachability probe, failing fast with an honest message.
5. MINOR — removed the leftover egress-indicator querySelector in the mocked cloud-send test branch.

## Checks (real output)

```
$ npm run typecheck
> tsc --noEmit
(clean — no output)

$ node scripts/eslint-gate.mjs
✅ No ESLint regression vs baseline. (18 fingerprint(s) cleaned up vs baseline)

$ node scripts/ui-system/handle-guard.mjs
✅ Handle guard passed — no permanent handle vanished, and no new ambiguous (duplicate) handles (33 frozen).

$ npx vitest run src/ui/kp/ tests/unit/privacy/ tests/unit/ask/ tests/unit/chat/ tests/unit/email/ \
    tests/unit/mail/ tests/unit/race/ tests/unit/matter/ tests/unit/workflows/ tests/unit/documents/ \
    tests/unit/resolve-redline-provider.test.ts tests/unit/inline-edit-provider.test.ts \
    tests/unit/local-ai-privacy-race.test.tsx tests/unit/draft-follow-up-modal.test.tsx \
    tests/unit/i18n/en-json-snapshot.test.ts tests/unit/newNav-settings-gear.test.tsx \
    tests/unit/reimagined-ask.test.tsx
 Test Files  133 passed (133)
      Tests  1070 passed (1070)
```

Did NOT run full gate / cargo / Playwright / desktop (coordinator's job).
