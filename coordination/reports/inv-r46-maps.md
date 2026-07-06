codex
I stayed read-only. I only inspected files.

**R4: Client Map**
- Main UI: `src/features/matters/ClientMapPanel.tsx:439` renders each Client Map section. Bullet rows are `ItemRow` at `:274`; edit button is `:319`; section delete is `:488` and currently has no confirmation.
- Store/edit path: `src/platform/clientMap/clientMapStore.ts:305` edits bullets, `:323` removes bullets, `:332` adds user bullets, `:364` removes sections. These are the right central places to record “who / what / when”.
- Audit hook: `src/platform/clientMap/clientMapStore.ts:505` already emits an audit entry for resolved gaps. Reuse that pattern with new audit event types in `src/platform/types/audit.ts:10`.
- Sync + last updated: `src/features/matters/MatterHub.tsx:321` is the header area beside the client name. Add a sync icon there. Use `useClientMap.ts:132` `checkForUpdates()`, but if no map exists, call `generate()` instead because `checkForUpdates()` exits early at `:136`.
- Source click path: `src/features/matters/clientMap/openSource.ts:71` already routes source references. Document opening is at `:170`.

**R4 export**
- Word engine exists: `src/platform/utils/docx-io.ts:193` builds `.docx`; `:923` turns markdown into Word bytes; `:1353` applies firm letterhead if configured.
- Native Word/PDF bridge exists: `src/platform/utils/docx-commands.ts:461` converts docx to PDF; `:478` applies letterhead.
- Existing workflow docx output exists: `src/features/workflows/engine/WorkflowEngine.ts:612` creates `.docx` from markdown and applies letterhead.
- Cleanest export path: render Client Map as semantic markdown or HTML, then use `markdownToDocxBytes(...)`, then `applyLetterheadIfConfigured(...)`. For PDF, create the docx first and convert it with `docxConvertToPdf(...)`.
- Risk: screen styling will not copy perfectly into Word. This should be a proper document layout, not a screenshot of the UI.

**R6: Workflows**
- Main workflow home: `src/features/workflows/AssociateHome.tsx:548` holds the pending “Run workflow” confirmation. The modal itself is `:898`. Remove this for R6.
- Question form: `src/features/workflows/InterviewForm.tsx:26` reads defaults, `:51` validates, `:180` says “Continue”. Add client-name defaults, scroll to the first missing answer, and change the button to “Run”.
- Dialog location: `src/app/shell/AppDialogs.tsx:242` renders the question form. The runner feeds those questions from `src/app/workflow/useWorkflowRunner.ts:526`.
- Run-state pill: current execution UI is mostly in `src/features/workflows/WorkflowExecutionTab.tsx:365`. Add a clear non-clickable running pill there, with the existing spinner pattern from `:404`.
- Recent Runs: `src/features/workflows/AssociateHome.tsx:659` gets recent runs; `:838` renders them. Right now rows only focus the execution tab, not the produced document.
- Output save path: `src/app/workflow/useWorkflowRunner.ts:147` currently saves workflow folders at workspace root. Actual files are written at `:475` and `.docx` files at `:503`. For R6, move this under the active client’s Documents → Workflows folder.
- Workflow-produced Word docs: `src/features/workflows/engine/WorkflowEngine.ts:612` already supports `.docx` output. Advisor templates currently output markdown, for example `src/features/workflows/templates/advisorTemplates.ts:156`.

**Recommended implementation order**
1. Add Client Map edit history in the store first, then wire UI buttons/modals to it.
2. Add sync button and last-updated text in `MatterHub`.
3. Add Client Map export using the existing docx pipeline, then PDF conversion.
4. Remove workflow run confirmation.
5. Autofill workflow questions and improve missing-answer behavior.
6. Save workflow outputs under the active client and make Recent Runs open the produced doc.

Biggest risk: both rounds touch “where things are saved or recorded.” That means tests should check the paths and audit trail, not just the visible UI.
tokens used
247,817
I stayed read-only. I only inspected files.

**R4: Client Map**
- Main UI: `src/features/matters/ClientMapPanel.tsx:439` renders each Client Map section. Bullet rows are `ItemRow` at `:274`; edit button is `:319`; section delete is `:488` and currently has no confirmation.
- Store/edit path: `src/platform/clientMap/clientMapStore.ts:305` edits bullets, `:323` removes bullets, `:332` adds user bullets, `:364` removes sections. These are the right central places to record “who / what / when”.
- Audit hook: `src/platform/clientMap/clientMapStore.ts:505` already emits an audit entry for resolved gaps. Reuse that pattern with new audit event types in `src/platform/types/audit.ts:10`.
- Sync + last updated: `src/features/matters/MatterHub.tsx:321` is the header area beside the client name. Add a sync icon there. Use `useClientMap.ts:132` `checkForUpdates()`, but if no map exists, call `generate()` instead because `checkForUpdates()` exits early at `:136`.
- Source click path: `src/features/matters/clientMap/openSource.ts:71` already routes source references. Document opening is at `:170`.

**R4 export**
- Word engine exists: `src/platform/utils/docx-io.ts:193` builds `.docx`; `:923` turns markdown into Word bytes; `:1353` applies firm letterhead if configured.
- Native Word/PDF bridge exists: `src/platform/utils/docx-commands.ts:461` converts docx to PDF; `:478` applies letterhead.
- Existing workflow docx output exists: `src/features/workflows/engine/WorkflowEngine.ts:612` creates `.docx` from markdown and applies letterhead.
- Cleanest export path: render Client Map as semantic markdown or HTML, then use `markdownToDocxBytes(...)`, then `applyLetterheadIfConfigured(...)`. For PDF, create the docx first and convert it with `docxConvertToPdf(...)`.
- Risk: screen styling will not copy perfectly into Word. This should be a proper document layout, not a screenshot of the UI.

**R6: Workflows**
- Main workflow home: `src/features/workflows/AssociateHome.tsx:548` holds the pending “Run workflow” confirmation. The modal itself is `:898`. Remove this for R6.
- Question form: `src/features/workflows/InterviewForm.tsx:26` reads defaults, `:51` validates, `:180` says “Continue”. Add client-name defaults, scroll to the first missing answer, and change the button to “Run”.
- Dialog location: `src/app/shell/AppDialogs.tsx:242` renders the question form. The runner feeds those questions from `src/app/workflow/useWorkflowRunner.ts:526`.
- Run-state pill: current execution UI is mostly in `src/features/workflows/WorkflowExecutionTab.tsx:365`. Add a clear non-clickable running pill there, with the existing spinner pattern from `:404`.
- Recent Runs: `src/features/workflows/AssociateHome.tsx:659` gets recent runs; `:838` renders them. Right now rows only focus the execution tab, not the produced document.
- Output save path: `src/app/workflow/useWorkflowRunner.ts:147` currently saves workflow folders at workspace root. Actual files are written at `:475` and `.docx` files at `:503`. For R6, move this under the active client’s Documents → Workflows folder.
- Workflow-produced Word docs: `src/features/workflows/engine/WorkflowEngine.ts:612` already supports `.docx` output. Advisor templates currently output markdown, for example `src/features/workflows/templates/advisorTemplates.ts:156`.

**Recommended implementation order**
1. Add Client Map edit history in the store first, then wire UI buttons/modals to it.
2. Add sync button and last-updated text in `MatterHub`.
3. Add Client Map export using the existing docx pipeline, then PDF conversion.
4. Remove workflow run confirmation.
5. Autofill workflow questions and improve missing-answer behavior.
6. Save workflow outputs under the active client and make Recent Runs open the produced doc.

Biggest risk: both rounds touch “where things are saved or recorded.” That means tests should check the paths and audit trail, not just the visible UI.
