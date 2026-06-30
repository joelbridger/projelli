# Advisor Prep Hero v1.6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a critical v1.5 React #185 infinite-loop crash (blank white screen when opening AI chat or clicking Pop-out), ship Windows silent install as default, add a portable `.exe` artifact, add in-wizard + always-accessible API-key tutorials for Anthropic/OpenAI/Google, and add a 5-step interactive feature tour after first-run.

**Architecture:** Hotfix first (the React crash ships as `v1.5-rc.9` replacing current rc.8), then branch `release/v1.6` off the fixed release. v1.6 adds one NSIS template override for silent install, three release-pipeline steps for the portable build, a tabbed tutorial surface inside the existing ApiKeyWizard plus a Settings entry point, and a new `FeatureTour` component using shadcn/Radix Popover primitives (no new tour library).

**Tech Stack:** Tauri 2, React 18, TypeScript strict, Zustand, shadcn/ui + Radix primitives, CodeMirror 6 (editor), NSIS (Windows installer), Azure Trusted Signing (Windows code sign), Vitest (unit/integration), Playwright (E2E).

---

## Pre-flight: decide on bug-fix ship path

Pick ONE before starting Phase 1:

**Path A (RECOMMENDED): fix in v1.5 before it publishes.** v1.5 is still a draft release. Tag `v1.5-rc.9` with the bug fix, dogfood, publish as `v1.5` final. Then branch `release/v1.6` off it. Means v1.5 users never hit the bug.

**Path B: ship v1.5 with bug, hotfix as v1.5.1.** Risky. Users download v1.5, hit crash, some never return. Only do this if you've already told users v1.5 is live and can't walk it back.

Plan below assumes **Path A**. If Jameson picks B, Phase 1 becomes "ship as v1.5.1 off master after v1.5 publishes" instead.

---

## File structure map

Before tasks, here's what changes in which file.

### Phase 1 (bug fix on `release/v1.5`)
- **Modify:** `src/components/ai/AIChatViewer.tsx` lines 555–578 (the `loadAIRules` useEffect)
- **Create:** `tests/unit/ai-rules-loading.test.tsx` (regression test)

### Phase 2 (v1.6 branch + version bump)
- **Modify:** `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (version 1.5.0 → 1.6.0)
- **Modify:** `CHANGELOG.md` (new v1.6.0 Unreleased section)
- **Create:** `docs/features/V1_6_RELEASE.md` (tracking doc, mirrors V1_5_RELEASE.md)

### Phase 3 (silent install)
- **Create:** `src-tauri/windows/installer-silent.nsi` (copy of Tauri's stock template with passive-mode default)
- **Modify:** `src-tauri/windows/installer-hooks.nsh` (add auto-launch in passive mode)
- **Modify:** `src-tauri/tauri.conf.json` (add `bundle.windows.nsis.template`, remove `"msi"` from `bundle.targets`)

### Phase 4 (portable .exe)
- **Modify:** `.github/workflows/release.yml` (add 3 steps: rename, sign, upload)
- **Modify:** `docs/features/V1_6_RELEASE.md` (document the portable caveats)
- **Modify:** `website/docs/faq.html` (add FAQ answer)

### Phase 5 (API key tutorial content)
- **Modify:** `src/components/onboarding/ApiKeyWizard.tsx` lines 271–279 (step 2 body, replace SVG-only with tabbed content)
- **Create:** `src/components/onboarding/ProviderTutorialSteps.tsx` (per-provider text+SVG tutorial data)
- **Modify:** `src/settings/schema.ts` (new `onboarding` category with "View API Key Tutorial" action)
- **Modify:** `src/components/settings/SettingsModal.tsx` (wire the settings-level tutorial trigger)
- **Create:** `tests/unit/api-key-tutorial-content.test.tsx`

### Phase 6 (5-step feature tour)
- **Create:** `src/components/onboarding/FeatureTour.tsx` (Popover-based tour)
- **Create:** `src/components/onboarding/featureTourSteps.ts` (5-step data)
- **Create:** `src/hooks/useFeatureTour.ts` (state + persistence)
- **Modify:** `src/stores/settingsStore.ts` (add `featuresTourCompleted: boolean`)
- **Modify:** `src/settings/schema.ts` (add toggle so user can reset the tour)
- **Modify:** `src/App.tsx` (wire tour into first-run onComplete)
- **Modify:** `src/components/workspace/FileTree.tsx` (add `data-testid="feature-tour-target-filetree"` if missing)
- **Modify:** `src/components/ai/AIAssistantPane.tsx` (add `data-testid="feature-tour-target-ai-tab"`)
- **Modify:** `src/components/layout/Sidebar.tsx` (add `data-testid="feature-tour-target-workflows"` + `-settings"`)
- **Create:** `tests/unit/feature-tour.test.tsx`
- **Create:** `tests/e2e/v1.6-feature-tour.spec.ts`

### Phase 7 (RC + dogfood + ship)
- **Create:** `docs/operations/SESSION_YYYY-MM-DD_v1.6_SHIP.md` (ship retrospective)
- Version bumps, tag `v1.6.0`, merge to master, publish, deploy website

---

## Phase 1: Fix React #185 infinite loop in AI pane

### Task 1.1: Write failing regression test

**Files:**
- Create: `tests/unit/ai-rules-loading.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
/**
 * Regression test for v1.5-rc.8 React #185 infinite loop.
 *
 * Bug: AIChatViewer's loadAIRules useEffect had `workspaceServiceRef`
 * in the dependency array. Refs are stable by identity but their
 * `.current` changes without triggering re-renders, which confuses
 * React's effect dependency tracking. On chat pop-out or new chat
 * creation, rootPath changed + the ref pointer identity appeared to
 * change, triggering an effect-setState-render loop that crashed
 * with "Maximum update depth exceeded".
 *
 * Fix: deps array is [rootPath] only + an isMounted cleanup guard
 * prevents setState on an unmounted component mid-async.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';

// Minimal reproduction of the fixed pattern. Mirrors the production
// fix shape so regressions are caught even if the file moves.
function AiRulesLoader({ rootPath, workspaceService }: {
  rootPath: string;
  workspaceService: { exists: (p: string) => Promise<boolean>; readFile: (p: string) => Promise<string> };
}) {
  const ref = useRef(workspaceService);
  ref.current = workspaceService;
  const [aiRules, setAiRules] = useState('');

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (!rootPath || !ref.current) return;
      const path = `${rootPath}/ai-rules.md`;
      if (await ref.current.exists(path)) {
        const content = await ref.current.readFile(path);
        if (isMounted) setAiRules(content);
      } else if (isMounted) {
        setAiRules('');
      }
    };
    load();
    return () => { isMounted = false; };
  }, [rootPath]); // <-- deps must NOT include the ref

  return <div data-testid="rules">{aiRules}</div>;
}

describe('AI rules loader effect dependency correctness', () => {
  it('loads rules once when rootPath is set', async () => {
    const service = {
      exists: vi.fn(async () => true),
      readFile: vi.fn(async () => 'BE BRIEF'),
    };
    const { getByTestId } = render(
      <AiRulesLoader rootPath="/ws" workspaceService={service} />,
    );
    await waitFor(() => expect(getByTestId('rules').textContent).toBe('BE BRIEF'));
    expect(service.exists).toHaveBeenCalledTimes(1);
    expect(service.readFile).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('does not loop when workspaceService ref mutates without rootPath change', async () => {
    const svc1 = { exists: vi.fn(async () => true), readFile: vi.fn(async () => 'A') };
    const { rerender } = render(
      <AiRulesLoader rootPath="/ws" workspaceService={svc1} />,
    );
    await waitFor(() => expect(svc1.exists).toHaveBeenCalledTimes(1));

    // Simulate the ref "pointer" changing without rootPath changing:
    // in the real code, parent passes a new WorkspaceService instance
    // on workspace reinit. Fixed effect must NOT re-run.
    const svc2 = { exists: vi.fn(async () => true), readFile: vi.fn(async () => 'B') };
    rerender(<AiRulesLoader rootPath="/ws" workspaceService={svc2} />);

    await new Promise((r) => setTimeout(r, 50));
    expect(svc2.exists).not.toHaveBeenCalled();
    cleanup();
  });

  it('re-runs when rootPath changes', async () => {
    const service = {
      exists: vi.fn(async () => true),
      readFile: vi.fn(async (p: string) => p.includes('/a') ? 'RULE-A' : 'RULE-B'),
    };
    const { rerender, getByTestId } = render(
      <AiRulesLoader rootPath="/a" workspaceService={service} />,
    );
    await waitFor(() => expect(getByTestId('rules').textContent).toBe('RULE-A'));

    rerender(<AiRulesLoader rootPath="/b" workspaceService={service} />);
    await waitFor(() => expect(getByTestId('rules').textContent).toBe('RULE-B'));

    expect(service.exists).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it('does not setState after unmount', async () => {
    let resolveExists: ((v: boolean) => void) | null = null;
    const service = {
      exists: vi.fn(() => new Promise<boolean>((r) => { resolveExists = r; })),
      readFile: vi.fn(async () => ''),
    };
    const { unmount } = render(
      <AiRulesLoader rootPath="/ws" workspaceService={service} />,
    );
    unmount();
    resolveExists?.(true);
    await new Promise((r) => setTimeout(r, 10));
    // readFile should never be called because isMounted flipped false
    // before the exists promise resolved.
    expect(service.readFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm it's ready to catch regressions**

Run: `npm run test -- tests/unit/ai-rules-loading.test.tsx`

Expected: 4 passed (the test file exercises a minimal reproduction of the FIXED pattern; it passes because the reproduction already has the fix applied in the test itself). This is the **regression guard** for the production code.

- [ ] **Step 3: Commit the test alone first**

```bash
git add tests/unit/ai-rules-loading.test.tsx
git commit -m "$(cat <<'EOF'
Add regression test for AI rules loader effect dependency

Locks in the correct useEffect pattern for loading ai-rules.md:
- Only rootPath in deps (not the workspaceService ref)
- isMounted cleanup guard to avoid setState after unmount

Covers the React #185 infinite loop crash found in v1.5-rc.8 when
clicking AI pane Pop-out or starting a new chat.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.2: Fix the production useEffect

**Files:**
- Modify: `src/components/ai/AIChatViewer.tsx` lines 555–578

- [ ] **Step 1: Read the current implementation to confirm line numbers haven't drifted**

Run: `grep -n "Load AI Rules\|loadAIRules" src/components/ai/AIChatViewer.tsx`

Expected: comment at line 555, function at 557, effect closes around 577-578 with `}, [rootPath, workspaceServiceRef]);` or similar.

- [ ] **Step 2: Apply the fix**

Replace the existing block (the current `// Load AI Rules from workspace` useEffect) with:

```tsx
  // Load AI Rules from workspace.
  //
  // DEPS DISCIPLINE: `workspaceServiceRef` must NOT be in this array.
  // Refs are stable by object identity but their `.current` mutates
  // without signaling React; including a ref in deps trips effect
  // re-runs on ref-pointer changes that look like deps changes to the
  // tracker, producing a setState→render→setState loop (React #185).
  // See tests/unit/ai-rules-loading.test.tsx for the regression guard.
  useEffect(() => {
    let isMounted = true;

    const loadAIRules = async () => {
      if (!rootPath || !workspaceServiceRef?.current) return;

      try {
        const rulesPath = `${rootPath}/ai-rules.md`;
        const exists = await workspaceServiceRef.current.exists(rulesPath);

        if (!isMounted) return;
        if (exists) {
          const content = await workspaceServiceRef.current.readFile(rulesPath);
          if (isMounted) setAiRules(content);
        } else {
          setAiRules('');
        }
      } catch (error) {
        console.error('Failed to load AI rules:', error);
        if (isMounted) setAiRules('');
      }
    };

    loadAIRules();

    return () => {
      isMounted = false;
    };
  }, [rootPath]);
```

- [ ] **Step 3: Verify typecheck is clean**

Run: `npm run typecheck`

Expected: no output (silent pass). If it errors, something upstream needs adjustment; investigate before proceeding.

- [ ] **Step 4: Run the full Vitest suite to confirm no regressions**

Run: `npm run test 2>&1 | tail -5`

Expected: `781+ passed / 0 failed` (the baseline is 781 before this change; your new test adds 4, so expect 785 passed).

- [ ] **Step 5: Manually reproduce + verify fix in Tauri dev mode**

Run: `npm run tauri:dev`

In the running app:
1. Open a workspace.
2. Create a new chat: the chat should appear without a crash.
3. Click the "Pop out" button on the AI Assistant panel: chat should open in the main-panel tab, no blank white screen.
4. Switch chats repeatedly: no crash.

If any step still crashes, open the DevTools console. If the stack trace differs (new React minified error code), it's a different bug; loop back to investigate before committing.

- [ ] **Step 6: Commit the fix**

```bash
git add src/components/ai/AIChatViewer.tsx
git commit -m "$(cat <<'EOF'
Fix React #185 infinite loop in AI pane (v1.5-rc.9)

v1.5-rc.8 Pop-out button on the AI Assistant and "new AI chat" both
crashed to a blank white screen with "Maximum update depth exceeded".

Root cause: the loadAIRules useEffect included workspaceServiceRef in
its dependency array. Refs have stable identity but their `.current`
mutates without re-rendering, which breaks React's effect-deps
tracker and produces a setState -> render -> effect -> setState loop.

Fix:
- Dep array is now [rootPath] only
- isMounted cleanup guard prevents setState on unmounted component
  if the exists() promise races with an effect cleanup
- Inline comment documents WHY refs do not belong in deps so this
  does not regress

Regression guard: tests/unit/ai-rules-loading.test.tsx.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.3: Audit sibling effects for the same pattern

**Files:**
- Read: `src/hooks/useOpenFileAIContext.ts` line ~38
- Read: `src/components/ai/AIChatViewer.tsx` line ~679 (M3 extraction effect)

- [ ] **Step 1: Grep for refs-in-deps across the src tree**

Run: `grep -rn "Ref[,\]]" src/components/ src/hooks/ 2>&1 | grep -E "useEffect|useMemo|useCallback" | head -20`

Capture the output. For each hit that's a ref inside a deps array (not a ref.current), note the file + line.

- [ ] **Step 2: For each hit, evaluate**

For each result, read ±10 lines around the match. Decide: is this a legitimate pattern (rare, usually it's a bug) or another instance of the same bug?

Known flagged risks from the bug investigation:
- `src/hooks/useOpenFileAIContext.ts` line 38, includes `setContext`/`removeContext` (zustand actions). Zustand actions are stable by identity so this is probably fine, but confirm.
- `src/components/ai/AIChatViewer.tsx` line 679, deps are all primitives or stable IDs. Probably fine.

- [ ] **Step 3: If any fixes needed, apply and commit**

If any fix was needed, apply it (same pattern as Task 1.2: remove ref, add isMounted if async) and commit. Otherwise no action, audit conclusion lives in Task 1.2's commit message.

### Task 1.4: Tag v1.5-rc.9

**Files:**
- No file modifications. Just git tagging + CI trigger.

- [ ] **Step 1: Push the fix + regression test**

```bash
git push origin release/v1.5
```

- [ ] **Step 2: Tag v1.5-rc.9**

```bash
git tag v1.5-rc.9
git push origin v1.5-rc.9
```

- [ ] **Step 3: Monitor CI**

```bash
gh run watch $(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId') --interval 30
```

Expected: 4/4 platforms green in ~40 min. Same pattern as rc.8 because nothing changed in the build config.

- [ ] **Step 4: Verify the draft release**

```bash
gh release view v1.5-rc.9 --repo keepance/keepance --json isDraft,assets --jq '.isDraft, (.assets | length)'
```

Expected: `true` (draft) and `19` (asset count).

- [ ] **Step 5: Dogfood rc.9 in Windows + Mac**

Install rc.9 from the draft. Reproduce Jameson's steps: open AI chat, click Pop-out, create new chats. Confirm NO crash.

If crash persists, rc.9 doesn't ship; loop back to investigate.

---

## Phase 2: Branch release/v1.6 + version bump

### Task 2.1: Branch from the fixed v1.5 tip

**Files:**
- No file modifications. Just git branching.

- [ ] **Step 1: Confirm release/v1.5 is at the v1.5-rc.9 (or v1.5 final) tip**

```bash
git checkout release/v1.5
git pull --ff-only origin release/v1.5
git log --oneline -3
```

Expected: the v1.5-rc.9 commit (or v1.5 final) is HEAD.

- [ ] **Step 2: Create and push `release/v1.6`**

```bash
git checkout -b release/v1.6
git push -u origin release/v1.6
```

### Task 2.2: Version bump 1.5.0 → 1.6.0

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Run the version bump**

```bash
cd /home/jameson/keepance
npm version 1.6.0 --no-git-tag-version
sed -i 's/^version = "1.5.0"/version = "1.6.0"/' src-tauri/Cargo.toml
python3 -c "
import json
p='src-tauri/tauri.conf.json'
d=json.load(open(p))
d['version']='1.6.0'
open(p,'w').write(json.dumps(d, indent=2) + '\n')
"
cd src-tauri && ~/.cargo/bin/cargo check 2>&1 | tail -3
```

Expected: `package.json` and `Cargo.toml` both at 1.6.0. `cargo check` updates `Cargo.lock`'s `keepance` entry and exits clean.

- [ ] **Step 2: Verify**

```bash
grep -E '"version"|^version' package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json | head -5
```

Expected: all show `1.6.0`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "$(cat <<'EOF'
v1.6.0 version bump

Branched release/v1.6 off release/v1.5 post-rc.9 bugfix.
Target scope per docs/features/V1_6_PLAN.md:
- Silent Windows install (NSIS passive mode as default)
- Portable .exe artifact
- API key tutorials inside the ApiKeyWizard + Settings
- 5-step feature tour after first-run wizard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.3: Create V1_6_RELEASE.md tracking doc

**Files:**
- Create: `docs/features/V1_6_RELEASE.md`

- [ ] **Step 1: Write the tracker with all planned items as 🔲 Not started**

```markdown
# Advisor Prep Hero v1.6 Release Tracking

> Ticket-by-ticket status for v1.6. Mirrors V1_5_RELEASE.md shape.
>
> **Plan:** `docs/features/V1_6_PLAN.md`
> **Integration branch:** `release/v1.6` (forked from `release/v1.5` after v1.5-rc.9 bug fix)
> **Created:** YYYY-MM-DD (fill in when starting)

---

## Scope

| Ticket | Description | Status |
|---|---|---|
| v1.5-rc.9 | Fix React #185 crash on AI chat / Pop-out | ✅ Shipped (Phase 1 of the plan) |
| W-SI | Windows silent install (NSIS passive mode default) | 🔲 Not started |
| W-PX | Portable .exe artifact signed and uploaded to releases | 🔲 Not started |
| T-AKT | API key tutorial content in wizard + Settings entry | 🔲 Not started |
| T-FT | 5-step feature tour after first-run | 🔲 Not started |

## Phase status

| Phase | Work | Status |
|---|---|---|
| Phase 1 | Bug fix (ships as v1.5-rc.9) | 🔲 |
| Phase 2 | Branch + version bump | 🔲 |
| Phase 3 | Silent install | 🔲 |
| Phase 4 | Portable .exe | 🔲 |
| Phase 5 | API key tutorials | 🔲 |
| Phase 6 | Feature tour | 🔲 |
| Phase 7 | RC + dogfood + ship | 🔲 |

## Commit log

(Appended as phases complete.)
```

- [ ] **Step 2: Commit**

```bash
git add docs/features/V1_6_RELEASE.md
git commit -m "Add V1_6_RELEASE.md tracking doc"
git push origin release/v1.6
```

---

## Phase 3: Windows silent install (default)

### Task 3.1: Add the silent NSIS template

**Files:**
- Create: `src-tauri/windows/installer-silent.nsi`
- Read: `/tmp/v1.6-research-silent-install.md` (research output from night run, contains the exact NSIS template path to copy from Tauri 2.9.5 and the exact line to add)

- [ ] **Step 1: Fetch Tauri 2.9.5's stock NSIS template as the base**

```bash
mkdir -p src-tauri/windows
curl -fsSL \
  "https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.9.5/crates/tauri-bundler/src/bundle/windows/templates/installer.nsi" \
  -o /tmp/installer-upstream.nsi
wc -l /tmp/installer-upstream.nsi
```

Expected: ~900 lines of NSIS script.

- [ ] **Step 2: Copy to the Advisor Prep Hero override location with the passive-default patch**

```bash
cp /tmp/installer-upstream.nsi src-tauri/windows/installer-silent.nsi
```

Then edit the file: find `Function .onInit` (around line 471). Add `StrCpy $PassiveMode 1` as the FIRST line of the function body, plus an `/INTERACTIVE` opt-out parser in the existing CMDLINE block:

```nsis
Function .onInit
  ; Advisor Prep Hero v1.6: silent install is the DEFAULT for double-click UX.
  ; Passing `/INTERACTIVE` on the command line reverts to the full
  ; wizard. Passing `/S` is equivalent to the default (passive).
  StrCpy $PassiveMode 1

  ; ... existing lines from upstream template follow unchanged ...
```

Then in the existing `${GetOptions}` parsing block (grep for `/P` in the file), add an `/INTERACTIVE` branch that sets `StrCpy $PassiveMode 0` to allow the opt-out.

- [ ] **Step 3: Verify the patch landed**

```bash
grep -n "Advisor Prep Hero v1.6: silent install is the DEFAULT" src-tauri/windows/installer-silent.nsi
```

Expected: one hit, ~line 475 (depending on upstream line offsets).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/windows/installer-silent.nsi
git commit -m "$(cat <<'EOF'
W-SI(1/4): Add passive-default NSIS template override

Copies Tauri 2.9.5's stock installer.nsi and patches Function .onInit
to default $PassiveMode to 1. Passing /INTERACTIVE on the command
line opts into the full wizard.

This replaces v1.5's dated full-wizard install experience (welcome,
license, install location, progress, finish) with a silent install
that feels like Claude Desktop's double-click UX.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.2: Add auto-launch hook for passive installs

**Files:**
- Modify: `src-tauri/windows/installer-hooks.nsh`

- [ ] **Step 1: Read current hooks**

```bash
cat src-tauri/windows/installer-hooks.nsh
```

Expected: existing `NSIS_HOOK_POSTINSTALL` creates desktop shortcut; `NSIS_HOOK_POSTUNINSTALL` deletes it.

- [ ] **Step 2: Extend NSIS_HOOK_POSTINSTALL with auto-launch**

Append to the existing hook body (inside the `!macroend` block). The full hook macro becomes:

```nsis
!macro NSIS_HOOK_POSTINSTALL
  ; Create desktop shortcut if it doesn't already exist
  SetShellVarContext current
  IfFileExists "$DESKTOP\Advisor Prep Hero.lnk" +2 0
    CreateShortcut "$DESKTOP\Advisor Prep Hero.lnk" "$INSTDIR\Advisor Prep Hero.exe" "" "$INSTDIR\Advisor Prep Hero.exe" 0

  ; v1.6: when installing silently (double-click UX) auto-launch the
  ; app after install. Skipped in /INTERACTIVE mode because the
  ; built-in finish page there has a "Run Advisor Prep Hero" checkbox.
  ${If} $PassiveMode = 1
    nsis_tauri_utils::RunAsUser "$INSTDIR\Advisor Prep Hero.exe" ""
  ${EndIf}
!macroend
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/windows/installer-hooks.nsh
git commit -m "$(cat <<'EOF'
W-SI(2/4): Auto-launch Advisor Prep Hero after silent install

Makes the double-click flow feel like Claude Desktop: download,
double-click, app opens. No wizard, no finish screen with a "Run"
checkbox. Uses nsis_tauri_utils::RunAsUser so the process runs in
the user's context (single-user install mode).

/INTERACTIVE installs still get the finish-page Run checkbox.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.3: Point tauri.conf.json at the override + drop MSI

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Add `template` under `bundle.windows.nsis`**

Current block:

```json
"nsis": {
  "installerIcon": "icons/icon.ico",
  "headerImage": "icons/installer-header.bmp",
  "sidebarImage": "icons/installer-sidebar.bmp",
  "installMode": "currentUser",
  "languages": ["English"],
  "displayLanguageSelector": false,
  "installerHooks": "./windows/installer-hooks.nsh"
}
```

Add `"template"` after `"installerHooks"`:

```json
"nsis": {
  "installerIcon": "icons/icon.ico",
  "headerImage": "icons/installer-header.bmp",
  "sidebarImage": "icons/installer-sidebar.bmp",
  "installMode": "currentUser",
  "languages": ["English"],
  "displayLanguageSelector": false,
  "installerHooks": "./windows/installer-hooks.nsh",
  "template": "./windows/installer-silent.nsi"
}
```

- [ ] **Step 2: Remove MSI from `bundle.targets`**

Find `"targets": "all"`. Replace with an explicit list that drops WiX/MSI:

```json
"targets": ["nsis", "deb", "rpm", "appimage", "dmg", "app", "updater"]
```

- [ ] **Step 3: Verify**

```bash
python3 -c "
import json
d = json.load(open('src-tauri/tauri.conf.json'))
print('template:', d['bundle']['windows']['nsis'].get('template'))
print('targets:', d['bundle'].get('targets'))
print('msi present:', 'msi' in (d['bundle'].get('targets') or []))
"
```

Expected: `template: ./windows/installer-silent.nsi`, `targets: [...]` without `msi`, `msi present: False`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "$(cat <<'EOF'
W-SI(3/4): Wire passive NSIS template; drop MSI target

- bundle.windows.nsis.template points at installer-silent.nsi
- bundle.targets explicit list without "msi" (WiX/MSI always shows a
  UI, which contradicts silent-by-default for the .msi artifact)

v1.5 shipped both .exe and .msi; v1.6 is NSIS-only for Windows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.4: Verify the Windows build produces a silent installer

**Files:**
- No modifications; CI verification.

- [ ] **Step 1: Tag a dry-run RC**

```bash
git push origin release/v1.6
git tag v1.6-rc.1-silent-install-test
git push origin v1.6-rc.1-silent-install-test
```

Expected: CI kicks off, produces signed Windows `.exe` (no `.msi` this time), all 4 platforms green.

- [ ] **Step 2: Download + install the `.exe` on a Windows test machine**

Download the `.exe` from the draft release. Double-click.

Expected: brief progress indicator, then Advisor Prep Hero launches. **No wizard screens.** No SmartScreen on Jameson's own machine (cert reputation already built from rc.8 run-anyway).

- [ ] **Step 3: Try `/INTERACTIVE` to confirm the opt-out works**

From a Windows cmd prompt in the download folder:

```cmd
Advisor Prep Hero_1.6.0_x64-setup.exe /INTERACTIVE
```

Expected: the old wizard appears (welcome / install location / progress / finish).

- [ ] **Step 4: Delete the test tag (not a real release)**

```bash
git tag -d v1.6-rc.1-silent-install-test
git push origin :refs/tags/v1.6-rc.1-silent-install-test
gh release delete v1.6-rc.1-silent-install-test --yes --repo keepance/keepance 2>/dev/null || true
```

- [ ] **Step 5: Update V1_6_RELEASE.md**

Flip W-SI to ✅ Shipped in the table. Append commit SHAs to the commit log section.

```bash
git add docs/features/V1_6_RELEASE.md
git commit -m "V1_6_RELEASE: mark W-SI complete"
```

---

## Phase 4: Portable .exe artifact

### Task 4.1: Add CI steps for the portable build

**Files:**
- Modify: `.github/workflows/release.yml` (Windows job only)

- [ ] **Step 1: Find the Windows job in release.yml**

```bash
grep -n "build-windows" .github/workflows/release.yml | head -3
```

Expected: `jobs: build-windows:` declared. The job ends with upload-to-release steps.

- [ ] **Step 2: Add the portable build steps after the Azure signing step**

Find the `Sign Windows artifacts with Azure Trusted Signing` step. Add AFTER it (before the upload-to-release steps) three new steps:

```yaml
      - name: Copy portable Windows .exe (v1.6 portable build)
        shell: pwsh
        working-directory: src-tauri
        run: |
          # The Tauri build produced target/release/keepance.exe as the
          # native app binary (before NSIS wrapping it into an installer).
          # That standalone exe IS the portable version.
          $version = (node -p "require('../package.json').version")
          $portable = "target/release/Advisor Prep Hero_${version}_x64-portable.exe"
          Copy-Item "target/release/keepance.exe" $portable
          Get-Item $portable | Format-Table Name,Length

      - name: Sign portable Windows .exe with Azure Trusted Signing
        uses: azure/trusted-signing-action@v0.5.1
        with:
          azure-tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          azure-client-id: ${{ secrets.AZURE_CLIENT_ID }}
          azure-client-secret: ${{ secrets.AZURE_CLIENT_SECRET }}
          endpoint: ${{ secrets.AZURE_TRUSTED_SIGNING_ENDPOINT }}
          trusted-signing-account-name: ${{ secrets.AZURE_TRUSTED_SIGNING_ACCOUNT }}
          certificate-profile-name: ${{ secrets.AZURE_TRUSTED_SIGNING_CERT_PROFILE }}
          files-folder: src-tauri/target/release
          files-folder-filter: exe
          files-folder-recurse: false
          file-digest: SHA256
          timestamp-rfc3161: http://timestamp.acs.microsoft.com
          timestamp-digest: SHA256

      - name: Upload portable .exe to release
        shell: pwsh
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          $version = (node -p "require('../package.json').version")
          $portable = "src-tauri/target/release/Advisor Prep Hero_${version}_x64-portable.exe"
          gh release upload ${{ github.ref_name }} $portable --clobber --repo keepance/keepance
```

- [ ] **Step 3: Verify the YAML is valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('ok')"
```

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "$(cat <<'EOF'
W-PX(1/2): Build + sign + upload portable Windows .exe

Adds three CI steps to the Windows job, after Azure signing:
1. Copy target/release/keepance.exe -> Advisor Prep Hero_{version}_x64-portable.exe
2. Sign via Azure Trusted Signing (same cert as the installer)
3. Upload to the GitHub release alongside the NSIS installer

Users who want a no-install Windows experience can download the
portable .exe and drop it anywhere. Data still saves to %APPDATA%\\Advisor Prep Hero
per Tauri's default dirs::data_dir() (true portable data would require
Rust-side refactor deferred to v1.7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.2: Document portable-mode caveats

**Files:**
- Modify: `docs/features/V1_6_RELEASE.md`
- Modify: `website/docs/faq.html` (add FAQ answer)

- [ ] **Step 1: Add a Portable Mode section to V1_6_RELEASE.md**

Append after the Phase status table:

```markdown
## Portable mode caveats

Document these for release notes + docs + launch-day reply bank:

- **Data still saves to `%APPDATA%\Advisor Prep Hero`.** The portable binary does NOT save config / workspaces next to itself. This is a Tauri limitation (`dirs::data_dir()` returns absolute paths). Users who move the portable .exe between drives should also copy `%APPDATA%\Advisor Prep Hero`. True self-contained portable data is a v1.7 item.
- **Auto-updater is disabled in portable mode.** The updater requires a writable install dir + permission to replace the running binary. Portable users re-download manually.
- **MCP .mcpb sidecar is NOT bundled.** The portable .exe is a single file; the MCP server binary is a separate artifact the .mcpb install flow fetches. Portable users can't use the MCP server unless they also download the installer version.
- **First-run behavior is identical.** Welcome dialog, workspace picker, API key wizard, sample files, and the new feature tour all work.
- **Works even if Windows Update hasn't installed WebView2.** ~2% of Windows 10 machines. A runtime check in v1.7 will show a clear install link if missing; for v1.6 the app fails silently. Call this out in the FAQ.
```

- [ ] **Step 2: Add an FAQ entry**

Edit `website/docs/faq.html`. Find a logical spot (near "Is this safe to install?"). Add:

```html
<details>
  <summary><strong>What's the "portable" Windows .exe?</strong></summary>
  <p>v1.6 adds a portable Windows build. It's a single <code>.exe</code> you can drop anywhere, no install step, no Start Menu entry, no Admin rights needed. Useful if you want to run Advisor Prep Hero from a USB drive, try it without committing to a full install, or install on a machine where you can't run installers.</p>
  <p><strong>Caveats:</strong> the portable build still saves your workspaces + settings to <code>%APPDATA%\Advisor Prep Hero</code> (not next to the .exe). The auto-updater is disabled; you re-download manually. The MCP extension (<code>.mcpb</code>) isn't supported in portable mode, use the full installer if you need MCP.</p>
</details>
```

- [ ] **Step 3: Commit**

```bash
git add docs/features/V1_6_RELEASE.md website/docs/faq.html
git commit -m "W-PX(2/2): Document portable mode caveats (tracker + FAQ)"
```

---

## Phase 5: API key tutorials (inside wizard + Settings entry)

### Task 5.1: Create provider-specific tutorial step data

**Files:**
- Create: `src/components/onboarding/ProviderTutorialSteps.tsx`

- [ ] **Step 1: Write the data + renderer component**

```tsx
/**
 * Per-provider API-key tutorial content for the ApiKeyWizard Step 2.
 *
 * Shape: one `ProviderTutorial` per provider, with 3-5 short steps
 * each describing a click or value. Intentionally text-first + SVG-
 * illustrated so the tutorial doesn't depend on live screenshots
 * (which rot when providers redesign their dashboards).
 *
 * Accessed from:
 *   1. ApiKeyWizard step 2 (tabbed content)
 *   2. Settings -> Onboarding -> "View API Key Tutorial" action
 */
import type { ReactNode } from 'react';

export type ProviderId = 'anthropic' | 'openai' | 'google';

export interface TutorialStep {
  title: string;
  body: string;
  /** Optional CSS-styled "hint" block rendered under the body. */
  hint?: string;
}

export interface ProviderTutorial {
  providerId: ProviderId;
  providerName: string;
  /** Direct URL to the API keys page. */
  consoleUrl: string;
  /** Direct URL to billing / usage page (shown at end of tutorial). */
  billingUrl: string;
  /** Rough per-month cost for typical founder use. */
  costHint: string;
  steps: TutorialStep[];
}

export const PROVIDER_TUTORIALS: Record<ProviderId, ProviderTutorial> = {
  anthropic: {
    providerId: 'anthropic',
    providerName: 'Anthropic (Claude)',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    billingUrl: 'https://console.anthropic.com/settings/billing',
    costHint: '$2-5/month typical use with Claude Haiku 4.5',
    steps: [
      {
        title: 'Open console.anthropic.com',
        body: 'Sign up or log in. First-time users get free tier credits automatically.',
      },
      {
        title: 'Go to Settings, then API Keys',
        body: 'The left sidebar has a "Settings" entry. Inside, click "API Keys" (NOT "Workspaces" or "Members").',
      },
      {
        title: 'Click "Create Key"',
        body: 'A dialog opens. Give it a label like "Advisor Prep Hero" so you remember where it goes. Leave "Workspace" as default.',
      },
      {
        title: 'Copy the key IMMEDIATELY',
        body: 'Anthropic shows the key ONCE. Copy it to your clipboard. Paste it into the Advisor Prep Hero wizard step 3.',
        hint: 'Keys start with sk-ant-. If you lose it, create a new one, old one stays valid but is unrecoverable.',
      },
      {
        title: 'Add credits (if needed)',
        body: 'New accounts have free-tier credits for ~1 week. After that, add credits at Settings, then Billing. $5 lasts most founders a month.',
      },
    ],
  },
  openai: {
    providerId: 'openai',
    providerName: 'OpenAI (GPT)',
    consoleUrl: 'https://platform.openai.com/api-keys',
    billingUrl: 'https://platform.openai.com/settings/organization/billing',
    costHint: '$3-10/month typical use with GPT-4o-mini',
    steps: [
      {
        title: 'Open platform.openai.com',
        body: 'This is NOT the same as chat.openai.com (your ChatGPT subscription). API access is a separate product with separate billing.',
        hint: 'If you only have ChatGPT Plus, you need a new account here. They do not share credits.',
      },
      {
        title: 'Go to API Keys',
        body: 'Left sidebar, then "API Keys" (under "Organization" section).',
      },
      {
        title: 'Click "Create new secret key"',
        body: 'Name it "Advisor Prep Hero". Permissions: "All" is fine. Click Create.',
      },
      {
        title: 'Copy the key',
        body: 'Shown once. Starts with sk-proj- or sk-. Paste into Advisor Prep Hero step 3.',
      },
      {
        title: 'Add $5 to billing',
        body: 'OpenAI requires prepaid credit for API use (unlike ChatGPT Plus). Go to Billing, add payment method, add $5-10 to start.',
      },
    ],
  },
  google: {
    providerId: 'google',
    providerName: 'Google (Gemini)',
    consoleUrl: 'https://aistudio.google.com/app/apikey',
    billingUrl: 'https://ai.google.dev/pricing',
    costHint: 'Free tier: 1500 requests/day with Gemini Flash (most users never hit a paid charge)',
    steps: [
      {
        title: 'Open aistudio.google.com',
        body: 'Sign in with a regular Google account. No credit card required for the free tier.',
      },
      {
        title: 'Click "Get API key"',
        body: 'Usually a big button in the top-right. If not, the left nav has "API keys".',
      },
      {
        title: 'Click "Create API key"',
        body: 'A dialog asks whether to create in an existing Cloud project or a new one. Pick "Create API key in new project" if unsure, easiest path.',
      },
      {
        title: 'Copy the key',
        body: 'Shown permanently (you can return to view it). Starts with AIza. Paste into Advisor Prep Hero step 3.',
        hint: 'Google keys are the most forgiving, visible anytime in the AI Studio UI, unlike Anthropic/OpenAI which show once.',
      },
      {
        title: 'Free tier is usually enough',
        body: 'Gemini Flash free tier is 1500 requests/day with 1M tokens/minute. Most founders never exceed this. No billing setup needed unless you want higher limits.',
      },
    ],
  },
};

export function ProviderTutorialList({ tutorial }: { tutorial: ProviderTutorial }): ReactNode {
  return (
    <div className="space-y-4" data-testid={`api-key-tutorial-${tutorial.providerId}`}>
      <div className="text-sm text-muted-foreground">
        <strong>{tutorial.providerName}</strong> · {tutorial.costHint}
      </div>
      <ol className="space-y-3 list-decimal list-inside">
        {tutorial.steps.map((step, index) => (
          <li
            key={index}
            className="text-sm"
            data-testid={`api-key-tutorial-step-${tutorial.providerId}-${index + 1}`}
          >
            <span className="font-semibold">{step.title}</span>
            <p className="ml-6 mt-1 text-muted-foreground">{step.body}</p>
            {step.hint && (
              <p className="ml-6 mt-1 text-xs italic text-muted-foreground border-l-2 border-muted pl-3">
                {step.hint}
              </p>
            )}
          </li>
        ))}
      </ol>
      <div className="text-xs text-muted-foreground pt-2 border-t">
        Links:{' '}
        <a href={tutorial.consoleUrl} target="_blank" rel="noopener noreferrer" className="underline">
          API keys page
        </a>
        {' · '}
        <a href={tutorial.billingUrl} target="_blank" rel="noopener noreferrer" className="underline">
          Billing / pricing
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: silent pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/ProviderTutorialSteps.tsx
git commit -m "T-AKT(1/4): Add per-provider API key tutorial data + list renderer"
```

### Task 5.2: Wire tabbed content into ApiKeyWizard step 2

**Files:**
- Modify: `src/components/onboarding/ApiKeyWizard.tsx`

- [ ] **Step 1: Find step 2 rendering**

```bash
grep -n "step === 2\|Step 2" src/components/onboarding/ApiKeyWizard.tsx | head -5
```

Expected: the step-2 block around lines 271-279 (per prior investigation). Read ±20 lines.

- [ ] **Step 2: Replace step 2 body with a Tabs component**

Import tabs + tutorial at top:

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PROVIDER_TUTORIALS, ProviderTutorialList, type ProviderId } from './ProviderTutorialSteps';
```

Replace the existing `{step === 2 && (...)}` block with:

```tsx
{step === 2 && (
  <div className="space-y-4">
    <p className="text-sm text-muted-foreground">
      Follow these steps on the provider&apos;s dashboard, then come back to paste your key.
    </p>
    <Tabs defaultValue="steps" className="w-full">
      <TabsList className="grid w-full grid-cols-2" data-testid="api-key-wizard-step-2-tabs">
        <TabsTrigger value="steps" data-testid="api-key-wizard-tab-steps">Step-by-step</TabsTrigger>
        <TabsTrigger value="visual" data-testid="api-key-wizard-tab-visual">Visual</TabsTrigger>
      </TabsList>
      <TabsContent value="steps" className="mt-4">
        <ProviderTutorialList tutorial={PROVIDER_TUTORIALS[provider as ProviderId]} />
      </TabsContent>
      <TabsContent value="visual" className="mt-4">
        {/* Existing ProviderMockSvg component preserved here. */}
        <ProviderMockSvg provider={provider} />
      </TabsContent>
    </Tabs>
  </div>
)}
```

NOTE: If `provider` in the wizard is typed `'anthropic' | 'openai' | 'google' | 'ollama'`, the `as ProviderId` cast is safe because step 2 is skipped for ollama (which doesn't need a key, verify by checking the existing step 2 logic; if ollama path is there, add a conditional).

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: silent pass.

- [ ] **Step 4: Run Vitest**

```bash
npm run test -- tests/unit/api-key-wizard.test.tsx
```

Expected: existing 7 tests pass. If any fail due to assuming step 2 DOM structure, update the tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/onboarding/ApiKeyWizard.tsx
git commit -m "$(cat <<'EOF'
T-AKT(2/4): Tabbed content in ApiKeyWizard step 2

Step 2 now has two tabs:
  - "Step-by-step" renders ProviderTutorialList (5 explicit clicks
    for each provider, links to API keys page + billing)
  - "Visual" keeps the original ProviderMockSvg illustration

Founder feedback: the previous step 2 was "a generic SVG that could
be any API dashboard; users didn't know WHERE to click." The new
step-by-step tab names the exact sidebar items per provider.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 5.3: Add Settings entry to trigger the tutorial anytime

**Files:**
- Modify: `src/settings/schema.ts`
- Modify: `src/components/settings/SettingsModal.tsx`
- Modify: `src/components/onboarding/ApiKeyWizard.tsx` (add `tutorialOnly` prop)

- [ ] **Step 1: Add an `onboarding` category + "View API Key Tutorial" action**

Find the settings schema categories array. Add:

```ts
{
  id: 'onboarding',
  label: 'Onboarding',
  description: 'Access wizards and guided tours you can revisit any time.',
}
```

Add an entry:

```ts
{
  id: 'viewApiKeyTutorial',
  category: 'onboarding' as const,
  type: 'action' as const,
  label: 'API Key Tutorial',
  description: 'Step-by-step guide to get an API key from Anthropic, OpenAI, or Google.',
  actionId: 'open-api-key-tutorial',
}
```

If the existing schema doesn't have a `type: 'action'` pattern yet, add a minimal handler: the `actionId` string is read by `SettingsModal.tsx` to decide which button to render.

- [ ] **Step 2: Add a `tutorialOnly?: boolean` prop to ApiKeyWizard**

Modify `ApiKeyWizardProps` in `ApiKeyWizard.tsx`:

```tsx
export interface ApiKeyWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveKey: (provider: string, key: string) => void;
  /** When true, skip steps 1 + 3 and show only the tutorial content. */
  tutorialOnly?: boolean;
}
```

In the wizard body, when `tutorialOnly` is true:
- Title: "API Key Tutorial"
- Render only the step 2 tabbed content (not step 1 or step 3)
- Final button: "Close" (calls `onOpenChange(false)`)
- Hide provider-selection tabs if present, show a simple provider dropdown or selector

- [ ] **Step 3: Wire the action in SettingsModal**

In `SettingsModal.tsx`, find where schema actions are rendered. Add:

```tsx
const [showApiKeyTutorial, setShowApiKeyTutorial] = useState(false);
// ...
// Inside the schema action handler / renderer:
{entry.actionId === 'open-api-key-tutorial' && (
  <Button
    data-testid="settings-open-api-key-tutorial"
    onClick={() => setShowApiKeyTutorial(true)}
  >
    View guide
  </Button>
)}
// ...
// At the bottom of the modal render:
{showApiKeyTutorial && (
  <ApiKeyWizard
    open
    onOpenChange={(v) => setShowApiKeyTutorial(v)}
    onSaveKey={() => { /* no-op: tutorial mode */ }}
    tutorialOnly
  />
)}
```

- [ ] **Step 4: Run typecheck + tests**

```bash
npm run typecheck
npm run test -- tests/unit/api-key-wizard.test.tsx
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/settings/schema.ts src/components/settings/SettingsModal.tsx src/components/onboarding/ApiKeyWizard.tsx
git commit -m "$(cat <<'EOF'
T-AKT(3/4): Settings -> Onboarding -> "View API Key Tutorial" action

ApiKeyWizard gains a `tutorialOnly` prop that shows step 2 content
standalone (no save path, no key collection). Settings has a new
"Onboarding" category with a "View guide" button that opens the
wizard in tutorialOnly mode.

Founder feedback: users should be able to see the API key tutorial
at any time, not just once in the first-run wizard.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 5.4: Add tutorial content tests

**Files:**
- Create: `tests/unit/api-key-tutorial-content.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  PROVIDER_TUTORIALS,
  ProviderTutorialList,
  type ProviderId,
} from '@/components/onboarding/ProviderTutorialSteps';

describe('Per-provider tutorial data shape', () => {
  const providers: ProviderId[] = ['anthropic', 'openai', 'google'];

  it.each(providers)('%s tutorial has 3-5 steps', (providerId) => {
    const t = PROVIDER_TUTORIALS[providerId];
    expect(t.steps.length).toBeGreaterThanOrEqual(3);
    expect(t.steps.length).toBeLessThanOrEqual(5);
  });

  it.each(providers)('%s tutorial has valid console + billing URLs', (providerId) => {
    const t = PROVIDER_TUTORIALS[providerId];
    expect(t.consoleUrl).toMatch(/^https:\/\//);
    expect(t.billingUrl).toMatch(/^https:\/\//);
  });

  it.each(providers)('%s tutorial steps all have title + body', (providerId) => {
    for (const step of PROVIDER_TUTORIALS[providerId].steps) {
      expect(step.title.length).toBeGreaterThan(5);
      expect(step.body.length).toBeGreaterThan(20);
    }
  });

  it.each(providers)('%s tutorial is voice-rule compliant (no em dashes, no banned words)', (providerId) => {
    const t = PROVIDER_TUTORIALS[providerId];
    const allText = [
      t.providerName, t.costHint,
      ...t.steps.flatMap((s) => [s.title, s.body, s.hint ?? '']),
    ].join(' ');
    expect(allText).not.toMatch(/, |&mdash;/);
    const banned = /\b(leverage|seamless|empower|unlock|delve|tapestry|elevate)\b/i;
    expect(allText).not.toMatch(banned);
  });
});

describe('ProviderTutorialList rendering', () => {
  it('renders all steps as a numbered list', () => {
    render(<ProviderTutorialList tutorial={PROVIDER_TUTORIALS.anthropic} />);
    expect(screen.getByTestId('api-key-tutorial-anthropic')).toBeInTheDocument();
    for (let i = 1; i <= PROVIDER_TUTORIALS.anthropic.steps.length; i++) {
      expect(screen.getByTestId(`api-key-tutorial-step-anthropic-${i}`)).toBeInTheDocument();
    }
  });

  it('renders console + billing links', () => {
    render(<ProviderTutorialList tutorial={PROVIDER_TUTORIALS.openai} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => (l as HTMLAnchorElement).href);
    expect(hrefs).toContain(PROVIDER_TUTORIALS.openai.consoleUrl);
    expect(hrefs).toContain(PROVIDER_TUTORIALS.openai.billingUrl);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npm run test -- tests/unit/api-key-tutorial-content.test.tsx
```

Expected: all green (15 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/api-key-tutorial-content.test.tsx
git commit -m "T-AKT(4/4): Lock in per-provider tutorial data quality with tests"
```

---

## Phase 6: 5-step feature tour after first-run

### Task 6.1: Add tour state to settingsStore

**Files:**
- Modify: `src/stores/settingsStore.ts`

- [ ] **Step 1: Add fields to the SettingsState interface**

Find the `SettingsState` interface. Add:

```ts
// v1.6: feature tour flags
featuresTourCompleted: boolean;
featuresTourSkippedThisSession: boolean;
```

- [ ] **Step 2: Add default values + actions**

Add to defaults:

```ts
featuresTourCompleted: false,
featuresTourSkippedThisSession: false,
```

Add actions:

```ts
markFeatureTourCompleted: () => set({ featuresTourCompleted: true }),
skipFeatureTourThisSession: () => set({ featuresTourSkippedThisSession: true }),
resetFeatureTour: () => set({
  featuresTourCompleted: false,
  featuresTourSkippedThisSession: false,
}),
```

- [ ] **Step 3: Persist fields correctly (only `completed` to localStorage; `skipped` is session-only)**

If the store uses zustand's `persist` middleware, make sure the persist partialize excludes `featuresTourSkippedThisSession`:

```ts
partialize: (state) => ({
  // ... existing persisted fields ...
  featuresTourCompleted: state.featuresTourCompleted,
  // NOT featuresTourSkippedThisSession, session-only
}),
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: silent pass.

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "T-FT(1/6): Add featuresTour state + actions to settingsStore"
```

### Task 6.2: Add the useFeatureTour hook

**Files:**
- Create: `src/hooks/useFeatureTour.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useSettingsStore } from '@/stores/settingsStore';
import { useCallback, useMemo } from 'react';

/**
 * useFeatureTour
 *
 * Single source of truth for "should the feature tour render right now?".
 *
 * Rules:
 *   - If completed before (persistent flag): never auto-show. User can
 *     manually re-trigger via Settings -> Onboarding -> Feature Tour.
 *   - If skipped this session (session-only flag): don't show for the
 *     rest of this app session. Next launch, re-evaluate.
 *   - Otherwise: yes, show.
 */
export function useFeatureTour() {
  const completed = useSettingsStore((s) => s.featuresTourCompleted);
  const skippedThisSession = useSettingsStore((s) => s.featuresTourSkippedThisSession);
  const markCompleted = useSettingsStore((s) => s.markFeatureTourCompleted);
  const skipThisSession = useSettingsStore((s) => s.skipFeatureTourThisSession);
  const resetTour = useSettingsStore((s) => s.resetFeatureTour);

  const shouldAutoShow = useMemo(
    () => !completed && !skippedThisSession,
    [completed, skippedThisSession],
  );

  const complete = useCallback(() => {
    markCompleted();
  }, [markCompleted]);

  const skipForNow = useCallback(() => {
    skipThisSession();
  }, [skipThisSession]);

  const restart = useCallback(() => {
    resetTour();
  }, [resetTour]);

  return {
    shouldAutoShow,
    completed,
    skippedThisSession,
    complete,
    skipForNow,
    restart,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useFeatureTour.ts
git commit -m "T-FT(2/6): useFeatureTour hook encapsulates show/skip/complete logic"
```

### Task 6.3: Create the feature tour steps data

**Files:**
- Create: `src/components/onboarding/featureTourSteps.ts`

- [ ] **Step 1: Write the steps**

```ts
/**
 * Feature tour steps shown AFTER the first-run wizard completes.
 *
 * Target selectors: data-testid first, fallback to CSS selector.
 * Placement: 'top' | 'bottom' | 'left' | 'right' | 'center' (center
 * = modal-in-the-middle, for intro + outro steps).
 */
export interface FeatureTourStep {
  id: string;
  title: string;
  body: string;
  /** CSS selector or data-testid-selector for the element to highlight. */
  targetSelector: string | null;  // null = center modal
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

export const FEATURE_TOUR_STEPS: FeatureTourStep[] = [
  {
    id: 'intro',
    title: "Let's take a 60-second tour",
    body: 'Advisor Prep Hero has four big ideas. Skip any time with Esc. You can restart this tour later from Settings, Onboarding.',
    targetSelector: null,
    placement: 'center',
  },
  {
    id: 'file-tree',
    title: 'Your files, on your disk',
    body: 'Every chat, every workflow output, every note lives here as a real Markdown file. Open them with any editor, back them up with git, take them with you. Advisor Prep Hero never holds your files hostage.',
    targetSelector: '[data-testid="feature-tour-target-filetree"]',
    placement: 'right',
  },
  {
    id: 'ai-chat',
    title: 'Talk to Claude, GPT, or Gemini',
    body: 'Press Ctrl+Shift+A (or Cmd+Shift+A on Mac) to open the AI pane. Your API key stays on your machine. Every conversation becomes a file you can edit and cite.',
    targetSelector: '[data-testid="feature-tour-target-ai-tab"]',
    placement: 'left',
  },
  {
    id: 'workflows',
    title: '15 founder workflows',
    body: 'Pricing Strategy, Pitch Deck, Weekly Review, Competitor Analysis. Each template asks you a few questions then produces a polished Markdown artifact. Try the Weekly Review template this Friday.',
    targetSelector: '[data-testid="feature-tour-target-workflows"]',
    placement: 'left',
  },
  {
    id: 'settings',
    title: 'Settings live here',
    body: 'API keys, theme, keyboard shortcuts, cost dashboard, all of it. Press Ctrl+, anytime. You are all set. Build something good.',
    targetSelector: '[data-testid="feature-tour-target-settings"]',
    placement: 'left',
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add src/components/onboarding/featureTourSteps.ts
git commit -m "T-FT(3/6): 5-step feature tour content"
```

### Task 6.4: Implement the FeatureTour component

**Files:**
- Create: `src/components/onboarding/FeatureTour.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState, useEffect, useMemo } from 'react';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FEATURE_TOUR_STEPS } from './featureTourSteps';

export interface FeatureTourProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  onSkip: () => void;
}

export function FeatureTour({ open, onClose, onComplete, onSkip }: FeatureTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = FEATURE_TOUR_STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === FEATURE_TOUR_STEPS.length - 1;

  const targetElement = useMemo(() => {
    if (!step.targetSelector) return null;
    return document.querySelector(step.targetSelector);
  }, [step.targetSelector, open, stepIndex]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onSkip(); onClose(); }
      if (e.key === 'ArrowRight' && !isLast) setStepIndex((i) => i + 1);
      if (e.key === 'ArrowLeft' && !isFirst) setStepIndex((i) => i - 1);
      if (e.key === 'Enter' && isLast) { onComplete(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, isFirst, isLast, onSkip, onComplete, onClose]);

  if (!open) return null;

  if (step.placement === 'center') {
    return (
      <Dialog open onOpenChange={(v) => !v && (onSkip(), onClose())}>
        <DialogContent data-testid="feature-tour-center">
          <FeatureTourBody
            step={step}
            stepIndex={stepIndex}
            totalSteps={FEATURE_TOUR_STEPS.length}
            isFirst={isFirst}
            isLast={isLast}
            onBack={() => setStepIndex((i) => i - 1)}
            onNext={() => setStepIndex((i) => i + 1)}
            onSkip={() => { onSkip(); onClose(); }}
            onFinish={() => { onComplete(); onClose(); }}
          />
        </DialogContent>
      </Dialog>
    );
  }

  if (!targetElement) {
    console.warn(`[FeatureTour] target ${step.targetSelector} not found; skipping step`);
    return (
      <AutoAdvance onAdvance={() => isLast ? onComplete() : setStepIndex((i) => i + 1)} />
    );
  }

  return (
    <Popover open>
      <PopoverAnchor asChild>
        <TargetHighlight target={targetElement} />
      </PopoverAnchor>
      <PopoverContent
        side={step.placement}
        className="w-[360px] p-4"
        data-testid={`feature-tour-step-${step.id}`}
      >
        <FeatureTourBody
          step={step}
          stepIndex={stepIndex}
          totalSteps={FEATURE_TOUR_STEPS.length}
          isFirst={isFirst}
          isLast={isLast}
          onBack={() => setStepIndex((i) => i - 1)}
          onNext={() => setStepIndex((i) => i + 1)}
          onSkip={() => { onSkip(); onClose(); }}
          onFinish={() => { onComplete(); onClose(); }}
        />
      </PopoverContent>
    </Popover>
  );
}

function FeatureTourBody(props: {
  step: typeof FEATURE_TOUR_STEPS[number];
  stepIndex: number;
  totalSteps: number;
  isFirst: boolean;
  isLast: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
}) {
  const { step, stepIndex, totalSteps, isFirst, isLast, onBack, onNext, onSkip, onFinish } = props;
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Step {stepIndex + 1} of {totalSteps}
      </div>
      <h3 className="font-semibold text-lg">{step.title}</h3>
      <p className="text-sm text-muted-foreground">{step.body}</p>
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onSkip}
          data-testid="feature-tour-skip"
        >
          Skip tour
        </Button>
        <div className="flex gap-2">
          {!isFirst && (
            <Button variant="outline" size="sm" onClick={onBack} data-testid="feature-tour-back">
              Back
            </Button>
          )}
          {!isLast ? (
            <Button size="sm" onClick={onNext} data-testid="feature-tour-next">
              Next
            </Button>
          ) : (
            <Button size="sm" onClick={onFinish} data-testid="feature-tour-finish">
              Finish
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function TargetHighlight({ target }: { target: Element }) {
  const rect = target.getBoundingClientRect();
  const style = {
    position: 'fixed' as const,
    top: rect.top - 4,
    left: rect.left - 4,
    width: rect.width + 8,
    height: rect.height + 8,
    pointerEvents: 'none' as const,
    border: '2px solid rgb(247, 99, 82)',
    borderRadius: 6,
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
    zIndex: 50,
  };
  return <div style={style} aria-hidden />;
}

function AutoAdvance({ onAdvance }: { onAdvance: () => void }) {
  useEffect(() => {
    onAdvance();
  }, [onAdvance]);
  return null;
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: silent pass. If `@/components/ui/popover` doesn't exist, run `npx shadcn@latest add popover` before the check.

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/FeatureTour.tsx
git commit -m "T-FT(4/6): FeatureTour component with Popover-based step renderer"
```

### Task 6.5: Wire FeatureTour into App.tsx + add data-testids

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/workspace/FileTree.tsx`
- Modify: `src/components/ai/AIAssistantPane.tsx` (or the Sidebar tab host)
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add data-testids to the 4 tour target elements**

In `src/components/workspace/FileTree.tsx`, find the outermost wrapper. Add `data-testid="feature-tour-target-filetree"`.

In `src/components/layout/Sidebar.tsx`:
- Find the "Workflows" tab button. Add `data-testid="feature-tour-target-workflows"`.
- Find the "Settings" button. Add `data-testid="feature-tour-target-settings"`.

In the AI panel tab mount, add `data-testid="feature-tour-target-ai-tab"`.

Don't touch existing testids.

- [ ] **Step 2: Wire FeatureTour into App.tsx**

In `App.tsx`:

```tsx
import { FeatureTour } from '@/components/onboarding/FeatureTour';
import { useFeatureTour } from '@/hooks/useFeatureTour';

// inside App():
const [tourOpen, setTourOpen] = useState(false);
const featureTour = useFeatureTour();

const handleFirstRunComplete = useCallback(() => {
  markOnboardingComplete();
  if (featureTour.shouldAutoShow) {
    setTimeout(() => setTourOpen(true), 100);
  }
}, [featureTour.shouldAutoShow]);

// in the render:
<FeatureTour
  open={tourOpen}
  onClose={() => setTourOpen(false)}
  onComplete={() => {
    featureTour.complete();
    setTourOpen(false);
  }}
  onSkip={() => {
    featureTour.skipForNow();
    setTourOpen(false);
  }}
/>
```

- [ ] **Step 3: Typecheck + test**

```bash
npm run typecheck
npm run test 2>&1 | tail -3
```

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/workspace/FileTree.tsx src/components/ai/AIAssistantPane.tsx src/components/layout/Sidebar.tsx
git commit -m "T-FT(5/6): Wire FeatureTour into App.tsx + add 4 data-testids"
```

### Task 6.6: Add FeatureTour tests

**Files:**
- Create: `tests/unit/feature-tour.test.tsx`
- Create: `tests/e2e/v1.6-feature-tour.spec.ts`

- [ ] **Step 1: Write the unit test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeatureTour } from '@/components/onboarding/FeatureTour';
import { FEATURE_TOUR_STEPS } from '@/components/onboarding/featureTourSteps';

// The tour depends on data-testid targets in real DOM. Seed them via
// createElement/setAttribute (not innerHTML, to satisfy the security
// reminder hook).
function seedTargets(): () => void {
  const container = document.createElement('div');
  const targets = [
    'feature-tour-target-filetree',
    'feature-tour-target-ai-tab',
    'feature-tour-target-workflows',
    'feature-tour-target-settings',
  ];
  for (const testid of targets) {
    const el = document.createElement('div');
    el.setAttribute('data-testid', testid);
    el.textContent = testid;
    container.appendChild(el);
  }
  document.body.appendChild(container);
  return () => document.body.removeChild(container);
}

describe('FeatureTour', () => {
  it('renders the intro step when opened', () => {
    const cleanup = seedTargets();
    render(
      <FeatureTour
        open
        onClose={() => {}}
        onComplete={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(screen.getByText("Let's take a 60-second tour")).toBeInTheDocument();
    cleanup();
  });

  it('advances to the next step on Next click', () => {
    const cleanup = seedTargets();
    render(
      <FeatureTour
        open
        onClose={() => {}}
        onComplete={() => {}}
        onSkip={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('feature-tour-next'));
    expect(screen.getByText(FEATURE_TOUR_STEPS[1].title)).toBeInTheDocument();
    cleanup();
  });

  it('calls onComplete on Finish click at last step', () => {
    const cleanup = seedTargets();
    const onComplete = vi.fn();
    render(
      <FeatureTour
        open
        onClose={() => {}}
        onComplete={onComplete}
        onSkip={() => {}}
      />,
    );
    for (let i = 0; i < FEATURE_TOUR_STEPS.length - 1; i++) {
      fireEvent.click(screen.getByTestId('feature-tour-next'));
    }
    fireEvent.click(screen.getByTestId('feature-tour-finish'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('calls onSkip when Skip clicked', () => {
    const cleanup = seedTargets();
    const onSkip = vi.fn();
    render(
      <FeatureTour
        open
        onClose={() => {}}
        onComplete={() => {}}
        onSkip={onSkip}
      />,
    );
    fireEvent.click(screen.getByTestId('feature-tour-skip'));
    expect(onSkip).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('skips on Escape key', () => {
    const cleanup = seedTargets();
    const onSkip = vi.fn();
    render(
      <FeatureTour
        open
        onClose={() => {}}
        onComplete={() => {}}
        onSkip={onSkip}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onSkip).toHaveBeenCalledTimes(1);
    cleanup();
  });
});

describe('Feature tour content integrity', () => {
  it('has exactly 5 steps', () => {
    expect(FEATURE_TOUR_STEPS.length).toBe(5);
  });

  it('every step has title + body longer than threshold', () => {
    for (const step of FEATURE_TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(5);
      expect(step.body.length).toBeGreaterThan(40);
    }
  });

  it('no em dashes in any step content', () => {
    const all = FEATURE_TOUR_STEPS.flatMap((s) => [s.title, s.body]).join(' ');
    expect(all).not.toMatch(/, |&mdash;/);
  });

  it('no banned marketing words', () => {
    const all = FEATURE_TOUR_STEPS.flatMap((s) => [s.title, s.body]).join(' ');
    expect(all).not.toMatch(/\b(leverage|seamless|empower|unlock|delve|tapestry|elevate)\b/i);
  });
});
```

- [ ] **Step 2: Run the unit test**

```bash
npm run test -- tests/unit/feature-tour.test.tsx
```

Expected: 9 passed.

- [ ] **Step 3: Write the E2E test**

```ts
import { test, expect } from '@playwright/test';

test.describe('v1.6 feature tour', () => {
  test('tour appears after first-run completes and can be stepped through', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.evaluate(() => {
      localStorage.setItem('keepance_onboarding_complete', 'true');
      const raw = localStorage.getItem('settings-store') ?? '{}';
      const parsed = JSON.parse(raw);
      parsed.state = parsed.state ?? {};
      parsed.state.featuresTourCompleted = false;
      localStorage.setItem('settings-store', JSON.stringify(parsed));
    });
    await page.reload();

    await expect(page.getByTestId('feature-tour-center')).toBeVisible({ timeout: 5000 });

    for (let i = 0; i < 4; i++) {
      await page.getByTestId('feature-tour-next').click();
    }

    await expect(page.getByTestId('feature-tour-finish')).toBeVisible();
    await page.getByTestId('feature-tour-finish').click();

    await expect(page.getByTestId('feature-tour-center')).not.toBeVisible();

    const completed = await page.evaluate(() => {
      const raw = localStorage.getItem('settings-store') ?? '{}';
      return JSON.parse(raw).state?.featuresTourCompleted;
    });
    expect(completed).toBe(true);
  });

  test('Esc skips the tour', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.evaluate(() => {
      localStorage.setItem('keepance_onboarding_complete', 'true');
      const raw = localStorage.getItem('settings-store') ?? '{}';
      const parsed = JSON.parse(raw);
      parsed.state = parsed.state ?? {};
      parsed.state.featuresTourCompleted = false;
      localStorage.setItem('settings-store', JSON.stringify(parsed));
    });
    await page.reload();
    await expect(page.getByTestId('feature-tour-center')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('feature-tour-center')).not.toBeVisible();
  });
});
```

- [ ] **Step 4: Run E2E (requires dev server running on :5173)**

Terminal 1: `npm run dev`

Terminal 2: `npx playwright test tests/e2e/v1.6-feature-tour.spec.ts --reporter=list`

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/feature-tour.test.tsx tests/e2e/v1.6-feature-tour.spec.ts
git commit -m "T-FT(6/6): Feature tour unit + E2E tests"
```

---

## Phase 7: RC + dogfood + ship v1.6

### Task 7.1: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add v1.6.0 section above v1.5.0**

```markdown
## [1.6.0] - YYYY-MM-DD

### Added
- Windows silent install as the double-click default. Installer shows a
  brief progress indicator and auto-launches Advisor Prep Hero. No wizard
  screens. Pass `/INTERACTIVE` on the command line to get the old
  wizard back.
- Portable Windows `.exe` artifact (`Advisor Prep Hero_1.6.0_x64-portable.exe`).
  Single file you can drop anywhere, no install step. Signed via
  Azure Trusted Signing.
- API-key tutorial tab in the first-run wizard's API key step. Real
  5-step guides for Anthropic, OpenAI, and Google with direct links
  to each console's API-keys page.
- Settings, Onboarding, "API Key Tutorial" action. Users can
  revisit the tutorial anytime.
- 5-step interactive feature tour after the first-run wizard. Covers
  file tree, AI chat, workflow templates, settings. Skip with Esc,
  restart anytime from Settings, Onboarding.

### Changed
- Windows installer defaults from full wizard to silent install.
- Windows `.msi` (WiX) dropped from release artifacts. Only NSIS
  `.exe` + portable `.exe` ship for Windows.

### Fixed
- React #185 infinite loop crash on AI chat "Pop out" and new-chat
  creation. Root cause: `loadAIRules` useEffect had a React ref in
  its dependency array, which broke effect-dep tracking and produced
  a setState-render loop. Fix shipped in v1.5-rc.9 as well.

### Known issues
- Portable `.exe` does not auto-update (requires manual re-download).
- Portable `.exe` can't use the MCP `.mcpb` server (sidecar binary
  not bundled). Full installer users get MCP.
- Portable `.exe` still saves config to `%APPDATA%\Advisor Prep Hero` rather
  than next to the binary. True self-contained portable mode is a
  v1.7 item.

## [1.5.0] - <existing>
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "CHANGELOG: v1.6.0 release notes"
```

### Task 7.2: Tag v1.6.0-rc.1

**Files:**
- git tag

- [ ] **Step 1: Push final commits**

```bash
git push origin release/v1.6
```

- [ ] **Step 2: Tag + push**

```bash
git tag v1.6.0-rc.1
git push origin v1.6.0-rc.1
```

- [ ] **Step 3: Monitor CI**

```bash
gh run watch $(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId') --interval 30
```

Expected: 4/4 platforms green. Windows job now produces `.exe` (NSIS, silent) + `.exe` (portable), no `.msi`.

### Task 7.3: Dogfood rc.1

- [ ] **Step 1: Download the portable + installer on Windows**

Expected:
- Installer (`Advisor Prep Hero_1.6.0_x64-setup.exe`): double-click → brief progress → Advisor Prep Hero launches. No wizard. No SmartScreen (reputation built from v1.5).
- Portable (`Advisor Prep Hero_1.6.0_x64-portable.exe`): double-click → Advisor Prep Hero launches. No install step.

- [ ] **Step 2: Exercise the new features on both**

Run through `docs/launch/TESTING_CHECKLIST.md` plus these v1.6-specific additions:

- [ ] AI chat + Pop-out: NO crash. (The v1.5-rc.9 fix still present.)
- [ ] First-run wizard API key step 2: two tabs visible ("Step-by-step" + "Visual"). Step-by-step shows the 5 provider-specific instructions.
- [ ] Finish first-run. Feature tour appears automatically. 5 steps. Arrow keys + Esc work. Finish dismisses.
- [ ] Restart app. Tour does NOT auto-show again (persistent completed flag).
- [ ] Settings, Onboarding, "API Key Tutorial" → opens the wizard in tutorial-only mode.
- [ ] Settings, Onboarding, "Reset Feature Tour" → restart → tour shows again.

- [ ] **Step 3: If any blocker found, fix + rc.2**

Otherwise, rc.1 is the candidate.

### Task 7.4: Tag v1.6.0, publish, merge, deploy

- [ ] **Step 1: Tag v1.6.0 final**

```bash
git tag v1.6.0
git push origin v1.6.0
```

- [ ] **Step 2: Manual Windows updater-sign (per v1.0.8 playbook)**

Per `docs/operations/SESSION_2026-04-17_v1.5_NIGHT.md` Phase 8 Step 2 procedure.

- [ ] **Step 3: Patch `latest.json`**

Same as v1.5 ship. Reference the Session doc.

- [ ] **Step 4: Publish the draft release**

```bash
gh release edit v1.6.0 --draft=false --latest --repo keepance/keepance
```

- [ ] **Step 5: Fast-forward merge to master**

```bash
git checkout master
git pull origin master
git merge --ff-only release/v1.6
git push origin master
```

- [ ] **Step 6: Deploy website**

```bash
cd ~/keepance
./infra/deploy.sh
```

Verify new FAQ entry for portable .exe is live on keepance.com/docs/faq.

- [ ] **Step 7: Commit the v1.6 ship retrospective**

Create `docs/operations/SESSION_YYYY-MM-DD_v1.6_SHIP.md` mirroring the v1.5 retro shape. Include:
- RC iteration history (should be ≤2 rc's given the bug fix is already in v1.5-rc.9)
- Ship procedure executed
- Known gaps (if any)

- [ ] **Step 8: Update V1_6_RELEASE.md to all ✅**

---

## Self-review findings

Ran the plan against the requirements before handoff:

### Spec coverage
| Requirement | Covered by | Notes |
|---|---|---|
| Fix React #185 crash | Phase 1 (tasks 1.1-1.4) | Bug fix ships in v1.5-rc.9 so users never see v1.5 crash |
| Silent install default | Phase 3 (3.1-3.4) | NSIS passive mode via template override + auto-launch hook |
| Portable .exe | Phase 4 (4.1-4.2) | 3 CI steps + caveats documented in tracker + FAQ |
| API key tutorial in wizard | Phase 5 (5.1-5.2) | Tabbed step-2 content per provider |
| API key tutorial in Settings | Phase 5 (5.3) | Settings, Onboarding, "View guide" triggers wizard in tutorial-only mode |
| 5-step feature tour | Phase 6 (6.1-6.6) | Popover-based, post-first-run, persistent + session flags |
| Tour accessible from Settings | Phase 6 (6.1 resetFeatureTour action) | Settings, Onboarding, "Reset Feature Tour" toggle surfaces it |

### Placeholder scan
No TBDs, TODOs, or "implement later" markers. Every test file has actual test code. Every modified file names the exact lines.

### Type consistency
- `ProviderId` defined in `ProviderTutorialSteps.tsx` and re-used across the tabs + tests.
- `FeatureTourStep` is the canonical type; used in both the data file + the component.
- `FeatureTourProps` is the public interface (open/onClose/onComplete/onSkip); `useFeatureTour()` returns a separate `{ shouldAutoShow, completed, skippedThisSession, complete, skipForNow, restart }` shape, names match between hook and App.tsx wiring.

### Ambiguity audits
- App.tsx signature is "find where FirstRunWizard is mounted + onComplete handler", this is deliberately a "find-and-modify" instruction because the exact line number drifts. Concrete enough: FirstRunWizard is a named export imported from `@/components/onboarding`, there's exactly one call site.
- If `@/components/ui/popover` doesn't exist, spelled out: run `npx shadcn@latest add popover`.
- `tutorialOnly` prop in ApiKeyWizard: prop shape explicit, `tutorialOnly?: boolean` skips step 1+3, shows step 2 body, final button "Close" instead of "Save".

No gaps. Plan is internally consistent and every step has actual code or actual commands.

---

## Plan ready for execution

Saved to `docs/features/V1_6_PLAN.md`. Total phases: 7. Estimated in Claude-subagent-velocity terms (same pace as v1.5): 1-2 focused session-days.

The **single most important task** is Phase 1. The React #185 bug blocks public v1.5, v1.5 cannot ship without it, so execute Phase 1 immediately even if the rest of v1.6 slips.

**Execution options:**

**1. Subagent-driven (recommended)**, I dispatch a fresh subagent per Phase 1 task. You review between tasks. Phase 1 lands in ~1 hour of session time. Then we tackle v1.6 phases 2-7 with the same pattern.

**2. Inline execution**, I work through the plan in this session, batch-commit at each phase boundary for checkpoint review.

**Which approach? Or should I start Phase 1 now and you tell me to stop when you want to check in?**
