/**
 * useTestModeWorkspace — initializes a mock workspace for E2E (Playwright) tests.
 *
 * Extracted from App.tsx (Phase 3 decomposition). The useEffect body is copied
 * VERBATIM from App.tsx; the only edit is IS_TEST_MODE → isTestMode (the option)
 * inside the body and in the dependency array.
 */
import { useEffect, useRef } from 'react';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { setActiveWorkspaceService } from '@/app/fileOps/flushDirtyTabs';
import { setMeetingsWorkspaceService } from '@/features/meetings/meetingStore';
import { setMeetingMaterialViewerResolver } from '@/platform/fs/meetingMaterialViewer';
import { applyMeetingStamp } from '@/platform/fs/meetingMaterialVisibility';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useFileBackupStore } from '@/platform/fs/fileBackupStore';
import { useFileContextStore } from '@/platform/state/fileContextStore';
import { useTemplatesMarketplaceStore } from '@/features/workflows/templatesMarketplaceStore';
import { seedDemoClients } from '@/app/lifecycle/seedDemoClients';
import { getOrCreateSampleMatter } from '@/platform/matter/matterStore';
import { seedSampleClientMap } from '@/platform/matter/samples/sampleClientMap';
import { useProfessionStore } from '@/platform/profile/professionStore';
import { buildOpenFilesPromptBlock } from '@/features/ask/AIChatViewer';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { FSBackend, FileStat, WorkspaceInitOptions } from '@/platform/fs/types';
import type { FileNode, RecentWorkspace, Workspace } from '@/platform/types/workspace';
import type React from 'react';

const TEST_WORKSPACE_ROOT = '/test-workspace';

/**
 * The public WorkspaceService surface test mode must implement. `keyof` keeps
 * this coupled to the real service, so adding a production method makes this
 * mock fail type-checking until it supplies an honest test-mode behaviour.
 */
export type TestModeWorkspaceService = Pick<
  WorkspaceService,
  keyof WorkspaceService
>;

/**
 * Runtime contract for the browser workspace mock. Keep this list aligned with
 * WorkspaceService's public methods: the unit test checks that each name is a
 * function on the factory result, not merely present in TypeScript's types.
 */
export const TEST_MODE_WORKSPACE_SERVICE_METHOD_NAMES = [
  'initialize',
  'getWorkspace',
  'getRootPath',
  'isInitialized',
  'getBackend',
  'close',
  'readFile',
  'readFileBinary',
  'adoptUnstampedMeetingFolder',
  'writeFile',
  'writeFileBinary',
  'exists',
  'delete',
  'move',
  'copy',
  'rename',
  'mkdir',
  'list',
  'stat',
  'isSymlink',
  'resolveSymlink',
  'getFileTree',
  'toRecentWorkspace',
] as const satisfies readonly (keyof WorkspaceService)[];

export interface TestModeWorkspaceMock {
  service: TestModeWorkspaceService;
  listFiles(): string[];
  hasFile(path: string): boolean;
  seedFile(path: string, bytes: ArrayBuffer): void;
}
/** Build the browser/E2E in-memory equivalent of an open workspace. */
export function createTestModeWorkspaceMock(): TestModeWorkspaceMock {
  const files = new Map<string, ArrayBuffer>();
  const directories = new Set<string>([TEST_WORKSPACE_ROOT]);
  const textEncoder = new TextEncoder();
  const now = () => new Date();
  const normalizeDirectory = (path: string) =>
    path === '/' ? path : path.replace(/\/+$/, '');
  const parentPath = (path: string) =>
    path.slice(0, path.lastIndexOf('/')) || TEST_WORKSPACE_ROOT;
  const copyBuffer = (buffer: ArrayBuffer) => {
    const copy = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(copy).set(new Uint8Array(buffer));
    return copy;
  };
  const ensureParents = (path: string) => {
    let parent = parentPath(path);
    while (parent.startsWith(TEST_WORKSPACE_ROOT)) {
      directories.add(parent);
      if (parent === TEST_WORKSPACE_ROOT) break;
      parent = parentPath(parent);
    }
  };
  const folderHasChildren = (folderPath: string) => {
    const normalized = normalizeDirectory(folderPath);
    const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`;
    return (
      Array.from(files.keys()).some((path) => path.startsWith(prefix)) ||
      Array.from(directories).some(
        (path) => path !== normalized && path.startsWith(prefix)
      )
    );
  };
  const moveDirectories = (from: string, to: string) => {
    const fromPrefix = `${from}/`;
    for (const directory of [...directories]) {
      if (directory === from || directory.startsWith(fromPrefix)) {
        directories.delete(directory);
        directories.add(
          directory === from
            ? to
            : `${to}/${directory.slice(fromPrefix.length)}`
        );
      }
    }
  };
  const moveFiles = (from: string, to: string, removeSource: boolean) => {
    const directFile = files.get(from);
    if (directFile) {
      files.set(to, copyBuffer(directFile));
      if (removeSource) files.delete(from);
      ensureParents(to);
      return;
    }
    const fromPrefix = `${from}/`;
    for (const [path, bytes] of [...files.entries()]) {
      if (!path.startsWith(fromPrefix)) continue;
      const target = `${to}/${path.slice(fromPrefix.length)}`;
      files.set(target, copyBuffer(bytes));
      if (removeSource) files.delete(path);
      ensureParents(target);
    }
  };
  let workspace: Workspace | null = {
    rootPath: TEST_WORKSPACE_ROOT,
    name: 'test-workspace',
    createdAt: now(),
    lastOpenedAt: now(),
  };

  const service = {
    async initialize(
      _backend: FSBackend,
      rootPath: string,
      _options?: WorkspaceInitOptions
    ): Promise<Workspace> {
      await Promise.resolve();
      directories.add(normalizeDirectory(rootPath));
      workspace = {
        rootPath,
        name: rootPath.split('/').filter(Boolean).pop() ?? rootPath,
        createdAt: now(),
        lastOpenedAt: now(),
      };
      return workspace;
    },
    getWorkspace(): Workspace | null {
      return workspace;
    },
    getRootPath(): string | null {
      return workspace?.rootPath ?? null;
    },
    isInitialized(): boolean {
      return workspace !== null;
    },
    getBackend(): FSBackend | null {
      return null;
    },
    close(): void {
      workspace = null;
    },
    async readFile(path: string): Promise<string> {
      await Promise.resolve();
      const bytes = files.get(path);
      if (!bytes) throw new Error(`Not found: ${path}`);
      return new TextDecoder().decode(bytes);
    },
    async readFileBinary(path: string): Promise<ArrayBuffer> {
      await Promise.resolve();
      const bytes = files.get(path);
      if (!bytes) throw new Error(`Not found: ${path}`);
      return copyBuffer(bytes);
    },
    /**
     * CONTAINMENT (WB-085): satisfies the same contract as the real service so
     * the type stays total. NOT gated, deliberately and safely — this mock is
     * entirely in-memory under `/test-workspace`, reachable only via
     * `?testMode=true`, so there is no real folder for a second advisor to
     * point at and the shared-folder leak cannot occur. Stamping is still
     * honoured so demo material round-trips through the production shape.
     */
    async adoptUnstampedMeetingFolder(
      meetingDir: string,
      stamp: { readonly ownerRef: string; readonly visibilityPolicyId?: string }
    ): Promise<Record<string, unknown> | null> {
      await Promise.resolve();
      const stampPath = `${meetingDir}/meeting.json`;
      const bytes = files.get(stampPath);
      if (!bytes) return null;
      let meta: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          return null;
        meta = parsed as Record<string, unknown>;
      } catch {
        return null;
      }
      const stamped = applyMeetingStamp(meta, stamp);
      files.set(
        stampPath,
        copyBuffer(textEncoder.encode(JSON.stringify(stamped, null, 2)).buffer)
      );
      return stamped;
    },
    async writeFile(path: string, content: string): Promise<void> {
      await Promise.resolve();
      files.set(path, copyBuffer(textEncoder.encode(content).buffer));
      ensureParents(path);
    },
    async writeFileBinary(path: string, content: ArrayBuffer): Promise<void> {
      await Promise.resolve();
      files.set(path, copyBuffer(content));
      ensureParents(path);
    },
    async exists(path: string): Promise<boolean> {
      await Promise.resolve();
      return (
        files.has(path) ||
        directories.has(normalizeDirectory(path)) ||
        folderHasChildren(path)
      );
    },
    async delete(path: string): Promise<void> {
      await Promise.resolve();
      files.delete(path);
      const prefix = `${normalizeDirectory(path)}/`;
      for (const filePath of [...files.keys()]) {
        if (filePath.startsWith(prefix)) files.delete(filePath);
      }
      for (const directory of [...directories]) {
        if (
          directory === normalizeDirectory(path) ||
          directory.startsWith(prefix)
        )
          directories.delete(directory);
      }
    },
    async move(from: string, to: string): Promise<void> {
      await Promise.resolve();
      moveFiles(from, to, true);
      moveDirectories(normalizeDirectory(from), normalizeDirectory(to));
    },
    async copy(from: string, to: string): Promise<void> {
      await Promise.resolve();
      moveFiles(from, to, false);
      const fromDirectory = normalizeDirectory(from);
      const toDirectory = normalizeDirectory(to);
      const fromPrefix = `${fromDirectory}/`;
      for (const directory of [...directories]) {
        if (directory === fromDirectory || directory.startsWith(fromPrefix)) {
          directories.add(
            directory === fromDirectory
              ? toDirectory
              : `${toDirectory}/${directory.slice(fromPrefix.length)}`
          );
        }
      }
    },
    async rename(path: string, newName: string): Promise<void> {
      await service.move(path, `${parentPath(path)}/${newName}`);
    },
    async mkdir(path: string): Promise<void> {
      await Promise.resolve();
      directories.add(normalizeDirectory(path));
      ensureParents(path);
    },
    async list(path: string): Promise<FileNode[]> {
      await Promise.resolve();
      const normalized = normalizeDirectory(path);
      const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`;
      const entries = new Map<string, 'file' | 'folder'>();
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        const slash = rest.indexOf('/');
        entries.set(
          slash === -1 ? rest : rest.slice(0, slash),
          slash === -1 ? 'file' : 'folder'
        );
      }
      for (const directory of directories) {
        if (!directory.startsWith(prefix) || directory === normalized) continue;
        const rest = directory.slice(prefix.length);
        const slash = rest.indexOf('/');
        entries.set(slash === -1 ? rest : rest.slice(0, slash), 'folder');
      }
      return [...entries].map(([name, type]) => ({
        name,
        path: `${prefix}${name}`,
        id: `${prefix}${name}`,
        type,
      }));
    },
    async stat(path: string): Promise<FileStat> {
      await Promise.resolve();
      const bytes = files.get(path);
      if (bytes)
        return {
          path,
          name: path.split('/').pop() ?? path,
          type: 'file',
          size: bytes.byteLength,
          modifiedAt: now(),
          createdAt: now(),
          isSymlink: false,
        };
      if (
        directories.has(normalizeDirectory(path)) ||
        folderHasChildren(path)
      ) {
        return {
          path,
          name: path.split('/').filter(Boolean).pop() ?? path,
          type: 'folder',
          size: 0,
          modifiedAt: now(),
          createdAt: now(),
          isSymlink: false,
        };
      }
      throw new Error(`Not found: ${path}`);
    },
    async isSymlink(): Promise<boolean> {
      await Promise.resolve();
      return false;
    },
    async resolveSymlink(path: string): Promise<string> {
      await Promise.resolve();
      throw new Error(`Test-mode workspace has no symlinks: ${path}`);
    },
    async getFileTree(): Promise<FileNode[]> {
      const buildTree = async (path: string): Promise<FileNode[]> => {
        const entries = await service.list(path);
        return Promise.all(
          entries.map(async (entry) =>
            entry.type === 'folder'
              ? { ...entry, children: await buildTree(entry.path) }
              : entry.name.lastIndexOf('.') > 0
                ? { ...entry, extension: entry.name.slice(entry.name.lastIndexOf('.') + 1) }
                : entry
          )
        );
      };
      return buildTree(workspace?.rootPath ?? TEST_WORKSPACE_ROOT);
    },
    toRecentWorkspace(): RecentWorkspace | null {
      return workspace
        ? { path: workspace.rootPath, name: workspace.name, lastOpened: now() }
        : null;
    },
  } satisfies TestModeWorkspaceService;

  return {
    service,
    listFiles: () => [...files.keys()],
    hasFile: (path) => files.has(path),
    seedFile: (path, bytes) => {
      files.set(path, copyBuffer(bytes));
      ensureParents(path);
    },
  };
}
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
  // This hook's recording setup writes several files asynchronously. Keep the
  // mounted state separate from the setup effect: setting rootPath reruns that
  // effect, but must not discard a recording setup that is still in progress.
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

      // Dev/preview-only: activate the built-in advisor SAMPLE matter (the
      // Hendricks household) so the demo-video engine can record the Ask
      // "cited answer, no key" flow. The sample matter is the ONLY matter for
      // which Ask serves its hand-authored, cited demo answers offline (see
      // the demo branch in useAsk.ts, gated on SAMPLE_MATTER_ID + no cloud
      // key). We reuse the exact functions the onboarding "Try a sample" path
      // uses — nothing is reinvented. Gated by ?seedSample so the normal E2E
      // path (empty workspace) is untouched.
      if (window.location.search.includes('seedSample')) {
        useProfessionStore.getState().setProfession('advisor');
        const sampleMatter = getOrCreateSampleMatter('/test-workspace');
        // seedSampleClientMap also sets the sample matter active + opens its
        // Client Map hub, so first render lands on a filled, cited map.
        void seedSampleClientMap(sampleMatter.id);
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
        const testWorkspace = createTestModeWorkspaceMock();
        // TestModeWorkspaceService is checked against every public
        // WorkspaceService member above. This one assertion only bridges the
        // class's private implementation state; it cannot hide a missing method.
        workspaceServiceRef.current = testWorkspace.service as WorkspaceService;
        setActiveWorkspaceService(workspaceServiceRef.current); // BUG-046: flush accessor
        setMeetingsWorkspaceService(workspaceServiceRef.current); // Wave 3c: meetings feature accessor
        // CONTAINMENT (WB-085): see useWorkspaceLifecycle — the file-backed
        // meeting gate resolves the viewer through this.
        setMeetingMaterialViewerResolver(
          () => useFirmStore.getState().session?.userId ?? null
        );
        // Seed the two demo tabs into the mock filesystem too so that any
        // workspace op which goes through the real fs path (rename, exists,
        // readFile during reopen-after-rename) finds them.
        const seedText = (path: string, content: string) => {
          testWorkspace.seedFile(path, new TextEncoder().encode(content).buffer);
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
          list: () => testWorkspace.listFiles(),
          has: (path) => testWorkspace.hasFile(path),
          seed: (path, bytes) => {
            testWorkspace.seedFile(path, bytes);
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
        const service = workspaceServiceRef.current;
        void Promise.all(matterFiles.map((f) => service.writeFile(f.path, f.content))).then(() => {
            if (!isMountedRef.current) return;
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
            const firstFile = matterFiles[0];
            if (!firstFile) return;
            openFile(firstFile.path, firstFile.name, firstFile.content);
          });
      }
    }
  }, [isTestMode, rootPath, setRootPath, openFile]);
}
