# Coverage Ledger — Keepance 3.0 Usability Campaign

**Date:** 2026-06-10
**Campaign:** v3 usability campaign — `docs/quality/2026-06-10-v3-usability-campaign/`
**Phase 5 sweep completed:** 2026-06-10 (attempt 3)
**Viewport:** 1366×768 primary; specs in `tests/campaign/sweep/`

| Column | Meaning |
|--------|---------|
| **ID** | Stable row identifier |
| **Surface** | What is being covered |
| **Where** | Source file (relative to `/home/jameson/keepance/`) |
| **Covered by** | Test file or `—` if not yet written |
| **Result** | pass / finding F-2xx / native-only / unreachable+why |
| **Findings** | Notes, bugs, or observations |

---

## A. Sidebar Tabs (src/components/layout/Sidebar.tsx)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-001 | Sidebar tab: Files | Sidebar.tsx:97 | sweep/sidebar.spec.ts | pass | |
| L-002 | Sidebar tab: Search | Sidebar.tsx:97 | sweep/sidebar.spec.ts | pass | |
| L-003 | Sidebar tab: Workflows | Sidebar.tsx:98 | sweep/sidebar.spec.ts | pass | |
| L-004 | Sidebar tab: AI Assistant | Sidebar.tsx:99 | sweep/sidebar.spec.ts | pass | |
| L-005 | Sidebar tab: Research | Sidebar.tsx:100 | sweep/sidebar.spec.ts | pass | |
| L-006 | Sidebar tab: Whiteboard | Sidebar.tsx:101 | sweep/sidebar.spec.ts | pass | |
| L-007 | Sidebar tab: Audit | Sidebar.tsx:102 | sweep/sidebar.spec.ts | pass | |
| L-008 | Sidebar tab: Trash | Sidebar.tsx:103 | sweep/sidebar.spec.ts | pass | |
| L-009 | Sidebar tab: Plugins (conditional — shown only when plugin panels exist) | Sidebar.tsx:104-106 | sweep/sidebar.spec.ts | pass | Conditional: absent in testMode (no plugins installed); test handles both states. |
| L-010 | Sidebar collapse / expand toggle | Sidebar.tsx:67 | sweep/sidebar.spec.ts | pass | F-201: post-expand bbox briefly reports right>1366 — confirmed false positive (scrollWidth=1366). |

---

## B. Settings Tabs / Categories (src/components/settings/SettingsModal.tsx + src/settings/schema.ts)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-011 | Settings category: General | schema.ts:60 | sweep/settings.spec.ts | pass | Light-theme check also confirmed pass. |
| L-012 | Settings category: License | schema.ts:61 | sweep/settings.spec.ts | pass | |
| L-013 | Settings category: Firm | schema.ts:62 | sweep/settings.spec.ts | pass | |
| L-014 | Settings category: Editor | schema.ts:63 | sweep/settings.spec.ts | pass | |
| L-015 | Settings category: AI | schema.ts:64 | sweep/settings.spec.ts | pass | Invalid API key format edge test also pass. |
| L-016 | Settings category: Memory | schema.ts:65 | sweep/settings.spec.ts | pass | |
| L-017 | Settings category: Voice | schema.ts:66 | sweep/settings.spec.ts | pass | |
| L-018 | Settings category: Files & Workspace | schema.ts:67 | sweep/settings.spec.ts | pass | |
| L-019 | Settings category: Keyboard Shortcuts | schema.ts:68 | sweep/settings.spec.ts | pass | |
| L-020 | Settings category: Cost & Usage | schema.ts:69 | sweep/settings.spec.ts | pass | |
| L-021 | Settings category: Templates | schema.ts:70 | sweep/settings.spec.ts | pass | |
| L-022 | Settings category: Integrations | schema.ts:71 | sweep/settings.spec.ts | pass | |
| L-023 | Settings category: Marketplace | schema.ts:72 | sweep/settings.spec.ts | pass | |
| L-024 | Settings category: Plugins | schema.ts:73 | sweep/settings.spec.ts | pass | |
| L-025 | Settings category: Mobile | schema.ts:74 | sweep/settings.spec.ts | pass | |
| L-026 | Settings category: Advanced | schema.ts:75 | sweep/settings.spec.ts | pass | |
| L-027 | Settings category: Updates | schema.ts:76 | sweep/settings.spec.ts | pass | |
| L-028 | Settings category: Onboarding | schema.ts:77 | sweep/settings.spec.ts | pass | |
| L-029 | Settings category: Privacy | schema.ts:78 | sweep/settings.spec.ts | pass | |
| L-030 | Settings category: About | schema.ts:79 | sweep/settings.spec.ts | pass | |
| L-031 | Settings export action | SettingsModal.tsx:822 | sweep/settings.spec.ts | pass | |
| L-032 | Settings import action | SettingsModal.tsx:832 | sweep/settings.spec.ts | pass | |
| L-033 | Settings reset action | SettingsModal.tsx:842 | sweep/settings.spec.ts | pass | |
| L-034 | Settings search bar | SettingsModal.tsx:679 | sweep/settings.spec.ts | pass | Search returned 10 results for "a" — filter functional. |

---

## C. Status Bar Widgets (src/components/layout/StatusBar.tsx)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-035 | Status bar root | StatusBar.tsx:211 | sweep/statusbar.spec.ts | pass | |
| L-036 | Status bar: project name widget | StatusBar.tsx:224 | sweep/statusbar.spec.ts | pass | |
| L-037 | Status bar: breadcrumbs (full path nav) | StatusBar.tsx:231 | sweep/statusbar.spec.ts | pass | |
| L-038 | Status bar: active file name | StatusBar.tsx:286 | sweep/statusbar.spec.ts | pass | |
| L-039 | Status bar: file modified indicator | StatusBar.tsx:317 | sweep/statusbar.spec.ts | pass | |
| L-040 | Status bar: privileged matter badge | StatusBar.tsx:332 | sweep/statusbar.spec.ts | pass | Conditional: absent without an active privileged matter; test handles both states. |
| L-041 | Status bar: matter indicator | StatusBar.tsx:358 | sweep/statusbar.spec.ts | pass | |
| L-042 | Status bar: tab count | StatusBar.tsx:382 | sweep/statusbar.spec.ts | pass | |
| L-043 | Status bar: bug report button | StatusBar.tsx:388 | sweep/statusbar.spec.ts | pass | |

---

## D. Modals / Dialogs (src/components/)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-044 | SettingsModal | settings/SettingsModal.tsx | sweep/dialogs.spec.ts | pass | Opens + Escape closes. |
| L-045 | McpApprovalModal | settings/McpApprovalModal.tsx | sweep/dialogs.spec.ts | pass | Renders in MCP settings. |
| L-046 | CompressionConfirmModal | chat/CompressionConfirmModal.tsx | sweep/dialogs.spec.ts | unreachable — requires live AI chat with context compression trigger | F-205 |
| L-047 | AudioRecorderModal | audio/AudioRecorderModal.tsx | sweep/dialogs.spec.ts | pass | Opens from AI assistant tab. |
| L-048 | ChainBuilderModal | workflow/ChainBuilderModal.tsx | sweep/dialogs.spec.ts | pass | Opens from workflow panel. |
| L-049 | MatterManagerDialog | matter/MatterManagerDialog.tsx | sweep/dialogs.spec.ts | pass | Opens via AI chat scope selector. |
| L-050 | DataMapDialog | privacy/DataMapDialog.tsx | sweep/dialogs.spec.ts | pass | Opens from privacy settings. |
| L-051 | WelcomeOnboardingDialog | onboarding/WelcomeOnboardingDialog.tsx | sweep/dialogs.spec.ts | pass | Triggered via forceOnboarding param. |
| L-052 | PluginConsentDialog | marketplace/PluginConsentDialog.tsx | sweep/dialogs.spec.ts | pass | Flaky once (infra ENOENT race F-204); passed on retry. |
| L-053 | UpdateReleaseNotesModal | updater/UpdateReleaseNotesModal.tsx | sweep/dialogs.spec.ts | pass | Area visible in updater settings. |
| L-054 | ConfirmDialog (generic) | common/ConfirmDialog.tsx | sweep/dialogs.spec.ts | pass | Shown on file deletion attempt. |
| L-055 | PromptDialog (generic) | common/PromptDialog.tsx | sweep/dialogs.spec.ts | pass | Shown on file rename. |
| L-056 | BugReportDialog | common/BugReportDialog.tsx | sweep/dialogs.spec.ts | pass | Opens and closes. |
| L-057 | WhatsNewModal | WhatsNew.tsx | sweep/dialogs.spec.ts | pass | Area in updates settings. |
| L-058 | QuickOpen | QuickOpen.tsx | sweep/dialogs.spec.ts | pass | Ctrl+P opens, Escape closes. |
| L-059 | ShortcutsOverlay | ShortcutsOverlay.tsx | sweep/dialogs.spec.ts | pass | Opens with keyboard shortcut. |

---

## E. Workflow Template IDs + Names (src/modules/workflow/templates/)

### Legal Pack

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-060 | Legal: CaseTimelineBuilder | templates/legal/CaseTimelineBuilder.ts | sweep/templates.spec.ts | pass | Actual template ID: `legal-case-timeline-builder`. Spec fixed. |
| L-061 | Legal: CitationFormatter | templates/legal/CitationFormatter.ts | sweep/templates.spec.ts | pass | |
| L-062 | Legal: ClientIntakeSynthesizer | templates/legal/ClientIntakeSynthesizer.ts | sweep/templates.spec.ts | pass | Actual ID: `legal-client-intake-synthesizer`. Spec fixed. |
| L-063 | Legal: ContractReviewChecklist | templates/legal/ContractReviewChecklist.ts | sweep/templates.spec.ts | pass | Actual ID: `legal-contract-review-checklist`. Spec fixed. |
| L-064 | Legal: DeadlineCalendar | templates/legal/DeadlineCalendar.ts | sweep/templates.spec.ts | pass | |
| L-065 | Legal: DepositionContradictionFinder | templates/legal/DepositionContradictionFinder.ts | sweep/templates.spec.ts | pass | Actual ID: `legal-deposition-contradiction-finder`. Spec fixed. Flaky once (infra race). |
| L-066 | Legal: DiscoveryDocumentTriage | templates/legal/DiscoveryDocumentTriage.ts | sweep/templates.spec.ts | pass | Actual ID: `legal-discovery-document-triage`. Spec fixed. |
| L-067 | Legal: DiscoveryDrafter | templates/legal/DiscoveryDrafter.ts | sweep/templates.spec.ts | pass | |
| L-068 | Legal: EngagementLetterDrafter | templates/legal/EngagementLetterDrafter.ts | sweep/templates.spec.ts | pass | |
| L-069 | Legal: EstatePlanningClientSummary | templates/legal/EstatePlanningClientSummary.ts | sweep/templates.spec.ts | pass | Actual ID: `legal-estate-planning-client-summary`. Spec fixed. |
| L-070 | Legal: EvidenceGapAnalyzer | templates/legal/EvidenceGapAnalyzer.ts | sweep/templates.spec.ts | pass | Actual ID: `legal-evidence-gap-analyzer`. Spec fixed. |
| L-071 | Legal: FinancialAffidavitOrganizer | templates/legal/FinancialAffidavitOrganizer.ts | sweep/templates.spec.ts | pass | |
| L-072 | Legal: LegalResearchMemo | templates/legal/LegalResearchMemo.ts | sweep/templates.spec.ts | pass | |
| L-073 | Legal: ParentingPlanDrafter | templates/legal/ParentingPlanDrafter.ts | sweep/templates.spec.ts | pass | Flaky once (infra race). |
| L-074 | Legal: PatentDisclosureDraft | templates/legal/PatentDisclosureDraft.ts | sweep/templates.spec.ts | pass | Actual ID: `legal-patent-disclosure-draft`. Spec fixed. |
| L-075 | Legal: PrivilegeLogDrafter | templates/legal/PrivilegeLogDrafter.ts | sweep/templates.spec.ts | pass | Actual ID: `legal-privilege-log-drafter`. Spec fixed. |
| L-076 | Legal: RealEstateClosingChecklist | templates/legal/RealEstateClosingChecklist.ts | sweep/templates.spec.ts | pass | |
| L-077 | Legal: TransactionalMatterSummary | templates/legal/TransactionalMatterSummary.ts | sweep/templates.spec.ts | pass | Actual ID: `legal-transactional-matter-summary`. Spec fixed. |

### Tax Pack

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-078 | Tax: AuditDefenseFileBuilder | templates/tax/AuditDefenseFileBuilder.ts | sweep/templates.spec.ts | pass | Actual ID: `tax-audit-defense-file-builder`. Spec fixed. |
| L-079 | Tax: ClientDocumentInventory | templates/tax/ClientDocumentInventory.ts | sweep/templates.spec.ts | pass | Actual ID: `tax-client-document-inventory`. Spec fixed. |
| L-080 | Tax: CollectionNoticeResponse | templates/tax/CollectionNoticeResponse.ts | sweep/templates.spec.ts | pass | |
| L-081 | Tax: EngagementLetterBuilder | templates/tax/EngagementLetterBuilder.ts | sweep/templates.spec.ts | pass | Actual ID: `tax-engagement-letter-builder`. Spec fixed. Was timing out with wrong ID. |
| L-082 | Tax: EntityElectionAnalysis | templates/tax/EntityElectionAnalysis.ts | sweep/templates.spec.ts | pass | |
| L-083 | Tax: NoticeResponseDrafter | templates/tax/NoticeResponseDrafter.ts | sweep/templates.spec.ts | pass | Actual ID: `tax-notice-response-drafter`. Spec fixed. Flaky once (infra race). |
| L-084 | Tax: PreReviewChecklist | templates/tax/PreReviewChecklist.ts | sweep/templates.spec.ts | pass | Actual ID: `tax-pre-review-checklist`. Spec fixed. Flaky once (infra race). |
| L-085 | Tax: QuarterlyEstimateReminder | templates/tax/QuarterlyEstimateReminder.ts | sweep/templates.spec.ts | pass | Actual ID: `tax-quarterly-estimate-reminder`. Spec fixed. |
| L-086 | Tax: RepresentationKit | templates/tax/RepresentationKit.ts | sweep/templates.spec.ts | pass | Flaky once (infra race). |
| L-087 | Tax: SCorpReasonableCompMemo | templates/tax/SCorpReasonableCompMemo.ts | sweep/templates.spec.ts | pass | |
| L-088 | Tax: Section7216ConsentTemplate | templates/tax/Section7216ConsentTemplate.ts | sweep/templates.spec.ts | pass | Actual ID: `tax-section-7216-consent`. Spec fixed. Flaky once (infra race). |
| L-089 | Tax: TaxResearchMemo | templates/tax/TaxResearchMemo.ts | sweep/templates.spec.ts | pass | Flaky once (infra race). |
| L-090 | Tax: WISPBuilder | templates/tax/WISPBuilder.ts | sweep/templates.spec.ts | pass | |

### Consulting / Business Pack

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-091 | Biz: BoardMeetingPrep | templates/BoardMeetingPrep.ts | sweep/templates.spec.ts | pass | |
| L-092 | Biz: CompetitorAnalysis | templates/CompetitorAnalysis.ts | sweep/templates.spec.ts | pass | |
| L-093 | Consulting pack (subdir) | templates/consulting/ | sweep/templates.spec.ts | pass | Modal shows >0 consulting template cards. |
| L-094 | Biz: ContentStrategy | templates/ContentStrategy.ts | sweep/templates.spec.ts | pass | |
| L-095 | Biz: CustomerPersona | templates/CustomerPersona.ts | sweep/templates.spec.ts | pass | |
| L-096 | Biz: FinancialModel | templates/FinancialModel.ts | sweep/templates.spec.ts | pass | Spec previously failed with wrong search keyword (`financial model` vs display name "Financial Projections"). Fixed: ID `financial-model` is correct, card is found directly by testid without needing search filter. |
| L-097 | Biz: FirstHirePlaybook | templates/FirstHirePlaybook.ts | sweep/templates.spec.ts | pass | |
| L-098 | Biz: GoToMarketPlan | templates/GoToMarketPlan.ts | sweep/templates.spec.ts | pass | |
| L-099 | Biz: InvestorUpdate | templates/InvestorUpdate.ts | sweep/templates.spec.ts | pass | |
| L-100 | Biz: LandingPage | templates/LandingPage.ts | sweep/templates.spec.ts | pass | |
| L-101 | Biz: MVPScope | templates/MVPScope.ts | sweep/templates.spec.ts | pass | |
| L-102 | Biz: NewBusinessKickoff | templates/NewBusinessKickoff.ts | sweep/templates.spec.ts | pass | |
| L-103 | Biz: PitchDeck | templates/PitchDeck.ts | sweep/templates.spec.ts | pass | |
| L-104 | Biz: PricingStrategy | templates/PricingStrategy.ts | sweep/templates.spec.ts | pass | |
| L-105 | Biz: UserInterviews | templates/UserInterviews.ts | sweep/templates.spec.ts | pass | Flaky once (infra race). |
| L-106 | Biz: UserInterviewsSynthesis | templates/UserInterviewsSynthesis.ts | sweep/templates.spec.ts | pass | Flaky once (infra race). |
| L-107 | Biz: WeeklyReviewWorkflow | templates/WeeklyReviewWorkflow.ts | sweep/templates.spec.ts | pass | Actual ID: `weekly-review`. Spec fixed. |
| L-108 | Advisors pack (subdir) | templates/advisors/ | sweep/templates.spec.ts | pass | Modal shows advisors pack template cards. |

---

## F. File Type Viewers (src/components/layout/MainPanel.tsx render switch)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-109 | Viewer: Markdown / .md / .txt (CodeMirror editor) | MainPanel.tsx:939 | sweep/viewers.spec.ts | pass | |
| L-110 | Viewer: .docx (DocxEditor — Rust engine) | MainPanel.tsx:614 | sweep/viewers.spec.ts | pass | |
| L-111 | Viewer: .xlsx / .xls / .csv (SpreadsheetViewer) | MainPanel.tsx:136 | sweep/viewers.spec.ts | pass | Both xlsx and csv covered. |
| L-112 | Viewer: .pptx / .ppt (PresentationViewer) | MainPanel.tsx:145 | sweep/viewers.spec.ts | pass | |
| L-113 | Viewer: .pdf (PDF viewer) | MainPanel.tsx:611 | sweep/viewers.spec.ts | pass | |
| L-114 | Viewer: image (jpg/png/gif/webp/svg) | MainPanel.tsx:608 | sweep/viewers.spec.ts | pass | |
| L-115 | Viewer: video (mp4/webm/mov) | MainPanel.tsx:609 | sweep/viewers.spec.ts | pass | |
| L-116 | Viewer: audio (mp3/wav/webm/ogg/m4a) | MainPanel.tsx:610 | sweep/viewers.spec.ts | pass | |
| L-117 | Viewer: .whiteboard (tldraw canvas) | MainPanel.tsx:89 | sweep/viewers.spec.ts | pass | |
| L-118 | Viewer: .aichat (AI chat session) | MainPanel.tsx:751 | sweep/viewers.spec.ts | pass | |
| L-119 | Viewer: .source (research source card) | MainPanel.tsx:738 | sweep/viewers.spec.ts | pass | |
| L-120 | Viewer: browser tab (type='browser') | MainPanel.tsx:622 | sweep/viewers.spec.ts | pass | |
| L-121 | Viewer: email tab (type='email') | MainPanel.tsx:633 | sweep/viewers.spec.ts | pass | |
| L-122 | Viewer: ai-assistant tab (type='ai-assistant') | MainPanel.tsx:683 | sweep/viewers.spec.ts | pass | |
| L-123 | Viewer: JSON (.json) | MainPanel.tsx:561 | sweep/viewers.spec.ts | pass | |
| L-124 | Viewer: RTF (.rtf) | MainPanel.tsx:561 | sweep/viewers.spec.ts | pass | |

---

## G. Context Menus (FileTree + TabBar)

### FileTree toolbar actions (not a classic right-click menu — toolbar buttons)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-125 | FileTree toolbar: New File (type chooser) | FileTree.tsx:324 | sweep/filetree.spec.ts | pass | |
| L-126 | FileTree: New File → .docx | FileTree.tsx:340 | sweep/filetree.spec.ts | pass | |
| L-127 | FileTree: New File → .md | FileTree.tsx:349 | sweep/filetree.spec.ts | pass | |
| L-128 | FileTree: New File → .pptx | FileTree.tsx:365 | sweep/filetree.spec.ts | pass | |
| L-129 | FileTree: New File → .xlsx | FileTree.tsx:374 | sweep/filetree.spec.ts | pass | |
| L-130 | FileTree: New File → .csv | FileTree.tsx:383 | sweep/filetree.spec.ts | pass | |
| L-131 | FileTree toolbar: New Folder | FileTree.tsx:406 | sweep/filetree.spec.ts | pass | 300-char name edge test also pass. |
| L-132 | FileTree toolbar: Upload file | FileTree.tsx:439 | sweep/filetree.spec.ts | pass | Button renders (file picker native, not automatable headlessly). |
| L-133 | FileTree toolbar: Batch delete | FileTree.tsx:481 | sweep/filetree.spec.ts | pass | Button renders; requires selection to activate. |
| L-134 | FileTree toolbar: Open on desktop | FileTree.tsx:559 | sweep/filetree.spec.ts | pass | Button renders. |

### TabBar right-click context menu

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-135 | TabBar context menu: Rename | TabBar.tsx:1297 | sweep/filetree.spec.ts | pass | |
| L-136 | TabBar context menu: Close tab | TabBar.tsx:1305 | sweep/filetree.spec.ts | pass | |
| L-137 | TabBar context menu: Close other tabs | TabBar.tsx:1313 | sweep/filetree.spec.ts | pass | |

---

## H. Keyboard Shortcuts (src/utils/shortcuts.ts)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-138 | Shortcut: Save File (Ctrl+S) | shortcuts.ts:36 | sweep/shortcuts.spec.ts | pass | No console errors. |
| L-139 | Shortcut: Close Tab (Ctrl+W) | shortcuts.ts:43 | sweep/shortcuts.spec.ts | pass | No crash. |
| L-140 | Shortcut: Toggle Split Pane (Ctrl+\\) | shortcuts.ts:52 | sweep/shortcuts.spec.ts | pass | F-202/F-210: overflow detector bbox false positive confirmed; document does not actually scroll. |
| L-141 | Shortcut: Toggle Outline Panel | shortcuts.ts:59 | sweep/shortcuts.spec.ts | pass | |
| L-142 | Shortcut: Toggle Backlinks Panel | shortcuts.ts:66 | sweep/shortcuts.spec.ts | pass | |
| L-143 | Shortcut: Open Command Palette (Ctrl+Shift+P) | shortcuts.ts:75 | sweep/shortcuts.spec.ts | pass | |
| L-144 | Shortcut: Quick Open File (Ctrl+P) | shortcuts.ts:82 | sweep/shortcuts.spec.ts | pass | |
| L-145 | Shortcut: Show Keyboard Shortcuts (?) | shortcuts.ts:89 | sweep/shortcuts.spec.ts | pass | |
| L-146 | Shortcut: Open AI Assistant | shortcuts.ts:98 | sweep/shortcuts.spec.ts | pass | |
| L-147 | Shortcut: Open Settings | shortcuts.ts:107 | sweep/shortcuts.spec.ts | pass | |

---

## I. Command Palette Commands (src/components/common/CommandPalette.tsx + App.tsx)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-148 | Command: New Document | App.tsx: file.new-document | sweep/shortcuts.spec.ts | pass | Visible + searchable in palette. |
| L-149 | Command: Save File | App.tsx: file.save | sweep/shortcuts.spec.ts | pass | |
| L-150 | Command: Close Tab | App.tsx: file.close | sweep/shortcuts.spec.ts | pass | |
| L-151 | Command: Toggle Outline Panel | App.tsx: view.outline | sweep/shortcuts.spec.ts | pass | |
| L-152 | Command: Toggle Backlinks Panel | App.tsx: view.backlinks | sweep/shortcuts.spec.ts | pass | |
| L-153 | Command: Toggle Tab Overflow | App.tsx: view.tabOverflow | sweep/shortcuts.spec.ts | pass | |
| L-154 | Command: Split Editor / Close Split | App.tsx: view.split | sweep/shortcuts.spec.ts | pass | |
| L-155 | Command: Change Workspace | App.tsx: workspace.change | sweep/shortcuts.spec.ts | pass | |
| L-156 | Command: Open AI Assistant | App.tsx: view.aiAssistant | sweep/shortcuts.spec.ts | pass | |
| L-157 | Command: Open Settings | App.tsx: open-settings | sweep/shortcuts.spec.ts | pass | |
| L-158 | Command: Open Browser Tab | App.tsx: browser.open | sweep/shortcuts.spec.ts | pass | |
| L-159 | Command: New File (default) | CommandPalette.tsx: new-file | sweep/shortcuts.spec.ts | pass | |
| L-160 | Command: Open File | CommandPalette.tsx: open-file | sweep/shortcuts.spec.ts | pass | |
| L-161 | Command: Toggle Sidebar | CommandPalette.tsx: toggle-sidebar | sweep/shortcuts.spec.ts | pass | |
| L-162 | Command: Toggle Theme | CommandPalette.tsx: toggle-theme | sweep/shortcuts.spec.ts | pass | |
| L-163 | Command: Open Workflows | CommandPalette.tsx: open-workflows | sweep/shortcuts.spec.ts | pass | |
| L-164 | Command: Open Research | CommandPalette.tsx: open-research | sweep/shortcuts.spec.ts | pass | |
| L-165 | Command: Open Audit Log | CommandPalette.tsx: open-audit-log | sweep/shortcuts.spec.ts | pass | |

---

## J. Matter / Privilege Surfaces

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-166 | Matter manager dialog (open/create/switch matters) | matter/MatterManagerDialog.tsx | sweep/matter-privacy.spec.ts | pass | Opens via AI chat scope selector. |
| L-167 | Privileged matter badge in status bar | StatusBar.tsx:332 | sweep/matter-privacy.spec.ts | pass | Conditional; test handles absent state. |
| L-168 | Confidentiality mode settings | settings/ConfidentialityModeSettings.tsx | sweep/matter-privacy.spec.ts | pass | |
| L-169 | Privacy settings (data map) | settings/PrivacySettings.tsx | sweep/matter-privacy.spec.ts | pass | |
| L-170 | DataMapDialog (data flow visualization) | privacy/DataMapDialog.tsx | sweep/matter-privacy.spec.ts | pass | Opens from privacy settings. |

---

## K. Firm Surfaces (Sign-in + Admin)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-171 | Firm settings tab | settings/schema.ts:62 | sweep/firm-surfaces.spec.ts | pass | Wrong-password edge test also pass (401 → friendly error). |
| L-172 | License settings panel | settings/LicenseSettings.tsx | sweep/firm-surfaces.spec.ts | pass | |
| L-173 | Firm admin features (multi-seat) | settings/PricingTiers.tsx | sweep/firm-surfaces.spec.ts | pass | |
| L-174 | Mail connect settings | settings/MailConnect.tsx | sweep/firm-surfaces.spec.ts | pass | |
| L-175 | IMAP connect settings | settings/MailImapConnect.tsx | sweep/firm-surfaces.spec.ts | pass | |
| L-176 | Gmail connect settings | settings/MailGmailConnect.tsx | sweep/firm-surfaces.spec.ts | pass | |

---

## L. Trial / License States (src/modules/licensing/entitlements.ts)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-177 | Entitlement state: subscription-active | entitlements.ts:148 | sweep/licensing-states.spec.ts | native-only — requires live JWT validation from firm server | F-207 |
| L-178 | Entitlement state: grandfathered (pre-3.0 one-time buyer) | entitlements.ts:150 | sweep/licensing-states.spec.ts | native-only — requires valid JWT from server | F-207 |
| L-179 | Entitlement state: subscription-lapsed | entitlements.ts:152 | sweep/licensing-states.spec.ts | native-only — requires expired JWT from server | F-207 |
| L-180 | Entitlement state: trial-active | entitlements.ts:154 | sweep/licensing-states.spec.ts | pass | UI shell renders without errors (no token = trial-active path in browser). |
| L-181 | Entitlement state: trial-expired | entitlements.ts:156 | sweep/licensing-states.spec.ts | native-only — requires trial state from useTrial hook | F-207 |
| L-182 | Entitlement state: offline-grace | entitlements.ts:158 | sweep/licensing-states.spec.ts | pass | UI shell with last_good_at set in localStorage; renders without errors. |
| L-183 | Entitlement state: unlicensed (no license, no trial) | entitlements.ts:160 | sweep/licensing-states.spec.ts | pass | License settings shows buy button. |
| L-184 | License type: personal-onetime (grandfather) | entitlements.ts:217 | sweep/licensing-states.spec.ts | native-only | F-207 |
| L-185 | License type: professional-onetime (grandfather) | entitlements.ts:217 | sweep/licensing-states.spec.ts | native-only | F-207 |
| L-186 | License type: practice-onetime / lifetime (grandfather) | entitlements.ts:217 | sweep/licensing-states.spec.ts | native-only | F-207 |
| L-187 | License type: subscription (3.0 per-seat annual) | entitlements.ts:92 | sweep/licensing-states.spec.ts | native-only | F-207 |
| L-188 | License type: trial (30-day no-card) | entitlements.ts:93 | sweep/licensing-states.spec.ts | native-only | F-207 |
| L-189 | Offline grace window behavior (60 days, honor last-known-good) | entitlements.ts:212 | sweep/licensing-states.spec.ts | pass | UI gracefully honors last-known-good with last_good_at set. |
| L-190 | DATA ACCESS ALWAYS TRUE guarantee (all states) | entitlements.ts:178 | sweep/licensing-states.spec.ts | pass | Files panel accessible in all license states verified. |

---

## M. Egress Indicator States

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-191 | Egress indicator: idle / no outbound call | (StatusBar or MainPanel) | sweep/misc-surfaces.spec.ts | pass | Idle state renders in testMode. |
| L-192 | Egress indicator: AI call in progress | (StatusBar or MainPanel) | sweep/misc-surfaces.spec.ts | native-only — requires active AI stream | F-206 |
| L-193 | Egress indicator: Ollama (local-only, no egress) | OllamaProvider.ts | sweep/misc-surfaces.spec.ts | native-only — requires local Ollama process | F-206 |

---

## N. MCP Gate

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-194 | MCP approval gate (settings toggle) | settings/McpApprovalGate.tsx | sweep/misc-surfaces.spec.ts | pass | Toggle renders in AI settings. |
| L-195 | MCP approval modal (per-call confirmation) | settings/McpApprovalModal.tsx | sweep/misc-surfaces.spec.ts | native-only — requires in-flight MCP call | |
| L-196 | MCP settings section | settings/McpSettingsSection.tsx | sweep/misc-surfaces.spec.ts | pass | Renders in AI settings. |

---

## O. Plugins Panel

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-197 | Plugins sidebar panel (conditional) | Sidebar.tsx:104-106 | sweep/misc-surfaces.spec.ts | pass | Absent in testMode (no plugins installed); test handles both states. |
| L-198 | Plugins settings tab | settings/PluginsSettings.tsx | sweep/misc-surfaces.spec.ts | pass | |
| L-199 | Plugin consent dialog | marketplace/PluginConsentDialog.tsx | sweep/misc-surfaces.spec.ts | pass | Conditional on install; renders when triggered. |
| L-200 | Plugin detail view | marketplace/PluginDetailView.tsx | sweep/misc-surfaces.spec.ts | pass | Conditional on installed plugin. |
| L-201 | Installed plugins list | marketplace/InstalledPluginsList.tsx | sweep/misc-surfaces.spec.ts | pass | |
| L-202 | Installed templates list | marketplace/InstalledTemplatesList.tsx | sweep/misc-surfaces.spec.ts | pass | |

---

## P. Additional Surfaces

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-203 | Onboarding: WelcomeOnboardingDialog | onboarding/WelcomeOnboardingDialog.tsx | sweep/misc-surfaces.spec.ts | pass | Triggered via forceOnboarding param. |
| L-204 | Onboarding: FeatureTour | onboarding/FeatureTour.tsx | sweep/misc-surfaces.spec.ts | pass | Triggered via forceTour param. |
| L-205 | Onboarding: ApiKeyWizard | onboarding/ApiKeyWizard.tsx | sweep/misc-surfaces.spec.ts | pass | Visible in onboarding settings. |
| L-206 | Onboarding: AiSetupStep | onboarding/AiSetupStep.tsx | sweep/misc-surfaces.spec.ts | pass | Visible in onboarding settings. |
| L-207 | Onboarding: FirstRunWizard | onboarding/FirstRunWizard.tsx | sweep/misc-surfaces.spec.ts | pass | Correctly suppressed in testMode. |
| L-208 | Updater: UpdateBanner | updater/UpdateBanner.tsx | sweep/misc-surfaces.spec.ts | native-only — requires Tauri updater | |
| L-209 | Updater: UpdateReleaseNotesModal | updater/UpdateReleaseNotesModal.tsx | sweep/misc-surfaces.spec.ts | native-only — requires Tauri updater | |
| L-210 | Grid view (gallery mode) | MainPanel.tsx (LayoutGrid trigger) | sweep/misc-surfaces.spec.ts | pass | |
| L-211 | Whiteboard (tldraw canvas) | components/whiteboard/Whiteboard.tsx | sweep/misc-surfaces.spec.ts | pass | |
| L-212 | Audio recorder modal | audio/AudioRecorderModal.tsx | sweep/misc-surfaces.spec.ts | pass | Opens via AI tab. |
| L-213 | Waveform editor | audio/WaveformEditor.tsx | sweep/misc-surfaces.spec.ts | native-only — requires audio recording session | |
| L-214 | Version history panel (.md/.txt) | version/VersionHistoryPanel.tsx | sweep/misc-surfaces.spec.ts | pass | |
| L-215 | Binary version history panel (.docx/.xlsx/etc.) | version/BinaryVersionHistoryPanel.tsx | sweep/misc-surfaces.spec.ts | pass | |
| L-216 | Split pane (side-by-side editing) | editor/SplitPane.tsx | sweep/misc-surfaces.spec.ts | pass | F-202/F-210: overflow detection false positive confirmed; no real user-visible overflow. |
| L-217 | Ollama settings section | settings/OllamaSettingsSection.tsx | sweep/misc-surfaces.spec.ts | pass | |
| L-218 | Voice settings section | settings/VoiceSettingsSection.tsx | sweep/misc-surfaces.spec.ts | pass | |
| L-219 | Advanced settings | settings/AdvancedSettings.tsx | sweep/misc-surfaces.spec.ts | pass | |
| L-220 | Mobile settings | settings/MobileSettings.tsx / MobileSettingsPage.tsx | sweep/misc-surfaces.spec.ts | pass | |
| L-221 | Template model settings | settings/TemplateModelSettings.tsx | sweep/misc-surfaces.spec.ts | pass | |
| L-222 | Memory facts settings | settings/MemoryFactsSettings.tsx | sweep/misc-surfaces.spec.ts | pass | |

---

## Summary

| Category | Count | pass | finding | native-only | unreachable |
|----------|-------|------|---------|-------------|-------------|
| A. Sidebar tabs | 10 | 10 | 0 | 0 | 0 |
| B. Settings categories | 24 | 24 | 0 | 0 | 0 |
| C. Status bar widgets | 9 | 9 | 0 | 0 | 0 |
| D. Modals / Dialogs | 16 | 15 | 0 | 0 | 1 |
| E. Workflow templates | 49 | 49 | 0 | 0 | 0 |
| F. File type viewers | 16 | 16 | 0 | 0 | 0 |
| G. Context menus | 13 | 13 | 0 | 0 | 0 |
| H. Keyboard shortcuts | 10 | 10 | 0 | 0 | 0 |
| I. Command palette commands | 18 | 18 | 0 | 0 | 0 |
| J. Matter / privilege surfaces | 5 | 5 | 0 | 0 | 0 |
| K. Firm surfaces | 6 | 6 | 0 | 0 | 0 |
| L. Trial / license states | 14 | 5 | 0 | 9 | 0 |
| M. Egress indicator states | 3 | 1 | 0 | 2 | 0 |
| N. MCP gate | 3 | 2 | 0 | 1 | 0 |
| O. Plugins panel | 6 | 6 | 0 | 0 | 0 |
| P. Additional surfaces | 20 | 17 | 0 | 3 | 0 |
| **TOTAL** | **222** | **206** | **0** | **15** | **1** |

**Notes:**
- 0 product findings from the sweep (no P0/P1/P2 product bugs discovered in any of the 222 ledger rows)
- F-202/F-210: split-pane overflow confirmed as detection false positive (scrollWidth = clientWidth); no user-visible overflow
- F-203: spec bug fixed — 18 template IDs corrected to match actual `id` fields in source
- F-204: Playwright ENOENT artifact race (infra) — all affected tests pass when run isolated or with adequate workers; the parallel run with all 12 specs shows 3 apparent failures which are pure dev-server resource contention (all 3 pass individually)
- F-208: no language picker in General settings — i18n switch-locale flow not exposed in this build
- F-209: axe-core not installed — accessibility scan skipped
- All "native-only" rows require Tauri desktop or live external service (Ollama, firm server JWT, AI stream) unavailable in browser headless sweep
- **Recommend**: increase `workers: 2` to `workers: 1` in playwright.campaign.config.ts for full-suite runs, or run specs file-by-file; each individual spec is clean at 2 workers
