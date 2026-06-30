# WS3 — Hallucination Hardening: Implementation Plan

> Parent: `docs/strategy/2026-06-17-keepance-master-plan.md` (WS3). Niche: litigation. In-app `src/` work (rides the next desktop release). Execute subagent-driven; gates per task: `npm run typecheck` (0) + `npx vitest run` (green). Commit per task (do NOT push).

**Goal:** For a litigator, a confidently-wrong UNCITED answer is a sanction risk. Make cited-vs-uncited unmistakable and verification frictionless: (a) one-click citation open on the Ask surface, (b) a visually distinct "uncited / unverified" treatment, (c) a "verify against source" affordance.

**Key fact from recon:** a lot already exists. Citation chips, three verified-states, the `verified?: boolean` on sources, `ragVerifyCitation`, the `citation_verified` audit event, and a Chat-surface unverified-warning banner are all present. WS3 is gap-closing + making the distinction unmistakable, not building from scratch.

## Global Constraints
- Honesty: the treatment must make an uncited answer look clearly LESS trustworthy (that's the point). Verdicts shown truthfully — only `{verdict:'verified'}` is reassuring; `notFound` (fabricated/stale), `textMismatch` (hallucinated quote), `matterMismatch` (cross-matter leak) must read as problems, not be hidden.
- No em dashes in user-facing copy. Reuse `ui/kp/` `Callout` (variants info|warning|error) and `Badge` (warning|danger). Don't duplicate existing citation logic.
- Two surfaces: **Ask** (`AnswerCitation`, `{n}` markers) and **Chat** (`WorkspaceSource`, `[file paragraph N]` markers). Keep both consistent.

---

### Task 1: Thread `id` + `matterId` into `AnswerCitation` (Ask surface)
**Files:** `src/features/ask/askHelpers.ts` (the `AnswerCitation` interface, ~lines 30-43 — add `id?: string; matterId?: string`), `src/features/ask/useAsk.ts` (where citations are built from `RagHit`, ~lines 446-453 — forward `hit.id` + `hit.matterId`), test in `tests/unit/reimagined-ask.test.tsx` or a new ask-citation test.
- [ ] Add the two optional fields; populate them from the resolved `RagHit`. TDD: assert a built `AnswerCitation` carries `id`/`matterId` when the hit has them. Green. Commit.
- **Produces:** `AnswerCitation.id`/`.matterId` — needed by Task 2 (single-click open) + Task 4 (verify).

### Task 2: Frictionless citation-click on the Ask surface
**Files:** `src/features/ask/CitationText.tsx`, `src/features/ask/TurnBlock.tsx`, `src/features/ask/Ask.tsx` + `useAsk.ts` (thread an `onOpenCitation` prop), test `tests/unit/citation-navigation.test.tsx` (extend).
- [ ] Today an Ask chip click only opens the SourcePanel; opening the file is a 2nd click ("Open in editor"). Make the chip click ALSO open the file at the paragraph: forward `{path, paragraphIndex/locator, excerpt}` to `onOpenFileAtPath` (the same single-click path the Chat surface already uses via the F-504 `scrollToParagraph` infra). Keep the SourcePanel as the excerpt/verify detail view. TDD: chip click fires `onOpenFileAtPath` with the right args. Green. Commit.

### Task 3: Distinct uncited / unverified visual treatment
**Files:** `src/features/ask/TurnBlock.tsx`, `src/features/ask/AIChatViewer.tsx` (+ `renderingHelpers.tsx`), `src/features/ask/CitationText.tsx`, tests.
- [ ] **Ask (TurnBlock):** when `turn.citations.length === 0`, wrap the answer in a `<Callout variant="warning">` with an explicit label like "Not cited from your files. Verify this before relying on it." (replaces the current muted one-liner). When citations exist, keep the green "Answered over your own files" attestation.
- [ ] **Chat (AIChatViewer):** when an assistant message had workspace/ask mode ON but `msg.sources?.length === 0`, show a parallel warning callout (today there's only a banner for `verified === false` sources, nothing for zero-sources). Reuse the existing `matter.citation.*` i18n pattern.
- [ ] **Chip clarity (CitationText):** the "unresolved" (amber) and "not-yet-verified default" (blue) states are too similar. Make three unmistakable states with `data-verified` attr: verified=green(`--kp-success`), unverified/unresolved=danger-or-warning(`--kp-danger`/`--kp-warning`), unknown/pending=neutral. TDD on each branch. Green. Commit.

### Task 4: "Verify against source" affordance
**Files:** `src/features/ask/SourcePanel.tsx` (Ask), optionally `ChatSourcesAccordion` (Chat), using `ragVerifyCitation` from `src/platform/utils/tauri-commands.ts`; emit the `citation_verified` audit event; test.
- [ ] In `SourcePanel`, add a "Verify against source" button: call `ragVerifyCitation(cite.id, cite.matterId, cite.excerpt)` (now available from Task 1) and render the `CitationVerdict` inline — `verified` = green "Quote found in source", `notFound`/`textMismatch`/`matterMismatch` = red with a plain-language problem ("This quote was not found in the cited source — do not rely on it"). Emit a `citation_verified` audit entry with the verdict. Guard: if `id`/`matterId` are missing (older citations), disable the button with a tooltip. TDD with a mocked `ragVerifyCitation` returning each verdict. Green. Commit.

### Task 5: Verify gates + coverage
- [ ] `npm run typecheck` (0) + `npx vitest run` (green, ≥ current count). Confirm `data-verified` attrs + the new callouts have test coverage following `citation-navigation.test.tsx`. Commit any test additions.

## Self-review
- (a) one-click open → Task 2. (b) uncited/unverified treatment → Task 3 (both surfaces + chip clarity). (c) verify-against-source → Task 4. Task 1 unblocks 2+4.
- Honesty enforced: uncited → warning callout; verdicts shown truthfully (only `verified` reassures). Reuses Callout/Badge + ragVerifyCitation + the audit event; no duplication.
- Rides the desktop release with WS2.
