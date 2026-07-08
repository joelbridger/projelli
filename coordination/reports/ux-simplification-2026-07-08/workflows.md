# Workflows UX Simplification Audit

## Screen Summary

1. Workflows is a two-pane library: a left rail with the Workflows header, search field, practice filter chips, and template rows.
2. The selected template detail repeats the category, title, long description, AI egress pill, Run button, step list, recent runs, count badges, and category note.
3. Starting a workflow opens a run tab with another header, progress bar, status pill, step list, answer history, question form, generation state, final output, export buttons, file links, and chain suggestions.
4. The screen also has stacked warning states: trial ended, no client, no AI provider, local AI offline, run record save warning, another workflow running, and no search matches.
5. The core value is clear, but the experience feels more like a manual than a launch pad because many labels, descriptions, pills, borders, and helper texts repeat information the layout already shows.

## Recommendations

1. **Condense practice filters into one filter control.**
   - **Where:** `WorkflowRailHeader`, `src/features/workflows/AssociateHome.tsx:188-257`; strings in `src/locales/en.json:442-445`; category labels in `src/features/workflows/AssociateHome.tsx:88-98`.
   - **Why it costs more than it gives:** The filter chips wrap inside a narrow 284px rail. That turns the top of the screen into controls before the user even sees workflows. The row also repeats category information already shown inside each rail row and the detail pane.
   - **Simplification:** Keep search visible. Replace the chip row with one compact dropdown beside or below search: `All workflows`, `Legal`, `Tax`, `Consulting`, `Advisors`, `Research`, `Analysis`, `Planning`, `Kickoff`, `Custom`. Keep the same filter function inside the dropdown. Exact copy: `All` -> `All workflows`; `Legal Practice` -> `Legal`; `Practice filters` -> `Filter workflows`.
   - **Impact:** HIGH

2. **Remove the category line from each rail row.**
   - **Where:** `WorkflowRailRow`, `src/features/workflows/AssociateHome.tsx:260-292`, especially the category label at `280-283`.
   - **Why it costs more than it gives:** Every row spends a second line on category, but the user is already filtering by category and the detail pane shows category again at `413`. The repeated category line makes the rail taller and slower to scan.
   - **Simplification:** Rail rows should show template name only, plus a small running spinner or a small star if featured. If category is needed in the All view, show it only on hover/title or as a section divider, not on every row.
   - **Impact:** HIGH

3. **Shorten template descriptions and show the long version only on demand.**
   - **Where:** Detail header at `src/features/workflows/AssociateHome.tsx:411-419`; modal cards at `src/features/workflows/WorkflowPanel.tsx:615-617`; template text examples at `MeetingPrepAndSuitabilityNotes.ts:147-148`, `AnnualReviewPacket.ts:162-163`, and `DepositionContradictionFinder.ts:105-106`.
   - **Why it costs more than it gives:** Many descriptions are full sales blurbs. They explain every output instead of helping the user choose quickly.
   - **Simplification:** Use one short sentence by default and fold the full description into `Details`. Exact rewrites:
     - `Generates a complete pre-meeting briefing package: a client snapshot, last-meeting recap, current concerns summary, suitability checklist stub, and suggested talking points, all in one advisor working document.` -> `Build a pre-meeting brief with client snapshot, recap, suitability prompts, and talking points.`
     - `Generates a complete annual review document set: a personalized cover letter recapping the year's events and plan changes, a comprehensive review checklist of items to cover, and a narrative plan changes summary for the client file.` -> `Draft an annual review packet: cover letter, checklist, and plan-change summary.`
     - `Flag candidate contradictions between a witness's deposition testimony and the rest of the client record (other documents, emails, prior statements). Grounded in client-scoped retrieval; every finding carries a citation you verify. Produces a structured Word deliverable.` -> `Find cited candidate contradictions in a deposition and client record for attorney review.`
   - **Impact:** HIGH

4. **Merge the three summary badges into one quiet metadata row.**
   - **Where:** `WorkflowDetail` aside, `src/features/workflows/AssociateHome.tsx:512-529`; strings at `src/locales/en.json:459-462`.
   - **Why it costs more than it gives:** `2 steps`, `7 required inputs`, and `1 outputs` are useful metadata, but three full badge rows look as important as the Run button. The category note below them is mostly explanatory filler.
   - **Simplification:** Replace the aside with a single line under the title or above Steps: `2 steps · 7 inputs · 1 output`. Fold the category description into a collapsed `Details` row. Exact copy: `{{count}} required inputs` -> `{{count}} inputs`; `{{count}} outputs` -> `{{count}} outputs`; fix singular forms if possible.
   - **Impact:** HIGH

5. **Make the Run button the only strong action in the detail header.**
   - **Where:** Detail header action stack, `src/features/workflows/AssociateHome.tsx:421-435`.
   - **Why it costs more than it gives:** The egress pill and Run button are both in the action stack, while metadata badges sit nearby. The eye has to decide what matters.
   - **Simplification:** Keep the egress pill visible, but make Run the only primary-looking action. Place egress as a small status line above Run or inline with the header title. Do not move egress into a menu.
   - **Impact:** HIGH

6. **Collapse step descriptions by default.**
   - **Where:** Steps section, `src/features/workflows/AssociateHome.tsx:452-486`; step descriptions in templates, for example `MeetingPrepAndSuitabilityNotes.ts:157-167` and `DepositionContradictionFinder.ts:115-125`.
   - **Why it costs more than it gives:** The step names already say the job. Showing every step description by default turns a two-step workflow into a reading task.
   - **Simplification:** Default to a compact numbered list with step names only. Reveal the step description when the user expands a step or hovers. Keep the `Steps` heading, but remove the border under every row unless there are many steps.
   - **Impact:** HIGH

7. **Simplify the run tab header and hide duplicate template copy.**
   - **Where:** `WorkflowExecutionTab`, `src/features/workflows/WorkflowExecutionTab.tsx:351-401`.
   - **Why it costs more than it gives:** After choosing a workflow, the run tab repeats the template name, description, progress bar, and status pill. The status pill already says the current step.
   - **Simplification:** Use a compact sticky header: `Template name · Step 1 of 2`, a slim progress bar, and Cancel only while running. Remove the template description from the run tab header. Exact copy: `Running step {{current}} of {{total}}` -> `Step {{current}}/{{total}}`.
   - **Impact:** HIGH

8. **Show only the current step during a run, with all steps tucked under disclosure.**
   - **Where:** Run-tab step list, `src/features/workflows/WorkflowExecutionTab.tsx:403-438`.
   - **Why it costs more than it gives:** The full step list repeats the detail page and stays visible even when the user needs to answer questions or wait for generation.
   - **Simplification:** Default state should show the current step row only. Add `Show all steps` as a small disclosure. Keep complete/failed icons inside the expanded view.
   - **Impact:** HIGH

9. **Remove card-inside-card from interview questions.**
   - **Where:** Outer current-input card at `src/features/workflows/WorkflowExecutionTab.tsx:461-477`; each question card in `src/features/workflows/InterviewForm.tsx:80-199`.
   - **Why it costs more than it gives:** The screen puts the current interview inside an amber card, then wraps every field in another card. It makes normal form fields feel like separate panels.
   - **Simplification:** Keep one outer `Your input needed` area. Inside it, render questions as simple field rows: label, optional helper text, input. Keep validation and required behavior. Exact copy: `Your input needed: Client & Meeting Information` -> `Answer these questions`.
   - **Impact:** HIGH

10. **Unify run-blocking messages into one short pattern.**
   - **Where:** Workflows home callouts at `src/features/workflows/AssociateHome.tsx:821-887`; run-tab blocked state at `src/features/workflows/WorkflowExecutionTab.tsx:287-342`; legacy panel banner at `src/features/workflows/WorkflowPanel.tsx:248-273`; strings at `src/locales/en.json:451-488`.
   - **Why it costs more than it gives:** The same problems appear in different layouts and with different wording. It feels like the app is explaining itself from scratch each time.
   - **Simplification:** Use one compact warning pattern on the Workflows home, and the same copy in the run tab if the tab opens. Exact rewrites:
     - `Trial ended. Activate a license to run workflows. Your work is still here and fully accessible.` -> `Trial ended. Your files are still here. Activate a license to run workflows.`
     - `I can't run this workflow yet` -> `Add an AI provider`
     - `No AI provider is set up. Add a provider key in Settings, or pick your local model.` -> `Add an API key or choose Local AI.`
     - `Another workflow is running. Finish or stop that run before starting a different workflow.` -> `Finish or stop the current run first.`
   - **Impact:** HIGH

11. **Make live progress inline instead of a separate bordered card.**
   - **Where:** `WorkflowProgress`, `src/features/workflows/AssociateHome.tsx:294-327`; shown from `WorkflowDetail` at `441`.
   - **Why it costs more than it gives:** `Live run`, spinner, step text, border, soft background, and progress bar all say one thing: running. The bordered card adds another box to the page.
   - **Simplification:** Show a thin progress strip under the detail header or directly under the Run button: `Running · Step 1/2`. Keep the bar and spinner, remove the bordered container. Exact copy: `Live run` -> `Running`.
   - **Impact:** MED

12. **Turn `Start here` into a star-only cue with a tooltip.**
   - **Where:** `WorkflowRailRow`, `src/features/workflows/AssociateHome.tsx:284-287`; string at `src/locales/en.json:446`.
   - **Why it costs more than it gives:** The label is helpful once, but it adds a bright pill inside the narrow rail. It competes with the workflow name.
   - **Simplification:** Keep the featured idea. Replace the text badge with a small star icon after the template name and tooltip `Start here`. The selected detail page can still explain why it is recommended if needed.
   - **Impact:** MED

13. **Move global Recent runs out of the selected-template detail body.**
   - **Where:** `WorkflowDetail`, `src/features/workflows/AssociateHome.tsx:488-508`; `RunRow`, `536-634`.
   - **Why it costs more than it gives:** The section appears under whichever template is selected, but it shows the last four runs globally. That can make a selected template look connected to unrelated past runs.
   - **Simplification:** Put `Recent runs` in the rail footer, a top-level `...` menu, or a collapsed `Recent` section under the search/filter controls. If it stays in detail, filter it to the selected template.
   - **Impact:** MED

14. **Simplify the no-results state to one place.**
   - **Where:** Rail empty one-liner at `src/features/workflows/AssociateHome.tsx:812-816`; main empty state at `905-916`; strings at `src/locales/en.json:465-467`.
   - **Why it costs more than it gives:** Empty search can show both a rail-level empty line and a large main empty state. Two messages explain the same problem.
   - **Simplification:** Keep the main empty state only. Leave the rail blank or show no rows. Exact copy: `No workflows match` -> `No matches`; `Try a different search term, or clear the filter to see all workflows.` -> `Clear search to see all workflows.`
   - **Impact:** MED

15. **Fold duplicate/delete template actions into a `...` menu.**
   - **Where:** Legacy workflow cards at `src/features/workflows/WorkflowPanel.tsx:898-961`; full-view modal actions at `619-657`.
   - **Why it costs more than it gives:** Duplicate and delete are secondary actions, but in the legacy picker they sit next to Run on every template. That violates the one-primary-action rule.
   - **Simplification:** Leave Run visible. Put `Duplicate` and `Delete` behind the standard `...` row menu. Delete should only appear for custom templates. Keep tooltips and accessible labels.
   - **Impact:** MED

16. **Fold chain building into the same advanced menu pattern.**
   - **Where:** Legacy panel chain icon at `src/features/workflows/WorkflowPanel.tsx:281-291`; `ChainBuilderModal` at `src/features/workflows/ChainBuilderModal.tsx:106-190`; strings at `src/locales/en.json:432-436`.
   - **Why it costs more than it gives:** A link icon in the Workflows header is not obvious, and chain building is advanced. Showing it beside the main browse action makes the screen feel more complex.
   - **Simplification:** Put it under a `+` or `...` menu as `New chain`. Exact copy: `Chain templates` -> `New chain`; `Run a sequence of templates. Each step can pull fields from an earlier step's output into its inputs.` -> `Run templates in order, using one output as the next input.`
   - **Impact:** MED

17. **Shorten the start-confirmation cost modal.**
   - **Where:** `WorkflowEstimateModal`, `src/features/workflows/WorkflowPanel.tsx:441-520`.
   - **Why it costs more than it gives:** The modal is useful, but it currently feels like a small receipt plus a paragraph every time the user runs something.
   - **Simplification:** Keep the trust information, but compress it into one line: `2 steps · 1 AI call · est. $0.012-$0.036`. Add a `Details` disclosure for the billing explanation. Exact copy: `This is a rough estimate based on typical step sizes. Your actual cost depends on the length of your inputs and the model you have selected. Billed directly by your AI provider.` -> `Estimate only. Your AI provider bills the actual cost.` Button `Run workflow` -> `Run`.
   - **Impact:** MED

18. **Make chain suggestions a single action, not a button cluster.**
   - **Where:** `ChainSuggestions`, `src/features/workflows/WorkflowExecutionTab.tsx:693-745`; strings at `src/locales/en.json:480-482`.
   - **Why it costs more than it gives:** After a completed workflow, the user is likely looking for the result. A cluster of next-workflow buttons can pull attention away from the deliverable.
   - **Simplification:** Default to one button: `Use output in another workflow`. Open a picker when clicked. Hide `Recommended next steps` and `Other templates` until the picker opens. Exact copy: `Use this as input for another template` -> `Use output in another workflow`; `Other templates (manual mapping required)` -> `More workflows`.
   - **Impact:** MED

19. **Make the final result a document-ready state, not a raw text preview first.**
   - **Where:** Final output and created files, `src/features/workflows/WorkflowExecutionTab.tsx:552-651`.
   - **Why it costs more than it gives:** The screen can show a large raw text block, export buttons, and created file links at the same time. That is too much after a workflow finishes.
   - **Simplification:** If a file exists, lead with `Draft ready` and one `Open` action. Put raw text behind `Preview text`. Put secondary exports in a `...` menu. Exact copy: `Generated Output` -> `Draft ready`; `Created Files ({{count}})` -> `Created file`; `Save as file` -> `Save`.
   - **Impact:** MED

20. **Move the firm-name field into the export flow.**
   - **Where:** `WorkflowExecutionTab`, `src/features/workflows/WorkflowExecutionTab.tsx:565-577`.
   - **Why it costs more than it gives:** `Firm name (optional)` appears inside the completed result even if the user only wants to read or open the file. It is setup, not result content.
   - **Simplification:** Show the field only when the user clicks `Export .docx`, either in a small popover or modal. Exact copy: `Firm name (optional):` -> `Firm name`; placeholder `e.g. Acme Law PLLC` can stay.
   - **Impact:** MED

21. **Shorten provider and browser-copy labels where this screen touches them.**
   - **Where:** Workflow strings at `src/locales/en.json:476-488`; browser error strings at `427-430` if browser tabs are opened from workflow outputs.
   - **Why it costs more than it gives:** Several labels read like support text. They are accurate, but they slow down quick recovery.
   - **Simplification:** Exact rewrites:
     - `Open AI Settings` -> `Open AI settings`
     - `Ollama isn't running` -> `Local AI is offline`
     - `This template is pinned to your local model and I won't send it to the cloud. Start Ollama, then try again.` -> `This workflow uses Local AI only. Start Local AI, then try again.`
     - `Open in External Browser` -> `Open in browser`
   - **Impact:** LOW

22. **Remove ellipses from search placeholders.**
   - **Where:** Workflows search string, `src/locales/en.json:443`; modal placeholder at `src/features/workflows/WorkflowPanel.tsx:575`; marketplace template search at `src/features/workflows/marketplace/TemplatesTab.tsx:312`.
   - **Why it costs more than it gives:** Ellipses add visual noise and do not change meaning.
   - **Simplification:** Exact rewrites: `Search workflows...` -> `Search workflows`; `Search templates...` -> `Search templates`; `Enter URL or search term...` -> `Search or enter URL`.
   - **Impact:** LOW

23. **If the legacy full-view modal remains, make it a true picker, not another card gallery.**
   - **Where:** `WorkflowsFullViewModal`, `src/features/workflows/WorkflowPanel.tsx:555-663`; strings at `src/locales/en.json:494-496`.
   - **Why it costs more than it gives:** `All workflows` duplicates the main Workflows home. The modal repeats title, description, search, card grid, Start, Duplicate, and Delete.
   - **Simplification:** In the legacy narrow panel, make `Open full view` open the current full Workflows surface or a simple searchable list. Exact copy: `All workflows` -> `Browse workflows`; `Pre-built AI workflows for your practice. Pick one to start a guided conversation.` -> `Pick a workflow to run.`
   - **Impact:** LOW

24. **Use sentence case and shorter labels in old/custom-template modals.**
   - **Where:** `TemplateForkModalFields`, `src/features/workflows/WorkflowPanel.tsx:717-778`; strings at `src/locales/en.json:498-501`; `ChainBuilderModal`, `src/features/workflows/ChainBuilderModal.tsx:120-187`.
   - **Why it costs more than it gives:** These modals explain internal ideas like "system prompt" and "persona." That is useful for power users, but it is intimidating in the normal Workflows flow.
   - **Simplification:** Keep the capability, but make it feel like editing a template. Exact rewrites: `Duplicate template` -> `Copy template`; `Create your own copy of this template. You can edit the system prompt that steers the AI while the workflow runs.` -> `Make an editable copy of this template.`; `System prompt` -> `AI instructions`; `This is the persona the AI uses in the first generation step. Leave it blank to fall back to the model's default persona.` -> `Optional instructions for how the AI should write.`
   - **Impact:** LOW

## Do Not Touch

- **Keep the egress indicator visible.** `EgressIndicator` in `WorkflowDetail`, `src/features/workflows/AssociateHome.tsx:422-427`, is a trust signal. It can be quieter, but not hidden in a menu.
- **Keep client/provider/local-AI blockers visible.** The no-client, no-provider, and local-AI-offline states at `src/features/workflows/AssociateHome.tsx:833-874` and `src/features/workflows/WorkflowExecutionTab.tsx:287-342` prevent silent failures and protect local-only intent.
- **Keep the trial/access warning visible when locked.** The trial banner at `src/features/workflows/AssociateHome.tsx:821-830` explains why Run is disabled without making the user's files feel gone.
- **Keep verification warnings for regulated work.** The verification banner at `src/features/workflows/WorkflowExecutionTab.tsx:508-518` is load-bearing for legal, tax, and advisor outputs.
- **Keep verified/unverified counts for analysis outputs.** The analyze summary at `src/features/workflows/WorkflowExecutionTab.tsx:520-550` tells the user what needs review. It can be shorter, but the review signal should stay.
- **Keep created-file links easy to see.** File links at `src/features/workflows/WorkflowExecutionTab.tsx:629-651` are the bridge from "workflow ran" to "real document exists."
- **Keep missing-artifact status in recent runs.** `RunRow` uses a warning icon and `File missing` at `src/features/workflows/AssociateHome.tsx:548-559` and `619`; that prevents dead-click confusion.
- **Keep the client wording facade.** User-facing copy should keep saying `client`, not `matter`, even though the engine still uses matter IDs internally.
