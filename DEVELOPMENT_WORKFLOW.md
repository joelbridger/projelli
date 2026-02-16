# Projelli Development Workflow

## 🎯 Overview

This guide explains how to continue developing, testing, and updating Projelli after the v1.0.0 launch.

---

## 📁 Repository Structure

- **GitHub:** https://github.com/joelbridger/projelli
- **Website:** https://projelli.com (served from home server)
- **Development:** WSL2 for code editing, native Windows for building
- **Branch Strategy:** `master` branch for production releases

---

## 🔄 Daily Development Workflow

### 1. **Making Code Changes** (WSL2)

```bash
cd /mnt/c/Users/james/Projects/projelli

# Pull latest changes
git pull origin master

# Make your code changes using your editor
# Test in development mode (if you have a way to run dev on Windows)

# Commit changes
git add .
git commit -m "Fix: describe your bug fix or feature"
git push origin master
```

### 2. **Testing Changes** (Native Windows)

**Option A: Development Mode (Quick Testing)**
```powershell
cd C:\Users\james\Projects\projelli
git pull origin master
npm install  # Only needed if dependencies changed
npm run tauri:dev  # Opens app in dev mode
```

**Option B: Production Build (Full Testing)**
```powershell
cd C:\Users\james\Projects\projelli
git pull origin master
npm run tauri build
# Test the installer from: src-tauri\target\release\bundle\nsis\
```

---

## 🐛 Bug Fix Workflow

### When You Find a Bug:

1. **Document it** (optional but recommended):
   ```bash
   # Create a quick note in your project
   echo "Bug: [description]" >> BUGS.md
   ```

2. **Fix the code** (WSL2):
   ```bash
   cd /mnt/c/Users/james/Projects/projelli
   # Edit the relevant file(s)
   git add .
   git commit -m "Fix: [bug description]"
   git push origin master
   ```

3. **Test the fix** (Windows):
   ```powershell
   cd C:\Users\james\Projects\projelli
   git pull origin master
   npm run tauri:dev  # Quick test
   # Or build if you want to test the full installer
   ```

4. **When ready to release**, see "Release Workflow" below

---

## 🚀 Release Workflow

### Creating a New Release (e.g., v1.0.1)

**Step 1: Update Version Numbers** (WSL2)
```bash
cd /mnt/c/Users/james/Projects/projelli

# Edit these 3 files to bump version to 1.0.1:
# - package.json
# - src-tauri/tauri.conf.json
# - src-tauri/Cargo.toml

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "Bump version to 1.0.1"
git push origin master
git tag v1.0.1
git push origin v1.0.1
```

**Step 2: Build Installers** (Windows)
```powershell
cd C:\Users\james\Projects\projelli
git pull origin master
npm run tauri build
```

**Step 3: Create GitHub Release**
- Go to: https://github.com/joelbridger/projelli/releases/new
- Select tag: `v1.0.1`
- Title: "Projelli v1.0.1 - [Brief description]"
- Description: List of changes/fixes
- Upload files:
  - `src-tauri\target\release\bundle\nsis\Projelli_1.0.1_x64-setup.exe`
  - `src-tauri\target\release\bundle\msi\Projelli_1.0.1_x64_en-US.msi`
- **Publish release**

**Step 4: Update Website Download Links** (WSL2)
```bash
cd /mnt/c/Users/james/Projects/projelli

# Edit website/index.html
# Find all occurrences of:
#   v1.0.0/Projelli_1.0.0_x64-setup.exe
# Replace with:
#   v1.0.1/Projelli_1.0.1_x64-setup.exe

git add website/index.html
git commit -m "Update website to v1.0.1 download links"
git push origin master

# Deploy to server
scp website/index.html jameson@10.0.0.88:/tmp/projelli-index.html
ssh jameson@10.0.0.88 "sudo cp /tmp/projelli-index.html /var/www/projelli.com/index.html && sudo chown www-data:www-data /var/www/projelli.com/index.html"
```

**Step 5: Verify**
- Visit https://projelli.com
- Click download button
- Install and test the new version

---

## 🤖 Working with Claude Code

### For Bug Fixes:
```bash
# In your terminal, start a Claude Code session
cd /mnt/c/Users/james/Projects/projelli

# Then ask Claude:
# "I found a bug where [describe issue]. Can you help me fix it?"
# or
# "The app crashes when I [action]. Can you investigate?"
```

### For New Features:
```bash
# Ask Claude to plan first for complex features:
# "I want to add [feature]. Can you help me plan and implement it?"
```

### For Debugging:
```bash
# Share error messages or logs:
# "When I run the app, I get this error: [paste error]"
# "Here's what happens: [describe behavior]"
```

---

## 📝 Best Practices

### 1. **Always Pull Before Making Changes**
```bash
git pull origin master
```

### 2. **Test Locally Before Releasing**
- Use `npm run tauri:dev` for quick iteration
- Do a full build test before creating a release

### 3. **Use Descriptive Commit Messages**
```bash
# Good:
git commit -m "Fix: Prevent crash when opening invalid workspace"
git commit -m "Feature: Add keyboard shortcut for AI chat (Ctrl+K)"
git commit -m "Docs: Update README with new installation steps"

# Less helpful:
git commit -m "Fix bug"
git commit -m "Update stuff"
```

### 4. **Keep Website in Sync**
- After creating a new release, update website download links
- Test the download from the website

---

## 🔍 Common Tasks

### Update Dependencies
```bash
# WSL2
cd /mnt/c/Users/james/Projects/projelli
npm update
git add package.json package-lock.json
git commit -m "Update npm dependencies"
git push origin master
```

### Check for TypeScript Errors
```bash
# WSL2
cd /mnt/c/Users/james/Projects/projelli
npm run typecheck
```

### Run Tests
```bash
# WSL2
cd /mnt/c/Users/james/Projects/projelli
npm test
```

### Format Code
```bash
# WSL2
cd /mnt/c/Users/james/Projects/projelli
npm run format
```

---

## 🆘 Troubleshooting

### Build Fails on Windows
1. Make sure you pulled latest code: `git pull origin master`
2. Clear build cache: `rm -rf src-tauri\target`
3. Reinstall dependencies: `npm install`
4. Try again: `npm run tauri build`

### Website Not Updating
```bash
# Verify deployment
ssh jameson@10.0.0.88 "cat /var/www/projelli.com/index.html | grep -o 'v[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1"

# Redeploy if needed
scp website/index.html jameson@10.0.0.88:/tmp/projelli-index.html
ssh jameson@10.0.0.88 "sudo cp /tmp/projelli-index.html /var/www/projelli.com/index.html"
```

### Git Issues
```bash
# If you have uncommitted changes blocking pull:
git stash
git pull origin master
git stash pop

# If you need to reset to remote:
git fetch origin
git reset --hard origin/master
```

---

## 📊 Project Status Commands

### Check What's Changed Locally
```bash
git status
git diff
```

### See Recent Commits
```bash
git log --oneline -10
```

### Check Current Version
```bash
grep '"version"' package.json | head -1
```

### See All Releases
Visit: https://github.com/joelbridger/projelli/releases

---

## 🎯 Quick Reference

| Task | Command | Where |
|------|---------|-------|
| Pull latest code | `git pull origin master` | WSL2 |
| Edit code | Use your editor | WSL2 |
| Commit changes | `git add . && git commit -m "..."` | WSL2 |
| Push changes | `git push origin master` | WSL2 |
| Test in dev mode | `npm run tauri:dev` | Windows |
| Build for release | `npm run tauri build` | Windows |
| Deploy website | See "Release Workflow" Step 4 | WSL2 |
| Create release | GitHub web interface | Browser |

---

## 💡 Tips for Working with Claude Code

1. **Be specific about what you're trying to achieve**
   - "Fix the crash when opening large files" ✅
   - "Make it better" ❌

2. **Share error messages and logs**
   - Include stack traces, console output, error dialogs

3. **Describe what you've tried**
   - "I tried changing X but got error Y"

4. **Ask for explanations**
   - "Can you explain why this fix works?"
   - "What does this code do?"

5. **Request testing steps**
   - "How should I test this change?"
   - "What edge cases should I watch for?"

---

## 🚀 Next Steps After v1.0.0

Consider implementing (in order):

1. **User Feedback Loop**
   - Add a feedback button in the app
   - Create a GitHub Discussions page

2. **Analytics** (optional)
   - Track basic usage (local only, privacy-preserving)
   - Identify most-used features

3. **Auto-update** (Future)
   - Implement Tauri's built-in updater
   - Requires code signing certificate

4. **macOS/Linux Builds** (Future)
   - Build on respective platforms
   - Test platform-specific features

5. **Pro Tier** (Future)
   - Implement payment processing
   - Feature gating
   - License key system

---

**Remember:** The app is already live and working! Take your time with updates and always test thoroughly before releasing. 🎉
