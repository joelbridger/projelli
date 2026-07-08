# UX Simplification Audit - App Chrome + Settings

## 1. Screen Summary

- The app frame is a light, work-focused shell: top bar, left rail, main surface, and bottom status bar.
- Settings is dense: a left Settings rail, sub-tabs inside each section, search, many bordered rows, and a permanent footer with import/export/reset.
- Privacy is very visible, but repeated: header egress, Privacy settings, Privacy Center, Data Map, firm report, and client report all overlap.
- Onboarding is polished but heavy: animated intro, choice cards, two large AI cards, connector cards, setup progress, and many example prompts.
- The main opportunity is to fold rare details into menus and disclosures while keeping trust, consent, client isolation, and review gates visible.

## 2. Recommendations

1. **Merge the onboarding intro and first choice into one useful first screen**  
   **Impact: HIGH**  
   **What/where:** `IntroScene` at `src/features/onboarding/v2/scenes/IntroScene.tsx:29`, `ChooseStartScene` at `src/features/onboarding/v2/scenes/ChooseStartScene.tsx:70`, scene order in `src/features/onboarding/v2/OnboardingV2.tsx:154`, intro copy in `src/features/onboarding/v2/copy.ts:10`.  
   **Why it costs more than it gives:** The first onboarding screen uses a logo, headline, three animated cards, arrows, trust pills, and a "Go!" button before the user can make a real choice. It looks refined, but it delays the first useful action.  
   **Concrete simplification:** Make the first screen the choice screen. Keep the headline, then show the two start choices immediately. Fold the three animated "files -> Client Maps -> cited answers" cards into a tiny progress line under the headline, or remove them entirely.  
   **Copy rewrite:** `A private AI that knows your clients.` -> `Set up Lantern.` Keep supporting copy short: `Use sample data, or connect your own files.` `Go!` -> `Start setup`. `Start with a sample practice` -> `Use sample practice`. `Connect my own data` -> `Use my files`.  

2. **Remove the decorative onboarding background treatment**  
   **Impact: HIGH**  
   **What/where:** `OnboardingShell` at `src/features/onboarding/v2/components/OnboardingShell.tsx:141`; orb and grain styles in `src/features/onboarding/v2/onboardingV2.css:69`.  
   **Why it costs more than it gives:** The large blurred color shapes and grain make onboarding feel more like a marketing page than a setup flow. They add visual movement without helping the user decide.  
   **Concrete simplification:** Use a plain light background with one narrow content column. Keep motion only where it explains state, such as provider connection or import progress.  
   **Copy rewrite:** No visible copy change needed. This is a visual simplification: remove `.kp-onbv2-orb`, `.kp-onbv2-grain`, and the floating background nodes from the default screen.

3. **Turn the AI setup screen from two big sales cards into one setup path**  
   **Impact: HIGH**  
   **What/where:** `AiScene` at `src/features/onboarding/v2/scenes/AiScene.tsx:181`; AI copy in `src/features/onboarding/v2/copy.ts:26`.  
   **Why it costs more than it gives:** The screen shows two large cards, ten benefit bullets, provider buttons, numbered steps, a key field, testing status, local AI detection, help links, and two modals. The user came here to connect AI, not compare a product brochure.  
   **Concrete simplification:** Default to one primary path: Cloud AI. Put a small segmented choice at the top: `Cloud AI` and `Local AI`. Show only the fields needed for the selected choice. Put the longer explanation behind "What does this mean?"  
   **Copy rewrite:** `Use ChatGPT, Claude, or Gemini` -> `Cloud AI`. `Use local AI` -> `Local AI`. `PICK YOUR PROVIDER, THEN GET YOUR KEY` -> `Provider`. Cloud bullets should become three lines: `Uses your own AI account key.`, `Lantern never sees your key or data.`, `Usually gives the best answers.` Local bullets should become: `Runs on this computer.`, `Nothing leaves.`, `Needs a larger download.`

4. **Cut duplicate privacy and Data Map entry points**  
   **Impact: HIGH**  
   **What/where:** Header privacy shortcut in `TrustBar` at `src/app/shell/layout/TrustBar.tsx:105`; Data Map button in `ConfidentialityModeSettings` at `src/features/settings/ConfidentialityModeSettings.tsx:313`; Data Map card in `PrivacySettings` at `src/features/settings/PrivacySettings.tsx:45`; Privacy Center body in `src/features/privacy/PrivacyCenterHome.tsx:138`.  
   **Why it costs more than it gives:** The same idea appears in four places: "where does my data go?", "where your data lives", Privacy Center, and Data Map. Trust is important, but the repeated doors make the app feel more complex than it is.  
   **Concrete simplification:** Keep the header egress pill visible. Keep one Settings-side entry: `Privacy Center`. Inside Privacy Center, make Data Map the first section. Remove the separate Data Map button from `ConfidentialityModeSettings`, and fold the `PrivacySettings` Data Map card into a one-line link.  
   **Copy rewrite:** `Where your data lives and who can see it` -> `Data Map`. `Open the data map` -> `Open Data Map`. `Where does your data go?` -> `Data flow`.

5. **Flatten Settings navigation from two nav systems into one**  
   **Impact: HIGH**  
   **What/where:** Settings left rail at `src/features/settings/SettingsContent.tsx:1104`; section sub-tabs at `src/features/settings/SettingsContent.tsx:382`; extra Settings pages in `src/app/shell/AppSurfaceRouter.tsx:225`.  
   **Why it costs more than it gives:** Settings has a left rail and then another tab row inside each section. The user has to learn two different ways to move around one screen.  
   **Concrete simplification:** Keep the left rail as the only main navigation. Make the inside of each page a simple vertical stack with short section headings and collapsible "Advanced" areas. Add `Privacy Center` and `Activity Log` as normal left-rail items, not a nested extra block.  
   **Copy rewrite:** `AI & Privacy` -> split into `AI` and `Privacy`. `Files and Workspace` -> `Files`. `Keyboard Shortcuts` -> `Shortcuts`.

6. **Move rare Settings footer actions into a More menu**  
   **Impact: HIGH**  
   **What/where:** Settings footer buttons at `src/features/settings/SettingsContent.tsx:1191`.  
   **Why it costs more than it gives:** `Export`, `Import`, and especially `Reset to Defaults` are rare actions, but they are always visible at the bottom of the screen. That gives dangerous and administrative actions the same weight as everyday setup.  
   **Concrete simplification:** Remove the permanent footer. Add one `...` menu in the Settings toolbar next to search. Put `Export settings`, `Import settings`, and `Reset settings...` inside it. Keep reset visually dangerous inside the menu.  
   **Copy rewrite:** `Export` -> `Export settings`. `Import` -> `Import settings`. `Reset to Defaults` -> `Reset settings...`.

7. **Use a shorter trust pill in the top bar**  
   **Impact: HIGH**  
   **What/where:** `TrustBar` at `src/app/shell/layout/TrustBar.tsx:96`; compact egress label in `src/platform/privacy/ui/EgressIndicator.tsx:323`; long i18n labels in `src/locales/en.json:1497`.  
   **Why it costs more than it gives:** The header can show long text like "Sent to your Anthropic account" beside an info icon and a privacy shortcut. The idea is important, but the sentence-sized pill eats the most valuable chrome space.  
   **Concrete simplification:** Use the shorter status variant in the header: `Using local AI` or `Using cloud AI`. Keep the full provider detail in the tooltip and Privacy Center.  
   **Copy rewrite:** `On your machine. No cloud AI` -> `Using local AI`. `Sent to your {{provider}} account` -> `Using cloud AI`. Tooltip keeps: `Sent straight from your machine to {{provider}}...`

8. **Make Privacy Center have one primary action, not two**  
   **Impact: HIGH**  
   **What/where:** `PrivacyCenterHome` header actions at `src/features/privacy/PrivacyCenterHome.tsx:70`.  
   **Why it costs more than it gives:** The header shows two large report actions: a firm security overview and a client confidentiality report. They compete, and both read like primary actions.  
   **Concrete simplification:** Keep one primary button: the client report when a client is active. Move the firm security overview into a `...` menu. If no client is active, show one neutral primary action: `Open Data Map`.  
   **Copy rewrite:** `Generate a security overview for my firm` -> `Firm security overview`. `Confidentiality Report for {{client}}` -> `Export client report`.

9. **Reduce visible help icons in Settings rows**  
   **Impact: HIGH**  
   **What/where:** Default row pattern in `SettingRow` at `src/features/settings/SettingsContent.tsx:197` and `src/features/settings/SettingsContent.tsx:284`; language row in `src/features/settings/LanguagePicker.tsx:72`.  
   **Why it costs more than it gives:** Nearly every row gets an info icon. That creates visual speckles and makes simple settings feel technical. The icons stop being meaningful because there are too many.  
   **Concrete simplification:** Keep help icons only for complex, privacy, consent, account, or risky settings. Remove them for obvious controls such as font size, word wrap, line numbers, language, startup behavior, and update notifications. If a row needs one sentence, show it as muted text only when the control is focused.  
   **Copy rewrite:** `On Startup` -> `Startup`. `Show Update Notifications` -> `Update notifications`. `Auto Save` -> `Autosave`. `Word Wrap` -> `Word wrap`. `Line Numbers` -> `Line numbers`.

10. **Combine optional privacy sharing into one compact block**  
    **Impact: HIGH**  
    **What/where:** `PrivacySettings` telemetry and error cards at `src/features/settings/PrivacySettings.tsx:77` and `src/features/settings/PrivacySettings.tsx:148`; copy in `src/locales/en.json:202`.  
    **Why it costs more than it gives:** Usage stats and error reporting are very similar opt-in privacy choices, but they are separate cards with large hidden help content. The visible screen becomes mostly boxes.  
    **Concrete simplification:** Make one section called `Optional sharing` with two rows: `Usage stats` and `Error reporting`, each with a toggle. Add one disclosure: `What is shared?` with the detailed lists.  
    **Copy rewrite:** `Anonymous usage stats` -> `Usage stats`. `Optional error reporting` -> `Error reporting`. `Advisor Prep Hero is local-first. The only optional sharing controls live here.` -> `Lantern keeps your work on this computer. Optional sharing is off unless you turn it on.`

11. **Sweep visible copy from old product name to Lantern**  
    **Impact: HIGH**  
    **What/where:** Settings and privacy copy in `src/locales/en.json:203`, `src/locales/en.json:235`, `src/locales/en.json:931`; onboarding copy in `src/features/onboarding/v2/copy.ts:14`, `src/features/onboarding/v2/copy.ts:31`, `src/features/onboarding/v2/copy.ts:83`.  
    **Why it costs more than it gives:** The UI still shows "Advisor Prep Hero" in several places. Besides being longer, it weakens the new Lantern mental model.  
    **Concrete simplification:** Use `Lantern` in visible UI. Use `this app` when the product name is already clear nearby. Keep client-facing matter wording as `client`, not internal `matter`.  
    **Copy rewrite:** `Advisor Prep Hero is local-first...` -> `Lantern is local-first...` `Advisor Prep Hero never sees your key or your data` -> `Lantern never sees your key or data.` `Advisor Prep Hero Local AI` -> `Lantern Local AI`.

12. **Make the top-right command button icon-only**  
    **Impact: MED**  
    **What/where:** Header command palette button in `src/App.tsx:1891`.  
    **Why it costs more than it gives:** The visible `Ctrl+K` text is useful for power users, but it gives a keyboard shortcut prime header space. The button is not the main action of the app.  
    **Concrete simplification:** Keep the command icon and tooltip. Remove the visible shortcut text. The tooltip can still say `Command palette (Ctrl+K)`.  
    **Copy rewrite:** visible `Ctrl+K` -> tooltip-only `Command palette (Ctrl+K)`.

13. **Show client search in the left rail only when needed**  
    **Impact: MED**  
    **What/where:** Client search input in `Spine` at `src/app/shell/layout/Spine.tsx:390`.  
    **Why it costs more than it gives:** The search field is always visible in the rail, even when a workspace has only a few clients. It makes the rail feel like a form.  
    **Concrete simplification:** Replace the always-open input with a search icon in the `Clients` header. Expand it when clicked, when typing starts, or when there are more than seven clients.  
    **Copy rewrite:** `Search clients` -> `Find client`.

14. **Make `All Clients` a plain row, not a mini card**  
    **Impact: MED**  
    **What/where:** `All Clients` row in `Spine` at `src/app/shell/layout/Spine.tsx:426`; copy in `src/locales/en.json:1945`.  
    **Why it costs more than it gives:** The row uses an icon, border, background states, and an active marker. It competes with the main app navigation above it.  
    **Concrete simplification:** Make it a simple row at the top of the client list. Keep an active state, but remove the extra border treatment.  
    **Copy rewrite:** `All Clients` -> `All clients`.

15. **Remove the account sublabel from the rail**  
    **Impact: MED**  
    **What/where:** `AccountIdentity` at `src/app/shell/layout/AccountIdentity.tsx:93`; sublabel at `src/app/shell/layout/AccountIdentity.tsx:127`.  
    **Why it costs more than it gives:** `Solo account` or `Firm account` is rarely needed every time the user looks at the rail. It adds a second text line at the bottom of every screen.  
    **Concrete simplification:** Show avatar, name, and chevron only. Put `Solo account` or `Firm account` in the account menu or tooltip.  
    **Copy rewrite:** visible `Solo account` / `Firm account` -> menu detail only.

16. **Remove the duplicate active-file chip in the status bar**  
    **Impact: MED**  
    **What/where:** Breadcrumb active file in `StatusBar` at `src/app/shell/layout/StatusBar.tsx:312`; duplicate right-side chip at `src/app/shell/layout/StatusBar.tsx:352`.  
    **Why it costs more than it gives:** The same file name can appear twice in the bottom bar. One tells the user where they are; the second repeats it.  
    **Concrete simplification:** Keep the breadcrumb. Remove the separate right-side active-file chip. Keep the `Modified` chip because it communicates save risk.  
    **Copy rewrite:** No user-facing copy replacement needed. This is a duplicate element removal.

17. **Move non-urgent trial status out of the status bar**  
    **Impact: MED**  
    **What/where:** Trial chip in `StatusBar` at `src/app/shell/layout/StatusBar.tsx:337`.  
    **Why it costs more than it gives:** Trial state matters, but it does not need daily status-bar space when there is plenty of time left.  
    **Concrete simplification:** Show trial state in the account menu until it is close to urgent. Keep the status-bar chip only when the trial has three days or fewer left, is expired, or needs action.  
    **Copy rewrite:** `Free trial, {{days}} days left` -> `Trial: {{days}} days`.

18. **Shorten the isolated-client badge**  
    **Impact: MED**  
    **What/where:** Isolated client badge in `StatusBar` at `src/app/shell/layout/StatusBar.tsx:378`; copy in `src/locales/en.json:1521`.  
    **Why it costs more than it gives:** The badge is load-bearing, but the current text is a full sentence in the status bar. That makes the bar feel crowded.  
    **Concrete simplification:** Keep the badge visible when active. Shorten the visible label and move the full sentence into the title/tooltip.  
    **Copy rewrite:** `Isolated client: outside connections are blocked so nothing can leave this client.` -> visible `Isolated client`; tooltip keeps `Outside connections are blocked so nothing can leave this client.`

19. **Fold advanced recording notice settings**  
    **Impact: MED**  
    **What/where:** `RecordingNoticeSettings` at `src/features/settings/RecordingNoticeSettings.tsx:45`, Notice Card settings at `src/features/settings/RecordingNoticeSettings.tsx:152`, save background at `src/features/settings/RecordingNoticeSettings.tsx:239`.  
    **Why it costs more than it gives:** Recording policy, script, Notice Card, evidence requirements, and save background all show at once. Most users need the policy and script first; the rest is setup detail.  
    **Concrete simplification:** Show policy choice and script by default. Put Notice Card name, evidence choices, and save background behind `Advanced recording notice`. Use compact radio buttons instead of bordered policy cards.  
    **Copy rewrite:** `What satisfies a Strict recording notice` -> `Strict proof`. `Offer the Notice Card for online meetings` -> `Offer Notice Card`. `Spoken recording-notice script` -> `Spoken notice script`.

20. **Make trash retention a summary with a Change action**  
    **Impact: MED**  
    **What/where:** `RetentionSettings` at `src/features/settings/RetentionSettings.tsx:49`; copy in `src/locales/en.json:1526`.  
    **Why it costs more than it gives:** Three radio rows, a days input, a cleanup button, and last-cleanup text are always visible. This is a maintenance policy, not an everyday setting.  
    **Concrete simplification:** Show one summary sentence with `Change`. Open the radio group only after the user clicks `Change`. Move `Run cleanup now` into a `...` menu.  
    **Copy rewrite:** `Trash retention` -> `Deleted files`. `Cleanup has not run yet.` -> `No cleanup yet.` `Run cleanup now` -> `Clean up now`.

21. **Collapse ready-state Local AI into one line**  
    **Impact: MED**  
    **What/where:** `LocalAiSettingsControl` at `src/features/settings/LocalAiSettingsControl.tsx:42`; copy in `src/locales/en.json:931`.  
    **Why it costs more than it gives:** Once Local AI is installed, the full card keeps taking space even though it has become a normal status.  
    **Concrete simplification:** Show the full card only when Local AI is missing, downloading, or in error. When ready, show a one-line check state near the model picker.  
    **Copy rewrite:** `Installed and ready. Pick "Advisor Prep Hero Local AI" as your model in any chat.` -> `Local AI installed.`

22. **Hide empty memory tables until there is data**  
    **Impact: MED**  
    **What/where:** `MemoryFactsSettings` empty table and manual add form at `src/features/settings/MemoryFactsSettings.tsx:150`; copy in `src/locales/en.json:299`.  
    **Why it costs more than it gives:** An empty bordered table plus a manual input makes memory feel like a setup chore before it has value.  
    **Concrete simplification:** When there are no facts, show one quiet empty line and an `Add fact` disclosure. Render the table only after facts exist.  
    **Copy rewrite:** `No facts saved yet. Proposed facts from chat conversations will show up here after you accept them.` -> `No saved facts yet.` `Add a fact about yourself...` -> `Add a fact...`.

23. **Do not show a Voice Ready card when nothing needs attention**  
    **Impact: MED**  
    **What/where:** `VoiceSettingsSection` status card at `src/features/settings/VoiceSettingsSection.tsx:115`; voice status labels at `src/features/settings/VoiceSettingsSection.tsx:79`.  
    **Why it costs more than it gives:** A ready card is reassurance, but it becomes permanent decoration. Settings should spend space on choices and problems.  
    **Concrete simplification:** Show the card only for checking, unavailable, denied, or error states. If ready, use a small check in the section header or no visible status.  
    **Copy rewrite:** `Voice ready` -> hidden normal state, or small `Ready`.

24. **Stop using Advanced as a placeholder**  
    **Impact: MED**  
    **What/where:** `AdvancedSettings` at `src/features/settings/AdvancedSettings.tsx:14`; copy in `src/locales/en.json:338`.  
    **Why it costs more than it gives:** The current Advanced placeholder says more settings will arrive later. That is not useful to a user today.  
    **Concrete simplification:** Hide the placeholder when it has no active controls. Keep actual controls such as cost meters and mobile access.  
    **Copy rewrite:** Remove visible `Power-user settings, including per-feature kill switches. Streams populate as features land.` If needed in help: `Advanced controls appear here when available.`

25. **Move mobile setup instructions out of default Settings view**  
    **Impact: MED**  
    **What/where:** `MobileSettingsPage` at `src/features/settings/MobileSettingsPage.tsx:119`; provider instructions at `src/features/settings/MobileSettingsPage.tsx:151`; copy in `src/locales/en.json:312`.  
    **Why it costs more than it gives:** This section reads like documentation inside Settings: provider tabs, setup steps, tips, links, and warnings. Most users only need to know what method to pick.  
    **Concrete simplification:** Show a compact provider list with one-line guidance and `Full guide` links. Keep step-by-step setup in the guide, not the default Settings panel.  
    **Copy rewrite:** `Mobile` -> `Phone access`. `Configure read-only mobile access for your workspace.` -> `Read this workspace on your phone with iCloud, Dropbox, Syncthing, or Google Drive.` `Treat your phone as read-only...` -> `For now, read on phone. Edit on one device at a time.`

26. **Remove the coming-soon connector logo wall from onboarding**  
    **Impact: MED**  
    **What/where:** `ConnectScene` coming-soon card at `src/features/onboarding/v2/scenes/ConnectScene.tsx:103`; logo list in `src/features/onboarding/v2/copy.ts:141`.  
    **Why it costs more than it gives:** Logos for future connectors make onboarding look broader, but they do not help the user connect data now. They also make the setup screen feel like a roadmap.  
    **Concrete simplification:** Move future connectors into a small `More connectors planned` disclosure or the Help area. Keep only current, actionable connectors visible.  
    **Copy rewrite:** `COMING SOON` -> `More connectors planned`.

27. **Shorten connector trust copy in onboarding**  
    **Impact: MED**  
    **What/where:** Trust pills in `ConnectScene` at `src/features/onboarding/v2/scenes/ConnectScene.tsx:40`; connector trust copy in `src/features/onboarding/v2/copy.ts:69`.  
    **Why it costs more than it gives:** Three separate trust pills repeat the same privacy story already told by the egress indicator, Data Map, and Privacy Center.  
    **Concrete simplification:** Replace the three pills with one quiet line below the title. Put details in the Data Map or tooltip.  
    **Copy rewrite:** `Encrypted in transit` / `Stays on your device` / `Advisor Prep Hero never sees your data` -> `Connected data stays on this device.`

28. **Limit final onboarding example prompts**  
    **Impact: MED**  
    **What/where:** Example prompt chips in `FirmSetupScene` at `src/features/onboarding/v2/scenes/FirmSetupScene.tsx:225`; full list in `src/features/onboarding/v2/copy.ts:112`.  
    **Why it costs more than it gives:** Sixteen prompt chips make the final setup screen look busy. A few good examples are more useful than a full menu.  
    **Concrete simplification:** Show the best four examples, then a `More examples` disclosure. Keep the full list available after setup in Ask.  
    **Copy rewrite:** `Things you can ask Advisor Prep Hero` -> `Try asking`. Keep four visible chips, such as `Who needs a review this week?`, `What changed for the Chen household?`, `Draft an agenda for tomorrow.`, and `Find missing paperwork.`

29. **Reduce Privacy Center heading repetition**  
    **Impact: LOW**  
    **What/where:** Privacy Center title and body at `src/features/privacy/PrivacyCenterHome.tsx:74`, `src/features/privacy/PrivacyCenterHome.tsx:115`, and `src/features/privacy/PrivacyCenterHome.tsx:138`; Data Map title inside `DataMapContent` at `src/platform/privacy/ui/DataMapDialog.tsx:323`.  
    **Why it costs more than it gives:** The screen stacks several labels for the same idea: `Where your data is`, `Current mode`, `Data Map`, and `Where your data lives and who can see it`.  
    **Concrete simplification:** Title the surface `Privacy Center`. Show the mode strip as `Mode` plus the egress pill. Remove the local `Data Map` heading and paragraph when `DataMapContent` already has its own title.  
    **Copy rewrite:** `Where your data is` -> `Privacy Center`. `Current mode:` -> `Mode`. `A plain-English map...` -> remove from default view, keep in Data Map dialog if needed.

30. **Sentence-case Settings labels and shorten technical names**  
    **Impact: LOW**  
    **What/where:** Settings schema labels in `src/platform/settings/schema.ts:160`, `src/platform/settings/schema.ts:182`, `src/platform/settings/schema.ts:303`, `src/platform/settings/schema.ts:659`.  
    **Why it costs more than it gives:** Many labels use title case or technical phrasing. The screen feels more like a control panel than a simple app.  
    **Concrete simplification:** Use sentence case and user-language labels. Keep technical detail in help text.  
    **Copy rewrite:** `Default New Document Type` -> `New document type`. `Tab Overflow` -> `Tabs`. `Auto Save Interval` -> `Autosave delay`. `Ambient File Context` -> `Open files in AI`. `Context Token Limit` -> `Open-file limit`. `Chat Context Token Limit` -> `Chat limit`. `Keep Recent Turns (Compression)` -> `Keep recent turns`. `Inject memory facts into chat` -> `Add saved facts to chat`. `Check for updates automatically` -> `Automatic updates`.

## 3. Do Not Touch

- **Header egress signal:** Keep a visible data-egress indicator in the top chrome. It can be shorter, but it cannot disappear.
- **Consent and review gates:** Anything that prevents unreviewed sends, file changes, recording notices, or external sharing must stay visible at the moment of action.
- **Client isolation signal:** The isolated-client badge can be shorter, but users must still see when a client is locked down.
- **Privacy Center, Data Map, and reports:** These can be folded and deduplicated, but not removed. They are proof, not decoration.
- **Local / cloud / assured AI choices:** The choices can be simpler, but the user must still understand where prompts go.
- **Recording notice policy:** It can move into a cleaner disclosure, but the policy and proof choices are load-bearing for trust.
- **Settings search:** Keep search. It is the quickest escape hatch in a dense Settings screen.
- **Modified state in the status bar:** Keep the save-risk signal. Removing duplicate file labels is fine; removing modified state is not.
- **Urgent trial or account warnings:** Non-urgent billing can move to the account menu, but urgent or expired states must stay visible.
- **Onboarding connection locks:** Do not let users skip forward while an OAuth sign-in or required connection step is still pending.
