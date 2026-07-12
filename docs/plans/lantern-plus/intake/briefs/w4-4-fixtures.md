# Wave 4 Lane 4 — Synthetic fixtures + spot-check gates

**Branch:** `lp/intake-w4-fixtures` (checked out for you off the merged Lane 3 tip). **You are Codex.** Build, run the checks, commit. Do NOT push. Do NOT run notify-jameson.

## Goal
Give Wave 4 a repeatable SYNTHETIC document fixture set + golden labels that exercise Tier 1 warnings (Lane 1), advisor-side classification (Lane 2), and income/spending extraction proposals (Lane 3). Synthetic only — NO real client data, tax scans, or license photos.

## What exists to test (all merged on this branch)
- Lane 1: `src/platform/intake/documentDetectiveRules.ts` (`classifyTier1`, `classifyObservedKind`).
- Lane 2: `src/platform/intake/documentReader.ts` (`readIntakeDocument`), `documentClassifier.ts`, `documentSourceRef.ts`.
- Lane 3: `src/platform/intake/documentExtractionEngine.ts` (`extractDocumentFacts`), `documentExtractionProposalStore.ts`, `documentExtractionAccept.ts`.

## Files to create
- `tests/fixtures/intake-document-detective/manifest.json` — the golden inventory (below).
- `tests/fixtures/intake-document-detective/generate-fixtures.mjs` — regenerates the files deterministically (no network, no randomness that breaks reproducibility).
- `tests/fixtures/intake-document-detective/files/…` — the generated synthetic documents.
- `tests/unit/intake/documentFixtures.test.ts` — drives the fixtures through the real modules and asserts the golden labels.

## Fixture set (minimum — synthetic text/PDF)
| Fixture | Purpose | Golden labels |
|---|---|---|
| license-front | Tier1 front license | `drivers_license`, side `front` |
| license-back | Tier1 back license (AAMVA/pdf417 text) | `drivers_license`, side `back` |
| license-front-duplicate-a / -b | duplicate-side catch | both `front` |
| tax-return-1040-summary | wrong-doc on license + income extraction | `tax_return`, income `91400`, page 1 |
| pay-stub-ytd | income extraction | `pay_stub`, income proposal w/ source quote |
| bank-statement-checking | spending extraction | `bank_statement`, monthly spending proposal (printed total) |
| credit-card-statement | spending extraction | `credit_card_statement`, monthly spending proposal (printed total) |
| brokerage-statement-taxable | statement class | `brokerage_statement`, NO income fact unless explicit income printed |
| ira-statement | class precedence | `ira_statement` |
| medical-bill | wrong-doc fallback | `unknown`/`other_financial`, no income/spending |
| blank-scan | OCR fallback | scanned / low-confidence path |
| password-protected | unreadable path | encrypted/unreadable, no fact |

`manifest.json` records per fixture: file path, document kind, license side (if any), pages, expected source snippets, expected extracted facts, and whether Tier1 should warn for each target item.

## Tests (`documentFixtures.test.ts`)
- Each fixture's text → `classifyObservedKind` / `classifyTier1` matches the manifest kind/side and Tier1 warn expectation (e.g. tax-return in a license item warns `wrong_doc`; duplicate fronts warn `duplicate_license_side`).
- For income/spending fixtures, drive `extractDocumentFacts` with a MOCK provider that returns the manifest's expected model output; assert the engine keeps only manifest-approved facts, drops others, ties the amount to the cited quote, and rejects restricted values. (Do NOT call a real AI provider — the engine takes an injectable provider; use a deterministic mock returning the golden values + one adversarial fabricated/restricted value that must be dropped.)
- brokerage/ira/medical produce NO income/spending fact.
- password-protected → unreadable, no fact. blank-scan → scanned/low-confidence path (mock OCR available/unavailable as needed).

## Also extend the client-page suite (Lane 1 surface)
- `intake-page/tests/intake-page.spec.ts`: add a wrong-document + wrong-side check using a synthetic tax-return / back-side text fixture if not already covered by Lane 1's tests (avoid duplicating; only add gaps).

## Non-negotiables
Synthetic data only. No network in fixtures/tests. No real AI provider call (inject a mock). Deterministic (no `Date.now()`/`Math.random()` that breaks reproducibility — seed or hardcode). Light theme/tokens/no em dashes where any copy appears.

## Verify (report exact pass/fail)
```
npx vitest run tests/unit/intake/documentFixtures.test.ts src/platform/intake
cd intake-page && npm run test ; cd ..
npx tsc --noEmit
node scripts/eslint-gate.mjs          # MUST show zero new findings vs baseline
npm run test:contracts
```

## Finish
Commit on `lp/intake-w4-fixtures` with a message containing `W4-LANE4-FIXTURES-GOLDEN`. Do NOT push. Report exact check results (incl. the eslint-gate output) and confirm the tree is clean.
