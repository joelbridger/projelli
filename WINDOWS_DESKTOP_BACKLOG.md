# Windows Desktop Projelli Post-Build Backlog

## Overview

This document tracks all issues discovered during the first Tauri desktop build test on Windows, and their resolution status. All code edits target the project at `/mnt/c/Users/james/Projects/projelli/`.

## Summary

- **Total Tickets:** 11
- **User-Reported Issues:** 7
- **Status:** ✅ ALL TICKETS COMPLETED
- **Completed:** 11/11 ✅
- **Verification:** ✅ TypeScript compilation passed, ✅ Vite build succeeded
- **Icons Generated:** ✅ App icons (src-tauri/icons/), ✅ Favicons (public/)

---

## Tickets (Ordered by Priority)

### WINDT-001 (P0): Disable Tauri Native Drag-Drop Interception
**Status:** ✅ Completed

**Issue:** ALL drag-and-drop broken -- tabs, files in tree. Cursor shows red "no" circle immediately.

**Root Cause:** Tauri v2 `dragDropEnabled` defaults to `true`, intercepting HTML5 DnD events before JS handlers fire.

**File:** `src-tauri/tauri.conf.json`

**Change:** Add `"dragDropEnabled": false` to the window config object (inside `app.windows[0]`, around line 14)

**Acceptance Criteria:**
- Tabs can be dragged/reordered in TabBar
- Files can be dragged between folders in FileTree

---

### WINDT-002 (P0): Create Reusable ConfirmDialog Component
**Status:** ✅ Completed

**Issue:** `window.confirm()` shows "localhost:5173 says" prefix in Tauri WebView.

**Files to Create:**
- `src/components/common/ConfirmDialog.tsx` -- Radix UI AlertDialog-based modal
- `src/hooks/useConfirmDialog.ts` -- Hook returning `confirm(message, options?) => Promise<boolean>`

**Design:** Uses `@radix-ui/react-alert-dialog` (already installed via shadcn). Title, message body, Cancel + Confirm buttons. Returns promise resolving to boolean.

**Acceptance Criteria:**
- Modal renders with customizable title/message/button labels
- Promise resolves correctly on user choice

---

### WINDT-003 (P0): Create Reusable PromptDialog Component
**Status:** ✅ Completed

**Issue:** `window.prompt()` shows "localhost:5173 says" prefix in Tauri WebView.

**Files to Create:**
- `src/components/common/PromptDialog.tsx` -- Radix UI Dialog-based modal with text input
- `src/hooks/usePromptDialog.ts` -- Hook returning `prompt(message, defaultValue?) => Promise<string | null>`

**Design:** Uses `@radix-ui/react-dialog`. Title, message, text input, Cancel + OK buttons. Enter key submits. Returns string or null.

**Acceptance Criteria:**
- Modal renders with input field
- Resolves to input value on OK, null on Cancel

---

### WINDT-004 (P1): Replace All window.confirm() Calls
**Status:** ✅ Completed

**Issue:** 8 `window.confirm()` calls show "localhost:5173 says".

**Files to Modify:**
- `src/App.tsx` -- file deletion confirm (~line 279)
- `src/components/workflow/WorkflowPanel.tsx` -- workflow deletion
- `src/components/research/SourceFileEditor.tsx` -- source deletion
- `src/components/ai/AIAssistantPane.tsx` -- chat clearing
- Other files as found during implementation

**Approach:** Import `useConfirmDialog`, replace `window.confirm()` with `await confirm()`, make handlers async where needed.

**Dependencies:** WINDT-002

**Acceptance Criteria:**
- All window.confirm() calls replaced with custom dialog
- No "localhost says" prefix in any confirmation dialogs

---

### WINDT-005 (P1): Replace All window.prompt() Calls
**Status:** ✅ Completed

**Issue:** 10 `window.prompt()` calls show "localhost:5173 says".

**Files to Modify:**
- `src/App.tsx` -- ~10 calls (create file, folder, rename, workflow naming, etc.)
- Other files as found

**Approach:** Import `usePromptDialog`, replace `window.prompt()` with `await prompt()`, make handlers async where needed.

**Dependencies:** WINDT-003

**Acceptance Criteria:**
- All window.prompt() calls replaced with custom dialog
- No "localhost says" prefix in any prompt dialogs

---

### WINDT-006 (P1): Fix Workspace Permission Dialog / Environment Detection
**Status:** ✅ Completed

**Issue:** Workspace selector shows confusing browser permission dialog ("Save changes to test 15. Localhost 5170 will be able to edit files...") because env detection fails in Tauri.

**Root Cause:** `isTauriEnvironment()` uses truthy check (`window.__TAURI__`) which can fail if object is empty. Should use key-existence check.

**File:** `src/modules/workspace/BackendFactory.ts` line 14

**Change:**
```typescript
// From:
return typeof window !== 'undefined' && window.__TAURI__;
// To:
return typeof window !== 'undefined' && '__TAURI__' in window;
```

Also verify `src/components/workspace/WorkspaceSelector.tsx` correctly branches on environment.

**Acceptance Criteria:**
- In Tauri, workspace selector shows path input (not browser directory picker)
- No browser permission dialog

---

### WINDT-007 (P2): Generate App Icons from Projelli Logo SVG
**Status:** ✅ Completed

**Issue:** Windows taskbar and app top-left show default Tauri icon, not pink bean.

**Source:** `Assets/Projelli Logo.svg` (pink bean, #FF7C6E / #FF6554 / #FFA69F)

**Target:** All files in `src-tauri/icons/` (32x32.png, 128x128.png, 128x128@2x.png, icon.ico, icon.icns)

**Implementation:**
1. Used `Assets/Bean.png` (458x727) provided by user
2. Created square version `Bean_square.png` (727x727) with transparent padding using Python PIL
3. Generated all Tauri icons using:
   ```bash
   npx @tauri-apps/cli icon Assets/Bean_square.png
   ```
4. Successfully created all icon sizes in `src-tauri/icons/`:
   - Windows: StoreLogo, Square icons (30x30 to 310x310)
   - macOS: icon.icns
   - Windows: icon.ico
   - PNG: 32x32, 64x64, 128x128, 128x128@2x, icon.png
   - iOS and Android variants

**Acceptance Criteria:**
✅ All icons in src-tauri/icons/ show pink bean
✅ Ready for Windows rebuild to display correct icon in taskbar

---

### WINDT-008 (P2): Update Favicon and In-App Logo
**Status:** ✅ Completed

**Issue:** Browser tab / Tauri title bar should use Projelli branding (currently shows Vite logo).

**Files:** `index.html` (favicon link), `public/` directory (favicon files)

**Implementation:**
1. Generated favicon files from `Bean_square.png` using Python PIL:
   - favicon.ico (multi-size: 16x16, 32x32, 48x48)
   - favicon-16x16.png
   - favicon-32x32.png
   - favicon-48x48.png
   - favicon-64x64.png
   - favicon-128x128.png
   - favicon-256x256.png

2. Updated `index.html` (lines 5-8):
   ```html
   <link rel="icon" type="image/x-icon" href="/favicon.ico" />
   <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
   <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
   <link rel="apple-touch-icon" sizes="180x180" href="/favicon-256x256.png" />
   ```

3. Removed old Vite logo: `public/vite.svg`

**Acceptance Criteria:**
✅ Favicon shows Projelli bean icon in browser tab/title bar
✅ Multiple sizes provided for different contexts (16x16 to 256x256)
✅ All files in `public/` directory

---

### WINDT-009 (P2): Fix Command Palette X Button / ESC Badge Overlap
**Status:** ✅ Completed

**Issue:** X close button sits directly on top of "ESC" text in command palette (Ctrl+K).

**File:** `src/components/common/CommandPalette.tsx` lines 191-205

**Approach:** Remove the Radix DialogClose X button (ESC already closes the dialog), OR reposition ESC badge to avoid overlap.

**Acceptance Criteria:**
- No visual overlap
- Both elements clearly readable if both kept

---

### WINDT-010 (P2): Fix Source Card Website Preview Gray Box
**Status:** ✅ Completed

**Issue:** When website preview fails (X-Frame-Options, CSP block), huge gray box appears.

**File:** `src/components/research/SourceFileEditor.tsx` lines 207-258

**Approach:**
1. Reduce `min-h-[300px]` and `minHeight: '400px'` to smaller values
2. Add timeout-based error detection (if iframe doesn't load within 5s, show error)
3. Make error state compact (small icon + "Preview unavailable", not 300px tall)
4. Optionally add `frame-src` to CSP in `src-tauri/tauri.conf.json`

**Acceptance Criteria:**
- Failed previews show compact error indicator
- Successful previews render normally

---

### WINDT-011 (P3): Fix AI Assistant Rules Caret Confusion
**Status:** ✅ Completed

**Issue:** ChevronRight close button for AI pane looks like non-functional dropdown caret next to "Rules".

**File:** `src/components/ai/AIAssistantPane.tsx` lines 136-150

**Approach:** Increase spacing between "Rules" button and close button, and/or change icon to `PanelRightClose` or `X` with tooltip.

**Acceptance Criteria:**
- Close button is visually distinct from "Rules" label
- Clear it collapses the pane

---

## Implementation Order

1. ✅ WINDT-001 -- single config line, unblocks all drag-drop
2. ✅ WINDT-006 -- single line fix, unblocks correct Tauri detection
3. ✅ WINDT-002 -- create ConfirmDialog (needed before WINDT-004)
4. ✅ WINDT-003 -- create PromptDialog (needed before WINDT-005)
5. ✅ WINDT-004 -- replace all window.confirm() calls
6. ✅ WINDT-005 -- replace all window.prompt() calls
7. ✅ WINDT-009 -- fix command palette overlap
8. ✅ WINDT-010 -- fix source preview gray box
9. ✅ WINDT-011 -- fix AI assistant caret
10. ✅ WINDT-007 -- generate icons (used Bean.png with Python PIL)
11. ✅ WINDT-008 -- update favicon (generated multiple sizes)

## Verification Checklist

After all tickets:
- [ ] `npx tsc --noEmit` passes (no type errors)
- [ ] `npm run build` succeeds (Vite production build)
- [ ] Drag-drop works in TabBar and FileTree
- [ ] Dialogs show clean UI without "localhost says"
- [ ] Correct icons in taskbar and title bar
- [ ] Command palette layout fixed
- [ ] Source preview compact on error
- [ ] AI pane close button clear
- [ ] `npm run tauri build` succeeds on Windows
