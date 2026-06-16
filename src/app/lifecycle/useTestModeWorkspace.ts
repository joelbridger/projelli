/**
 * useTestModeWorkspace — initializes a mock workspace for E2E (Playwright) tests.
 *
 * Extracted from App.tsx (Phase 3 decomposition). The useEffect body is copied
 * VERBATIM from App.tsx; the only edit is IS_TEST_MODE → isTestMode (the option)
 * inside the body and in the dependency array.
 */
import { useEffect } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useEditorStore } from '@/stores/editorStore';
import { useFileBackupStore } from '@/stores/fileBackupStore';
import { useFileContextStore } from '@/stores/fileContextStore';
import { useTemplatesMarketplaceStore } from '@/stores/templatesMarketplaceStore';
import { buildOpenFilesPromptBlock } from '@/components/ai/AIChatViewer';
import type { WorkspaceService } from '@/modules/workspace/WorkspaceService';
import type { FileNode } from '@/types/workspace';
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

      // Recording mode: seed a realistic legal matter (Halvorsen Estate),
      // populate the tree, and open the deposition notes so the app can be
      // screen-recorded for the marketing site. Recording-only; gated by
      // ?recordMatter so the normal E2E path is unchanged.
      if (RECORD_MATTER) {
        const DIR = '/test-workspace/Halvorsen Estate';
        const depoNotes = [
          '# Deposition Notes: Markus Halvorsen',
          '',
          '**Matter:** Halvorsen Estate v. Cedar Point Holdings, LLC',
          '**Deponent:** Markus Halvorsen (defendant, managing member)',
          '**Date:** April 14, 2026',
          '',
          '## Testimony to remember',
          '',
          '- **p. 12** Did he see the second appraisal before closing? "No. I never saw a second appraisal. The first one was the only number I had."',
          '- **p. 31** Sale closed "sometime in November, I think the 20th or so."',
          '- **p. 47** What did he review before closing? "I reviewed all the paperwork the accountant sent over. The appraisals, the title work, the closing statement. All of it."',
          '- **p. 52** He and the accountant "talked every week without fail" during the sale.',
          '- **p. 68** He was "traveling most of October and November" and "hard to reach."',
          '',
          '## My flags',
          '',
          '- p. 12 vs p. 47 looks like a straight contradiction on the second appraisal. Pull Exhibit 9.',
          '- p. 52 vs p. 68 is softer. Worth a follow-up.',
          '',
        ].join('\n');
        const depoChat = JSON.stringify({
          version: 1, id: 'demo-depo', title: 'Deposition contradictions',
          created: '2026-04-15T09:12:00.000Z', updated: '2026-04-15T09:14:00.000Z',
          provider: 'anthropic', model: 'claude-sonnet-4-6',
          messages: [
            { role: 'user', content: 'Read my Deposition Notes for the Halvorsen matter. Find any places where his testimony contradicts itself, with page cites.', timestamp: '2026-04-15T09:12:00.000Z' },
            { role: 'assistant', content: 'Here is what stands out.\n\n**The clear one: the second appraisal.** On page 12 he says "No. I never saw a second appraisal." On page 47 he says he reviewed "all the paperwork the accountant sent over. The appraisals, the title work, the closing statement. All of it." Those two cannot both be true if the second appraisal was in that batch. Your note points at Exhibit 9, the appraisal transmittal. If that shows the appraisal going to him before closing, page 12 is the problem.\n\n**The softer one: availability.** Page 52 has him talking to the accountant "every week without fail" during the sale. Page 68 has him "traveling most of October and November" and "hard to reach." Worth a follow-up to pin down which it was.\n\nI am not drawing a legal conclusion, just showing you where the record disagrees with itself. Confirm each cite against the certified transcript.', timestamp: '2026-04-15T09:14:00.000Z' },
          ],
        }, null, 2);
        const matterFiles = [
          { path: `${DIR}/Deposition Notes.md`, name: 'Deposition Notes.md', content: depoNotes },
          { path: `${DIR}/Deposition contradictions.aichat`, name: 'Deposition contradictions.aichat', content: depoChat },
          { path: `${DIR}/Privilege Log.md`, name: 'Privilege Log.md', content: '# Privilege Log\n\n| Date | Author | Recipient | Privilege | Description |\n|---|---|---|---|---|\n| 2024-09-02 | Client | Me | Attorney-Client | Client request for advice re appraisal discrepancy |\n| 2024-10-11 | Me | (file) | Work Product | Internal analysis in anticipation of litigation |\n' },
          { path: `${DIR}/Case Timeline.md`, name: 'Case Timeline.md', content: '# Case Timeline\n\n- 2024-08-15 First appraisal delivered ($4.2M).\n- [2024-09-01] Second appraisal commissioned. Halvorsen denies seeing it (Depo p. 12).\n- [2024-11-20] Sale closes. Confirm against the recorded deed.\n- 2025-02 Estate files suit.\n' },
          { path: `${DIR}/Client Intake Summary.md`, name: 'Client Intake Summary.md', content: '# Client Intake Summary\n\n**Client:** Estate of Anders Halvorsen\n**Matter:** Below-value sale; concealed second appraisal.\n\nFlag: confirm the limitations period and calendar it.\n' },
        ];
        const svc = workspaceServiceRef.current;
        if (svc) {
          void Promise.all(matterFiles.map((f) => svc.writeFile(f.path, f.content))).then(() => {
            setFileTree([
              {
                id: DIR, name: 'Halvorsen Estate', path: DIR, type: 'folder',
                children: matterFiles.map((f) => ({
                  id: f.path, name: f.name, path: f.path, type: 'file',
                  extension: f.name.split('.').pop(),
                })),
              },
            ] as Parameters<typeof setFileTree>[0]);
            expandAllFolders();
            const depo = matterFiles[0]!;
            openFile(depo.path, depo.name, depo.content);
          });
        }
      }
    }
  }, [isTestMode, rootPath, setRootPath, openFile]);
}
