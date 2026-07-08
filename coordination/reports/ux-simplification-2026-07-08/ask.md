# Ask Screen UX Simplification Audit

## 1. Screen summary
1. The screen shows a top header with "Ask" and an AI-destination pill, a left conversations rail, a central answer thread, a bottom question composer, and a right Sources strip/panel.
2. The core value is strong: ask across client work, email, documents, or the whole book, then open the cited source.
3. The main visual cost is repetition: scope, source trust, file access, and "from your files" messages appear in several places at once.
4. The main interaction cost is that secondary controls are visible before they matter: rail search, answer scope, file access details, and the empty Sources strip.
5. The minimal direction: keep trust visible, but make the default view one question box, one clear scope, one destination pill, and citations only when they exist.

## 2. Recommendations

1. **Replace four scope pills plus the read-only scope pill with one scope menu.**  
   **What/where:** `ScopeToggle`, [src/features/ask/ScopeToggle.tsx:43](../../../src/features/ask/ScopeToggle.tsx#L43)-[49](../../../src/features/ask/ScopeToggle.tsx#L49), rendered in `AskComposer` at [src/features/ask/AskComposer.tsx:313](../../../src/features/ask/AskComposer.tsx#L313)-[315](../../../src/features/ask/AskComposer.tsx#L315), plus the separate read-only `ScopeStatusPill` in `Ask` at [src/features/ask/Ask.tsx:581](../../../src/features/ask/Ask.tsx#L581)-[585](../../../src/features/ask/Ask.tsx#L585).  
   **Why it costs more than it gives:** The user sees scope twice: once as clickable chips near the composer and once as a non-clickable status chip in the thread. The chips also create a row of choices before the user has asked anything.  
   **Simplification:** Use one selected-scope button: `This client v`. Open a small menu with `This client`, `All clients`, `Email`, `Documents`, and `Book overview`. Remove the separate read-only scope pill from the thread because the composer is already sticky. Copy rewrite: `All clients` -> keep in menu, but selected chip can show `All`; `Documents` -> `Docs` if space is tight; `Book Overview` -> `Book`.  
   **Impact:** HIGH.

2. **Hide the empty Sources strip until there is something to cite.**  
   **What/where:** Collapsed right Sources pane in `Ask`, [src/features/ask/Ask.tsx:715](../../../src/features/ask/Ask.tsx#L715)-[756](../../../src/features/ask/Ask.tsx#L756). Expanded empty state comes from `SourcePanel`, [src/features/ask/SourcePanel.tsx:419](../../../src/features/ask/SourcePanel.tsx#L419)-[433](../../../src/features/ask/SourcePanel.tsx#L433), with copy in [src/locales/en.json:1066](../../../src/locales/en.json#L1066)-[1067](../../../src/locales/en.json#L1067).  
   **Why it costs more than it gives:** A permanent 48px strip with a vertical `Sources` label makes the screen feel like a three-panel tool even when no answer exists yet. The panel is most valuable after a cited answer, not before.  
   **Simplification:** Do not render the strip until the current answer has citations, or until the user clicks a cited-count pill. When collapsed, show only the shield icon button with tooltip `Sources`; drop the vertical word. Empty copy rewrite: `When an answer uses your files, the cited sources appear here. General-knowledge answers have nothing to cite; that's the point.` -> `No file sources for this answer.` Footer rewrite: remove by default; show the same idea in the empty state only.  
   **Impact:** HIGH.

3. **Turn "Answer scope" into a quiet settings icon unless it is non-default.**  
   **What/where:** `AnswerScopePopover` in [src/features/ask/AskComposer.tsx:145](../../../src/features/ask/AskComposer.tsx#L145)-[194](../../../src/features/ask/AskComposer.tsx#L194), copy in [src/locales/en.json:1069](../../../src/locales/en.json#L1069)-[1075](../../../src/locales/en.json#L1075).  
   **Why it costs more than it gives:** `Files + general` is visible on every question, even though it is the normal state. It reads like one more mode the user has to understand before asking.  
   **Simplification:** Default state: show a `SlidersHorizontal` icon-only button with tooltip `Answer settings`. If the user turns on files-only mode, show the text chip `Files only`. Popover copy rewrite: `Answer scope` -> `Answer settings`; `Choose whether Ask can use general knowledge, and manage file access for this chat.` -> `Control sources and file access for this chat.`; `Files-only mode` -> `Use files only`.  
   **Impact:** HIGH.

4. **Shorten the file-access consent prompt into a two-line consent card.**  
   **What/where:** `FileAccessConsentBanner`, [src/features/ask/chat/FileAccessConsentBanner.tsx:121](../../../src/features/ask/chat/FileAccessConsentBanner.tsx#L121)-[159](../../../src/features/ask/chat/FileAccessConsentBanner.tsx#L159).  
   **Why it costs more than it gives:** The unasked and reconfirm states are long enough to dominate the answer-settings popover. The trust point is important, but the current copy explains every edge case at once.  
   **Simplification:** Keep the consent gate, but make the default prompt: `Allow AI file access for {scopeLabel}?` and `It can search and read files. File text may go to {provider}. Any edit still asks first.` Add a `Details` link or disclosure for the longer explanation. Button rewrite: `Allow file access` -> `Allow`; `Allow for all` -> `Allow all`; `Not now` stays. Granted rewrite: `The AI can search, open, and change files on its own in this chat (every change still asks first).` -> `File access on. Edits still ask first.` Denied rewrite: `File access is off for this chat.` -> `File access off.`  
   **Impact:** HIGH.

5. **Stop repeating the same cited-answer reassurance in boxes, badges, cards, and footers.**  
   **What/where:** Flat answer attestation in `TurnBlock`, [src/features/ask/TurnBlock.tsx:296](../../../src/features/ask/TurnBlock.tsx#L296)-[321](../../../src/features/ask/TurnBlock.tsx#L321); block answer attestation in `AnswerBlocks`, [src/features/ask/AnswerBlocks.tsx:292](../../../src/features/ask/AnswerBlocks.tsx#L292)-[307](../../../src/features/ask/AnswerBlocks.tsx#L307); source card verification in [src/features/ask/SourcePanel.tsx:302](../../../src/features/ask/SourcePanel.tsx#L302)-[345](../../../src/features/ask/SourcePanel.tsx#L345).  
   **Why it costs more than it gives:** Once an answer has green citation chips and verified source cards, the large green box restates what the user can already see. It makes every answer feel heavier.  
   **Simplification:** Use one compact answer footer: `Cited from your files. Open any number to check.` Do not also show the full green box unless the Sources panel is hidden and no cited-count pill is present. Existing copy rewrite: `Answered over your own files. Every cited claim has a source you can open and check.` -> `Cited from your files. Open any number to check.`  
   **Impact:** HIGH.

6. **Flatten source cards into source rows.**  
   **What/where:** `SourceCard`, [src/features/ask/SourcePanel.tsx:192](../../../src/features/ask/SourcePanel.tsx#L192)-[348](../../../src/features/ask/SourcePanel.tsx#L348). The current card uses rounded borders, shadow, a green number box, file icon, filename, quote, show-more control, and verification line.  
   **Why it costs more than it gives:** The right panel is already a contained area. Heavy cards inside it create boxes inside a box and pull attention away from the answer.  
   **Simplification:** Use a flat list row with a small citation number, filename, one/two-line quote, and a compact status on the same meta row. Remove the card shadow. Copy rewrites: `Verified against source` -> `Verified`; `Source found` -> `Found`; `Quote not found in the source` -> `Quote not found`; `Quote does not match the source` -> `Quote mismatch`; `Belongs to a different client` -> `Wrong client`.  
   **Impact:** HIGH.

7. **Make the answer-block labels smaller and less label-heavy.**  
   **What/where:** `AnswerBlocks` label definitions and styling, [src/features/ask/AnswerBlocks.tsx:69](../../../src/features/ask/AnswerBlocks.tsx#L69)-[78](../../../src/features/ask/AnswerBlocks.tsx#L78) and [src/features/ask/AnswerBlocks.tsx:113](../../../src/features/ask/AnswerBlocks.tsx#L113)-[139](../../../src/features/ask/AnswerBlocks.tsx#L139).  
   **Why it costs more than it gives:** Every block gets an uppercase pill before the actual answer text. This is useful trust metadata, but it visually chops the answer into many labeled objects.  
   **Simplification:** Keep the labels, but make them sentence-case text chips with less padding and no uppercase transform. Copy rewrites: `From your files` -> `Files`; `From your files - nothing found` -> `No file match`; `From your files - not verified` -> `Found, not verified`; `From your files - checking...` -> `Checking`; `General guidance` -> `General`; `Draft` stays. Full explanations move to tooltip.  
   **Impact:** HIGH.

8. **Keep one general-knowledge warning, not three.**  
   **What/where:** General block footer in [src/features/ask/AnswerBlocks.tsx:253](../../../src/features/ask/AnswerBlocks.tsx#L253)-[275](../../../src/features/ask/AnswerBlocks.tsx#L275), tally pill in [src/features/ask/AnswerBlocks.tsx:384](../../../src/features/ask/AnswerBlocks.tsx#L384)-[391](../../../src/features/ask/AnswerBlocks.tsx#L391), nothing-found note in [src/features/ask/AnswerBlocks.tsx:397](../../../src/features/ask/AnswerBlocks.tsx#L397)-[410](../../../src/features/ask/AnswerBlocks.tsx#L410).  
   **Why it costs more than it gives:** A general answer can show a `General` label, a sentence saying it is not from files, and a footer saying to verify current rules. That is the same warning repeated.  
   **Simplification:** Use the block label plus one short footer only when the answer mixes file claims and general guidance. Copy rewrite: `General knowledge, not from your files - rules and limits change; confirm current figures before you advise.` -> `General knowledge. Verify current rules.` Tally rewrite: `General guidance - verify current rules` -> `General`. Nothing-found rewrite: `Nothing found in your files. The guidance above is general knowledge, clearly marked - not from this client's records.` -> `No file match. General guidance is marked.`  
   **Impact:** HIGH.

9. **Move answer actions into a small `...` menu.**  
   **What/where:** `Save to document` button in `TurnBlock`, [src/features/ask/TurnBlock.tsx:433](../../../src/features/ask/TurnBlock.tsx#L433)-[446](../../../src/features/ask/TurnBlock.tsx#L446).  
   **Why it costs more than it gives:** The primary action on this screen is asking. A full secondary button under every answer competes with reading the answer.  
   **Simplification:** Put answer actions in a right-aligned `...` menu on the answer block. Menu item copy rewrite: `Save to document` -> `Save to doc`. Loading copy can stay `Saving...`. This follows the app's newer `...` pattern for secondary actions.  
   **Impact:** HIGH.

10. **Make "New question" a secondary plus action, not a full-width button.**  
    **What/where:** `ConversationsRail`, [src/features/ask/ConversationsRail.tsx:187](../../../src/features/ask/ConversationsRail.tsx#L187)-[207](../../../src/features/ask/ConversationsRail.tsx#L207).  
    **Why it costs more than it gives:** The rail's full-width `New question` button looks like a second primary action, while the actual primary action is the Ask composer.  
    **Simplification:** Use a small `+` icon button in the rail header with tooltip `New question`, or a compact `+ New` row if text is needed. Copy rewrite: `New question` -> `New` in expanded rail; icon-only in collapsed rail already works at [src/features/ask/ConversationsRail.tsx:148](../../../src/features/ask/ConversationsRail.tsx#L148)-[155](../../../src/features/ask/ConversationsRail.tsx#L155).  
    **Impact:** MED.

11. **Fold conversation search until the rail has enough history to need it.**  
    **What/where:** Rail search field in [src/features/ask/ConversationsRail.tsx:208](../../../src/features/ask/ConversationsRail.tsx#L208)-[217](../../../src/features/ask/ConversationsRail.tsx#L217), copy in [src/locales/en.json:1055](../../../src/locales/en.json#L1055).  
    **Why it costs more than it gives:** Search is visible even when the rail is empty or has only a few questions. It adds one more input right beside the main Ask input.  
    **Simplification:** Show a search icon in the rail header, expanding to a field on click, or show the field only after 8+ saved conversations. Copy rewrite: `Search conversations` -> `Search`.  
    **Impact:** MED.

12. **Make rail group labels shorter and quieter.**  
    **What/where:** Rail group titles created in `Ask`, [src/features/ask/Ask.tsx:297](../../../src/features/ask/Ask.tsx#L297)-[310](../../../src/features/ask/Ask.tsx#L310), rendered by `Eyebrow` in [src/features/ask/ConversationsRail.tsx:255](../../../src/features/ask/ConversationsRail.tsx#L255)-[258](../../../src/features/ask/ConversationsRail.tsx#L258), copy in [src/locales/en.json:1054](../../../src/locales/en.json#L1054).  
    **Why it costs more than it gives:** `This client` and `Other conversations` are useful, but the rail already implies these are conversations. The second label is especially wordy.  
    **Simplification:** Copy rewrite: `Other conversations` -> `Other`; `This client` can stay, or become `Current` if the active client is named nearby. Hide the group label when only one group has items.  
    **Impact:** MED.

13. **Move rail dates from a second line to hover or a compact right meta.**  
    **What/where:** `RailItem`, [src/features/ask/ConversationsRail.tsx:63](../../../src/features/ask/ConversationsRail.tsx#L63)-[100](../../../src/features/ask/ConversationsRail.tsx#L100); date text comes from `dateLabelFromTimestamp`, [src/features/ask/askHelpers.ts:694](../../../src/features/ask/askHelpers.ts#L694)-[699](../../../src/features/ask/askHelpers.ts#L699).  
    **Why it costs more than it gives:** Every saved question becomes two lines, so the rail gets tall and dense quickly.  
    **Simplification:** Keep the full timestamp in the row `title` tooltip. In the visible row, show date only for older groups or as a faint right-aligned short form. No copy change needed.  
    **Impact:** MED.

14. **Make the composer submit button icon-only at rest.**  
    **What/where:** Ask submit button in `AskComposer`, [src/features/ask/AskComposer.tsx:244](../../../src/features/ask/AskComposer.tsx#L244)-[258](../../../src/features/ask/AskComposer.tsx#L258), using `Ask` from [src/locales/en.json:1050](../../../src/locales/en.json#L1050)-[1052](../../../src/locales/en.json#L1052).  
    **Why it costs more than it gives:** The input placeholder already starts with `Ask...`, and the arrow icon beside the input is clear. The text button makes the composer feel more like a form than a quick command box.  
    **Simplification:** At rest, show only the arrow icon with tooltip and aria-label `Ask`. Keep visible status text while busy: `Searching...` and `Answering...` are useful progress feedback.  
    **Impact:** MED.

15. **Remove the quote icon from user questions.**  
    **What/where:** Question echo in `TurnBlock`, [src/features/ask/TurnBlock.tsx:160](../../../src/features/ask/TurnBlock.tsx#L160)-[183](../../../src/features/ask/TurnBlock.tsx#L183).  
    **Why it costs more than it gives:** The quote icon and italic style add a decorative signal to something the layout already communicates: this is the user's question.  
    **Simplification:** Show the question as a plain, compact line above the answer, no icon and no italic. Keep the text itself. This saves space without removing context.  
    **Impact:** MED.

16. **Shorten import-in-progress copy.**  
    **What/where:** Still-importing banner in `Ask`, [src/features/ask/Ask.tsx:659](../../../src/features/ask/Ask.tsx#L659)-[663](../../../src/features/ask/Ask.tsx#L663), and `StillImportingBanner`, [src/features/ask/StillImportingBanner.tsx:15](../../../src/features/ask/StillImportingBanner.tsx#L15)-[19](../../../src/features/ask/StillImportingBanner.tsx#L19). Still-importing decline note in `TurnBlock`, [src/features/ask/TurnBlock.tsx:361](../../../src/features/ask/TurnBlock.tsx#L361)-[385](../../../src/features/ask/TurnBlock.tsx#L385).  
    **Why it costs more than it gives:** The message is right, but it uses a conversational phrase where a status line would be easier to scan.  
    **Simplification:** Banner rewrite: `Still bringing in your files and email - answers may be incomplete.` -> `Importing files and email. Answers may be incomplete.` Decline rewrite: `Your files and email are still being imported, so this may just not be indexed yet - try again once that finishes.` -> `Still importing. Try again when it finishes.`  
    **Impact:** MED.

17. **Shorten the "nothing found" note and remove "household" from this generic Ask copy.**  
    **What/where:** Deliberate decline note in `TurnBlock`, [src/features/ask/TurnBlock.tsx:330](../../../src/features/ask/TurnBlock.tsx#L330)-[355](../../../src/features/ask/TurnBlock.tsx#L355).  
    **Why it costs more than it gives:** The note is useful, but it is long and says `household`, while the rest of the screen's facade is `client` unless a specific household label is in data.  
    **Simplification:** Copy rewrite: `This is on purpose - I only answer from your files, never from general knowledge. Ask about something in this household and I'll cite the source.` -> `Nothing found in your files. Try a question about this client.` If scope is all clients, use `your clients`.  
    **Impact:** MED.

18. **Shorten stale export warnings into a scannable sentence.**  
    **What/where:** Stale exported-plan warning in `TurnBlock`, [src/features/ask/TurnBlock.tsx:413](../../../src/features/ask/TurnBlock.tsx#L413)-[430](../../../src/features/ask/TurnBlock.tsx#L430), plus the provenance badge in `SourcePanel`, [src/features/ask/SourcePanel.tsx:104](../../../src/features/ask/SourcePanel.tsx#L104)-[145](../../../src/features/ask/SourcePanel.tsx#L145).  
    **Why it costs more than it gives:** The warning repeats the concept of a snapshot twice and then asks for re-export. It is important, but too long for a post-answer warning.  
    **Simplification:** Copy rewrite: `This answer relies on exported plan snapshots that may be out of date: RightCapital plan from Jun 12, 2026 (26 days ago). A plan is a point-in-time snapshot, so figures may be out of date. Re-export the latest to refresh it.` -> `Uses old plan exports: RightCapital, Jun 12 (26 days old). Re-export to refresh.` Keep the detailed explanation in the tooltip.  
    **Impact:** MED.

19. **Make the indexing-off notice shorter and more direct.**  
    **What/where:** Memory/indexing notice in `Ask`, [src/features/ask/Ask.tsx:548](../../../src/features/ask/Ask.tsx#L548)-[579](../../../src/features/ask/Ask.tsx#L579).  
    **Why it costs more than it gives:** The line is clear, but the phrase `need your documents indexed on your machine` is a technical explanation in the main UI.  
    **Simplification:** Copy rewrite: `Cited answers need your documents indexed on your machine.` -> `Index documents for cited answers.` Button rewrite: `Enable indexing` -> `Enable`.  
    **Impact:** MED.

20. **Make Book Overview results read less like a mini dashboard.**  
    **What/where:** `BookAnswerPanel`, [src/features/ask/book/BookAnswerPanel.tsx:25](../../../src/features/ask/book/BookAnswerPanel.tsx#L25)-[53](../../../src/features/ask/book/BookAnswerPanel.tsx#L53), copy in [src/locales/en.json:1019](../../../src/locales/en.json#L1019)-[1028](../../../src/locales/en.json#L1028).  
    **Why it costs more than it gives:** The answer, `Matching clients` eyebrow, client chips, fact cards, and footer note can feel like a separate report inside Ask.  
    **Simplification:** Rename `Matching clients` -> `Matches`. Turn the footer into a compact status chip: `Summary-only`, with tooltip `Answered from saved Client Maps. Documents were not searched across clients.` Copy rewrite for visible footer: `Answered from each client's saved summary. Documents were not searched across clients.` -> `Summary-only.`  
    **Impact:** MED.

21. **Shorten whole-practice confirmation without weakening consent.**  
    **What/where:** `WholePracticeSendConfirm`, [src/features/ask/book/WholePracticeSendConfirm.tsx:33](../../../src/features/ask/book/WholePracticeSendConfirm.tsx#L33)-[64](../../../src/features/ask/book/WholePracticeSendConfirm.tsx#L64), copy in [src/locales/en.json:1029](../../../src/locales/en.json#L1029)-[1037](../../../src/locales/en.json#L1037).  
    **Why it costs more than it gives:** The consent dialog is necessary, but `whole-practice questions` is long and formal.  
    **Simplification:** Title rewrite: `Send summaries across your whole practice?` -> `Send client summaries?` Body can stay count/provider-specific, but shorten: `This sends brief summaries of {{count}} clients to {{provider}}. Continue?` -> `Send summaries for {{count}} clients to {{provider}}?` Checkbox rewrite: `Don't ask again before whole-practice questions` -> `Remember for Book asks`. Buttons stay `Cancel` and `Continue`.  
    **Impact:** MED.

22. **Shorten the demo-only intro if this same screen is used in the web demo.**  
    **What/where:** Demo intro in `Ask`, [src/features/ask/Ask.tsx:507](../../../src/features/ask/Ask.tsx#L507)-[545](../../../src/features/ask/Ask.tsx#L545).  
    **Why it costs more than it gives:** It is demo-only, but it has two explanatory paragraphs before the suggested questions. For a minimal Ask surface, the sample questions should carry the demo.  
    **Simplification:** Copy rewrite: `Answers here are cited to your files - Ask only answers from these documents, never the open internet, and you can click any citation to open the source. For drafting documents, use Workflows, and check current-year figures before you send.` -> `Answers are cited to these files. Click a citation to open the source.` Rewrite `Advisor Prep Hero isn't a CRM or a note-taker. It sits beside your tools and reads across your files.` -> remove or place behind an info tooltip.  
    **Impact:** LOW.

23. **Make the sample-data bridge quieter after the first sample answer.**  
    **What/where:** `SampleBridgeCallout`, [src/features/ask/SampleBridgeCallout.tsx:36](../../../src/features/ask/SampleBridgeCallout.tsx#L36)-[95](../../../src/features/ask/SampleBridgeCallout.tsx#L95), copy in [src/locales/en.json:1082](../../../src/locales/en.json#L1082)-[1085](../../../src/locales/en.json#L1085).  
    **Why it costs more than it gives:** It is a full bordered callout with body text, a primary button, and a close button, shown under answers after the user already understands the sample.  
    **Simplification:** Use a one-line inline nudge with a `+` action: `Sample data. Add your first client to search your files.` Button rewrite: `Add a client` -> `Add client`. Keep dismiss.  
    **Impact:** LOW.

## 3. Do not touch

- **Keep the AI-destination pill visible.** It is the clearest always-visible trust signal: `Ask` header action at [src/features/ask/Ask.tsx:442](../../../src/features/ask/Ask.tsx#L442)-[456](../../../src/features/ask/Ask.tsx#L456), rendered by `EgressIndicator` status mode at [src/platform/privacy/ui/EgressIndicator.tsx:275](../../../src/platform/privacy/ui/EgressIndicator.tsx#L275)-[305](../../../src/platform/privacy/ui/EgressIndicator.tsx#L305).
- **Keep consent gates visible before sensitive sends.** File access consent in [src/features/ask/chat/FileAccessConsentBanner.tsx:121](../../../src/features/ask/chat/FileAccessConsentBanner.tsx#L121)-[159](../../../src/features/ask/chat/FileAccessConsentBanner.tsx#L159) and whole-practice confirmation in [src/features/ask/book/WholePracticeSendConfirm.tsx:33](../../../src/features/ask/book/WholePracticeSendConfirm.tsx#L33)-[64](../../../src/features/ask/book/WholePracticeSendConfirm.tsx#L64) are load-bearing.
- **Keep citation chips and verification states.** The user needs to see which claims are cited, found, verified, or not verified: `CitationText` at [src/features/ask/CitationText.tsx:71](../../../src/features/ask/CitationText.tsx#L71)-[123](../../../src/features/ask/CitationText.tsx#L123), `SourcePanel` at [src/features/ask/SourcePanel.tsx:302](../../../src/features/ask/SourcePanel.tsx#L302)-[345](../../../src/features/ask/SourcePanel.tsx#L345), and `AnswerBlocks` at [src/features/ask/AnswerBlocks.tsx:348](../../../src/features/ask/AnswerBlocks.tsx#L348)-[391](../../../src/features/ask/AnswerBlocks.tsx#L391).
- **Keep stale-export warnings visible.** They stop exported RightCapital/Jump snapshots from looking live: [src/features/ask/TurnBlock.tsx:413](../../../src/features/ask/TurnBlock.tsx#L413)-[430](../../../src/features/ask/TurnBlock.tsx#L430) and [src/features/ask/SourcePanel.tsx:104](../../../src/features/ask/SourcePanel.tsx#L104)-[145](../../../src/features/ask/SourcePanel.tsx#L145).
- **Keep importing/indexing status visible when active.** A temporary "not found" can mean data is still arriving, not that the answer is empty: [src/features/ask/Ask.tsx:548](../../../src/features/ask/Ask.tsx#L548)-[579](../../../src/features/ask/Ask.tsx#L579) and [src/features/ask/StillImportingBanner.tsx:15](../../../src/features/ask/StillImportingBanner.tsx#L15)-[19](../../../src/features/ask/StillImportingBanner.tsx#L19).
- **Keep the left rail pattern.** A left rail for conversation history matches the app's newer navigation direction. Simplify its controls, but do not move history into the main answer area.
- **Keep user-facing `client` wording.** Do not expose the internal `matter` word in this screen. If the screen needs more specificity, use `client` or the actual client/household name from data.
