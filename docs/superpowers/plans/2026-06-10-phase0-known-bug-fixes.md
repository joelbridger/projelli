# Phase 0: Founder-Confirmed Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 8 bugs Jameson confirmed in the v3.0.0 Windows Solo build, each with a regression test that fails on the old code, keeping all four suites green.

**Architecture:** Independent targeted fixes. Tasks 2-4 share `FirstRunWizard.tsx`/locales (one worker). Tasks 5-6 share the docx pipeline (one worker). Tasks 1, 7, 8 are independent. No new modules; follow existing patterns (Tailwind/shadcn, WorkspaceService abstraction, Tauri command layer).

**Tech Stack:** React 18 + TS strict, Tailwind, Tauri 2 Rust commands, keepance-docx crate, Vitest + Playwright (`?testMode=true`).

**Branch:** `keepance-3.0`. Baseline verified green 2026-06-10 (tsc clean; vitest 2528 pass; cargo all pass; backend 104 pass).

**Worker dispatch grouping (parallel-safe, disjoint files):**
- Worker A: Tasks 2, 3, 4 (onboarding cluster)
- Worker B: Tasks 5, 6 (docx cluster)
- Worker C: Task 7 (Open on Desktop)
- Worker D: Task 8 (workflow overflow)
- Worker E: Task 1 (icons)

**Hard rules for every worker:** TDD (failing test first, show it fail, then fix, show it pass). No em dashes in any user-facing string (a test enforces this). Light theme only. First-person-singular voice in user-facing copy. Do not commit; the orchestrator runs gates and commits per cluster. Do not edit files outside your task's file list. If the verified root cause below turns out wrong when you read the code, STOP and report back instead of improvising a different fix.

---

### Task 1: Replace Projelli icon set with the Keepance logo

**Files:**
- Modify: `src-tauri/icons/icon.ico` (stale Projelli art; PNGs in the same dir were regenerated June 3 but the .ico was not)
- Verify/possibly modify: `src-tauri/icons/icon.icns`, every PNG listed in `src-tauri/tauri.conf.json` bundle.icon, any tray icon path in `src-tauri/src/` (`grep -rn "tray" src-tauri/src/ src-tauri/tauri.conf.json`)
- Test: `tests/unit/branding-icons.test.ts` (new)

- [ ] **Step 1: Locate the canonical new Keepance logo.** Check `website/` (favicon/og assets), `public/`, and `src-tauri/icons/128x128.png` (dated June 3, believed new-brand). Confirm visually by exporting to PNG and inspecting: the old Projelli mark is a pink jelly-bean blob; the new Keepance mark is the current brand. If `128x128.png` is new-brand, it is the master source.
- [ ] **Step 2: Write the failing check.** A unit test cannot see pixels; use a content-hash guard so regressions are caught:

```typescript
// tests/unit/branding-icons.test.ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// icon.ico must be regenerated from the 2026-06 Keepance brand master.
// The stale Projelli .ico this guards against hashed to STALE_HASH below.
const STALE_PROJELLI_ICO_SHA256 = '<fill with sha256 of current stale icon.ico before replacing>';

describe('app icons are Keepance brand', () => {
  it('icon.ico is not the stale Projelli icon', () => {
    const buf = readFileSync('src-tauri/icons/icon.ico');
    const hash = createHash('sha256').update(buf).digest('hex');
    expect(hash).not.toBe(STALE_PROJELLI_ICO_SHA256);
  });
  it('icon.ico contains the standard Windows sizes', () => {
    const buf = readFileSync('src-tauri/icons/icon.ico');
    // ICONDIR: reserved(2) type(2)=1 count(2)
    expect(buf.readUInt16LE(2)).toBe(1);
    expect(buf.readUInt16LE(4)).toBeGreaterThanOrEqual(4); // at least 16/32/48/256
  });
});
```

- [ ] **Step 3: Run it, verify the first assertion fails** (after filling in the stale hash): `npx vitest run tests/unit/branding-icons.test.ts`
- [ ] **Step 4: Regenerate the .ico from the master PNG** (ImageMagick is installed):

```bash
cd src-tauri/icons
sha256sum icon.ico   # record into the test constant first
magick 128x128@2x.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

If `128x128@2x.png` is not new-brand, use the confirmed master from Step 1. Also verify `icon.icns` (macOS): if stale, regenerate with `png2icns` or `magick` equivalents from the same master. Export every `tauri.conf.json` bundle.icon entry and confirm each is new-brand.
- [ ] **Step 5: Run the test, verify pass:** `npx vitest run tests/unit/branding-icons.test.ts`
- [ ] **Step 6: Visual confirmation artifact.** Convert old (from git) and new .ico to PNG side-by-side into `docs/quality/2026-06-10-v3-usability-campaign/screenshots/phase0/icon-before-after.png` for the final report.

---

### Task 2: Rewrite pre-3.0 onboarding copy (steps 1 Welcome, 3 Workspace, 6 Demo)

**Files:**
- Modify: `src/locales/en.json` (keys under `onboarding.first-run.welcome`, `onboarding.first-run.workspace`, `onboarding.first-run.demo`)
- Verify rendering: `src/components/onboarding/FirstRunWizard.tsx` (steps read locale keys; no markup changes expected)
- Check parity: `src/locales/es.json`, `src/locales/de.json` (same keys; update with faithful translations)
- Test: `tests/unit/onboarding-copy-3-0.test.ts` (new)

**Why:** Current copy sells the v2 product ("The AI workspace where every chat becomes a real file", "combines a Markdown editor with an AI chat interface", "produce real, editable Markdown files", "stores everything as plain Markdown files"). 3.0 positioning: private intelligence layer for confidential work; Word documents are the first-class format; Markdown never appears in user-facing copy. Research persona language: find anything privately, cited answers, real Word documents.

- [ ] **Step 1: Write the failing test:**

```typescript
// tests/unit/onboarding-copy-3-0.test.ts
import { describe, it, expect } from 'vitest';
import en from '../../src/locales/en.json';

const flat = JSON.stringify(en).toLowerCase();
const firstRun = JSON.stringify(
  (en as Record<string, unknown>)['onboarding'] ?? en // adapt to actual nesting after reading en.json
);

describe('onboarding copy matches 3.0 positioning', () => {
  it('first-run copy never mentions markdown', () => {
    expect(firstRun.toLowerCase()).not.toContain('markdown');
  });
  it('welcome subtitle is the 3.0 story, not chat-to-file', () => {
    expect(firstRun).not.toContain('every chat becomes a real file');
  });
  it('demo step does not promise markdown outputs', () => {
    expect(firstRun.toLowerCase()).not.toContain('editable markdown');
  });
});
```

Adapt the JSON path to the real nesting (read `en.json` first; keys may be flat `"onboarding.first-run.welcome.title"` style). Run: `npx vitest run tests/unit/onboarding-copy-3-0.test.ts` → must FAIL on current copy.
- [ ] **Step 2: Replace the copy.** New copy, voice rules applied (first person, contractions, no em dashes, no "seamless/transform/unlock", concrete nouns). Use exactly this as the base (adjust key structure to file):

```json
"welcome": {
  "title": "Welcome to Keepance",
  "subtitle": "The private place your work lives, that answers you back.",
  "body-1": "Keepance keeps your documents and email on your own machine, lets you ask questions across all of it, and gives you answers with citations you can check. Your files stay real files in a folder you control.",
  "body-2": "This setup takes about 2 minutes. I'll help you pick a folder, choose how you want AI to work, and run your first workflow.",
  "step-1": "Step 1. Pick a workspace folder",
  "step-2": "Step 2. Choose your AI setup (optional)",
  "step-3": "Step 3. Run your first workflow"
},
"workspace": {
  "title": "Pick a workspace folder",
  "body-1": "This is where your work will live: real Word documents, PDFs, and notes in a normal folder on your hard drive. Nothing is uploaded anywhere. Pick a location that's easy to find and easy to back up.",
  "pro-tip": "Pro tip: a folder inside Dropbox, iCloud, or OneDrive syncs across devices, but that also means your files sit with that provider. For client-confidential work I'd keep the folder local."
},
"demo": {
  "title": "Run your first workflow",
  "subtitle": "See the magic moment in action.",
  "body-1": "The fastest way to understand what Keepance does is to run a workflow. Pick any template from the Workflows tab, answer the questions it asks, and watch it produce a real, editable document in your workspace.",
  "step-1": "Click <s>Workflows</s> in the sidebar",
  "step-2": "Pick any template that fits your work",
  "step-3": "Answer the questions and click <s>Generate</s>",
  "outcome": "You'll get back finished work as real documents (Word and PDF ready) that you can edit, organize, and back up however you want."
}
```

Keep every existing key present (do not drop keys other components reference); change values only. Update `es.json`/`de.json` values to match meaning (competent translations, same no-markdown rule). The synced-folder caution in `pro-tip` is deliberate (research finding: synced folders reintroduce a third party).
- [ ] **Step 3: Run the new test → PASS. Run the full em-dash/voice test suite file** (find it: `grep -rln "em dash\|emDash\|—" tests/ | head`) and `npx vitest run tests/unit` → all green.
- [ ] **Step 4: Visual check.** Playwright: `?testMode=true` + clear `keepance_onboarding_complete` flag, walk wizard steps 1/3/6, screenshot each into `docs/quality/2026-06-10-v3-usability-campaign/screenshots/phase0/`.

---

### Task 3: Data-map onboarding step: scrollable + accordion, footer always reachable

**Files:**
- Modify: `src/components/privacy/DataMapDialog.tsx` (the `DataMapContent` rows + dialog sizing at line ~169)
- Modify: the FirstRunWizard data step wrapper (`src/components/onboarding/FirstRunWizard.tsx` step='data', ~lines 303-323)
- Test: `tests/e2e/onboarding-data-map-accordion.spec.ts` (new)

**Why:** At common window heights the data-map step overflows top and bottom and the continue button is unreachable (founder screenshot, 2026-06-09). Required design (founder-specified): each section collapsed by default, accordion behavior (opening one closes the rest), the list scrolls, the continue/footer row is always visible.

- [ ] **Step 1: Read both components fully.** Identify the section-row data structure (rows like "Your files and notes stay on your machine", "Your AI keys live in your operating system keychain", etc.) and where the wizard renders the continue button relative to the scrollable area.
- [ ] **Step 2: Write the failing e2e test:**

```typescript
// tests/e2e/onboarding-data-map-accordion.spec.ts
import { test, expect } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

test.use({ viewport: { width: 1366, height: 720 } });

test('data map step: accordion sections, footer reachable at small heights', async ({ page }) => {
  await page.goto('/?testMode=true&firstRun=true'); // use the harness's real first-run seed mechanism; read helpers first
  await waitForTestModeLoad(page);
  // navigate wizard to the data step (use existing testids; add data-testid="onboarding-next" etc. only if missing)
  // ... advance to data step ...
  const sections = page.getByTestId('data-map-section');
  const count = await sections.count();
  expect(count).toBeGreaterThanOrEqual(5);
  // all collapsed by default
  for (let i = 0; i < count; i++) {
    await expect(sections.nth(i)).toHaveAttribute('data-state', 'closed');
  }
  // accordion: opening #2 closes #1
  await sections.nth(0).click();
  await expect(sections.nth(0)).toHaveAttribute('data-state', 'open');
  await sections.nth(1).click();
  await expect(sections.nth(1)).toHaveAttribute('data-state', 'open');
  await expect(sections.nth(0)).toHaveAttribute('data-state', 'closed');
  // continue button visible without scrolling the page itself
  const next = page.getByTestId('onboarding-data-continue');
  await expect(next).toBeInViewport();
});
```

Adapt the wizard-advance steps to the harness's actual seeding (read `tests/e2e/onboarding-card.spec.ts` and helpers first; reuse their patterns). Run → FAIL (no accordion exists).
- [ ] **Step 3: Implement.** Use the existing shadcn `Accordion` primitive if present in `src/components/ui/` (check first: `ls src/components/ui/accordion*`); otherwise add it following shadcn patterns already in the repo. Structure: header (title, shrink-0) / `flex-1 min-h-0 overflow-y-auto` accordion list / footer (shrink-0, always visible) inside a container sized `max-h-[85vh]`. Each section: `data-testid="data-map-section"`, `type="single" collapsible` accordion so one open at a time, all closed initially. Keep the printable/PDF full version of the data map (Settings → Privacy dialog) intact: the accordion treatment applies to the onboarding step; the dialog gets the same scroll-safety (footer outside scroll region, `min-h-0`) but may keep sections expanded for print. Light theme styling consistent with surrounding wizard.
- [ ] **Step 4: Run the e2e test → PASS. Also run at 1920×1080 to confirm no regression at large sizes.**
- [ ] **Step 5: Screenshot before/after at 1366×720 into the phase0 screenshots dir.**

---

### Task 4: Center the 1/2/3 digits in the onboarding step circles

**Files:**
- Modify: `src/components/onboarding/FirstRunWizard.tsx:363-388` (the numbered `<span>`)
- Test: covered by screenshot assertion in the Task 3 spec run; plus a snapshot-free DOM assertion below

**Why:** The span mixes `inline-block` and `flex` display utilities and inherits line-height, so the digit renders toward the top-left of the circle (founder screenshot).

- [ ] **Step 1: Write the failing test** (component-level, Vitest + Testing Library, consistent with existing component tests):

```typescript
// tests/unit/onboarding-step-circles.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
// import the demo-step subcomponent or FirstRunWizard with state forced to the demo step
// (read FirstRunWizard.tsx first; if the step list is extractable, test it directly)

describe('onboarding numbered circles', () => {
  it('uses a single flex display with centered content and collapsed line-height', () => {
    // render the demo step list
    const badge = screen.getAllByText('1')[0];
    const cls = badge.className;
    expect(cls).toContain('inline-flex');
    expect(cls).not.toMatch(/(^|\s)inline-block(\s|$)/);
    expect(cls).not.toMatch(/(^|\s)flex(\s|$)/); // no conflicting second display class
    expect(cls).toContain('items-center');
    expect(cls).toContain('justify-center');
    expect(cls).toContain('leading-none');
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Fix the span classes:**

```tsx
<span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary font-semibold leading-none text-primary-foreground">
```

Apply to all three numbered circles (they may be a mapped list; fix the single source).
- [ ] **Step 4: Run → PASS. Visual screenshot at 100% and 125% zoom-equivalent (set deviceScaleFactor 1.25 in a quick Playwright check) since the misrender showed on a scaled Windows display.**

---

### Task 5: New .docx must open editable (kill the "[preserved content]" placeholder for blank docs)

**Files:**
- Modify: `src/utils/docx-io.ts:532-534` (`createBlankDocx()` / `serializeDocx` handling of empty paragraphs)
- Read (fix here only if the real defect is parser-side): `src-tauri/src/commands/docx/mod.rs` (`docx_open` → open_to_json), `src-tauri/crates/keepance-docx/src/` (what becomes a "preserved" block)
- Verify: `src/components/media/DocxEditor.tsx` (what it renders for zero editable paragraphs)
- Test: `tests/unit/docx-blank-create.test.ts` (new, TS layer) and `src-tauri/crates/keepance-docx/tests/blank_doc.rs` (new, engine layer)

**Why:** File > New > Word document produces a file the engine maps entirely to an unmodeled "preserved content" block: the editor shows a read-only placeholder and typing is impossible. A blank Word doc must yield at least one editable empty paragraph. This is the flagship editor; severity HIGH.

- [ ] **Step 1: Reproduce at the engine layer with a failing Rust test:**

```rust
// src-tauri/crates/keepance-docx/tests/blank_doc.rs
// Build the same bytes the frontend's createBlankDocx() produces (commit the current
// output as a fixture: tests/fixtures/blank-from-frontend.docx), then assert the
// parsed model contains exactly one editable empty paragraph and zero preserved blocks.
use keepance_docx::*; // adapt to the crate's real public API after reading lib.rs

#[test]
fn blank_docx_from_frontend_yields_editable_paragraph() {
    let bytes = include_bytes!("fixtures/blank-from-frontend.docx");
    let doc = open_document(bytes).expect("blank docx parses");
    let json = to_document_json(&doc);
    assert!(json.blocks.iter().any(|b| b.kind == BlockKind::Paragraph && b.editable));
    assert_eq!(json.blocks.iter().filter(|b| b.kind == BlockKind::Preserved).count(), 0);
}
```

Generate the fixture by running `createBlankDocx()` once (small node script or a vitest test that writes the bytes) so the Rust test sees EXACTLY what the frontend produces. Adapt names to the crate's real API. Run: `cd src-tauri && cargo test -p keepance-docx blank_doc` → FAIL (that is the bug).
- [ ] **Step 2: Diagnose which side is wrong.** Read `serializeDocx('<p></p>', ...)` output (unzip document.xml). Two acceptable fixes, prefer (a): (a) `createBlankDocx()` emits a minimal valid OOXML body with one real empty `<w:p/>` (with `<w:pPr>` defaults consistent with what the engine round-trips), built as a static template string rather than going through the HTML serializer; (b) if the engine wrongly classifies a valid empty `<w:p/>` as preserved, fix the classifier in the crate. Apply the fix where the defect actually is; do not band-aid the editor.
- [ ] **Step 3: TS-layer failing test (locks the frontend contract):**

```typescript
// tests/unit/docx-blank-create.test.ts
import { describe, it, expect } from 'vitest';
import { createBlankDocx } from '../../src/utils/docx-io';
import JSZip from 'jszip'; // already a dep of docx-io; verify import style in that file

describe('createBlankDocx', () => {
  it('produces a document.xml with one empty editable paragraph', async () => {
    const bytes = createBlankDocx();
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:p');               // a real paragraph exists
    expect(xml).not.toContain('<w:tbl');          // nothing exotic
    expect((xml.match(/<w:p[\s/>]/g) ?? []).length).toBe(1);
  });
});
```

- [ ] **Step 4: Implement the fix; run both tests → PASS. Then the full docx test files:** `npx vitest run tests/unit --silent -t docx` and `cd src-tauri && cargo test -p keepance-docx`.
- [ ] **Step 5: End-to-end proof.** In the native pass later this is re-verified; for now add the editor-level assertion: open the new blank fixture through `DocxEditor`'s load path in an existing integration test pattern (see `tests/integration/`) asserting the rendered editor contains an editable (contenteditable or CodeMirror-equivalent) empty paragraph and NOT the preserved-content placeholder string `preserved content`.

---

### Task 6: Upload → open path resolution (os error 3 on `read docs/The Supreme Court.docx`)

**Files:**
- Modify: `src/App.tsx:2108-2145` (`handleUploadFiles` → `handleFileOpen` path it passes on)
- Verify/possibly modify: the `docxOpen` invocation in `src/components/media/DocxEditor.tsx` (~line 265) and any other binary viewers that invoke Tauri reads with workspace-relative paths (grep: `grep -rn "invoke('docx_open'\|invoke(\"docx_open\"\|readFileBinary" src/ | head -30`)
- Read: `src/modules/workspace/WorkspaceService.ts` + `TauriFSBackend.ts` (how absolute workspace paths are formed)
- Test: `tests/unit/path-resolution-upload-open.test.ts` (new) + Rust-side guard

**Why:** Upload writes the file workspace-rooted, but the subsequent open hands the Rust `docx_open` a workspace-RELATIVE path (`docs/The Supreme Court.docx`), which Rust resolves against the process CWD → "system cannot find the path specified (os error 3)". Spaces in the name are a red herring; the base path is wrong.

- [ ] **Step 1: Read the three files above and confirm the exact seam** (where a relative path crosses into `invoke(...)`). Record it in the task notes.
- [ ] **Step 2: Failing unit test for the resolver.** Extract (or add) a single helper `resolveWorkspacePath(rootPath: string, maybeRelative: string): string` in `src/modules/workspace/` (follow existing util patterns; if an equivalent helper already exists, use it everywhere instead of adding one):

```typescript
// tests/unit/path-resolution-upload-open.test.ts
import { describe, it, expect } from 'vitest';
import { resolveWorkspacePath } from '../../src/modules/workspace/pathResolve';

describe('resolveWorkspacePath', () => {
  it('prefixes workspace-relative paths with the root', () => {
    expect(resolveWorkspacePath('C:/Users/j/Keepance 1', 'docs/The Supreme Court.docx'))
      .toBe('C:/Users/j/Keepance 1/docs/The Supreme Court.docx');
  });
  it('leaves absolute windows and posix paths alone', () => {
    expect(resolveWorkspacePath('C:/root', 'C:/elsewhere/a.docx')).toBe('C:/elsewhere/a.docx');
    expect(resolveWorkspacePath('/root', '/elsewhere/a.docx')).toBe('/elsewhere/a.docx');
  });
  it('handles spaces and unicode without mangling', () => {
    expect(resolveWorkspacePath('/root', 'docs/Müller — brief.docx')).toBe('/root/docs/Müller — brief.docx');
  });
});
```

- [ ] **Step 3: Run → FAIL (helper missing or behavior wrong). Implement the helper; route EVERY Tauri binary read/open invocation through it** (docx, pdf, xlsx, pptx, media viewers: grep for `invoke(` calls taking file paths in `src/components/media/`). Defense in depth: in `src-tauri/src/commands/docx/mod.rs` (and sibling binary-read commands), if the incoming path is relative, return a structured error `"relative path reached native layer: <path>"` instead of attempting a CWD read, so this class of bug can never silently depend on CWD again.
- [ ] **Step 4: Run unit tests → PASS; `cargo test` → green.**
- [ ] **Step 5: e2e regression (browser-mode equivalent):** extend `tests/e2e/drag-drop-upload.spec.ts` patterns with an upload of a fixture named `The Supreme Court.docx` into a subfolder, then assert opening it does NOT surface the error toast (`Couldn't open`). Run it.

---

### Task 7: "Open on Desktop" opens the selected folder, not Documents

**Files:**
- Modify: `src/components/workspace/FileTree.tsx:199-225` (`handleOpenInExplorer`) and/or the selection wiring that feeds `selectedPath`
- Modify: `src-tauri/src/commands/fs.rs:46-85` (`open_in_explorer`)
- Test: `tests/unit/open-in-explorer-path.test.ts` (new) + Rust unit test in `fs.rs`

**Why:** The button always lands on the OS default (Documents). Verified candidates: `selectedPath` empty at click time (selection not propagated to the store), double-prefix making `path.exists()` fail in Rust with a silent fallback, or wrong `explorer.exe` invocation. Diagnose first; the founder screenshot shows Documents with a workspace folder clearly selected in the tree.

- [ ] **Step 1: Read `FileTree.tsx` selection flow and the Zustand store; write a failing unit test that captures the real defect.** If the defect is selection wiring:

```typescript
// tests/unit/open-in-explorer-path.test.ts
// Renders FileTree with a mocked workspace store: rootPath '/ws', tree containing folder 'docs'.
// Simulates clicking the 'docs' folder row, then the Open on Desktop button,
// and asserts invoke('open_in_explorer', { path: '/ws/docs' }) was called with the
// SELECTED folder, not the root and not Documents.
// Use the repo's existing @tauri-apps/api mock pattern (grep tests/ for "open_in_explorer" or "mockIPC").
```

Write it against the actual store API after reading; the assertion contract is: selected folder → that absolute path reaches `invoke`. Run → FAIL.
- [ ] **Step 2: Fix the wiring** (ensure folder row clicks set `selectedPath` in the store, and the handler resolves file selections to their parent dir; reuse `resolveWorkspacePath` from Task 6 if the join is the issue).
- [ ] **Step 3: Rust side: remove any silent fallback.** In `open_in_explorer`, if the path does not exist, return `Err` (surfaced as a toast) instead of opening a default location. Windows: open folders with `explorer.exe <abs_path>`; select files with `explorer.exe /select,<abs_path>`. Add a `#[cfg(test)]` unit test for the path-validation branch (exists/file/dir), not the spawn itself.
- [ ] **Step 4: Run TS test → PASS; `cargo test` → green.**

---

### Task 8: Workflow run tab horizontal overflow (both edges clipped)

**Files:**
- Modify: `src/components/workflow/WorkflowExecutionTab.tsx` (~line 267 container, ~line 470 `<pre>`, and the header/step rows)
- Verify: `src/components/layout/MainPanel.tsx` (tab content wrapper: needs `min-w-0` on the flex child that hosts tabs)
- Identify+fix: the floating "Source" button rendering half off-screen at the left edge (grep `WorkflowExecutionTab.tsx` and siblings for `Source`; founder screenshot shows a dark pill labeled "Source" at x<0)
- Test: `tests/e2e/workflow-tab-overflow.spec.ts` (new)

**Why:** With a workflow tab active at common widths, content is clipped past BOTH viewport edges and a "Source" control renders mostly off-screen (founder screenshot, severity HIGH). Classic missing `min-w-0` in a flex chain plus unwrapped long content.

- [ ] **Step 1: Write the failing e2e test with a generic overflow assertion** (this helper gets reused by the whole campaign):

```typescript
// tests/e2e/workflow-tab-overflow.spec.ts
import { test, expect } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

test.use({ viewport: { width: 1366, height: 768 } });

async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const offenders: string[] = [];
    if (doc.scrollWidth > doc.clientWidth + 1) offenders.push(`document ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.left < -8 || r.right > window.innerWidth + 8)) {
        offenders.push(`${el.tagName}.${String(el.className).slice(0, 60)} left=${Math.round(r.left)} right=${Math.round(r.right)}`);
      }
    }
    return offenders.slice(0, 20);
  });
}

test('workflow execution tab fits the viewport', async ({ page }) => {
  await page.goto('/?testMode=true');
  await waitForTestModeLoad(page);
  // open Workflows sidebar tab, start any template to get an execution tab
  // (reuse the launch pattern from tests/e2e/workflows-panel.spec.ts)
  // ... start workflow ...
  const offenders = await horizontalOverflow(page);
  expect(offenders, offenders.join('\n')).toHaveLength(0);
});
```

Reuse the workflow-launch steps from the existing `workflows-panel.spec.ts`. Run → FAIL with the offender list (that list IS the diagnosis).
- [ ] **Step 2: Fix layout:** add `min-w-0` to every flex child in the chain from MainPanel tab content down to the execution tab body; `overflow-x-hidden` on the tab container; `whitespace-pre-wrap break-words` on the output `<pre>`; constrain step-row text with `truncate` or wrap. Fix or correctly dock the "Source" control (if it is a floating panel toggle, dock it inside the flex flow; if vestigial, remove it and note in CHANGELOG).
- [ ] **Step 3: Run the spec at 1366×768 AND 1920×1080 → PASS both. Extract `horizontalOverflow` into `tests/e2e/helpers/overflow.ts` for campaign reuse.**
- [ ] **Step 4: Screenshot before/after into the phase0 screenshots dir.**

---

## Per-cluster wrap (orchestrator, after each worker returns)

- [ ] `npx tsc --noEmit` clean
- [ ] `npm run test` green (2528+ baseline)
- [ ] `cd src-tauri && cargo test` green (Tasks 5-7 touch Rust)
- [ ] Affected e2e specs pass: `npx playwright test tests/e2e/<new specs>`
- [ ] Commit per cluster with conventional messages:
  - `fix(brand): regenerate Windows/macOS icons from Keepance logo`
  - `fix(onboarding): 3.0 copy, accordion data map, centered step badges`
  - `fix(docx): blank documents open editable; absolute path resolution for binary opens`
  - `fix(files): Open on Desktop targets the selected folder`
  - `fix(workflow): execution tab fits viewport at all widths`
- [ ] Update `CHANGELOG.md` under `## [Unreleased]` → `### Fixed` (one bullet per bug, plain language)
