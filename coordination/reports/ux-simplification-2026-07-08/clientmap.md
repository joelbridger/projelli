# Client Map Minimalism Audit

## 1. Screen Summary

The Client Map screen has one strong idea: a cited client summary the advisor can trust.
The current screen shows a top header, four top tabs, a left section rail, the map content, a right sources pane, optional prep/review/profile blocks, and two kinds of history.
Most value lives in the facts, citations, missing questions, and approval gates.
Most visual weight comes from always-visible side panels, repeated actions, helper copy, and raised cards inside an otherwise flat surface.
The best simplification path is to keep trust visible, but fold tools and explanations until the advisor asks for them.

## 2. Recommendations

1. **Start the Sources pane collapsed by default**
   - **What / where:** `ClientMapPanel`, right Sources column, [src/features/matters/ClientMapPanel.tsx:1403](../../../../src/features/matters/ClientMapPanel.tsx#L1403) and `SourcePanel`, [src/features/ask/SourcePanel.tsx:397](../../../../src/features/ask/SourcePanel.tsx#L397).
   - **Why it costs more than it gives:** The pane takes 326px all the time, adds a second vertical border, and pulls attention away from the map facts. The inline source chips already prove that facts are cited.
   - **Concrete simplification:** Open with the pane at 48px unless the advisor clicks a source chip or the collapsed Sources button. Keep the collapsed button visible. When a source chip is clicked, expand the pane and scroll to that source.
   - **Copy rewrite:** `Sources` stays as the tooltip. No empty state needed on Client Map because this host does not pass `emptyHint`.
   - **Impact:** HIGH

2. **Make "What I'm missing" the only gap-answering home**
   - **What / where:** `MissingPanel`, [src/features/matters/ClientMapPanel.tsx:780](../../../../src/features/matters/ClientMapPanel.tsx#L780), rail guided interview icon, [src/features/matters/ClientMapPanel.tsx:1281](../../../../src/features/matters/ClientMapPanel.tsx#L1281), and `GuidedInterview`, [src/features/matters/GuidedInterview.tsx:68](../../../../src/features/matters/GuidedInterview.tsx#L68).
   - **Why it costs more than it gives:** The same questions appear in two places: the Missing panel and the guided interview card. Two paths for one job makes the screen feel busier than it is.
   - **Concrete simplification:** Remove the Sparkles icon from the rail. Put one secondary action inside the Missing panel: `Answer one by one`. That opens the current `GuidedInterview` flow inline inside the Missing panel.
   - **Copy rewrite:** `Start guided interview` -> `Answer one by one`; `Question 1 of 3` -> `1 / 3`.
   - **Impact:** HIGH

3. **Hide row Edit and Remove behind a row menu**
   - **What / where:** `ItemRow`, [src/features/matters/ClientMapPanel.tsx:373](../../../../src/features/matters/ClientMapPanel.tsx#L373) and [src/features/matters/ClientMapPanel.tsx:385](../../../../src/features/matters/ClientMapPanel.tsx#L385).
   - **Why it costs more than it gives:** Every fact row carries visible `Edit` and `Remove` text, even when the advisor is only reading. These repeated controls compete with the fact and its sources.
   - **Concrete simplification:** Show a small `...` row menu on hover/focus. Menu items: `Edit`, `Remove`. Keep keyboard access. Keep source chips always visible.
   - **Copy rewrite:** Keep menu labels as `Edit` and `Remove`; remove the always-visible row text buttons.
   - **Impact:** HIGH

4. **Fold per-section edit history into the main History panel**
   - **What / where:** `HistoryList`, [src/features/matters/ClientMapPanel.tsx:428](../../../../src/features/matters/ClientMapPanel.tsx#L428), rendered under every section at [src/features/matters/ClientMapPanel.tsx:773](../../../../src/features/matters/ClientMapPanel.tsx#L773), plus the global History slide panel at [src/features/matters/MatterHub.tsx:736](../../../../src/features/matters/MatterHub.tsx#L736).
   - **Why it costs more than it gives:** History appears twice: a small list below the active section and a full slide panel from the `...` menu. Most sections will show `No edits yet.`, which is dead weight.
   - **Concrete simplification:** Remove the default section-level history block. Add `View section history` to the section header `...` menu or filter the existing History slide panel to the active section.
   - **Copy rewrite:** `Edit history` -> `History`; hide `No edits yet.` entirely.
   - **Impact:** HIGH

5. **Turn the "Before you meet" strip into a one-line summary until opened**
   - **What / where:** `BeforeYouMeetStrip`, [src/features/meetings/BeforeYouMeetStrip.tsx:147](../../../../src/features/meetings/BeforeYouMeetStrip.tsx#L147).
   - **Why it costs more than it gives:** This strip can sit above the Client Map and look like a second primary screen. It has its own bullets, citations, three buttons, saved state, stale chip, and border.
   - **Concrete simplification:** Default it to collapsed. Show one row: `Before you meet` + meeting count or first brief title + chevron. Inside the expanded state, move export/agenda/refresh into a `...` menu.
   - **Copy rewrite:** `Export brief (Word)` -> `Brief`; `Agenda (Word)` -> `Agenda`; `New documents arrived since this was written` -> `New files added`.
   - **Impact:** HIGH

6. **Reduce source cards from mini-cards to quiet source rows**
   - **What / where:** `SourceCard`, [src/features/ask/SourcePanel.tsx:192](../../../../src/features/ask/SourcePanel.tsx#L192), especially border radius and shadow at [src/features/ask/SourcePanel.tsx:204](../../../../src/features/ask/SourcePanel.tsx#L204).
   - **Why it costs more than it gives:** The card has a 12px radius and heavy shadow inside a side pane. It feels more important than the Client Map fact it supports.
   - **Concrete simplification:** Use a flat row/card with max 8px radius, no shadow, and a light divider between sources. Keep filename, quote preview, and verification state.
   - **Copy rewrite:** `Verified against source` -> `Verified`; `Source found` -> `Found`. Keep the longer explanation in the tooltip.
   - **Impact:** HIGH

7. **Make adding a bullet a collapsed action**
   - **What / where:** `SectionPanel`, add bullet form, [src/features/matters/ClientMapPanel.tsx:738](../../../../src/features/matters/ClientMapPanel.tsx#L738).
   - **Why it costs more than it gives:** Every section permanently shows an input and an `Add bullet` button. That makes the page feel like an editor even when the advisor is reading.
   - **Concrete simplification:** Replace the always-open form with a quiet `+ Add fact` row at the bottom. Open the input only after click.
   - **Copy rewrite:** `Add a client-map bullet...` -> `Add fact`; `Add bullet` -> `Add`.
   - **Impact:** HIGH

8. **Move custom-section actions into a section menu**
   - **What / where:** Custom section header buttons in `SectionPanel`, [src/features/matters/ClientMapPanel.tsx:695](../../../../src/features/matters/ClientMapPanel.tsx#L695) and [src/features/matters/ClientMapPanel.tsx:706](../../../../src/features/matters/ClientMapPanel.tsx#L706).
   - **Why it costs more than it gives:** `Save as template` and `Remove` are visible in the section header. They are not primary reading actions.
   - **Concrete simplification:** Add a section-level `...` menu. Menu items: `Save as template`, `Remove section`, `View section history`.
   - **Copy rewrite:** `Remove` -> `Remove section` inside the menu.
   - **Impact:** HIGH

9. **Shorten and soften the Missing panel**
   - **What / where:** `MissingPanel`, title and caveat, [src/features/matters/ClientMapPanel.tsx:800](../../../../src/features/matters/ClientMapPanel.tsx#L800) and [src/features/matters/ClientMapPanel.tsx:811](../../../../src/features/matters/ClientMapPanel.tsx#L811).
   - **Why it costs more than it gives:** The title `What I'm still missing`, rail label `What I'm missing`, level chip, and long caveat all explain the same area before the user reaches the questions.
   - **Concrete simplification:** Use a shorter title and a one-line caveat with an info tooltip for the full warning.
   - **Copy rewrite:** `What I'm still missing` -> `Missing`; `Built from the files Advisor Prep Hero can read — a head-start for your review, not a guarantee the whole record is complete.` -> `Only includes files Lantern can read.`
   - **Impact:** HIGH

10. **Clean up the top actions menu copy**
    - **What / where:** `MatterHub` action menu, [src/features/matters/MatterHub.tsx:454](../../../../src/features/matters/MatterHub.tsx#L454), strings in [src/locales/en.json:1315](../../../../src/locales/en.json#L1315).
    - **Why it costs more than it gives:** Menu labels repeat `client map` even though the user is already on Client Map. `Sync all` is vague.
    - **Concrete simplification:** Keep all items in the `...` menu, but shorten the labels.
    - **Copy rewrite:** `Client map actions` -> `Actions`; `Export client map (DOCX)` -> `Export Word`; `Export client map (PDF)` -> `Export PDF`; `Sync all` -> `Update map`.
    - **Impact:** MED

11. **Make last-updated status quieter**
    - **What / where:** `MatterHub`, `clientmap-last-updated`, [src/features/matters/MatterHub.tsx:494](../../../../src/features/matters/MatterHub.tsx#L494).
    - **Why it costs more than it gives:** `Updated Jul...`, `No new changes`, or `Sync failed` sits beside the client name forever. It reads like primary header content.
    - **Concrete simplification:** Keep only failure/syncing states visible in the header. Put normal last-updated time in the `Update map` menu item tooltip or a subtle timestamp inside the menu.
    - **Copy rewrite:** `Syncing...` -> `Updating...`; `No new changes` -> show only after update for 3 seconds, then hide.
    - **Impact:** MED

12. **Use one primary action in the Missing question rows**
    - **What / where:** `MissingPanel` gap rows, [src/features/matters/ClientMapPanel.tsx:820](../../../../src/features/matters/ClientMapPanel.tsx#L820).
    - **Why it costs more than it gives:** Each missing question has two same-weight buttons: `I know this` and `Ask the client`. This creates many buttons in a list.
    - **Concrete simplification:** Make `Answer` the visible primary action. Put `Ask client` in a row `...` menu, or make it a secondary text link.
    - **Copy rewrite:** `I know this` -> `Answer`; `Ask the client` -> `Ask client`.
    - **Impact:** MED

13. **Hide "Questions for the client" when empty**
    - **What / where:** `ClientQuestionsList`, [src/features/matters/ClientQuestionsList.tsx:47](../../../../src/features/matters/ClientQuestionsList.tsx#L47), rendered by `MissingPanel` at [src/features/matters/ClientMapPanel.tsx:875](../../../../src/features/matters/ClientMapPanel.tsx#L875).
    - **Why it costs more than it gives:** When there are no flagged questions, the screen still shows `Questions for the client` and `No questions flagged yet.` That tells the advisor nothing actionable.
    - **Concrete simplification:** Return `null` when the question list is empty.
    - **Copy rewrite:** Hide `No questions flagged yet.` entirely.
    - **Impact:** MED

14. **Simplify the guided interview card when it is open**
    - **What / where:** `GuidedInterview`, [src/features/matters/GuidedInterview.tsx:68](../../../../src/features/matters/GuidedInterview.tsx#L68).
    - **Why it costs more than it gives:** A raised card inside the flat Client Map makes the interview feel like a separate product. The copy also repeats Missing panel language.
    - **Concrete simplification:** Render it as a flat inline panel in Missing, not `Card variant="raised"`. Use one compact progress label and one primary button.
    - **Copy rewrite:** `Type your answer here...` -> `Answer`; `I know this` -> `Save`; `Ask the client` -> `Flag`; `All caught up` / `No open questions right now.` -> do not open the panel when there are no questions.
    - **Impact:** MED

15. **Shorten empty-section copy**
    - **What / where:** `LABEL_SECTION_EMPTY`, [src/features/matters/ClientMapPanel.tsx:118](../../../../src/features/matters/ClientMapPanel.tsx#L118), rendered at [src/features/matters/ClientMapPanel.tsx:735](../../../../src/features/matters/ClientMapPanel.tsx#L735).
    - **Why it costs more than it gives:** The same sentence can appear in multiple empty core sections. The rail already shows the user which section they picked.
    - **Concrete simplification:** Use one short empty sentence.
    - **Copy rewrite:** `Nothing here yet — this section fills in as documents and email come in.` -> `No facts yet.`
    - **Impact:** MED

16. **Shorten the New Section form**
    - **What / where:** `AddSectionPanel`, [src/features/matters/ClientMapPanel.tsx:980](../../../../src/features/matters/ClientMapPanel.tsx#L980).
    - **Why it costs more than it gives:** The form has a heading, helper paragraph, two labels, two long placeholders, and a template section. It makes a rare action feel like a full setup flow.
    - **Concrete simplification:** Keep the heading and two inputs, but trim helper copy and labels. Move saved templates into a select/menu above the submit button.
    - **Copy rewrite:** `Name a section and say what to track. Advisor Prep Hero fills it in from this client's documents and email, with sources you can check.` -> `Add a topic. Lantern fills it from this client's sources.`; `Section name` -> `Name`; `What should I track here?` -> `Track`; `e.g. policy types, coverage limits, and renewal dates` -> `Policies, limits, renewals`.
    - **Impact:** MED

17. **Remove borders around saved-template rows**
    - **What / where:** Template list inside `AddSectionPanel`, [src/features/matters/ClientMapPanel.tsx:1062](../../../../src/features/matters/ClientMapPanel.tsx#L1062).
    - **Why it costs more than it gives:** Saved templates are secondary choices, but each one gets a bordered row and a button.
    - **Concrete simplification:** Use a compact menu or command list: template name plus check/use icon. No card border per template.
    - **Copy rewrite:** `Reuse a saved template` -> `Saved templates`; `Use` -> `Apply`.
    - **Impact:** MED

18. **Trim the meeting-note filter label**
    - **What / where:** `SectionPanel`, imported meeting notes chip, [src/features/matters/ClientMapPanel.tsx:683](../../../../src/features/matters/ClientMapPanel.tsx#L683).
    - **Why it costs more than it gives:** `Imported meeting notes (3)` is long in a section header that also has the section title and possible custom actions.
    - **Concrete simplification:** Keep the filter, shorten the label, and consider putting filters in a small funnel menu when more filters are added.
    - **Copy rewrite:** `Imported meeting notes ({{count}})` -> `Meetings ({{count}})`.
    - **Impact:** MED

19. **Use shorter section rail labels where the screen already gives context**
    - **What / where:** Rail `TabButton` labels, [src/features/matters/ClientMapPanel.tsx:1291](../../../../src/features/matters/ClientMapPanel.tsx#L1291), core titles in [src/platform/clientMap/types.ts:24](../../../../src/platform/clientMap/types.ts#L24).
    - **Why it costs more than it gives:** The rail is a navigation tool, not a document outline. Long labels make the rail feel heavier.
    - **Concrete simplification:** Keep current section titles in exports and full headings, but allow shorter rail labels.
    - **Copy rewrite:** `Money and accounts` -> `Money`; `Follow-ups` stays; `What I'm missing` -> `Missing`.
    - **Impact:** MED

20. **Reduce repeated assumption labels inside the assumptions section**
    - **What / where:** Item-level `assuming` label in `ItemRow`, [src/features/matters/ClientMapPanel.tsx:362](../../../../src/features/matters/ClientMapPanel.tsx#L362), and Missing assumptions heading, [src/features/matters/ClientMapPanel.tsx:858](../../../../src/features/matters/ClientMapPanel.tsx#L858).
    - **Why it costs more than it gives:** Inside the `Working assumptions` group, every row can still say `assuming`. The heading already explains it.
    - **Concrete simplification:** Suppress the per-row `assuming` label only inside the assumptions group. Keep it in normal sections, where it is a trust marker.
    - **Copy rewrite:** `Working assumptions` -> `Assumptions`.
    - **Impact:** MED

21. **Make voice profiles a compact privacy row**
    - **What / where:** `VoiceprintsCard`, [src/features/matters/VoiceprintsCard.tsx:32](../../../../src/features/matters/VoiceprintsCard.tsx#L32), mounted in `MatterHub` at [src/features/matters/MatterHub.tsx:702](../../../../src/features/matters/MatterHub.tsx#L702).
    - **Why it costs more than it gives:** Voice profiles are important trust data, but the raised card and paragraph sit after the map as another content block.
    - **Concrete simplification:** Render as a compact row: `Voice profiles` + count + `Manage`. Open details in a popover or panel. Keep delete confirmation.
    - **Copy rewrite:** `Stored only on this computer. Used to recognize who is speaking in this client's meeting recordings.` -> `Stored on this computer.`
    - **Impact:** MED

22. **Remove duplicate Wealthbox approval reassurance**
    - **What / where:** Expanded `CrmWriteReviewCard`, [src/features/matters/CrmWriteReviewCard.tsx:349](../../../../src/features/matters/CrmWriteReviewCard.tsx#L349) and footer note at [src/features/matters/CrmWriteReviewCard.tsx:456](../../../../src/features/matters/CrmWriteReviewCard.tsx#L456).
    - **Why it costs more than it gives:** `Nothing sends until you approve` appears in the header, and `Nothing is written to Wealthbox until you approve.` appears again near the button.
    - **Concrete simplification:** Keep one reassurance near the action button, where risk is highest. Remove the header subtitle.
    - **Copy rewrite:** `Nothing is written to Wealthbox until you approve.` -> `Approve to send to Wealthbox.`
    - **Impact:** MED

23. **Make Client Questions row actions icon-only**
    - **What / where:** `ClientQuestionsList`, copy/remove controls, [src/features/matters/ClientQuestionsList.tsx:51](../../../../src/features/matters/ClientQuestionsList.tsx#L51) and [src/features/matters/ClientQuestionsList.tsx:72](../../../../src/features/matters/ClientQuestionsList.tsx#L72).
    - **Why it costs more than it gives:** `Copy all` and `Remove` are repeated utility labels. They are useful, but not worth much text.
    - **Concrete simplification:** Use copy and X/trash icons with tooltips. Keep `Copied` as a short toast or temporary tooltip.
    - **Copy rewrite:** `Copy all` -> tooltip `Copy questions`; `Remove` -> tooltip `Remove`.
    - **Impact:** LOW

24. **Keep build and empty states shorter**
    - **What / where:** Client Map build states in `MatterHub`, [src/features/matters/MatterHub.tsx:603](../../../../src/features/matters/MatterHub.tsx#L603), strings in [src/locales/en.json:1331](../../../../src/locales/en.json#L1331).
    - **Why it costs more than it gives:** These only show off the happy path, so they should be brief and calm.
    - **Concrete simplification:** Shorten the labels without changing behavior.
    - **Copy rewrite:** `Building client map...` -> `Building map...`; `No information found yet. Add documents or email to this client first.` -> `Add documents or email to build this map.`
    - **Impact:** LOW

25. **Keep the History slide panel title simpler**
    - **What / where:** `SlidePanel` title in `MatterHub`, [src/features/matters/MatterHub.tsx:739](../../../../src/features/matters/MatterHub.tsx#L739), strings in [src/locales/en.json:1313](../../../../src/locales/en.json#L1313).
    - **Why it costs more than it gives:** The clock icon plus `History` title is enough. `Close history panel` is only for assistive text, but the phrase is long.
    - **Concrete simplification:** Keep the panel. Use shorter accessible close text.
    - **Copy rewrite:** `Close history panel` -> `Close history`.
    - **Impact:** LOW

## 3. Do Not Touch

- **Egress indicator:** Keep the AI/data-leaving status visible in the header. It is mounted at [src/features/matters/MatterHub.tsx:562](../../../../src/features/matters/MatterHub.tsx#L562). It can be visually quiet, but not hidden.
- **Isolated and sample badges:** Keep `Isolated` and `Sample` visible when present, at [src/features/matters/MatterHub.tsx:551](../../../../src/features/matters/MatterHub.tsx#L551). They prevent trust mistakes.
- **Source chips on facts:** Keep inline source chips in `ItemRow`, [src/features/matters/ClientMapPanel.tsx:370](../../../../src/features/matters/ClientMapPanel.tsx#L370). They are the fastest proof that the map is cited.
- **Citation verification state:** Keep source verification in `SourcePanel`, [src/features/ask/SourcePanel.tsx:302](../../../../src/features/ask/SourcePanel.tsx#L302). The words can be shorter, but the trust signal must remain.
- **Coverage caveat:** Do not remove the Missing panel caveat entirely. It protects against over-trusting an incomplete file set. Shorten it instead.
- **Review-gated Wealthbox sends:** Keep the approval gate and selected rows in `CrmWriteReviewCard`, [src/features/matters/CrmWriteReviewCard.tsx:451](../../../../src/features/matters/CrmWriteReviewCard.tsx#L451). The UI can be calmer, but nothing should send automatically.
- **Compliance note toggle:** Keep `Also file a compliance note`, [src/features/matters/CrmWriteReviewCard.tsx:423](../../../../src/features/matters/CrmWriteReviewCard.tsx#L423). It is supervisory/legal context, not decoration.
- **Voice profile deletion and confirmation:** Keep delete and confirmation in `VoiceprintsCard`, [src/features/matters/VoiceprintsCard.tsx:42](../../../../src/features/matters/VoiceprintsCard.tsx#L42). Voice data is sensitive.
- **History capability:** Fold history, but do not remove it. Manual edits and automatic updates need a trail.
- **Matter/client wording facade:** Keep user-facing language as client/household. Do not expose internal `matter` wording in the UI.
