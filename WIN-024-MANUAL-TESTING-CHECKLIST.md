# WIN-024: Manual Testing Checklist for Windows Desktop Release

**Date:** 2026-01-28
**Target:** Projelli v1.0.0 Windows Desktop (Tauri)
**Status:** Ready for Testing

## Pre-Testing Setup

### Test Environment Requirements
- [ ] Windows 10 (version 1809+) or Windows 11
- [ ] Clean Windows user account (recommended) or existing account
- [ ] Antivirus software enabled (test real-world conditions)
- [ ] Internet connection for AI API testing
- [ ] Microphone for audio recording tests (optional)
- [ ] Test workspace folder: `C:\Users\[YourName]\Documents\ProjelliiTest`

### Installation Testing
- [ ] Download Projelli installer (`.msi` or `.exe`)
- [ ] Verify installer file size (~50-100 MB expected)
- [ ] Check digital signature (if code signed)
- [ ] Run installer as normal user (not admin)
- [ ] Installer completes without errors
- [ ] App icon appears in Start Menu
- [ ] Desktop shortcut created (if selected)
- [ ] App appears in "Add or Remove Programs"

---

## Core Functionality Tests

### 1. First Launch
- [ ] App launches without console window
- [ ] Workspace selector dialog appears
- [ ] Dialog shows "Welcome to Projelli" (not "Business OS")
- [ ] Path input field visible (Tauri mode)
- [ ] Enter valid workspace path: `C:\Users\[YourName]\Documents\ProjelliiTest`
- [ ] Click "Open Existing" button
- [ ] App loads workspace successfully
- [ ] File tree displays on left sidebar
- [ ] Main panel shows welcome message or empty state

### 2. Workspace Operations
- [ ] **Create New File**: Right-click in file tree → New File
  - [ ] Window.prompt dialog appears (acceptable for v1.0)
  - [ ] Enter filename: `test-note.md`
  - [ ] File appears in file tree
  - [ ] File opens in editor

- [ ] **Create New Folder**: Right-click in file tree → New Folder
  - [ ] Enter folder name: `test-folder`
  - [ ] Folder appears in file tree
  - [ ] Can create file inside folder

- [ ] **Edit File**: Type content in `test-note.md`
  - [ ] Content appears in editor
  - [ ] Autosave indicator shows (within 2 seconds)
  - [ ] Content persists after closing tab

- [ ] **Delete File**: Right-click file → Delete
  - [ ] Confirmation dialog appears
  - [ ] File moves to trash (not permanently deleted)
  - [ ] File disappears from tree

- [ ] **Rename File**: Right-click file → Rename
  - [ ] Prompt for new name
  - [ ] File renames successfully
  - [ ] Content preserved

### 3. File System Backend (TauriFSBackend)
- [ ] **Backend Detection**: Check browser console (F12)
  - [ ] Log shows "[BackendFactory] Tauri environment detected"
  - [ ] Log shows "using TauriFSBackend"

- [ ] **File Operations**: Create, read, update, delete all work
  - [ ] No "File System Access API" errors
  - [ ] No permission denied errors
  - [ ] Files visible in Windows Explorer at workspace path

- [ ] **Large File Handling**: Create file with 10,000+ lines
  - [ ] Editor loads without lag
  - [ ] Scroll is smooth
  - [ ] Autosave completes

### 4. External Link Opening (Shell Plugin)
- [ ] Open API key help dialog (Settings → Keys → "How to get keys")
- [ ] Click "Open Console" for Anthropic
  - [ ] System default browser opens (NOT new Projelli window)
  - [ ] URL loads correctly: https://console.anthropic.com/

- [ ] Test other external links:
  - [ ] OpenAI platform link opens in browser
  - [ ] Google AI Studio link opens in browser

### 5. File Save Dialog (Dialog Plugin)
- [ ] Create test document with content
- [ ] Click download/export button (e.g., from formatting toolbar)
  - [ ] Native Windows save dialog appears (NOT browser file picker)
  - [ ] Can browse to different folder
  - [ ] Can change filename
  - [ ] File saves to selected location
  - [ ] File is readable in Notepad/other apps

- [ ] Export workflow result:
  - [ ] Native dialog appears
  - [ ] Can save to Desktop, Documents, etc.
  - [ ] Exported file contains correct data

### 6. Editor Features
- [ ] **Markdown Rendering**: Create `test.md` with:
  ```
  # Heading
  **Bold** *Italic*
  - List item
  [Link](https://example.com)
  ```
  - [ ] Preview shows formatted content
  - [ ] Split pane works (side-by-side editing)

- [ ] **Multiple Tabs**: Open 5+ files
  - [ ] All tabs visible in tab bar
  - [ ] Can switch between tabs
  - [ ] Each tab shows correct content
  - [ ] Close tab with unsaved changes → confirmation

- [ ] **Tab Groups**: Create tab group
  - [ ] Group dropdown shows tabs
  - [ ] Can drag tab out of group
  - [ ] Tab becomes ungrouped

### 7. Search & Navigation
- [ ] **Global Search**: Press Ctrl+K or click search
  - [ ] Search panel opens
  - [ ] Type query
  - [ ] Results appear
  - [ ] Click result → file opens

- [ ] **File Tree Search**: Type in file tree
  - [ ] Files filter as you type
  - [ ] Clear filter restores tree

### 8. Audio Features
- [ ] **Audio Recording**: Create voice note
  - [ ] Microphone permission prompt (Windows)
  - [ ] Grant permission
  - [ ] Recording starts
  - [ ] Stop recording
  - [ ] Audio file created
  - [ ] Playback works

- [ ] **Waveform Editor**: Open .wav file
  - [ ] Waveform visualizes
  - [ ] Playback works
  - [ ] Can export audio (native save dialog)

### 9. Whiteboard Features
- [ ] Create new whiteboard
- [ ] Draw shapes, lines, text
- [ ] Whiteboard saves
- [ ] Can reload and edit whiteboard
- [ ] Export whiteboard (if implemented)

### 10. AI Assistant (API Integration)
- [ ] Open AI Assistant pane (right sidebar)
- [ ] **API Keys Tab**: Enter valid API key
  - [ ] Key saves (not visible after refresh - security)

- [ ] **Chats Tab**: Start new AI chat
  - [ ] Send message
  - [ ] Response appears
  - [ ] Can send follow-up messages

- [ ] **Network Connectivity**: Check CSP allows AI APIs
  - [ ] No CORS errors in console
  - [ ] API calls succeed
  - [ ] External links in AI responses work (open in browser)

---

## Platform-Specific Tests

### Windows Integration
- [ ] **Start Menu**: App appears in Start Menu
  - [ ] Can launch from Start Menu
  - [ ] Right-click shows options (Pin, Unpin, Uninstall)

- [ ] **Taskbar**: App appears when running
  - [ ] Icon is correct (not generic)
  - [ ] Can pin to taskbar
  - [ ] Hover shows app name "Projelli"

- [ ] **File Associations**: (If configured)
  - [ ] Double-click `.projelli` file opens app
  - [ ] Context menu shows "Open with Projelli"

- [ ] **Windows Notifications**: (If implemented)
  - [ ] Notifications appear in Action Center
  - [ ] Clickable and actionable

### Window Behavior
- [ ] **Minimize**: Click minimize button
  - [ ] Window minimizes to taskbar
  - [ ] Click taskbar icon → window restores

- [ ] **Maximize**: Click maximize button
  - [ ] Window fills screen
  - [ ] UI scales correctly

- [ ] **Resize**: Drag window edges
  - [ ] Can resize to minimum size (800x600)
  - [ ] UI reflows correctly
  - [ ] No cutoff content

- [ ] **Close**: Click X button
  - [ ] If unsaved changes: prompt to save
  - [ ] App closes cleanly
  - [ ] No error dialogs

- [ ] **Reopen**: Launch app again
  - [ ] Workspace selector appears OR last workspace loads
  - [ ] Recent workspaces list shows (if implemented)

### Performance
- [ ] **Launch Time**: Measure app startup
  - [ ] Launches in < 3 seconds (cold start)
  - [ ] Launches in < 1 second (warm start)

- [ ] **Memory Usage**: Open Task Manager
  - [ ] Memory usage < 500 MB with typical workspace
  - [ ] No memory leaks (usage stable over time)

- [ ] **CPU Usage**: Monitor while idle
  - [ ] CPU usage < 5% when idle
  - [ ] No constant background activity

### Security
- [ ] **Antivirus**: Check Windows Defender
  - [ ] No malware warnings during install
  - [ ] No quarantine of app files
  - [ ] App runs with antivirus enabled

- [ ] **SmartScreen**: (If not code signed)
  - [ ] SmartScreen warning appears (expected)
  - [ ] Can click "More info" → "Run anyway"
  - [ ] App launches after override

- [ ] **Filesystem Permissions**: Try to access restricted paths
  - [ ] Cannot read/write to C:\Windows\
  - [ ] Cannot read/write to C:\Program Files\
  - [ ] Can access user directories (Documents, Desktop, etc.)

### Persistence
- [ ] **App Restart**: Close and reopen app
  - [ ] Workspace loads automatically OR selector appears
  - [ ] Open tabs restored (if implemented)
  - [ ] File content unchanged

- [ ] **Workspace Persistence**: Modify files
  - [ ] Close app
  - [ ] Open Windows Explorer
  - [ ] Verify files exist and contain correct content
  - [ ] Open app → files show correct content

---

## Edge Cases & Error Handling

### Filesystem Edge Cases
- [ ] **Invalid Workspace Path**: Enter nonexistent path
  - [ ] Error message appears
  - [ ] Can retry with valid path

- [ ] **Permission Denied**: Try to open C:\Windows as workspace
  - [ ] Error message appears
  - [ ] App doesn't crash

- [ ] **Large Files**: Open file > 10 MB
  - [ ] App warns or refuses (if limit exists)
  - [ ] OR loads with acceptable performance

- [ ] **Special Characters**: Create file with name: `test & file (1).md`
  - [ ] File creates successfully
  - [ ] Can open and edit
  - [ ] Name displays correctly

### Network Edge Cases
- [ ] **Offline Mode**: Disconnect internet
  - [ ] File operations work normally
  - [ ] AI assistant shows error (expected)
  - [ ] No app crashes

- [ ] **Reconnect**: Connect internet
  - [ ] AI assistant works again
  - [ ] No restart required

### UI Edge Cases
- [ ] **Many Open Tabs**: Open 20+ tabs
  - [ ] Tab bar scrolls or overflows gracefully
  - [ ] Performance remains acceptable

- [ ] **Long File Names**: Create file with 100+ character name
  - [ ] File tree truncates with ellipsis
  - [ ] Full name visible on hover

- [ ] **Deep Folder Nesting**: Create folder 10 levels deep
  - [ ] File tree scrolls/expands correctly
  - [ ] Can navigate to deepest folder

---

## Compatibility Tests

### Windows Versions
- [ ] **Windows 10** (1809+):
  - [ ] App installs and runs
  - [ ] All features work

- [ ] **Windows 11**:
  - [ ] App installs and runs
  - [ ] Respects Windows 11 design language
  - [ ] Context menus styled correctly

### Different User Accounts
- [ ] **Standard User** (non-admin):
  - [ ] App installs to user directory
  - [ ] All features work
  - [ ] No privilege elevation prompts

- [ ] **Administrator**:
  - [ ] App installs and runs
  - [ ] Same behavior as standard user

### Multiple Monitors
- [ ] **Dual Monitor Setup**:
  - [ ] Window can move between monitors
  - [ ] Maximize works on both monitors
  - [ ] Window position persists after restart

---

## Uninstallation Testing
- [ ] Open "Add or Remove Programs"
- [ ] Find "Projelli" in list
- [ ] Click "Uninstall"
- [ ] Uninstaller runs
- [ ] App removed from Start Menu
- [ ] App files removed from install directory
- [ ] User data preserved in Documents (workspace untouched)
- [ ] Registry entries cleaned up (check with regedit if concerned)

---

## Final Checklist

### Pre-Release Verification
- [ ] No console window appears at launch
- [ ] App icon looks professional (not default Tauri)
- [ ] Window title shows "Projelli" (not "projelli" or "Business OS")
- [ ] About dialog shows correct version (1.0.0)
- [ ] About dialog shows correct copyright (2026)
- [ ] No debug logs in production build
- [ ] No "TODO" or "FIXME" visible in UI

### Known Issues
Document any issues found during testing:

| Issue | Severity | Workaround | Ticket |
|-------|----------|------------|--------|
| (Example) SmartScreen warning | Low | Click "Run anyway" | Expected (no code signing) |
| | | | |

### Sign-Off
- [ ] Tester Name: __________________
- [ ] Date Tested: __________________
- [ ] Windows Version: __________________
- [ ] All Critical Tests Passed: YES / NO
- [ ] Recommended for Release: YES / NO

---

## Notes for Testers

**Important:**
- Test on a clean Windows install or separate user account if possible
- Enable Windows Defender/antivirus to test real-world conditions
- Take screenshots of any errors
- Check Windows Event Viewer for crash logs if app fails
- Test with both short and long file paths
- Test with and without internet connection

**Expected Behaviors:**
- `window.prompt()` and `window.confirm()` use browser-style dialogs (ACCEPTABLE for v1.0)
- First launch may take 3-5 seconds (loading WebView)
- Subsequent launches faster (1-2 seconds)
- SmartScreen warning expected without code signing certificate

**Not Tested:**
- Auto-update mechanism (not configured)
- Multi-language support (English only)
- Accessibility features (screen readers, high contrast)
- Tablet/touch mode (optional)

---

**Testing Status:** ⬜ Not Started | 🔄 In Progress | ✅ Complete | ❌ Failed

Update this document as testing progresses!
