# Plan: Projelli V1 Launch

## 🎯 NEXT STEPS (Manual - Do on Windows)

**Everything below is ready! Now you need to build and release on native Windows:**

1. **Open Windows PowerShell** (not WSL)
2. **Navigate to project:** `cd C:\Users\james\Projects\projelli`
3. **Install Rust** (if not installed): `winget install Rustlang.Rustup`
4. **Pull latest code:** `git pull origin master`
5. **Install dependencies:** `npm install`
6. **Build for production:** `npm run tauri build`
7. **Create GitHub Release:**
   - Go to: https://github.com/joelbridger/projelli/releases/new?tag=v1.0.0
   - Title: "Projelli v1.0.0 - Initial Release"
   - Upload: `src-tauri/target/release/bundle/nsis/Projelli_1.0.0_x64-setup.exe`
   - Upload: `src-tauri/target/release/bundle/msi/Projelli_1.0.0_x64_en-US.msi`
   - Publish release
8. **Verify:** Visit https://projelli.com and test download

---

## Overview

Launch Projelli V1 (free-only) on projelli.com with a working Windows desktop download.

**Project:** `/mnt/c/Users/james/Projects/projelli/`
**Website:** `website/index.html` (self-contained landing page)
**Hosting:** Home server at `ssh jameson@10.0.0.88`
**GitHub:** https://github.com/joelbridger/projelli
**Strategy:** Ship all features free, add monetization later

---

## Current State

- All 41 core tickets DONE
- All 11 Windows UI fixes DONE
- All 26 migration tickets DONE
- 200+ uncommitted changes on `feature/windows-desktop-migration` branch
- Website exists but download links are placeholders (`#`)
- Never built on native Windows yet (WSL2 development only)

---

## Phase 0: Create Launch Documentation ✅

### LAUNCH-000: Create V1_LAUNCH_PLAN.md ✅
- **File:** `/mnt/c/Users/james/Projects/projelli/V1_LAUNCH_PLAN.md`
- Create permanent launch plan document in project root
- Include all analysis, decisions, and checklist for V1 launch
- Track progress as we execute each step

---

## Phase 1: Commit & Merge ✅

### LAUNCH-001: Create GitHub Repository ✅
- **URL:** `https://github.com/joelbridger/projelli`
- ✅ Created public repo using `gh repo create`
- ✅ Remote configured to HTTPS (due to SSH auth limitations)

### LAUNCH-002: Commit All Changes ✅
- ✅ Committed 274 files with 8,457 insertions
- ✅ Merged `feature/windows-desktop-migration` to `master`
- ✅ Pushed to GitHub (excluding workflow files due to OAuth scope)
- **Note:** Workflow files in `.github/workflows` need manual push with `workflow` scope

---

## Phase 2: Windows Build

### LAUNCH-003: Install Rust on Windows (Native, Not WSL) ⏸️
- Open **Windows PowerShell** (not WSL)
- Download and run: `winget install Rustlang.Rustup` or https://rustup.rs
- Verify: `rustc --version`
- This is required because WSL2 cannot produce Windows .exe files
- **NOTE:** This step must be done manually on native Windows

### LAUNCH-004: First Tauri Build ⏸️
- Open **Windows Terminal** (PowerShell, not WSL)
- Navigate to project: `cd C:\Users\james\Projects\projelli`
- Install deps: `npm install`
- Dev build (generates Cargo.lock): `npm run tauri dev`
- Wait for Rust compilation (first build takes a while)
- Test the app manually
- **NOTE:** This step must be done manually on native Windows

### LAUNCH-005: Production Build ⏸️
- **Command:** `npm run tauri build`
- **Output:**
  - `src-tauri/target/release/bundle/msi/Projelli_0.1.0_x64_en-US.msi`
  - `src-tauri/target/release/bundle/nsis/Projelli_0.1.0_x64-setup.exe`
- Quick smoke test: install and run the .exe
- **NOTE:** This step must be done manually on native Windows

---

## Phase 3: GitHub Release

### LAUNCH-006: Version Bump to 1.0.0 ✅
- ✅ Updated `package.json` to version "1.0.0"
- ✅ Updated `src-tauri/tauri.conf.json` to version "1.0.0"
- ✅ Updated `src-tauri/Cargo.toml` to version "1.0.0"
- ✅ Committed and pushed changes

### LAUNCH-007: Create Release Tag & GitHub Release 🔄
- ✅ Created and pushed tag `v1.0.0`
- ⏸️ **NEXT STEP:** Build Windows installer (LAUNCH-005 on native Windows)
- ⏸️ **THEN:** Manually create GitHub release and upload build artifacts
- **URL:** https://github.com/joelbridger/projelli/releases/new?tag=v1.0.0

---

## Phase 4: Update Website ✅

### LAUNCH-008: Update Download Links ✅
- ✅ Updated all download buttons to point to:
  `https://github.com/joelbridger/projelli/releases/download/v1.0.0/Projelli_1.0.0_x64-setup.exe`
- ✅ Mobile menu: "Download for Windows"
- ✅ Hero CTA: "Download for Windows"
- ✅ Final CTA: "Download for Windows"
- ✅ Changed "Open Web App" to "View on GitHub"

### LAUNCH-009: Simplify to Free-Only ✅
- ✅ Pro tier button: Disabled with "Coming Soon"
- ✅ Added message: "All features currently free during beta"
- ✅ Starter tier: Points to download link

---

## Phase 5: Deploy to Home Server ✅

### LAUNCH-010: Deploy Website ✅
- ✅ Deployed to `/var/www/projelli.com/index.html`
- ✅ Set proper permissions (www-data:www-data)
- ✅ Website live at https://projelli.com
- **Note:** Download links point to GitHub release that needs to be created

---

## Verification Checklist

- [x] **GitHub Repo:** https://github.com/joelbridger/projelli exists with code pushed
- [ ] **GitHub Release:** v1.0.0 exists with .exe and .msi downloads
- [x] **projelli.com:** Download button links to GitHub release
- [ ] **Download works:** Click download, run installer, app opens
- [ ] **Basic smoke test:** Create workspace, create file, use AI chat

---

## Files to Modify

| File | Change | Status |
|------|--------|--------|
| `V1_LAUNCH_PLAN.md` | Create launch plan | ✅ |
| `package.json` | version: "1.0.0" | ✅ |
| `src-tauri/tauri.conf.json` | version: "1.0.0" | ✅ |
| `src-tauri/Cargo.toml` | version = "1.0.0" | ✅ |
| `website/index.html` | Download links, pricing (free-only) | ✅ |

---

## Out of Scope (V1.1+)

- Pro tier monetization / payment processing
- macOS / Linux builds
- Auto-update functionality
- Code signing certificate (SmartScreen warning expected)

---

## Progress Legend

- ✅ Completed
- ⏳ Ready to execute (can be done now)
- ⏸️ Blocked / Manual step required
- ❌ Failed / Needs attention
