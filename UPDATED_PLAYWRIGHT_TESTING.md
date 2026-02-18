# Updated Playwright Testing Guide

## Overview

This document covers the Playwright E2E testing infrastructure for Projelli, established during v1.0.1 verification. All tests follow strict rules for reliability and accessibility.

## Testing Rules

### Selector Rules
- **ALWAYS** use `page.getByTestId('...')` (preferred) or `page.getByRole()` / `page.getByLabel()`
- **NEVER** use CSS selectors (`.class`, `#id`, `div > span`, etc.)
- Every interactive element must have a `data-testid` attribute

### Interaction Rules
- Before every click: `await expect(locator).toBeVisible()`
- For buttons: also `await expect(locator).toBeEnabled()`
- **NEVER** use `waitForTimeout` - use locator assertions instead
- Use the `hardClick()` helper for all button interactions
- Use the `safeFill()` helper for all text input interactions

### Visual & Accessibility Rules
- Add `toHaveScreenshot()` visual snapshots for layout regression detection
- Run `@axe-core/playwright` accessibility checks (critical/serious violations only)
- All icon-only buttons must have `aria-label` attributes

## Test Mode

The app has a `?testMode=true` URL parameter that:
- Bypasses the workspace selector dialog
- Directly shows the main UI (sidebar, file tree, editor, status bar)
- Essential for testing main UI components without manual workspace setup

### When to use which mode:
- `page.goto('/')` - Tests for workspace selector behavior
- `page.goto('/?testMode=true')` - Tests for main app UI (sidebar, file tree, AI, etc.)

## Configuration

### `playwright.config.ts`
```typescript
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 1,  // 1 retry locally for cold-start flakes
  workers: process.env.CI ? 1 : 2,  // Limit for WSL cold start
  timeout: 60_000,                   // Per-test timeout

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 60_000,       // Dev server cold start on WSL
  },

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

### WSL Compatibility
- Installed `@rollup/rollup-linux-x64-gnu` in dependencies for running from WSL with Windows node_modules
- Dev server cold-start on WSL/Windows FS takes ~60s, hence the extended timeouts
- Workers limited to 2 to avoid overwhelming the WSL Vite compilation

## Test Helpers (`tests/e2e/helpers/test-utils.ts`)

### `hardClick(el: Locator)`
Hardened click that handles overlays, animations, and offscreen elements:
1. Assert visible
2. Assert enabled
3. Scroll into view
4. Trial click (verify clickability)
5. Click (with force fallback)

### `safeFill(el: Locator, text: string)`
Safe fill that waits for visibility, enabled state, and scrolls into view before filling.

### `waitForAppLoad(page: Page)`
Waits for either workspace selector or sidebar to appear. Use for normal (non-test-mode) navigation.

### `waitForTestModeLoad(page: Page)`
Waits for sidebar to be visible with 30s timeout. Use after `page.goto('/?testMode=true')`.

### `openAIAssistantPane(page: Page)`
Clicks the AI Assistant sidebar tab and waits for the pane to appear.

### `openSidebarTab(page: Page, tabId: string)`
Clicks any sidebar tab by its ID.

### `switchAITab(page: Page, tab: 'chats' | 'keys' | 'models')`
Switches between tabs within the AI Assistant pane.

### `enterApiKey(page: Page, provider: string, key: string)`
Enters an API key for a provider (navigates to keys tab, fills input, clicks save).

## Test Files

### Core v1.0.1 Verification Tests

| File | Covers | Tests |
|------|--------|-------|
| `app-layout.spec.ts` | Workspace selector, sidebar navigation, collapse, visual snapshots | 7 |
| `ai-assistant.spec.ts` | Fix #4 (Opus 4.5), Fix #7 (dead button), tabs, API keys, new chat | 13 |
| `ai-chat.spec.ts` | Fix #1 (CORS proxy), Fix #3 (draft persistence), Fix #5 (chat titles) | 5 |
| `status-bar.spec.ts` | Fix #6 (project name not path, tab count) | 4 |
| `file-tree.spec.ts` | Fix #2 (Open on Desktop), Fix #8 (breadcrumbs), toolbar, grid view | 6 |
| `accessibility.spec.ts` | axe-core a11y checks for main UI and workspace selector | 2 |

**Total: 37 new tests + 1 skipped (API key test requires env var)**

## data-testid Reference

### Sidebar (`Sidebar.tsx`)
- `sidebar` - Main sidebar container
- `sidebar-collapse-button` - Collapse/expand button
- `sidebar-tab-{id}` - Tab buttons (files, search, workflows, ai-assistant, research, whiteboard, audit, trash)
- `sidebar-content` - Content area (hidden when collapsed)

### AI Assistant (`AIAssistantPane.tsx`)
- `ai-assistant-pane` - Main pane container
- `ai-assistant-title` - Pane title
- `ai-rules-button` - AI Rules button
- `ai-tab-chats` / `ai-tab-keys` / `ai-tab-models` - Tab buttons
- `new-chat-{provider}` - New chat buttons (anthropic, openai, google)
- `chat-item-{id}` - Chat list items
- `chat-title-{id}` - Chat titles
- `delete-chat-{id}` - Delete chat buttons
- `api-key-help-button` - Help button
- `api-key-input-{provider}` - API key inputs
- `api-key-save-{provider}` - Save buttons
- `model-select-anthropic` / `model-select-openai` / `model-select-google` - Model dropdowns

### AI Chat Viewer (`AIChatViewer.tsx`)
- `ai-chat-viewer` - Main viewer container
- `chat-title` - Chat title display
- `chat-created-date` - Creation date
- `chat-export-button` - Export button
- `chat-messages` - Messages container
- `chat-message-{idx}` - Individual messages (also has `data-role` attribute)
- `chat-loading-indicator` - Loading spinner
- `chat-input-area` - Input area container
- `chat-input` - Text input
- `chat-voice-button` - Voice input button
- `chat-send-button` - Send button

### Status Bar (`StatusBar.tsx`)
- `status-bar` - Main container
- `status-bar-project` - Project section
- `status-bar-project-name` - Project name text
- `status-bar-active-file` - Active file section
- `status-bar-file-name` - File name text
- `status-bar-modified` - Modified indicator
- `status-bar-tab-count` - Open tab count

### File Tree (`FileTree.tsx`)
- `file-tree` - Main container
- `file-tree-toolbar` - Toolbar row
- `new-file-button` - New file dropdown
- `new-folder-button` - New folder button
- `upload-button` - Upload button
- `grid-view-button` - Grid view button
- `open-on-desktop` - Open on Desktop button

### File Grid View (`FileGridView.tsx`)
- `file-grid-view` - Main container
- `breadcrumb-nav` - Breadcrumb navigation
- `breadcrumb-root` - Root breadcrumb button
- `breadcrumb-{index}` - Breadcrumb segments
- `grid-item-{name}` - Grid items

### Workspace Selector (`WorkspaceSelector.tsx`)
- `open-existing-workspace` - Open existing button
- `new-workspace` - New workspace button

## Running Tests

```bash
# Run all tests
npx playwright test

# Run specific test file
npx playwright test tests/e2e/ai-assistant.spec.ts

# Run with headed browser (see the browser)
npx playwright test --headed

# Update visual snapshots (first run or after UI changes)
npx playwright test --update-snapshots

# Run only v1.0.1 verification tests
npx playwright test ai-assistant ai-chat status-bar file-tree app-layout accessibility

# View HTML report
npx playwright show-report
```

## Adding New Tests

1. Add `data-testid` to new interactive elements in the component
2. Create test file in `tests/e2e/`
3. Import helpers from `./helpers/test-utils`
4. Use `?testMode=true` for main UI tests
5. Follow the selector and interaction rules above
6. Add visual snapshots for layout-sensitive features
7. Add accessibility checks for new pages/dialogs

## Accessibility Fixes Applied

All icon-only buttons now have `aria-label`:
- Sidebar collapse button: `aria-label="Collapse sidebar"` / `"Expand sidebar"`
- File tree context menu: `aria-label="File options"`
- Chat delete buttons: `aria-label="Delete chat"`
- SplitPane close buttons: `aria-label="Close pane"`
- MainPanel close button: `aria-label="Close panel"`
- TabBar close tab button: `aria-label="Close tab"`

## Visual Snapshots

Baseline screenshots are stored in `tests/e2e/*.spec.ts-snapshots/`. These are platform-specific (linux vs win32). On first run, use `--update-snapshots` to generate baselines. Subsequent runs compare against baselines with 5% pixel tolerance (`maxDiffPixelRatio: 0.05`).

Current snapshots:
- `workspace-selector.png` - Workspace selector dialog
- `main-app-test-mode.png` - Full app in test mode
- `file-tree.png` - File tree panel
- `grid-view-breadcrumbs.png` - Grid view with breadcrumbs
- `api-keys-tab.png` - AI Assistant API keys tab
- `models-tab.png` - AI Assistant models tab
- `status-bar.png` - Status bar
