# Projelli Windows Migration Plan

## Executive Summary

Projelli is currently a browser-based project management application with a sophisticated filesystem abstraction layer. **The good news:** 80% of the Windows desktop migration work is already complete. The project contains a fully scaffolded Tauri v2 setup with dual filesystem backends (`WebFSBackend` for browser, `TauriFSBackend` for native), comprehensive Tauri configuration, Rust source code, and build tooling already in place.

**Current State:**
- Clean architecture with `FSBackend` interface abstraction
- Backend-agnostic `WorkspaceService` implementation
- Complete `src-tauri/` directory with Tauri v2 config and Rust code
- Tauri dependencies in `package.json`, Vite configured for Tauri builds
- Icon set prepared (18 files)
- Windows MSI/NSIS installer configuration ready

**What's Missing:**
- 7 critical blockers preventing compilation and runtime (detailed below)
- Backend selection logic - UI currently hardcoded to browser backend
- Browser API replacements (save dialogs, window.open, etc.)
- Development environment setup (Rust toolchain on Windows)
- Final polish and testing

**Bottom Line:** This is not a rewrite or major refactor. It's a completion and connection exercise. The architecture is sound, the abstractions are in place, and the Tauri scaffolding exists. We need to fix build blockers, wire up the backend selection, replace a handful of browser APIs, and test on Windows.

---

## Architecture Analysis

### FSBackend Abstraction - Already Built

The project uses a clean filesystem abstraction with two complete implementations:

**Interface:** `src/domain/interfaces/FSBackend.ts`
- Defines operations: `readFile`, `writeFile`, `listDir`, `exists`, `mkdir`, `delete`, `rename`, `copy`
- Workspace-scoped design for security
- Platform-agnostic API surface

**Browser Implementation:** `src/infrastructure/fs/WebFSBackend.ts`
- Uses File System Access API (`window.showDirectoryPicker`)
- Handle-based workspace isolation
- Full CRUD operations implemented

**Tauri Implementation:** `src/infrastructure/fs/TauriFSBackend.ts`
- Uses `@tauri-apps/plugin-fs` (needs npm install)
- Path-based workspace isolation
- Full CRUD operations implemented
- Permission-aware with error handling

**Backend-Agnostic Service:** `src/domain/services/WorkspaceService.ts`
- Takes `FSBackend` via dependency injection
- No platform-specific code
- Works identically with both backends

### Tauri Scaffolding Status

#### Rust Backend (`src-tauri/`)

**Present and Configured:**
- `tauri.conf.json` - Tauri v2 configuration with Windows targets
- `Cargo.toml` - Dependencies declared (fs, dialog, clipboard-manager, shell)
- `src/main.rs` - Entry point with window setup
- `src/lib.rs` - Command registration
- `src/commands/` - 3 custom commands implemented
- `icons/` - Complete icon set (18 files, all sizes)

**Issues:**
- `main.rs` references wrong crate name (`business_os_lib` instead of `projelli_lib`)
- No `Cargo.lock` - dependencies never resolved
- No `.cargo/` directory - toolchain not installed

#### Frontend Integration

**Present:**
- `@tauri-apps/api` in package.json
- `@tauri-apps/cli` in devDependencies
- `vite.config.ts` configured for Tauri (build target, TAURI_DEBUG flag)
- `TauriFSBackend.ts` implementation ready

**Issues:**
- `@tauri-apps/plugin-fs` missing from package.json
- `WorkspaceSelector.tsx` hardcoded to `WebFSBackend`
- No backend detection/selection logic

### Browser API Audit

**APIs That Work in Tauri WebView (No Changes Needed):**
- `localStorage` / `sessionStorage` - Used throughout app
- `Audio` API - Used in `src/components/audio/AudioRecorder.tsx`
- `fetch()` - Used for HTTP requests
- `navigator.clipboard.readText()` - Paste functionality
- `navigator.platform` - OS detection

**APIs Requiring Replacement:**

| Browser API | Usage Count | Files | Tauri Alternative | Severity |
|-------------|-------------|-------|-------------------|----------|
| `window.open()` | 6 | Various components | `@tauri-apps/plugin-shell` | High |
| `window.showSaveFilePicker()` | 4 | Export components | `@tauri-apps/plugin-dialog` | High |
| `window.prompt()` | 12 | User input scenarios | Custom modal dialog | Medium |
| `window.confirm()` | 7 | Delete confirmations | Custom modal dialog | Medium |

**APIs Needing Verification:**
- `webkitSpeechRecognition` - Used in voice input features (need to test in Tauri WebView)

---

## Blocker Analysis

### BLOCKER-1: Rust Crate Name Mismatch (Build Failure)
**Severity:** Critical - Prevents compilation
**Location:** `src-tauri/src/main.rs:4`
**Issue:** Code calls `business_os_lib::run()` but `Cargo.toml` declares crate as `projelli_lib`
**Impact:** `cargo build` will fail with "unresolved import" error
**Fix:** Change import to `projelli_lib::run()` or rename crate in `Cargo.toml`
**Estimated Effort:** 2 minutes

### BLOCKER-2: Missing Cargo.lock (Unresolved Dependencies)
**Severity:** Critical - Prevents compilation
**Location:** `src-tauri/` directory
**Issue:** No `Cargo.lock` file exists, dependencies never resolved
**Impact:** First `cargo build` will need to resolve ~200 transitive dependencies
**Fix:** Run `cargo build` to generate lock file (requires network)
**Estimated Effort:** 5-10 minutes (download time)

### BLOCKER-3: Missing @tauri-apps/plugin-fs npm Package
**Severity:** Critical - Runtime failure
**Location:** `package.json`, `TauriFSBackend.ts`
**Issue:** `TauriFSBackend.ts` imports from `@tauri-apps/plugin-fs` but package not installed
**Impact:** Module resolution error at runtime, backend will fail to load
**Fix:** `npm install @tauri-apps/plugin-fs`
**Estimated Effort:** 1 minute

### BLOCKER-4: Hardcoded WebFSBackend in UI
**Severity:** High - No Tauri code path
**Location:** `src/components/workspace/WorkspaceSelector.tsx`
**Issue:** Component directly instantiates `WebFSBackend`, no Tauri detection
**Impact:** App will use browser backend even in Tauri, defeating the purpose
**Fix:** Create backend factory with `window.__TAURI__` detection
**Estimated Effort:** 15 minutes

### BLOCKER-5: No Rust Toolchain (WSL2 Environment)
**Severity:** High - Cannot build
**Location:** Development environment
**Issue:** This is a WSL2 environment, no `rustc` or `cargo` installed
**Impact:** Cannot run `cargo build` or `cargo tauri build`
**Fix:** Install Rust via `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
**Estimated Effort:** 5 minutes
**Note:** May need Windows-side toolchain for actual .exe builds

### BLOCKER-6: WSL2 Cannot Produce Windows .exe
**Severity:** High - Wrong build target
**Location:** Development environment architecture
**Issue:** WSL2 runs Linux kernel, cannot directly produce Windows PE executables
**Impact:** Even with Rust installed, cannot create distributable Windows app
**Fix:** Either cross-compile with Windows target, or use Windows-side Rust toolchain
**Recommended:** Use Windows PowerShell/CMD with Rust installed natively
**Estimated Effort:** Requires Windows environment setup

### BLOCKER-7: Uncommitted Changes (5 Files)
**Severity:** Medium - Risk of losing work
**Location:** Git working directory
**Issue:** Recent bug fixes not committed (e.g., `TemplateManager.tsx`)
**Impact:** Changes could be lost during branch switches or merges
**Fix:** Commit changes or stash before starting migration work
**Estimated Effort:** 5 minutes

---

## Sprint 0: Foundation (Setup & Safety)

### WIN-001: Commit or Stash Uncommitted Work
**Type:** Safety
**Description:** The working directory has 5 uncommitted files from recent bug fixes. Before starting migration work, commit these changes to preserve them.
**Blockers Addressed:** BLOCKER-7
**Tasks:**
- Run `git status` to review uncommitted files
- Review changes in each file to ensure they're intentional
- Create commit: "Fix template editor bugs and voice input issues"
- Push to remote backup

**Acceptance Criteria:**
- [ ] All 5 files committed
- [ ] Commit message describes the bug fixes
- [ ] Changes pushed to remote

---

### WIN-002: Create Migration Feature Branch
**Type:** Git workflow
**Description:** Create a dedicated branch for Windows migration work to isolate changes from main development.
**Tasks:**
- Create branch: `git checkout -b feature/windows-desktop-migration`
- Push branch to remote: `git push -u origin feature/windows-desktop-migration`
- Verify branch protection rules don't block PRs

**Acceptance Criteria:**
- [ ] Branch created and checked out
- [ ] Branch pushed to remote
- [ ] Branch visible in GitHub/GitLab

---

### WIN-003: Install Rust Toolchain (Windows-Side)
**Type:** Environment setup
**Description:** Install Rust toolchain on Windows (not WSL2) to enable native Windows builds.
**Blockers Addressed:** BLOCKER-5, BLOCKER-6
**Tasks:**
- Download rustup from https://rustup.rs/ on Windows
- Run installer, select default options
- Verify installation: `rustc --version` and `cargo --version`
- Add `wasm32-unknown-unknown` target if needed: `rustup target add wasm32-unknown-unknown`
- Install Windows build tools (MSVC) if prompted

**Acceptance Criteria:**
- [ ] `rustc --version` shows 1.70+ on Windows
- [ ] `cargo --version` works
- [ ] Can run `cargo new test-project` successfully

**Notes:**
- WSL2 cannot produce Windows .exe files
- Tauri builds must run in Windows environment (PowerShell/CMD)
- Development workflow: edit in WSL2, build in Windows

---

## Sprint 1: Fix Build Blockers

### WIN-004: Fix Rust Crate Name in main.rs
**Type:** Bug fix
**File:** `src-tauri/src/main.rs`
**Description:** Correct the crate import from `business_os_lib::run()` to `projelli_lib::run()` to match the actual crate name defined in `Cargo.toml`.
**Blockers Addressed:** BLOCKER-1
**Tasks:**
- Open `src-tauri/src/main.rs`
- Change line 4 from `use business_os_lib::run;` to `use projelli_lib::run;`
- Save file

**Acceptance Criteria:**
- [ ] Import statement uses correct crate name
- [ ] No other references to `business_os_lib` in codebase

---

### WIN-005: Install Missing npm Packages
**Type:** Dependency management
**Description:** Install missing Tauri plugins required by `TauriFSBackend.ts`.
**Blockers Addressed:** BLOCKER-3
**Tasks:**
- Run `npm install @tauri-apps/plugin-fs --save`
- Run `npm install @tauri-apps/plugin-dialog --save` (needed for save dialogs)
- Run `npm install @tauri-apps/plugin-shell --save` (needed for opening URLs)
- Verify `package.json` updated

**Acceptance Criteria:**
- [ ] All three packages in `dependencies` section of `package.json`
- [ ] `node_modules/@tauri-apps/plugin-*` directories exist
- [ ] No npm warnings about peer dependencies

---

### WIN-006: First Rust Build (Generate Cargo.lock)
**Type:** Build verification
**Description:** Perform first Rust compilation to resolve dependencies and generate `Cargo.lock`. This must be done on Windows, not WSL2.
**Blockers Addressed:** BLOCKER-2
**Tasks:**
- Open Windows PowerShell or CMD
- Navigate to project: `cd \home\jameson\SAMUS\examples\projects\projelli` (adjust path)
- Run `cd src-tauri`
- Run `cargo build`
- Wait for dependency resolution and compilation (may take 5-10 minutes)
- Fix any compilation errors that appear

**Acceptance Criteria:**
- [ ] `Cargo.lock` file created in `src-tauri/`
- [ ] Build completes without errors
- [ ] Binary produced in `src-tauri/target/debug/`

**Expected Issues:**
- May need to install MSVC build tools if prompted
- First build will download ~200 crates

---

### WIN-007: Commit Build Configuration Fixes
**Type:** Git workflow
**Description:** Commit the fixes from WIN-004, WIN-005, WIN-006 to save progress.
**Tasks:**
- Run `git add src-tauri/src/main.rs package.json package-lock.json src-tauri/Cargo.lock`
- Create commit: "Fix Rust build blockers: crate name, npm deps, Cargo.lock"
- Push to remote

**Acceptance Criteria:**
- [ ] All build configuration fixes committed
- [ ] Commit message is descriptive
- [ ] Changes pushed to remote

---

## Sprint 2: Wire Up Tauri Backend

### WIN-008: Create Backend Factory
**Type:** Feature implementation
**File:** Create `src/infrastructure/fs/BackendFactory.ts`
**Description:** Create a factory function that detects Tauri environment and returns the appropriate backend.
**Blockers Addressed:** BLOCKER-4
**Implementation:**
```typescript
// src/infrastructure/fs/BackendFactory.ts
import { FSBackend } from '../../domain/interfaces/FSBackend';
import { WebFSBackend } from './WebFSBackend';
import { TauriFSBackend } from './TauriFSBackend';

/**
 * Detects runtime environment and returns appropriate FSBackend.
 * - In Tauri: Returns TauriFSBackend (native filesystem)
 * - In browser: Returns WebFSBackend (File System Access API)
 */
export async function createFSBackend(workspacePath: string): Promise<FSBackend> {
  // @ts-ignore - __TAURI__ is injected by Tauri runtime
  const isTauri = typeof window !== 'undefined' && window.__TAURI__;

  if (isTauri) {
    console.log('[BackendFactory] Tauri environment detected, using TauriFSBackend');
    return new TauriFSBackend(workspacePath);
  } else {
    console.log('[BackendFactory] Browser environment detected, using WebFSBackend');
    // WebFSBackend needs directory handle from picker
    // This will be handled in WorkspaceSelector
    return new WebFSBackend();
  }
}

export function isTauriEnvironment(): boolean {
  // @ts-ignore
  return typeof window !== 'undefined' && window.__TAURI__;
}
```

**Acceptance Criteria:**
- [ ] Factory detects `window.__TAURI__` correctly
- [ ] Returns `TauriFSBackend` in Tauri
- [ ] Returns `WebFSBackend` in browser
- [ ] Includes console logging for debugging

---

### WIN-009: Update WorkspaceSelector for Dual-Mode
**Type:** Feature implementation
**File:** `src/components/workspace/WorkspaceSelector.tsx`
**Description:** Update `WorkspaceSelector` to use the backend factory instead of hardcoded `WebFSBackend`.
**Blockers Addressed:** BLOCKER-4
**Tasks:**
- Import `createFSBackend` and `isTauriEnvironment` from `BackendFactory`
- Replace direct `WebFSBackend` instantiation with factory call
- Add Tauri-specific workspace selection UI (path input instead of directory picker)
- Handle both browser and Tauri flows

**Key Changes:**
```typescript
// In Tauri: Show path input and "Open" button
if (isTauriEnvironment()) {
  // Path-based selection
  const backend = await createFSBackend(selectedPath);
  onWorkspaceSelected(backend);
} else {
  // Browser: Show directory picker
  const handle = await window.showDirectoryPicker();
  const backend = new WebFSBackend();
  await backend.initialize(handle);
  onWorkspaceSelected(backend);
}
```

**Acceptance Criteria:**
- [ ] Component detects Tauri environment
- [ ] Shows path input UI in Tauri
- [ ] Shows directory picker button in browser
- [ ] Both paths successfully create backend
- [ ] `WorkspaceService` receives correct backend

---

### WIN-010: Add Tauri Dialog Plugin to Rust
**Type:** Configuration
**File:** `src-tauri/src/main.rs`
**Description:** Register dialog plugin in Tauri app to enable save dialogs.
**Tasks:**
- Add to plugin list: `.plugin(tauri_plugin_dialog::init())`
- Add to plugin list: `.plugin(tauri_plugin_shell::init())`
- Verify plugins are in `Cargo.toml` dependencies
- Rebuild: `cargo build`

**Acceptance Criteria:**
- [ ] Plugins registered in `main.rs`
- [ ] Build completes without errors
- [ ] Plugins available in frontend

---

### WIN-011: First Tauri Dev Launch
**Type:** Integration test
**Description:** Launch the app in Tauri development mode for the first time to verify the wiring works.
**Tasks:**
- Open Windows terminal in project root
- Run `npm run tauri dev` (or `cargo tauri dev`)
- Wait for Vite build and Tauri window to open
- Check console for backend selection logs
- Try opening a workspace using path input
- Verify `TauriFSBackend` is used

**Acceptance Criteria:**
- [ ] Tauri window opens with app UI
- [ ] Console shows "Tauri environment detected"
- [ ] Can select workspace via path input
- [ ] No errors in console or Rust logs

**Expected Issues:**
- May need to grant filesystem permissions in `tauri.conf.json`
- May need to add workspace paths to `fs` scope

---

### WIN-012: Commit Backend Wiring
**Type:** Git workflow
**Description:** Commit the backend factory and WorkspaceSelector changes.
**Tasks:**
- Run `git add src/infrastructure/fs/BackendFactory.ts src/components/workspace/WorkspaceSelector.tsx src-tauri/src/main.rs`
- Create commit: "Wire up Tauri backend with environment detection"
- Push to remote

**Acceptance Criteria:**
- [ ] All backend wiring changes committed
- [ ] Commit message is descriptive

---

## Sprint 3: Browser API Replacements

### WIN-013: Replace window.open() with Tauri Shell Plugin
**Type:** Feature implementation
**Files:** 6 files using `window.open()`
**Description:** Replace browser `window.open()` calls with Tauri shell plugin to open URLs in system default browser.
**Tasks:**
- Search codebase for `window.open(` usage
- For each occurrence, add Tauri detection:
```typescript
import { open } from '@tauri-apps/plugin-shell';

async function openExternalLink(url: string) {
  if (isTauriEnvironment()) {
    await open(url);
  } else {
    window.open(url, '_blank');
  }
}
```
- Replace all 6 usages with wrapper function
- Test in both browser and Tauri

**Acceptance Criteria:**
- [ ] All 6 `window.open()` calls replaced
- [ ] Links open in system browser in Tauri
- [ ] Links still work in browser mode
- [ ] No console errors

---

### WIN-014: Replace window.showSaveFilePicker() with Tauri Dialog
**Type:** Feature implementation
**Files:** 4 export-related files
**Description:** Replace browser save file picker with Tauri dialog plugin for native save dialogs.
**Tasks:**
- Search for `window.showSaveFilePicker(` usage
- For each occurrence, add Tauri version:
```typescript
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

async function saveFile(content: string, defaultName: string) {
  if (isTauriEnvironment()) {
    const path = await save({ defaultPath: defaultName });
    if (path) {
      await writeFile(path, content);
    }
  } else {
    const handle = await window.showSaveFilePicker({ suggestedName: defaultName });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }
}
```
- Replace all 4 usages
- Test export functionality in Tauri

**Acceptance Criteria:**
- [ ] All 4 save pickers replaced
- [ ] Native save dialog appears in Tauri
- [ ] Files save correctly to chosen location
- [ ] Browser mode still works

---

### WIN-015: Audit window.prompt() and window.confirm() Usage
**Type:** Assessment
**Description:** Review all 19 usages of `window.prompt()` (12) and `window.confirm()` (7) to determine which need native replacements.
**Tasks:**
- Search for `window.prompt(` and `window.confirm(`
- Categorize each usage:
  - Critical UX (needs custom dialog)
  - Acceptable as-is (low priority)
  - Could use Tauri native dialogs
- Document findings in this ticket
- Create follow-up tickets for replacements

**Acceptance Criteria:**
- [ ] All 19 usages catalogued
- [ ] Criticality assigned to each
- [ ] Recommendations documented

**Note:** These dialogs work in Tauri but feel non-native. Consider replacing critical ones with custom React modals or Tauri `message` dialogs.

---

### WIN-016: Test SpeechRecognition API in Tauri
**Type:** Verification
**Files:** Voice input components
**Description:** Test whether `webkitSpeechRecognition` works in Tauri WebView (Chromium-based).
**Tasks:**
- Launch app in Tauri dev mode
- Navigate to voice input feature
- Test speech recognition functionality
- Document results:
  - If works: No action needed
  - If fails: Research Tauri alternatives or native speech APIs

**Acceptance Criteria:**
- [ ] Voice input tested in Tauri
- [ ] Results documented
- [ ] If broken, replacement plan created

---

### WIN-017: Update CSP and Capabilities in tauri.conf.json
**Type:** Configuration
**File:** `src-tauri/tauri.conf.json`
**Description:** Review and update Content Security Policy and permission scopes based on actual usage.
**Tasks:**
- Review current CSP in `tauri.conf.json`
- Add any needed domains for external resources
- Review `fs` scope - ensure workspace paths are allowed
- Review `dialog` capabilities
- Test app with strict CSP to catch violations

**Acceptance Criteria:**
- [ ] CSP allows all required resources
- [ ] FS scope covers workspace operations
- [ ] No CSP violations in console
- [ ] App functions correctly with strict permissions

---

### WIN-018: Commit Browser API Replacements
**Type:** Git workflow
**Description:** Commit all browser API replacement work from Sprint 3.
**Tasks:**
- Review all changed files
- Run `git add` for all modified files
- Create commit: "Replace browser APIs with Tauri alternatives (shell, dialog)"
- Push to remote

**Acceptance Criteria:**
- [ ] All API replacements committed
- [ ] Commit message is descriptive

---

## Sprint 4: Windows Installer & Polish

### WIN-019: Production Build Test
**Type:** Build verification
**Description:** Create a production Windows build for the first time.
**Tasks:**
- Run `npm run tauri build` on Windows
- Wait for build (may take 10-15 minutes first time)
- Verify outputs in `src-tauri/target/release/bundle/`:
  - `.msi` installer
  - `.exe` installer (NSIS)
  - Standalone `.exe`
- Test installer on clean Windows machine
- Document build artifacts and sizes

**Acceptance Criteria:**
- [ ] Build completes without errors
- [ ] MSI installer created
- [ ] NSIS installer created
- [ ] Installers work on clean Windows 10/11

---

### WIN-020: Update App Branding
**Type:** Polish
**Files:** `src-tauri/tauri.conf.json`, `package.json`
**Description:** Review and update app metadata for professional Windows app.
**Tasks:**
- Update `productName` in `tauri.conf.json` (currently "Projelli")
- Update `version` to `1.0.0`
- Update `identifier` (currently "com.projelli.app")
- Update `description`
- Review `copyright` string
- Update `publisher` in Windows installer config
- Update `shortDescription` and `longDescription`

**Acceptance Criteria:**
- [ ] All branding strings professional and accurate
- [ ] Version set to 1.0.0
- [ ] Copyright year current (2026)
- [ ] Installer shows correct publisher info

---

### WIN-021: Create Custom Prompt/Confirm Dialogs
**Type:** Feature implementation (Optional)
**Description:** Replace critical `window.prompt()` and `window.confirm()` with custom React modal dialogs for better UX.
**Tasks:**
- Create `src/components/common/ConfirmDialog.tsx`
- Create `src/components/common/PromptDialog.tsx`
- Use React context or Zustand store for dialog management
- Replace high-priority usages identified in WIN-015
- Style dialogs to match app theme

**Acceptance Criteria:**
- [ ] Custom dialogs created
- [ ] Dialogs match app design
- [ ] Critical usages replaced
- [ ] Dialogs work in both browser and Tauri

**Priority:** Optional - can defer to post-launch if time-constrained

---

### WIN-022: Add Keychain/Credential Storage (Optional)
**Type:** Feature implementation (Optional)
**Description:** Use Tauri keychain plugin to securely store sensitive data (API keys, auth tokens) in Windows Credential Manager.
**Tasks:**
- Add `tauri-plugin-keychain` to `Cargo.toml`
- Register plugin in `main.rs`
- Install `@tauri-apps/plugin-keychain` npm package
- Create secure storage service
- Migrate sensitive `localStorage` usage to keychain

**Acceptance Criteria:**
- [ ] Keychain plugin integrated
- [ ] Sensitive data stored securely
- [ ] Falls back to localStorage in browser mode

**Priority:** Optional - security enhancement for future version

---

### WIN-023: Implement Recent Workspaces List (Optional)
**Type:** Feature implementation (Optional)
**Description:** Store recently opened workspace paths for quick access on startup.
**Tasks:**
- Use `localStorage` or Tauri settings to store recent paths
- Update `WorkspaceSelector` to show recent list
- Add "Open Recent" menu in workspace selector
- Limit to last 5 workspaces

**Acceptance Criteria:**
- [ ] Recent workspaces stored persistently
- [ ] UI shows recent list
- [ ] Clicking recent opens workspace directly

**Priority:** Optional - UX enhancement for future version

---

### WIN-024: Comprehensive Manual Testing
**Type:** QA
**Description:** Perform full manual test of all app features in Windows desktop mode.
**Test Checklist:**
- [ ] Launch app from installed version
- [ ] Select workspace via path input
- [ ] Create new project
- [ ] Create tasks, templates, documents
- [ ] Test audio recording (microphone permissions)
- [ ] Test voice input (speech recognition)
- [ ] Test all export functions (JSON, Markdown, etc.)
- [ ] Test external link opening (opens in system browser)
- [ ] Test keyboard shortcuts
- [ ] Test clipboard paste
- [ ] Test file operations (create, edit, delete, rename)
- [ ] Close and reopen app (persistence check)
- [ ] Test on Windows 10 and Windows 11
- [ ] Test with antivirus software enabled

**Bug Triage:**
- Document all issues found
- Create tickets for critical bugs
- Prioritize fixes before release

**Acceptance Criteria:**
- [ ] All features tested
- [ ] No critical bugs
- [ ] Known issues documented

---

### WIN-025: Create Release Build
**Type:** Release
**Description:** Create final release build with all fixes and polish applied.
**Tasks:**
- Ensure all code changes committed
- Update version to `1.0.0` if not already done
- Run `npm run tauri build` on Windows
- Sign executables (if code signing cert available)
- Test installers on clean machines
- Package release artifacts:
  - `Projelli_1.0.0_x64_en-US.msi`
  - `Projelli_1.0.0_x64-setup.exe` (NSIS)
- Create checksums (SHA256) for all artifacts
- Test auto-update mechanism (if configured)

**Acceptance Criteria:**
- [ ] Release build created
- [ ] Installers tested and working
- [ ] Artifacts packaged with checksums
- [ ] Version matches 1.0.0

---

### WIN-026: Tag Release and Update Documentation
**Type:** Release workflow
**Description:** Tag the release in git and update project documentation.
**Tasks:**
- Create git tag: `git tag -a v1.0.0-windows -m "Windows desktop release"`
- Push tag: `git push origin v1.0.0-windows`
- Merge feature branch to main (if ready)
- Update README.md:
  - Add Windows installation instructions
  - Document system requirements
  - Add screenshots of Windows app
- Create GitHub Release (if using GitHub):
  - Upload MSI and NSIS installers
  - Upload checksums
  - Write release notes
- Update any setup/installation docs

**Acceptance Criteria:**
- [ ] Git tag created and pushed
- [ ] README.md updated
- [ ] Release notes published
- [ ] Installers available for download

---

## Development Workflow

### Working Across WSL2 and Windows

**The Challenge:** This project is currently in a WSL2 environment, but Tauri must build Windows executables using native Windows tooling.

**Recommended Setup:**

1. **Code Editing:** Continue using WSL2 for development
   - VS Code with WSL extension
   - Git operations
   - Node/npm commands
   - File editing

2. **Tauri Builds:** Use Windows terminal for compilation
   - Install Rust on Windows (not WSL)
   - Open PowerShell or Windows Terminal
   - Navigate to project: `cd \\wsl$\Ubuntu\home\jameson\SAMUS\examples\projects\projelli`
   - Run `npm run tauri dev` or `npm run tauri build`

**Workflow Steps:**
```bash
# In WSL2 - Edit code
vim src/components/SomeComponent.tsx
git add .
git commit -m "Update component"

# In Windows PowerShell - Build
cd \\wsl$\Ubuntu\home\jameson\SAMUS\examples\projects\projelli
npm run tauri dev  # or: cargo tauri dev
```

**Alternative:** Use Windows-native development environment
- Install Node, npm, Rust on Windows
- Clone repo to Windows filesystem (C:\Projects\projelli)
- Use Windows tools exclusively

### Using Claude Code for Ongoing Work

When using Claude Code to continue Windows migration work:

1. **Specify Environment:** Tell Claude whether you're in WSL2 or Windows
2. **Request Tauri Builds:** Explicitly ask "build this in Windows" when testing
3. **Dual Testing:** Test changes in both browser and Tauri modes
4. **Use Ticket IDs:** Reference ticket IDs (WIN-001, etc.) for context

**Example Prompts:**
- "Implement ticket WIN-009, test in both browser and Tauri"
- "Build the Tauri app on Windows and verify the backend selection works"
- "Replace window.open() calls as described in WIN-013"

### Development vs. Production Builds

**Development Mode:**
```bash
npm run tauri dev
```
- Hot reload enabled
- DevTools accessible
- Console logging visible
- Faster iteration

**Production Build:**
```bash
npm run tauri build
```
- Optimized bundle
- No DevTools
- Creates installers
- Slower (10-15 minutes)

Use dev mode for all Sprint 1-3 work. Only use production builds for Sprint 4 testing and release.

---

## Testing Strategy

### Browser Testing (Unchanged)

**Existing Test Suite:**
- Continue running all existing browser-based tests
- Jest unit tests: `npm test`
- React component tests: `npm run test:components`
- E2E tests (if any): `npm run test:e2e`

**Why:** The core business logic is platform-agnostic. All domain services, components, and utilities work identically in both environments. Existing tests remain valid.

### Tauri-Specific Testing

**New Test Requirements:**

1. **Backend Integration Tests:**
   - Create `src/infrastructure/fs/__tests__/TauriFSBackend.test.ts`
   - Test file operations with actual filesystem (not mocks)
   - Test workspace-scoped operations
   - Test permission errors

2. **Environment Detection Tests:**
   - Test `BackendFactory` returns correct backend
   - Test `isTauriEnvironment()` function
   - Mock `window.__TAURI__` in tests

3. **Manual Testing Checklist:** (See WIN-024)
   - All features tested in Tauri window
   - Windows-specific behaviors verified
   - Permission dialogs tested

### Test Data Setup

**For Tauri Tests:**
- Create test workspace: `C:\Users\YourName\Documents\ProjelliiTest`
- Populate with sample projects
- Use this for manual testing in WIN-024

### Regression Prevention

**After Migration:**
- Add CI check for both browser and Tauri builds
- Run unit tests in both environments
- Maintain dual-mode support (never drop browser mode)

---

## Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Rust build fails on Windows with cryptic errors** | Medium | High | Install MSVC build tools first, follow Tauri prerequisites exactly, search errors on Tauri Discord |
| **TauriFSBackend has permission issues on Windows** | High | High | Test fs scope in `tauri.conf.json` early, add workspace paths explicitly, test with antivirus enabled |
| **Speech recognition doesn't work in Tauri WebView** | Medium | Medium | Test early (WIN-016), have fallback plan (native speech API or disable feature) |
| **Browser mode breaks after Tauri changes** | Low | High | Test both modes after every sprint, maintain separate code paths, never remove browser support |
| **Build artifacts too large (100+ MB)** | Medium | Low | Acceptable for desktop app, consider UPX compression if needed, optimize later |
| **Auto-update mechanism fails** | Medium | Medium | Test update server config, use Tauri's built-in updater, have manual update fallback |
| **Code signing required for Windows SmartScreen** | High | Low | App will show "unknown publisher" warning without cert, acceptable for v1.0, buy cert later (~$200/year) |
| **WSL2 filesystem performance issues** | Low | Medium | Move repo to Windows filesystem if slow, use native Windows dev environment |
| **Antivirus flags executable as malware** | Low | High | Use code signing to prevent, submit installers to antivirus vendors, whitelist in development |
| **Custom dialogs feel inconsistent with Windows UI** | Medium | Low | Use native Tauri dialogs where possible, style custom dialogs conservatively, accept minor inconsistency |

---

## Success Criteria

This migration is **complete** and **successful** when:

1. **Build System:**
   - [ ] `npm run tauri build` completes without errors on Windows
   - [ ] Produces working MSI and NSIS installers
   - [ ] Installers run on clean Windows 10 and 11 machines

2. **Functionality:**
   - [ ] All existing browser features work in desktop app
   - [ ] Workspace selection works via path input
   - [ ] File operations use native filesystem (not browser API)
   - [ ] External links open in system browser
   - [ ] Save dialogs use native Windows dialogs

3. **User Experience:**
   - [ ] App launches quickly (< 3 seconds)
   - [ ] No visible console or terminal windows
   - [ ] App icon appears in taskbar and start menu
   - [ ] App feels like native Windows application

4. **Code Quality:**
   - [ ] No TypeScript errors
   - [ ] No Rust warnings
   - [ ] All 7 blockers resolved
   - [ ] Browser mode still works (dual-mode support)

5. **Documentation:**
   - [ ] README updated with Windows installation instructions
   - [ ] All 26 tickets completed
   - [ ] Known issues documented

6. **Testing:**
   - [ ] Manual test checklist (WIN-024) completed
   - [ ] No critical bugs
   - [ ] Release tagged in git

---

## Next Steps

1. **Review this document** - Ensure all stakeholders agree on the plan
2. **Set up Windows development environment** - Install Rust, verify toolchain (WIN-003)
3. **Start with Sprint 0** - Foundation work (git safety, branch creation)
4. **Execute sprints sequentially** - Don't skip ahead, each sprint builds on previous
5. **Test continuously** - Verify both browser and Tauri modes after each change
6. **Document issues** - Create new tickets for unexpected problems

**Estimated Timeline:**
- Sprint 0: 30 minutes
- Sprint 1: 2 hours
- Sprint 2: 4 hours
- Sprint 3: 6 hours
- Sprint 4: 8 hours
- **Total: ~20 hours of development work**

(Note: Timeline assumes single developer, excludes testing/debugging time, may vary based on experience with Tauri and Rust)

---

## Appendix: Key File Locations

**Tauri Configuration:**
- `src-tauri/tauri.conf.json` - Main Tauri config
- `src-tauri/Cargo.toml` - Rust dependencies
- `src-tauri/src/main.rs` - Rust entry point
- `src-tauri/src/lib.rs` - Command registration

**Frontend Integration:**
- `src/infrastructure/fs/TauriFSBackend.ts` - Tauri filesystem backend
- `src/infrastructure/fs/WebFSBackend.ts` - Browser filesystem backend
- `src/domain/interfaces/FSBackend.ts` - Backend interface
- `src/components/workspace/WorkspaceSelector.tsx` - Workspace UI

**Build Configuration:**
- `vite.config.ts` - Vite config (Tauri-aware)
- `package.json` - npm scripts and dependencies

**Icons:**
- `src-tauri/icons/*.png` - All app icons (18 files)

---

**Document Version:** 1.0
**Created:** 2026-01-28
**Status:** Ready for Implementation
