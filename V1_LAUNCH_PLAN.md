# Plan: Projelli V1 Launch

## Overview

Launch Projelli V1 (free-only) on projelli.com with a working Windows desktop download.

**Project:** `/mnt/c/Users/james/Projects/projelli/`
**Website:** `website/index.html` (self-contained landing page)
**Hosting:** Home server at `ssh jameson@10.0.0.88`
**GitHub:** `github.com/joelbridger/projelli`
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

## Phase 1: Commit & Merge

### LAUNCH-001: Create GitHub Repository ⏳
- **URL:** `https://github.com/joelbridger/projelli`
- Create new public repo on GitHub (no README, no .gitignore - we have code already)
- Add remote: `git remote add origin https://github.com/joelbridger/projelli.git`

### LAUNCH-002: Commit All Changes ⏳
- **Files:** 200+ modified/untracked files
- **Command:** `git add -A && git commit -m "Complete V1: all features, Windows migration, UI fixes"`
- **Then:** Merge to main: `git checkout main && git merge feature/windows-desktop-migration`
- Push: `git push -u origin main`

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

### LAUNCH-006: Version Bump to 1.0.0 ⏳
- **Files to update:**
  - `package.json` - version: "1.0.0"
  - `src-tauri/tauri.conf.json` - version: "1.0.0"
  - `src-tauri/Cargo.toml` - version = "1.0.0"
- Commit: `git commit -am "Bump version to 1.0.0"`
- Push: `git push`

### LAUNCH-007: Create Release Tag & GitHub Release ⏸️
- Tag: `git tag v1.0.0 && git push origin main --tags`
- This triggers `.github/workflows/release.yml` which:
  - Builds Windows installer
  - Creates draft GitHub release with .msi and .exe attached
  - Generates SHA256 checksums
- **OR** create release manually and upload the build artifacts from LAUNCH-005
- **NOTE:** This step requires LAUNCH-005 to be completed first

---

## Phase 4: Update Website

### LAUNCH-008: Update Download Links ⏳
- **File:** `website/index.html`
- Replace all `href="#"` on download buttons with actual GitHub release URL:
  ```
  https://github.com/joelbridger/projelli/releases/download/v1.0.0/Projelli_1.0.0_x64-setup.exe
  ```
- Update pricing section: Remove Pro tier price, make it "Coming Soon" or just show Free tier

### LAUNCH-009: Simplify to Free-Only ⏳
- **File:** `website/index.html`
- Remove or grey out Pro tier pricing ($12/mo)
- Change to: "Free" and "Pro (Coming Soon)" or just show single Free tier
- All features listed as included in free version

---

## Phase 5: Deploy to Home Server

### LAUNCH-010: Deploy Website ⏳
- **Server:** `ssh jameson@10.0.0.88`
- **Commands:**
  ```bash
  # From WSL/local:
  scp /mnt/c/Users/james/Projects/projelli/website/index.html jameson@10.0.0.88:/var/www/projelli.com/

  # Or if using a different web root, find it first:
  ssh jameson@10.0.0.88 "ls -la /var/www/ && cat /etc/nginx/sites-enabled/*"
  ```
- Verify: Open https://projelli.com in browser

---

## Verification Checklist

- [ ] **GitHub Repo:** https://github.com/joelbridger/projelli exists with code pushed
- [ ] **GitHub Release:** v1.0.0 exists with .exe and .msi downloads
- [ ] **projelli.com:** Download button links to GitHub release
- [ ] **Download works:** Click download, run installer, app opens
- [ ] **Basic smoke test:** Create workspace, create file, use AI chat

---

## Files to Modify

| File | Change | Status |
|------|--------|--------|
| `V1_LAUNCH_PLAN.md` | Create launch plan | ✅ |
| `package.json` | version: "1.0.0" | ⏳ |
| `src-tauri/tauri.conf.json` | version: "1.0.0" | ⏳ |
| `src-tauri/Cargo.toml` | version = "1.0.0" | ⏳ |
| `website/index.html` | Download links, pricing (free-only) | ⏳ |

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
