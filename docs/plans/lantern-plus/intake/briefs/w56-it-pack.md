TASK: Lantern Intake Wave 6 Lane W6c — IT-gatekeeper pack integration for Intake.

You are Codex (gpt-5.6), building in an isolated git worktree on branch `lp/w56-it-pack` off `lp/intake-w56`. Mostly docs + a small in-app wiring. Low risk, but claims discipline is strict.

## Read first
- `docs/trust/it-pack/INTAKE-IT-PACK.md` — the DRAFTED Intake IT pack (already written). Your job is to finalize + integrate it, not rewrite it.
- `docs/plans/lantern-plus/intake/ARCHITECTURE.md` §3 (honest metadata list — the "can see / cannot see" boundary is the heart of the pack), §8 (threat model), §2, §5.
- `docs/plans/lantern-plus/intake/RISKS.md` (§2 claims discipline — no "zero knowledge", no SOC2 unless audited; §5 email-fallback labeling).
- The EXISTING trust-pack effort this folds into:
  - `docs/trust/security-overview.md`, `docs/trust/soc2-readiness.md` (the standing trust docs).
  - `src/features/privacy/FirmSecurityPack.tsx`, `src/features/privacy/PrivacyCenterHome.tsx`, `src/features/privacy/privacyCenterOverviewExport.ts` (the in-app "firm security pack" surface advisors show their IT reviewers).

## Goal (plain)
An advisory firm's outside IT / security / compliance reviewer needs a clear, honest pack about Lantern Intake before they approve it. The pack is drafted; this lane (1) verifies every claim traces to the architecture/risks docs and fixes any drift, (2) folds the Intake section into the standing firm security pack (both the `docs/trust/` index and the in-app `FirmSecurityPack` surface), and (3) makes it reachable/exportable for a firm to hand to their reviewer. Honesty is the product: never overclaim.

## Deliverables
1. **Claim audit + finalize** `docs/trust/it-pack/INTAKE-IT-PACK.md`: verify each hidden-comment source cite (`<!-- Source: ARCHITECTURE.md §X -->`) is accurate against the current ARCHITECTURE/RISKS; correct any claim that drifted (esp. the §2 metadata "can see / cannot see" list must match ARCHITECTURE §3 exactly — that is the reviewer's data boundary). Confirm the "not zero-knowledge", "not SOC2-certified", "firm remains the regulated entity" honesty statements are present and correct.
2. **Integrate into the standing pack**: add an Intake section/link to `docs/trust/` (index it alongside security-overview + soc2-readiness) and to the in-app `FirmSecurityPack.tsx` — an "Intake / secure client links" entry that surfaces the one-page architecture summary + the honest metadata list, and lets the advisor export/share the pack (reuse `privacyCenterOverviewExport.ts` export machinery — do NOT build a new exporter). Keep copy client/household-facing, light theme, tokens, no em dashes.
3. **Reviewer checklist** (the pack's §6) surfaced where a firm can act on it. No new backend, no new relay surface.

## TDD / verification
- If you touch `FirmSecurityPack.tsx` or the export, add/extend a vitest that asserts the Intake pack section renders and the export includes the Intake honest-metadata boundary (so a future edit can't silently drop the "cannot see SSN/name/files" claims).
- A doc-lint style check: no forbidden overclaim strings ("zero knowledge", "SOC 2 certified", "military-grade", "unhackable") appear in the Intake pack (a simple grep-based test or CI check is fine).

## Non-negotiables (claims discipline)
- Every capability claim must be backed by ARCHITECTURE/RISKS. If the code doesn't do it, the pack doesn't claim it. If you find a claim the architecture does NOT support, FIX the claim (weaken to honest), and note it in your final report — do not quietly leave an overclaim.
- Email fallback is labeled a separate, non-E2EE channel everywhere (RISKS §5).
- No SOC2 / certification claims. "Not zero-knowledge" (metadata is disclosed, not hidden). Light theme, tokens, no em dashes.

## Out of scope
- Any crypto/relay/UI feature work (other lanes). This lane does not change intake behavior — it documents and surfaces it honestly. No changes under `src/platform/intake/`, `backend/`, `intake-page/` beyond a link if needed.

## Verify
`npx vitest run src/features/privacy` (if touched), `npx tsc --noEmit`, `npm run lint:gate`, and your overclaim grep-check. Report results. When done + committed, print `W56-ITPACK-INTEGRATED-DONE` then `DONE-EXIT:0`.
