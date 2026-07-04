# Lantern Plus UI Reachability Audit #2

Date: 2026-07-03  
Repo/branch: `/home/jameson/lantern-plus`, `lantern-plus`  
Mode: read-only investigation; this report is the only file written.

## Executive Summary

I traced the just-merged Wave 4 Tracks B and C UI from the real app shell into the mounted components.

Result: the core wiring is mostly present. The Whole book view is mounted inside the Client Map tab, book rows open client hubs, Whole-practice Ask is mounted in the Ask tab, and result chips use the same client/source-opening event path as the rest of the app.

The main reachability concern is the estate/beneficiary chip workflow. The chips can render, but only when the Client Map contains enough beneficiary evidence. In the realistic state named for this audit, "zero estate docs" does not by itself create a chip. Also, dismissal is reachable from the client's "What I'm missing" panel, not directly from the Book view chip.

## Realistic Advisor State Used

- A few active clients.
- Some clients have built Client Maps.
- No AI file-access consent yet.
- Local-only confidentiality mode.
- Zero estate documents.

## Status Legend

- **REACHABLE**: A normal user path from app launch reaches the control in the named state.
- **CONDITIONALLY-BLOCKED**: The control exists, but a data/provider/state condition hides it, disables it, or makes it empty.
- **UNREACHABLE**: I found no mounted path from the app shell to the planned UI/action.

## Findings Table

| Acceptance item | Actual path from app launch | Status | Evidence / blocking condition |
|---|---|---|---|
| Whole book segment in Client Map tab | App -> `AppShellNav` -> `Spine` Client Map tab -> `AppSurfaceRouter` -> `MattersHome` -> `Client Map view` toggle -> `BookView` | REACHABLE | `src/App.tsx:1425` mounts `AppShellNav`; `src/app/shell/layout/Spine.tsx:72` defines the Client Map tab; `src/app/shell/AppSurfaceRouter.tsx:369` mounts `MattersHome`; `src/features/matters/MattersHome.tsx:744` renders the segmented view toggle; `src/features/matters/MattersHome.tsx:758` switches to book view; `src/features/matters/MattersHome.tsx:775` mounts `BookView`. With zero clients, it shows an empty state at `src/features/matters/book/BookView.tsx:59`; with a few clients, rows render. |
| Book ranking rows open client hubs | Client Map tab -> Whole book -> click a book row | REACHABLE | `BookView` renders rows at `src/features/matters/book/BookView.tsx:73`; row click calls `onOpenClient` at `src/features/matters/book/BookView.tsx:75`; `MattersHome` passes `openHub` at `src/features/matters/MattersHome.tsx:775`; `openHub` sets active client and hub id at `src/features/matters/MattersHome.tsx:634`; the hub mounts when `hubMatterId` is set at `src/features/matters/MattersHome.tsx:703`. Rows include active, non-archived, non-sample clients at `src/features/matters/book/bookRanking.ts:78`. |
| Estate/beneficiary gap chips in Whole book | Client Map tab -> Whole book -> row label area | CONDITIONALLY-BLOCKED | Chips render from `BookRow.topGaps` at `src/features/matters/book/BookView.tsx:81`. `topGaps` comes from unresolved `completeness.ask` gaps at `src/features/matters/book/bookRanking.ts:62`. Beneficiary gaps are merged into Client Maps on store writes at `src/platform/clientMap/clientMapStore.ts:81` and `src/platform/clientMap/clientMapStore.ts:204`. With zero estate documents, a chip appears only if the map still has an account mention needing a beneficiary designation, such as IRA/401(k)/annuity/life insurance: `src/platform/clientMap/estate/beneficiaryConsistency.ts:54`. If there are zero estate docs and no such account mention, no chip appears. |
| Estate/beneficiary dismissal | Open client hub -> Client Map overview -> "What I'm missing" -> `I know this` or `Ask the client`; or start guided interview | CONDITIONALLY-BLOCKED | Dismissal is not a direct action on the Book view chip. The Book chip itself is display-only: `src/features/matters/book/BookView.tsx:84`. Dismissal is reachable after opening the client and using the missing-gaps panel: `src/features/matters/ClientMapPanel.tsx:563` renders gap rows, `src/features/matters/ClientMapPanel.tsx:572` renders `I know this`, and `src/features/matters/ClientMapPanel.tsx:582` renders `Ask the client`. The hub wires those handlers at `src/features/matters/MatterHub.tsx:466` and `src/features/matters/MatterHub.tsx:477`. `markGapResolved` records beneficiary dismissals and emits audit at `src/platform/clientMap/clientMapStore.ts:400`. This is blocked unless the client map is ready and has a beneficiary gap. |
| Whole-practice Ask scope option and scope pill | App -> Ask tab -> scope toggle -> Whole practice -> answer area scope pill | REACHABLE | `src/app/shell/layout/Spine.tsx:74` defines the Ask tab; `src/app/shell/AppSurfaceRouter.tsx:390` mounts `Ask`; `src/features/ask/AskComposer.tsx:195` and `src/features/ask/AskComposer.tsx:233` mount `ScopeToggle`; `ScopeToggle` always includes `whole-practice` at `src/features/ask/ScopeToggle.tsx:40`; `Ask` always renders `ScopeStatusPill` in the answer area at `src/features/ask/Ask.tsx:466`; labels exist at `src/locales/en.json:909`. |
| Whole-practice consent gate | Ask tab -> Whole practice -> cloud provider with no all-clients file-access grant | CONDITIONALLY-BLOCKED | In the named bench state, Local-only mode hides the consent prompt by design because local models do not send files off the machine: `src/features/ask/chat/FileAccessConsentBanner.tsx:62`. If a cloud provider is active, the consent banner is reachable above the composer through `src/features/ask/Ask.tsx:224` and `src/features/ask/AskComposer.tsx:236`, and the `Allow for all` button renders at `src/features/ask/chat/FileAccessConsentBanner.tsx:138`. The actual send also blocks without an all-clients grant at `src/features/ask/book/wholePracticeAsk.ts:52`. So the gate is wired, but the visible prompt is intentionally absent in Local-only mode. |
| Whole-practice Ask submit route | Ask tab -> choose Whole practice -> ask a question | CONDITIONALLY-BLOCKED | `Ask.submitQuestion` routes `whole-practice` away from raw retrieval and into `runWholePracticeAsk` at `src/features/ask/Ask.tsx:144`. `runWholePracticeAsk` builds a digest from Client Maps at `src/features/ask/book/wholePracticeAsk.ts:40`. If no client summaries contain facts, the UI shows the no-facts callout through `src/features/ask/book/BookAnswerPanel.tsx:24`. With a few built Client Maps containing sourced facts and a working local model, this path is reachable in Local-only mode. |
| Client-chip results open hubs | Whole-practice answer -> matching client chip | CONDITIONALLY-BLOCKED | Result chips render only after `BookAnswerPanel` receives matches: `src/features/ask/book/BookAnswerPanel.tsx:34`. Chip click calls `onOpenClient` at `src/features/ask/book/BookAnswerPanel.tsx:36`. `Ask` dispatches a `matter-launch` event with `surface: 'matters'` at `src/features/ask/Ask.tsx:477`. The global event bus sets the active client, opens the Client Map hub, and switches to the Client Map tab at `src/app/lifecycle/useGlobalEventBus.ts:126`. Blocked only if the model returns no verified matches or no summaries exist. |
| Whole-practice cited facts open sources | Whole-practice answer -> cited fact button | CONDITIONALLY-BLOCKED | Cited fact buttons render at `src/features/ask/book/BookAnswerPanel.tsx:40`. If the fact has a `SourceRef`, click calls `onOpenSource`; if not, it falls back to opening the client hub at `src/features/ask/book/BookAnswerPanel.tsx:42`. Facts get their first source from each Client Map item at `src/features/ask/book/bookFacts.ts:32`. `Ask` routes source opens through `dispatchOpenSource` at `src/features/ask/Ask.tsx:483`. Document sources dispatch `matter-launch` and are opened by `useGlobalEventBus` at `src/app/lifecycle/useGlobalEventBus.ts:112`; email and connector sources dispatch their own source events at `src/features/matters/clientMap/openSource.ts:70`. Blocked when matching facts are unsourced. |

## Main Risks

### 1. Book gap chips do not dismiss directly

The plan wording says "Book view gap chips" and "dismissal", but the current UI separates those:

- Whole book shows the chip.
- The client hub's "What I'm missing" panel handles answer/flag dismissal.

That is reachable, but it is indirect. A user who sees a chip in Whole book has no visible dismiss action there.

Recommended text-only patch shape:

```diff
diff --git a/src/features/matters/book/BookView.tsx b/src/features/matters/book/BookView.tsx
@@
-                  <Chip key={g} size="sm" data-testid="book-gap-chip" title={t('matter.beneficiary.review-note')}>
+                  <Chip
+                    key={g}
+                    size="sm"
+                    data-testid="book-gap-chip"
+                    title={t('matter.beneficiary.review-note')}
+                    onClick={(e) => {
+                      e.stopPropagation();
+                      onOpenClient(r.matterId);
+                      // Optional follow-up: pass a one-shot request so the hub opens
+                      // directly to "What I'm missing" instead of the default section.
+                    }}
+                  >
                     {g}
                   </Chip>
```

Better version: add a small store field like `clientMapHubFocus: 'missing' | null`, set it from the chip click, and have `ClientMapPanel` select `MISSING_KEY` on first render. That keeps dismissal where it already exists, but lands the user at the right panel.

### 2. "Zero estate docs" is not enough to guarantee a beneficiary chip

The missing-beneficiary rule needs an account mention that normally requires a beneficiary designation. This is a good conservative rule, but a smoke test with zero estate docs and no IRA/401(k)/annuity/life-insurance mention will not show a chip.

Recommended smoke setup:

```text
Client Map fact source text:
"Robert's rollover IRA is held at Schwab. Beneficiary paperwork is not in the file."

Expected result:
Whole book row shows a chip like:
"A rollover IRA is mentioned but no beneficiary designation is on file."
```

### 3. Whole-practice source buttons depend on sourced Client Map facts

The source-opening path is wired, but only facts with `item.sources[0]` become clickable source facts. A Client Map made from user-entered facts or unsourced assumptions will open the client hub instead of a source.

Recommended smoke setup:

```text
Use a built Client Map with at least one non-assumption item that has a document or email SourceRef.
Ask Whole practice: "Which clients mention 529 plans?"
Click the client chip, then click the cited fact.
Expected: chip opens the client hub; cited fact opens the document/email/source.
```

## Suggested Bench Assertions

- In Client Map, switch `Client Map view` from `Clients` to `Whole book`; confirm `book-view` renders.
- Click a `book-row-*`; confirm the client hub opens on the Client Map overview.
- Seed one Client Map with an IRA/401(k) mention and no beneficiary designation doc; confirm `book-gap-chip` appears.
- Open that client, go to `What I'm missing`, click `Ask the client` on the beneficiary row, then confirm the row disappears and an audit entry is emitted.
- In Ask, choose `Whole practice`; confirm `ask-scope-pill` says `Whole practice (summaries only)`.
- In Local-only mode, confirm no file-access consent banner appears.
- In cloud mode with no all-clients file-access grant, confirm the banner appears and Whole-practice send blocks until `Allow for all`.
- Ask a Whole-practice question against built, sourced Client Maps; confirm client chips open hubs and cited facts open their source.

## Verification Notes

I did not run the app or tests. This was a read-only wiring audit from source code, matching the method of `coordination/smoke-1/REACHABILITY-AUDIT.md`.
