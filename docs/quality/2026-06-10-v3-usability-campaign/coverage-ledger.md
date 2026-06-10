# Coverage Ledger — Keepance 3.0 Usability Campaign

**Date:** 2026-06-10
**Campaign:** v3 usability campaign — `docs/quality/2026-06-10-v3-usability-campaign/`

| Column | Meaning |
|--------|---------|
| **ID** | Stable row identifier |
| **Surface** | What is being covered |
| **Where** | Source file (relative to `/home/jameson/keepance/`) |
| **Covered by** | Test file or `—` if not yet written |
| **Result** | PASS / FAIL / SKIP / — |
| **Findings** | Notes, bugs, or observations |

---

## A. Sidebar Tabs (src/components/layout/Sidebar.tsx)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-001 | Sidebar tab: Files | Sidebar.tsx:97 | smoke.spec.ts | — | |
| L-002 | Sidebar tab: Search | Sidebar.tsx:97 | — | — | |
| L-003 | Sidebar tab: Workflows | Sidebar.tsx:98 | — | — | |
| L-004 | Sidebar tab: AI Assistant | Sidebar.tsx:99 | — | — | |
| L-005 | Sidebar tab: Research | Sidebar.tsx:100 | — | — | |
| L-006 | Sidebar tab: Whiteboard | Sidebar.tsx:101 | — | — | |
| L-007 | Sidebar tab: Audit | Sidebar.tsx:102 | — | — | |
| L-008 | Sidebar tab: Trash | Sidebar.tsx:103 | — | — | |
| L-009 | Sidebar tab: Plugins (conditional — shown only when plugin panels exist) | Sidebar.tsx:104-106 | — | — | |
| L-010 | Sidebar collapse / expand toggle | Sidebar.tsx:67 | — | — | |

---

## B. Settings Tabs / Categories (src/components/settings/SettingsModal.tsx + src/settings/schema.ts)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-011 | Settings category: General | schema.ts:60 | — | — | |
| L-012 | Settings category: License | schema.ts:61 | — | — | |
| L-013 | Settings category: Firm | schema.ts:62 | — | — | |
| L-014 | Settings category: Editor | schema.ts:63 | — | — | |
| L-015 | Settings category: AI | schema.ts:64 | — | — | |
| L-016 | Settings category: Memory | schema.ts:65 | — | — | |
| L-017 | Settings category: Voice | schema.ts:66 | — | — | |
| L-018 | Settings category: Files & Workspace | schema.ts:67 | — | — | |
| L-019 | Settings category: Keyboard Shortcuts | schema.ts:68 | — | — | |
| L-020 | Settings category: Cost & Usage | schema.ts:69 | — | — | |
| L-021 | Settings category: Templates | schema.ts:70 | — | — | |
| L-022 | Settings category: Integrations | schema.ts:71 | — | — | |
| L-023 | Settings category: Marketplace | schema.ts:72 | — | — | |
| L-024 | Settings category: Plugins | schema.ts:73 | — | — | |
| L-025 | Settings category: Mobile | schema.ts:74 | — | — | |
| L-026 | Settings category: Advanced | schema.ts:75 | — | — | |
| L-027 | Settings category: Updates | schema.ts:76 | — | — | |
| L-028 | Settings category: Onboarding | schema.ts:77 | — | — | |
| L-029 | Settings category: Privacy | schema.ts:78 | — | — | |
| L-030 | Settings category: About | schema.ts:79 | — | — | |
| L-031 | Settings export action | SettingsModal.tsx:822 | — | — | |
| L-032 | Settings import action | SettingsModal.tsx:832 | — | — | |
| L-033 | Settings reset action | SettingsModal.tsx:842 | — | — | |
| L-034 | Settings search bar | SettingsModal.tsx:679 | — | — | |

---

## C. Status Bar Widgets (src/components/layout/StatusBar.tsx)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-035 | Status bar root | StatusBar.tsx:211 | smoke.spec.ts | — | |
| L-036 | Status bar: project name widget | StatusBar.tsx:224 | — | — | |
| L-037 | Status bar: breadcrumbs (full path nav) | StatusBar.tsx:231 | — | — | |
| L-038 | Status bar: active file name | StatusBar.tsx:286 | — | — | |
| L-039 | Status bar: file modified indicator | StatusBar.tsx:317 | — | — | |
| L-040 | Status bar: privileged matter badge | StatusBar.tsx:332 | — | — | |
| L-041 | Status bar: matter indicator | StatusBar.tsx:358 | — | — | |
| L-042 | Status bar: tab count | StatusBar.tsx:382 | — | — | |
| L-043 | Status bar: bug report button | StatusBar.tsx:388 | — | — | |

---

## D. Modals / Dialogs (src/components/)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-044 | SettingsModal | settings/SettingsModal.tsx | — | — | |
| L-045 | McpApprovalModal | settings/McpApprovalModal.tsx | — | — | |
| L-046 | CompressionConfirmModal | chat/CompressionConfirmModal.tsx | — | — | |
| L-047 | AudioRecorderModal | audio/AudioRecorderModal.tsx | — | — | |
| L-048 | ChainBuilderModal | workflow/ChainBuilderModal.tsx | — | — | |
| L-049 | MatterManagerDialog | matter/MatterManagerDialog.tsx | — | — | |
| L-050 | DataMapDialog | privacy/DataMapDialog.tsx | — | — | |
| L-051 | WelcomeOnboardingDialog | onboarding/WelcomeOnboardingDialog.tsx | — | — | |
| L-052 | PluginConsentDialog | marketplace/PluginConsentDialog.tsx | — | — | |
| L-053 | UpdateReleaseNotesModal | updater/UpdateReleaseNotesModal.tsx | — | — | |
| L-054 | ConfirmDialog (generic) | common/ConfirmDialog.tsx | — | — | |
| L-055 | PromptDialog (generic) | common/PromptDialog.tsx | — | — | |
| L-056 | BugReportDialog | common/BugReportDialog.tsx | — | — | |
| L-057 | WhatsNewModal | WhatsNew.tsx | — | — | |
| L-058 | QuickOpen | QuickOpen.tsx | — | — | |
| L-059 | ShortcutsOverlay | ShortcutsOverlay.tsx | — | — | |

---

## E. Workflow Template IDs + Names (src/modules/workflow/templates/)

### Legal Pack

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-060 | Legal: CaseTimelineBuilder | templates/legal/CaseTimelineBuilder.ts | — | — | |
| L-061 | Legal: CitationFormatter | templates/legal/CitationFormatter.ts | — | — | |
| L-062 | Legal: ClientIntakeSynthesizer | templates/legal/ClientIntakeSynthesizer.ts | — | — | |
| L-063 | Legal: ContractReviewChecklist | templates/legal/ContractReviewChecklist.ts | — | — | |
| L-064 | Legal: DeadlineCalendar | templates/legal/DeadlineCalendar.ts | — | — | |
| L-065 | Legal: DepositionContradictionFinder | templates/legal/DepositionContradictionFinder.ts | — | — | |
| L-066 | Legal: DiscoveryDocumentTriage | templates/legal/DiscoveryDocumentTriage.ts | — | — | |
| L-067 | Legal: DiscoveryDrafter | templates/legal/DiscoveryDrafter.ts | — | — | |
| L-068 | Legal: EngagementLetterDrafter | templates/legal/EngagementLetterDrafter.ts | — | — | |
| L-069 | Legal: EstatePlanningClientSummary | templates/legal/EstatePlanningClientSummary.ts | — | — | |
| L-070 | Legal: EvidenceGapAnalyzer | templates/legal/EvidenceGapAnalyzer.ts | — | — | |
| L-071 | Legal: FinancialAffidavitOrganizer | templates/legal/FinancialAffidavitOrganizer.ts | — | — | |
| L-072 | Legal: LegalResearchMemo | templates/legal/LegalResearchMemo.ts | — | — | |
| L-073 | Legal: ParentingPlanDrafter | templates/legal/ParentingPlanDrafter.ts | — | — | |
| L-074 | Legal: PatentDisclosureDraft | templates/legal/PatentDisclosureDraft.ts | — | — | |
| L-075 | Legal: PrivilegeLogDrafter | templates/legal/PrivilegeLogDrafter.ts | — | — | |
| L-076 | Legal: RealEstateClosingChecklist | templates/legal/RealEstateClosingChecklist.ts | — | — | |
| L-077 | Legal: TransactionalMatterSummary | templates/legal/TransactionalMatterSummary.ts | — | — | |

### Tax Pack

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-078 | Tax: AuditDefenseFileBuilder | templates/tax/AuditDefenseFileBuilder.ts | — | — | |
| L-079 | Tax: ClientDocumentInventory | templates/tax/ClientDocumentInventory.ts | — | — | |
| L-080 | Tax: CollectionNoticeResponse | templates/tax/CollectionNoticeResponse.ts | — | — | |
| L-081 | Tax: EngagementLetterBuilder | templates/tax/EngagementLetterBuilder.ts | — | — | |
| L-082 | Tax: EntityElectionAnalysis | templates/tax/EntityElectionAnalysis.ts | — | — | |
| L-083 | Tax: NoticeResponseDrafter | templates/tax/NoticeResponseDrafter.ts | — | — | |
| L-084 | Tax: PreReviewChecklist | templates/tax/PreReviewChecklist.ts | — | — | |
| L-085 | Tax: QuarterlyEstimateReminder | templates/tax/QuarterlyEstimateReminder.ts | — | — | |
| L-086 | Tax: RepresentationKit | templates/tax/RepresentationKit.ts | — | — | |
| L-087 | Tax: SCorpReasonableCompMemo | templates/tax/SCorpReasonableCompMemo.ts | — | — | |
| L-088 | Tax: Section7216ConsentTemplate | templates/tax/Section7216ConsentTemplate.ts | — | — | |
| L-089 | Tax: TaxResearchMemo | templates/tax/TaxResearchMemo.ts | — | — | |
| L-090 | Tax: WISPBuilder | templates/tax/WISPBuilder.ts | — | — | |

### Consulting / Business Pack

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-091 | Biz: BoardMeetingPrep | templates/BoardMeetingPrep.ts | — | — | |
| L-092 | Biz: CompetitorAnalysis | templates/CompetitorAnalysis.ts | — | — | |
| L-093 | Consulting pack (subdir) | templates/consulting/ | — | — | |
| L-094 | Biz: ContentStrategy | templates/ContentStrategy.ts | — | — | |
| L-095 | Biz: CustomerPersona | templates/CustomerPersona.ts | — | — | |
| L-096 | Biz: FinancialModel | templates/FinancialModel.ts | — | — | |
| L-097 | Biz: FirstHirePlaybook | templates/FirstHirePlaybook.ts | — | — | |
| L-098 | Biz: GoToMarketPlan | templates/GoToMarketPlan.ts | — | — | |
| L-099 | Biz: InvestorUpdate | templates/InvestorUpdate.ts | — | — | |
| L-100 | Biz: LandingPage | templates/LandingPage.ts | — | — | |
| L-101 | Biz: MVPScope | templates/MVPScope.ts | — | — | |
| L-102 | Biz: NewBusinessKickoff | templates/NewBusinessKickoff.ts | — | — | |
| L-103 | Biz: PitchDeck | templates/PitchDeck.ts | — | — | |
| L-104 | Biz: PricingStrategy | templates/PricingStrategy.ts | — | — | |
| L-105 | Biz: UserInterviews | templates/UserInterviews.ts | — | — | |
| L-106 | Biz: UserInterviewsSynthesis | templates/UserInterviewsSynthesis.ts | — | — | |
| L-107 | Biz: WeeklyReviewWorkflow | templates/WeeklyReviewWorkflow.ts | — | — | |
| L-108 | Advisors pack (subdir) | templates/advisors/ | — | — | |

---

## F. File Type Viewers (src/components/layout/MainPanel.tsx render switch)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-109 | Viewer: Markdown / .md / .txt (CodeMirror editor) | MainPanel.tsx:939 | — | — | |
| L-110 | Viewer: .docx (DocxEditor — Rust engine) | MainPanel.tsx:614 | — | — | |
| L-111 | Viewer: .xlsx / .xls / .csv (SpreadsheetViewer) | MainPanel.tsx:136 | — | — | |
| L-112 | Viewer: .pptx / .ppt (PresentationViewer) | MainPanel.tsx:145 | — | — | |
| L-113 | Viewer: .pdf (PDF viewer) | MainPanel.tsx:611 | — | — | |
| L-114 | Viewer: image (jpg/png/gif/webp/svg) | MainPanel.tsx:608 | — | — | |
| L-115 | Viewer: video (mp4/webm/mov) | MainPanel.tsx:609 | — | — | |
| L-116 | Viewer: audio (mp3/wav/webm/ogg/m4a) | MainPanel.tsx:610 | — | — | |
| L-117 | Viewer: .whiteboard (tldraw canvas) | MainPanel.tsx:89 | — | — | |
| L-118 | Viewer: .aichat (AI chat session) | MainPanel.tsx:751 | — | — | |
| L-119 | Viewer: .source (research source card) | MainPanel.tsx:738 | — | — | |
| L-120 | Viewer: browser tab (type='browser') | MainPanel.tsx:622 | — | — | |
| L-121 | Viewer: email tab (type='email') | MainPanel.tsx:633 | — | — | |
| L-122 | Viewer: ai-assistant tab (type='ai-assistant') | MainPanel.tsx:683 | — | — | |
| L-123 | Viewer: JSON (.json) | MainPanel.tsx:561 | — | — | |
| L-124 | Viewer: RTF (.rtf) | MainPanel.tsx:561 | — | — | |

---

## G. Context Menus (FileTree + TabBar)

### FileTree toolbar actions (not a classic right-click menu — toolbar buttons)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-125 | FileTree toolbar: New File (type chooser) | FileTree.tsx:324 | — | — | |
| L-126 | FileTree: New File → .docx | FileTree.tsx:340 | — | — | |
| L-127 | FileTree: New File → .md | FileTree.tsx:349 | — | — | |
| L-128 | FileTree: New File → .pptx | FileTree.tsx:365 | — | — | |
| L-129 | FileTree: New File → .xlsx | FileTree.tsx:374 | — | — | |
| L-130 | FileTree: New File → .csv | FileTree.tsx:383 | — | — | |
| L-131 | FileTree toolbar: New Folder | FileTree.tsx:406 | — | — | |
| L-132 | FileTree toolbar: Upload file | FileTree.tsx:439 | — | — | |
| L-133 | FileTree toolbar: Batch delete | FileTree.tsx:481 | — | — | |
| L-134 | FileTree toolbar: Open on desktop | FileTree.tsx:559 | — | — | |

### TabBar right-click context menu

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-135 | TabBar context menu: Rename | TabBar.tsx:1297 | — | — | |
| L-136 | TabBar context menu: Close tab | TabBar.tsx:1305 | — | — | |
| L-137 | TabBar context menu: Close other tabs | TabBar.tsx:1313 | — | — | |

---

## H. Keyboard Shortcuts (src/utils/shortcuts.ts)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-138 | Shortcut: Save File (Ctrl+S) | shortcuts.ts:36 | — | — | |
| L-139 | Shortcut: Close Tab (Ctrl+W) | shortcuts.ts:43 | — | — | |
| L-140 | Shortcut: Toggle Split Pane (Ctrl+\\) | shortcuts.ts:52 | — | — | |
| L-141 | Shortcut: Toggle Outline Panel | shortcuts.ts:59 | — | — | |
| L-142 | Shortcut: Toggle Backlinks Panel | shortcuts.ts:66 | — | — | |
| L-143 | Shortcut: Open Command Palette (Ctrl+Shift+P) | shortcuts.ts:75 | — | — | |
| L-144 | Shortcut: Quick Open File (Ctrl+P) | shortcuts.ts:82 | — | — | |
| L-145 | Shortcut: Show Keyboard Shortcuts (?) | shortcuts.ts:89 | — | — | |
| L-146 | Shortcut: Open AI Assistant | shortcuts.ts:98 | — | — | |
| L-147 | Shortcut: Open Settings | shortcuts.ts:107 | — | — | |

---

## I. Command Palette Commands (src/components/common/CommandPalette.tsx + App.tsx)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-148 | Command: New Document | App.tsx: file.new-document | — | — | |
| L-149 | Command: Save File | App.tsx: file.save | — | — | |
| L-150 | Command: Close Tab | App.tsx: file.close | — | — | |
| L-151 | Command: Toggle Outline Panel | App.tsx: view.outline | — | — | |
| L-152 | Command: Toggle Backlinks Panel | App.tsx: view.backlinks | — | — | |
| L-153 | Command: Toggle Tab Overflow | App.tsx: view.tabOverflow | — | — | |
| L-154 | Command: Split Editor / Close Split | App.tsx: view.split | — | — | |
| L-155 | Command: Change Workspace | App.tsx: workspace.change | — | — | |
| L-156 | Command: Open AI Assistant | App.tsx: view.aiAssistant | — | — | |
| L-157 | Command: Open Settings | App.tsx: open-settings | — | — | |
| L-158 | Command: Open Browser Tab | App.tsx: browser.open | — | — | |
| L-159 | Command: New File (default) | CommandPalette.tsx: new-file | — | — | |
| L-160 | Command: Open File | CommandPalette.tsx: open-file | — | — | |
| L-161 | Command: Toggle Sidebar | CommandPalette.tsx: toggle-sidebar | — | — | |
| L-162 | Command: Toggle Theme | CommandPalette.tsx: toggle-theme | — | — | |
| L-163 | Command: Open Workflows | CommandPalette.tsx: open-workflows | — | — | |
| L-164 | Command: Open Research | CommandPalette.tsx: open-research | — | — | |
| L-165 | Command: Open Audit Log | CommandPalette.tsx: open-audit-log | — | — | |

---

## J. Matter / Privilege Surfaces

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-166 | Matter manager dialog (open/create/switch matters) | matter/MatterManagerDialog.tsx | — | — | |
| L-167 | Privileged matter badge in status bar | StatusBar.tsx:332 | — | — | |
| L-168 | Confidentiality mode settings | settings/ConfidentialityModeSettings.tsx | — | — | |
| L-169 | Privacy settings (data map) | settings/PrivacySettings.tsx | — | — | |
| L-170 | DataMapDialog (data flow visualization) | privacy/DataMapDialog.tsx | — | — | |

---

## K. Firm Surfaces (Sign-in + Admin)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-171 | Firm settings tab | settings/schema.ts:62 | — | — | |
| L-172 | License settings panel | settings/LicenseSettings.tsx | — | — | |
| L-173 | Firm admin features (multi-seat) | settings/PricingTiers.tsx | — | — | |
| L-174 | Mail connect settings | settings/MailConnect.tsx | — | — | |
| L-175 | IMAP connect settings | settings/MailImapConnect.tsx | — | — | |
| L-176 | Gmail connect settings | settings/MailGmailConnect.tsx | — | — | |

---

## L. Trial / License States (src/modules/licensing/entitlements.ts)

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-177 | Entitlement state: subscription-active | entitlements.ts:148 | — | — | |
| L-178 | Entitlement state: grandfathered (pre-3.0 one-time buyer) | entitlements.ts:150 | — | — | |
| L-179 | Entitlement state: subscription-lapsed | entitlements.ts:152 | — | — | |
| L-180 | Entitlement state: trial-active | entitlements.ts:154 | — | — | |
| L-181 | Entitlement state: trial-expired | entitlements.ts:156 | — | — | |
| L-182 | Entitlement state: offline-grace | entitlements.ts:158 | — | — | |
| L-183 | Entitlement state: unlicensed (no license, no trial) | entitlements.ts:160 | — | — | |
| L-184 | License type: personal-onetime (grandfather) | entitlements.ts:217 | — | — | |
| L-185 | License type: professional-onetime (grandfather) | entitlements.ts:217 | — | — | |
| L-186 | License type: practice-onetime / lifetime (grandfather) | entitlements.ts:217 | — | — | |
| L-187 | License type: subscription (3.0 per-seat annual) | entitlements.ts:92 | — | — | |
| L-188 | License type: trial (30-day no-card) | entitlements.ts:93 | — | — | |
| L-189 | Offline grace window behavior (60 days, honor last-known-good) | entitlements.ts:212 | — | — | |
| L-190 | DATA ACCESS ALWAYS TRUE guarantee (all states) | entitlements.ts:178 | — | — | |

---

## M. Egress Indicator States

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-191 | Egress indicator: idle / no outbound call | (StatusBar or MainPanel) | — | — | |
| L-192 | Egress indicator: AI call in progress | (StatusBar or MainPanel) | — | — | |
| L-193 | Egress indicator: Ollama (local-only, no egress) | OllamaProvider.ts | — | — | |

---

## N. MCP Gate

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-194 | MCP approval gate (settings toggle) | settings/McpApprovalGate.tsx | — | — | |
| L-195 | MCP approval modal (per-call confirmation) | settings/McpApprovalModal.tsx | — | — | |
| L-196 | MCP settings section | settings/McpSettingsSection.tsx | — | — | |

---

## O. Plugins Panel

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-197 | Plugins sidebar panel (conditional) | Sidebar.tsx:104-106 | — | — | |
| L-198 | Plugins settings tab | settings/PluginsSettings.tsx | — | — | |
| L-199 | Plugin consent dialog | marketplace/PluginConsentDialog.tsx | — | — | |
| L-200 | Plugin detail view | marketplace/PluginDetailView.tsx | — | — | |
| L-201 | Installed plugins list | marketplace/InstalledPluginsList.tsx | — | — | |
| L-202 | Installed templates list | marketplace/InstalledTemplatesList.tsx | — | — | |

---

## P. Additional Surfaces

| ID | Surface | Where | Covered by | Result | Findings |
|----|---------|-------|------------|--------|----------|
| L-203 | Onboarding: WelcomeOnboardingDialog | onboarding/WelcomeOnboardingDialog.tsx | — | — | |
| L-204 | Onboarding: FeatureTour | onboarding/FeatureTour.tsx | — | — | |
| L-205 | Onboarding: ApiKeyWizard | onboarding/ApiKeyWizard.tsx | — | — | |
| L-206 | Onboarding: AiSetupStep | onboarding/AiSetupStep.tsx | — | — | |
| L-207 | Onboarding: FirstRunWizard | onboarding/FirstRunWizard.tsx | — | — | |
| L-208 | Updater: UpdateBanner | updater/UpdateBanner.tsx | — | — | |
| L-209 | Updater: UpdateReleaseNotesModal | updater/UpdateReleaseNotesModal.tsx | — | — | |
| L-210 | Grid view (gallery mode) | MainPanel.tsx (LayoutGrid trigger) | — | — | |
| L-211 | Whiteboard (tldraw canvas) | components/whiteboard/Whiteboard.tsx | — | — | |
| L-212 | Audio recorder modal | audio/AudioRecorderModal.tsx | — | — | |
| L-213 | Waveform editor | audio/WaveformEditor.tsx | — | — | |
| L-214 | Version history panel (.md/.txt) | version/VersionHistoryPanel.tsx | — | — | |
| L-215 | Binary version history panel (.docx/.xlsx/etc.) | version/BinaryVersionHistoryPanel.tsx | — | — | |
| L-216 | Split pane (side-by-side editing) | editor/SplitPane.tsx | — | — | |
| L-217 | Ollama settings section | settings/OllamaSettingsSection.tsx | — | — | |
| L-218 | Voice settings section | settings/VoiceSettingsSection.tsx | — | — | |
| L-219 | Advanced settings | settings/AdvancedSettings.tsx | — | — | |
| L-220 | Mobile settings | settings/MobileSettings.tsx / MobileSettingsPage.tsx | — | — | |
| L-221 | Template model settings | settings/TemplateModelSettings.tsx | — | — | |
| L-222 | Memory facts settings | settings/MemoryFactsSettings.tsx | — | — | |

---

## Summary

| Category | Count |
|----------|-------|
| A. Sidebar tabs | 10 |
| B. Settings categories | 24 |
| C. Status bar widgets | 9 |
| D. Modals / Dialogs | 16 |
| E. Workflow templates | 49 |
| F. File type viewers | 16 |
| G. Context menus | 13 |
| H. Keyboard shortcuts | 10 |
| I. Command palette commands | 18 |
| J. Matter / privilege surfaces | 5 |
| K. Firm surfaces | 6 |
| L. Trial / license states | 14 |
| M. Egress indicator states | 3 |
| N. MCP gate | 3 |
| O. Plugins panel | 6 |
| P. Additional surfaces | 20 |
| **TOTAL** | **222** |

_Covered by / Result columns to be filled as campaign specs are written._
