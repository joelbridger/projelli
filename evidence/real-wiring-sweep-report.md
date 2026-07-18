# Real-wiring sweep — evidence report

**Tip under test:** `8118b12cca5f05892e1418c254818268795694e8`  
**Scope:** real Chromium browser at `http://127.0.0.1:5212`, not test mode and not a component mount. Chromium used `--password-store=basic` with disposable profile `/tmp/lantern-real-wiring-chrome-profile-live`. Runtime feature flags were enabled only through the sanctioned development override, `localStorage['lantern:feature-flags']`; `home-surface-v1` was deliberately switched off so the registered CRM shell, rather than the replacement Home screen, owned the real Home doorway.

## Bench record

- Attempt 1 stopped before Chromium: this worktree had no installed dependency tree, so Vite's normal asset-copy step could not find `pdfjs-dist`.
- Attempt 2 exposed runner child-process cleanup before a page could be driven. Its display probe is retained.
- Live attempt: fresh port **5212** (never 5174), fresh X display **:262** (not :1 or :251), display probes before and after at [before](real-wiring/display-probe-before-live.png) and [end](real-wiring/display-probe-end-before-teardown.png). The display was alive at both probes.
- Browser-host setup required the normal browser-only workspace bootstrap: the real first-run dialog has no usable folder-picker result in this headless environment. I set a disposable root-path state, then dismissed the real dialog and navigated with the actual shell controls. This is a host setup limitation, not a substituted component host.

## Whole-tree registry scan (derivation bind)

The scan at this tip found: `commandRegistry`, `navigationTargetRegistry`, `appSurfaceRegistry`, `clientContextAdapterRegistry`, `accountSectionRegistry`, `connectionCardRegistry`, `askRegistries`, `auditActionRegistry`, `bookingPageRegistry`, `calendarGridViewRegistry`, `projectionRegistry`, `directoryRegistry`, `recordRegistry`, `tabRegistry`, `workflowExtensionRegistry`, `taskExtensionRegistry`, `activityToolRegistry`, `pipelineExtensionRegistry`, `crm-home/registry`, `schedulingSurfaceRegistry`, `settingsModuleRegistry`, `meetingPanelRegistry`, `meetingHeaderActionRegistry`, `meetingInsightRegistry`, `homeWidgetHostRegistry`, `permissionPolicyRegistry`, `egressRegistry`, `docxSaveRegistry`, and their compatibility/legacy lists. The full command used was:

```text
rg --files | rg '(^|/)[^/]*([Rr]egistry|[Rr]egistries)[^/]*\\.(ts|tsx)$' | sort
```

Technical-only registries (filesystem save handlers, projection/adapters, permissions/policy, privacy egress, flags, and test files) do not create a user-operable doorway and are recorded here as exclusions. The user-facing lists actually mounted by this browser run are below. File/line locations refer to the registering list at this tip.

## Results

### CRM Home surface registry — `src/features/crm-home/registry.ts:49`

All of these were driven by the real `v1-shell-nav-home` control, then their actual `crm-shell-nav-<route>` control. The route became the selected destination and rendered its own non-empty surface. Flags were enabled through the sanctioned override where the descriptor has one.

| Doorway | Flag | Verdict | Proof |
|---|---|---|---|
| activity | `team-activity-feed` | LIVE | [shot](real-wiring/crm-home/activity.png) |
| calendar | `calendar-write` | LIVE | [shot](real-wiring/crm-home/calendar.png) |
| email-broadcast | none | LIVE | [shot](real-wiring/crm-home/email-broadcast.png) |
| email | none | LIVE | [shot](real-wiring/crm-home/email.png) |
| email-dropbox | none | LIVE | [shot](real-wiring/crm-home/email-dropbox.png) |
| internal-projects | `internal-projects` | LIVE | [shot](real-wiring/crm-home/internal-projects.png) |
| firm-setup | none | LIVE | [shot](real-wiring/crm-home/firm-setup.png) |
| pipeline | none | LIVE | [shot](real-wiring/crm-home/pipeline.png) |
| projects | none | LIVE | [shot](real-wiring/crm-home/projects.png) |
| form-activity | `form-activity` | LIVE | [shot](real-wiring/crm-home/form-activity.png) |
| reports | none | LIVE | [shot](real-wiring/crm-home/reports.png) |
| search | none | LIVE | [shot](real-wiring/crm-home/search.png) |
| tasks | none | LIVE | [shot](real-wiring/crm-home/tasks.png) |
| today | none | LIVE | [shot](real-wiring/crm-home/today.png) |
| views | none | LIVE | [shot](real-wiring/crm-home/views.png) |
| workflows | none | LIVE | [shot](real-wiring/crm-home/workflows.png) |
| trash | `crm-trash-recovery` | LIVE | [shot](real-wiring/crm-home/trash.png) |

The same registry also contains non-rail routes `archive-export`, `attachment-accounting`, `fidelity`, `migration`, `pipeline-settings`, `propagation`, `rollback-export`, and `workflow-recreation`. In this browser-host run no registered rail or rendered action exposed those routes. **UNREACHABLE**: open Home → CRM and inspect the complete real CRM rail; no control for these registry entries is rendered. This is a precise hollow-doorway risk, not a claim that their components are dead.

### Directory registry — `src/features/crm-clients/directoryRegistry.tsx:270` and compatibility list `directoryRegistryCompatibility.tsx:44`

Drive path for every row: actual `v1-shell-nav-matters` → actual Clients directory host. The real host is captured [here](real-wiring/directory/host.png).

| Doorway | Flag | Verdict | Proof / observed effect |
|---|---|---|---|
| view-switch | none | LIVE | [shot](real-wiring/directory/view-switch.png): Whole book selected |
| tab-switch | none | LIVE | [shot](real-wiring/directory/tab-switch.png): People selected |
| search | none | LIVE | [shot](real-wiring/directory/search.png): query field accepted text; empty directory means no row delta |
| external-filter | none | LIVE | [shot](real-wiring/directory/external-filter.png): filter toggled |
| verification-filter | none | LIVE | [shot](real-wiring/directory/verification-filter.png): checkbox/button state toggled; no records to alter |
| create-household | none | LIVE | [shot](real-wiring/directory/create-household.png): real create form opened |
| bulk-select | `crm-bulk-select` | LIVE | [shot](real-wiring/directory/bulk-select.png): selection controls mounted; zero-record state leaves count at zero |
| duplicates | `crm-duplicates` | LIVE | [shot](real-wiring/directory/duplicates.png): duplicate tool opened |
| advisor-filters | `crm-advisor-filters` | LIVE | [shot](real-wiring/directory/advisor-filters.png): filter rail opened |
| tags rail | `crm-tags-rail` | LIVE | [shot](real-wiring/directory/tags-rail.png): tags rail opened |
| sort | `crm-list-sort` | LIVE | [shot](real-wiring/directory/sort.png): selected sort value changed |
| bulk export | `crm-bulk-export` | LIVE | [shot](real-wiring/directory/bulk-export.png): heading checkbox toggled; export correctly remains disabled at zero rows |
| contact table density | `crm-contact-table` | LIVE | [shot](real-wiring/directory/contact-table-density.png): compact/comfortable row mode changed |
| contact table add household | `crm-contact-table` | LIVE | [shot](real-wiring/directory/contact-table-add-household.png): real create form opened |
| person-details rail | none | UNREACHABLE | Needs a person record. Repro: Clients → People; this clean browser host has no person row to select. |

### Task extension registry — `src/features/crm-tasks/taskExtensionRegistry.tsx:126`, compatibility list `taskExtensionRegistryCompatibility.tsx:50`

Drive path: actual Home → CRM → Tasks. The host is [here](real-wiring/tasks/host.png).

| Doorway | Flag | Verdict | Proof / repro |
|---|---|---|---|
| legacy.blank-task | none | LIVE | [shot](real-wiring/tasks/legacy-blank-task.png): task detail opened through New task |
| task-create-v1 | `task-create-v1` | LIVE | [shot](real-wiring/tasks/task-create-v1.png): create template opened |
| task-templates | `task-templates` | LIVE | [shot](real-wiring/tasks/task-templates.png): template library opened |
| capacity-triage | `task-capacity-triage` | UNREACHABLE | After template-library opening, its modal blocks the host’s remaining action controls; this run did not find a rendered close control that returned the host. Repro: Home → CRM → Tasks → Task templates → then try Plan work. |
| legacy.core-fields | none | LIVE | [shot](real-wiring/tasks/legacy-blank-task.png): fields render in real task detail |
| task-attachments | `task-attachments` | LIVE | [shot](real-wiring/tasks/legacy-blank-task.png): Attachments block renders in real task detail |
| legacy.save-view | none | UNREACHABLE | Same blocked-host repro above. |

## Counts

- **LIVE: 34**
- **DEAD: 0 confirmed**
- **UNREACHABLE: 15** (8 non-rail CRM routes, directory person rail without a record, and six task follow-on controls blocked by template-modal state)

No control was marked DEAD merely because the empty clean host had no records to filter, select, export, or sort. Those controls have a recorded real UI state change instead.

## Exact dead/unreachable repro list

No confirmed DEAD doorway was found. Every UNREACHABLE item is listed above with its exact real-host path. The highest-value follow-up is to seed one disposable household/person through a real creation path, then re-run the directory person rail and all client-dependent CRM routes; the second is to expose or repair the real route/action path for the eight CRM registry descriptors that have no rendered rail/action doorway.
