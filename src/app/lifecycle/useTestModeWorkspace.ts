/**
 * useTestModeWorkspace — initializes a mock workspace for E2E (Playwright) tests.
 *
 * Extracted from App.tsx (Phase 3 decomposition). The useEffect body is copied
 * VERBATIM from App.tsx; the only edit is IS_TEST_MODE → isTestMode (the option)
 * inside the body and in the dependency array.
 */
import { useEffect } from 'react';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { setActiveWorkspaceService } from '@/app/fileOps/flushDirtyTabs';
import { setMeetingsWorkspaceService } from '@/features/meetings/meetingStore';
import { useFileBackupStore } from '@/platform/fs/fileBackupStore';
import { useFileContextStore } from '@/platform/state/fileContextStore';
import { useTemplatesMarketplaceStore } from '@/features/workflows/templatesMarketplaceStore';
import { seedDemoClients } from '@/app/lifecycle/seedDemoClients';
import { buildOpenFilesPromptBlock } from '@/features/ask/AIChatViewer';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { FileNode } from '@/platform/types/workspace';
import type React from 'react';

export interface UseTestModeWorkspaceOptions {
  isTestMode: boolean;
  rootPath: string | null;
  setRootPath: (path: string) => void;
  openFile: ReturnType<typeof useEditorStore.getState>['openFile'];
  setFileTree: (tree: FileNode[]) => void;
  expandAllFolders: () => void;
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
}

export function useTestModeWorkspace(options: UseTestModeWorkspaceOptions): void {
  const { isTestMode, rootPath, setRootPath, openFile, setFileTree, expandAllFolders, workspaceServiceRef } = options;
  useEffect(() => {
    if (isTestMode && !rootPath) {
      // Set a mock workspace path
      setRootPath('/test-workspace');

      // Dev/preview-only: seed a realistic advisor book of business so the
      // Clients list + the redesigned Client Map can be driven with believable
      // content WITHOUT a cloud key or real documents. Gated by ?seedDemo so
      // the normal E2E path (which expects an empty workspace) is untouched.
      if (window.location.search.includes('seedDemo')) {
        seedDemoClients();
      }

      // Pre-load 2 demo tabs for testing
      const demoTab1Path = '/test-workspace/docs/test1.md';
      const demoTab1Content = '# Test Document 1\n\nThis is a test markdown document.';

      const demoTab2Path = '/test-workspace/docs/test2.txt';
      const demoTab2Content = 'This is a plain text document for testing the formatting toolbar.';

      // Normal E2E opens the two demo tabs. Recording mode
      // (?testMode=true&recordMatter=1) opens a seeded legal matter instead,
      // set up at the end of this block. The two paths never overlap, so the
      // existing E2E specs are untouched.
      const RECORD_MATTER = typeof window !== 'undefined' &&
        window.location.search.includes('recordMatter');
      if (!RECORD_MATTER) {
        openFile(demoTab1Path, 'test1.md', demoTab1Content);
        openFile(demoTab2Path, 'test2.txt', demoTab2Content);

        // R4 fix: seed a synthetic fileTree so the DocumentGridView is not
        // empty in test mode. The mock workspace service's getFileTree()
        // always returns [] (no real filesystem). We seed the two demo files
        // inside a 'docs' folder so folder drill-down is also testable.
        setFileTree([
          {
            id: '/test-workspace/docs',
            name: 'docs',
            path: '/test-workspace/docs',
            type: 'folder',
            children: [
              {
                id: demoTab1Path,
                name: 'test1.md',
                path: demoTab1Path,
                type: 'file',
                extension: 'md',
              },
              {
                id: demoTab2Path,
                name: 'test2.txt',
                path: demoTab2Path,
                type: 'file',
                extension: 'txt',
              },
            ],
          },
        ] as Parameters<typeof setFileTree>[0]);
      }

      // Expose openFile for Playwright tests so specs can inject fixture
      // files (e.g. binary data URLs) directly into the editor store without
      // going through the Tauri filesystem layer.
      (window as unknown as { __openTestFile?: typeof openFile }).__openTestFile = openFile;

      // Also expose the file-context store + prompt builder so ambient-context
      // tests can inspect extracted contents and verify system-prompt wiring
      // without needing to open an AI chat tab (providers talk to real URLs).
      (window as unknown as {
        __fileContextStore?: typeof useFileContextStore;
      }).__fileContextStore = useFileContextStore;
      (window as unknown as {
        __buildSystemPromptForTest?: (baseRole?: string) => string;
      }).__buildSystemPromptForTest = (
        baseRole = 'You are a helpful AI assistant.'
      ) => {
        const files = useFileContextStore.getState().getActiveContexts();
        return `${baseRole}${buildOpenFilesPromptBlock(files)}`;
      };

      // Expose the editor store so document-editing tests can inspect
      // `isDirty` and `content` without racing the React tree. Also expose
      // the backup store so tests can verify a backup was (or wasn't)
      // written for a given path.
      (window as unknown as {
        __editorStore?: typeof useEditorStore;
      }).__editorStore = useEditorStore;
      (window as unknown as {
        __fileBackupStore?: typeof useFileBackupStore;
      }).__fileBackupStore = useFileBackupStore;
      // UX-14: expose the workspace store so breadcrumb tests can set a
      // synthetic rootPath and inspect selectPath/expandedPaths behaviour.
      (window as unknown as {
        __workspaceStore?: typeof useWorkspaceStore;
      }).__workspaceStore = useWorkspaceStore;
      // R4: expose a setFileTree helper so Playwright tests can inject a
      // synthetic tree (folders + files) directly into the workspace store
      // and verify the DocumentGridView renders it correctly.
      (window as unknown as {
        __setTestFileTree?: (tree: Parameters<typeof setFileTree>[0]) => void;
      }).__setTestFileTree = (tree) => { setFileTree(tree); };

      // Install a mock workspace service for document-editing tests so the
      // FIRST-edit backup path exercises the real write-binary call through
      // MainPanel. The mock is an in-memory key/value map with a small set of
      // pre-seeded files (populated on first use by tests via __mockWrite).
      if (!workspaceServiceRef.current) {
        const mockFs = new Map<string, ArrayBuffer>();
        const mockDirs = new Set<string>();
        const textEncoder = new TextEncoder();
        // Helpers that synthesize folder semantics over a flat key map so
        // the AI chat persistence flow (mkdir + list + readFile) and any
        // other code that recurses into folders keeps working in test mode.
        const folderHasChildren = (folderPath: string) => {
          const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
          for (const key of mockFs.keys()) {
            if (key.startsWith(prefix)) return true;
          }
          return false;
        };
        const mockService = {
          async exists(path: string): Promise<boolean> {
            return mockFs.has(path) || folderHasChildren(path);
          },
          async readFile(path: string): Promise<string> {
            const buf = mockFs.get(path);
            if (!buf) throw new Error(`Not found: ${path}`);
            return new TextDecoder().decode(buf);
          },
          async readFileBinary(path: string): Promise<ArrayBuffer> {
            const buf = mockFs.get(path);
            if (!buf) throw new Error(`Not found: ${path}`);
            return buf;
          },
          async writeFile(path: string, content: string): Promise<void> {
            const bytes = textEncoder.encode(content);
            // Copy into a detached ArrayBuffer so callers can't mutate the
            // map's stored buffer.
            const copy = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(copy).set(bytes);
            mockFs.set(path, copy);
          },
          async writeFileBinary(path: string, content: ArrayBuffer): Promise<void> {
            const copy = new ArrayBuffer(content.byteLength);
            new Uint8Array(copy).set(new Uint8Array(content));
            mockFs.set(path, copy);
          },
          async mkdir(path: string): Promise<void> {
            // Track explicit (possibly empty) folders so getFileTree + list show
            // them even before they contain a file. Real backends persist the dir.
            mockDirs.add(path.replace(/\/+$/, ''));
          },
          async list(path: string): Promise<Array<{ name: string; path: string; type: 'file' | 'folder' }>> {
            const prefix = path.endsWith('/') ? path : `${path}/`;
            const directChildren = new Map<string, 'file' | 'folder'>();
            for (const key of mockFs.keys()) {
              if (!key.startsWith(prefix)) continue;
              const rest = key.slice(prefix.length);
              const slashIdx = rest.indexOf('/');
              if (slashIdx === -1) {
                directChildren.set(rest, 'file');
              } else {
                directChildren.set(rest.slice(0, slashIdx), 'folder');
              }
            }
            return Array.from(directChildren.entries()).map(([name, type]) => ({
              name,
              path: `${prefix}${name}`,
              type,
            }));
          },
          async getFileTree() {
            // Build a nested file/folder tree from the flat mock fs + the
            // explicit dir set, so the Documents grid reflects real files AND
            // folders the user creates (the no-op version returned nothing, so
            // created folders never appeared in test mode).
            type N = { id: string; path: string; name: string; type: 'file' | 'folder'; extension?: string; children: N[] };
            const TEST_ROOT = '/test-workspace';
            const entries = new Map<string, 'file' | 'folder'>();
            const addAncestors = (p: string): void => {
              let parent = p.slice(0, p.lastIndexOf('/'));
              while (parent.length > TEST_ROOT.length) {
                if (!entries.has(parent)) entries.set(parent, 'folder');
                parent = parent.slice(0, parent.lastIndexOf('/'));
              }
            };
            for (const key of mockFs.keys()) {
              if (!key.startsWith(`${TEST_ROOT}/`)) continue;
              entries.set(key, 'file');
              addAncestors(key);
            }
            for (const dir of mockDirs) {
              if (!dir.startsWith(`${TEST_ROOT}/`)) continue;
              if (!entries.has(dir)) entries.set(dir, 'folder');
              addAncestors(dir);
            }
            const nodeMap = new Map<string, N>();
            const tops: N[] = [];
            const sorted = [...entries.entries()].sort(
              (a, b) => a[0].split('/').length - b[0].split('/').length,
            );
            for (const [path, type] of sorted) {
              const name = path.slice(path.lastIndexOf('/') + 1);
              const dotIdx = name.lastIndexOf('.');
              const node: N = {
                id: path,
                path,
                name,
                type,
                children: [],
                ...(type === 'file' && dotIdx > 0 ? { extension: name.slice(dotIdx + 1) } : {}),
              };
              nodeMap.set(path, node);
              const parent = path.slice(0, path.lastIndexOf('/'));
              const pn = nodeMap.get(parent);
              if (parent === TEST_ROOT || !pn) tops.push(node);
              else pn.children.push(node);
            }
            return tops;
          },
          async stat(path: string) {
            if (mockFs.has(path)) {
              return { type: 'file' as const, size: mockFs.get(path)?.byteLength ?? 0 };
            }
            if (folderHasChildren(path)) {
              return { type: 'folder' as const, size: 0 };
            }
            throw new Error(`Not found: ${path}`);
          },
          async delete(path: string) {
            mockFs.delete(path);
          },
          async rename(oldPath: string, newName: string) {
            // Real WorkspaceService.rename takes (oldPath, newName) where
            // newName is just the basename; it derives the new path from
            // oldPath's parent dir. Mirror that so dev-mode mirrors prod.
            const slashIdx = oldPath.lastIndexOf('/');
            const parent = slashIdx === -1 ? '' : oldPath.slice(0, slashIdx);
            const newPath = parent ? `${parent}/${newName}` : newName;
            const buf = mockFs.get(oldPath);
            if (buf) {
              const copy = new ArrayBuffer(buf.byteLength);
              new Uint8Array(copy).set(new Uint8Array(buf));
              mockFs.set(newPath, copy);
              mockFs.delete(oldPath);
            }
          },
          async move(from: string, to: string) {
            // Real WorkspaceService.move takes (from, to) as FULL paths (App's
            // handleMove computes `to = targetFolder + '/' + basename`). Relocate
            // the file — or every descendant when `from` is a folder — so the
            // Documents grid + tree drag-and-drop work in dev/test mode just like
            // production (where TauriFSBackend.move does the real rename).
            const fromBuf = mockFs.get(from);
            if (fromBuf) {
              const copy = new ArrayBuffer(fromBuf.byteLength);
              new Uint8Array(copy).set(new Uint8Array(fromBuf));
              mockFs.set(to, copy);
              mockFs.delete(from);
            } else {
              // Folder move: re-key every file under `from/` to `to/`.
              const fromPrefix = `${from}/`;
              const movedKeys: Array<[string, ArrayBuffer]> = [];
              for (const [key, buf] of mockFs.entries()) {
                if (key.startsWith(fromPrefix)) {
                  const rest = key.slice(fromPrefix.length);
                  const copy = new ArrayBuffer(buf.byteLength);
                  new Uint8Array(copy).set(new Uint8Array(buf));
                  movedKeys.push([`${to}/${rest}`, copy]);
                  mockFs.delete(key);
                }
              }
              for (const [key, buf] of movedKeys) mockFs.set(key, buf);
            }
            // Keep the explicit-dir set in sync for empty folders.
            if (mockDirs.has(from)) {
              mockDirs.delete(from);
              mockDirs.add(to);
            }
            const fromDirPrefix = `${from}/`;
            for (const dir of [...mockDirs]) {
              if (dir.startsWith(fromDirPrefix)) {
                mockDirs.delete(dir);
                mockDirs.add(`${to}/${dir.slice(fromDirPrefix.length)}`);
              }
            }
          },
        };
        workspaceServiceRef.current = mockService as unknown as WorkspaceService;
        setActiveWorkspaceService(workspaceServiceRef.current); // BUG-046: flush accessor
        setMeetingsWorkspaceService(workspaceServiceRef.current); // Wave 3c: meetings feature accessor
        // Seed the two demo tabs into the mock filesystem too so that any
        // workspace op which goes through the real fs path (rename, exists,
        // readFile during reopen-after-rename) finds them. Without this seed
        // the editor store has tabs but mockFs has nothing.
        const seedText = (path: string, content: string) => {
          const bytes = textEncoder.encode(content);
          const copy = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(copy).set(bytes);
          mockFs.set(path, copy);
        };
        seedText('/test-workspace/docs/test1.md', '# Test Document 1\n\nThis is a test markdown document.');
        seedText('/test-workspace/docs/test2.txt', 'This is a plain text document for testing the formatting toolbar.');
        (window as unknown as {
          __mockWorkspaceFs?: {
            list: () => string[];
            has: (p: string) => boolean;
            seed: (p: string, bytes: ArrayBuffer) => void;
          };
        }).__mockWorkspaceFs = {
          list: () => Array.from(mockFs.keys()),
          has: (p: string) => mockFs.has(p),
          seed: (p: string, bytes: ArrayBuffer) => {
            const copy = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(copy).set(new Uint8Array(bytes));
            mockFs.set(p, copy);
          },
        };
      }

      // Stream C1 — expose the templates marketplace store for E2E specs so
      // they can seed a synthetic service (no Tauri backend in test mode) and
      // drive Browse/Install/Uninstall flows end-to-end via the real React UI.
      (window as unknown as {
        __templatesMarketplaceStore?: typeof useTemplatesMarketplaceStore;
      }).__templatesMarketplaceStore = useTemplatesMarketplaceStore;

      console.log('Test mode enabled: Mock workspace initialized with 2 demo tabs + mock FS');

      // Recording mode: seed a realistic advisory household (the Webbs),
      // populate the tree, and open the review notes so the app can be
      // screen-recorded for the marketing site. Recording-only; gated by
      // ?recordMatter so the normal E2E path is unchanged.
      if (RECORD_MATTER) {
        const DIR = '/test-workspace/Webb Household';
        const reviewNotes = [
          '# Review Notes: Webb Household',
          '',
          '**Meeting:** Annual review',
          '**Date:** June 12, 2026',
          '**Present:** Marcus and Tanya Webb, me',
          '',
          '## What they told me',
          '',
          '- Marcus changed jobs last year. The $96k from the old employer 401(k) is still at the prior custodian. He wants it "in one place."',
          '- Tanya got a raise. They can push another $400/month into savings.',
          '- They are nervous about the market and asked, again, whether they should move to cash. Walked them through the plan and the time horizon.',
          '- Marcus mentioned, almost in passing, that he and his first wife divorced in 2019 and he "updated everything." Worth verifying.',
          '',
          '## What we agreed to do',
          '',
          '- Roll the old 401(k) into Marcus\'s IRA. I\'ll start the paperwork.',
          '- Increase the joint brokerage auto-contribution by $400/month.',
          '- Recheck every beneficiary designation. Marcus\'s comment about the divorce is exactly why.',
          '',
        ].join('\n');
        const planChat = JSON.stringify({
          version: 1, id: 'demo-plan-review', title: 'Plan review',
          created: '2026-06-13T09:12:00.000Z', updated: '2026-06-13T09:14:00.000Z',
          provider: 'anthropic', model: 'claude-sonnet-4-6',
          messages: [
            { role: 'user', content: 'Read my Review Notes and the Beneficiary Designations for the Webb household. Did we miss any beneficiary updates, and what did we agree to act on?', timestamp: '2026-06-13T09:12:00.000Z' },
            { role: 'assistant', content: 'Here is what stands out, and yes, there is a real gap.\n\n**The beneficiary gap: the old 401(k).** Your beneficiary file shows the prior-employer 401(k) still lists Jessica Reyes (100%), dated 2019, with no contingent. Your review notes have Marcus saying he divorced in 2019 and "updated everything." He did not update this one. As it stands, if Marcus died before the rollover, that ~$96k would go to his ex-spouse, not to Tanya. Every other account already names Tanya primary with the kids 50/50 contingent, so this is the single outlier. Confirm it against the custodian\'s record, not Marcus\'s memory.\n\n**What you agreed to act on:** roll the old 401(k) into Marcus\'s IRA (this also fixes the beneficiary problem), increase the joint brokerage contribution by $400/month, and recheck every beneficiary against the custodian.\n\nI am not making the change for you, just showing you where the record disagrees with what the client believes. Verify the old 401(k) beneficiary with the custodian before you rely on this.', timestamp: '2026-06-13T09:14:00.000Z' },
          ],
        }, null, 2);
        const matterFiles = [
          { path: `${DIR}/Review Notes.md`, name: 'Review Notes.md', content: reviewNotes },
          { path: `${DIR}/Plan review.aichat`, name: 'Plan review.aichat', content: planChat },
          { path: `${DIR}/Beneficiary Designations.md`, name: 'Beneficiary Designations.md', content: '# Beneficiary Designations: Webb Household\n\n| Account | Owner | Primary beneficiary | Last confirmed |\n|---|---|---|---|\n| 401(k) (current employer) | Marcus | Tanya Webb (100%) | 2026-01 |\n| Old 401(k) (prior employer) | Marcus | **Jessica Reyes (100%)** | 2019 |\n| 403(b) | Tanya | Marcus Webb (100%) | 2026-01 |\n\nThe old 401(k) still lists Marcus\'s first wife, dated 2019. He believes he updated everything after the divorce. He did not update this one. Roll it into the IRA so the correct beneficiaries control.\n' },
          { path: `${DIR}/Financial Plan Summary.md`, name: 'Financial Plan Summary.md', content: '# Financial Plan Summary: Webb Household\n\n- Retire at 60, fund both kids\' college, pay off the house early.\n- Marcus 401(k) $412k; old 401(k) $96k (rollover pending); Tanya 403(b) $188k.\n- Roth IRAs $61k / $54k; 529s $48k / $29k; cash reserve $55k.\n\nPlan: roll the old 401(k) in, keep the 529 auto-contributions, revisit a Roth conversion in a low-income year, hold the moderate-growth allocation.\n' },
          { path: `${DIR}/Client Intake Summary.md`, name: 'Client Intake Summary.md', content: '# Client Intake Summary\n\n**Household:** Marcus & Tanya Webb\n**Engagement:** Comprehensive planning + investment management.\n\nFlag: confirm the beneficiary on the old 401(k) and the rollover paperwork.\n' },
        ];
        const svc = workspaceServiceRef.current;
        if (svc) {
          void Promise.all(matterFiles.map((f) => svc.writeFile(f.path, f.content))).then(() => {
            setFileTree([
              {
                id: DIR, name: 'Webb Household', path: DIR, type: 'folder',
                children: matterFiles.map((f) => ({
                  id: f.path, name: f.name, path: f.path, type: 'file',
                  extension: f.name.split('.').pop(),
                })),
              },
            ] as Parameters<typeof setFileTree>[0]);
            expandAllFolders();
            const firstFile = matterFiles[0]!;
            openFile(firstFile.path, firstFile.name, firstFile.content);
          });
        }
      }
    }
  }, [isTestMode, rootPath, setRootPath, openFile]);
}
