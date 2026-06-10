# VG-1 Wedge-Proof Harness — Scouting Notes (pre-plan)

**Date:** 2026-06-10 · read-only scout of keepance-3.0 ahead of the VG-1 implementation plan (gap-closure plan workstream 1). Plan gets written when Option B (model download) lands.

## What exists (verified paths)

- **Fixtures are already built:** `tests/fixtures/matter-corpus/` — Johnson v. Nexus Dynamics matter with `deposition-transcript-johnson.txt` carrying **3 planted contradictions documented in its README** (docs-forwarded-to-personal-email vs none-left-company; compliance deadline Oct 17 vs Oct 10; severance 4 weeks vs 8 weeks) against `incident-summary-johnson.md`; plus tracked-changes .docx, damages-model.xlsx (formulas), exhibit-deck.pptx, a scanned PDF, a unicode filename, a ~2MB file. Matter B (Acme) is the isolation corpus, deliberately disjoint. Generators: `generators/generate-fixtures.py`, `seed-imap.mjs` (greenmail, plaintext-only).
- **Playwright infra:** `playwright.config.ts` targets the Vite dev build (5173), strict data-testid discipline, en/es/de matrix; helpers in `tests/e2e/helpers/test-utils.ts` (`waitForTestModeLoad` with `?testMode=true` seeding) and `tests/campaign/helpers/campaign.ts` (`snap`, console-error collection).
- **Citation UI hooks already exist:** `ai-chat-viewer`, `chat-sources-accordion`, `chat-citation-{basename}-{paragraphIndex}`, `chat-message-{idx}-scope`, `ask-workspace-toggle`, `include-privileged-toggle`; `matters-panel`; `workflow-run-{runId}`.
- **Rust truth layer to extend, not duplicate:** `src-tauri/tests/rag_matter_scope.rs` already proves cited retrieval, matter isolation (prefilter, adversarial confusables), verification verdicts, and privilege exclusion over a two-matter corpus with the real e5-small embedder (cached locally; offline after first run).
- **xlsx/pptx:** unit round-trips exist (`spreadsheet-io.test.ts`, `pptx-export.test.ts`); the full open→edit→save→reopen cycle over the campaign's `damages-model.xlsx` is NOT yet asserted anywhere — the harness picks it up.
- **Native-pass method + limits (from the campaign):** Tauri debug binary under Xvfb :99, frontend from Vite 5173, systemd-run memory cap. Known traps: GTK file-chooser is keyboard-isolated headless (avoid by seeding the workspace dir directly, never the picker); no Secret Service keychain (mail/audit live paths blocked headless); the old model-download stall (F-415) is what Option B fixes, and the rig HAS a populated cache at `~/.local/share/keepance/models/e5-small` to pre-seed test profiles from.

## Harness shape (decided direction for the plan)

Three legs, cheapest-first:
1. **Rust truth leg:** new `src-tauri/tests/rag_deposition_contradictions.rs` extending the matter-scope patterns — index the Johnson fixtures, run the contradiction-finder's analyze path directly, assert the 3 planted contradictions surface with verifiable citations and Acme isolation holds. Offline, deterministic, CI-able.
2. **UI wiring leg:** `tests/e2e/wedge-proof.spec.ts` against the browser dev build using existing helpers + testMode seeding — citation accordion renders, citation click-through opens the right passage, scope chip + privilege toggle behavior, workflow run view produces the .docx output surface, xlsx/pptx round-trip over the campaign fixtures.
3. **Real-machine leg (the audit's actual bar):** scripted Xvfb run of the real Tauri binary with the model cache PRE-SEEDED from the rig's existing copy (no network), driving one full positive pass: open fixture workspace → index completes → ask → cited answer → verify → click-through → contradiction finder completes (F-117/F-422 closure). The remaining genuinely-Windows-only items stay on Jameson's 5-minute spot check.

Caveat the plan must respect: leg 2's browser mode has no Rust rag — retrieval there is testMode/mocked, so leg 2 asserts UI GLUE only; never claim it proves retrieval. Leg 1 + leg 3 carry the truth claims.
